"use client";

/**
 * 홈 간편 견적 — "이 내용으로 견적 신청하기" 모달 (P3-8 · 사용자 결정 2026-09-27).
 *
 * 흐름: 위젯(components/home/QuoteWidget.tsx)이 다섯 칸을 검사한 뒤에만 이 모달을 연다.
 *   요약(출발→도착 · 날짜 · 인원 · [수정]) → 이름 · 연락처 → 개인정보 수집·이용 고지 + 필수 체크 → 청약철회 제한·취소 규정 고지 + 필수 체크
 *   → verbatim → Turnstile → [견적 신청하기] → 완료(접수번호 · verbatim · 예약 확인 · 전화).
 *
 * 경계
 *   - 법정 문구는 전부 props(legal)로 받는다 — 서버 Hero 가 원장에서 읽어 내린다. 이 파일에는 원장 import 도, 법정 한글 리터럴도 없다.
 *     화면 문구는 messages quote.modal.*.
 *   - 폼 토큰은 **모달을 열 때** 서버액션(requestQuoteFormToken)으로 받는다 — 홈이 ISR 이라 HTML 에 구울 수 없다. null 이면
 *     "접수 준비 중 — 전화" + 제출 비활성(fail-closed). Turnstile 도 토큰을 받은 뒤, 모달 안에서만 렌더한다.
 *     서버가 bot(타임트랩 — 1시간 만료 등)을 돌려주면 토큰을 **다시** 받는다(리뷰 P2-1 — 오래 열어 둔 모달이 막다른 길이 되지 않게).
 *   - 열려 있는 동안 배경은 `inert`(리뷰 P2-10). 접수에 성공하면 위젯이 칸을 비운다(onSubmitted · 리뷰 P2-11).
 *   - 제출은 `<form action>` + useActionState. **서버액션 시그니처는 (formData) 하나**라 (_prev, fd) 래퍼로 감싼다(P3-3 리뷰 M3).
 *   - 필드명은 계약표 사본(./fields F·G)만. 연락처는 한 칸이고 `+` 로 시작하면 해외 — hidden phone/phoneIntl 을 splitPhone 이 XOR 로 만든다.
 *   - 동의 체크박스는 **기본 해제**. 필수 미체크면 제출이 닫힌다(submit-gate). 광고성 정보 수신 동의는 받지 않는다(체크박스 없음).
 *   - 접근성: role=dialog · aria-modal · aria-labelledby(제목) · 열릴 때 이름 칸으로 포커스 · Tab 가둠 · ESC 닫기 · 배경 스크롤 잠금.
 *     닫힌 뒤 여는 버튼으로 포커스를 돌려주는 것은 위젯이 한다(onClose).
 *   - 개인정보는 이 컴포넌트의 상태에만 있다 — props·URL·저장소(localStorage·sessionStorage)에 싣지 않는다. 닫으면 사라진다.
 */
import { useTranslations } from "next-intl";
import { useActionState, useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import { requestQuoteFormToken } from "@/actions/quote-form-token";
import { submitReservation } from "@/actions/reservation";
import { Link } from "@/i18n/navigation";
import type { ContactPhone } from "@/lib/contact-phone";
import type { SubmitResult } from "@/lib/reservations/submitResult";

import { ConsentBlock, type ConsentText } from "./ConsentBlock";
import { ErrorText } from "./FieldBits";
import { F, G } from "./fields";
import m from "./QuickQuote.module.css";
import {
  dateSpan,
  formatPhoneInput,
  inertBackground,
  isWidgetField,
  modalFieldOf,
  NAME_MAX_LENGTH,
  needsFreshFormToken,
  splitPhone,
  validateContact,
  type FieldError,
  type WidgetField,
  type WidgetFields,
} from "./quick-quote";
import s from "./quote.module.css";
import { submitBlock, type SubmitBlock } from "./submit-gate";
import { TurnstileWidget } from "./TurnstileWidget";

/** 서버 컴포넌트(Hero)가 원장에서 만들어 내리는 법정 문구 묶음. */
export interface QuickQuoteLegal {
  consent: ConsentText;
  /** 서버 컴포넌트 <WithdrawalNotice /> — 취소·환불 규정 + 청약철회 제한 고지. */
  withdrawalNotice: ReactNode;
  /** 청약철회 제한 확인 체크박스 라벨 — ledgerUi(locale).consent.withdrawal. */
  withdrawalConsentLabel: string;
  /** VERBATIM.bookingNotice(en 은 localizeVerbatim). */
  bookingNotice: string;
  /** 예약·상담 전화 — 오류·"접수 준비 중" 안내의 전화 폴백. */
  tel: ContactPhone;
}

export interface PlaceLabels {
  origin: string;
  dest: string;
}

interface CommonProps {
  fields: WidgetFields;
  /** 요약에 보일 장소 이름(코드 → 로케일 라벨) — 위젯이 선택지 라벨에서 찾아 넘긴다. */
  placeLabels: PlaceLabels;
  locale: string;
  legal: QuickQuoteLegal;
  /** NEXT_PUBLIC_TURNSTILE_SITE_KEY. "" = 위젯 대신 안내 + 제출 닫힘. */
  turnstileSiteKey: string;
  turnstileAction: string;
}

export interface QuickQuoteModalProps extends CommonProps {
  open: boolean;
  /** 닫기(ESC · 닫기 버튼 · 완료 화면의 닫기). 위젯이 여는 버튼으로 포커스를 돌려준다. */
  onClose: () => void;
  /** [수정] — 닫고 위젯의 첫 칸으로. */
  onEdit: () => void;
  /** 서버가 위젯 칸(날짜·장소·인원)을 거부했을 때 — 위젯이 그 칸에 오류를 보인다. */
  onWidgetErrors: (errors: FieldError[]) => void;
  /** 접수 성공(허니팟 가짜 성공 포함) — 위젯이 칸을 처음 상태로 비운다(P2-11). */
  onSubmitted: () => void;
}

const SERVER_WIDGET_KEYS: Readonly<Record<WidgetField, string>> = {
  originCode: "home.hero.widget.errors.origin",
  destinationCode: "home.hero.widget.errors.dest",
  departDate: "home.hero.widget.errors.departDate",
  returnDate: "home.hero.widget.errors.returnDate",
  passengers: "home.hero.widget.errors.pax",
};
const SERVER_MODAL_KEYS: Readonly<Record<string, string>> = {
  name: "quote.modal.errors.name",
  phone: "quote.modal.errors.phone",
  privacyConsent: "quote.modal.errors.consent",
  withdrawalConsent: "quote.modal.errors.consent",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

export function QuickQuoteModal(props: QuickQuoteModalProps) {
  if (!props.open) return null;
  return <ModalShell {...props} />;
}

function ModalShell({ onClose, onEdit, onWidgetErrors, onSubmitted, ...common }: QuickQuoteModalProps) {
  const t = useTranslations("quote.modal");
  const titleId = useId();
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  /** undefined = 받는 중 · null = 시크릿 없음(fail-closed) · 문자열 = 토큰 */
  const [formToken, setFormToken] = useState<string | null | undefined>(undefined);
  const [done, setDone] = useState<{ code: string | null } | null>(null);

  // 폼 토큰 받기 — 열 때 한 번, 그리고 서버가 bot(타임트랩: 만료·위조·너무 빠름)을 돌려줄 때마다 새로(P3-8 리뷰 P2-1).
  // 모달을 한 시간 넘게 열어 두면 첫 토큰이 만료된다 — 그대로 두면 이후 제출이 전부 bot 인 막다른 길이다.
  // 받는 동안은 undefined(제출 닫힘 · Turnstile 도 다시 그린다). 요청이 겹치면 **마지막 요청의 답만** 쓴다(seq). 실패(네트워크)는 null(fail-closed).
  const tokenSeq = useRef(0);
  const loadFormToken = useCallback(() => {
    const seq = ++tokenSeq.current;
    setFormToken(undefined);
    requestQuoteFormToken()
      .then((token) => {
        if (tokenSeq.current === seq) setFormToken(token);
      })
      .catch(() => {
        if (tokenSeq.current === seq) setFormToken(null);
      });
  }, []);
  useEffect(() => {
    const seqRef = tokenSeq; // DOM 을 가리키는 ref 가 아니다 — 카운터 객체를 그대로 쓴다
    loadFormToken();
    return () => {
      // 닫힌 뒤 도착한 답은 버린다
      seqRef.current++;
    };
  }, [loadFormToken]);

  // 배경 inert — 열려 있는 동안 대화상자 밖은 읽히지도 눌리지도 않는다(P2-10 · aria-modal 을 무시하는 스크린리더 대비).
  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    const restore = inertBackground(backdrop, document.body);
    return () => {
      restore();
    };
  }, []);

  // 배경 스크롤 잠금 — 닫히면 원래 값으로.
  useEffect(() => {
    const body = document.body;
    const prev = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = prev;
    };
  }, []);

  // 열릴 때 첫 입력 칸(이름)으로 포커스. 완료 화면으로 바뀌면 그 제목으로.
  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const target = done
      ? root.querySelector<HTMLElement>("[data-focus-first]")
      : root.querySelector<HTMLElement>(`input[name="${F.name}"]`);
    (target ?? root).focus();
  }, [done]);

  // ESC 닫기 · Tab 가둠(마지막 → 처음, 처음 → 마지막).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div ref={backdropRef} className={m.backdrop} data-testid="quick-quote-backdrop">
      <div
        ref={dialogRef}
        className={m.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="quick-quote-dialog"
        data-state={done ? "done" : "form"}
      >
        <button type="button" className={m.close} onClick={onClose} aria-label={t("close")} data-testid="quick-quote-close">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <div className={m.body}>
          {done ? (
            <QuickQuoteDone code={done.code} bookingNotice={common.legal.bookingNotice} tel={common.legal.tel} onClose={onClose} titleId={titleId} />
          ) : (
            <QuickQuoteForm
              {...common}
              formToken={formToken}
              onEdit={onEdit}
              onWidgetErrors={onWidgetErrors}
              onStaleToken={loadFormToken}
              onDone={(code) => {
                setDone({ code });
                // 위젯이 칸을 비운다 — 완료 화면을 닫고 다시 [견적 신청하기] 를 눌러도 같은 내용이 또 접수되지 않게(P2-11).
                onSubmitted();
              }}
              titleId={titleId}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export interface QuickQuoteFormProps extends CommonProps {
  /** undefined = 받는 중 · null = 시크릿 없음(fail-closed) · 문자열 = 서명된 토큰. */
  formToken: string | null | undefined;
  onEdit: () => void;
  onWidgetErrors: (errors: FieldError[]) => void;
  /** 서버가 bot(타임트랩)을 돌려줬다 — 모달이 폼 토큰을 새로 받는다(P2-1). */
  onStaleToken: () => void;
  /** 성공 — 접수번호(허니팟 가짜 성공이면 null). */
  onDone: (code: string | null) => void;
  titleId: string;
}

export function QuickQuoteForm({
  fields,
  placeLabels,
  locale,
  legal,
  turnstileSiteKey,
  turnstileAction,
  formToken,
  onEdit,
  onWidgetErrors,
  onStaleToken,
  onDone,
  titleId,
}: QuickQuoteFormProps) {
  const t = useTranslations("quote.modal");
  const tRoot = useTranslations();
  const idPrefix = useId();
  const id = (k: string) => `${idPrefix}-${k}`;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [withdrawalConsent, setWithdrawalConsent] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [widgetFix, setWidgetFix] = useState(false);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [result, formAction, pending] = useActionState<SubmitResult | null, FormData>(async (_prev, fd) => submitReservation(fd), null);

  // 부모 콜백은 렌더마다 새로 만들어질 수 있다 — 결과 처리 effect 가 콜백이 바뀔 때마다 다시 돌지 않게 최신 값을 ref 로 든다.
  const onDoneRef = useRef(onDone);
  const onWidgetErrorsRef = useRef(onWidgetErrors);
  const onStaleTokenRef = useRef(onStaleToken);
  useEffect(() => {
    onDoneRef.current = onDone;
    onWidgetErrorsRef.current = onWidgetErrors;
    onStaleTokenRef.current = onStaleToken;
  }, [onDone, onWidgetErrors, onStaleToken]);

  const loading = formToken === undefined && turnstileSiteKey !== "";
  const block: SubmitBlock = loading
    ? "pending"
    : submitBlock({ formToken: formToken ?? null, siteKey: turnstileSiteKey, privacyConsent, withdrawalConsent, pending });
  const notReady = !loading && block === "not-ready";
  const contact = splitPhone(phone);
  const span = dateSpan(fields);

  // 서버 오류 문구 — reservation.errors.* 의 ratelimit·infra·server 가 {tel} 을 부른다(원장 값은 props 로 받았다).
  const resolve = useCallback((key: string) => tRoot(key, { tel: legal.tel.display }), [tRoot, legal.tel.display]);
  const errorFor = (field: string) => {
    const hit = errors.find((e) => e.field === field);
    return hit ? resolve(hit.messageKey) : undefined;
  };

  const focusField = useCallback((field: string) => {
    window.setTimeout(() => {
      const root = formRef.current;
      if (!root) return;
      const el = root.querySelector<HTMLElement>(`[data-field="${field}"] input:not([type="hidden"])`);
      el?.focus();
    }, 0);
  }, []);

  // 결과 하나는 한 번만 처리한다 — 번역 함수 등 의존값이 바뀌어 effect 가 다시 돌아도 같은 결과로 상태를 다시 쓰지 않는다.
  const handledRef = useRef<SubmitResult | null>(null);
  useEffect(() => {
    if (!result || handledRef.current === result) return;
    handledRef.current = result;
    if (result.ok) {
      onDoneRef.current(result.publicCode);
      return;
    }
    setServerError(resolve(result.messageKey));
    const entries = Object.keys(result.fieldErrors ?? {});
    const widgetErrors = entries.filter(isWidgetField).map((field) => ({ field, messageKey: SERVER_WIDGET_KEYS[field] }));
    const modalErrors = entries
      .filter((f) => !isWidgetField(f))
      .map((f) => modalFieldOf(f))
      .filter((f, i, all) => all.indexOf(f) === i && f in SERVER_MODAL_KEYS)
      .map((field) => ({ field, messageKey: SERVER_MODAL_KEYS[field] }));
    setWidgetFix(widgetErrors.length > 0);
    if (widgetErrors.length > 0) onWidgetErrorsRef.current(widgetErrors);
    setErrors(modalErrors);
    if (modalErrors.length > 0) focusField(modalErrors[0].field);
    // bot(타임트랩 만료·위조·너무 빠름) — 같은 폼 토큰으로는 다시 내도 같은 결과다. 새로 받는다(P2-1).
    if (needsFreshFormToken(result)) onStaleTokenRef.current();
    // siteverify 토큰은 1회용 — 다시 제출하려면 새 토큰이 필요하다.
    setTurnstileResetKey((k) => k + 1);
  }, [result, resolve, focusField]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    const errs = validateContact({ name, phone });
    if (!privacyConsent) errs.push({ field: "privacyConsent", messageKey: SERVER_MODAL_KEYS.privacyConsent });
    if (!withdrawalConsent) errs.push({ field: "withdrawalConsent", messageKey: SERVER_MODAL_KEYS.withdrawalConsent });
    if (errs.length > 0) {
      e.preventDefault();
      setErrors(errs);
      focusField(errs[0].field);
      return;
    }
    if (block !== null) {
      e.preventDefault();
      return;
    }
    setErrors([]);
    setServerError(null);
    setWidgetFix(false);
  };

  const nameErr = errorFor("name");
  const phoneErr = errorFor("phone");
  const consentErr = errorFor("privacyConsent");
  const withdrawalErr = errorFor("withdrawalConsent");

  return (
    <>
      <h2 className={m.title} id={titleId}>
        {t("title")}
      </h2>

      <section className={m.summary} aria-label={t("summaryLabel")}>
        <dl className={m.summaryList} data-testid="quick-quote-summary">
          <div>
            <dt>{t("summaryRoute")}</dt>
            <dd>{t("routeValue", { origin: placeLabels.origin, destination: placeLabels.dest })}</dd>
          </div>
          <div>
            <dt>{t("summaryDates")}</dt>
            <dd>{span.kind === "single" ? t("dateSingle", { date: span.date }) : t("dateRange", { from: span.from, to: span.to })}</dd>
          </div>
          <div>
            <dt>{t("summaryPax")}</dt>
            <dd>{t("paxValue", { n: Number(fields.passengers.trim()) })}</dd>
          </div>
        </dl>
        <div className={m.summaryFoot}>
          <p className={m.summaryHint}>{t("summaryHint")}</p>
          <button type="button" className={m.edit} onClick={onEdit} data-testid="quick-quote-edit">
            {t("edit")}
          </button>
        </div>
      </section>

      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate data-testid="quick-quote-form">
        <input type="hidden" name={F.locale} value={locale === "en" ? "en" : "ko"} />
        <input type="hidden" name={G.formToken} value={formToken ?? ""} />
        <input type="hidden" name={F.originCode} value={fields.originCode} />
        <input type="hidden" name={F.destinationCode} value={fields.destinationCode} />
        <input type="hidden" name={F.departDate} value={fields.departDate} />
        <input type="hidden" name={F.returnDate} value={fields.returnDate} />
        <input type="hidden" name={F.passengers} value={fields.passengers.trim()} />
        <input type="hidden" name={F.phone} value={contact.phone} />
        <input type="hidden" name={F.phoneIntl} value={contact.phoneIntl} />
        {/* 허니팟 — 사람은 보지도 포커스하지도 못한다. 채워지면 서버가 조용한 가짜 성공을 돌려준다. */}
        <div className={s.hp} aria-hidden="true">
          <label htmlFor={id("website")}>Website</label>
          <input id={id("website")} type="text" name={G.website} tabIndex={-1} autoComplete="off" aria-hidden="true" defaultValue="" />
        </div>

        <div className={s.live} role="alert" aria-live="assertive" aria-atomic="true" data-testid="quick-quote-live">
          {serverError ? (
            <>
              <p className={s.liveTitle}>{serverError}</p>
              {widgetFix ? <p className={s.liveList}>{t("widgetFix")}</p> : null}
            </>
          ) : null}
        </div>

        <div className={s.field} data-field="name">
          <label className={s.flabel} htmlFor={id("name")}>
            {t("nameLabel")}
          </label>
          <input
            id={id("name")}
            className={s.control}
            type="text"
            name={F.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={NAME_MAX_LENGTH}
            aria-invalid={nameErr ? true : undefined}
            aria-describedby={nameErr ? id("err-name") : undefined}
            data-testid="quick-quote-name"
          />
          <ErrorText id={id("err-name")} message={nameErr} />
        </div>

        <div className={s.field} data-field="phone">
          <label className={s.flabel} htmlFor={id("phone")}>
            {t("phoneLabel")}
          </label>
          <p className={s.fhint} id={id("hint-phone")}>
            {t("phoneHint")}
          </p>
          <input
            id={id("phone")}
            className={s.control}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={16}
            value={phone}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            aria-invalid={phoneErr ? true : undefined}
            aria-describedby={phoneErr ? `${id("hint-phone")} ${id("err-phone")}` : id("hint-phone")}
            data-testid="quick-quote-phone"
          />
          <ErrorText id={id("err-phone")} message={phoneErr} />
        </div>

        <ConsentBlock text={legal.consent} privacyConsent={privacyConsent} onPrivacyChange={setPrivacyConsent} error={consentErr} idPrefix={idPrefix} />

        {legal.withdrawalNotice}

        <div className={s.withdrawalConsent} data-field="withdrawalConsent" data-testid="withdrawal-consent-block">
          <label className={s.consentRow} data-checked={withdrawalConsent}>
            <input
              type="checkbox"
              name={F.withdrawalConsent}
              checked={withdrawalConsent}
              onChange={(e) => setWithdrawalConsent(e.target.checked)}
              aria-describedby={withdrawalErr ? id("err-withdrawalConsent") : undefined}
              aria-invalid={withdrawalErr ? true : undefined}
              data-testid="consent-withdrawal"
            />
            <span>{legal.withdrawalConsentLabel}</span>
          </label>
          <ErrorText id={id("err-withdrawalConsent")} message={withdrawalErr} />
        </div>

        <p className={m.verbatim} data-legal="booking-notice">
          {legal.bookingNotice}
        </p>

        <div data-testid="quick-quote-security" aria-label={t("security")}>
          {notReady ? (
            <div className={s.notReady} role="status" data-testid="quick-quote-not-ready">
              <strong>{t("notReadyTitle")}</strong>
              <p>{t("notReadyBody", { tel: legal.tel.display })}</p>
              <p>
                <a href={legal.tel.href}>
                  {t("call")} {legal.tel.display}
                </a>
              </p>
            </div>
          ) : formToken ? (
            <TurnstileWidget siteKey={turnstileSiteKey} action={turnstileAction} resetKey={turnstileResetKey} />
          ) : null}
        </div>

        <div className={m.submitRow}>
          {block === "consent" ? (
            <p className={m.submitHint} id={id("submit-hint")}>
              {t("consentRequired")}
            </p>
          ) : null}
          <button
            type="submit"
            className={`${s.btn} ${s.btnSubmit}`}
            disabled={block !== null}
            aria-describedby={block === "consent" ? id("submit-hint") : undefined}
            data-testid="quick-quote-submit"
            data-block={block ?? undefined}
          >
            {pending ? t("submitting") : t("submit")}
          </button>
        </div>
      </form>
    </>
  );
}

/** 완료 — 접수번호(허니팟 가짜 성공이면 없음) · verbatim · 예약 확인 · 예약·상담 전화. */
export function QuickQuoteDone({
  code,
  bookingNotice,
  tel,
  onClose,
  titleId,
}: {
  code: string | null;
  bookingNotice: string;
  tel: ContactPhone;
  onClose: () => void;
  titleId: string;
}) {
  const t = useTranslations("quote.modal.done");
  return (
    <section className={m.done} data-testid="quick-quote-done">
      <div className={s.doneBadge} aria-hidden="true">
        ✓
      </div>
      <h2 className={m.title} id={titleId} tabIndex={-1} data-focus-first="">
        {t("title")}
      </h2>
      {code ? (
        <>
          <p className={s.doneCodeLabel}>{t("codeLabel")}</p>
          <p className={s.doneCode} data-testid="quick-quote-code">
            {code}
          </p>
          <p className={s.doneHint}>{t("codeHint")}</p>
        </>
      ) : (
        <p className={s.doneHint} data-testid="quick-quote-nocode">
          {t("noCode")}
        </p>
      )}
      <p className={s.doneNote}>
        <span data-legal="booking-notice">{bookingNotice}</span>
      </p>
      <p className={s.doneSub}>{t("sub", { tel: tel.display })}</p>
      <div className={m.doneActions}>
        <Link href="/reservation/check" className={`${s.btn} ${s.btnSubmit}`} data-testid="quick-quote-check">
          {t("check")}
        </Link>
        <a href={tel.href} className={`${s.btn} ${s.btnPrev}`} data-testid="quick-quote-call">
          {t("call")} {tel.display}
        </a>
        <button type="button" className={`${s.btn} ${s.btnPrev}`} onClick={onClose} data-testid="quick-quote-done-close">
          {t("close")}
        </button>
      </div>
    </section>
  );
}

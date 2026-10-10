"use client";

/**
 * 예약확인 폼 — 휴대폰 번호 + 예약자 이름 (P6-3a · T2-5 · 사장님 요청 1 · 결정 5 B안 · P3-4 위저드와 같은 폼 규약).
 *
 *   - 제출: <form action={formAction}> + useActionState. **서버액션 시그니처는 (formData) 하나**라 (_prev, fd) 래퍼로 감싼다
 *     (P3-3 독립 리뷰 M3 — checkReservation 을 직접 넘기면 prevState 가 첫 인자가 되어 항상 형식 실패가 돌아온다).
 *   - 입력은 controlled — React 19 는 액션이 끝나면 비제어 폼을 reset 하므로, not_found 뒤에도 방금 친 값이 남아 있게 상태로 든다.
 *     휴대폰 칸은 견적 모달과 같은 정리(formatPhoneInput — 자동 하이픈, `+` 로 시작하면 해외)를 쓴다. 서버가 같은 규칙으로 정규화한다.
 *   - 사전 검증(validate.ts)은 zod 와 같은 판정이다. 서버는 형식 실패를 not_found 와 같은 응답으로 돌려주므로(존재 비노출) 형식 안내는 여기서만 나온다.
 *   - Turnstile(T2-5 — P6-3a 의 "조회엔 Turnstile 없음" 번복): 서버 페이지가 사이트 키와 조회 전용 action('check')을 props 로 준다.
 *     사이트 키가 비면 위젯 대신 "조회 준비 중" 안내 + 제출 닫힘(fail-closed — 견적 모달과 같다). 토큰이 아직 없으면 서버에 보내지 않고
 *     보안 확인 안내를 보인다. 서버 응답이 오면(성공이 아니면) siteverify 토큰은 1회용이라 위젯을 리셋해 새 토큰을 받는다.
 *     개발 프리뷰(?previewResult=)는 위젯 없이 mock 결과를 돌려준다.
 *   - 오류는 role="alert" 요약 + 필드 aria-invalid/aria-describedby. pending 시 버튼 disabled. 허니팟 `website` 는 P3-4 와 동일 처리.
 *   - 포커스: 클라이언트 검증 실패는 첫 오류 입력으로, 서버 오류 결과는 요약(role=alert, tabIndex -1)으로, 성공은 결과 묶음으로 옮긴다
 *     — pending 동안 disabled 된 버튼에서 떨어진 포커스가 body 에 남지 않게(리뷰 M-2, WCAG 2.4.3).
 *   - 성공 시 폼 대신 ReservationResults(여러 건이면 카드 여러 장)를 그린다. "다른 예약 조회"는 key 를 올려 라운드를 새로 시작한다.
 * 한글 리터럴·원장 import 없음 — 문구는 messages 의 reservationCheck.*, 법정 문구·예약·상담 전화는 서버 페이지가 props 로 넣는다.
 */
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { checkReservation } from "@/actions/reservation-check";
import { NAME_MAX_LENGTH, formatPhoneInput } from "@/components/quote/quick-quote";
import { TurnstileWidget } from "@/components/quote/TurnstileWidget";
import type { ContactPhone } from "@/lib/contact-phone";
import { CHECK_ERROR_KEYS, type CheckErrorKey, type CheckFieldErrors, type CheckResult } from "@/lib/reservation-check/result";

import q from "@/components/quote/quote.module.css";
import s from "./check.module.css";
import { CF, CG, CL } from "./fields";
import { previewCheckAction, type PreviewResultMode } from "./preview-result";
import { ReservationResults } from "./ReservationCard";
import { validateCheckForm } from "./validate";

export interface CheckFormProps {
  /** 원장 VERBATIM.bookingNotice — 결과 카드(접수 상태) 하단. */
  bookingNotice: string;
  /** 예약·상담 전화(P1-7 — lib/contact-phone.ts) — 안내·전화 폴백. 표시는 로케일별, 링크는 E.164. */
  tel: ContactPhone;
  /** NEXT_PUBLIC_TURNSTILE_SITE_KEY. "" = 위젯 대신 준비 중 안내 + 제출 닫힘. */
  turnstileSiteKey: string;
  /** 조회 전용 위젯 action — 서버 페이지가 TURNSTILE_CHECK_ACTION('check')을 넣는다(클라이언트는 방어 모듈을 import 하지 않는다 — node:crypto 그래프). */
  turnstileAction: string;
  previewResult: PreviewResultMode | null;
}

export function CheckForm(props: CheckFormProps) {
  const [round, setRound] = useState(0);
  return <CheckRound key={round} {...props} onAgain={() => setRound((r) => r + 1)} />;
}

function CheckRound({ bookingNotice, tel, turnstileSiteKey, turnstileAction, previewResult, onAgain }: CheckFormProps & { onAgain: () => void }) {
  const t = useTranslations("reservationCheck");
  const tRoot = useTranslations();
  const locale = useLocale();
  const idPrefix = useId();
  const id = (k: string) => `${idPrefix}-${k}`;

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [clientErrors, setClientErrors] = useState<CheckFieldErrors>({});
  /** 토큰 없이 누른 경우의 안내(서버 문구와 같은 키) — 서버까지 가지 않는다. */
  const [clientNotice, setClientNotice] = useState<CheckErrorKey | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const liveRef = useRef<HTMLDivElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const usesWidget = previewResult === null;
  const notReady = usesWidget && turnstileSiteKey === "";

  const [result, formAction, pending] = useActionState<CheckResult | null, FormData>(
    async (_prev, fd) => (previewResult ? previewCheckAction(previewResult)(fd) : checkReservation(fd)),
    null,
  );

  // 서버 결과가 오면 — 오류면 요약(role=alert)으로 포커스하고 위젯을 리셋(토큰은 1회용), 성공이면 결과 묶음으로 포커스.
  // 훅은 아래 early return 앞에 있어야 한다.
  useEffect(() => {
    if (result && !result.ok) {
      liveRef.current?.focus();
      setTurnstileResetKey((k) => k + 1);
    }
    if (result?.ok) resultsRef.current?.focus();
  }, [result]);

  if (result?.ok) {
    return (
      <div ref={resultsRef} tabIndex={-1} className={s.alertFocus}>
        <ReservationResults views={result.views} bookingNotice={bookingNotice} tel={tel} onAgain={onAgain} />
      </div>
    );
  }

  const errors: CheckFieldErrors = clientErrors;
  const phoneErr = errors.phone ? tRoot(errors.phone) : undefined;
  const nameErr = errors.name ? tRoot(errors.name) : undefined;
  // `{tel}` 보간 — reservationCheck.errors.* 의 not_found·ratelimit·infra·server 가 예약·상담 전화를 부른다(P6-6 감사 R-6). 원장 값은 서버 페이지가 prop 으로 준다.
  // 방금 누른 제출의 안내(토큰 없음)가 지난 서버 결과보다 먼저다.
  const serverMessage = clientNotice ? tRoot(clientNotice, { tel: tel.display }) : result && !result.ok ? tRoot(result.messageKey, { tel: tel.display }) : null;
  const hasAlert = Boolean(serverMessage || phoneErr || nameErr);

  const onPhoneChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhoneInput(e.target.value));
    if (clientErrors.phone) setClientErrors((prev) => ({ ...prev, phone: undefined }));
  };
  const onNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    if (clientErrors.name) setClientErrors((prev) => ({ ...prev, name: undefined }));
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    const errs = validateCheckForm({ phone, name });
    if (errs.phone || errs.name) {
      e.preventDefault();
      setClientErrors(errs);
      setClientNotice(null);
      (errs.phone ? phoneRef : nameRef).current?.focus();
      return;
    }
    setClientErrors({});
    // 위젯이 아직 토큰을 넣지 않았으면 서버에 보내지 않는다 — 보내 봐야 turnstile 거부다.
    if (usesWidget) {
      const token = new FormData(e.currentTarget).get(CG.turnstile);
      if (typeof token !== "string" || token.length === 0) {
        e.preventDefault();
        setClientNotice(CHECK_ERROR_KEYS.turnstile);
        liveRef.current?.focus();
        return;
      }
    }
    setClientNotice(null);
  };

  return (
    <form className={q.card} action={formAction} onSubmit={onSubmit} noValidate data-testid="reservation-check-form" data-pending={pending}>
      {/* 화면 로케일(P7-4) — 결과 카드의 지명·차종을 이 언어로. 조회 조건과 무관하다(lib/reservation-check/formData.ts formDataToCheckLocale). */}
      <input type="hidden" name={CL} value={locale === "en" ? "en" : "ko"} />
      {/* 허니팟 — 사람은 보지도 포커스하지도 못한다. 채워지면 서버가 not_found 와 같은 응답을 돌려준다. */}
      <div className={q.hp} aria-hidden="true">
        <label htmlFor={id("website")}>Website</label>
        <input id={id("website")} type="text" name={CG.website} tabIndex={-1} autoComplete="off" aria-hidden="true" defaultValue="" />
      </div>

      <p className={s.legacyNote} data-testid="reservation-check-legacy-note">
        {t("form.legacyCodeNote")}
      </p>

      <div
        ref={liveRef}
        className={`${q.live} ${s.alertFocus}`}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        tabIndex={-1}
        data-testid="reservation-check-live"
      >
        {hasAlert ? (
          <>
            <p className={q.liveTitle}>{t("form.errorSummary")}</p>
            {serverMessage ? (
              <p className={q.liveList} data-testid="reservation-check-server-error">
                {serverMessage}
              </p>
            ) : null}
            {phoneErr || nameErr ? (
              <ul className={q.liveList}>
                {phoneErr ? <li>{phoneErr}</li> : null}
                {nameErr ? <li>{nameErr}</li> : null}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>

      <div className={s.fields}>
        <div className={q.field} data-field={CF.phone}>
          <label className={q.flabel} htmlFor={id("phone")}>
            {t("form.phoneLabel")} <span className={q.req}>{t("form.required")}</span>
          </label>
          <p className={q.fhint} id={id("hint-phone")}>
            {t("form.phoneHint")}
          </p>
          <input
            ref={phoneRef}
            id={id("phone")}
            className={q.control}
            type="tel"
            name={CF.phone}
            value={phone}
            onChange={onPhoneChange}
            inputMode="tel"
            autoComplete="tel"
            aria-invalid={phoneErr ? true : undefined}
            aria-describedby={phoneErr ? `${id("hint-phone")} ${id("err-phone")}` : id("hint-phone")}
            data-testid="reservation-check-phone"
          />
          {phoneErr ? (
            <p className={q.err} id={id("err-phone")} data-testid="reservation-check-error-phone">
              {phoneErr}
            </p>
          ) : null}
        </div>

        <div className={q.field} data-field={CF.name}>
          <label className={q.flabel} htmlFor={id("name")}>
            {t("form.nameLabel")} <span className={q.req}>{t("form.required")}</span>
          </label>
          <p className={q.fhint} id={id("hint-name")}>
            {t("form.nameHint")}
          </p>
          <input
            ref={nameRef}
            id={id("name")}
            className={q.control}
            type="text"
            name={CF.name}
            value={name}
            onChange={onNameChange}
            autoComplete="name"
            maxLength={NAME_MAX_LENGTH}
            aria-invalid={nameErr ? true : undefined}
            aria-describedby={nameErr ? `${id("hint-name")} ${id("err-name")}` : id("hint-name")}
            data-testid="reservation-check-name"
          />
          {nameErr ? (
            <p className={q.err} id={id("err-name")} data-testid="reservation-check-error-name">
              {nameErr}
            </p>
          ) : null}
        </div>
      </div>

      {usesWidget ? (
        <div className={s.security} data-testid="reservation-check-security" aria-label={t("form.security")}>
          {notReady ? (
            <div className={q.notReady} role="status" data-testid="reservation-check-not-ready">
              <strong>{t("form.notReadyTitle")}</strong>
              <p>{t("form.notReadyBody", { tel: tel.display })}</p>
            </div>
          ) : (
            <TurnstileWidget siteKey={turnstileSiteKey} action={turnstileAction} resetKey={turnstileResetKey} />
          )}
        </div>
      ) : null}

      <p className={s.help}>
        {t("form.help", { tel: tel.display })} <a href={tel.href}>{tel.display}</a>
      </p>

      <div className={s.submitRow}>
        <button type="submit" className={`${q.btn} ${q.btnSubmit}`} disabled={pending || notReady} data-testid="reservation-check-submit">
          {pending ? t("form.submitting") : t("form.submit")}
        </button>
      </div>
    </form>
  );
}

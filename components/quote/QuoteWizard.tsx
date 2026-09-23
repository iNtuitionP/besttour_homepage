"use client";

/**
 * 견적 신청 위저드 — 6단계 상태 컴포넌트 (P3-4 · 목업 wizard-b.html 이식 · ADR-6).
 *
 * 상태: useReducer(wizard-state.ts). 단계마다 서버를 부르지 않는다 — 제출은 6단계에서 한 번.
 *   - URL 이 단계를 갖는다(?step=N): 다음/이전은 history.pushState(뒤로가기 동작), 초기 정리는 replaceState. Next 라우터가
 *     pushState/replaceState 를 가로채 useSearchParams 를 갱신하므로 popstate 는 searchParams 변화로 감지한다(서버 왕복 0).
 *   - 초안은 sessionStorage(draft.ts) — 개인정보 포함이라 탭을 닫으면 사라져야 한다. 동의 2종·단계는 저장하지 않는다.
 *   - 프리필(?origin=&dest=&date=&pax=&vehicle=)은 첫 마운트에서 한 번 읽고 URL 에서 지운다.
 *   - 제출: <form action={formAction}> + useActionState. **서버액션 시그니처는 (formData) 하나**라 (_prev, fd) 래퍼로 감싼다
 *     (P3-3 독립 리뷰 M3 — submitReservation 을 직접 넘기면 prevState 가 첫 인자가 되어 항상 validation 이 돌아온다).
 *   - 폼 필드: 계약표(fields.ts F/G)의 이름만. 파생 5종(departAtLocal·returnAtLocal·phone·phoneIntl·locale)은 toFormValues 로 hidden,
 *     나머지는 같은 이름의 네이티브 컨트롤이 낸다. 숨은 단계의 입력도 DOM 에 있으므로 제출에 함께 실린다.
 *   - fail-closed UI: formToken 이 null(시크릿 없음) 이거나 Turnstile 사이트키가 없으면 "접수 준비 중" 안내 + 제출 disabled.
 *   - 개발 프리뷰(?previewSubmit=): 서버액션 대신 mock 결과 3종(preview-submit.ts). production 에서는 page.tsx 가 null 을 내린다.
 * 한글 리터럴·원장 import 없음 — 문구는 messages/ko.json quote.*, 법정 문구는 서버 페이지가 props(consent·withdrawalNotice)로 넣는다.
 */
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { submitReservation } from "@/actions/reservation";
import { useRouter } from "@/i18n/navigation";
import type { ContactPhone } from "@/lib/contact-phone";
import { toKstDateString } from "@/lib/kst";
import type { SubmitResult } from "@/lib/reservations/submitResult";

import type { ConsentText } from "./ConsentBlock";
import { clearDraft, loadDraft, saveDraft, sessionStorageOrNull } from "./draft";
import { F, G } from "./fields";
import { hasPrefill, parsePrefill, stripPrefillParams } from "./prefill";
import { previewSubmitAction, type PreviewSubmitMode } from "./preview-submit";
import s from "./quote.module.css";
import { Step1Purpose } from "./Step1Purpose";
import { Step2Vehicle } from "./Step2Vehicle";
import { Step3Route } from "./Step3Route";
import { Step4Schedule } from "./Step4Schedule";
import { Step5Options } from "./Step5Options";
import { Step6Contact } from "./Step6Contact";
import type { WizardVehicle } from "./step-props";
import { isIntakeReady, submitBlock } from "./submit-gate";
import { TurnstileWidget } from "./TurnstileWidget";
import {
  clampStep,
  INITIAL_STATE,
  reducer,
  STEP_COUNT,
  STEP_KEYS,
  stepForField,
  toFormValues,
  validateAll,
  validateStep,
  type FieldError,
  type Step,
} from "./wizard-state";

export interface QuoteWizardProps {
  locale: string;
  vehicles: readonly WizardVehicle[];
  /** 서버가 요청마다 만든 타임트랩 토큰. null = 시크릿 없음 → 제출 닫힘. */
  formToken: string | null;
  /** NEXT_PUBLIC_TURNSTILE_SITE_KEY. "" = 위젯 대신 안내 + 제출 닫힘. */
  turnstileSiteKey: string;
  turnstileAction: string;
  consent: ConsentText;
  /** 서버 컴포넌트 <WithdrawalNotice /> — 제출 버튼 바로 위에 놓인다. */
  withdrawalNotice: ReactNode;
  /** 청약철회 제한 확인 체크박스 라벨 — ledgerUi(locale).consent.withdrawal (ko 원장 consentLabel · en 원장 consentLabelEn). */
  withdrawalConsentLabel: string;
  /** 예약·상담 전화(P1-7) — "접수 준비 중" 안내·서버 오류 문구의 전화 폴백. 표시는 로케일별, 링크는 E.164. */
  tel: ContactPhone;
  previewSubmit: PreviewSubmitMode | null;
}

const SERVER_KEY_PREFIX = "reservation.";

function stepParam(): Step {
  return clampStep(new URLSearchParams(window.location.search).get("step"));
}

export function QuoteWizard({
  locale,
  vehicles,
  formToken,
  turnstileSiteKey,
  turnstileAction,
  consent,
  withdrawalNotice,
  withdrawalConsentLabel,
  tel,
  previewSubmit,
}: QuoteWizardProps) {
  const t = useTranslations("quote");
  const tRoot = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const idPrefix = useId();

  const [state, dispatch] = useReducer(reducer, searchParams, (sp) => ({ ...INITIAL_STATE, step: clampStep(sp?.get("step")) }));
  const [initialized, setInitialized] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [minDate, setMinDate] = useState("");

  const pushRef = useRef(false);
  const stepRef = useRef<Step>(state.step);
  stepRef.current = state.step;
  const prevStepRef = useRef<Step>(state.step);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const storage = useMemo(() => sessionStorageOrNull(), []);

  const [result, formAction, pending] = useActionState<SubmitResult | null, FormData>(
    async (_prev, fd) => (previewSubmit ? previewSubmitAction(previewSubmit)(fd) : submitReservation(fd)),
    null,
  );

  const values = toFormValues(state, locale);
  const ready = isIntakeReady(formToken, turnstileSiteKey);
  const block = submitBlock({
    formToken,
    siteKey: turnstileSiteKey,
    privacyConsent: state.privacyConsent,
    withdrawalConsent: state.withdrawalConsent,
    pending,
  });

  // `{tel}` 보간 — reservation.errors.* 의 ratelimit·infra·server 가 예약·상담 전화를 부른다. 예전에는 카탈로그에 번호가
  // 리터럴로 박혀 있었고(P6-6 감사 R-6), 번호가 바뀌면 조용히 뒤처졌다. 원장 값은 서버 페이지가 prop 으로 준다.
  // 필드 오류(quote.*)에는 {tel} 이 없지만 ICU 는 쓰이지 않는 인자를 무시하므로 한 갈래로 둔다.
  const resolve = useCallback(
    (key: string) => (key.startsWith(SERVER_KEY_PREFIX) ? tRoot(key, { tel: tel.display }) : t(key)),
    [t, tRoot, tel.display],
  );
  const errorFor = useCallback(
    (field: string) => {
      const hit = errors.find((e) => e.field === field);
      return hit ? resolve(hit.messageKey) : undefined;
    },
    [errors, resolve],
  );

  // 입력 컨트롤을 먼저, 없을 때만 버튼(토글)으로 — 연락처 칸처럼 토글 버튼이 입력보다 앞에 있는 필드에서 입력이 포커스를 받게.
  const focusField = useCallback((field: string) => {
    window.setTimeout(() => {
      const root = formRef.current;
      if (!root) return;
      const scope = `[data-field="${field}"]`;
      const el =
        root.querySelector<HTMLElement>(`${scope} input:not([type="hidden"]), ${scope} select, ${scope} textarea`) ??
        root.querySelector<HTMLElement>(`${scope} button`);
      el?.focus();
    }, 0);
  }, []);

  const jumpTo = useCallback((step: Step) => {
    pushRef.current = true;
    dispatch({ type: "goto", step });
  }, []);

  // ── 마운트: 초안 + 프리필 → init, 프리필 파라미터는 URL 에서 제거 ─────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefilled = hasPrefill(params);
    dispatch({ type: "init", draft: loadDraft(storage), prefill: prefilled ? parsePrefill(params) : {} });
    if (prefilled) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${stripPrefillParams(window.location.search)}${window.location.hash}`);
    }
    setMinDate(toKstDateString(new Date()));
    setInitialized(true);
  }, [storage]);

  // ── 상태 단계 → URL (다음/이전은 push, 정리는 replace) ──────────────────────────────────────
  useEffect(() => {
    if (!initialized) return;
    if (stepParam() !== state.step) {
      const q = new URLSearchParams(window.location.search);
      q.set("step", String(state.step));
      const url = `${window.location.pathname}?${q.toString()}${window.location.hash}`;
      if (pushRef.current) window.history.pushState(window.history.state, "", url);
      else window.history.replaceState(window.history.state, "", url);
    }
    pushRef.current = false;
  }, [state.step, initialized]);

  // ── URL → 상태 단계 (뒤로가기/앞으로가기). searchParams 는 트리거, 값은 window.location 에서 읽는다 ──
  useEffect(() => {
    if (!initialized) return;
    const urlStep = stepParam();
    if (urlStep !== stepRef.current) {
      setErrors([]);
      dispatch({ type: "goto", step: urlStep });
    }
  }, [searchParams, initialized]);

  // ── 단계 전환: 제목으로 포커스 + 카드 상단으로 ─────────────────────────────────────────────
  useEffect(() => {
    if (prevStepRef.current === state.step) return;
    prevStepRef.current = state.step;
    formRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    headingRef.current?.focus({ preventScroll: true });
  }, [state.step]);

  // ── 초안 저장(동의·단계 제외) ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialized) saveDraft(storage, state);
  }, [state, initialized, storage]);

  // ── 서버 결과 ──────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!result) return;
    if (result.ok) {
      clearDraft(storage);
      router.replace(result.publicCode ? { pathname: "/quote/done", query: { code: result.publicCode } } : { pathname: "/quote/done" });
      return;
    }
    setServerError(resolve(result.messageKey));
    const fieldErrors = Object.entries(result.fieldErrors ?? {}).map(([field, messageKey]) => ({ field, messageKey }));
    if (fieldErrors.length > 0) {
      setErrors(fieldErrors);
      jumpTo(stepForField(fieldErrors[0].field));
      focusField(fieldErrors[0].field);
    }
    setTurnstileResetKey((k) => k + 1);
  }, [result, storage, router, resolve, jumpTo, focusField]);

  const goNext = () => {
    const errs = validateStep(state, state.step);
    if (errs.length > 0) {
      setErrors(errs);
      focusField(errs[0].field);
      return;
    }
    setErrors([]);
    setServerError(null);
    pushRef.current = true;
    dispatch({ type: "next" });
  };

  const goPrev = () => {
    setErrors([]);
    pushRef.current = true;
    dispatch({ type: "prev" });
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    const errs = validateAll(state);
    if (errs.length > 0) {
      e.preventDefault();
      setErrors(errs);
      jumpTo(stepForField(errs[0].field));
      focusField(errs[0].field);
      return;
    }
    if (block !== null) {
      e.preventDefault();
      return;
    }
    setErrors([]);
    setServerError(null);
  };

  // Enter 는 1~5단계에서 "다음"이다 — 폼 암묵 제출로 6단계 검증까지 튀지 않게.
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter" || state.step >= STEP_COUNT) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON") return;
    e.preventDefault();
    goNext();
  };

  // 현재 단계의 오류 문구 — 같은 문구는 한 번만, 서버 요약 문구와 같은 것은 빼고 낭독한다.
  const currentMessages = [
    ...new Set(
      errors
        .filter((e) => stepForField(e.field) === state.step)
        .map((e) => resolve(e.messageKey))
        .filter((m) => m !== serverError),
    ),
  ];
  const stepName = t(`steps.${STEP_KEYS[state.step - 1]}.name`);

  const security = ready ? (
    state.step === STEP_COUNT ? (
      <TurnstileWidget siteKey={turnstileSiteKey} action={turnstileAction} resetKey={turnstileResetKey} />
    ) : null
  ) : (
    <div className={s.notReady} role="status" data-testid="quote-not-ready">
      <strong>{t("steps.contact.notReadyTitle")}</strong>
      <p>{t("steps.contact.notReadyBody", { tel: tel.display })}</p>
      <p>
        <a href={tel.href}>
          {t("steps.contact.call")} {tel.display}
        </a>
      </p>
    </div>
  );

  return (
    <div data-testid="quote-wizard" data-step={state.step} data-ready={ready}>
      <nav className={s.progress} aria-label={t("progressLabel")}>
        <div className={s.pbar} aria-hidden="true">
          <span className={s.pbarFill} style={{ width: `${(state.step / STEP_COUNT) * 100}%` }} />
        </div>
        <ol className={s.psteps}>
          {STEP_KEYS.map((key, i) => {
            const n = (i + 1) as Step;
            const cls = n === state.step ? `${s.pstep} ${s.pstepCurrent}` : n < state.step ? `${s.pstep} ${s.pstepDone}` : s.pstep;
            return (
              <li key={key} className={cls} aria-current={n === state.step ? "step" : undefined}>
                <span className={s.num} aria-hidden="true">
                  {n}
                </span>
                <span className={s.lbl}>{t(`steps.${key}.name`)}</span>
              </li>
            );
          })}
        </ol>
        <p className={s.pnow} aria-live="polite">
          {t("progressNow", { n: String(state.step), total: String(STEP_COUNT), name: stepName })}
        </p>
      </nav>

      <form ref={formRef} className={s.card} action={formAction} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate data-testid="quote-form">
        <input type="hidden" name={F.locale} value={String(values.locale)} />
        <input type="hidden" name={G.formToken} value={formToken ?? ""} />
        <input type="hidden" name={F.departAtLocal} value={String(values.departAtLocal)} />
        <input type="hidden" name={F.returnAtLocal} value={String(values.returnAtLocal)} />
        <input type="hidden" name={F.phone} value={String(values.phone)} />
        <input type="hidden" name={F.phoneIntl} value={String(values.phoneIntl)} />
        {/* 허니팟 — 사람은 보지도 포커스하지도 못한다. 채워지면 서버가 조용한 가짜 성공을 돌려준다. */}
        <div className={s.hp} aria-hidden="true">
          <label htmlFor={`${idPrefix}-website`}>Website</label>
          <input id={`${idPrefix}-website`} type="text" name={G.website} tabIndex={-1} autoComplete="off" aria-hidden="true" defaultValue="" />
        </div>

        <div className={s.live} role="alert" aria-live="assertive" aria-atomic="true" data-testid="quote-live">
          {serverError || currentMessages.length > 0 ? (
            <>
              <p className={s.liveTitle}>{t("errorSummary")}</p>
              {serverError ? <p className={s.liveList}>{serverError}</p> : null}
              {currentMessages.length > 0 ? (
                <ul className={s.liveList}>
                  {currentMessages.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>

        <Step1Purpose state={state} dispatch={dispatch} active={state.step === 1} headingRef={headingRef} errorFor={errorFor} idPrefix={idPrefix} />
        <Step2Vehicle state={state} dispatch={dispatch} active={state.step === 2} headingRef={headingRef} errorFor={errorFor} idPrefix={idPrefix} vehicles={vehicles} />
        <Step3Route state={state} dispatch={dispatch} active={state.step === 3} headingRef={headingRef} errorFor={errorFor} idPrefix={idPrefix} />
        <Step4Schedule
          state={state}
          dispatch={dispatch}
          active={state.step === 4}
          headingRef={headingRef}
          errorFor={errorFor}
          idPrefix={idPrefix}
          vehicles={vehicles}
          minDate={minDate}
        />
        <Step5Options state={state} dispatch={dispatch} active={state.step === 5} headingRef={headingRef} errorFor={errorFor} idPrefix={idPrefix} />
        <Step6Contact
          state={state}
          dispatch={dispatch}
          active={state.step === 6}
          headingRef={headingRef}
          errorFor={errorFor}
          idPrefix={idPrefix}
          consent={consent}
          withdrawalNotice={withdrawalNotice}
          withdrawalConsentLabel={withdrawalConsentLabel}
          security={security}
        />

        <div className={s.navbar}>
          {state.step === STEP_COUNT && block === "consent" ? (
            <p className={s.navHint} id={`${idPrefix}-submit-hint`}>
              {t("steps.contact.consentRequired")}
            </p>
          ) : null}
          {state.step > 1 ? (
            <button type="button" className={`${s.btn} ${s.btnPrev}`} onClick={goPrev} data-testid="quote-prev">
              {t("nav.prev")}
            </button>
          ) : null}
          <span className={s.spacer} />
          {state.step < STEP_COUNT ? (
            <button type="button" className={`${s.btn} ${s.btnNext}`} onClick={goNext} data-testid="quote-next">
              {t("nav.next")}
            </button>
          ) : (
            <button
              type="submit"
              className={`${s.btn} ${s.btnSubmit}`}
              disabled={block !== null}
              aria-describedby={block === "consent" ? `${idPrefix}-submit-hint` : undefined}
              data-testid="quote-submit"
              data-block={block ?? undefined}
            >
              {pending ? t("steps.contact.submitting") : t("steps.contact.submit")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

"use client";

/**
 * 예약확인 폼 — 접수번호 + 휴대폰 뒷 4자리 (P6-3a · P3-4 위저드와 같은 폼 규약).
 *
 *   - 제출: <form action={formAction}> + useActionState. **서버액션 시그니처는 (formData) 하나**라 (_prev, fd) 래퍼로 감싼다
 *     (P3-3 독립 리뷰 M3 — checkReservation 을 직접 넘기면 prevState 가 첫 인자가 되어 항상 validation 이 돌아온다).
 *   - 입력은 controlled — React 19 는 액션이 끝나면 비제어 폼을 reset 하므로, not_found 뒤에도 방금 친 값이 남아 있게 상태로 든다.
 *   - 사전 검증(validate.ts)은 왕복 없이 형식 오류를 바로 보여 주는 거울일 뿐 — 서버 zod 가 진짜 관문이다.
 *   - 오류는 role="alert" 요약 + 필드 aria-invalid/aria-describedby. pending 시 버튼 disabled. 허니팟 `website` 는 P3-4 와 동일 처리.
 *   - 포커스: 클라이언트 검증 실패는 첫 오류 입력으로, **서버 오류 결과(not_found·ratelimit·infra·server·validation)는 요약(role=alert, tabIndex -1)으로**
 *     옮긴다 — pending 동안 disabled 된 버튼에서 떨어진 포커스가 body 에 남지 않게(리뷰 M-2, WCAG 2.4.3).
 *   - 성공 시 폼 대신 ReservationCard 를 그린다. "다른 예약 조회"는 key 를 올려 라운드를 새로 시작한다(useActionState 상태 초기화).
 *   - 개발 프리뷰(?previewResult=): 서버액션 대신 mock 결과 3종(preview-result.ts). production 에서는 page.tsx 가 null 을 내린다.
 * 한글 리터럴·원장 import 없음 — 문구는 messages/ko.json reservationCheck.*, 법정 문구·예약·상담 전화는 서버 페이지가 props 로 넣는다.
 */
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { checkReservation } from "@/actions/reservation-check";
import type { ContactPhone } from "@/lib/contact-phone";
import type { CheckFieldErrors, CheckResult } from "@/lib/reservation-check/result";

import q from "@/components/quote/quote.module.css";
import s from "./check.module.css";
import { CF, CG } from "./fields";
import { previewCheckAction, type PreviewResultMode } from "./preview-result";
import { ReservationCard } from "./ReservationCard";
import { validateCheckForm } from "./validate";

export interface CheckFormProps {
  /** 원장 VERBATIM.bookingNotice — 결과 카드 하단. */
  bookingNotice: string;
  /** 예약·상담 전화(P1-7 — lib/contact-phone.ts) — 안내·전화 폴백. 표시는 로케일별, 링크는 E.164. */
  tel: ContactPhone;
  previewResult: PreviewResultMode | null;
}

const CODE_MAX_LENGTH = 8;
const LAST4_LENGTH = 4;

export function CheckForm(props: CheckFormProps) {
  const [round, setRound] = useState(0);
  return <CheckRound key={round} {...props} onAgain={() => setRound((r) => r + 1)} />;
}

function CheckRound({ bookingNotice, tel, previewResult, onAgain }: CheckFormProps & { onAgain: () => void }) {
  const t = useTranslations("reservationCheck");
  const tRoot = useTranslations();
  const idPrefix = useId();
  const id = (k: string) => `${idPrefix}-${k}`;

  const [code, setCode] = useState("");
  const [last4, setLast4] = useState("");
  const [clientErrors, setClientErrors] = useState<CheckFieldErrors>({});
  const codeRef = useRef<HTMLInputElement | null>(null);
  const last4Ref = useRef<HTMLInputElement | null>(null);
  const liveRef = useRef<HTMLDivElement | null>(null);

  const [result, formAction, pending] = useActionState<CheckResult | null, FormData>(
    async (_prev, fd) => (previewResult ? previewCheckAction(previewResult)(fd) : checkReservation(fd)),
    null,
  );

  // 서버 결과가 오류면 요약(role=alert)으로 포커스 — 클라이언트 검증 경로(onSubmit 의 focus())와 대칭. 훅은 아래 early return 앞에 있어야 한다.
  useEffect(() => {
    if (result && !result.ok) liveRef.current?.focus();
  }, [result]);

  if (result?.ok) {
    return <ReservationCard view={result.view} bookingNotice={bookingNotice} tel={tel} onAgain={onAgain} />;
  }

  const serverFieldErrors: CheckFieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const errors: CheckFieldErrors = { ...serverFieldErrors, ...clientErrors };
  const codeErr = errors.publicCode ? tRoot(errors.publicCode) : undefined;
  const last4Err = errors.phoneLast4 ? tRoot(errors.phoneLast4) : undefined;
  // `{tel}` 보간 — reservationCheck.errors.* 의 ratelimit·infra·server 가 예약·상담 전화를 부른다. 예전에는 카탈로그에
  // 번호가 리터럴로 박혀 있었고(P6-6 감사 R-6), 번호가 바뀌면 조용히 뒤처졌다. 원장 값은 서버 페이지가 prop 으로 준다.
  const serverMessage = result && !result.ok ? tRoot(result.messageKey, { tel: tel.display }) : null;
  const hasAlert = Boolean(serverMessage || codeErr || last4Err);

  const onCodeChange = (e: ChangeEvent<HTMLInputElement>) => {
    setCode(e.target.value.toUpperCase().replace(/\s+/g, "").slice(0, CODE_MAX_LENGTH));
    if (clientErrors.publicCode) setClientErrors((prev) => ({ ...prev, publicCode: undefined }));
  };
  const onLast4Change = (e: ChangeEvent<HTMLInputElement>) => {
    setLast4(e.target.value.replace(/\D/g, "").slice(0, LAST4_LENGTH));
    if (clientErrors.phoneLast4) setClientErrors((prev) => ({ ...prev, phoneLast4: undefined }));
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    const errs = validateCheckForm({ publicCode: code, phoneLast4: last4 });
    if (errs.publicCode || errs.phoneLast4) {
      e.preventDefault();
      setClientErrors(errs);
      (errs.publicCode ? codeRef : last4Ref).current?.focus();
      return;
    }
    setClientErrors({});
  };

  return (
    <form className={q.card} action={formAction} onSubmit={onSubmit} noValidate data-testid="reservation-check-form" data-pending={pending}>
      {/* 허니팟 — 사람은 보지도 포커스하지도 못한다. 채워지면 서버가 not_found 와 같은 응답을 돌려준다. */}
      <div className={q.hp} aria-hidden="true">
        <label htmlFor={id("website")}>Website</label>
        <input id={id("website")} type="text" name={CG.website} tabIndex={-1} autoComplete="off" aria-hidden="true" defaultValue="" />
      </div>

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
            {codeErr || last4Err ? (
              <ul className={q.liveList}>
                {codeErr ? <li>{codeErr}</li> : null}
                {last4Err ? <li>{last4Err}</li> : null}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>

      <div className={s.fields}>
        <div className={q.field} data-field={CF.publicCode}>
          <label className={q.flabel} htmlFor={id("code")}>
            {t("form.codeLabel")} <span className={q.req}>{t("form.required")}</span>
          </label>
          <p className={q.fhint} id={id("hint-code")}>
            {t("form.codeHint")}
          </p>
          <input
            ref={codeRef}
            id={id("code")}
            className={`${q.control} ${s.codeInput}`}
            type="text"
            name={CF.publicCode}
            value={code}
            onChange={onCodeChange}
            placeholder={t("form.codePlaceholder")}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={CODE_MAX_LENGTH}
            aria-invalid={codeErr ? true : undefined}
            aria-describedby={codeErr ? `${id("hint-code")} ${id("err-code")}` : id("hint-code")}
            data-testid="reservation-check-code"
          />
          {codeErr ? (
            <p className={q.err} id={id("err-code")} data-testid="reservation-check-error-code">
              {codeErr}
            </p>
          ) : null}
        </div>

        <div className={q.field} data-field={CF.phoneLast4}>
          <label className={q.flabel} htmlFor={id("last4")}>
            {t("form.phoneLast4Label")} <span className={q.req}>{t("form.required")}</span>
          </label>
          <p className={q.fhint} id={id("hint-last4")}>
            {t("form.phoneLast4Hint")}
          </p>
          <input
            ref={last4Ref}
            id={id("last4")}
            className={q.control}
            type="text"
            name={CF.phoneLast4}
            value={last4}
            onChange={onLast4Change}
            inputMode="numeric"
            autoComplete="off"
            maxLength={LAST4_LENGTH}
            aria-invalid={last4Err ? true : undefined}
            aria-describedby={last4Err ? `${id("hint-last4")} ${id("err-last4")}` : id("hint-last4")}
            data-testid="reservation-check-last4"
          />
          {last4Err ? (
            <p className={q.err} id={id("err-last4")} data-testid="reservation-check-error-last4">
              {last4Err}
            </p>
          ) : null}
        </div>
      </div>

      <p className={s.help}>
        {t("form.help", { tel: tel.display })} <a href={tel.href}>{tel.display}</a>
      </p>

      <div className={s.submitRow}>
        <button type="submit" className={`${q.btn} ${q.btnSubmit}`} disabled={pending} data-testid="reservation-check-submit">
          {pending ? t("form.submitting") : t("form.submit")}
        </button>
      </div>
    </form>
  );
}

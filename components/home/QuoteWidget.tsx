"use client";

/**
 * 홈 히어로 견적 위젯 — **접수 경로의 입구** (P3-8 · 사용자 결정 2026-09-27: 6단계 위저드 폐지, 홈 간편 견적 하나).
 * (P6-10: 카피의 "1분"은 측정된 적 없는 소요시간 주장이라 뺐다 — 감사 R-5.)
 *
 * 출발지 · 도착지 · 출발일 · 도착일 · 인원 → [견적 신청하기].
 *   - 빈 칸·잘못된 칸이면 **그 자리에서** 안내하고 모달을 열지 않는다(components/quote/quick-quote.ts validateWidget).
 *   - 통과하면 모달(components/quote/QuickQuoteModal.tsx)을 연다 — 이름·연락처·동의 2종·Turnstile 은 모달 안에만 있다.
 *     이 위젯 자체는 개인정보를 받지 않는다.
 *   - 출발일을 고르면 도착일이 같은 날로 채워진다(비었거나 앞일 때만).
 *   - `id="quote"` — 대표 노선 카드·헤더 메뉴·옛 /quote 리디렉트가 `/#quote` 로 여기를 가리킨다.
 *   - 닫히면 여는 버튼으로, [수정]이면 첫 칸으로 포커스를 돌려준다.
 *   - 선택지·라벨·법정 문구(verbatim·동의·청약철회)는 서버 Hero 가 props 로 넣는다. 이 파일에 한글 리터럴·원장 import 없음.
 * 인천공항을 고르면 보이던 공항 안내 한 줄(목업 .quote__air)은 사장님 요청 12(2026-10-10)로 지웠다 — 목업과 다르다.
 * 버튼 아래 작은 안내 두 줄(목업 .quote__note — 결제 안내 · 접수 안내)도 사장님 요청 7(2026-10-10 · T2-2)로 지웠다 — 목업과 다르다.
 * 접수 안내 verbatim 은 모달의 제출 버튼 위와 완료 화면에서 보인다(legal.bookingNotice).
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { initialWidgetFields, validateWidget, withDepartDate, type FieldError, type WidgetField, type WidgetFields } from "@/components/quote/quick-quote";
import { QuickQuoteModal, type QuickQuoteLegal } from "@/components/quote/QuickQuoteModal";
import { toKstDateString } from "@/lib/kst";

import h from "./home.module.css";
import s from "./Hero.module.css";

export interface QuoteOption {
  value: string;
  label: string;
}
export interface QuoteGroup {
  label: string;
  options: QuoteOption[];
}
export interface QuoteWidgetLabels {
  widget: string;
  title: string;
  sub: string;
  origin: string;
  dest: string;
  date: string;
  returnDate: string;
  pax: string;
  cta: string;
}

export function QuoteWidget({
  labels,
  groups,
  defaults,
  locale,
  legal,
  turnstileSiteKey,
  turnstileAction,
}: {
  labels: QuoteWidgetLabels;
  groups: QuoteGroup[];
  defaults: { origin: string; dest: string };
  locale: string;
  legal: QuickQuoteLegal;
  turnstileSiteKey: string;
  turnstileAction: string;
}) {
  const tRoot = useTranslations();
  const id = useId();
  const [fields, setFields] = useState<WidgetFields>(() => initialWidgetFields(defaults));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [open, setOpen] = useState(false);
  // 날짜 하한(KST 오늘)은 마운트 뒤에 — 홈은 ISR 이라 HTML 에 구운 날짜는 낡는다(하이드레이션 불일치도 피한다).
  const [today, setToday] = useState("");
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  const originRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    setToday(toKstDateString(new Date()));
  }, []);

  const set = (field: WidgetField, value: string) => {
    setFields((f) => (field === "departDate" ? withDepartDate(f, value) : { ...f, [field]: value }));
    setErrors((errs) => errs.filter((e) => e.field !== field && !(field === "departDate" && e.field === "returnDate")));
  };

  const errorFor = (field: WidgetField) => {
    const hit = errors.find((e) => e.field === field);
    return hit ? tRoot(hit.messageKey) : undefined;
  };

  const onRequest = () => {
    const errs = validateWidget(fields, today || toKstDateString(new Date()));
    setErrors(errs);
    if (errs.length > 0) {
      const first = errs[0].field;
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    setOpen(true);
  };

  const onClose = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => ctaRef.current?.focus(), 0);
  }, []);
  const onEdit = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => originRef.current?.focus(), 0);
  }, []);
  const onWidgetErrors = useCallback((errs: FieldError[]) => setErrors(errs), []);
  // 접수 성공 — 칸을 처음 상태로(P3-8 리뷰 P2-11). 완료 화면을 닫고 버튼을 다시 눌러도 같은 내용이 또 접수되지 않는다.
  // 모달의 완료 화면은 칸 값을 쓰지 않으므로(조회 안내 문구뿐 — T2-5) 여기서 비워도 화면이 바뀌지 않는다.
  const onSubmitted = useCallback(() => {
    setFields(initialWidgetFields(defaults));
    setErrors([]);
  }, [defaults]);

  const labelOf = (code: string) => groups.flatMap((g) => g.options).find((o) => o.value === code)?.label ?? code;

  const renderOptions = () =>
    groups.map((g) => (
      <optgroup key={g.label} label={g.label}>
        {g.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </optgroup>
    ));

  const fieldBox = (field: WidgetField, label: string, control: ReactNode, wide = false) => {
    const err = errorFor(field);
    return (
      <div className={wide ? `${s.field} ${s.fieldWide}` : s.field} data-invalid={err ? "true" : undefined}>
        <label className={s.fieldLabel} htmlFor={`${id}-${field}`}>
          {label}
        </label>
        {control}
        {err ? (
          <p className={s.fieldErr} id={`${id}-${field}-err`} data-testid={`quote-err-${field}`}>
            {err}
          </p>
        ) : null}
      </div>
    );
  };
  const describedBy = (field: WidgetField) => (errorFor(field) ? `${id}-${field}-err` : undefined);
  const invalid = (field: WidgetField) => (errorFor(field) ? true : undefined);

  return (
    <aside className={s.quote} id="quote" aria-label={labels.widget} data-testid="quote-widget">
      <div className={s.quoteHd}>
        <h2 className={s.quoteTitle}>{labels.title}</h2>
        <p className={s.quoteSub}>{labels.sub}</p>
      </div>

      <div className={s.quoteForm}>
        {fieldBox(
          "originCode",
          labels.origin,
          <div className={`${s.ctrl} ${s.ctrlSelect}`}>
            <select
              ref={originRef}
              id={`${id}-originCode`}
              value={fields.originCode}
              onChange={(e) => set("originCode", e.target.value)}
              aria-invalid={invalid("originCode")}
              aria-describedby={describedBy("originCode")}
              data-testid="quote-origin"
            >
              {renderOptions()}
            </select>
          </div>,
        )}
        {fieldBox(
          "destinationCode",
          labels.dest,
          <div className={`${s.ctrl} ${s.ctrlSelect}`}>
            <select
              id={`${id}-destinationCode`}
              value={fields.destinationCode}
              onChange={(e) => set("destinationCode", e.target.value)}
              aria-invalid={invalid("destinationCode")}
              aria-describedby={describedBy("destinationCode")}
              data-testid="quote-dest"
            >
              {renderOptions()}
            </select>
          </div>,
        )}
        {fieldBox(
          "departDate",
          labels.date,
          <div className={s.ctrl}>
            <input
              id={`${id}-departDate`}
              type="date"
              min={today || undefined}
              value={fields.departDate}
              onChange={(e) => set("departDate", e.target.value)}
              aria-invalid={invalid("departDate")}
              aria-describedby={describedBy("departDate")}
              data-testid="quote-date"
            />
          </div>,
        )}
        {fieldBox(
          "returnDate",
          labels.returnDate,
          <div className={s.ctrl}>
            <input
              id={`${id}-returnDate`}
              type="date"
              min={fields.departDate || today || undefined}
              value={fields.returnDate}
              onChange={(e) => set("returnDate", e.target.value)}
              aria-invalid={invalid("returnDate")}
              aria-describedby={describedBy("returnDate")}
              data-testid="quote-return"
            />
          </div>,
        )}
        {fieldBox(
          "passengers",
          labels.pax,
          <div className={s.ctrl}>
            <input
              id={`${id}-passengers`}
              type="number"
              inputMode="numeric"
              min={1}
              max={900}
              step={1}
              value={fields.passengers}
              onChange={(e) => set("passengers", e.target.value)}
              aria-invalid={invalid("passengers")}
              aria-describedby={describedBy("passengers")}
              data-testid="quote-pax"
            />
          </div>,
          true,
        )}
      </div>

      <div className={s.quoteFoot}>
        <button
          ref={ctaRef}
          type="button"
          className={`${h.btnGold} ${h.btnBlock} ${h.btnLg}`}
          onClick={onRequest}
          aria-haspopup="dialog"
          data-testid="quote-cta"
        >
          {labels.cta}
        </button>
      </div>

      <QuickQuoteModal
        open={open}
        onClose={onClose}
        onEdit={onEdit}
        onWidgetErrors={onWidgetErrors}
        onSubmitted={onSubmitted}
        fields={fields}
        placeLabels={{ origin: labelOf(fields.originCode), dest: labelOf(fields.destinationCode) }}
        locale={locale}
        legal={legal}
        turnstileSiteKey={turnstileSiteKey}
        turnstileAction={turnstileAction}
      />
    </aside>
  );
}

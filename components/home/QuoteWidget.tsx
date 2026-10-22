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
 *   - OF3-A: 날짜 칸은 native `<input type="date">` 가 아니라 직접 만든 달력(components/ui/DatePicker.tsx) — 브라우저 언어와 무관하게 페이지 언어로 그린다.
 *   - OF3-G: 출발지·도착지는 두 단 선택(components/home/LocationSelect.tsx) — 시·도 → 시·군·구. 저장값은 코드 하나(lib/codes.ts pickedCode).
 *   - `id="quote"` — 대표 노선 카드·헤더 메뉴·옛 /quote 리디렉트가 `/#quote` 로 여기를 가리킨다.
 *   - 닫히면 여는 버튼으로, [수정]이면 첫 칸으로 포커스를 돌려준다.
 *   - 선택지·라벨·법정 문구(verbatim·동의·청약철회)는 서버 Hero 가 props 로 넣는다. 이 파일에 한글 리터럴·원장 import 없음.
 * 인천공항을 고르면 보이던 공항 안내 한 줄(목업 .quote__air)은 사장님 요청 12(2026-10-10)로 지웠다 — 목업과 다르다.
 * 버튼 아래 작은 안내 두 줄(목업 .quote__note — 결제 안내 · 접수 안내)도 사장님 요청 7(2026-10-10 · T2-2)로 지웠다 — 목업과 다르다.
 * 접수 안내 verbatim 은 모달의 제출 버튼 위와 완료 화면에서 보인다(legal.bookingNotice).
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { HOURS, hourClock, initialWidgetFields, validateWidget, withDepartDate, type FieldError, type WidgetField, type WidgetFields } from "@/components/quote/quick-quote";
import { QuickQuoteModal, type QuickQuoteLegal } from "@/components/quote/QuickQuoteModal";
import { DatePicker } from "@/components/ui/DatePicker";
import { isLocationCode, locationLabel } from "@/lib/codes";
import { toKstDateString } from "@/lib/kst";
import { publicDateLabels } from "@/lib/public-date";

import h from "./home.module.css";
import s from "./Hero.module.css";
import { LocationSelect } from "./LocationSelect";

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
  /** 출발 시각(필수) · 도착 시각(선택) 칸 라벨 — OF2-A. */
  departTime: string;
  returnTime: string;
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
  const tCommon = useTranslations("common");
  const dateLabels = publicDateLabels(tCommon.raw("dates"));
  const calendarLabels = {
    prev: tRoot("home.hero.widget.calendar.prevMonth"),
    next: tRoot("home.hero.widget.calendar.nextMonth"),
    // 틀({year}·{month}·{field})은 달력이 채운다 — next-intl 의 보간을 거치지 않도록 원문(raw)을 받는다.
    monthYear: tRoot.raw("home.hero.widget.calendar.monthYear") as string,
    dialog: tRoot.raw("home.hero.widget.calendar.dialog") as string,
  };
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
    // 출발일이 바뀌면 도착일 오류도, 출발 시각이 바뀌면 도착 시각 오류도 함께 걷는다(서로 비교하는 칸이다).
    setErrors((errs) =>
      errs.filter(
        (e) =>
          e.field !== field &&
          !(field === "departDate" && (e.field === "returnDate" || e.field === "returnHour")) &&
          !(field === "departHour" && e.field === "returnHour") &&
          !(field === "returnDate" && e.field === "returnHour"),
      ),
    );
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

  // 모달 요약의 장소 이름 — 시·도 묶음에 있으면 그 라벨, 아니면(시·군·구 · 대표 도시) 표시 라벨("경기 수원시").
  const labelOf = (code: string) =>
    groups.flatMap((g) => g.options).find((o) => o.value === code)?.label ?? (isLocationCode(code) ? locationLabel(code, locale) : code);
  const locationLabels = { sigungu: tRoot("home.hero.widget.sigungu"), all: tRoot("home.hero.widget.sigunguAll") };

  // 시각 선택지 — 빈 선택지 + 00:00~23:00(1시간 단위 · KST 벽시계). 표시는 언어와 무관한 24시간 표기라 카탈로그 문구가 없다.
  const renderHourOptions = (emptyLabel: string) => (
    <>
      <option value="">{emptyLabel}</option>
      {HOURS.map((hour) => (
        <option key={hour} value={hour}>
          {hourClock(hour)}
        </option>
      ))}
    </>
  );

  const fieldBox = (field: WidgetField, label: string, control: ReactNode, wide = false, time = false, date = false) => {
    const err = errorFor(field);
    const cls = [s.field, wide ? s.fieldWide : "", time ? s.fieldTime : "", date ? s.fieldDate : ""].filter(Boolean).join(" ");
    return (
      <div className={cls} data-invalid={err ? "true" : undefined}>
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
          <LocationSelect
            id={`${id}-originCode`}
            selectRef={originRef}
            fieldLabel={labels.origin}
            value={fields.originCode}
            onChange={(code) => set("originCode", code)}
            groups={groups}
            locale={locale}
            labels={locationLabels}
            invalid={invalid("originCode")}
            describedBy={describedBy("originCode")}
            testId="quote-origin"
          />,
        )}
        {fieldBox(
          "destinationCode",
          labels.dest,
          <LocationSelect
            id={`${id}-destinationCode`}
            fieldLabel={labels.dest}
            value={fields.destinationCode}
            onChange={(code) => set("destinationCode", code)}
            groups={groups}
            locale={locale}
            labels={locationLabels}
            invalid={invalid("destinationCode")}
            describedBy={describedBy("destinationCode")}
            testId="quote-dest"
          />,
        )}
        {fieldBox(
          "departDate",
          labels.date,
          <div className={s.ctrl}>
            <DatePicker
              id={`${id}-departDate`}
              value={fields.departDate}
              onChange={(v) => set("departDate", v)}
              min={today || undefined}
              today={today}
              placeholder={tRoot("home.hero.widget.calendar.placeholder")}
              fieldLabel={labels.date}
              labels={calendarLabels}
              dateLabels={dateLabels}
              invalid={invalid("departDate")}
              describedBy={describedBy("departDate")}
              testId="quote-date"
            />
          </div>,
          false,
          false,
          true,
        )}
        {fieldBox(
          "departHour",
          labels.departTime,
          <div className={`${s.ctrl} ${s.ctrlSelect}`}>
            <select
              id={`${id}-departHour`}
              value={fields.departHour}
              onChange={(e) => set("departHour", e.target.value)}
              aria-invalid={invalid("departHour")}
              aria-describedby={describedBy("departHour")}
              data-testid="quote-depart-hour"
            >
              {renderHourOptions(tRoot("home.hero.widget.timePlaceholder"))}
            </select>
          </div>,
          false,
          true,
        )}
        {fieldBox(
          "returnDate",
          labels.returnDate,
          <div className={s.ctrl}>
            <DatePicker
              id={`${id}-returnDate`}
              value={fields.returnDate}
              onChange={(v) => set("returnDate", v)}
              min={fields.departDate || today || undefined}
              today={today}
              placeholder={tRoot("home.hero.widget.calendar.placeholder")}
              fieldLabel={labels.returnDate}
              labels={calendarLabels}
              dateLabels={dateLabels}
              invalid={invalid("returnDate")}
              describedBy={describedBy("returnDate")}
              testId="quote-return"
            />
          </div>,
          false,
          false,
          true,
        )}
        {fieldBox(
          "returnHour",
          labels.returnTime,
          <div className={`${s.ctrl} ${s.ctrlSelect}`}>
            <select
              id={`${id}-returnHour`}
              value={fields.returnHour}
              onChange={(e) => set("returnHour", e.target.value)}
              disabled={fields.returnDate === ""}
              aria-invalid={invalid("returnHour")}
              aria-describedby={describedBy("returnHour")}
              data-testid="quote-return-hour"
            >
              {renderHourOptions(tRoot("home.hero.widget.timeNone"))}
            </select>
          </div>,
          false,
          true,
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

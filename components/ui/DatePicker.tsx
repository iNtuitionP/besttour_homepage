"use client";

/**
 * 직접 만든 달력 (OF3-A) — 견적 위젯의 출발일·도착일 칸.
 *
 * 왜 native `<input type="date">` 를 버렸나: 그 칸의 빈칸 표시·형식·팝업 달력은 **브라우저/OS 언어**를 따라서 `<html lang="en">` 을 무시한다
 * (한국어 브라우저로 /en 을 열면 "연도/월/일" 이 보였다). 이 달력은 **페이지 언어로만** 그린다.
 *   - 달·요일 이름은 전부 카탈로그(`common.dates`)에서 — 이 파일에 `Intl`·`toLocale*` 도, 한글 리터럴도 없다.
 *   - 날짜 계산은 UTC 순수 함수(calendar-math.ts) — 사용자 PC 시간대와 무관.
 *   - 값은 그대로 `YYYY-MM-DD` 문자열(KST 달력 날짜). 서버 계약·검증은 바뀌지 않는다.
 *
 * 동작: 칸(버튼)을 누르면 아래에 달력이 열린다. 날짜를 누르거나 Esc · 바깥 클릭 · 칸 버튼 다시 누름으로 닫힌다(포커스는 칸으로).
 * `min` 이전은 흐리게 · 누를 수 없음(aria-disabled). 이전 달 버튼은 `min` 이 든 달보다 앞으로 못 간다.
 * 키보드는 WAI-ARIA Date Picker Dialog 패턴: ← → 하루 · ↑ ↓ 일주일 · Home/End 주 시작/끝 · PageUp/PageDown 한 달 · Enter/Space 선택 · Esc 닫기.
 * 달력은 **열 때만** 그린다 — 닫힌 칸은 서버·클라이언트가 같은 출력이라 하이드레이션 불일치가 없다(`today` 는 마운트 뒤에 채워진다).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { formatPublicDate, type PublicDateLabels } from "@/lib/public-date";

import { addMonths, isBefore, monthGrid, nextFocus, parseYmd } from "./calendar-math";
import c from "./DatePicker.module.css";

export interface DatePickerLabels {
  /** 이전 달 버튼 */
  prev: string;
  /** 다음 달 버튼 */
  next: string;
  /** 머리글 틀 — "{month} {year}" / "{year}년 {month}월" */
  monthYear: string;
  /** 달력 이름 틀 — "Choose {field}" / "{field} 선택" */
  dialog: string;
}

export interface DatePickerProps {
  /** 칸 버튼의 id — 바깥 `<label htmlFor>` 가 이 id 로 붙는다. */
  id: string;
  /** `YYYY-MM-DD` 또는 "". */
  value: string;
  onChange: (value: string) => void;
  /** 이 날짜 이전은 고를 수 없다(`YYYY-MM-DD`). 비면 제한 없음. */
  min?: string;
  /** KST 오늘 — 오늘 표시(aria-current)와 처음 열 때의 위치. 마운트 뒤에 채워져도 된다. */
  today: string;
  placeholder: string;
  /** 칸 라벨(달력 이름 조립용 — 예: "Departure date"). */
  fieldLabel: string;
  labels: DatePickerLabels;
  dateLabels: PublicDateLabels;
  invalid?: boolean;
  describedBy?: string;
  testId?: string;
}

const POPUP_MAX_WIDTH = 320;
/** 화면 가장자리에서 떨어뜨릴 간격 — 375px 에서 좌우 16px. */
const VIEWPORT_GUTTER = 16;

function fill(tpl: string, values: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : `{${k}}`));
}

const isYmd = (v: string) => parseYmd(v) !== null;

// =============================================================================
// 달력 본체 — 상태 없는 표시 컴포넌트(열린 모습은 이것만 렌더해 테스트한다)
// =============================================================================

export interface CalendarPanelProps {
  /** 보이는 달 (month = 1~12). */
  view: { year: number; month: number };
  /** 로빙 tabindex 를 받는 날짜 — 포커스가 가는 칸. */
  focus: string;
  value: string;
  min?: string;
  today: string;
  fieldLabel: string;
  labels: DatePickerLabels;
  dateLabels: PublicDateLabels;
  onPick: (ymd: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  style?: CSSProperties;
}

export function CalendarPanel({ view, focus, value, min, today, fieldLabel, labels, dateLabels, onPick, onPrev, onNext, onKeyDown, style }: CalendarPanelProps) {
  const grid = monthGrid(view.year, view.month);
  // 이전 달 — min 이 든 달(없으면 오늘이 든 달)보다 앞으로는 못 간다
  const floor = parseYmd(min && isYmd(min) ? min : today);
  const prevDisabled = floor !== null && view.year * 12 + view.month <= floor.year * 12 + floor.month;
  const title = fill(labels.monthYear, { year: view.year, month: dateLabels.months[view.month - 1] ?? view.month });
  // 날짜 칸의 이름은 전체 표기 — 연도를 늘 붙이려고 "올해" 판정 기준(now)을 1900년으로 둔다(어느 해든 다르다).
  const fullDate = (ymd: string) => formatPublicDate(ymd, dateLabels, { style: "schedule", now: new Date(Date.UTC(1900, 0, 1)) }) ?? ymd;

  return (
    <div className={c.panel} role="dialog" aria-label={fill(labels.dialog, { field: fieldLabel.toLowerCase() })} onKeyDown={onKeyDown} style={style}>
      <div className={c.head}>
        <button type="button" className={c.nav} aria-label={labels.prev} disabled={prevDisabled} onClick={onPrev}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <p className={c.title} aria-live="polite">
          {title}
        </p>
        <button type="button" className={c.nav} aria-label={labels.next} onClick={onNext}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div role="grid" aria-label={title} className={c.grid}>
        <div role="row" className={c.row}>
          {dateLabels.weekdays.map((wd, i) => (
            <div key={i} role="columnheader" className={c.weekday}>
              {wd}
            </div>
          ))}
        </div>
        {grid.map((week) => (
          <div key={week[0]} role="row" className={c.row}>
            {week.map((ymd) => {
              const p = parseYmd(ymd)!;
              const disabled = isBefore(ymd, min);
              const selected = ymd === value;
              const classes = [c.day, p.month !== view.month ? c.dayOutside : "", ymd === today ? c.dayToday : ""].filter(Boolean).join(" ");
              return (
                <button
                  key={ymd}
                  type="button"
                  role="gridcell"
                  className={classes}
                  data-ymd={ymd}
                  tabIndex={ymd === focus ? 0 : -1}
                  aria-label={fullDate(ymd)}
                  aria-selected={selected}
                  aria-disabled={disabled ? true : undefined}
                  aria-current={ymd === today ? "date" : undefined}
                  onClick={() => onPick(ymd)}
                >
                  {p.day}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// 칸(버튼) + 열고 닫기
// =============================================================================

export function DatePicker({ id, value, onChange, min, today, placeholder, fieldLabel, labels, dateLabels, invalid, describedBy, testId }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ year: 0, month: 1 });
  const [focus, setFocus] = useState("");
  const [popup, setPopup] = useState<{ left: number; width: number }>({ left: 0, width: POPUP_MAX_WIDTH });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /** 다음 렌더 뒤에 포커스 날짜 칸으로 포커스를 옮길지 — 열 때와 키보드 이동에서만(이전·다음 달 버튼을 누를 때는 버튼에 둔다). */
  const moveFocus = useRef(false);

  const shown = isYmd(value) ? (formatPublicDate(value, dateLabels, { style: "schedule" }) ?? value) : "";

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const openCalendar = () => {
    // 처음 보이는 달: 값이 있으면 그 달 · 없으면 min(귀환일은 출발일의 달) · 아니면 오늘
    const base = [value, min ?? "", today].find((v) => v !== "" && isYmd(v));
    if (base === undefined) return;
    // 포커스: 선택일 · 없으면 오늘 · 비활성이면 첫 선택 가능일(min)
    let start = isYmd(value) ? value : isYmd(today) ? today : base;
    if (isBefore(start, min) && min !== undefined && isYmd(min)) start = min;
    const p = parseYmd(start)!;
    setView({ year: p.year, month: p.month });
    setFocus(start);
    moveFocus.current = true;
    setOpen(true);
  };

  const toggle = () => (open ? close(false) : openCalendar());

  const pick = (ymd: string) => {
    if (isBefore(ymd, min)) return;
    onChange(ymd);
    close(true);
  };

  const shiftMonth = (n: number) => {
    setView((v) => {
      const next = parseYmd(addMonths(`${String(v.year).padStart(4, "0")}-${String(v.month).padStart(2, "0")}-01`, n))!;
      return { year: next.year, month: next.month };
    });
    setFocus((f) => addMonths(f, n));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    const target = e.target as HTMLElement;
    const ymd = target.getAttribute("data-ymd");
    if (ymd === null || e.altKey || e.ctrlKey || e.metaKey) return;
    const to = nextFocus(ymd, e.key);
    if (to === null) return;
    e.preventDefault();
    const p = parseYmd(to)!;
    setView({ year: p.year, month: p.month });
    setFocus(to);
    moveFocus.current = true;
  };

  // 열렸을 때 · 키보드로 옮겼을 때 포커스 날짜 칸으로
  useEffect(() => {
    if (!open || !moveFocus.current) return;
    moveFocus.current = false;
    wrapRef.current?.querySelector<HTMLElement>(`[data-ymd="${focus}"]`)?.focus();
  }, [open, focus, view]);

  // 바깥을 누르거나 포커스가 밖으로 가면 닫는다 — 한 번에 달력 하나만 열린다(다른 칸을 누르면 이쪽이 닫힌다)
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (wrapRef.current && e.target instanceof Node && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("focusin", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("focusin", away);
    };
  }, [open]);

  // 화면 안에 들이기 — 좁은 화면에서도 좌우 16px 안쪽(가로 스크롤 0). 칸보다 왼쪽·오른쪽으로 밀릴 수 있다.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const vw = document.documentElement.clientWidth;
    const width = Math.min(POPUP_MAX_WIDTH, Math.max(0, vw - VIEWPORT_GUTTER * 2));
    const rect = wrapRef.current.getBoundingClientRect();
    const left = Math.min(Math.max(rect.left, VIEWPORT_GUTTER), Math.max(VIEWPORT_GUTTER, vw - VIEWPORT_GUTTER - width));
    setPopup({ left: left - rect.left, width });
  }, [open]);

  return (
    <div className={c.root} ref={wrapRef}>
      {/* aria-invalid 는 button 역할의 지원 속성이 아니지만, 옛 native 날짜 칸(input)이 갖고 있던 오류 표시를 그대로 이어 가려고 둔다(계획 §2-1). 이유는 aria-describedby 의 오류 문구가 맡는다. */}
      {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props */}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={c.trigger}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        data-testid={testId}
      >
        <span className={shown ? c.value : c.placeholder}>{shown || placeholder}</span>
        <svg className={c.icon} viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <rect x="3" y="4.5" width="14" height="12.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 8.5h14M7 2.5v3M13 2.5v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {open && view.year > 0 ? (
        <CalendarPanel
          view={view}
          focus={focus}
          value={value}
          min={min}
          today={today}
          fieldLabel={fieldLabel}
          labels={labels}
          dateLabels={dateLabels}
          onPick={pick}
          onPrev={() => shiftMonth(-1)}
          onNext={() => shiftMonth(1)}
          onKeyDown={onKeyDown}
          style={{ left: popup.left, width: popup.width }}
        />
      ) : null}
    </div>
  );
}

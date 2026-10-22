/**
 * OF3-A — 견적 위젯 날짜 칸을 직접 만든 달력으로 (플랜 OF3-datepicker-plan §1~§6).
 *
 * 잠그는 것
 *   1. calendar-math 순수 함수 — 격자 · 말일 보정 · 윤년 · 연 경계 · 시간대 독립(UTC 계산)
 *   2. nextFocus — 키보드 이동(←→ 하루 · ↑↓ 일주일 · Home/End · PageUp/PageDown)
 *   3. 렌더(en) — 닫힌 칸에 한글 0 · 열린 달력에 한글 0 · 달·요일 이름은 카탈로그에서 · 오늘 이전/출발일 이전 비활성
 *   4. 정적 잠금 — 위젯에 type="date" 0건 · DatePicker 에 Intl/toLocale 0건 · 색·간격은 역할 토큰만
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { CalendarPanel, DatePicker } from "@/components/ui/DatePicker";
import { addDays, addMonths, compareYmd, daysInMonth, isBefore, monthGrid, nextFocus, weekdayOf } from "@/components/ui/calendar-math";
import { publicDateLabels } from "@/lib/public-date";

import { stripComments } from "./helpers/strip-comments";

const HANGUL = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
type Catalog = { common: { dates: unknown }; home: { hero: { widget: { calendar: Record<string, string> } } } };
const ko = JSON.parse(read("messages/ko.json")) as Catalog;
const en = JSON.parse(read("messages/en.json")) as Catalog;

describe("1. calendar-math — UTC 순수 계산", () => {
  test("2026-10 격자 — 6주 × 7일, 첫 칸은 일요일 9/27, 마지막은 11/7", () => {
    const g = monthGrid(2026, 10);
    expect(g).toHaveLength(6);
    for (const week of g) expect(week).toHaveLength(7);
    expect(g[0][0]).toBe("2026-09-27");
    expect(g[0][4]).toBe("2026-10-01");
    expect(g[5][6]).toBe("2026-11-07");
    // 모든 줄의 첫 칸이 일요일
    for (const week of g) expect(weekdayOf(week[0])).toBe(0);
  });

  test("달의 길이 — 31일 · 30일 · 평년 2월 · 윤년 2월(2028-02-29)", () => {
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28); // 100 의 배수는 윤년이 아니다
    expect(monthGrid(2028, 2).flat()).toContain("2028-02-29");
  });

  test("addDays — 달·연 경계", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-15", 7)).toBe("2026-10-22");
  });

  test("addMonths — 말일 보정(1/31 + 1달 = 2/28 · 윤년 2/29) · 연 경계", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-10-15", 0)).toBe("2026-10-15");
  });

  test("compareYmd · isBefore", () => {
    expect(compareYmd("2026-10-14", "2026-10-15")).toBeLessThan(0);
    expect(compareYmd("2026-10-15", "2026-10-15")).toBe(0);
    expect(compareYmd("2027-01-01", "2026-12-31")).toBeGreaterThan(0);
    expect(isBefore("2026-10-14", "2026-10-15")).toBe(true);
    expect(isBefore("2026-10-15", "2026-10-15")).toBe(false);
    // min 이 없으면(빈 문자열 · undefined) 비활성이 없다
    expect(isBefore("1999-01-01", "")).toBe(false);
    expect(isBefore("1999-01-01", undefined)).toBe(false);
  });

  test("시간대 독립 — TZ 를 로스앤젤레스·도쿄로 바꿔도 같은 결과(UTC 로만 계산한다)", () => {
    const original = process.env.TZ;
    const sample = () => ({
      grid: monthGrid(2026, 10)[0],
      plus: addDays("2026-03-08", 1), // 미국 서머타임 시작일
      month: addMonths("2026-03-31", 1),
      wd: weekdayOf("2026-10-11"),
    });
    try {
      process.env.TZ = "Asia/Seoul";
      const seoul = sample();
      for (const tz of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
        process.env.TZ = tz;
        expect(sample(), tz).toEqual(seoul);
      }
      expect(seoul.plus).toBe("2026-03-09");
      expect(seoul.month).toBe("2026-04-30");
      expect(seoul.wd).toBe(0); // 2026-10-11 은 일요일
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("2. nextFocus — WAI-ARIA 날짜 선택 키 이동", () => {
  const at = "2026-10-15"; // 목요일
  test("← → 하루 · ↑ ↓ 일주일", () => {
    expect(nextFocus(at, "ArrowLeft")).toBe("2026-10-14");
    expect(nextFocus(at, "ArrowRight")).toBe("2026-10-16");
    expect(nextFocus(at, "ArrowUp")).toBe("2026-10-08");
    expect(nextFocus(at, "ArrowDown")).toBe("2026-10-22");
  });
  test("Home/End — 그 주의 일요일/토요일", () => {
    expect(nextFocus(at, "Home")).toBe("2026-10-11");
    expect(nextFocus(at, "End")).toBe("2026-10-17");
    expect(nextFocus("2026-10-11", "Home")).toBe("2026-10-11");
    expect(nextFocus("2026-10-17", "End")).toBe("2026-10-17");
  });
  test("PageUp/PageDown — 한 달(말일 보정)", () => {
    expect(nextFocus(at, "PageDown")).toBe("2026-11-15");
    expect(nextFocus(at, "PageUp")).toBe("2026-09-15");
    expect(nextFocus("2026-01-31", "PageDown")).toBe("2026-02-28");
  });
  test("달·연 경계를 넘는다", () => {
    expect(nextFocus("2026-10-31", "ArrowRight")).toBe("2026-11-01");
    expect(nextFocus("2026-12-31", "ArrowRight")).toBe("2027-01-01");
    expect(nextFocus("2026-11-01", "ArrowLeft")).toBe("2026-10-31");
  });
  test("다른 키는 null(가로채지 않는다)", () => {
    for (const key of ["a", "Tab", "Enter", " ", "Escape", "Shift"]) expect(nextFocus(at, key), key).toBeNull();
  });
});

// ── 렌더 ─────────────────────────────────────────────────────────────────────
const enLabels = publicDateLabels(en.common.dates);
const koLabels = publicDateLabels(ko.common.dates);
const cal = en.home.hero.widget.calendar;
const calKo = ko.home.hero.widget.calendar;

const noop = () => {};
const panelProps = (over: Record<string, unknown> = {}) => ({
  view: { year: 2026, month: 10 },
  focus: "2026-10-15",
  value: "",
  min: "2026-10-15",
  today: "2026-10-15",
  fieldLabel: "Departure date",
  labels: { prev: cal.prevMonth, next: cal.nextMonth, monthYear: cal.monthYear, dialog: cal.dialog },
  dateLabels: enLabels,
  onPick: noop,
  onPrev: noop,
  onNext: noop,
  onKeyDown: noop,
  ...over,
});
const panel = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(CalendarPanel, panelProps(over) as never));

/** `<button …>` 태그 한 줄씩. */
const dayButtons = (html: string) => [...html.matchAll(/<button\b[^>]*data-ymd="([^"]+)"[^>]*>/g)].map((m) => ({ ymd: m[1], tag: m[0] }));
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

describe("3. 렌더(en) — 브라우저 언어와 무관하게 페이지 언어로만", () => {
  const closed = (value: string, over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(DatePicker, {
        id: "q-departDate",
        value,
        onChange: noop,
        min: "2026-10-15",
        today: "2026-10-15",
        placeholder: cal.placeholder,
        fieldLabel: "Departure date",
        labels: { prev: cal.prevMonth, next: cal.nextMonth, monthYear: cal.monthYear, dialog: cal.dialog },
        dateLabels: enLabels,
        testId: "quote-date",
        ...over,
      } as never),
    );

  test("닫힌 칸(값 없음) — 버튼 · Select date · 한글 0 · testid · 라벨 연결용 id · 달력은 그리지 않는다", () => {
    const html = closed("");
    expect(html).toMatch(/<button[^>]*id="q-departDate"/);
    expect(html).toMatch(/<button[^>]*data-testid="quote-date"/);
    expect(html).toContain("Select date");
    expect(html).toMatch(/aria-haspopup="dialog"/);
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).not.toMatch(/role="dialog"/);
    expect(html).not.toMatch(HANGUL);
  });

  test("닫힌 칸(값 있음) — 기존 포매터와 같은 표기(올해가 아니면 연도 포함) · 한글 0", () => {
    const html = closed("2026-10-11");
    // 올해(=지금 KST 의 해)가 2026 이면 "Sun, Oct 11", 아니면 "Sun, Oct 11, 2026" — 둘 다 이 부분 문자열을 갖는다
    expect(html).toContain("Sun, Oct 11");
    expect(html).not.toContain("Select date");
    expect(html).not.toMatch(HANGUL);
  });

  test("오류 상태 — aria-invalid · aria-describedby 가 버튼에 붙는다", () => {
    const html = closed("", { invalid: true, describedBy: "q-departDate-err" });
    expect(html).toMatch(/aria-invalid="true"/);
    expect(html).toMatch(/aria-describedby="q-departDate-err"/);
  });

  test("열린 달력 — 머리글 'Oct 2026' · Sun…Sat · 한글 0 · dialog/grid 역할", () => {
    const html = panel();
    expect(html).toContain("Oct 2026");
    for (const wd of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) expect(html, wd).toContain(wd);
    expect(html).toMatch(/role="dialog"/);
    expect(html).toMatch(/aria-label="Choose departure date"/);
    expect(html).toMatch(/role="grid"/);
    expect(html).toContain("Previous month");
    expect(html).toContain("Next month");
    expect(html).not.toMatch(HANGUL);
  });

  test("오늘 이전은 aria-disabled=true · 오늘은 aria-current=date · 오늘 이후는 활성", () => {
    const buttons = dayButtons(panel());
    expect(buttons).toHaveLength(42);
    const by = Object.fromEntries(buttons.map((b) => [b.ymd, b.tag]));
    for (const d of ["2026-09-27", "2026-10-01", "2026-10-14"]) expect(attr(by[d], "aria-disabled"), d).toBe("true");
    for (const d of ["2026-10-15", "2026-10-16", "2026-10-31", "2026-11-07"]) expect(attr(by[d], "aria-disabled"), d).toBeUndefined();
    expect(attr(by["2026-10-15"], "aria-current")).toBe("date");
    expect(attr(by["2026-10-16"], "aria-current")).toBeUndefined();
  });

  test("귀환일 달력 — 출발일 이전이 비활성(min=출발일)", () => {
    const by = Object.fromEntries(dayButtons(panel({ min: "2026-10-20", value: "2026-10-22", focus: "2026-10-22" })).map((b) => [b.ymd, b.tag]));
    expect(attr(by["2026-10-19"], "aria-disabled")).toBe("true");
    expect(attr(by["2026-10-20"], "aria-disabled")).toBeUndefined();
    expect(attr(by["2026-10-22"], "aria-selected")).toBe("true");
    expect(attr(by["2026-10-21"], "aria-selected")).toBe("false");
  });

  test("선택일은 aria-selected 표식 · 로빙 tabindex(포커스 칸만 0) · 날짜 칸 라벨은 전체 표기(한글 0)", () => {
    const html = panel({ value: "2026-10-22", focus: "2026-10-22" });
    const buttons = dayButtons(html);
    const zero = buttons.filter((b) => attr(b.tag, "tabindex") === "0").map((b) => b.ymd);
    expect(zero).toEqual(["2026-10-22"]);
    expect(html).toMatch(/aria-selected="true"/);
    const label = attr(buttons.find((b) => b.ymd === "2026-10-22")!.tag, "aria-label")!;
    expect(label).toContain("Oct 22");
    expect(label).toContain("2026");
    expect(label).not.toMatch(HANGUL);
  });

  test("이전 달 버튼 — 보이는 달이 min 의 달이면 비활성, 다음 달로 가면 활성", () => {
    const first = panel();
    expect(first).toMatch(/<button[^>]*aria-label="Previous month"[^>]*disabled=""/);
    const next = panel({ view: { year: 2026, month: 11 }, focus: "2026-11-02" });
    expect(next).not.toMatch(/<button[^>]*aria-label="Previous month"[^>]*disabled=""/);
    expect(next).toContain("Nov 2026");
  });

  test("ko 틀 — '2026년 10월' · 일…토", () => {
    const html = panel({
      dateLabels: koLabels,
      labels: { prev: calKo.prevMonth, next: calKo.nextMonth, monthYear: calKo.monthYear, dialog: calKo.dialog },
      fieldLabel: "출발일",
    });
    expect(html).toContain("2026년 10월");
    for (const wd of ["일", "월", "화", "수", "목", "금", "토"]) expect(html, wd).toContain(`>${wd}<`);
    expect(html).toContain("출발일 선택");
  });
});

describe("4. 정적 잠금", () => {
  test("QuoteWidget 에 type=\"date\" 0건 · DatePicker 사용", () => {
    const rel = "components/home/QuoteWidget.tsx";
    const src = stripComments(read(rel), rel); // 주석 속 설명("type=date 를 버렸다")은 세지 않는다
    expect(src).not.toMatch(/type=["']date["']/);
    expect(src).toMatch(/<DatePicker/);
    expect(src).toContain('testId="quote-date"');
    expect(src).toContain('testId="quote-return"');
  });

  test("DatePicker · calendar-math 에 Intl · toLocale 0건 (달·요일 이름은 카탈로그에서)", () => {
    for (const rel of ["components/ui/DatePicker.tsx", "components/ui/calendar-math.ts"]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/\bIntl\./);
      expect(src, rel).not.toMatch(/toLocale\w*String|toLocale\w*\(/);
      // 한글 리터럴 0 — 주석은 빼고 코드만 본다(문구는 카탈로그에서 props 로 받는다)
      expect(stripComments(src, rel), rel).not.toMatch(HANGUL);
    }
  });

  test("DatePicker.module.css — 원시 토큰·hex·rgb 0건", () => {
    const css = read("components/ui/DatePicker.module.css");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgba?|hsla?)\(/);
    expect(css).not.toMatch(/var\(\s*--(s[1-9]|r|r-s|r-xs|sh-[12]|maxw|ease|t|brand-\d+|gray|gold)\s*[,)]/);
  });

  test("카탈로그 — calendar 키 5개가 ko·en 에 있고 en 에는 한글이 없다", () => {
    for (const k of ["placeholder", "prevMonth", "nextMonth", "monthYear", "dialog"]) {
      expect(cal[k], `en ${k}`).toBeTruthy();
      expect(calKo[k], `ko ${k}`).toBeTruthy();
      expect(cal[k], `en ${k}`).not.toMatch(HANGUL);
    }
    expect(cal.monthYear).toBe("{month} {year}");
    expect(calKo.monthYear).toBe("{year}년 {month}월");
  });
});

/**
 * 관리자 날짜 표기 — **하나의 틀** (P5-23 라운드 2 · 컨트롤러 A-3).
 *
 * 화면마다 날짜 모양이 달랐다(공지 "2026-09-20" · 팝업 "2026-10-13 ~ 2026-11-13" · 발송 기록 "2026-09-29 22:07" …). 이제 관리자 화면의 날짜는
 * 전부 여기서 나온다:
 *   - 날짜   "9월 27일 (일)"          ← admin.dates.day
 *   - 시각   "9월 27일 (일) 22:07"    ← admin.dates.dateTime(날짜 + admin.dates.time)
 *   - 올해(KST)가 아니면 연도 "2025년 12월 3일 (수)" ← admin.dates.dayYear
 *   - 기간   "10월 13일 ~ 11월 13일"  ← 요일 없이(admin.dates.md · mdYear) + admin.dates.period
 *   - 달     "9월" · "2025년 10월"     ← admin.dates.month · monthYear(통계의 달 단위 축)
 * 문구(틀)는 전부 카탈로그에서 온다 — 여기에는 한글이 없다. React·Next·DB 없음(tests/admin-date.test.ts 가 그대로 부른다).
 *
 * 규칙
 *   - 시각은 **KST 달력**이다(서버 프로세스의 TZ 와 무관 — reservation-list.ts kstParts 의 고정 +9 시간). "올해" 도 KST 로 잰다.
 *   - `YYYY-MM-DD`(게시일 · 팝업 기간처럼 날짜만 저장한 값)는 이미 KST 달력 날짜다 — 시각을 지어내지 않고 그 날짜 그대로 읽는다.
 *   - 읽을 수 없는 값은 null — 부르는 쪽이 "—" 를 그린다.
 *   - `keep` 은 날짜 안의 빈칸을 줄바꿈 없는 공백으로 바꾼다 — 문장 속 날짜("마지막 게시일 9월 27일 (일)")가 "9월 / 27일" 로 꺾이지 않게.
 *     기간·달은 늘 붙인다(물결표 앞뒤에서만 꺾인다). 표 칸(한 줄 고정)은 그대로 둔다.
 */
import { kstParts } from "./reservation-list";

export interface AdminDateLabels {
  /** 0 = 일요일 … 6 = 토요일. */
  weekdays: readonly string[];
  day: string;
  dayYear: string;
  md: string;
  mdYear: string;
  month: string;
  monthYear: string;
  time: string;
  dateTime: string;
  period: string;
}

export interface CalendarParts {
  year: number;
  month: number;
  day: number;
  /** 0 = 일요일. */
  weekday: number;
  /** 날짜만 있는 값이면 null(시각을 지어내지 않는다). */
  hour: string | null;
  minute: string | null;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const NBSP = " ";

function fill(tpl: string, values: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : `{${k}}`));
}

const keepTogether = (s: string): string => s.replace(/ /g, NBSP);

/** 값 → KST 달력 조각. 날짜만 있는 값은 그 날짜 그대로(시각 null). 읽을 수 없으면 null. */
export function calendarParts(value: string | Date | null | undefined): CalendarParts | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const m = DATE_ONLY.exec(value.trim());
    if (m !== null) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const at = new Date(Date.UTC(year, month - 1, day));
      if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
      return { year, month, day, weekday: at.getUTCDay(), hour: null, minute: null };
    }
    if (value.trim() === "") return null;
  }
  const p = kstParts(value);
  if (p === null) return null;
  return { year: p.year, month: p.month, day: p.day, weekday: p.weekday, hour: p.hour, minute: p.minute };
}

export interface AdminDateOptions {
  /** 시각을 붙인다(값에 시각이 있을 때만). */
  time?: boolean;
  /** 요일을 붙인다(기본 true). */
  weekday?: boolean;
  /** 날짜 안의 빈칸을 줄바꿈 없는 공백으로(문장 속 날짜). 기본 false. */
  keep?: boolean;
}

/** "9월 27일 (일)" · 시각을 달면 "9월 27일 (일) 22:07" · 올해(KST)가 아니면 연도까지. 읽을 수 없으면 null. */
export function formatAdminDate(
  value: string | Date | null | undefined,
  now: Date,
  labels: AdminDateLabels,
  opts: AdminDateOptions = {},
): string | null {
  const p = calendarParts(value);
  const n = kstParts(now);
  if (p === null || n === null) return null;
  const withYear = p.year !== n.year;
  const weekday = opts.weekday ?? true;
  const tpl = weekday ? (withYear ? labels.dayYear : labels.day) : withYear ? labels.mdYear : labels.md;
  let out = fill(tpl, { year: p.year, month: p.month, day: p.day, weekday: labels.weekdays[p.weekday] ?? "" });
  if (opts.time === true && p.hour !== null && p.minute !== null) {
    out = fill(labels.dateTime, { date: out, time: fill(labels.time, { hour: p.hour, minute: p.minute }) });
  }
  return opts.keep === true ? keepTogether(out) : out;
}

/** 기간 "10월 13일 ~ 11월 13일" — 요일 없이 · 올해가 아닌 쪽만 연도 · 날짜 안은 붙인다. 한쪽이라도 읽을 수 없으면 null. */
export function formatAdminPeriod(from: string | Date | null | undefined, to: string | Date | null | undefined, now: Date, labels: AdminDateLabels): string | null {
  const a = formatAdminDate(from, now, labels, { weekday: false, keep: true });
  const b = formatAdminDate(to, now, labels, { weekday: false, keep: true });
  if (a === null || b === null) return null;
  return fill(labels.period, { from: a, to: b });
}

/** 달 "9월" · 올해가 아니면 "2025년 10월"(붙여서). 읽을 수 없으면 null. */
export function formatAdminMonth(value: string | Date | null | undefined, now: Date, labels: AdminDateLabels): string | null {
  const p = calendarParts(value);
  const n = kstParts(now);
  if (p === null || n === null) return null;
  return keepTogether(p.year !== n.year ? fill(labels.monthYear, { year: p.year, month: p.month }) : fill(labels.month, { month: p.month }));
}

/**
 * 달력 순수 계산 (OF3-A) — React·DOM·Intl 없음. tests/of3-datepicker.test.ts 가 직접 돌린다.
 *
 * 날짜는 전부 `YYYY-MM-DD` 문자열(KST 달력 날짜 — 위젯 값 그대로)이고, 계산은 **UTC 자정**(`Date.UTC`)으로만 한다.
 * 사용자 PC 의 시간대가 KST 가 아니어도(서머타임이 있는 곳 포함) 칸이 하루 밀리지 않는다.
 * 달·요일 **이름**은 여기 없다 — 화면 문구는 카탈로그(common.dates)에서만 온다.
 */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** UTC 자정의 ms → `YYYY-MM-DD`. */
function fromMs(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `YYYY-MM-DD` → UTC 자정 ms. 형식이 아니면 NaN. */
function toMs(ymd: string): number {
  const m = YMD.exec(ymd);
  if (m === null) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** `YYYY-MM-DD` → 숫자 셋. 형식이 아니면 null (달력에 실제로 있는 날인지는 보지 않는다). */
export function parseYmd(ymd: string): { year: number; month: number; day: number } | null {
  const m = YMD.exec(ymd);
  if (m === null) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function toYmd(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** month = 1~12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = 일요일 … 6 = 토요일. */
export function weekdayOf(ymd: string): number {
  return new Date(toMs(ymd)).getUTCDay();
}

export function addDays(ymd: string, n: number): string {
  return fromMs(toMs(ymd) + n * DAY_MS);
}

/** 말일 보정 — 1/31 + 1달 = 2/28(윤년 2/29). */
export function addMonths(ymd: string, n: number): string {
  const p = parseYmd(ymd);
  if (p === null) return ymd;
  const index = p.year * 12 + (p.month - 1) + n;
  const year = Math.floor(index / 12);
  const month = (index % 12 + 12) % 12 + 1;
  return toYmd(year, month, Math.min(p.day, daysInMonth(year, month)));
}

/** 음수 a<b · 0 같음 · 양수 a>b. `YYYY-MM-DD` 는 사전순이 곧 날짜순이다. */
export function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `min` 이 없으면(빈 문자열 · undefined) 어떤 날도 이전이 아니다. */
export function isBefore(ymd: string, min: string | undefined): boolean {
  return min !== undefined && min !== "" && compareYmd(ymd, min) < 0;
}

/** 그 달을 덮는 6주 × 7일(일요일 시작) — 앞뒤 달의 날짜가 섞인다. month = 1~12. */
export function monthGrid(year: number, month: number): string[][] {
  const first = toYmd(year, month, 1);
  const start = addDays(first, -weekdayOf(first));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

/**
 * WAI-ARIA 날짜 선택 키 이동 — 눌린 키에 따라 다음 포커스 날짜. 가로채지 않을 키는 null.
 * ← → 하루 · ↑ ↓ 일주일 · Home/End 그 주의 일요일/토요일 · PageUp/PageDown 한 달.
 */
export function nextFocus(ymd: string, key: string): string | null {
  switch (key) {
    case "ArrowLeft":
      return addDays(ymd, -1);
    case "ArrowRight":
      return addDays(ymd, 1);
    case "ArrowUp":
      return addDays(ymd, -7);
    case "ArrowDown":
      return addDays(ymd, 7);
    case "Home":
      return addDays(ymd, -weekdayOf(ymd));
    case "End":
      return addDays(ymd, 6 - weekdayOf(ymd));
    case "PageUp":
      return addMonths(ymd, -1);
    case "PageDown":
      return addMonths(ymd, 1);
    default:
      return null;
  }
}

/**
 * 위저드의 날짜·시각 문자열 헬퍼 — 순수, 브라우저·서버 공용 (P3-4).
 *
 * 서버 계약: `departAtLocal`/`returnAtLocal` 은 `YYYY-MM-DDTHH:mm` KST 벽시계 문자열 그대로(변환 금지, Z 금지 — CLAUDE.md §3).
 * 위저드는 목업처럼 날짜(`<input type="date">`)와 시각(`<input type="time">`)을 따로 받아 여기서 이어 붙인다.
 * Date 객체·타임존 변환은 하지 않는다 — 벽시계 문자열끼리만 다룬다. 같은 자릿수 형식이라 문자열 비교가 시간 순서와 같다.
 */

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const KST_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** 형식이 맞고 달력에 실제로 있는 날짜인가 (02-30 · 비윤년 02-29 거부). */
export function isCalendarDate(iso: string): boolean {
  if (!ISO_DATE_PATTERN.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const rt = new Date(Date.UTC(y, m - 1, d));
  return rt.getUTCFullYear() === y && rt.getUTCMonth() === m - 1 && rt.getUTCDate() === d;
}

export function isClockTime(hm: string): boolean {
  return CLOCK_TIME_PATTERN.test(hm);
}

/** 날짜+시각 → `YYYY-MM-DDTHH:mm`. 둘 중 하나라도 비었거나 형식이 틀리면 빈 문자열(서버가 undefined 로 본다). */
export function localStamp(date: string, time: string): string {
  return isCalendarDate(date) && isClockTime(time) ? `${date}T${time}` : "";
}

/** `YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:mm` → { date, time }. 형식·달력·시각이 어긋나면 null. */
export function splitLocal(value: string): { date: string; time?: string } | null {
  if (isCalendarDate(value)) return { date: value };
  if (!KST_LOCAL_PATTERN.test(value)) return null;
  const [date, time] = value.split("T");
  if (!isCalendarDate(date) || !isClockTime(time)) return null;
  return { date, time };
}

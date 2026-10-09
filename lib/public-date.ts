/**
 * 공개 화면 날짜 표기 — **하나의 틀** (P7-4 · 브리프 §4). 관리자 화면의 틀(components/admin/admin-date.ts — P5-23)과 같은 원칙이다.
 *
 * 공개 화면에 원문 `YYYY-MM-DD` 가 10곳 남아 있었다(견적 모달 요약 · 예약확인 결과 · 공지 목록·상세 · 법정 페이지 시행일 — UIUX 감사 2026-10-01).
 * 이제 그 자리의 **보이는 글자**는 전부 여기서 나온다(`<time dateTime>` 같은 기계용 값은 원문 그대로 둔다):
 *   - 일정(schedule)  ko "10월 11일 (일)" · 시각 "10월 9일 (금) 07:00"   en "Sun, Oct 11" · "Fri, Oct 9, 07:00"
 *                     올해(KST)가 아니면 연도를 붙인다 — ko "2027년 1월 5일 (화)" · en "Tue, Jan 5, 2027"
 *   - 게시일·시행일(posted) 연도 늘 · 요일 없음 — ko "2026년 9월 21일" · en "Sep 21, 2026"
 * 틀(문구)은 전부 카탈로그 `common.dates` 에서 온다 — 여기에는 한글이 없다. ko 의 달 이름은 숫자("10"), en 은 "Oct" 다(같은 `{month}` 자리).
 *
 * 서버·클라이언트 공용: React·Next·원장 import 없음. 서버는 `publicDateLabels((await getTranslations("common")).raw("dates"))`,
 * 클라이언트는 `publicDateLabels(useTranslations("common").raw("dates"))` 로 틀을 받아 넘긴다(tests/uiux-polish.test.ts §4).
 *
 * 읽는 값
 *   - `YYYY-MM-DD`(게시일 · 시행일 · 위젯 날짜 칸)는 이미 KST 달력 날짜다 — 시각을 지어내지 않는다.
 *   - `YYYY-MM-DD HH:mm` · `YYYY-MM-DDTHH:mm`(예약확인 뷰의 KST 벽시계 · lib/kst.ts 와 같은 형식)도 이미 KST 다.
 *   - 그 밖의 ISO(시간대 표기 있음)·Date 는 인스턴트 — 고정 +9 시간으로 KST 달력에 옮긴다(서버 TZ 와 무관 — lib/kst.ts 와 같은 계산).
 *   - 읽을 수 없으면 null — 부르는 쪽이 원래 값을 그대로 두거나 줄을 숨긴다.
 */

export interface PublicDateLabels {
  /** 0 = 일요일 … 6 = 토요일. */
  weekdays: readonly string[];
  /** 0 = 1월 … 11 = 12월 — ko 는 숫자("1"…"12"), en 은 약칭("Jan"…). */
  months: readonly string[];
  /** 일정 — "{month}월 {day}일 ({weekday})" / "{weekday}, {month} {day}" */
  day: string;
  /** 일정(올해가 아닐 때) — "{year}년 {month}월 {day}일 ({weekday})" / "{weekday}, {month} {day}, {year}" */
  dayYear: string;
  /** 게시일·시행일 — "{year}년 {month}월 {day}일" / "{month} {day}, {year}" */
  date: string;
  /** "{hour}:{minute}" */
  time: string;
  /** 날짜 + 시각 — "{date} {time}" / "{date}, {time}" */
  dateTime: string;
}

export interface PublicDateOptions {
  /** schedule = 일정(요일 · 올해가 아니면 연도) · posted = 게시일·시행일(연도 늘 · 요일 없음) */
  style: "schedule" | "posted";
  /** 시각을 붙인다 — 값에 시각이 있을 때만(날짜만 있는 값에는 지어내지 않는다). schedule 에서만 쓴다. */
  time?: boolean;
  /** "올해" 판정의 기준(KST). 기본은 지금. */
  now?: Date;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: string | null;
  minute: string | null;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** KST 벽시계 — 날짜만 · 날짜 + 시각(공백 또는 T). 시간대 표기가 없다. */
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : []);

/**
 * 카탈로그 `common.dates`(t.raw) → 틀. 모양이 어긋나면 **던진다** — 요일·달이 빠진 채 "undefined월" 이 화면에 나가는 것보다
 * 빌드·테스트가 멈추는 편이 낫다(카탈로그 ko·en 패리티는 tests/i18n-en.test.ts §2 가 잠근다).
 */
export function publicDateLabels(raw: unknown): PublicDateLabels {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const labels: PublicDateLabels = {
    weekdays: strList(o.weekdays),
    months: strList(o.months),
    day: str(o.day),
    dayYear: str(o.dayYear),
    date: str(o.date),
    time: str(o.time),
    dateTime: str(o.dateTime),
  };
  const ok =
    labels.weekdays.length === 7 &&
    labels.months.length === 12 &&
    [labels.day, labels.dayYear, labels.date, labels.time, labels.dateTime].every((s) => s.trim() !== "");
  if (!ok) throw new Error("publicDateLabels: catalog common.dates has the wrong shape (7 weekdays, 12 months, 5 templates)");
  return labels;
}

function fill(tpl: string, values: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : `{${k}}`));
}

/** 그 날짜가 달력에 실제로 있는가(2026-02-30 · 13월을 막는다). 요일도 함께 돌려준다. */
function calendarWeekday(year: number, month: number, day: number): number | null {
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return at.getUTCDay();
}

function instantParts(ms: number): Parts {
  const k = new Date(ms + KST_OFFSET_MS);
  const iso = k.toISOString();
  return {
    year: k.getUTCFullYear(),
    month: k.getUTCMonth() + 1,
    day: k.getUTCDate(),
    weekday: k.getUTCDay(),
    hour: iso.slice(11, 13),
    minute: iso.slice(14, 16),
  };
}

function partsOf(value: string | Date | null | undefined): Parts | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? instantParts(t) : null;
  }
  const v = value.trim();
  if (v === "") return null;
  const m = WALL_CLOCK.exec(v);
  if (m !== null) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const weekday = calendarWeekday(year, month, day);
    if (weekday === null) return null;
    if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59)) return null;
    return { year, month, day, weekday, hour: m[4] ?? null, minute: m[5] ?? null };
  }
  // 시간대가 있는 ISO 만 인스턴트로 읽는다(시간대 없는 다른 모양을 Date.parse 의 실행 환경 해석에 맡기지 않는다)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? instantParts(t) : null;
}

/** 공개 화면의 날짜 한 줄. 읽을 수 없으면 null. */
export function formatPublicDate(value: string | Date | null | undefined, labels: PublicDateLabels, opts: PublicDateOptions): string | null {
  const p = partsOf(value);
  if (p === null) return null;
  const values = { year: p.year, month: labels.months[p.month - 1] ?? String(p.month), day: p.day, weekday: labels.weekdays[p.weekday] ?? "" };
  if (opts.style === "posted") return fill(labels.date, values);
  const thisYear = instantParts((opts.now ?? new Date()).getTime()).year;
  const out = fill(p.year === thisYear ? labels.day : labels.dayYear, values);
  if (opts.time === true && p.hour !== null && p.minute !== null) {
    return fill(labels.dateTime, { date: out, time: fill(labels.time, { hour: p.hour, minute: p.minute }) });
  }
  return out;
}

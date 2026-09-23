/**
 * 관리자 통계 읽기 — SSR 세션 + definer 함수 하나 (플랜 v4 P5-17 · 마이그레이션 0022 · ADR-2·ADR-3).
 *
 * 왜 RPC 하나인가
 * ---------------------------------------------------------------------------
 * 통계는 `reservations` 와 `notifications_log` 를 열 번 넘게 훑는다. 그것을 화면에서 질의 열 번으로 만들면
 * (a) 왕복이 열 번이고 (b) 각 질의가 RLS 를 통과해야 해서 **원본 행이 앱까지 올라온다.**
 * 0022 의 `admin_stats(p_from, p_to)` 가 DB 안에서 세고 **(버킷·코드, 건수)만** 돌려준다 —
 * 이름·전화·메모·접수번호는 애초에 이 모듈까지 오지 않는다(담을 필드가 없다).
 *
 * 작은 칸 숨김(k=3)도 **DB 안에서** 끝난다. 1~2건짜리 칸은 `count: null · suppressed: true` 로 오고 하나의 "기타" 로 합쳐져 있다.
 * **이것은 익명화가 아니다.** 가려진 칸의 건수는 다른 숫자와 맞물리면 되짚을 수 있다 — 예컨대 "기타" 가 가려진 채 보이면
 * 그것은 1건짜리 칸이 정확히 둘이라는 뜻이고, 동률 처리 규칙까지 알면 어느 칸인지도 좁혀진다(known-defects **D13**).
 * 이 장치의 목적은 **관리자 화면의 캡처가 밖으로 나갔을 때의 예의 수준**이지 보장이 아니다 —
 * 관리자는 예약 목록에서 원본(이름·전화)을 이미 보고, 이 모듈은 그 관리자에게만 열려 있다.
 *
 * 서비스 롤을 쓰지 않는다(ADR-2 · scripts/check-admin-no-service-role.sh). 세션 클라이언트(anon 키 + 관리자 쿠키)로
 * 부르고, 함수 첫 문장의 `is_admin()` 가드가 DB 에서 한 번 더 막는다 — 화면에서 requireAdmin() 을 빠뜨려도 통계가 나가지 않는다.
 * 캐시하지 않는다(ADR-3): `unstable_cache` 로 감싸지 않는다.
 *
 * 가드 거부(42501 + 정확한 문구)는 **오류가 아니라 `null`** 이다 — 화면이 "권한 없음" 을 그린다.
 * 그 밖의 오류는 던진다: EXECUTE 거부(같은 42501, 다른 문구)·함수 없음(PGRST202)은 배포 사고이지
 * "권한 없는 사용자" 가 아니다. 조용히 빈 화면으로 삼키면 원인을 알 수 없다(lib/admin/adminRpc.ts 헤더와 같은 판단).
 *
 * ## 기간 계산은 여기서, KST 로
 * 화면이 고르는 네 가지(이번 달·지난 달·최근 3개월·최근 12개월)를 **KST 달력 날짜 두 개**로 바꾼다.
 * 상한은 12개월이다 — 그보다 길면 보관기간이 지난 접수가 이미 파기돼(미확정 건이 먼저 사라진다) 확정률과 추이가
 * 왜곡된다(ADMIN-STATS-RESEARCH §0-2). 계산은 문자열 → 숫자 → 문자열이고 `Date` 의 로컬 시간 getter 를 쓰지 않는다:
 * 서버 프로세스의 TZ 와 무관해야 한다("오늘" 은 호출부가 `toKstDateString(new Date())` 로 넘긴다).
 */
import "server-only";

import { cookies } from "next/headers";

import { PRIVACY_NOTICE } from "../legal/disclosures";
import { createSsrClient } from "../supabase/ssr";
import { isAdminGuardDenial } from "./adminRpc";

/** 세션(쿠키) 클라이언트. 서비스 롤 클라이언트는 이 파일에 들어오지 않는다. */
export type AdminStatsClient = ReturnType<typeof createSsrClient>;

/** 관리자 화면 경로 — 탭의 링크와 한 곳에서 온다. */
export const ADMIN_STATS_PATH = "/admin/stats";

/** 0022 의 definer 함수 이름. 가드 거부 판정이 **이 이름과 정확히 같을 때만** 참이다(adminRpc.ts). */
export const ADMIN_STATS_RPC = "admin_stats";

/** 작은 칸 숨김 기준 — 0022 의 `c_k` 와 같은 값. 화면의 "3건 미만" 문구가 이 숫자를 쓴다. */
export const MIN_VISIBLE_COUNT = 3;

/** ⑩ 운행일까지 남은 기간의 네 구간. 0022 가 내는 값과 messages/ko.json 의 라벨 키가 같다. */
export const LEAD_BUCKETS = ["d0_7", "d8_30", "d31_90", "d91_plus"] as const;
export type LeadBucket = (typeof LEAD_BUCKETS)[number];

/** 추이 버킷 단위 — 기간 길이에 따라 0022 가 고른다. */
export const TREND_UNITS = ["day", "week", "month"] as const;
export type TrendUnit = (typeof TREND_UNITS)[number];

/**
 * 화면이 고를 수 있는 기간의 **상한**(양끝 포함 일수) — 보유기간과 같다 (수정 라운드 2 · astra P1).
 *
 * 왜 366 이 아닌가: 확정 이력이 없는 접수는 `created_at + PRIVACY_NOTICE.retentionDays` 에 파기되고
 * 확정 이력이 있는 접수는 5년 남는다(lib/retention/purge.ts). 창이 보유기간보다 길면 **가장 오래된 날의
 * 미확정 건만 먼저 사라져** 확정률이 실제보다 높게 나온다 — 2건 중 1건 확정이 1건 중 1건(100%)으로 보인다.
 * 0022 자체는 366일까지 받아 주지만(화면 밖 호출까지 막을 이유는 없다), 화면의 프리셋은 여기서 더 좁힌다.
 */
export const MAX_RANGE_DAYS = PRIVACY_NOTICE.retentionDays;

/**
 * 파기 경계 경고의 여유 — 조회 시작일이 "오늘 − (보유기간 − 이 값)" 보다 오래되면 확정률에 주의를 붙인다.
 * 경계를 **넘은 뒤**에만 알리면 늦다: 창의 가장 오래된 날은 며칠 뒤 사라지고, 파기 배치가 이미 돌았을 수도 있다.
 */
export const PURGE_WARN_MARGIN_DAYS = 30;

/** 결과 JSON 의 최상위 키 — 0022 의 계약. 하나라도 어긋나면 아래 `assertStatsShape` 가 던진다. */
export const ADMIN_STATS_KEYS = [
  "range",
  "intake",
  "confirmation",
  "response_time",
  "backlog",
  "notifications",
  "trend",
  "purposes",
  "vehicles",
  "segments",
  "lead_time",
] as const;

// =============================================================================
// 기간
// =============================================================================

export const STATS_PERIODS = ["thisMonth", "lastMonth", "last3Months", "last12Months"] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

export interface StatsDateRange {
  /** KST 달력 날짜 `YYYY-MM-DD`, 양끝 포함. */
  from: string;
  to: string;
}

/** 주소창에 오타가 나도 화면이 500 이 되면 안 된다 — 모르는 값은 기본(이번 달)이다. */
export function parseStatsPeriod(raw: unknown): StatsPeriod {
  return typeof raw === "string" && (STATS_PERIODS as readonly string[]).includes(raw) ? (raw as StatsPeriod) : STATS_PERIODS[0];
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD` → [연, 월(1-12), 일]. 형식이 아니면 던진다(호출부는 toKstDateString 의 출력을 넘긴다). */
function parseYmd(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`statsRange: KST 날짜 형식이 아니다 — "${date}" (YYYY-MM-DD)`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** `y`년 `m`월(1-12)에서 `back` 개월 뒤로 간 [연, 월]. */
function shiftMonth(y: number, m: number, back: number): [number, number] {
  const zero = y * 12 + (m - 1) - back;
  return [Math.floor(zero / 12), (zero % 12) + 1];
}

/** 그 달의 마지막 날. `Date.UTC(y, m, 0)` 은 m월의 0일 = (m-1)월의 마지막 날이다(윤년 포함). */
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const monthStart = (y: number, m: number): string => `${y}-${pad2(m)}-01`;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 두 KST 달력 날짜 사이의 일수(뒤 − 앞). 두 값 모두 `YYYY-MM-DD` 다. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parseYmd(from);
  const [ty, tm, td] = parseYmd(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY);
}

/** `date` 에서 `n` 일 뒤의 KST 달력 날짜. */
function addDays(date: string, n: number): string {
  const [y, m, d] = parseYmd(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * 시작일을 뒤로 밀어 **양끝 포함 길이가 `maxDays` 를 넘지 않게** 한다.
 * 달 첫날 정렬을 지키되, 윤년이 낀 12개월처럼 366일이 되는 경로에서만 하루 이상 민다(MAX_RANGE_DAYS 주석).
 */
function clampStart(from: string, to: string, maxDays: number): string {
  const length = daysBetween(from, to) + 1;
  return length <= maxDays ? from : addDays(from, length - maxDays);
}

/**
 * 기간 선택 → KST 날짜 두 개(양끝 포함).
 *   이번 달       이 달 1일 ~ 오늘
 *   지난 달       지난달 1일 ~ 지난달 말일
 *   최근 3개월    2개월 전 1일 ~ 오늘   (최대 92일 — 0022 가 주 단위로 묶는다)
 *   최근 12개월   11개월 전 1일 ~ 오늘  (최대 366일 — 0022 의 상한과 같다)
 * `today` 는 KST 달력 날짜다(`toKstDateString(new Date())`). 이 함수는 시계를 읽지 않는다 — 테스트가 그대로 부른다.
 */
export function statsRange(period: StatsPeriod, today: string): StatsDateRange {
  const [y, m] = parseYmd(today);
  switch (period) {
    case "thisMonth":
      return { from: monthStart(y, m), to: today };
    case "lastMonth": {
      const [py, pm] = shiftMonth(y, m, 1);
      return { from: monthStart(py, pm), to: `${py}-${pad2(pm)}-${pad2(lastDayOfMonth(py, pm))}` };
    }
    case "last3Months": {
      const [sy, sm] = shiftMonth(y, m, 2);
      return { from: monthStart(sy, sm), to: today };
    }
    case "last12Months": {
      const [sy, sm] = shiftMonth(y, m, 11);
      // 윤년이 낀 배치(예: 오늘이 2028-02-29 면 2027-03-01 부터 366일)에서만 시작일을 민다 — MAX_RANGE_DAYS 주석.
      return { from: clampStart(monthStart(sy, sm), today, MAX_RANGE_DAYS), to: today };
    }
  }
}

/**
 * 조회 구간의 **시작일이 파기 경계에 가까운가** — 가까우면 확정률이 실제보다 높게 보인다(MAX_RANGE_DAYS 주석).
 * 길이가 아니라 **시작일의 나이**로 본다: 2020년의 석 달짜리 창처럼 짧아도 이미 전부 파기된 구간이 있다.
 */
export function isNearPurgeBoundary(range: StatsDateRange, today: string, retentionDays: number = PRIVACY_NOTICE.retentionDays): boolean {
  return daysBetween(range.from, today) > retentionDays - PURGE_WARN_MARGIN_DAYS;
}

// =============================================================================
// 결과 모양 — 0022 의 계약을 타입으로 적는다
// =============================================================================

export interface StatsRangeInfo {
  from: string;
  to: string;
  days: number;
  bucket: TrendUnit;
  /** 3개월을 넘으면 null — 비교 대상이 파기로 비어 있다. */
  prev_from: string | null;
  prev_to: string | null;
  has_prev: boolean;
}

export interface StatsIntake {
  total: number;
  prev_total: number | null;
  delta: number | null;
}

export interface StatsConfirmation {
  total: number;
  /** 한 번이라도 확정된 건(확정 뒤 취소 포함). */
  confirmed: number;
  /** 총건수 0 이면 null — 화면이 0 으로 나누지 않는다. */
  rate_pct: number | null;
  /** 이 기간 접수 중 아직 `new` 인 건. */
  pending: number;
}

export interface StatsResponseTime {
  sample: number;
  /** 표본이 MIN_VISIBLE_COUNT 미만이면 null("표본 부족"). */
  median_minutes: number | null;
  enough: boolean;
}

export interface StatsBacklog {
  new_total: number;
  over_72h: number;
  hours: number;
}

export interface StatsNotifications {
  failed: number;
  stuck: number;
  window_days: number;
  stuck_hours: number;
}

export interface StatsTrendPoint {
  /** 버킷 시작일(KST, `YYYY-MM-DD`). */
  bucket: string;
  total: number;
  /**
   * 이 버킷을 상태별로 쪼개도 되는가 — 총건수가 0 이거나 MIN_VISIBLE_COUNT 이상일 때만 참이다.
   * 거짓이면 아래 셋이 전부 `null` 이다: 그 날 혼자 접수한 사람의 상태가 드러나지 않게 0022 가 가린다.
   */
  split: boolean;
  waiting: number | null;
  confirmed: number | null;
  cancelled: number | null;
}

/** 분해표의 공통 부분 — 숨겨진 칸은 `count: null`, 합쳐진 칸은 `other: true`. */
interface SuppressibleRow {
  count: number | null;
  suppressed: boolean;
  other: boolean;
}

export interface StatsPurposeRow extends SuppressibleRow {
  /** `lib/codes.ts` PURPOSES 의 코드. "기타" 행이면 null. */
  code: string | null;
}

export interface StatsVehicleRow extends SuppressibleRow {
  slug: string | null;
  /** 요청 버스 대수 합. 숨겨진 칸이면 null. */
  buses: number | null;
}

export interface StatsSegmentRow extends SuppressibleRow {
  origin: string | null;
  destination: string | null;
  /** 홈 대표 노선(활성 `showcase_routes`)과 같은 구간인가. */
  showcase: boolean;
}

export interface StatsLeadRow extends SuppressibleRow {
  bucket: LeadBucket | null;
}

export interface AdminStats {
  range: StatsRangeInfo;
  intake: StatsIntake;
  confirmation: StatsConfirmation;
  response_time: StatsResponseTime;
  backlog: StatsBacklog;
  notifications: StatsNotifications;
  trend: StatsTrendPoint[];
  purposes: StatsPurposeRow[];
  vehicles: StatsVehicleRow[];
  segments: StatsSegmentRow[];
  lead_time: StatsLeadRow[];
}

// =============================================================================
// 화면이 쓰는 순수 계산 — **여기서만 나눗셈을 한다**
// =============================================================================

/**
 * 가로 막대의 분모 — 가려진 칸(`count: null`)은 세지 않고, **0 이 되지 않게 바닥을 1 로** 친다.
 * 화면이 `Math.max` 를 직접 쓰지 않게 하려고 여기 둔다(tests/admin-stats.test.ts 가 값으로 단언한다).
 */
export function visibleMax(rows: readonly { count: number | null }[]): number {
  let max = 1;
  for (const r of rows) if (r.count !== null && r.count > max) max = r.count;
  return max;
}

/**
 * 막대 폭(%) — 분모가 0·음수·NaN 이어도 유한한 0~100 을 돌려준다. 가려진 칸은 0 이다.
 * 이 함수 하나가 화면의 **유일한 나눗셈**이다.
 */
export function barWidthPercent(value: number | null, max: number): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 0;
  const denominator = Number.isFinite(max) && max > 0 ? max : 1;
  const pct = (value * 100) / denominator;
  return pct > 100 ? 100 : pct;
}

const MINUTES_IN_HOUR = 60;
const HOURS_IN_DAY = 24;
/** 이보다 짧으면 "N시간", 길면 "N.N일" 로 읽힌다 — 사장님이 바로 감이 오는 단위로. */
const DAY_SWITCH_MINUTES = 48 * MINUTES_IN_HOUR;

export interface MedianDuration {
  unit: "hours" | "days";
  /** 화면이 그대로 넣는 값(문자열 — 일 단위는 소수 한 자리다). */
  value: string;
}

/** 확정까지 걸린 시간(분)을 사람이 읽는 단위로. 분모가 상수라 0 이 될 수 없고, 화면은 나눗셈을 하지 않는다. */
export function medianDuration(minutes: number): MedianDuration {
  if (!Number.isFinite(minutes) || minutes < 0) return { unit: "hours", value: "0" };
  if (minutes < DAY_SWITCH_MINUTES) return { unit: "hours", value: String(Math.round(minutes / MINUTES_IN_HOUR)) };
  return { unit: "days", value: (minutes / (MINUTES_IN_HOUR * HOURS_IN_DAY)).toFixed(1) };
}

/** 화면이 그릴 세 가지 상태. `null` = 가드가 막았다(권한 없음) · 0건 = 빈 상태 · 그 밖 = 정상. */
export type StatsViewState = "denied" | "empty" | "ready";

export function statsViewState(stats: AdminStats | null): StatsViewState {
  if (stats === null) return "denied";
  return stats.intake.total === 0 ? "empty" : "ready";
}

/**
 * 0022 가 돌려준 것이 계약대로인가. **최상위 키 집합을 정확히** 본다 —
 * 칸이 하나 늘면(개인정보가 섞이는 가장 흔한 길이다) 화면에 그리기 전에 여기서 멈춘다.
 */
export function assertStatsShape(data: unknown): AdminStats {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("adminStats: 함수가 객체를 돌려주지 않았다");
  }
  const got = Object.keys(data as Record<string, unknown>).sort();
  const want = [...ADMIN_STATS_KEYS].sort();
  if (got.length !== want.length || got.some((k, i) => k !== want[i])) {
    throw new Error(`adminStats: 결과의 키 집합이 계약과 다르다 — 받은 것 [${got.join(", ")}]`);
  }
  return data as AdminStats;
}

// =============================================================================
// 조회
// =============================================================================

async function sessionClient(): Promise<AdminStatsClient> {
  return createSsrClient(await cookies());
}

/**
 * 기간 통계 한 벌. 관리자 명단 밖 세션이면 **null**(화면이 "권한 없음" 을 그린다).
 * 그 밖의 오류는 던진다 — 배포·권한 사고를 빈 화면으로 삼키지 않는다.
 * `client` 는 테스트 주입용이다. 운영 호출부는 넘기지 않는다.
 */
export async function getAdminStats(range: StatsDateRange, client?: AdminStatsClient): Promise<AdminStats | null> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.rpc(ADMIN_STATS_RPC, { p_from: range.from, p_to: range.to });

  if (error) {
    if (isAdminGuardDenial(error, ADMIN_STATS_RPC)) return null;
    // 오류 문구에 행 내용을 싣지 않는다 — code·message 만(lib/admin/reservations.ts 와 같은 규약).
    throw new Error(`adminStats.get: [${error.code ?? "?"}] ${error.message}`);
  }
  return assertStatsShape(data);
}

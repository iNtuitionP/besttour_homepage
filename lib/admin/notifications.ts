/**
 * 관리자 발송 내역 읽기 — SSR 세션 + RLS (플랜 v4 P5-8 · ADR-2·ADR-3).
 *
 * 왜 이 모듈이 있는가
 * ---------------------------------------------------------------------------
 * 문자가 실패하면 `notifications_log` 에 `failed` 로 남고(0005 mark_notification_failed), 5회째 claim 뒤 죽은 행은
 * 회수기(0007)가 `failed/lease_expired_after_max_attempts` 로 닫는다. 기록은 완벽한데 **읽는 사람이 없었다.**
 * 손님에게 확정 문자가 가지 않았는데 아무도 모르는 상태가 구조상 가능했다 — 이 모듈과 그 위의 화면이 그 구멍을 막는다.
 *
 * 읽기 전용이다
 * ---------------------------------------------------------------------------
 * 0009 는 이 표에 **select 정책 하나**만 줬다(`notifications_log_admin_select`). 상태 전이는 0005·0007 의 security definer
 * 함수 몫이다 — 관리자가 status 를 직접 고칠 수 있으면 "보내지 않은 것을 보냈다고 적는" 경로가 열린다.
 * 그래서 이 파일에는 insert·update·delete·rpc 가 하나도 없고, 재발송도 만들지 않았다(P4-2 발송기가 아직 없다).
 *
 * 서비스 롤을 쓰지 않는다(ADR-2). 조회는 `createSsrClient(cookies())`(anon 키 + 관리자 쿠키 세션)로 하고 정책이 DB 에서
 * 한 번 더 거른다 — 화면에서 requireAdmin() 을 빠뜨려도 0행이 온다. 캐시하지 않는다(ADR-3): 호출부가 unstable_cache 로
 * 감싸지 않는다. lib/admin/reservations.ts 와 같은 규약이고 `check:admin` 게이트가 기계로 지킨다.
 *
 * 수신처는 이 모듈 밖으로 나가지 않는다
 * ---------------------------------------------------------------------------
 * 예약 목록(lib/admin/reservations.ts)은 마스킹하지 않는다 — 사장님이 전화를 걸어야 하기 때문이다. 발송 내역은 다르다:
 * 여기서 걸 전화는 없고, 어느 예약인지는 **접수번호**로 안다. 그래서 `to_phone` 을 읽되 반환 타입에는 마스킹된
 * `toMasked` 만 둔다 — 원문을 담을 필드가 없으니 화면이 실수로 그릴 수도, dev 가 props 로 직렬화할 수도 없다
 * (P3-5 리뷰 N-2: 개발 모드는 서버 컴포넌트 props 를 HTML 에 싣는다).
 *
 * select 는 화이트리스트다(`select('*')` 금지). `provider_message_id` 와 0001 의 낡은 `error` 컬럼은 읽지 않는다.
 * 접수번호는 임베드가 아니라 **두 번째 질의**로 가져온다 — 임베드는 예약 쪽 정책에 걸리면 통지 행 자체를 조용히
 * 떨어뜨릴 수 있는데, 발송 실패를 보여 주려고 만든 화면에서 행이 사라지는 것이 가장 나쁘다.
 *
 * 페이지네이션은 limit + 1 (count 쿼리 금지 — lib/admin/reservations.ts 선례). 요약만 count 를 쓴다(아래).
 */
import "server-only";

import { cookies } from "next/headers";

import { maskEmailAddress, maskStoredPhone } from "../mask";
import { MAX_ATTEMPTS } from "../notify/outbox";
import { createSsrClient } from "../supabase/ssr";
import type { NotifyChannel, NotifyEvent, OutboxStatus } from "../types";

/** URL 의 `?cursor=` 파서는 예약 목록과 같은 것을 쓴다 — 화면 둘이 다른 규칙으로 움직일 이유가 없다. */
export { parseCursor } from "./reservations";

/** 세션(쿠키) 클라이언트. 서비스 롤 클라이언트는 이 파일에 들어오지 않는다. */
export type AdminNotificationsClient = ReturnType<typeof createSsrClient>;

export const NOTIFICATIONS_TABLE = "notifications_log";
const RESERVATIONS_TABLE = "reservations";

export const ADMIN_NOTIFICATIONS_PATH = "/admin/notifications";

export const DEFAULT_NOTIFICATION_PAGE_SIZE = 20;
export const MAX_NOTIFICATION_PAGE_SIZE = 100;

// =============================================================================
// 필터
// =============================================================================

/** 0005 의 status CHECK 그대로. `pending` 은 "아직 보낼 것"(백오프 대기 포함), `failed` 는 종착이다. */
export const NOTIFICATION_STATUSES = ["pending", "sent", "failed"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** 0005 의 channel CHECK 그대로. */
export const NOTIFICATION_CHANNELS = ["sms", "alimtalk", "email"] as const;

export const STATUS_FILTERS = ["all", ...NOTIFICATION_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const CHANNEL_FILTERS = ["all", ...NOTIFICATION_CHANNELS] as const;
export type ChannelFilter = (typeof CHANNEL_FILTERS)[number];

/** 기간 필터 — created_at 기준. `all` 은 조건 없음. */
export const PERIOD_FILTERS = ["all", "24h", "7d", "30d"] as const;
export type PeriodFilter = (typeof PERIOD_FILTERS)[number];

export const PERIOD_HOURS: Record<PeriodFilter, number | null> = {
  all: null,
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

/**
 * 파서는 관대하다(모르는 값이면 전체) — 주소창에 오타가 났다고 관리자 화면이 500 이 되면 안 된다.
 * 아래 쿼리 함수는 반대로 엄격하다: 목록 밖의 값을 받으면 DB 를 부르지 않고 throw 한다.
 */
const parseFrom = <T extends string>(allowed: readonly T[], raw: unknown): T =>
  typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : allowed[0];

export const parseNotificationStatusFilter = (raw: unknown): StatusFilter => parseFrom(STATUS_FILTERS, raw);
export const parseChannelFilter = (raw: unknown): ChannelFilter => parseFrom(CHANNEL_FILTERS, raw);
export const parsePeriodFilter = (raw: unknown): PeriodFilter => parseFrom(PERIOD_FILTERS, raw);

// =============================================================================
// 화이트리스트
// =============================================================================

/**
 * 목록이 읽는 컬럼. `to_phone` 은 **마스킹해서 버리려고** 읽는다 — 아래 toRow 가 원문을 반환 타입 밖에 둔다.
 * 읽지 않는 것: `provider_message_id`(제공자 쪽 식별자, 사장님에게 뜻이 없다) · 0001 의 낡은 `error` 컬럼
 * (0005 이후 쓰는 것은 `last_error` 다).
 */
export const NOTIFICATION_LIST_COLUMNS = [
  "id",
  "reservation_id",
  "event",
  "channel",
  "template",
  "status",
  "attempts",
  "last_error",
  "next_attempt_at",
  "created_at",
  "updated_at",
  "to_phone",
] as const;

/** PostgREST select 문자열 = 화이트리스트 join. 임베드·별칭 없음. */
export const NOTIFICATION_LIST_SELECT: string = NOTIFICATION_LIST_COLUMNS.join(",");

/** 접수번호 조회용 — 예약에서 딱 두 컬럼. 이름·전화번호는 읽지 않는다. */
export const RESERVATION_CODE_SELECT = "id,public_code";

/** 요약 집계가 읽는 컬럼. head 집계라 실제 행은 오지 않는다. */
const COUNT_COLUMN = "id";

// =============================================================================
// 행 모양
// =============================================================================

export interface NotificationListRow {
  id: number;
  /** 예약이 파기됐거나 예약 없는 통지면 null. 행을 감추지는 않는다. */
  reservationId: string | null;
  /** reservations.public_code. 못 찾으면 null(파기된 예약) — 그래도 통지 행은 남는다. */
  publicCode: string | null;
  event: NotifyEvent;
  channel: NotifyChannel;
  /** outbox.ts TEMPLATE_KEYS 의 키. 화면이 라벨로 바꿔 그린다. */
  template: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  /** 다음 시도 시각(ISO UTC). claim 중이면 lease 만료 시각이다. */
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  /** 마스킹된 수신처. 원문은 이 모듈 밖으로 나가지 않는다. */
  toMasked: string;
}

/** DB 행 — 이 모듈 밖으로 나가지 않는다. */
interface DbRow {
  id: number;
  reservation_id: string | null;
  event: NotifyEvent;
  channel: NotifyChannel;
  template: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  created_at: string;
  updated_at: string;
  to_phone: string;
}

// =============================================================================
// 마스킹 — fail-closed
// =============================================================================

/**
 * 수신처를 가린다 — 채널만 보고 lib/mask.ts 의 공용 변환에 넘긴다. **판정을 여기서 다시 구현하지 않는다**:
 * 같은 개인정보 변환의 사본이 둘이면 한쪽만 조여지고 다른 쪽이 계속 샌다(예약확인 화면이 같은 함수를 쓴다).
 *   - 전화(sms·alimtalk): `maskStoredPhone` — 저장형 E.164 의 `+82` 휴대전화만 `010-****-8585`, 그 밖은 전부 `***`
 *     (해외 번호·유선·국내 표기 원문·형식 불명. fail-closed — 짐작해서 일부를 내보내면 그것이 곧 유출이다).
 *     사장님 번호 env 가 국내 표기(`010-…`)로 들어와 있으면 그 행은 `***` 로 보인다 — 어느 행인지는 채널·문자 종류가 말해 준다.
 *   - 메일(email): `maskEmailAddress` — 로컬 파트를 통째로 가리고 도메인만(`***@naver.com`).
 */
export function maskRecipient(channel: NotifyChannel, raw: string): string {
  const value = raw ?? "";
  return channel === "email" ? maskEmailAddress(value) : maskStoredPhone(value);
}

function toRow(r: DbRow, codes: Map<string, string>): NotificationListRow {
  return {
    id: r.id,
    reservationId: r.reservation_id,
    publicCode: r.reservation_id === null ? null : (codes.get(r.reservation_id) ?? null),
    event: r.event,
    channel: r.channel,
    template: r.template,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    nextAttemptAt: r.next_attempt_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    toMasked: maskRecipient(r.channel, r.to_phone),
  };
}

// =============================================================================
// 목록
// =============================================================================

export interface NotificationListParams {
  status?: StatusFilter;
  channel?: ChannelFilter;
  period?: PeriodFilter;
  /** offset. 0 이상의 정수. */
  cursor?: number;
  limit?: number;
  /** 기간 필터의 기준 시각. 테스트 주입용 — 운영은 생략(호출 시점). */
  now?: Date;
}

export interface NotificationListPage {
  items: NotificationListRow[];
  hasMore: boolean;
  nextCursor: number | null;
}

const EMPTY_PAGE: NotificationListPage = { items: [], hasMore: false, nextCursor: null };

async function sessionClient(): Promise<AdminNotificationsClient> {
  return createSsrClient(await cookies());
}

/** 오류 문구에 행 내용을 싣지 않는다 — code·message 만(details·hint 제외, lib/admin/reservations.ts 와 같은 규약). */
function fail(op: string, error: { code?: string | null; message: string }): never {
  throw new Error(`adminNotifications.${op}: [${error.code ?? "?"}] ${error.message}`);
}

/** PostgREST 는 행 수를 넘긴 Range 요청에 416 + PGRST103 을 준다 — 오래된 cursor 는 오류가 아니라 빈 페이지다. */
function isRangeNotSatisfiable(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === "PGRST103" || /range not satisfiable/i.test(error.message ?? "");
}

function since(period: PeriodFilter, now: Date): string | null {
  const hours = PERIOD_HOURS[period];
  return hours === null ? null : new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function assertParams(params: NotificationListParams): Required<Pick<NotificationListParams, "status" | "channel" | "period" | "cursor" | "limit">> {
  const { status = "all", channel = "all", period = "all", cursor = 0, limit = DEFAULT_NOTIFICATION_PAGE_SIZE } = params;
  if (!(STATUS_FILTERS as readonly unknown[]).includes(status)) throw new Error("listNotifications: 알 수 없는 status 필터다");
  if (!(CHANNEL_FILTERS as readonly unknown[]).includes(channel)) throw new Error("listNotifications: 알 수 없는 channel 필터다");
  if (!(PERIOD_FILTERS as readonly unknown[]).includes(period)) throw new Error("listNotifications: 알 수 없는 period 필터다");
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error("listNotifications: cursor 는 0 이상의 정수여야 한다");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_NOTIFICATION_PAGE_SIZE) {
    throw new Error(`listNotifications: limit 은 1 이상 ${MAX_NOTIFICATION_PAGE_SIZE} 이하의 정수여야 한다`);
  }
  return { status, channel, period, cursor, limit };
}

/**
 * 목록 한 페이지 — 최신순(created_at desc, 동률은 id desc), `cursor` 부터 `limit` 건.
 * hasMore 는 limit + 1 건을 읽어 판정한다. `client` 는 테스트 주입용 — 운영 호출부는 넘기지 않는다.
 */
export async function listNotifications(
  params: NotificationListParams,
  client?: AdminNotificationsClient,
): Promise<NotificationListPage> {
  const { status, channel, period, cursor, limit } = assertParams(params);
  const now = params.now ?? new Date();

  const db = client ?? (await sessionClient());
  let query = db.from(NOTIFICATIONS_TABLE).select(NOTIFICATION_LIST_SELECT);
  if (status !== "all") query = query.eq("status", status);
  if (channel !== "all") query = query.eq("channel", channel);
  const from = since(period, now);
  if (from !== null) query = query.gte("created_at", from);

  // range 는 양끝 포함이다 — (cursor, cursor + limit) 은 limit + 1 건.
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(cursor, cursor + limit)
    .overrideTypes<DbRow[], { merge: false }>();

  if (error) {
    if (isRangeNotSatisfiable(error)) return EMPTY_PAGE;
    fail("listNotifications", error);
  }
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const codes = await publicCodes(page, db);

  return { items: page.map((r) => toRow(r, codes)), hasMore, nextCursor: hasMore ? cursor + limit : null };
}

/**
 * 통지 행들이 가리키는 예약의 접수번호. 임베드가 아니라 두 번째 질의다(모듈 헤더 참조).
 * 가리키는 예약이 하나도 없으면 DB 를 부르지 않는다. 못 찾은 예약(파기됨)은 지도에 없을 뿐, 통지 행은 남는다.
 */
async function publicCodes(rows: readonly DbRow[], db: AdminNotificationsClient): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.reservation_id).filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();

  const { data, error } = await db
    .from(RESERVATIONS_TABLE)
    .select(RESERVATION_CODE_SELECT)
    .in("id", ids)
    .overrideTypes<{ id: string; public_code: string }[], { merge: false }>();
  if (error) fail("publicCodes", error);
  return new Map((data ?? []).map((r) => [r.id, r.public_code]));
}

// =============================================================================
// 요약 — 화면 맨 위의 "이상 없음 / 실패 N건"
// =============================================================================

/**
 * `stuck` 집계의 창. 24시간을 잡아도 놓치는 것이 없는 이유: `pending` 인 채 attempts 를 다 쓴 행은 lease(5분)가
 * 지나는 즉시 회수기(0007)가 `failed` 로 바꾸고, 그러면 첫 번째 숫자(failed, 기간 제한 없음)가 잡는다.
 * 즉 `stuck` 은 "회수되기 전의 몇 분~몇 시간" 을 보는 창이고, 그보다 오래된 것은 failed 로 넘어가 있다.
 */
export const SUMMARY_WINDOW_HOURS = 24;

export interface NotificationSummary {
  /** status = 'failed' 전체 건수(기간 제한 없음). 종착한 실패 — 손님이 못 받은 문자다. */
  failed: number;
  /** status = 'pending' 이면서 attempts >= MAX_ATTEMPTS 이고 최근 24시간 안에 생긴 건수 — 더 시도되지 않는 행. */
  stuck: number;
  windowHours: number;
  /** 둘 다 0. 화면은 이때만 "이상 없음" 을 그린다. */
  ok: boolean;
}

export interface NotificationSummaryParams {
  now?: Date;
}

/** head 집계 응답 — 실제 행은 오지 않고 count 만 온다. */
interface CountResponse {
  count: number | null;
  error: { code?: string | null; message: string } | null;
}

/** count 가 오지 않으면 0 으로 갈음하지 않고 throw 한다 — 모르는 것을 "이상 없음" 으로 보고하는 것이 이 화면의 유일한 실패 방식이다. */
function readCount(op: string, res: CountResponse): number {
  if (res.error) fail(op, res.error);
  if (typeof res.count !== "number") throw new Error(`adminNotifications.${op}: count 를 받지 못했다 — 0 으로 갈음하지 않는다`);
  return res.count;
}

/**
 * 화면 맨 위 요약. **집계값이므로 실증불가 수치가 아니다**(CLAUDE.md §3) — DB 가 지금 세어 준 숫자다.
 * 개인정보는 하나도 오지 않는다(head 집계라 행 자체가 오지 않는다).
 */
export async function getNotificationSummary(
  params: NotificationSummaryParams = {},
  client?: AdminNotificationsClient,
): Promise<NotificationSummary> {
  const now = params.now ?? new Date();
  const db = client ?? (await sessionClient());

  const failedRes = await db.from(NOTIFICATIONS_TABLE).select(COUNT_COLUMN, { count: "exact", head: true }).eq("status", "failed");
  const failed = readCount("summary.failed", failedRes as CountResponse);

  const stuckSince = new Date(now.getTime() - SUMMARY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const stuckRes = await db
    .from(NOTIFICATIONS_TABLE)
    .select(COUNT_COLUMN, { count: "exact", head: true })
    .eq("status", "pending")
    .gte("attempts", MAX_ATTEMPTS)
    .gte("created_at", stuckSince);
  const stuck = readCount("summary.stuck", stuckRes as CountResponse);

  return { failed, stuck, windowHours: SUMMARY_WINDOW_HOURS, ok: failed === 0 && stuck === 0 };
}

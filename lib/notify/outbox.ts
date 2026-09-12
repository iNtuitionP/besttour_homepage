/**
 * 통지 아웃박스 — 큐·상태 전이·중복 방지·재시도 판정 (플랜 v4 P1-4 · ADR-7).
 *
 * 여기에는 Solapi 호출도(P4-2), 문자 문안도(P4-3) 없다. `template` 은 키뿐이다.
 * 'use server' 아님 — lib 순수 모듈이다. P3 접수 액션과 P4 발송기가 서비스 롤 클라이언트를 넘겨 호출한다.
 *
 * 구조
 *   - 순수 함수: planNotifications(무엇을 보낼지) · retryPlanAfterFailure / nextAttemptDecision(언제 다시 보낼지).
 *     DB·시계 없음, 시각은 인자로 받는다.
 *   - 얇은 DB 어댑터: enqueue · claimPending · markSent · markFailed · reapStale. 원자성이 필요한 것(잠금·attempts 증가·유니크 흡수)은
 *     전부 0005·0007 의 SQL 함수에 있고, 여기서는 RPC 로 부르고 행을 변환만 한다.
 *
 * 상태 전이 (0005_outbox.sql 헤더와 1:1, reapStale 은 0007)
 *   enqueue      : (없음) → pending
 *   claimPending : pending → pending (attempts+1, next_attempt_at = now + CLAIM_LEASE_MS)   ← for update skip locked
 *   markSent     : pending → sent   (같은 키에 이미 sent 가 있으면 → failed/duplicate_sent, false 반환)
 *   markFailed   : pending → pending (next_attempt_at = now + 백오프)  |  attempts >= MAX_ATTEMPTS → failed (종착)
 *   reapStale    : pending(attempts >= MAX_ATTEMPTS, lease 만료) → failed/lease_expired_after_max_attempts  (리뷰 M3 — 5회째 claim 뒤 죽은 행)
 *
 * 중복 방지 3층
 *   1) enqueue 가 같은 (reservation_id, event, channel, template) 에 pending/sent 가 있으면 넣지 않는다 (사전 확인, 경합에는 약함).
 *   2) claim 이 skip locked + lease 로 발송기 두 개가 같은 행을 잡지 못하게 한다.
 *   3) 부분 유니크 notifications_log_sent_once 가 두 번째 sent 를 DB 에서 거부한다 (마지막 층, 행에 duplicate_sent 로 남음).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewOutboxRow, NotifyChannel, NotifyEvent, OutboxRow } from "../types";

// =============================================================================
// 상수
// =============================================================================

/** 최대 발송 시도 횟수. 0005 claim_pending_notifications 의 `attempts < 5` 와 같은 숫자(테스트가 대조). */
export const MAX_ATTEMPTS = 5;

/**
 * n 번째 실패 뒤 다음 시도까지의 대기(ms) — 1m, 5m, 30m, 2h, 12h (브리프 그대로).
 * BACKOFF_MS[k-1] = k번째 실패 뒤 대기. MAX_ATTEMPTS = 5 이면 5번째 실패는 give_up 이라 마지막 칸(12h)은 상한으로만 남는다.
 */
export const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const;

/** claim 이 찍는 lease(ms). 0005 의 `interval '5 minutes'` 와 같다. 발송기가 mark 없이 죽으면 이 뒤에 다시 잡힌다. */
export const CLAIM_LEASE_MS = 5 * 60_000;

/** last_error 저장 상한 — 제공자 응답 덤프가 통째로 들어오지 않게. */
const LAST_ERROR_MAX_CHARS = 2000;

/** 템플릿 키 — 문안이 아니다. P4-3 이 이 키로 문안을 찾는다. `${event}.${audience}.${channel}`. */
export const TEMPLATE_KEYS = [
  "created.owner.sms",
  "created.owner.email",
  "created.customer.sms",
  "confirmed.customer.sms",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

// =============================================================================
// 순수 — 무엇을 보낼지
// =============================================================================

/** planNotifications 가 필요로 하는 예약 정보 — id 만 있으면 된다(문안은 P4 가 예약을 다시 읽는다). */
export interface ReservationForNotify {
  id: string;
}

export interface PlanOptions {
  /** 사장님 수신 번호(env). 없거나 빈 값이면 ownerEmail 로 폴백. */
  ownerPhone?: string;
  /** 사장님 수신 메일(env). ownerPhone 이 없을 때만 쓴다. */
  ownerEmail?: string;
  /** 고객 번호 — 접수 폼 값 그대로. 마스킹은 표시 계층의 일이다. */
  customerPhone: string;
}

export interface NotificationPlan {
  rows: NewOutboxRow[];
  /** 생략된 통지가 있으면 그 사유. 빈 배열이 정상. 호출자는 이것을 로그에 남긴다 — 조용히 넘어가지 않는다. */
  warnings: string[];
}

const present = (v: string | undefined): v is string => typeof v === "string" && v.trim().length > 0;

function newRow(reservationId: string, event: NotifyEvent, channel: NotifyChannel, to: string, template: TemplateKey): NewOutboxRow {
  return { reservation_id: reservationId, event, channel, to, template };
}

/**
 * event=created  → 사장님 건(SMS, 번호 없으면 email, 둘 다 없으면 생략 + warning) + 고객 SMS.
 * event=confirmed → 고객 1건.
 * 순서: 사장님 건이 먼저 — 접수 알림은 사장님이 먼저 알아야 한다(FIFO claim).
 */
export function planNotifications(reservation: ReservationForNotify, event: NotifyEvent, opts: PlanOptions): NotificationPlan {
  if (!present(opts.customerPhone)) {
    throw new Error("planNotifications: customerPhone 이 비었다 — 고객 통지 없는 접수는 없다");
  }
  const rows: NewOutboxRow[] = [];
  const warnings: string[] = [];
  const customer = opts.customerPhone;

  if (event === "created") {
    if (present(opts.ownerPhone)) {
      rows.push(newRow(reservation.id, event, "sms", opts.ownerPhone, "created.owner.sms"));
    } else if (present(opts.ownerEmail)) {
      rows.push(newRow(reservation.id, event, "email", opts.ownerEmail, "created.owner.email"));
    } else {
      warnings.push("owner notification skipped: ownerPhone and ownerEmail are both empty");
    }
    rows.push(newRow(reservation.id, event, "sms", customer, "created.customer.sms"));
    return { rows, warnings };
  }

  rows.push(newRow(reservation.id, event, "sms", customer, "confirmed.customer.sms"));
  return { rows, warnings };
}

// =============================================================================
// 순수 — 언제 다시 보낼지
// =============================================================================

export type RetryPlan = { giveUp: true } | { giveUp: false; retryAfterMs: number };

/**
 * `attempts` 번째 시도가 실패한 직후의 계획. attempts 는 실패한 시도를 포함한 누적 횟수(>= 1).
 * MAX_ATTEMPTS 에 도달했으면 give_up, 아니면 BACKOFF_MS[attempts-1] 뒤 재시도.
 */
export function retryPlanAfterFailure(attempts: number): RetryPlan {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`retryPlanAfterFailure: attempts 는 1 이상의 정수여야 한다 (받은 값: ${attempts})`);
  }
  if (attempts >= MAX_ATTEMPTS) return { giveUp: true };
  return { giveUp: false, retryAfterMs: BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] };
}

export type AttemptDecision = "send" | "give_up" | "wait";

/**
 * 이 행을 지금 보내도 되는가. 발송기가 claim 결과를 한 번 더 걸러 쓰거나, 큐 상태를 보고할 때 쓴다.
 *   - status 가 pending 이 아니면(sent·failed) give_up — 손댈 것이 없다.
 *   - attempts >= MAX_ATTEMPTS → give_up.
 *   - next_attempt_at 이 아직이면 wait, 도래했으면 send.
 * 0005 claim 의 where 절(status = 'pending' and next_attempt_at <= now() and attempts < 5)과 같은 판정이다.
 */
export function nextAttemptDecision(row: Pick<OutboxRow, "status" | "attempts" | "next_attempt_at">, now: Date): AttemptDecision {
  if (row.status !== "pending") return "give_up";
  if (row.attempts >= MAX_ATTEMPTS) return "give_up";
  const next = new Date(row.next_attempt_at).getTime();
  if (Number.isNaN(next)) throw new Error(`nextAttemptDecision: next_attempt_at 을 해석할 수 없다 (${row.next_attempt_at})`);
  return next > now.getTime() ? "wait" : "send";
}

// =============================================================================
// DB 어댑터 — 서비스 롤 클라이언트(lib/supabase/server.ts createServiceClient)를 넘겨 받는다. 서버 전용.
// =============================================================================

const TABLE = "notifications_log";

/** DB 행(snake_case, to_phone) — 어댑터 밖으로 나가지 않는다. */
interface DbRow {
  id: number;
  reservation_id: string;
  event: NotifyEvent;
  channel: NotifyChannel;
  to_phone: string;
  template: string;
  status: OutboxRow["status"];
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  updated_at: string;
}

function toOutboxRow(r: DbRow): OutboxRow {
  return {
    id: r.id,
    reservation_id: r.reservation_id,
    event: r.event,
    channel: r.channel,
    to: r.to_phone,
    template: r.template,
    status: r.status,
    attempts: r.attempts,
    last_error: r.last_error,
    next_attempt_at: r.next_attempt_at,
    updated_at: r.updated_at,
  };
}

function fail(op: string, error: { code?: string; message: string }): never {
  throw new Error(`outbox.${op}: ${error.code ? `[${error.code}] ` : ""}${error.message}`);
}

/** 중복 판정 키 = 부분 유니크 인덱스의 열 (reservation_id, event, channel, template). template 이 수신자(owner/customer)를 가른다. */
const keyOf = (r: { reservation_id: string; event: string; channel: string; template: string }) =>
  `${r.reservation_id}|${r.event}|${r.channel}|${r.template}`;

/**
 * pending 으로 insert 하고 새 id 들을 돌려준다(입력 순서).
 * 같은 (reservation_id, event, channel, template) 에 이미 pending 또는 sent 가 있으면 그 건은 넣지 않는다 — 이미 보냈거나 보낼 예정이다.
 * failed(종착) 만 있으면 새로 넣는다 = 재시도. 부분 유니크는 status = 'sent' 에만 걸려 pending insert 자체는
 * 충돌하지 않으므로, 이 사전 확인이 enqueue 층의 중복 방지다(경합은 claim·유니크가 막는다).
 */
export async function enqueue(rows: NewOutboxRow[], client: SupabaseClient): Promise<number[]> {
  if (rows.length === 0) return [];

  const reservationIds = [...new Set(rows.map((r) => r.reservation_id))];
  const existing = await client
    .from(TABLE)
    .select("reservation_id,event,channel,template")
    .in("reservation_id", reservationIds)
    .in("status", ["pending", "sent"]);
  if (existing.error) fail("enqueue.select", existing.error);
  const taken = new Set(
    ((existing.data ?? []) as { reservation_id: string; event: string; channel: string; template: string }[]).map(keyOf),
  );

  const seen = new Set<string>();
  const payload = rows
    .filter((r) => {
      const k = keyOf(r);
      if (taken.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => ({
      reservation_id: r.reservation_id,
      event: r.event,
      channel: r.channel,
      to_phone: r.to,
      template: r.template,
      status: "pending" as const,
    }));
  if (payload.length === 0) return [];

  const inserted = await client.from(TABLE).insert(payload).select("id");
  if (inserted.error) fail("enqueue.insert", inserted.error);
  return ((inserted.data ?? []) as { id: number }[]).map((r) => r.id);
}

/**
 * 보낼 행을 최대 limit 개 잠그고(lease) 돌려준다. 0005 claim_pending_notifications — for update skip locked.
 * 돌려받은 행은 attempts 가 이미 +1 된 상태다. 발송기는 결과를 markSent / markFailed 로 반드시 되돌려야 하며,
 * 되돌리지 못하고 죽으면 CLAIM_LEASE_MS 뒤에 다시 잡힌다(at-least-once).
 */
export async function claimPending(limit: number, client: SupabaseClient): Promise<OutboxRow[]> {
  const { data, error } = await client.rpc("claim_pending_notifications", { p_limit: limit });
  if (error) fail("claimPending", error);
  return ((data ?? []) as DbRow[]).map(toOutboxRow);
}

/**
 * pending → sent. true = 전이됨. false = 같은 키에 이미 sent 가 있어(부분 유니크) 이 행은 failed/duplicate_sent 로
 * 남았거나, 행이 pending 이 아니었다. 호출자는 false 를 경고로 로그에 남긴다.
 */
export async function markSent(id: number, providerMessageId: string | null, client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc("mark_notification_sent", { p_id: id, p_provider_message_id: providerMessageId });
  if (error) fail("markSent", error);
  return data === true;
}

/**
 * 실패 기록. row.attempts(claim 이 올린 값)로 재시도 계획을 계산해 넘긴다 — give_up 이면 failed(종착),
 * 아니면 pending 유지 + next_attempt_at = now + 백오프. last_error 는 2000자로 자른다.
 */
export async function markFailed(row: Pick<OutboxRow, "id" | "attempts">, error: string, client: SupabaseClient): Promise<void> {
  const plan = retryPlanAfterFailure(Math.max(1, row.attempts));
  const { error: rpcError } = await client.rpc("mark_notification_failed", {
    p_id: row.id,
    p_error: error.slice(0, LAST_ERROR_MAX_CHARS),
    p_give_up: plan.giveUp,
    p_retry_after_ms: plan.giveUp ? 0 : plan.retryAfterMs,
  });
  if (rpcError) fail("markFailed", rpcError);
}

/**
 * 회수기(0007 reap_stale_notifications · 리뷰 M3). 5회째 claim 뒤 mark 없이 죽어 attempts >= MAX_ATTEMPTS 인 채 lease 가 만료된
 * pending 행을 failed/lease_expired_after_max_attempts 로 바꾸고 그 행들을 돌려준다. 발송기가 매 실행 시작 시(dry-run 제외) 부른다 —
 * sender 구성 여부와 무관하게(회수는 발송이 아니다). 대상이 없으면 []. 오류는 throw — 회수 실패가 조용히 넘어가면 M3 가 다시 생긴다.
 */
export async function reapStale(client: SupabaseClient): Promise<OutboxRow[]> {
  const { data, error } = await client.rpc("reap_stale_notifications");
  if (error) fail("reapStale", error);
  return ((data ?? []) as DbRow[]).map(toOutboxRow);
}

/**
 * 아웃박스 발송기 (플랜 v4 P4-1 · ADR-7 · 독립 리뷰 M3).
 *
 * 접수(P3-3)는 notifications_log 에 pending 행을 쌓기만 한다. 이 모듈이 그 행을 claim → send → mark 로 흘리고,
 * 5회째 claim 뒤 죽은 행을 회수(reap)한다. 제공자 호출(P4-2)도 문안(P4-3)도 여기 없다 — sender 포트(./sender.ts)와 template 키뿐이다.
 *
 * 가장 중요한 규칙 — **sender 가 미구성이면 claim 자체를 하지 않는다.** claim 은 attempts 를 +1 하고 lease 를 건다(0005).
 * 제공자 키가 없는 몇 주 동안 크론이 5분마다 claim 만 하면 모든 pending 행이 5회를 소진해 키가 온 뒤에도 영영 보낼 수 없다.
 * 그래서 `configured === true` 가 아니면 보고서에 skipped:'sender_not_configured' 를 적고 warn 한 줄만 남긴다.
 * 회수(reap)는 발송이 아니므로 구성 여부와 무관하게 매 실행 시작 시 먼저 돈다.
 *
 * **그 규칙을 채널까지 내린 것이 P4-5 다.** 위 규칙은 sender **전체**에만 걸려 있었다 — sender 하나가 구성돼 있으면
 * 그 sender 가 보낼 수 없는 채널의 행까지 claim 됐다. 실제로 문자 어댑터가 사장님 메일 행(`channel='email'`)을 집어가
 * `unsupported_channel:email` 로 다섯 번을 확정 실패시키고 죽였다. 이제 worker 는 `sender.channels` 를 claim 에 넘기고
 * (0014 `claim_pending_notifications(p_limit, p_channels)`), 채널이 비어 있으면 **configured 와 무관하게** claim 하지 않는다
 * (skipped:'sender_has_no_channels'). 보낼 수 없는 행은 큐에 pending 으로 남아 attempts 가 보존된다 — 키가 온 날 그대로 나간다.
 *
 * dry-run 은 부작용 0 — claim 도, reap 도 하지 않는다(둘 다 행을 바꾼다). pending 개수·가장 오래된 행 나이·회수 대상 개수·sender 이름만 보고한다.
 *
 * 실행 순서 (dryRun=false, configured): reapStale → claimPending(limit) → 행마다 [claimedDecision → send → markSent | markFailed] → pendingStats
 *
 * claim 이후 행의 판정은 outbox.ts nextAttemptDecision 이 아니라 claimedDecision 이다. claim 이 next_attempt_at 을 lease 만큼 미래로
 * 찍어 두므로(0005 :109) nextAttemptDecision 은 모든 행에 wait 를, 5회째 행에는 give_up 을 내 — 아무것도 보내지 못한다.
 *
 * 보고서·로그에 개인정보 0: 행 id·카운트·시각뿐이다. `to`(전화·메일)·이름·문안은 절대 싣지 않는다. sender 가 준 오류 문구에서
 * 수신처 문자열을 지우고(scrubError) 200자로 자른 뒤에만 로그·last_error 로 보낸다. send 가 throw 하면 예외 문구는 버리고
 * 'sender_threw:<sender 이름>' 만 남긴다(예외 문구에 수신처가 섞이는 것을 막는다).
 *
 * 순수 모듈 — env 없음, 서버 지시어 없음, 네트워크 없음. 시계·DB·sender·로그는 전부 deps 로 받는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { NotifyChannel, OutboxRow } from "../types";
import { MAX_ATTEMPTS, TEMPLATE_KEYS, claimPending, markFailed, markSent, reapStale, retryPlanAfterFailure, type TemplateKey } from "./outbox";
import type { NotificationSender, SendOutcome } from "./sender";

// =============================================================================
// 상수
// =============================================================================

/** 1회 실행에서 claim 하는 행 상한 기본값. 5분 크론 × 20 = 시간당 240건 — 이 사업 규모에 충분하고, 실행 시간이 lease(5분) 안에 끝난다. */
export const DEFAULT_WORKER_LIMIT = 20;

/** pendingStats 가 읽는 pending 행 상한. 넘으면 보고서 pendingTruncated 로 드러난다. */
export const PENDING_STATS_SCAN_LIMIT = 1000;

/** pendingStats 가 읽는 컬럼 — 개인정보 컬럼(to_phone) 없음. */
export const PENDING_STATS_COLUMNS = "id, created_at, attempts, next_attempt_at";

/** 로그·last_error 로 나가는 오류 문구 상한. DB 의 2000자 상한(outbox.ts)보다 훨씬 짧게 — 로그는 덤프가 아니다. */
const ERROR_MAX_CHARS = 200;

const TABLE = "notifications_log";

// =============================================================================
// 포트
// =============================================================================

/** pending 큐 통계 — 읽기 전용. dry-run 의 유일한 DB 접근. */
export interface PendingStats {
  /** status = 'pending' 행 수(scan 상한까지). */
  pending: number;
  /** pending >= PENDING_STATS_SCAN_LIMIT — 더 있을 수 있다. */
  truncated: boolean;
  /** 가장 오래된 pending 행의 created_at(ISO). 없으면 null. */
  oldestCreatedAt: string | null;
  /** 지금 reapStale 을 부르면 회수될 행 수 (attempts >= MAX_ATTEMPTS 이고 next_attempt_at <= now). */
  wouldReap: number;
}

/** DB 포트 — 테스트는 이것을 mock 한다. 실제 구현은 supabaseWorkerDb (0005·0007 어댑터 연결). */
export interface WorkerDb {
  reapStale(): Promise<OutboxRow[]>;
  /**
   * 최대 limit 개를 잠그고 lease 를 찍는다. `channels` 는 **보낼 수 있는 채널의 화이트리스트**이며 그대로
   * 0014 `claim_pending_notifications(p_limit, p_channels)` 로 간다 — 목록에 없는 채널의 행은 집히지 않고 attempts 도 오르지 않는다.
   * 빈 배열이면 0행이다(전 채널이 아니다). worker 는 애초에 빈 배열로 부르지 않는다(아래 skipped 참조).
   */
  claimPending(limit: number, channels: readonly NotifyChannel[]): Promise<OutboxRow[]>;
  markSent(id: number, providerMessageId: string | null): Promise<boolean>;
  markFailed(row: Pick<OutboxRow, "id" | "attempts">, error: string): Promise<void>;
  pendingStats(now: Date): Promise<PendingStats>;
}

export interface WorkerOptions {
  /** 기본 true. false 를 명시해야만 reap·claim·send 를 한다. */
  dryRun?: boolean;
  /** 1회 claim 상한. 기본 DEFAULT_WORKER_LIMIT. 1 이상 정수. */
  limit?: number;
}

/** 실행 보고서 — 개인정보 0. 행 id·카운트·시각뿐이다. */
export interface WorkerReport {
  dryRun: boolean;
  /** sender 이름 (unconfigured / memory / P4-2 제공자 / routing(…)). */
  sender: string;
  /**
   * 이 실행에서 claim 대상이 된 채널 — sender 가 보낼 수 있다고 밝힌 목록 그대로다(P4-5).
   * 비어 있으면 아무것도 claim 하지 않았다는 뜻이고, 여기 없는 채널의 행은 큐에 그대로 남아 있다(attempts 보존).
   */
  channels: NotifyChannel[];
  /** 실행 시작 인스턴트(ISO UTC). */
  nowIso: string;
  limit: number;
  /**
   * claim 을 하지 않은 이유. dry-run 이어도 표시한다.
   *   - sender_not_configured  제공자 키 등이 비어 있다(sender.configured !== true)
   *   - sender_has_no_channels 구성은 됐는데 **보낼 수 있는 채널이 하나도 없다**(P4-5). 보낼 곳이 없으면 집지 않는다 —
   *     집는 순간 attempts 가 타고, 그것은 되돌릴 수 없다.
   */
  skipped?: "sender_not_configured" | "sender_has_no_channels";
  /** reapStale 이 failed 로 바꾼 행 수(dry-run 이면 0). */
  reaped: number;
  claimed: number;
  /** markSent 가 true 를 돌려준 행 수. */
  sent: number;
  /** markFailed 를 부른 행 수 — 재시도 대기와 give_up 을 합친 값. */
  failed: number;
  /** failed 중 attempts >= MAX_ATTEMPTS 라 종착(failed)이 된 행 수. */
  gaveUp: number;
  /** markSent 가 false — 같은 키에 이미 sent 가 있어 행이 failed/duplicate_sent 로 남은 수. */
  duplicate: number;
  /** claim 은 됐지만 처리 전에 lease 가 지나 보내지 않은 행 수(다른 발송기가 잡을 수 있다). */
  leaseExpired: number;
  /** markSent/markFailed 자체가 throw 한 수(= sentUnmarked + markFailed 실패) — 행은 lease 만료 뒤 다시 잡힌다. error 로그 있음. */
  markErrors: number;
  /**
   * send 는 성공했는데 markSent 가 throw 해 행이 pending 으로 남은 수(리뷰 N1). lease 만료 뒤 다시 claim 되어 **고객이 두 번 받을 수 있는**
   * 창이다(마지막 층 notifications_log_sent_once 는 두 번째 sent 기록만 막지 발송을 막지 못한다). markErrors 의 다른 절반
   * (markFailed 실패 = 백오프 없이 조기 재시도, 무해)과 심각도가 달라 따로 센다. ADR-7 이 신경 쓰는 바로 그 창이다.
   */
  sentUnmarked: number;
  /** 실행 뒤 남은 pending 행 수(scan 상한까지). */
  pending: number;
  pendingTruncated: boolean;
  /** 지금 회수될 행 수 — dry-run 에서 "실행했다면 몇 건 회수됐을지". 실행 뒤에는 보통 0. */
  wouldReap: number;
  /** 가장 오래된 pending 행이 기다린 시간(ms). pending 이 없으면 null. */
  oldestPendingAgeMs: number | null;
  /** 행 id 만 — 감사용. sentUnmarked 는 "보냈는데 못 적은" 행 — 사람이 로그 없이도 중복 수신 가능성을 본다. */
  ids: { reaped: number[]; sent: number[]; failed: number[]; duplicate: number[]; leaseExpired: number[]; sentUnmarked: number[] };
}

/** 로그 항목 — 전부 lib/log.ts StructuredLogEntry 의 부분형이라 structuredLog 를 그대로 log 로 넘길 수 있다. `to` 는 어디에도 없다. */
export type WorkerLogEntry =
  | ({ level: "info" | "warn"; event: "notify.worker_run" } & WorkerReport)
  | {
      level: "warn";
      event: "notify.send_failed";
      id: number;
      channel: NotifyChannel;
      template: string;
      attempts: number;
      /** 수신처를 지운 오류 코드(≤ 200자). */
      error: string;
      retryable: boolean;
      gaveUp: boolean;
      /** send 가 throw 한 경우 예외의 name 만(message 는 버린다). */
      errorName?: string;
    }
  | { level: "warn"; event: "notify.lease_expired"; id: number; attempts: number }
  | { level: "warn"; event: "notify.duplicate_sent"; id: number; template: string }
  | {
      level: "error";
      event: "notify.mark_failed";
      id: number;
      /** markSent = 보냈는데 못 적음(중복 수신 창, 보고서 sentUnmarked) · markFailed = 실패를 못 적음(조기 재시도, 무해). */
      op: "markSent" | "markFailed";
      /** DB 오류 메시지 — 수신처를 지우고 200자로 자른 것. */
      error: string;
    };

export interface WorkerDeps {
  db: WorkerDb;
  sender: NotificationSender;
  /** 시계 — 행마다 다시 읽는다(lease 판정). 테스트는 고정 시각을 준다. */
  now: () => Date;
  /** 구조화 로그 — 운영은 lib/log.ts structuredLog. */
  log: (entry: WorkerLogEntry) => void;
}

// =============================================================================
// 순수 — claim 이후 판정 · 오류 문구 정리
// =============================================================================

export type ClaimedDecision = "send" | "give_up" | "lease_expired";

/**
 * claim 이 돌려준 행을 지금 보내도 되는가. (nextAttemptDecision 은 claim **전** 판정이다 — 헤더 참조.)
 *   - status 가 pending 이 아니거나 attempts > MAX_ATTEMPTS → give_up. claim 의 where 절상 나올 수 없는 행이다(방어) — markFailed 로 닫는다.
 *   - next_attempt_at(= lease 만료 시각)이 이미 지났으면 lease_expired — 다른 발송기가 같은 행을 잡을 수 있으므로 보내지 않는다.
 *   - 그 외 send. attempts === MAX_ATTEMPTS 인 5회째 시도도 정당한 시도다.
 */
export function claimedDecision(row: Pick<OutboxRow, "status" | "attempts" | "next_attempt_at">, now: Date): ClaimedDecision {
  if (row.status !== "pending") return "give_up";
  if (row.attempts > MAX_ATTEMPTS) return "give_up";
  const lease = new Date(row.next_attempt_at).getTime();
  if (Number.isNaN(lease)) throw new Error(`claimedDecision: next_attempt_at 을 해석할 수 없다 (${row.next_attempt_at})`);
  return lease > now.getTime() ? "send" : "lease_expired";
}

/**
 * sender 가 준 오류 문구에서 수신처를 지우고 길이를 자른다 — 로그·보고서·last_error 로 나가기 전 마지막 방어.
 * 원문 그대로, 숫자만 남긴 형태(하이픈 제거) 둘 다 지운다. 짧은 값(3자 미만)은 오탐이 많아 건드리지 않는다.
 */
export function scrubError(error: string, to: string): string {
  const variants = new Set<string>();
  const trimmed = to.trim();
  if (trimmed.length >= 3) {
    variants.add(trimmed);
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length >= 7) variants.add(digits);
  }
  let out = error;
  for (const v of variants) out = out.split(v).join("[to]");
  return out.slice(0, ERROR_MAX_CHARS);
}

const isTemplateKey = (t: string): t is TemplateKey => (TEMPLATE_KEYS as readonly string[]).includes(t);

/** DB 오류 → 로그용 문자열. outbox.* 오류는 코드·메시지뿐이지만 그래도 수신처를 지운다(scrubError 가 200자 컷까지 한다). */
const errorSummary = (err: unknown, to: string): string => scrubError(err instanceof Error ? err.message : String(err), to);

// =============================================================================
// 발송기 본체
// =============================================================================

/**
 * 한 번의 크론 실행. 기본은 dry-run(보고만). `dryRun:false` 일 때만 reap·claim·send·mark 를 한다.
 * reapStale·claimPending·pendingStats 가 throw 하면 실행 전체가 throw 한다(크론 500 — 사람이 안다).
 * 행 단위 오류(send throw · mark throw)는 그 행만 기록하고 다음 행을 계속한다 — 한 행 때문에 나머지 행의 lease 를 태우지 않는다.
 */
export async function runNotificationWorker(opts: WorkerOptions, deps: WorkerDeps): Promise<WorkerReport> {
  const dryRun = opts.dryRun !== false;
  const limit = opts.limit ?? DEFAULT_WORKER_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`runNotificationWorker: limit=${String(limit)} 는 1 이상의 정수여야 한다`);
  }
  const { db, sender, log } = deps;
  const startedAt = deps.now();
  const configured = sender.configured === true;
  // 채널이 비면 claim 하지 않는다 — configured 와 무관하다(P4-5). 이상한 sender 가 channels 를 아예 안 주는 경우도 같게 본다.
  const channels = [...(sender.channels ?? [])];
  const skipped = !configured ? ("sender_not_configured" as const) : channels.length === 0 ? ("sender_has_no_channels" as const) : undefined;

  const ids: WorkerReport["ids"] = { reaped: [], sent: [], failed: [], duplicate: [], leaseExpired: [], sentUnmarked: [] };
  let claimed = 0;
  let gaveUp = 0;
  let markErrors = 0;

  /** 실패 기록 — markFailed 로 되돌리고 send_failed 를 남긴다. give_up 여부는 0005 와 같은 계산(retryPlanAfterFailure)으로 보고서에 적는다. */
  async function recordFailure(row: OutboxRow, error: string, meta: { retryable: boolean; errorName?: string }): Promise<void> {
    const plan = retryPlanAfterFailure(Math.max(1, row.attempts));
    try {
      await db.markFailed({ id: row.id, attempts: row.attempts }, error);
    } catch (err) {
      // 실패를 못 적었다 — 행은 lease 만료 뒤 백오프 없이 다시 잡힌다(무해). 실행은 계속한다.
      markErrors += 1;
      log({ level: "error", event: "notify.mark_failed", id: row.id, op: "markFailed", error: errorSummary(err, row.to) });
      return;
    }
    ids.failed.push(row.id);
    if (plan.giveUp) gaveUp += 1;
    log({
      level: "warn",
      event: "notify.send_failed",
      id: row.id,
      channel: row.channel,
      template: row.template,
      attempts: row.attempts,
      error,
      retryable: meta.retryable,
      gaveUp: plan.giveUp,
      ...(meta.errorName === undefined ? {} : { errorName: meta.errorName }),
    });
  }

  // 1. 회수 — 발송이 아니므로 sender 구성과 무관. dry-run 은 부작용 0 이라 건너뛴다(wouldReap 로 보고).
  if (!dryRun) {
    ids.reaped = (await db.reapStale()).map((r) => r.id);
  }

  // 2. 발송 — 구성된 sender 가 있고, 보낼 수 있는 채널이 있을 때만 claim 한다.
  if (!dryRun && skipped === undefined) {
    const rows = await db.claimPending(limit, channels);
    claimed = rows.length;

    for (const row of rows) {
      const decision = claimedDecision(row, deps.now());
      if (decision === "lease_expired") {
        ids.leaseExpired.push(row.id);
        log({ level: "warn", event: "notify.lease_expired", id: row.id, attempts: row.attempts });
        continue;
      }
      if (decision === "give_up") {
        await recordFailure(row, "claim_invariant_violated", { retryable: false });
        continue;
      }
      if (!isTemplateKey(row.template)) {
        await recordFailure(row, "unknown_template", { retryable: false });
        continue;
      }

      let outcome: SendOutcome;
      try {
        outcome = await sender.send({ id: row.id, channel: row.channel, to: row.to, template: row.template, reservationId: row.reservation_id });
      } catch (err) {
        // 예외 문구는 버린다 — 제공자 예외에는 요청 본문(수신처)이 섞이곤 한다. 이름만 남긴다.
        await recordFailure(row, `sender_threw:${sender.name}`, { retryable: true, errorName: err instanceof Error ? err.name : typeof err });
        continue;
      }

      if (!outcome.ok) {
        await recordFailure(row, scrubError(outcome.error, row.to), { retryable: outcome.retryable });
        continue;
      }

      try {
        const transitioned = await db.markSent(row.id, outcome.providerMessageId);
        if (transitioned) {
          ids.sent.push(row.id);
        } else {
          ids.duplicate.push(row.id);
          log({ level: "warn", event: "notify.duplicate_sent", id: row.id, template: row.template });
        }
      } catch (err) {
        // 보냈는데 못 적었다 — lease 만료 뒤 다시 claim 되면 고객이 두 번 받는다(리뷰 N1). 보고서 sentUnmarked 로 드러낸다.
        markErrors += 1;
        ids.sentUnmarked.push(row.id);
        log({ level: "error", event: "notify.mark_failed", id: row.id, op: "markSent", error: errorSummary(err, row.to) });
      }
    }
  }

  // 3. 통계 — 처리가 끝난 뒤 남은 backlog. dry-run 에서는 이것이 유일한 DB 접근이다.
  const statsAt = deps.now();
  const stats = await db.pendingStats(statsAt);
  const oldestMs = stats.oldestCreatedAt === null ? Number.NaN : new Date(stats.oldestCreatedAt).getTime();
  const oldestPendingAgeMs = Number.isNaN(oldestMs) ? null : Math.max(0, statsAt.getTime() - oldestMs);

  const report: WorkerReport = {
    dryRun,
    sender: sender.name,
    channels,
    nowIso: startedAt.toISOString(),
    limit,
    ...(skipped === undefined ? {} : { skipped }),
    reaped: ids.reaped.length,
    claimed,
    sent: ids.sent.length,
    failed: ids.failed.length,
    gaveUp,
    duplicate: ids.duplicate.length,
    leaseExpired: ids.leaseExpired.length,
    markErrors,
    sentUnmarked: ids.sentUnmarked.length,
    pending: stats.pending,
    pendingTruncated: stats.truncated,
    wouldReap: stats.wouldReap,
    oldestPendingAgeMs,
    ids,
  };

  // 미구성이면 warn 한 줄 — 키가 없는 동안 크론이 5분마다 "보내지 않았다"를 남긴다. 정상 실행은 info.
  log({ level: skipped === undefined ? "info" : "warn", event: "notify.worker_run", ...report });
  return report;
}

// =============================================================================
// supabase-js 구현 — 0005·0007 어댑터(outbox.ts) 연결 + 읽기 전용 통계
// =============================================================================

/** pendingStats 가 읽는 행 — PENDING_STATS_COLUMNS 와 1:1. */
interface PendingStatsRow {
  id: number;
  created_at: string;
  attempts: number;
  next_attempt_at: string;
}

/** 서비스 롤 클라이언트(lib/supabase/server.ts createServiceClient)를 받는다 — 서버 전용. */
export function supabaseWorkerDb(client: SupabaseClient): WorkerDb {
  return {
    reapStale: () => reapStale(client),
    // 채널 화이트리스트를 0014 RPC 로 그대로 넘긴다(p_channels). 구버전 DB 에는 이 인자가 없다 — 0014 를 먼저 적용해야 한다.
    claimPending: (limit, channels) => claimPending(limit, client, channels),
    markSent: (id, providerMessageId) => markSent(id, providerMessageId, client),
    markFailed: (row, error) => markFailed(row, error, client),
    async pendingStats(now) {
      const { data, error } = await client
        .from(TABLE)
        .select(PENDING_STATS_COLUMNS)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(PENDING_STATS_SCAN_LIMIT);
      if (error) throw new Error(`worker.pendingStats: ${error.message}`);
      const rows = (data ?? []) as unknown as PendingStatsRow[];
      const nowMs = now.getTime();
      return {
        pending: rows.length,
        truncated: rows.length >= PENDING_STATS_SCAN_LIMIT,
        oldestCreatedAt: rows.length > 0 ? rows[0].created_at : null,
        wouldReap: rows.filter((r) => r.attempts >= MAX_ATTEMPTS && new Date(r.next_attempt_at).getTime() <= nowMs).length,
      };
    },
  };
}

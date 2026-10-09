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
 * **끝내 실패하면 사장님께 알린다 (P4-4).** 행이 failed 로 끝나는 경로는 **둘**이고 둘 다 알린다:
 * ① `recordFailure` 의 give_up(5회 소진) ② `reapStale` 의 회수(5회째 claim 뒤 mark 없이 죽어 다시 잡히지 못하는 행).
 * 둘 다 같은 `planFailureNotice` 를 타므로 재귀 차단·묶임 입도·OWNER_EMAIL 부재 처리가 하나다.
 * 죽은 행은 화면에만 남았다 — 아무도 모른다.
 * 그래서 그 자리에서 사장님 앞으로 **새 pending 행 하나**를 넣고(직접 보내지 않는다 — 아웃박스를 그대로 탄다) 다음 실행에 나가게 한다
 * (P4-7 부터 "다음 실행" = 다음 즉시 발송(접수·확정) 또는 하루 1회 크론 중 먼저 오는 쪽).
 * 판정은 전부 fallback.ts `planFailureNotice` 이고 그 **첫 줄이 재귀 차단**이다: 죽은 행 자체가 실패 알림이면 아무것도 넣지 않는다.
 * 그 한 줄이 없으면 알림이 실패 → 또 알림 → … 무한이다(사장님 번호가 없어 메일 폴백이 생기고 메일이 거절되는 형태가 실제로 그렇다).
 * give_up 여부는 `retryPlanAfterFailure` 가 이미 낸 값을 그대로 쓴다 — 매 실패마다 넣으면 한 건에 알림이 다섯 번 간다.
 *
 * 실행 순서 (dryRun=false, configured): reapStale → claimPending(limit) → 행마다 [claimedDecision → send → markSent | markFailed(→ give_up 이면 실패 알림)] → pendingStats
 * (P4-7 수정 라운드 2) markSent 가 throw 하면 발송이 아니라 **기록을** 다시 시도하고, 끝내 못 하면 그 행을 격리한다(recordSent).
 * deadlineMs 가 있으면(즉시 발송) claim 을 한 행씩, 새 행마다 마감을 확인하며 한다. 제공자 Retry-After 는 다음 시도를 그만큼 미룬다.
 * (수정 라운드 3 · P4-7b) 발송 **뒤에** 격리 행 자가 복구(저장된 제공자 id 로 markSent — 발송 아님)가 돈다. 마감이 있으면 복구도 그 안에서만,
 * 복구 실패(목록 조회·markSent)는 로그만 남긴다. 순서: reapStale → claim·send·mark → 자가 복구 → pendingStats.
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

import type { NewOutboxRow, NotifyChannel, OutboxRow } from "../types";
import { planFailureNotice, type FailureNoticeSkipReason } from "./fallback";
import {
  ALL_TEMPLATE_KEYS,
  MAX_ATTEMPTS,
  SENT_UNMARKED_PREFIX,
  claimPending,
  parseSentUnmarked,
  enqueue,
  markFailed,
  markSent,
  quarantineSentUnmarked,
  reapStale,
  retryPlanAfterFailure,
  type MarkFailedOptions,
  type TemplateKey,
} from "./outbox";
import type { NotificationSender, SendOutcome } from "./sender";

// =============================================================================
// 상수
// =============================================================================

/**
 * 1회 실행에서 claim 하는 행 상한 기본값 — 하루 1회 크론(재시도·회수·쓸어 담기)이 쓴다. 실행 시간이 lease(5분) 안에 끝난다.
 * 첫 시도는 P4-7 부터 접수·확정 응답 뒤의 즉시 발송이 더 작은 배치(inline.ts INLINE_WORKER_LIMIT = 5)로 한다.
 */
export const DEFAULT_WORKER_LIMIT = 20;

/**
 * 보냈는데 markSent 가 throw 했을 때 **기록만** 다시 시도하는 간격 (P4-7 수정 라운드 2 · 리뷰 P1-2).
 * 길이 + 1 번 시도한다(첫 시도 + 재시도). 끝내 실패하면 그 행을 격리한다(outbox.ts quarantineSentUnmarked) —
 * 다시 claim 되어 이미 받은 손님에게 또 보내는 일을 막는다. 합(1.25초)은 inline.ts 의 행당 예산에 들어 있다.
 */
export const MARK_SENT_RETRY_DELAYS_MS = [250, 1_000] as const;

/** pendingStats 가 읽는 pending 행 상한. 넘으면 보고서 pendingTruncated 로 드러난다. */
export const PENDING_STATS_SCAN_LIMIT = 1000;

/**
 * pendingStats 가 읽는 컬럼 — 개인정보 컬럼(to_phone) 없음. `last_error` 는 격리 행(보냈지만 기록 못 함)을 적체에서 빼려고 읽는다
 * (수정 라운드 3 · 리뷰 P2-1 — 격리 행은 파기 때까지 pending 이라 "가장 오래된 대기" 를 영구히 가렸다).
 */
export const PENDING_STATS_COLUMNS = "id, created_at, attempts, next_attempt_at, last_error";

/** 한 실행에서 자가 복구를 시도하는 격리 행 상한(수정 라운드 3). 격리는 드문 사고라 작게 둔다. */
export const HEAL_BATCH_LIMIT = 20;

/**
 * 자가 복구 한 건(DB 쓰기 1회)에 잡는 시간 예산 — deadlineMs 가 있을 때(즉시 발송) 복구도 마감을 지킨다(P4-7b · 재검토 P2-R3-4).
 * 목록 조회·행마다 `지금 + 이 값 ≤ 마감` 을 확인한다. 발송(제공자 타임아웃 10초)과 달리 DB 쓰기 한 번이라 짧게 잡았다 —
 * DB 호출에는 타임아웃이 없으므로 추정치다(inline.ts 헤더와 같은 한계).
 */
export const HEAL_ROW_BUDGET_MS = 2_000;

/** 로그·last_error 로 나가는 오류 문구 상한. DB 의 2000자 상한(outbox.ts)보다 훨씬 짧게 — 로그는 덤프가 아니다. */
const ERROR_MAX_CHARS = 200;

const TABLE = "notifications_log";

// =============================================================================
// 포트
// =============================================================================

/**
 * give_up 한 행 하나에 대한 실패 알림 처리 결과 (P4-4).
 *   - enqueued        새 pending 행을 넣었다.
 *   - duplicate       같은 키에 이미 pending/sent 가 있어 넣지 않았다 = **묶였다**(정상).
 *   - enqueue_failed  insert 자체가 실패했다(DB 오류). 실행은 계속한다 — 알림을 못 넣었다고 나머지 행을 멈추지 않는다.
 *   - 그 밖            fallback.ts 의 판정 사유(재귀 차단 포함).
 */
export type FailureNoticeOutcome = "enqueued" | "duplicate" | "enqueue_failed" | FailureNoticeSkipReason;

export type FailureNoticeCounts = Record<FailureNoticeOutcome, number>;

/** 모든 결과를 0 으로 — 키가 조용히 사라지지 않게 매 실행 이 모양에서 시작한다. */
const emptyFailureNoticeCounts = (): FailureNoticeCounts => ({
  enqueued: 0,
  duplicate: 0,
  enqueue_failed: 0,
  recursion: 0,
  not_given_up: 0,
  unknown_event: 0,
  no_reservation: 0,
  no_owner_email: 0,
});

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
  /** `opts.minRetryAfterMs` = 제공자 Retry-After(P4-7 수정 라운드 2). 없으면 세 번째 인자 자체를 넘기지 않는다. */
  markFailed(row: Pick<OutboxRow, "id" | "attempts">, error: string, opts?: MarkFailedOptions): Promise<void>;
  /**
   * 보냈는데 기록을 끝내 못 한 행을 pending 그대로 claim 밖으로 민다(P4-7 수정 라운드 2 · 리뷰 P1-2).
   * `note` = `sent_unmarked:<수신처를 지운 제공자 id>` — last_error 로 간다.
   */
  quarantineSentUnmarked(id: number, note: string): Promise<void>;
  /**
   * 격리된 행(pending + `sent_unmarked:` 표식)을 최대 limit 개 — 자가 복구 대상(수정 라운드 3 · 리뷰 P1-B). 읽는 칸은 id·last_error 뿐.
   */
  listQuarantined(limit: number): Promise<{ id: number; last_error: string | null }[]>;
  /** 행의 현재 status — markSent 재시도 전에 "첫 기록이 사실은 커밋됐나" 를 본다(수정 라운드 3 · 리뷰 P2-2). 행이 없으면 null. */
  rowStatus(id: number): Promise<OutboxRow["status"] | null>;
  /**
   * 사장님 실패 알림 행 하나를 pending 으로 넣는다(P4-4). 반환은 새로 생긴 id 들 — **빈 배열이면 이미 있었다는 뜻**이다
   * (outbox.ts `enqueue` 의 사전 확인: 같은 `(reservation_id, event, channel, template)` 에 pending/sent 가 있으면 넣지 않는다).
   * 그 빈 배열이 곧 "한 예약·한 event 에 알림은 한 번" 이라는 이 태스크의 묶임이다 — 오류가 아니라 정상이다.
   */
  enqueueFailureNotice(row: NewOutboxRow): Promise<number[]>;
  pendingStats(now: Date): Promise<PendingStats>;
}

export interface WorkerOptions {
  /** 기본 true. false 를 명시해야만 reap·claim·send 를 한다. */
  dryRun?: boolean;
  /** 1회 claim 상한. 기본 DEFAULT_WORKER_LIMIT. 1 이상 정수. */
  limit?: number;
  /**
   * 마감 시각(epoch ms) — 있으면 **한 행씩** claim 하고, 새 행을 claim 하기 전에 `지금 + rowBudgetMs ≤ deadlineMs` 를 확인한다
   * (P4-7 수정 라운드 2 · 리뷰 P2-4 — 즉시 발송이 응답 뒤 함수 시간을 무한정 붙들지 않게). 넘으면 멈추고 보고서에 stoppedAtDeadline.
   * 마감 때문에 claim 하지 않은 행은 attempts 가 오르지 않는다(한꺼번에 claim 해 두고 못 보내면 시도가 타 버린다).
   * 없으면 예전처럼 limit 만큼 한 번에 claim 한다(크론).
   */
  deadlineMs?: number;
  /** 한 행을 보내는 데 쓸 수 있는 시간의 추정 상한(ms). deadlineMs 와 함께만 쓴다. 기본 0. */
  rowBudgetMs?: number;
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
  /**
   * sentUnmarked 중 **격리에 성공한** 행 수(P4-7 수정 라운드 2) — 다시 claim 되지 않는다(재발송 없음).
   * sentUnmarked - quarantined 가 0 보다 크면 그 행들은 lease 뒤 다시 잡힐 수 있다(DB 가 기록도 격리도 못 받았다) — error 로그 있음.
   */
  quarantined: number;
  /** 격리 행 중 이번 실행의 자가 복구(저장된 제공자 id 로 markSent)가 sent 로 바꾼 수(수정 라운드 3). 발송은 하지 않았다. */
  healed: number;
  /** deadlineMs 때문에 limit 전에 멈췄다(P4-7 수정 라운드 2). 멈추지 않았으면 키 자체가 없다. */
  stoppedAtDeadline?: true;
  /**
   * **종착한 행마다**(give_up 5회 소진 · reapStale 회수 — 둘 다) 사장님 실패 알림을 어떻게 처리했는지 — 결과별 개수 (P4-4).
   * `enqueued` 가 실제로 넣은 행 수이고, 나머지는 넣지 않은 이유다. 전부 0 이어도 키는 남는다 —
   * 조용히 사라지는 값이 없어야 사람이 "왜 안 왔는가" 를 보고서만 보고 답할 수 있다.
   * 특히 `no_owner_email` 은 OWNER_EMAIL 미설정을 그대로 드러낸다(지어낸 주소로 보내지 않는다).
   */
  failureNotices: FailureNoticeCounts;
  /** 실행 뒤 남은 pending 행 수(scan 상한까지). */
  pending: number;
  pendingTruncated: boolean;
  /** 지금 회수될 행 수 — dry-run 에서 "실행했다면 몇 건 회수됐을지". 실행 뒤에는 보통 0. */
  wouldReap: number;
  /** 가장 오래된 pending 행이 기다린 시간(ms). pending 이 없으면 null. */
  oldestPendingAgeMs: number | null;
  /** 행 id 만 — 감사용. sentUnmarked 는 "보냈는데 못 적은" 행 — 사람이 로그 없이도 중복 수신 가능성을 본다. */
  ids: {
    reaped: number[];
    sent: number[];
    failed: number[];
    duplicate: number[];
    leaseExpired: number[];
    sentUnmarked: number[];
    quarantined: number[];
    healed: number[];
  };
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
  | {
      /** enqueue_failed 만 error — 나머지는 "예상 가능한 결과" 다(재귀 차단·묶임·OWNER_EMAIL 미설정). */
      level: "warn" | "error";
      event: "notify.failure_notice";
      /** 죽은 행의 id. */
      id: number;
      /** 죽은 행의 문안 **키**(개인정보 아님) — 재귀 차단이 걸렸을 때 무엇이 걸렸는지 사람이 읽는다. */
      template: string;
      outcome: FailureNoticeOutcome;
      /** 새로 넣은 알림 행의 id. enqueued 일 때만. */
      noticeId?: number;
      /** enqueue_failed 일 때만 — 수신처를 지우고 200자로 자른 DB 오류 문구. */
      error?: string;
    }
  | {
      /** 보냈는데 기록을 끝내 못 했다(P4-7 수정 라운드 2). quarantined=false 면 다시 claim 되어 중복 발송될 수 있다. */
      level: "error";
      event: "notify.sent_unmarked";
      id: number;
      /** markSent 를 몇 번 시도했나. */
      markSentAttempts: number;
      quarantined: boolean;
      /** 격리 실패 시 — 수신처를 지우고 200자로 자른 DB 오류 문구. */
      error?: string;
    }
  | {
      /**
       * 격리 행 자가 복구(수정 라운드 3 · P4-7b). healed=info · not_transitioned(이미 pending 아님·같은 키 sent 있음)=warn ·
       * error=error(markSent 가 던짐 — 멈춤) · list_failed=error(목록 조회가 던짐 — 그 회차 복구만 건너뜀) ·
       * deferred=info(마감 안에 못 한 나머지 — 다음 실행이 한다). id 는 행 단위 결과에만.
       */
      level: "info" | "warn" | "error";
      event: "notify.heal";
      id?: number;
      outcome: "healed" | "not_transitioned" | "error" | "list_failed" | "deferred";
      /** deferred 일 때 — 이번에 손대지 못한 격리 행 수. */
      remaining?: number;
      error?: string;
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
  /**
   * OWNER_EMAIL — 발송이 끝내 실패했을 때 사장님이 그 사실을 받을 주소 (P4-4).
   * env 를 읽는 곳은 lib/notify/deps.ts 뿐이므로 여기로 주입받는다(P4-1 경계 · P4-7 에서 route.ts 에서 옮김).
   * 비어 있으면 실패 알림을 **넣지 않고** 보고서 `failureNotices.no_owner_email` 로 드러낸다 — 주소를 지어내지 않는다.
   */
  ownerEmail?: string;
  /** 시계 — 행마다 다시 읽는다(lease 판정). 테스트는 고정 시각을 준다. */
  now: () => Date;
  /** 구조화 로그 — 운영은 lib/log.ts structuredLog. */
  log: (entry: WorkerLogEntry) => void;
  /** 기록 재시도 간격용 대기(P4-7 수정 라운드 2). 없으면 setTimeout. 테스트는 기다리지 않는 것을 넣는다. */
  sleep?: (ms: number) => Promise<void>;
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

const isTemplateKey = (t: string): t is TemplateKey => (ALL_TEMPLATE_KEYS as readonly string[]).includes(t);

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

  const deadlineMs = opts.deadlineMs;
  const rowBudgetMs = opts.rowBudgetMs ?? 0;
  if (deadlineMs !== undefined && (!Number.isFinite(deadlineMs) || !Number.isFinite(rowBudgetMs) || rowBudgetMs < 0)) {
    throw new Error("runNotificationWorker: deadlineMs·rowBudgetMs 는 유한한 수여야 한다");
  }
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const ids: WorkerReport["ids"] = {
    reaped: [],
    sent: [],
    failed: [],
    duplicate: [],
    leaseExpired: [],
    sentUnmarked: [],
    quarantined: [],
    healed: [],
  };
  let claimed = 0;
  let gaveUp = 0;
  let markErrors = 0;
  let stoppedAtDeadline = false;
  const failureNotices = emptyFailureNoticeCounts();

  /**
   * 🔴 발송이 **끝내** 실패한 행 하나를 사장님께 알린다 (P4-4).
   * 부르는 자리는 둘 — ① give_up 이 확정되고 markFailed 가 성공한 뒤 ② reapStale 이 회수한 행(둘 다 이미 종착이다).
   *
   * 무엇을 넣을지는 전부 순수 판정(fallback.ts `planFailureNotice`)이 정한다 — 그 안의 **첫 줄이 재귀 차단**이고,
   * 죽은 행 자체가 실패 알림이면 여기서 아무것도 만들지 않는다. give_up 여부도 다시 계산하지 않고
   * 호출부가 이미 가진 `retryPlanAfterFailure` 의 결과를 그대로 넘긴다.
   *
   * 실패 알림을 넣다가 나는 오류는 **이 행에서 끝난다** — 알림을 못 넣었다고 나머지 행의 lease 를 태우지 않는다.
   */
  async function noticeAfterGiveUp(row: OutboxRow, giveUp: boolean): Promise<void> {
    const plan = planFailureNotice(row, { gaveUp: giveUp, ownerEmail: deps.ownerEmail });
    if (!plan.enqueue) {
      failureNotices[plan.reason] += 1;
      log({ level: "warn", event: "notify.failure_notice", id: row.id, template: row.template, outcome: plan.reason });
      return;
    }

    let inserted: number[];
    try {
      inserted = await db.enqueueFailureNotice(plan.row);
    } catch (err) {
      failureNotices.enqueue_failed += 1;
      // 오류 문구는 수신처를 지운 뒤 200자로 자른 것만 싣는다(다른 실패 경로와 같은 규약).
      log({
        level: "error",
        event: "notify.failure_notice",
        id: row.id,
        template: row.template,
        outcome: "enqueue_failed",
        error: errorSummary(err, row.to),
      });
      return;
    }

    if (inserted.length === 0) {
      // 같은 예약·같은 event 의 다른 통지가 이미 알림을 남겼다 — 한 번만 간다(부분 유니크와 enqueue 의 사전 확인).
      failureNotices.duplicate += 1;
      log({ level: "warn", event: "notify.failure_notice", id: row.id, template: row.template, outcome: "duplicate" });
      return;
    }
    failureNotices.enqueued += 1;
    log({ level: "warn", event: "notify.failure_notice", id: row.id, template: row.template, outcome: "enqueued", noticeId: inserted[0] });
  }

  /** 실패 기록 — markFailed 로 되돌리고 send_failed 를 남긴다. give_up 여부는 0005 와 같은 계산(retryPlanAfterFailure)으로 보고서에 적는다. */
  async function recordFailure(
    row: OutboxRow,
    error: string,
    meta: { retryable: boolean; errorName?: string; retryAfterMs?: number },
  ): Promise<void> {
    const plan = retryPlanAfterFailure(Math.max(1, row.attempts));
    try {
      // 제공자가 Retry-After 를 줬으면 다음 시도를 max(백오프, Retry-After) 로 미룬다(P4-7 수정 라운드 2 · 리뷰 P2-5).
      // 없으면 세 번째 인자를 넘기지 않는다(기존 호출 모양 그대로).
      if (meta.retryAfterMs === undefined) await db.markFailed({ id: row.id, attempts: row.attempts }, error);
      else await db.markFailed({ id: row.id, attempts: row.attempts }, error, { minRetryAfterMs: meta.retryAfterMs });
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
    // 종착한 행만 사장님께 알린다 — 매 실패마다 넣으면 한 건에 알림이 다섯 번 간다(P4-4).
    // 값은 위에서 이미 계산한 plan 그대로다.
    //
    // markFailed 가 throw 한 경로는 위에서 return 했으므로 여기 오지 않는다. **그 행이 어떻게 되는지는 attempts 에 달렸다**
    // (2026-09-16 독립 리뷰 중대-1 이 잡은 자리 — 이전 주석은 "lease 만료 뒤 다시 잡힌다" 라고만 적어 사실과 반대였다):
    //   · attempts < MAX_ATTEMPTS  lease 만료 뒤 다시 claim 된다(백오프 없이 조기 재시도, 무해).
    //   · attempts = MAX_ATTEMPTS  claim 의 where 절이 `attempts < 5`(0005·0014)라 **다시 잡히지 않는다.**
    //                              그 행은 reapStale 이 failed 로 종착시키고, 알림은 **회수 경로**가 넣는다(아래 1번 단계).
    if (plan.giveUp) await noticeAfterGiveUp(row, plan.giveUp);
  }

  // 1. 회수 — 발송이 아니므로 sender 구성과 무관. dry-run 은 부작용 0 이라 건너뛴다(wouldReap 로 보고).
  //
  // **회수도 종착이다 — 그래서 여기서도 사장님께 알린다** (2026-09-16 독립 리뷰 중대-1).
  // 이 아웃박스에서 행이 failed 로 끝나는 경로는 둘이고, P4-4 는 처음에 하나(recordFailure → give_up)만 닫았다.
  // 나머지 하나가 이것이다: 5회째 claim 뒤 워커가 mark 없이 죽으면(markSent/markFailed throw, 함수 타임아웃)
  // 행은 `attempts=5 · pending` 으로 남고 claim 의 `attempts < 5` 때문에 **다시 잡히지 않는다.**
  // 0007 reap_stale_notifications 가 그 행을 `failed/lease_expired_after_max_attempts` 로 회수한다 —
  // 즉 통지는 끝내 못 나갔는데 아무도 모른다. **P4-4 가 막으려던 바로 그 상황이다.**
  //
  // 판정은 give_up 경로와 **완전히 같은 함수**(planFailureNotice)를 탄다 — 재귀 차단·유니크 입도·OWNER_EMAIL 부재 처리가
  // 저절로 같아진다. 회수된 행은 이미 종착이므로 gaveUp:true 로 넘긴다(재시도 계획을 다시 계산할 것이 없다).
  // 같은 실행에서 claim 경로도 같은 (예약·event)를 종착시키면 enqueue 의 사전 확인이 두 번째를 duplicate 로 흡수한다.
  if (!dryRun) {
    const reaped = await db.reapStale();
    ids.reaped = reaped.map((r) => r.id);
    for (const r of reaped) await noticeAfterGiveUp(r, true);
  }

  /**
   * 보냈다 — 이제 **기록**한다 (P4-7 수정 라운드 2 · 리뷰 P1-2).
   * markSent 가 throw 하면 발송이 아니라 **기록을** 다시 시도한다(같은 providerMessageId, MARK_SENT_RETRY_DELAYS_MS 간격).
   * 끝내 못 적으면 그 행을 **격리**한다 — pending 으로 두면 lease 뒤 다음 트리거가 다시 집어 이미 받은 손님에게 또 보낸다
   * (문자 제공자는 중복 방지가 없고, 메일 멱등성 키는 24시간 뒤 잊힌다 — 크론이 하루 1회라 그 창을 넘길 수 있다).
   * 격리마저 실패하면(DB 가 완전히 죽음) 그 행은 lease 뒤 다시 잡힐 수 있다 — 그 사실을 error 로그(quarantined:false)로 남긴다.
   * 함수가 send 와 markSent 사이에서 **죽는** 경우(타임아웃·크래시)는 여기서 막을 수 없다 — 보고서 P4-7 §수정 라운드 2 에 남는 위험으로 적었다.
   */
  async function recordSent(row: OutboxRow, providerMessageId: string | null): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MARK_SENT_RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) {
        await sleep(MARK_SENT_RETRY_DELAYS_MS[attempt - 1]);
        // 재시도 전에 **행 상태를 먼저 읽는다**(수정 라운드 3 · 리뷰 P2-2). 앞의 markSent 가 DB 에서는 커밋됐는데 응답만 잃었으면
        // 다시 부른 markSent 는 `where status='pending'` 에 안 걸려 false 를 받고, 그것을 duplicate 로 오분류하게 된다.
        // 읽기도 실패하면(DB 가 여전히 불안정) 예전처럼 markSent 를 다시 시도한다.
        let status: OutboxRow["status"] | null | undefined;
        try {
          status = await db.rowStatus(row.id);
        } catch {
          status = undefined;
        }
        if (status === "sent") {
          ids.sent.push(row.id);
          return;
        }
        if (status === "failed") {
          // 앞의 markSent 가 커밋되며 부분 유니크에 걸려 failed/duplicate_sent 로 남은 경우 — 같은 통지가 이미 sent 다.
          ids.duplicate.push(row.id);
          log({ level: "warn", event: "notify.duplicate_sent", id: row.id, template: row.template });
          return;
        }
      }
      try {
        const transitioned = await db.markSent(row.id, providerMessageId);
        if (transitioned) {
          ids.sent.push(row.id);
        } else {
          ids.duplicate.push(row.id);
          log({ level: "warn", event: "notify.duplicate_sent", id: row.id, template: row.template });
        }
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    // 보냈는데 못 적었다(리뷰 N1). 보고서 sentUnmarked 로 드러내고, 다시 claim 되지 않게 격리한다.
    markErrors += 1;
    ids.sentUnmarked.push(row.id);
    log({ level: "error", event: "notify.mark_failed", id: row.id, op: "markSent", error: errorSummary(lastErr, row.to) });
    // 제공자 id 가 없으면 표식 뒤를 비운다 — 자가 복구가 markSent(id, null) 로 되살린다(outbox.ts parseSentUnmarked).
    const note = `${SENT_UNMARKED_PREFIX}${providerMessageId === null ? "" : scrubError(providerMessageId, row.to)}`;
    const markSentAttempts = MARK_SENT_RETRY_DELAYS_MS.length + 1;
    try {
      await db.quarantineSentUnmarked(row.id, note);
      ids.quarantined.push(row.id);
      log({ level: "error", event: "notify.sent_unmarked", id: row.id, markSentAttempts, quarantined: true });
    } catch (err) {
      log({ level: "error", event: "notify.sent_unmarked", id: row.id, markSentAttempts, quarantined: false, error: errorSummary(err, row.to) });
    }
  }

  /** claim 된 행 하나를 끝까지 처리한다 — 판정 → send → 기록. 행 단위 오류는 이 행에서 끝난다. */
  async function processRow(row: OutboxRow): Promise<void> {
    const decision = claimedDecision(row, deps.now());
    if (decision === "lease_expired") {
      ids.leaseExpired.push(row.id);
      log({ level: "warn", event: "notify.lease_expired", id: row.id, attempts: row.attempts });
      return;
    }
    if (decision === "give_up") {
      await recordFailure(row, "claim_invariant_violated", { retryable: false });
      return;
    }
    if (!isTemplateKey(row.template)) {
      await recordFailure(row, "unknown_template", { retryable: false });
      return;
    }

    let outcome: SendOutcome;
    try {
      outcome = await sender.send({ id: row.id, channel: row.channel, to: row.to, template: row.template, reservationId: row.reservation_id });
    } catch (err) {
      // 예외 문구는 버린다 — 제공자 예외에는 요청 본문(수신처)이 섞이곤 한다. 이름만 남긴다.
      await recordFailure(row, `sender_threw:${sender.name}`, { retryable: true, errorName: err instanceof Error ? err.name : typeof err });
      return;
    }

    if (!outcome.ok) {
      await recordFailure(row, scrubError(outcome.error, row.to), {
        retryable: outcome.retryable,
        ...(outcome.retryAfterMs === undefined ? {} : { retryAfterMs: outcome.retryAfterMs }),
      });
      return;
    }

    await recordSent(row, outcome.providerMessageId);
  }

  // 2. 발송 — 구성된 sender 가 있고, 보낼 수 있는 채널이 있을 때만 claim 한다.
  if (!dryRun && skipped === undefined) {
    if (deadlineMs === undefined) {
      // 크론: limit 만큼 한 번에 claim 한다(기존 동작).
      const rows = await db.claimPending(limit, channels);
      claimed = rows.length;
      for (const row of rows) await processRow(row);
    } else {
      // 즉시 발송(P4-7 수정 라운드 2 · 리뷰 P2-4): 한 행씩 claim 하고, 새 행을 claim 하기 **전에** 마감을 확인한다.
      // 한꺼번에 claim 해 두고 마감에 걸려 못 보내면 그 행들의 attempts 가 타 버린다 — 한 행씩이면 마감 뒤 행은 claim 조차 되지 않는다.
      while (claimed < limit) {
        if (deps.now().getTime() + rowBudgetMs > deadlineMs) {
          stoppedAtDeadline = true;
          break;
        }
        const rows = await db.claimPending(1, channels);
        if (rows.length === 0) break;
        claimed += rows.length;
        for (const row of rows) await processRow(row);
      }
    }
  }

  // 2-b. 격리 행 자가 복구 (수정 라운드 3 · 리뷰 P1-B · P4-7b 재검토 P2-R3-3·4) — **발송이 아니라 기록이다.**
  // 보냈는데 기록을 못 해 격리된 행에 저장된 제공자 id 로 markSent 를 다시 시도한다. DB 가 회복됐으면 행이 sent 가 되어
  // 관리자 통계·발송 내역의 "기록 확인 필요" 에서 사라진다. 0005 mark_notification_sent 는 `where status='pending'` 이라 격리 행을 받는다.
  //   · **발송 뒤에** 돈다(P4-7b): 손님 문자가 기록 정리보다 먼저다. 격리 행은 이미 손님에게 갔고 claim 대상도 아니라 발송과 얽히지 않는다.
  //     즉시 발송의 마감(40초)이 빠듯하면 복구를 먼저 돌려 발송을 밀어내는 쪽이 손해다.
  //   · **마감을 지킨다**(P4-7b): deadlineMs 가 있으면 목록 조회와 행마다 `지금 + HEAL_ROW_BUDGET_MS ≤ 마감` 을 확인하고,
  //     못 한 나머지는 deferred 로그 한 줄로 남긴다 — 다음 즉시 발송이나 하루 1회 크론(마감 없음)이 한다.
  //   · **복구 실패는 로그만 남긴다**: 목록 조회가 던지면 이 회차 복구를 건너뛰고(list_failed), markSent 가 던지면 나머지를 두드리지 않고
  //     멈춘다(error). 어느 쪽도 발송(위 2단계 — 이미 끝났다)이나 실행 보고를 막지 않는다.
  // sender 구성과 무관하게 돈다(기록일 뿐). dry-run 은 부작용 0 이라 건너뛴다.
  if (!dryRun) {
    const withinDeadline = () => deadlineMs === undefined || deps.now().getTime() + HEAL_ROW_BUDGET_MS <= deadlineMs;
    let candidates: { id: number; last_error: string | null }[] = [];
    if (withinDeadline()) {
      try {
        candidates = await db.listQuarantined(HEAL_BATCH_LIMIT);
      } catch (err) {
        log({ level: "error", event: "notify.heal", outcome: "list_failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
      }
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const q = candidates[i];
      const parsed = parseSentUnmarked(q.last_error);
      if (parsed === null) continue; // 방어 — 표식이 아닌 행은 건드리지 않는다
      if (!withinDeadline()) {
        log({ level: "info", event: "notify.heal", outcome: "deferred", remaining: candidates.length - i });
        break;
      }
      try {
        const transitioned = await db.markSent(q.id, parsed.providerMessageId);
        if (transitioned) {
          ids.healed.push(q.id);
          log({ level: "info", event: "notify.heal", id: q.id, outcome: "healed" });
        } else {
          // 이미 pending 이 아니거나, 같은 키에 sent 가 있어 0005 가 failed/duplicate_sent 로 닫았다.
          log({ level: "warn", event: "notify.heal", id: q.id, outcome: "not_transitioned" });
        }
      } catch (err) {
        log({ level: "error", event: "notify.heal", id: q.id, outcome: "error", error: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
        break;
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
    quarantined: ids.quarantined.length,
    healed: ids.healed.length,
    ...(stoppedAtDeadline ? { stoppedAtDeadline: true as const } : {}),
    failureNotices,
    pending: stats.pending,
    pendingTruncated: stats.truncated,
    wouldReap: stats.wouldReap,
    oldestPendingAgeMs,
    ids,
  };

  // 미구성이면 warn 한 줄 — 키가 없는 동안 실행마다(크론·즉시 발송) "보내지 않았다"를 남긴다. 정상 실행은 info.
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
  last_error?: string | null;
}

/** 서비스 롤 클라이언트(lib/supabase/server.ts createServiceClient)를 받는다 — 서버 전용. */
export function supabaseWorkerDb(client: SupabaseClient): WorkerDb {
  return {
    reapStale: () => reapStale(client),
    // 채널 화이트리스트를 0014 RPC 로 그대로 넘긴다(p_channels). 구버전 DB 에는 이 인자가 없다 — 0014 를 먼저 적용해야 한다.
    claimPending: (limit, channels) => claimPending(limit, client, channels),
    markSent: (id, providerMessageId) => markSent(id, providerMessageId, client),
    markFailed: (row, error, opts) => markFailed(row, error, client, opts),
    quarantineSentUnmarked: (id, note) => quarantineSentUnmarked(id, note, client),
    async listQuarantined(limit) {
      const { data, error } = await client
        .from(TABLE)
        .select("id,last_error")
        .eq("status", "pending")
        .like("last_error", `${SENT_UNMARKED_PREFIX}%`)
        .order("id", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`worker.listQuarantined: ${error.message}`);
      return (data ?? []) as { id: number; last_error: string | null }[];
    },
    async rowStatus(id) {
      const { data, error } = await client.from(TABLE).select("status").eq("id", id).limit(1);
      if (error) throw new Error(`worker.rowStatus: ${error.message}`);
      const rows = (data ?? []) as { status: OutboxRow["status"] }[];
      return rows.length === 0 ? null : rows[0].status;
    },
    // 기존 enqueue 를 그대로 쓴다 — 사전 중복 확인(pending/sent 가 있으면 넣지 않음)이 곧 알림의 묶임이다(P4-4).
    enqueueFailureNotice: (row) => enqueue([row], client),
    async pendingStats(now) {
      const { data, error } = await client
        .from(TABLE)
        .select(PENDING_STATS_COLUMNS)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(PENDING_STATS_SCAN_LIMIT);
      if (error) throw new Error(`worker.pendingStats: ${error.message}`);
      const scanned = (data ?? []) as unknown as PendingStatsRow[];
      // 격리 행은 적체가 아니다(보냈다 — 기록만 못 했다). 자가 복구가 따로 다룬다.
      const rows = scanned.filter((r) => parseSentUnmarked(r.last_error) === null);
      const nowMs = now.getTime();
      return {
        pending: rows.length,
        truncated: scanned.length >= PENDING_STATS_SCAN_LIMIT,
        oldestCreatedAt: rows.length > 0 ? rows[0].created_at : null,
        wouldReap: rows.filter((r) => r.attempts >= MAX_ATTEMPTS && new Date(r.next_attempt_at).getTime() <= nowMs).length,
      };
    },
  };
}

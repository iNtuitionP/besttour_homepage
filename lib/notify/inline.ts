/**
 * 즉시 발송 — 접수·확정 **응답 뒤**에 기존 발송기를 한 번 부른다 (플랜 v4 P4-7 · ADR-7).
 *
 * ## 왜 생겼나
 * Vercel 무료(Hobby) 요금제는 하루 1회보다 잦은 크론이 든 vercel.json 을 **빌드 전에 거부**한다. 통지 크론이 5분마다였기 때문에
 * 2026-09-13 부터 모든 커밋이 배포되지 않았다(컨트롤러 실험으로 확정 — docs/ops/environments.md). 사용자 결정(2026-09-26):
 * 첫 시도는 접수·확정 직후에, 크론은 하루 1회 재시도·회수로. Pro 로 가도 이 구조는 그대로 쓴다.
 *
 * ## 🔴 아웃박스가 유일한 길이다
 * 여기에는 발송 코드가 없다. sender 를 부르지 않고, 행을 만들지도 않는다 — 이미 있는 `runNotificationWorker`
 * (reap → claim → send → mark)를 **작은 배치로** 부를 뿐이다. 그래서 중복 방지 3층(enqueue 사전 확인 · claim 의
 * `for update skip locked` + lease · 부분 유니크 sent_once)과 미구성 규칙(sender 가 없으면 claim 하지 않는다)이 그대로 걸린다.
 *
 * ## 접수·확정의 성공은 발송과 무관하다
 * 이 모듈은 `runAfter` 에 작업을 맡기기만 한다 — 응답은 이미 나갔다. 작업 안의 예외는 전부 여기서 끝나고
 * **구조화 로그 한 줄**(`notify.inline_failed`)로 남는다. 서비스 롤 클라이언트도 응답 뒤, try 안에서 만든다.
 *
 * ## 꺼져 있으면 아무것도 하지 않는다 (fail-safe)
 * 스위치는 `NOTIFY_INLINE` 이 **정확히 "1"** 일 때만 켜진다(판정은 `isInlineNotifyOn`, env 를 읽는 곳은 deps.ts).
 * 꺼져 있으면 runAfter 에 아무것도 맡기지 않는다. 프리뷰·로컬의 기본값이다.
 *
 * ## 시간 — 마감 시각 하나로 묶는다 (P4-7 수정 라운드 2 · 리뷰 P2-4)
 * 호출 시작부터 `INLINE_DEADLINE_MS`(40초) 뒤가 마감이다. 워커에 `deadlineMs`·`rowBudgetMs` 를 넘기면 워커는 **한 행씩** claim 하고,
 * 새 행을 claim 하기 전에 `지금 + 행당 예산 ≤ 마감` 을 확인한다(worker.ts). 행당 예산 `INLINE_ROW_BUDGET_MS`(12초)는
 * 제공자 타임아웃(10초) + 기록 재시도 간격(1.25초)을 덮는다. 그래서 **새 행은 마감 12초 전까지만 시작되고**, 한 행이 예산 안에
 * 끝나는 한 전체는 마감 안에 끝난다. 예산이 덮지 못하는 것: DB 호출(claim·문안 변수 조회·mark)에는 타임아웃이 없다 —
 * DB 가 멈추면 이 작업도 멈춘다. 그 경우는 서버리스 함수의 시간 한도가 끊는다.
 * 🔴 **끊기면 중복 발송이 날 수 있다**(수정 라운드 3 · 리뷰 P2-3 — 예전 주석은 "잃는 것은 없다" 라고만 적어 이 쪽을 빠뜨렸다):
 * send 가 끝난 뒤 markSent 전에 잘리면 그 행은 pending 으로 남아 lease 뒤 다시 잡히고 **손님이 두 번 받는다**(대기 중에 잘린 행은
 * 백오프 pending 이라 무해). 그래서 즉시 발송이 도는 두 화면(/quote · 관리자 예약 상세)에 `maxDuration = 60` 을 명시했다 —
 * 마감 40초보다 길고 Hobby 의 어느 설정에서도 받아들여지는 값이다. 실제 배포의 한도는 운영 전환 전에 확인해야 한다(오픈 게이트).
 * 한 행씩 claim 하므로 한 행의 lease(5분)가 처리 중에 만료되는 일은 행당 예산(12초) 기준으로 없다 — 이 이상의 주장은 하지 않는다.
 * 워커의 격리 행 자가 복구(발송 아님 — DB 쓰기)도 같은 마감을 받는다(P4-7b): 발송 **뒤에**, 건마다 `지금 + 2초 ≤ 마감` 일 때만 돌고,
 * 남은 것은 다음 실행(크론은 마감 없음)으로 넘긴다. 단 마감 직전에 시작한 마지막 발송 행이 예산(12초)을 다 쓰면 복구는 이 회차에 돌지 않는다.
 *
 * ## 재시도 간격의 대가 — 짧은 재시도 1회 (브리프 §4 ㄱ)
 * 크론이 하루 1회라 첫 시도가 실패하면 다음 시도가 최대 하루 뒤다. 그래서 첫 실행에서 **재시도 대기 행**
 * (`failed - gaveUp` > 0)이 생기면 첫 백오프(outbox.ts `BACKOFF_MS[0]`) + 2초를 기다렸다가 **두 번째 패스**를 한 번 더 부른다 —
 * 단 `지금 + 대기 + 행당 예산 ≤ 마감` 일 때만. 아니면 warn 한 줄을 남기고 멈춘다.
 * 정확히는(수정 라운드 3 · 리뷰 P2-4): 첫 패스는 한 행씩 claim 하므로, 앞 행이 실패해 백오프(10초)가 지난 뒤에도 첫 패스가 아직 돌고 있으면
 * **같은 첫 패스가 그 행을 다시 집을 수 있다**(두 번째 패스가 아니라). 어느 쪽이든 한 호출 안에서 **한 행은 최대 2회** 시도된다 —
 * 두 번째 실패의 백오프(5분)가 마감(40초)보다 길어 세 번째로 집힐 수 없기 때문이다. `failed` 는 행이 아니라 markFailed 호출을 세므로
 * 두 번째 패스의 limit 이 부풀 수 있지만(상한 INLINE_WORKER_LIMIT), 이미 두 번 시도된 행은 claim 대상이 아니라 무해하다.
 * 또 claim 은 표 전체 FIFO 라 적체(제공자 장애 뒤 밀린 due 행)가 있으면 즉시 발송도 **오래된 행부터** 집는다 — 행마다 타임아웃이면
 * 마감 안에 3행만 시작되고, 방금 접수한 손님의 첫 문자는 다음 트리거(최악 다음 날 크론)로 밀릴 수 있다(리뷰 P2-5).
 * 평범한 제공자 타임아웃 한 번(10초) 뒤에도 10 + 12 + 12 = 34 ≤ 40 이라 재시도가 돈다.
 * 제공자가 Retry-After 로 더 오래 기다리라 했으면 그 행의 next_attempt_at 이 그만큼 뒤라(worker → markFailed minRetryAfterMs)
 * 두 번째 claim 이 그 행을 집지 않는다 — 시도를 태우지 않고 지나간다.
 * 10초 대기로 풀리는 오류가 얼마나 되는지는 실측하지 않았다(제공자 키가 없다). 풀리지 않으면 시도 1회를 쓸 뿐이다.
 * 재귀 차단(P4-4)은 건드리지 않는다: 두 번째 실행도 같은 워커이고, 실패 알림 판정(fallback.ts)은 워커 안에 그대로 있다.
 *
 * ## 회수(reap)도 한다
 * 워커는 `dryRun:false` 이면 매 실행 시작에 reapStale 을 먼저 돈다 — 즉시 발송도 그 경로를 그대로 탄다.
 * 크론이 하루 1회라 늦어지는 회수·실패 알림을 접수·확정이 있을 때마다 당긴다. 회수는 발송이 아니고(sender 무관) RPC 한 번이다.
 *
 * 순수 모듈 — env 없음, server-only 없음, next import 없음. runAfter·워커·시계·sleep·로그는 전부 deps 로 받는다.
 */
import type { NotifyEvent } from "../types";
import { BACKOFF_MS } from "./outbox";
import type { WorkerDeps, WorkerOptions, WorkerReport } from "./worker";

// =============================================================================
// 상수
// =============================================================================

/** 스위치가 켜지는 유일한 값. `"true"`·`" 1"`·`"01"` 은 꺼짐이다 — 오타가 발송을 켜지 않게. */
export const NOTIFY_INLINE_ON = "1";

/**
 * 즉시 발송 1회의 claim 상한. 한 접수가 만드는 행은 최대 2건(사장님·고객), 확정은 1건이다 — 5면 제 몫을 다 집고
 * 밀린 재시도 몇 건까지 덤으로 처리한다. 표 전체를 비우려 하지 않는다 — 적체는 하루 1회 크론(기본 20)의 몫이다.
 */
export const INLINE_WORKER_LIMIT = 5;

/**
 * 짧은 재시도 전 대기. 첫 백오프(BACKOFF_MS[0]) 이상이어야 두 번째 claim 이 그 행을 집는다
 * (0005 claim 의 `next_attempt_at <= now()`). 2초는 markFailed 의 now() 와 다음 claim 의 now() 사이 여유다.
 */
export const INLINE_RETRY_DELAY_MS = BACKOFF_MS[0] + 2_000;

/**
 * 한 행을 처리하는 데 쓸 수 있는 시간의 추정 상한 — 제공자 타임아웃(문자·메일 어댑터 모두 10초) + 기록 재시도 간격(worker 1.25초) + 여유.
 * 테스트가 두 타임아웃·기록 재시도 간격과 대조한다. DB 호출 시간은 이 추정에 들어 있지 않다(타임아웃이 없다 — 헤더 참조).
 */
export const INLINE_ROW_BUDGET_MS = 12_000;

/**
 * 호출 시작부터의 마감. 새 행은 `마감 - 행당 예산` 전에만 시작된다. 제공자 타임아웃 한 번 + 재시도 대기 + 한 행(34초)이 들어가게 잡았다.
 * 서버리스 함수의 실제 시간 한도(요금제·Fluid 설정마다 다르다)는 확인하지 못했다 — 보고서 §8.
 */
export const INLINE_DEADLINE_MS = 40_000;

/** 로그로 나가는 오류 문구 상한 — worker.ts ERROR_MAX_CHARS 와 같은 값. 로그는 덤프가 아니다. */
const MESSAGE_MAX_CHARS = 200;

// =============================================================================
// 포트
// =============================================================================

/** 즉시 발송을 부른 사건 — 통지 event 와 같은 어휘다(접수 = created, 확정 = confirmed). */
export type InlineTrigger = NotifyEvent;

/** 이 모듈이 남기는 로그의 전부. 수신처·이름·문안은 없다 — 워커 자신의 실행 로그(notify.worker_run)는 워커가 남긴다. */
export type InlineLogEntry =
  | {
      level: "error";
      event: "notify.inline_failed";
      trigger: InlineTrigger;
      /** 예외의 name. */
      errorName: string;
      /** 예외 문구 — 200자로 자른다(outbox.* 오류는 코드·메시지뿐이다). */
      message: string;
    }
  | {
      level: "warn";
      event: "notify.inline_retry_skipped";
      trigger: InlineTrigger;
      /** 첫 실행이 쓴 시간(ms). */
      elapsedMs: number;
      /** 재시도를 기다리는 행 수 — 다음 즉시 발송이나 하루 1회 크론이 집는다. */
      retryPending: number;
    };

export interface InlineRunDeps {
  /** 워커 deps(서비스 롤 클라이언트·sender·OWNER_EMAIL)를 만든다 — 응답 뒤, try 안에서 부른다. */
  workerDeps: () => WorkerDeps;
  /** 운영은 runNotificationWorker. */
  run: (opts: WorkerOptions, deps: WorkerDeps) => Promise<WorkerReport>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  /** 운영은 lib/log.ts structuredLog. */
  log: (entry: InlineLogEntry) => void;
}

export interface InlineScheduleDeps extends InlineRunDeps {
  /** inlineNotifyEnabled() 의 결과(deps.ts — NOTIFY_INLINE 과 테스트 가드). */
  enabled: boolean;
  /** 운영은 lib/ports/after.ts runAfter(= next/server after). */
  runAfter: (task: () => Promise<void>) => void;
}

/** 한 번의 즉시 발송이 워커를 몇 번 불렀는가. 0 = 워커에 닿기 전에 실패했다(로그 있음). */
export interface InlineOutcome {
  passes: 0 | 1 | 2;
  /** 재시도 대기 행이 있었지만 마감 안에 대기 + 한 행이 들어가지 않아 기다리지 않았다. */
  retrySkipped?: "deadline";
}

// =============================================================================
// 순수
// =============================================================================

/** 스위치 판정 — 정확히 "1" 만 켜짐. 없음·빈값·그 밖은 전부 꺼짐(fail-safe). */
export function isInlineNotifyOn(value: string | undefined): boolean {
  return value === NOTIFY_INLINE_ON;
}

/**
 * 응답 뒤에 즉시 발송을 맡긴다. 꺼져 있으면 **아무것도 맡기지 않고** false.
 * 켜져 있으면 작업 하나를 runAfter 에 맡기고 true — 이 함수 자신은 워커를 부르지 않는다(응답 전이다).
 */
export function scheduleInlineNotify(trigger: InlineTrigger, deps: InlineScheduleDeps): boolean {
  if (!deps.enabled) return false;
  deps.runAfter(async () => {
    await runInlineNotify(trigger, deps);
  });
  return true;
}

/**
 * 응답 뒤의 본체. **절대 reject 하지 않는다** — 모든 예외는 `notify.inline_failed` 한 줄로 끝난다.
 * 순서: 워커 deps 생성 → 워커(limit 5, 마감) → [재시도 대기 행이 있고 대기 + 한 행이 마감 안이면] 대기 → 워커(재시도 행 수, 같은 마감).
 */
export async function runInlineNotify(trigger: InlineTrigger, deps: InlineRunDeps): Promise<InlineOutcome> {
  let passes: InlineOutcome["passes"] = 0;
  try {
    const startedMs = deps.now().getTime();
    const deadlineMs = startedMs + INLINE_DEADLINE_MS;
    const workerDeps = deps.workerDeps();

    const first = await deps.run({ dryRun: false, limit: INLINE_WORKER_LIMIT, deadlineMs, rowBudgetMs: INLINE_ROW_BUDGET_MS }, workerDeps);
    passes = 1;

    // markFailed 가 give_up 이 아닌 실패를 pending 으로 되돌렸다 = 첫 백오프 뒤에 다시 집힐 수 있는 행.
    const retryPending = first.failed - first.gaveUp;
    if (retryPending <= 0) return { passes };

    const nowMs = deps.now().getTime();
    if (nowMs + INLINE_RETRY_DELAY_MS + INLINE_ROW_BUDGET_MS > deadlineMs) {
      deps.log({ level: "warn", event: "notify.inline_retry_skipped", trigger, elapsedMs: nowMs - startedMs, retryPending });
      return { passes, retrySkipped: "deadline" };
    }

    await deps.sleep(INLINE_RETRY_DELAY_MS);
    await deps.run(
      { dryRun: false, limit: Math.min(retryPending, INLINE_WORKER_LIMIT), deadlineMs, rowBudgetMs: INLINE_ROW_BUDGET_MS },
      workerDeps,
    );
    passes = 2;
    return { passes };
  } catch (err) {
    deps.log({
      level: "error",
      event: "notify.inline_failed",
      trigger,
      errorName: err instanceof Error ? err.name : typeof err,
      message: (err instanceof Error ? err.message : String(err)).slice(0, MESSAGE_MAX_CHARS),
    });
    return { passes };
  }
}

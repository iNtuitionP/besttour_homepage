/**
 * P4-7 — 통지를 "접수·확정 즉시 발송 + 하루 1회 재시도 크론" 으로 (Vercel 무료 요금제 크론 제한 대응).
 *
 * 왜: Vercel Hobby 는 하루 1회보다 잦은 크론이 든 vercel.json 을 **빌드 전에 거부**한다. 5분 크론(`*\/5 * * * *`) 때문에
 * 2026-09-13 부터 모든 커밋이 배포되지 않았다(컨트롤러 실험으로 확정 — docs/ops/environments.md).
 * 그래서 첫 시도는 접수·확정 **응답 뒤**(runAfter)에 기존 워커를 한 번 부르고, 크론은 하루 1회 재시도·회수만 맡는다.
 *
 * 이 파일이 잠그는 것:
 *   1. 스위치 — NOTIFY_INLINE 이 정확히 "1" 일 때만 켜진다. 그 밖(없음·빈값·"0"·"true"·" 1"…)은 꺼짐 = 아무것도 하지 않는다
 *   2. 순수 스케줄러(lib/notify/inline.ts) — 응답 뒤에만 워커를 부른다 · 던져도 삼키고 구조화 로그 1줄 · 짧은 재시도 1회(예산 안에서만)
 *   3. 켜져 있어도 sender 미구성이면 claim 0 (attempts 를 태우지 않는다 — worker.ts 대원칙)
 *   4. 배선(lib/notify/deps.ts) — env 를 읽어 스위치·sender·워커 deps 를 만든다
 *   5. 호출 지점 — 공개 접수 성공 뒤 · 관리자 확정 성공 뒤에만. 실패·noop·취소·완료·메모는 부르지 않는다
 *   6. vercel.json — 모든 크론이 하루 1회 이하(분·시 필드가 고정 정수). 5분 크론이 다시 들어오면 여기서 빨개진다
 *   7. 정적 — env 경계 · 서비스 롤 경계 · .env.example
 *
 * 실제 발송 0: sender 는 memory·unconfigured·가짜뿐이다. DB 는 가짜 클라이언트(실DB 실증은 tests/notify-inline.db.test.ts).
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** runAfter 에 맡겨진 작업 — 테스트가 "응답이 나간 뒤" 를 흉내 내어 직접 돌린다. */
  afterTasks: [] as Array<() => void | Promise<void>>,
  /** 가짜 서비스 롤 클라이언트가 받은 RPC 이름. */
  rpcs: [] as string[],
  /** claim RPC 가 돌려줄 행. */
  claim: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "localhost", "x-forwarded-for": "203.0.113.7" })),
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/ports/after", () => ({
  runAfter: vi.fn((task: () => void | Promise<void>) => {
    h.afterTasks.push(task);
  }),
}));
vi.mock("@/lib/ports/revalidate", () => ({ revalidate: vi.fn() }));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));
vi.mock("@/lib/guard", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/guard")>()), runGuards: vi.fn() }));
vi.mock("@/lib/guard/deps", () => ({ defaultGuardDeps: vi.fn(() => ({})) }));
vi.mock("@/lib/reservations/create", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reservations/create")>()),
  createReservation: vi.fn(),
}));
vi.mock("@/lib/reservations/db", () => ({ supabaseReservationDb: vi.fn(() => ({ kind: "fake-reservation-db" })) }));
vi.mock("@/lib/supabase/ssr", () => ({ createSsrClient: vi.fn() }));
vi.mock("@/lib/auth/requireAdmin", () => ({ requireAdmin: vi.fn(async () => ({ userId: "admin-uuid", email: "owner@example.test" })) }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({
    rpc(fn: string) {
      h.rpcs.push(fn);
      if (fn === "claim_pending_notifications") return Promise.resolve({ data: h.claim.splice(0), error: null });
      if (fn === "mark_notification_sent") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: [], error: null });
    },
    from() {
      const b: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "like", "order", "limit"]) b[op] = () => b;
      b.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, err);
      return b;
    },
  })),
}));
// 워커는 기본으로 **진짜**다(스위치·미구성 규칙을 실제 코드로 본다). 던지는 경우만 테스트가 한 번씩 바꿔 끼운다.
vi.mock("@/lib/notify/worker", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/notify/worker")>();
  return { ...mod, runNotificationWorker: vi.fn(mod.runNotificationWorker) };
});

import { cancelReservation, completeReservation, confirmReservation, saveReservationMemo } from "@/actions/admin/reservation";
import { submitReservation } from "@/actions/reservation";
import { runGuards } from "@/lib/guard";
import { structuredLog } from "@/lib/log";
import { notifyAfterResponse } from "@/lib/notify/deps";
import {
  INLINE_DEADLINE_MS,
  INLINE_RETRY_DELAY_MS,
  INLINE_ROW_BUDGET_MS,
  INLINE_WORKER_LIMIT,
  isInlineNotifyOn,
  runInlineNotify,
  scheduleInlineNotify,
  type InlineLogEntry,
  type InlineRunDeps,
} from "@/lib/notify/inline";
import { RESEND_TIMEOUT_MS } from "@/lib/notify/mail";
import { BACKOFF_MS, MAX_ATTEMPTS } from "@/lib/notify/outbox";
import { MEMORY_SENDER_NAME, UNCONFIGURED_SENDER_NAME, unconfiguredSender } from "@/lib/notify/sender";
import { SOLAPI_TIMEOUT_MS } from "@/lib/notify/solapi";
import {
  DEFAULT_WORKER_LIMIT,
  MARK_SENT_RETRY_DELAYS_MS,
  runNotificationWorker,
  type WorkerDb,
  type WorkerDeps,
  type WorkerReport,
} from "@/lib/notify/worker";
import { runAfter } from "@/lib/ports/after";
import { createReservation } from "@/lib/reservations/create";
import { createSsrClient } from "@/lib/supabase/ssr";
import type { ReservationInput } from "@/lib/types";

import { allowInlineNotifyInTests } from "./helpers/notify-env";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

const RES_ID = "22222222-2222-4222-8222-222222222222";
const ENV_KEYS = [
  "NOTIFY_INLINE",
  "NOTIFY_SENDER",
  "VERCEL_ENV",
  "SOLAPI_API_KEY",
  "SOLAPI_API_SECRET",
  "SMS_SENDER",
  "RESEND_API_KEY",
  "MAIL_FROM",
  "OWNER_PHONE",
  "OWNER_EMAIL",
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  h.afterTasks.length = 0;
  h.rpcs.length = 0;
  h.claim.length = 0;
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // 실제 제공자 키가 우연히 남아 있어도 이 파일은 제공자에 닿지 않는다 — 전부 비우고 시작한다.
  // delete 가 아니라 "" 다: loadDotEnvLocal 은 undefined 만 채운다(tests/helpers/notify-env.ts).
  for (const k of ENV_KEYS) process.env[k] = "";
});

// 이 파일은 즉시 발송 배선 자체를 시험한다 — NODE_ENV=test 가드(lib/notify/deps.ts)를 이 파일에서만 명시적으로 푼다.
// sender 는 memory·unconfigured 뿐이고 서비스 롤 클라이언트는 가짜다(위 vi.mock).
allowInlineNotifyInTests();

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** 응답이 나간 뒤 — runAfter 에 맡겨진 작업을 순서대로 끝까지 돌린다. */
async function flushAfter(): Promise<void> {
  while (h.afterTasks.length > 0) {
    const task = h.afterTasks.shift();
    if (task) await task();
  }
}

const inlineLogs = () =>
  vi
    .mocked(structuredLog)
    .mock.calls.map((c) => c[0] as { event?: string; level?: string })
    .filter((e) => typeof e.event === "string" && e.event.startsWith("notify.inline_"));

function report(over: Partial<WorkerReport> = {}): WorkerReport {
  return {
    dryRun: false,
    sender: "fake",
    channels: ["sms"],
    nowIso: "2026-09-26T00:00:00.000Z",
    limit: INLINE_WORKER_LIMIT,
    reaped: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    gaveUp: 0,
    duplicate: 0,
    leaseExpired: 0,
    markErrors: 0,
    sentUnmarked: 0,
    healed: 0,
    quarantined: 0,
    failureNotices: {
      enqueued: 0,
      duplicate: 0,
      enqueue_failed: 0,
      recursion: 0,
      not_given_up: 0,
      unknown_event: 0,
      no_reservation: 0,
      no_owner_email: 0,
    },
    pending: 0,
    pendingTruncated: false,
    wouldReap: 0,
    oldestPendingAgeMs: null,
    ids: { reaped: [], sent: [], failed: [], duplicate: [], leaseExpired: [], sentUnmarked: [], quarantined: [], healed: [] },
    ...over,
  };
}

// =============================================================================
// 1. 스위치 — "1" 만 켜짐
// =============================================================================
describe("1. NOTIFY_INLINE 스위치 — 정확히 \"1\" 일 때만 켜진다 (fail-safe)", () => {
  test('"1" 은 켜짐', () => {
    expect(isInlineNotifyOn("1")).toBe(true);
  });

  test.each([undefined, "", "0", "true", "TRUE", "yes", "on", " 1", "1 ", "01", "2"])("%j 는 꺼짐", (value) => {
    expect(isInlineNotifyOn(value)).toBe(false);
  });
});

// =============================================================================
// 2. 순수 스케줄러 — lib/notify/inline.ts
// =============================================================================
describe("2. scheduleInlineNotify · runInlineNotify (순수)", () => {
  interface Harness {
    deps: InlineRunDeps & { enabled: boolean; runAfter: (task: () => Promise<void>) => void };
    tasks: Array<() => Promise<void>>;
    logs: InlineLogEntry[];
    sleeps: number[];
    run: ReturnType<typeof vi.fn>;
    workerDeps: ReturnType<typeof vi.fn>;
    clock: { ms: number };
  }

  function harness(opts: { enabled?: boolean; reports?: Array<WorkerReport | Error>; stepMs?: number } = {}): Harness {
    const tasks: Array<() => Promise<void>> = [];
    const logs: InlineLogEntry[] = [];
    const sleeps: number[] = [];
    const clock = { ms: Date.parse("2026-09-26T00:00:00.000Z") };
    const queue = [...(opts.reports ?? [report()])];
    const run = vi.fn(async () => {
      clock.ms += opts.stepMs ?? 0;
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next as WorkerReport;
    });
    const workerDeps = vi.fn(() => ({ fake: true }) as unknown as WorkerDeps);
    return {
      tasks,
      logs,
      sleeps,
      run,
      workerDeps,
      clock,
      deps: {
        enabled: opts.enabled ?? true,
        runAfter: (task) => {
          tasks.push(task);
        },
        workerDeps,
        run,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock.ms += ms;
        },
        now: () => new Date(clock.ms),
        log: (e) => {
          logs.push(e);
        },
      },
    };
  }

  test("꺼져 있으면 runAfter 에 아무것도 맡기지 않고 워커 deps 도 만들지 않는다", () => {
    const hs = harness({ enabled: false });
    expect(scheduleInlineNotify("created", hs.deps)).toBe(false);
    expect(hs.tasks).toHaveLength(0);
    expect(hs.workerDeps).not.toHaveBeenCalled();
    expect(hs.run).not.toHaveBeenCalled();
  });

  test("켜져 있으면 작업 1개를 맡길 뿐 — 응답 전에는 워커를 부르지 않는다", async () => {
    const hs = harness();
    expect(scheduleInlineNotify("created", hs.deps)).toBe(true);
    expect(hs.tasks).toHaveLength(1);
    expect(hs.run).not.toHaveBeenCalled();
    expect(hs.workerDeps).not.toHaveBeenCalled(); // 서비스 롤 클라이언트도 응답 뒤에 만든다

    const start = hs.clock.ms;
    await hs.tasks[0]();
    expect(hs.run).toHaveBeenCalledTimes(1);
    // 마감 시각과 행당 예산을 워커에 넘긴다 — 워커가 새 행을 시작하기 전에 마감을 확인한다(P4-7 수정 라운드 2 · P2-4)
    expect(hs.run).toHaveBeenCalledWith(
      { dryRun: false, limit: INLINE_WORKER_LIMIT, deadlineMs: start + INLINE_DEADLINE_MS, rowBudgetMs: INLINE_ROW_BUDGET_MS },
      { fake: true },
    );
  });

  test("작은 배치다 — limit 은 5 이하이고 크론 기본값보다 작다", () => {
    expect(INLINE_WORKER_LIMIT).toBe(5);
    expect(INLINE_WORKER_LIMIT).toBeLessThan(DEFAULT_WORKER_LIMIT);
  });

  test("워커가 던져도 작업은 reject 하지 않는다 — error 로그 1줄(trigger·오류 이름) · 개인정보 없음", async () => {
    const hs = harness({ reports: [new Error("outbox.claimPending: [42501] permission denied")] });
    scheduleInlineNotify("confirmed", hs.deps);
    await expect(hs.tasks[0]()).resolves.toBeUndefined();
    expect(hs.logs).toHaveLength(1);
    expect(hs.logs[0]).toMatchObject({ level: "error", event: "notify.inline_failed", trigger: "confirmed", errorName: "Error" });
    expect(JSON.stringify(hs.logs[0])).toMatch(/claimPending/);
  });

  test("워커 deps 를 만들다 던져도(서비스 롤 env 누락 등) 삼키고 로그 1줄", async () => {
    const hs = harness();
    hs.workerDeps.mockImplementation(() => {
      throw new Error("createServiceClient: missing url");
    });
    scheduleInlineNotify("created", hs.deps);
    await expect(hs.tasks[0]()).resolves.toBeUndefined();
    expect(hs.run).not.toHaveBeenCalled();
    expect(hs.logs).toEqual([expect.objectContaining({ level: "error", event: "notify.inline_failed", trigger: "created" })]);
  });

  test("로그 문구는 200자로 자른다 — 오류 덤프가 통째로 나가지 않는다", async () => {
    const hs = harness({ reports: [new Error("x".repeat(5000))] });
    await runInlineNotify("created", hs.deps);
    const entry = hs.logs[0] as Extract<InlineLogEntry, { event: "notify.inline_failed" }>;
    expect(entry.message.length).toBeLessThanOrEqual(200);
  });

  // ── 재시도 간격 대가(브리프 §4) — ㄱ: 호출 안의 짧은 재시도 1회 ────────────
  test("첫 실행에 재시도 대기 행이 생기면(failed > gaveUp) 백오프만큼 기다렸다 한 번 더 돈다 — 딱 한 번, 같은 마감 · 재시도 행 수만큼만", async () => {
    const hs = harness({ reports: [report({ claimed: 3, failed: 2, gaveUp: 0, sent: 1 }), report({ claimed: 1, failed: 1, gaveUp: 0 })] });
    const start = hs.clock.ms;
    const outcome = await runInlineNotify("created", hs.deps);
    expect(hs.run).toHaveBeenCalledTimes(2);
    expect(hs.sleeps).toEqual([INLINE_RETRY_DELAY_MS]);
    expect(outcome).toEqual({ passes: 2 });
    expect(hs.run.mock.calls[1][0]).toEqual({ dryRun: false, limit: 2, deadlineMs: start + INLINE_DEADLINE_MS, rowBudgetMs: INLINE_ROW_BUDGET_MS });
    // 두 번째도 실패했지만 세 번째는 없다 — 그 뒤는 다음 즉시 발송이나 하루 1회 크론의 몫이다
  });

  test("평범한 제공자 타임아웃(10초) 한 번으로는 재시도가 건너뛰어지지 않는다 — 10 + 12 + 12 ≤ 마감", async () => {
    const hs = harness({ reports: [report({ claimed: 1, failed: 1 }), report({ claimed: 1, sent: 1 })], stepMs: Math.max(SOLAPI_TIMEOUT_MS, RESEND_TIMEOUT_MS) });
    expect(await runInlineNotify("created", hs.deps)).toEqual({ passes: 2 });
    expect(hs.sleeps).toEqual([INLINE_RETRY_DELAY_MS]);
  });

  test("재시도 대기 행이 없으면(전부 성공 · 전부 give_up · 미구성) 기다리지 않는다", async () => {
    for (const r of [
      report({ claimed: 2, sent: 2 }),
      report({ claimed: 1, failed: 1, gaveUp: 1 }),
      report({ skipped: "sender_not_configured" }),
    ]) {
      const hs = harness({ reports: [r] });
      expect(await runInlineNotify("created", hs.deps)).toEqual({ passes: 1 });
      expect(hs.run).toHaveBeenCalledTimes(1);
      expect(hs.sleeps).toEqual([]);
    }
  });

  test("대기 + 한 행이 마감을 넘기면 재시도하지 않고 warn 로그 1줄", async () => {
    // 첫 실행이 마감을 많이 쓴 경우(제공자 타임아웃이 여러 번 겹친 경우)
    const hs = harness({ reports: [report({ claimed: 1, failed: 1 })], stepMs: INLINE_DEADLINE_MS - INLINE_RETRY_DELAY_MS - INLINE_ROW_BUDGET_MS + 1 });
    expect(await runInlineNotify("created", hs.deps)).toEqual({ passes: 1, retrySkipped: "deadline" });
    expect(hs.run).toHaveBeenCalledTimes(1);
    expect(hs.sleeps).toEqual([]);
    expect(hs.logs).toEqual([expect.objectContaining({ level: "warn", event: "notify.inline_retry_skipped", trigger: "created", retryPending: 1 })]);
  });

  test("상수 — 재시도 대기 ≥ 첫 백오프 · 행당 예산 ≥ 제공자 타임아웃 + 기록 재시도 간격 · 마감 ≥ 타임아웃 한 번 + 대기 + 한 행", () => {
    // 대기가 첫 백오프보다 짧으면 두 번째 claim 이 그 행을 집지 못한다(0005 next_attempt_at <= now())
    expect(INLINE_RETRY_DELAY_MS).toBeGreaterThanOrEqual(BACKOFF_MS[0]);
    expect(INLINE_ROW_BUDGET_MS).toBeGreaterThanOrEqual(
      Math.max(SOLAPI_TIMEOUT_MS, RESEND_TIMEOUT_MS) + MARK_SENT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0),
    );
    expect(INLINE_DEADLINE_MS).toBeGreaterThanOrEqual(Math.max(SOLAPI_TIMEOUT_MS, RESEND_TIMEOUT_MS) + INLINE_RETRY_DELAY_MS + INLINE_ROW_BUDGET_MS);
  });

  test("짧은 재시도는 attempts 를 하나 더 쓸 뿐 한도(5)와 give_up 규칙은 그대로다", () => {
    expect(MAX_ATTEMPTS).toBe(5);
    expect(BACKOFF_MS).toHaveLength(5);
  });
});

// =============================================================================
// 3. 켜져 있어도 sender 미구성이면 claim 0
// =============================================================================
describe("3. 켜져 있어도 sender 미구성이면 claim 0 — attempts 를 태우지 않는다", () => {
  function recordingDb(): { db: WorkerDb; calls: string[] } {
    const calls: string[] = [];
    const db: WorkerDb = {
      reapStale: async () => {
        calls.push("reapStale");
        return [];
      },
      claimPending: async () => {
        calls.push("claimPending");
        return [];
      },
      markSent: async () => {
        calls.push("markSent");
        return true;
      },
      markFailed: async () => {
        calls.push("markFailed");
      },
      quarantineSentUnmarked: async () => {
        calls.push("quarantineSentUnmarked");
      },
      listQuarantined: async () => {
        calls.push("listQuarantined");
        return [];
      },
      rowStatus: async () => {
        calls.push("rowStatus");
        return "pending";
      },
      enqueueFailureNotice: async () => {
        calls.push("enqueueFailureNotice");
        return [];
      },
      pendingStats: async () => {
        calls.push("pendingStats");
        return { pending: 3, truncated: false, oldestCreatedAt: null, wouldReap: 0 };
      },
    };
    return { db, calls };
  }

  test("순수 경로 — 진짜 워커 + unconfigured sender: reap 과 통계뿐, claim 0", async () => {
    const { db, calls } = recordingDb();
    const workerDeps: WorkerDeps = { db, sender: unconfiguredSender(), now: () => new Date(), log: () => {} };
    const outcome = await runInlineNotify("created", {
      workerDeps: () => workerDeps,
      run: runNotificationWorker,
      sleep: async () => {},
      now: () => new Date(),
      log: () => {},
    });
    expect(outcome).toEqual({ passes: 1 });
    // 격리 행 자가 복구(listQuarantined)는 DB 기록이라 미구성이어도 돈다 — claim 은 없다(수정 라운드 3)
    expect(calls).toEqual(["reapStale", "listQuarantined", "pendingStats"]);
  });

  test("배선 경로 — NOTIFY_INLINE=1 · 제공자 키 없음: 응답 뒤 RPC 는 reap 하나뿐(claim RPC 0)", async () => {
    process.env.NOTIFY_INLINE = "1";
    expect(notifyAfterResponse("created", runAfter)).toBe(true);
    await flushAfter();
    expect(h.rpcs).toEqual(["reap_stale_notifications"]);
    const run = vi.mocked(structuredLog).mock.calls.map((c) => c[0]).find((e) => e.event === "notify.worker_run");
    expect(run).toMatchObject({ sender: UNCONFIGURED_SENDER_NAME, skipped: "sender_not_configured", claimed: 0 });
  });

  test("배선 경로 — NOTIFY_INLINE=1 · NOTIFY_SENDER=memory(로컬 실증): reap → claim(limit 5) 까지 간다", async () => {
    process.env.NOTIFY_INLINE = "1";
    process.env.NOTIFY_SENDER = "memory";
    notifyAfterResponse("created", runAfter);
    await flushAfter();
    expect(h.rpcs).toEqual(["reap_stale_notifications", "claim_pending_notifications"]);
    expect(vi.mocked(runNotificationWorker).mock.calls[0][0]).toMatchObject({ dryRun: false, limit: INLINE_WORKER_LIMIT, rowBudgetMs: INLINE_ROW_BUDGET_MS });
    const run = vi.mocked(structuredLog).mock.calls.map((c) => c[0]).find((e) => e.event === "notify.worker_run");
    expect(run).toMatchObject({ sender: MEMORY_SENDER_NAME });
  });
});

// =============================================================================
// 4. 배선 — lib/notify/deps.ts 가 env 를 읽는다
// =============================================================================
describe("4. notifyAfterResponse — env 스위치", () => {
  test.each([undefined, "", "0", "true", "yes", " 1"])("NOTIFY_INLINE=%j → runAfter 0 · 워커 0 · 서비스 롤 클라이언트 0", async (value) => {
    if (value !== undefined) process.env.NOTIFY_INLINE = value;
    expect(notifyAfterResponse("created", runAfter)).toBe(false);
    expect(runAfter).not.toHaveBeenCalled();
    await flushAfter();
    expect(runNotificationWorker).not.toHaveBeenCalled();
    expect(h.rpcs).toEqual([]);
  });

  test('NOTIFY_INLINE="1" → runAfter 1 · 응답 뒤에만 워커 1', async () => {
    process.env.NOTIFY_INLINE = "1";
    expect(notifyAfterResponse("confirmed", runAfter)).toBe(true);
    expect(runAfter).toHaveBeenCalledTimes(1);
    expect(runNotificationWorker).not.toHaveBeenCalled();
    await flushAfter();
    expect(runNotificationWorker).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// 5. 호출 지점
// =============================================================================
describe("5-a. 공개 접수 — actions/reservation.ts", () => {
  const input = {} as ReservationInput;
  const created = { reservationId: RES_ID, publicCode: "ABCDEFGH", notifyQueued: true, warnings: [] as string[] };

  beforeEach(() => {
    vi.mocked(runGuards).mockResolvedValue({ ok: true, silent: false, input });
    vi.mocked(createReservation).mockResolvedValue(created);
  });

  test("성공 + NOTIFY_INLINE=1 → 결과가 먼저 나가고, 워커는 응답 뒤에 1회", async () => {
    process.env.NOTIFY_INLINE = "1";
    const result = await submitReservation(new FormData());
    expect(result).toEqual({ ok: true, publicCode: "ABCDEFGH", notifyQueued: true });
    expect(runAfter).toHaveBeenCalledTimes(2); // 캐시 무효화 + 즉시 발송
    expect(runNotificationWorker).not.toHaveBeenCalled();
    await flushAfter();
    expect(runNotificationWorker).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runNotificationWorker).mock.calls[0][0]).toMatchObject({ dryRun: false, limit: INLINE_WORKER_LIMIT });
  });

  test("성공 + 스위치 꺼짐 → runAfter 는 캐시 무효화 1개뿐 · 워커 0", async () => {
    const result = await submitReservation(new FormData());
    expect(result).toMatchObject({ ok: true });
    expect(runAfter).toHaveBeenCalledTimes(1);
    await flushAfter();
    expect(runNotificationWorker).not.toHaveBeenCalled();
  });

  test("접수 실패(createReservation throw) → 즉시 발송 0", async () => {
    process.env.NOTIFY_INLINE = "1";
    vi.mocked(createReservation).mockRejectedValueOnce(new Error("db down"));
    const result = await submitReservation(new FormData());
    expect(result).toMatchObject({ ok: false, code: "server" });
    expect(runAfter).not.toHaveBeenCalled();
    await flushAfter();
    expect(runNotificationWorker).not.toHaveBeenCalled();
  });

  test("가드 실패 · 허니팟 → 즉시 발송 0", async () => {
    process.env.NOTIFY_INLINE = "1";
    vi.mocked(runGuards).mockResolvedValueOnce({ ok: false, reason: "turnstile", detail: { code: "verify-failed" } } as never);
    expect(await submitReservation(new FormData())).toMatchObject({ ok: false });
    vi.mocked(runGuards).mockResolvedValueOnce({ ok: true, silent: true });
    expect(await submitReservation(new FormData())).toEqual({ ok: true, publicCode: null });
    expect(runAfter).not.toHaveBeenCalled();
    expect(runNotificationWorker).not.toHaveBeenCalled();
  });

  test("워커가 던져도 접수 응답은 성공 — 구조화 로그 notify.inline_failed 1줄", async () => {
    process.env.NOTIFY_INLINE = "1";
    vi.mocked(runNotificationWorker).mockRejectedValueOnce(new Error("outbox.claimPending: boom"));
    const result = await submitReservation(new FormData());
    expect(result).toEqual({ ok: true, publicCode: "ABCDEFGH", notifyQueued: true });
    await expect(flushAfter()).resolves.toBeUndefined();
    expect(inlineLogs()).toEqual([expect.objectContaining({ level: "error", event: "notify.inline_failed", trigger: "created" })]);
  });
});

describe("5-b. 관리자 확정 — actions/admin/reservation.ts", () => {
  function rpcClient(outcome: string | null, error: unknown = null) {
    return { rpc: vi.fn(async () => ({ data: outcome === null ? null : [{ outcome, public_code: "BT123456", enqueued: 1 }], error })) };
  }

  test("확정 성공 + NOTIFY_INLINE=1 → 응답 뒤 워커 1회", async () => {
    process.env.NOTIFY_INLINE = "1";
    vi.mocked(createSsrClient).mockReturnValue(rpcClient("confirmed") as never);
    const result = await confirmReservation(RES_ID);
    expect(result).toEqual({ ok: true, changed: true, code: "confirmed" });
    expect(runNotificationWorker).not.toHaveBeenCalled();
    await flushAfter();
    expect(runNotificationWorker).toHaveBeenCalledTimes(1);
  });

  test("확정 성공 + 스위치 꺼짐 → 워커 0", async () => {
    vi.mocked(createSsrClient).mockReturnValue(rpcClient("confirmed") as never);
    await confirmReservation(RES_ID);
    await flushAfter();
    expect(runNotificationWorker).not.toHaveBeenCalled();
  });

  test("확정 noop(두 번째 클릭) · rpc 오류 · uuid 아님 → 워커 0", async () => {
    process.env.NOTIFY_INLINE = "1";
    vi.mocked(createSsrClient).mockReturnValue(rpcClient("noop") as never);
    expect(await confirmReservation(RES_ID)).toMatchObject({ changed: false, code: "alreadyHandled" });
    vi.mocked(createSsrClient).mockReturnValue(rpcClient(null, { code: "42501", message: "denied" }) as never);
    expect(await confirmReservation(RES_ID)).toMatchObject({ ok: false });
    expect(await confirmReservation("not-a-uuid")).toMatchObject({ ok: false });
    await flushAfter();
    expect(runNotificationWorker).not.toHaveBeenCalled();
  });

  test("취소 · 완료 · 메모는 통지를 만들지 않으므로(0010) 즉시 발송도 부르지 않는다", async () => {
    process.env.NOTIFY_INLINE = "1";
    vi.mocked(createSsrClient).mockReturnValue(rpcClient("cancelled") as never);
    expect(await cancelReservation(RES_ID)).toMatchObject({ changed: true, code: "cancelled" });
    vi.mocked(createSsrClient).mockReturnValue(rpcClient("completed") as never);
    expect(await completeReservation(RES_ID)).toMatchObject({ changed: true, code: "completed" });
    vi.mocked(createSsrClient).mockReturnValue(rpcClient("memo_updated") as never);
    expect(await saveReservationMemo(RES_ID, "메모")).toMatchObject({ changed: true, code: "memoUpdated" });
    // 무효화 작업은 맡겨졌지만(변경이 있었다) 워커는 없다
    expect(runAfter).toHaveBeenCalledTimes(3);
    await flushAfter();
    expect(runNotificationWorker).not.toHaveBeenCalled();
  });

  test("워커가 던져도 확정 응답은 성공 — 구조화 로그 notify.inline_failed 1줄", async () => {
    process.env.NOTIFY_INLINE = "1";
    vi.mocked(createSsrClient).mockReturnValue(rpcClient("confirmed") as never);
    vi.mocked(runNotificationWorker).mockRejectedValueOnce(new Error("outbox.reapStale: boom"));
    expect(await confirmReservation(RES_ID)).toEqual({ ok: true, changed: true, code: "confirmed" });
    await expect(flushAfter()).resolves.toBeUndefined();
    expect(inlineLogs()).toEqual([expect.objectContaining({ level: "error", event: "notify.inline_failed", trigger: "confirmed" })]);
  });
});

// =============================================================================
// 6. vercel.json — Vercel Hobby 는 하루 1회보다 잦은 크론을 배포 전에 거부한다
// =============================================================================
describe("6. vercel.json crons", () => {
  const json = JSON.parse(read("vercel.json")) as { crons?: { path: string; schedule: string }[] };
  const crons = json.crons ?? [];

  test("모든 크론이 하루 1회 이하다 — 분·시 필드가 고정 정수 (Vercel Hobby 는 더 잦은 크론이 있으면 배포 자체를 거부한다: 2026-09-13~26 전 커밋 미배포)", () => {
    expect(crons.length).toBeGreaterThan(0);
    for (const c of crons) {
      const fields = c.schedule.trim().split(/\s+/);
      expect(fields, `${c.path}: 5필드 cron 이 아니다 (${c.schedule})`).toHaveLength(5);
      const [minute, hour] = fields;
      expect(minute, `${c.path}: 분 필드가 고정 정수가 아니다 (${c.schedule}) — 하루 여러 번 돈다`).toMatch(/^\d{1,2}$/);
      expect(hour, `${c.path}: 시 필드가 고정 정수가 아니다 (${c.schedule}) — 하루 여러 번 돈다`).toMatch(/^\d{1,2}$/);
      expect(Number(minute)).toBeLessThan(60);
      expect(Number(hour)).toBeLessThan(24);
    }
  });

  test("통지 크론은 '0 23 * * *'(UTC) = 08시대 KST — 재시도·회수 담당, 파기 크론(04시 KST)과 다른 시각", () => {
    const notify = crons.find((c) => c.path.split("?")[0] === "/api/cron/notify");
    const purge = crons.find((c) => c.path.split("?")[0] === "/api/cron/purge");
    expect(notify?.schedule).toBe("0 23 * * *");
    expect(purge?.schedule).toBe("0 19 * * *");
    const kstHour = (s: string) => (Number(s.split(/\s+/)[1]) + 9) % 24;
    expect(kstHour(notify!.schedule)).toBe(8);
    expect(kstHour(notify!.schedule)).not.toBe(kstHour(purge!.schedule));
  });
});

// =============================================================================
// 7. 정적 — env 경계 · 서비스 롤 경계 · .env.example
// =============================================================================
describe("7. 정적", () => {
  test("lib/notify/inline.ts 는 순수 — process.env 0 · server-only 0 · next import 0 · 제공자 0 · 발송 경로 0", () => {
    const src = read("lib/notify/inline.ts");
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/import\s+["']server-only["']/);
    expect(src).not.toMatch(/from\s+["']next(\/|["'])/);
    expect(src).not.toMatch(/solapi|resend|\bfetch\(/i);
    // 아웃박스를 우회하는 발송이 없다 — sender 를 직접 부르지 않고 워커만 부른다
    expect(src).not.toMatch(/\.send\(/);
  });

  test("lib/notify 에서 env 를 읽는 곳은 deps.ts 하나뿐 — 그리고 server-only", () => {
    const dir = path.join(ROOT, "lib", "notify");
    const withEnv = readdirSync(dir)
      .filter((n) => n.endsWith(".ts"))
      .filter((n) => /process\.env/.test(readFileSync(path.join(dir, n), "utf-8")));
    expect(withEnv).toEqual(["deps.ts"]);
    expect(read("lib/notify/deps.ts")).toMatch(/^import "server-only";$/m);
    expect(read("lib/notify/deps.ts")).toMatch(/process\.env\.NOTIFY_INLINE/);
  });

  test("route.ts 는 env 로 CRON_SECRET 만 본다 — sender·수신처 선택은 deps.ts 로 옮겼다", () => {
    const route = read("app/api/cron/notify/route.ts");
    const names = [...route.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect([...new Set(names)]).toEqual(["CRON_SECRET"]);
    expect(route).toMatch(/notifyWorkerDeps\(\)/);
  });

  test("관리자 액션 — 확정 경로에서만 notifyAfterResponse('confirmed') · process.env 0 · 서비스 롤 심볼 0", () => {
    const src = read("actions/admin/reservation.ts");
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase\/server/);
    expect(src.match(/notifyAfterResponse\(/g)).toHaveLength(1);
    expect(src).toMatch(/notifyAfterResponse\("confirmed", runAfter\)/);
  });

  /**
   * P4-7 수정 라운드 2 · 리뷰 P2-6 — 관리자 경로가 서비스 롤에 닿는 **예외는 lib/notify/deps.ts 하나뿐**이다.
   * scripts/check-admin-no-service-role.sh 는 관리자 디렉터리 네 곳의 **글자**만 본다 — 관리자 모듈이 다른 모듈을 거쳐
   * 서비스 롤을 import 해도 모른다. 그래서 관리자 경로에서 출발하는 **import 그래프 전체**를 따라가,
   * 그 안에서 서비스 롤 모듈(lib/supabase/server)을 import 하는 파일이 deps.ts 하나뿐인지 본다.
   * 새 경로가 생기면(관리자 모듈 → 어떤 lib → supabase/server) 여기가 빨개진다.
   */
  test("관리자 경로의 import 그래프에서 서비스 롤 모듈을 import 하는 파일은 lib/notify/deps.ts 하나뿐", () => {
    const EXTS = [".ts", ".tsx", "/index.ts", "/index.tsx"];
    const toRel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");
    const resolve = (fromFile: string, spec: string): string | null => {
      let base: string;
      if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
      else if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(path.dirname(fromFile), spec);
      else return null; // 패키지
      for (const ext of ["", ...EXTS]) {
        const p = base + ext;
        if (existsSync(p) && statSync(p).isFile()) return p;
      }
      return null;
    };
    const specsOf = (src: string) =>
      [...src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map(
        (m) => m[1] ?? m[2] ?? m[3],
      );
    const walk = (dir: string): string[] =>
      existsSync(dir)
        ? readdirSync(dir).flatMap((n) => {
            const p = path.join(dir, n);
            return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
          })
        : [];

    const roots = ["app/admin", "actions/admin", "lib/admin", "components/admin"].flatMap((d) => walk(path.join(ROOT, d)));
    expect(roots.length).toBeGreaterThan(10);
    const seen = new Set<string>();
    const stack = [...roots];
    const importersOfServer: string[] = [];
    const serverModule = path.join(ROOT, "lib", "supabase", "server.ts");
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, "utf-8");
      for (const spec of specsOf(src)) {
        const target = resolve(file, spec);
        if (target === null) continue;
        if (target === serverModule) importersOfServer.push(toRel(file));
        if (!seen.has(target)) stack.push(target);
      }
    }
    // 그래프가 실제로 deps.ts 까지 닿았다(확정 액션 → deps.ts) — 탐색이 헛돌지 않았다는 증거
    expect(seen.has(path.join(ROOT, "lib", "notify", "deps.ts"))).toBe(true);
    expect([...new Set(importersOfServer)].sort()).toEqual(["lib/notify/deps.ts"]);
    // 그리고 서비스 롤 키를 직접 읽는 파일은 그래프 안에서 lib/supabase/server.ts 뿐이다
    const readsKey = [...seen].filter((f) => /SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(f, "utf-8"))).map(toRel);
    expect(readsKey).toEqual(["lib/supabase/server.ts"]);
  });

  /**
   * 수정 라운드 3 · 리뷰 P2-6 — 위 그래프 테스트는 "import" 만 본다. deps.ts 는 서비스 롤 클라이언트를 품은 `notifyWorkerDeps()` 도
   * export 하므로, 관리자 모듈이 그것을 불러 `.db` 로 reap·claim·mark 를 직접 해도 위 테스트는 초록이다.
   * 그래서 **관리자 경로가 deps.ts 에서 가져오는 이름이 `notifyAfterResponse` 하나뿐**인지도 본다(re-export·namespace·default import 금지).
   */
  test("관리자 경로가 lib/notify/deps.ts 에서 가져오는 것은 notifyAfterResponse 하나뿐이다", () => {
    const walk = (dir: string): string[] =>
      existsSync(dir)
        ? readdirSync(dir).flatMap((n) => {
            const p = path.join(dir, n);
            return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
          })
        : [];
    const files = ["app/admin", "actions/admin", "lib/admin", "components/admin"].flatMap((d) => walk(path.join(ROOT, d)));
    const importers: { file: string; names: string[] }[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      for (const m of src.matchAll(/(import|export)\s+([^;]*?)\s+from\s*["']([^"']*notify\/deps)["']/g)) {
        const clause = m[2].trim();
        const named = /^(?:type\s+)?\{([^}]*)\}$/.exec(clause);
        const names = named ? named[1].split(",").map((s) => s.trim()).filter(Boolean) : [`<${m[1]} ${clause}>`];
        importers.push({ file: path.relative(ROOT, f).split(path.sep).join("/"), names });
      }
      expect(/import\(\s*["'][^"']*notify\/deps["']\s*\)/.test(src), `${f} — deps.ts 를 동적 import 한다`).toBe(false);
    }
    expect(importers).toEqual([{ file: "actions/admin/reservation.ts", names: ["notifyAfterResponse"] }]);
  });

  /**
   * P4-7b · 재검토 P2-R3-5 — 위 테스트는 관리자 파일의 **직접** import 만 본다. 관리자 밖의 모듈(`lib/x.ts`)이
   * `export { notifyWorkerDeps } from "@/lib/notify/deps"` 로 다시 내보내고 관리자 모듈이 `lib/x` 를 import 하면 초록이었다.
   * 그래서 **관리자 경로에서 도달 가능한 모든 모듈**이 deps.ts 로 들어가는 간선을 검사한다:
   *   - 허용: `import { notifyAfterResponse } from "…/notify/deps"` 하나(이름 하나, 별칭 없음)
   *   - 금지: 다른 이름 · 별칭 · namespace · default · `export … from deps`(재수출) · `export *` · 동적 import
   * 분석기는 파일 시스템을 인자로 받는다 — 이빨 테스트가 **가상 그래프**로 빨강을 보인다(저장소에 가짜 파일을 두지 않는다).
   */
  interface VirtualFs {
    read(abs: string): string;
    isFile(abs: string): boolean;
  }
  const DEPS_ABS = path.join(ROOT, "lib", "notify", "deps.ts");

  function depsEdgeViolations(roots: string[], vfs: VirtualFs): string[] {
    const EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
    const resolve = (fromFile: string, spec: string): string | null => {
      let base: string;
      if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
      else if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(path.dirname(fromFile), spec);
      else return null;
      for (const ext of EXTS) if (vfs.isFile(base + ext)) return base + ext;
      return null;
    };
    const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");
    const violations: string[] = [];
    const seen = new Set<string>();
    const stack = [...roots];
    // 절(clause)에는 `;`·따옴표가 없다 — 앞 문장(`import "x";`)을 건너 다음 문장의 from 까지 늘어나지 않게 한다.
    const STMT = /(?:^|\n)\s*(import|export)\s+([^;"']+?)\s+from\s*["']([^"']+)["']/g;
    const SIDE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
    const DYN = /import\(\s*["']([^"']+)["']\s*\)/g;
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      if (file === DEPS_ABS) continue; // deps.ts 자신의 import 는 대상이 아니다(그래프 테스트가 따로 본다)
      const src = vfs.read(file);
      for (const m of src.matchAll(STMT)) {
        const target = resolve(file, m[3]);
        if (target === null) continue;
        if (target === DEPS_ABS) {
          const kind = m[1];
          const clause = m[2].trim();
          const named = /^\{([^}]*)\}$/.exec(clause);
          const names = named ? named[1].split(",").map((s) => s.trim()).filter(Boolean) : null;
          const ok = kind === "import" && names !== null && names.length === 1 && names[0] === "notifyAfterResponse";
          if (!ok) violations.push(`${rel(file)}: ${kind} ${clause} from deps`);
        }
        stack.push(target);
      }
      for (const m of src.matchAll(SIDE)) {
        const target = resolve(file, m[1]);
        if (target === DEPS_ABS) violations.push(`${rel(file)}: side-effect import of deps`);
        if (target !== null) stack.push(target);
      }
      for (const m of src.matchAll(DYN)) {
        const target = resolve(file, m[1]);
        if (target === DEPS_ABS) violations.push(`${rel(file)}: dynamic import of deps`);
        if (target !== null) stack.push(target);
      }
    }
    if (!seen.has(DEPS_ABS)) violations.push("(탐색이 deps.ts 에 닿지 않았다 — 헛도는 탐색)");
    return violations;
  }

  const adminRoots = (): string[] => {
    const walk = (dir: string): string[] =>
      existsSync(dir)
        ? readdirSync(dir).flatMap((n) => {
            const p = path.join(dir, n);
            return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
          })
        : [];
    return ["app/admin", "actions/admin", "lib/admin", "components/admin"].flatMap((d) => walk(path.join(ROOT, d)));
  };
  const realFs: VirtualFs = {
    read: (abs) => readFileSync(abs, "utf-8"),
    isFile: (abs) => existsSync(abs) && statSync(abs).isFile(),
  };

  test("관리자 경로에서 도달 가능한 모든 모듈 — deps.ts 로 들어가는 간선은 notifyAfterResponse import 하나뿐 · 재수출 0", () => {
    expect(depsEdgeViolations(adminRoots(), realFs)).toEqual([]);
  });

  test("🔴 이빨(가상 그래프) — 관리자 밖 모듈이 notifyWorkerDeps 를 재수출하고 관리자 모듈이 그것을 import 하면 빨강", () => {
    const virtual = new Map<string, string>([
      [path.join(ROOT, "actions", "admin", "evil.ts"), 'import { helper } from "@/lib/x";\nexport async function a() { return helper; }\n'],
      [path.join(ROOT, "lib", "x.ts"), 'export { notifyWorkerDeps as helper } from "@/lib/notify/deps";\n'],
      [path.join(ROOT, "lib", "y.ts"), 'import { notifyAfterResponse } from "./notify/deps";\nexport const ok = notifyAfterResponse;\n'],
      [path.join(ROOT, "lib", "z.ts"), 'export * from "@/lib/notify/deps";\n'],
      [path.join(ROOT, "lib", "w.ts"), 'import { notifyWorkerDeps } from "@/lib/notify/deps";\nexport const w = notifyWorkerDeps;\n'],
      [DEPS_ABS, "export function notifyAfterResponse() {}\nexport function notifyWorkerDeps() {}\n"],
    ]);
    const vfs: VirtualFs = { read: (abs) => virtual.get(abs) ?? "", isFile: (abs) => virtual.has(abs) };
    const roots = [path.join(ROOT, "actions", "admin", "evil.ts")];
    expect(depsEdgeViolations(roots, vfs)).toEqual(["lib/x.ts: export { notifyWorkerDeps as helper } from deps"]);
    // 허용 간선(y)만 있는 관리자 모듈은 초록 · export * · 다른 이름 import 는 빨강
    virtual.set(path.join(ROOT, "actions", "admin", "evil.ts"), 'import { ok } from "@/lib/y";\nimport "@/lib/z";\nimport { w } from "@/lib/w";\n');
    expect(depsEdgeViolations(roots, vfs).sort()).toEqual(["lib/w.ts: import { notifyWorkerDeps } from deps", "lib/z.ts: export * from deps"]);
  });

  /**
   * 수정 라운드 3 · 리뷰 P2-3 — 즉시 발송은 응답 뒤(after)에 돈다. 함수 시간 한도가 즉시 발송 마감보다 짧으면
   * send 와 markSent 사이에서 잘려 행이 lease 뒤 다시 집히고 **손님이 두 번 받는다.** 그래서 즉시 발송이 도는 두 페이지
   * (견적 제출 서버액션을 부르는 /quote · 확정 버튼이 있는 관리자 예약 상세)에 maxDuration 을 명시한다.
   * 60초: Vercel 문서(2026-08-24 판) 기준 Hobby 는 Fluid compute 에서 기본·최대 300초이고, Fluid 가 아닌 옛 방식의 Hobby 최대는 60초다
   * (changelog "Vercel Functions for Hobby can now run up to 60 seconds") — 어느 쪽이든 받아들여지는 가장 큰 공통값이다.
   */
  test.each(["app/[locale]/(site)/quote/page.tsx", "app/admin/(protected)/reservations/[id]/page.tsx"])(
    "%s — export const maxDuration = 60 (즉시 발송 마감 + 여유 ≤ 60 ≤ Hobby 상한)",
    (rel) => {
      const src = read(rel);
      const m = /^export const maxDuration = (\d+);$/m.exec(src);
      expect(m, `${rel} 에 maxDuration 이 없다`).not.toBeNull();
      const seconds = Number(m?.[1]);
      expect(seconds).toBe(60);
      // 마감 40초 + 마지막 행 예산 12초 = 52초가 들어간다
      expect((INLINE_DEADLINE_MS + INLINE_ROW_BUDGET_MS) / 1000).toBeLessThanOrEqual(seconds);
    },
  );

  test("공개 접수 액션 — notifyAfterResponse('created', runAfter) 1회 · env 는 여전히 OWNER_* 둘뿐", () => {
    const src = read("actions/reservation.ts");
    expect(src.match(/notifyAfterResponse\(/g)).toHaveLength(1);
    expect(src).toMatch(/notifyAfterResponse\("created", runAfter\)/);
    const names = [...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["OWNER_EMAIL", "OWNER_PHONE"]);
  });

  test(".env.example — NOTIFY_INLINE= 가 빈 값으로 있고 크론 ?dry=0 과 따로 켠다는 설명이 있다", () => {
    const env = read(".env.example");
    expect(env).toMatch(/^NOTIFY_INLINE=$/m);
    expect(env).toContain("?dry=0");
  });
});

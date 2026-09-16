/**
 * P4-1 — 아웃박스 발송기(worker) + sender 포트 + 크론 진입점 계약 테스트 (플랜 v4 · ADR-7).
 *
 * 브리프 §검증 1~8 을 그대로 단언한다:
 *   1. 미구성 sender → claim 0회 · 보고서 skipped:'sender_not_configured' · warn 로그 1줄 · reap 는 1회 (가장 중요한 규칙)
 *   2. dryRun → 부작용 0 — claim 0 · send 0 · reap 0 (회수도 부작용이다). 보고서에 wouldReap 개수만
 *   3. 정상: claim N → send N → markSent N, 카운트 일치, providerMessageId 전달
 *   4. 실패: ok:false → markFailed(행, error) · send throw → markFailed('sender_threw:…') · 두 경우 markSent 0
 *   5. 중복: markSent false → duplicate +1, 예외 아님
 *   6. 순서: reap → claim → (send → mark)×N
 *   7. 보고서·로그 JSON 에 to 값(전화·메일)·이름 0
 *   8. 정적: worker.ts·sender.ts 에 process.env 0 · 'use server' 0 · 제공자 심볼 0 / route.ts 에 timingSafeEqual·dry·no-store
 * 그리고 라우트(401·dry 기본·?dry=0·sender 선택·no-store) · vercel.json(5분 주기) · supabaseWorkerDb 쿼리 모양.
 *
 * 여기에는 제공자 호출도(P4-2), 문자 문안도(P4-3) 없다. template 은 키뿐이다.
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, test, vi } from "vitest";

import { structuredLog } from "@/lib/log";
import { CLAIM_LEASE_MS, MAX_ATTEMPTS, nextAttemptDecision } from "@/lib/notify/outbox";
import {
  MEMORY_SENDER_NAME,
  UNCONFIGURED_SENDER_NAME,
  memorySender,
  unconfiguredSender,
  type NotificationSender,
  type SendOutcome,
  type SendRequest,
} from "@/lib/notify/sender";
import {
  DEFAULT_WORKER_LIMIT,
  PENDING_STATS_COLUMNS,
  PENDING_STATS_SCAN_LIMIT,
  claimedDecision,
  runNotificationWorker,
  scrubError,
  supabaseWorkerDb,
  type PendingStats,
  type WorkerDb,
  type WorkerLogEntry,
  type WorkerReport,
} from "@/lib/notify/worker";
import type { NotifyChannel, OutboxRow } from "@/lib/types";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINUTE = 60_000;

// 고정 "지금". claim 직후의 행은 next_attempt_at 이 lease 만큼 미래다(0005 :109).
const NOW = new Date("2026-09-13T00:00:00.000Z");
const LEASE_UNTIL = new Date(NOW.getTime() + CLAIM_LEASE_MS).toISOString();
const RID = "00000000-0000-4000-8000-000000000041";

// 더미 수신처 — 보고서·로그 어디에도 나오면 안 되는 값 (§7)
const PHONE = "01012345678";
const EMAIL = "owner@example.com";

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 1,
    reservation_id: RID,
    event: "created",
    channel: "sms",
    to: PHONE,
    template: "created.customer.sms",
    status: "pending",
    attempts: 1,
    last_error: null,
    next_attempt_at: LEASE_UNTIL,
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

const emptyStats: PendingStats = { pending: 0, truncated: false, oldestCreatedAt: null, wouldReap: 0 };

function fakeDb(opts: { claim?: OutboxRow[]; reap?: OutboxRow[]; stats?: Partial<PendingStats>; markSent?: (id: number) => boolean } = {}) {
  const batches = [opts.claim ?? []];
  return {
    reapStale: vi.fn<WorkerDb["reapStale"]>(async () => opts.reap ?? []),
    claimPending: vi.fn<WorkerDb["claimPending"]>(async () => batches.shift() ?? []),
    markSent: vi.fn<WorkerDb["markSent"]>(async (id) => (opts.markSent ? opts.markSent(id) : true)),
    markFailed: vi.fn<WorkerDb["markFailed"]>(async () => {}),
    pendingStats: vi.fn<WorkerDb["pendingStats"]>(async () => ({ ...emptyStats, ...opts.stats })),
  } satisfies WorkerDb;
}

/** spy sender 가 보낼 수 있다고 밝히는 채널 — worker 가 claim 에 그대로 넘긴다(P4-5). */
const SPY_CHANNELS: NotifyChannel[] = ["sms", "alimtalk", "email"];

function spySender(script?: (req: SendRequest) => SendOutcome | Promise<SendOutcome>, channels: NotifyChannel[] = SPY_CHANNELS) {
  return {
    name: "spy",
    configured: true,
    channels,
    send: vi.fn(async (req: SendRequest): Promise<SendOutcome> => (script ? script(req) : { ok: true, providerMessageId: `pm-${req.id}` })),
  };
}

function deps(db: WorkerDb, sender: NotificationSender) {
  const log = vi.fn<(entry: WorkerLogEntry) => void>();
  return { deps: { db, sender, now: () => NOW, log }, log };
}

const logJson = (log: { mock: { calls: unknown[][] } }) => log.mock.calls.map((c) => JSON.stringify(c[0]));

// =============================================================================
// sender 포트 — 두 구현
// =============================================================================
describe("lib/notify/sender.ts — unconfiguredSender / memorySender", () => {
  test("unconfiguredSender: configured=false · name 고정 · send 는 호출되면 throw (worker 가 미리 걸러야 한다)", async () => {
    const s = unconfiguredSender();
    expect(s.configured).toBe(false);
    expect(s.name).toBe(UNCONFIGURED_SENDER_NAME);
    await expect(
      s.send({ id: 1, channel: "sms", to: PHONE, template: "created.customer.sms", reservationId: RID }),
    ).rejects.toThrow(/unconfigured/i);
  });

  test("memorySender: 기본은 전부 성공(providerMessageId memory-<id>) 이고 호출을 기록한다", async () => {
    const s = memorySender();
    expect(s.configured).toBe(true);
    expect(s.name).toBe(MEMORY_SENDER_NAME);
    const req: SendRequest = { id: 7, channel: "sms", to: PHONE, template: "created.customer.sms", reservationId: RID };
    await expect(s.send(req)).resolves.toEqual({ ok: true, providerMessageId: "memory-7" });
    expect(s.calls).toEqual([req]);
  });

  test("memorySender(script): 시나리오 — 성공 / 재시도 가능 실패 / 영구 실패 / throw 를 요청별로 낸다", async () => {
    const s = memorySender((req, index) => {
      if (req.id === 1) return { ok: true, providerMessageId: null };
      if (req.id === 2) return { ok: false, error: "timeout", retryable: true };
      if (req.id === 3) return { ok: false, error: "invalid_recipient", retryable: false };
      throw new Error(`boom #${index}`);
    });
    const req = (id: number): SendRequest => ({ id, channel: "sms", to: PHONE, template: "created.customer.sms", reservationId: RID });
    await expect(s.send(req(1))).resolves.toEqual({ ok: true, providerMessageId: null });
    await expect(s.send(req(2))).resolves.toEqual({ ok: false, error: "timeout", retryable: true });
    await expect(s.send(req(3))).resolves.toEqual({ ok: false, error: "invalid_recipient", retryable: false });
    await expect(s.send(req(4))).rejects.toThrow(/boom #3/);
    expect(s.calls.map((c) => c.id)).toEqual([1, 2, 3, 4]);
  });
});

// =============================================================================
// claim 이후 판정 — nextAttemptDecision 을 그대로 쓸 수 없는 이유를 테스트로 남긴다
// =============================================================================
describe("claimedDecision — claim 이후 행의 판정 (lease 가 미래라 nextAttemptDecision 은 쓸 수 없다)", () => {
  test("근거: claim 직후 행에 nextAttemptDecision 을 쓰면 lease 때문에 전부 wait, 5회째는 give_up 이 되어 아무것도 못 보낸다", () => {
    expect(nextAttemptDecision(row({ attempts: 1 }), NOW)).toBe("wait");
    expect(nextAttemptDecision(row({ attempts: MAX_ATTEMPTS }), NOW)).toBe("give_up");
  });

  test("pending · 1 ≤ attempts ≤ MAX_ATTEMPTS · lease 남음 → send (5회째 시도도 정당한 시도다)", () => {
    expect(claimedDecision(row({ attempts: 1 }), NOW)).toBe("send");
    expect(claimedDecision(row({ attempts: MAX_ATTEMPTS }), NOW)).toBe("send");
  });

  test("attempts > MAX_ATTEMPTS 또는 status 가 pending 이 아니면 give_up (claim 이 돌려줄 수 없는 행 — 방어)", () => {
    expect(claimedDecision(row({ attempts: MAX_ATTEMPTS + 1 }), NOW)).toBe("give_up");
    expect(claimedDecision(row({ status: "sent" }), NOW)).toBe("give_up");
    expect(claimedDecision(row({ status: "failed" }), NOW)).toBe("give_up");
  });

  test("lease 가 이미 지났으면 lease_expired — 다른 발송기가 다시 잡을 수 있는 행이라 보내지 않는다", () => {
    expect(claimedDecision(row({ next_attempt_at: NOW.toISOString() }), NOW)).toBe("lease_expired");
    expect(claimedDecision(row({ next_attempt_at: new Date(NOW.getTime() - 1).toISOString() }), NOW)).toBe("lease_expired");
    expect(claimedDecision(row({ next_attempt_at: new Date(NOW.getTime() + 1).toISOString() }), NOW)).toBe("send");
  });

  test("next_attempt_at 을 해석할 수 없으면 throw — 모르는 행을 보내지 않는다", () => {
    expect(() => claimedDecision(row({ next_attempt_at: "not a date" }), NOW)).toThrow(/next_attempt_at/);
  });
});

// =============================================================================
// 1. 미구성 sender — claim 자체를 하지 않는다 (가장 중요한 규칙)
// =============================================================================
describe("runNotificationWorker — 미구성 sender", () => {
  test("미구성 sender → claimPending 0회 · send 0회 · 보고서 skipped:'sender_not_configured' · warn 로그 정확히 1줄 · reapStale 은 1회", async () => {
    const db = fakeDb({ claim: [row()], reap: [row({ id: 99, status: "failed", attempts: 5 })], stats: { pending: 3 } });
    const sender = unconfiguredSender();
    const sendSpy = vi.spyOn(sender, "send");
    const { deps: d, log } = deps(db, sender);

    const report = await runNotificationWorker({ dryRun: false }, d);

    expect(db.claimPending).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(db.markSent).not.toHaveBeenCalled();
    expect(db.markFailed).not.toHaveBeenCalled();
    expect(db.reapStale).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({
      dryRun: false,
      sender: UNCONFIGURED_SENDER_NAME,
      skipped: "sender_not_configured",
      claimed: 0,
      sent: 0,
      failed: 0,
      duplicate: 0,
      gaveUp: 0,
      reaped: 1,
      pending: 3,
    });
    expect(report.ids.reaped).toEqual([99]);
    const warns = log.mock.calls.filter((c) => (c[0] as WorkerLogEntry).level === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0][0]).toMatchObject({ level: "warn", event: "notify.worker_run", skipped: "sender_not_configured" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  test("configured 가 명시적으로 true 가 아니면 미구성으로 본다 (undefined·문자열 'true' 도 claim 하지 않는다)", async () => {
    for (const configured of [undefined, "true", 1, null]) {
      const db = fakeDb({ claim: [row()] });
      const sender = { name: "odd", configured, send: vi.fn() } as unknown as NotificationSender;
      const { deps: d } = deps(db, sender);
      const report = await runNotificationWorker({ dryRun: false }, d);
      expect(db.claimPending, String(configured)).not.toHaveBeenCalled();
      expect(report.skipped).toBe("sender_not_configured");
    }
  });
});

// =============================================================================
// 1-B. 보낼 수 있는 채널이 없으면 claim 하지 않는다 (P4-5 — 대원칙을 채널까지 내린 것)
// =============================================================================
describe("runNotificationWorker — sender.channels", () => {
  test("channels=[] 이면 configured 여도 claimPending 0회 · skipped:'sender_has_no_channels' · reap 은 그대로 1회", async () => {
    const db = fakeDb({ claim: [row()], reap: [row({ id: 98, status: "failed", attempts: 5 })] });
    const sender = spySender(undefined, []);
    const { deps: d, log } = deps(db, sender);

    const report = await runNotificationWorker({ dryRun: false }, d);

    expect(db.claimPending).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
    expect(report.skipped).toBe("sender_has_no_channels");
    expect(report.channels).toEqual([]);
    expect(report.claimed).toBe(0);
    expect(db.reapStale).toHaveBeenCalledTimes(1);
    // 이유가 보고서·로그에 드러난다 — "왜 아무것도 안 보냈는가" 를 사람이 읽을 수 있어야 한다.
    expect(log.mock.calls[0][0]).toMatchObject({ level: "warn", event: "notify.worker_run", skipped: "sender_has_no_channels" });
  });

  test("channels 를 아예 주지 않는 sender 도 같게 본다 (방어)", async () => {
    const db = fakeDb({ claim: [row()] });
    const sender = { name: "odd", configured: true, send: vi.fn() } as unknown as NotificationSender;
    const { deps: d } = deps(db, sender);
    const report = await runNotificationWorker({ dryRun: false }, d);
    expect(db.claimPending).not.toHaveBeenCalled();
    expect(report.skipped).toBe("sender_has_no_channels");
  });

  test("sender 의 채널이 claim 에 **그대로** 전달된다 — 문자만 켜지면 메일 행은 집히지 않는다(0014 p_channels)", async () => {
    const db = fakeDb({ claim: [row()] });
    const sender = spySender(undefined, ["sms"]);
    const { deps: d } = deps(db, sender);
    const report = await runNotificationWorker({ dryRun: false, limit: 5 }, d);
    expect(db.claimPending).toHaveBeenCalledWith(5, ["sms"]);
    expect(report.channels).toEqual(["sms"]);
    expect(report.skipped).toBeUndefined();
  });

  test("dry-run 도 보고서에 채널을 싣는다 — 무엇이 켜졌는지 발송 없이 확인한다", async () => {
    const { deps: d } = deps(fakeDb(), spySender(undefined, ["email"]));
    const report = await runNotificationWorker({}, d);
    expect(report.channels).toEqual(["email"]);
    expect(report.dryRun).toBe(true);
  });

  test("미구성이 채널 없음보다 먼저다 — 두 조건이 다 걸리면 'sender_not_configured'", async () => {
    const db = fakeDb({ claim: [row()] });
    const { deps: d } = deps(db, unconfiguredSender());
    const report = await runNotificationWorker({ dryRun: false }, d);
    expect(report.skipped).toBe("sender_not_configured");
    expect(report.channels).toEqual([]);
    expect(db.claimPending).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 2. dry-run — 부작용 0 (회수도 부작용이다)
// =============================================================================
describe("runNotificationWorker — dry-run 은 reap 도 하지 않는다 (부작용 0 — 회수는 dry 에서 wouldReap 개수로만 보고)", () => {
  test("옵션 없이 부르면 dry-run: reap 0 · claim 0 · send 0 · mark 0, 보고서에 pending·oldestPendingAgeMs·wouldReap·sender 이름", async () => {
    const db = fakeDb({
      claim: [row()],
      reap: [row({ id: 5 })],
      stats: { pending: 4, oldestCreatedAt: new Date(NOW.getTime() - 90_000).toISOString(), wouldReap: 2 },
    });
    const sender = spySender();
    const { deps: d, log } = deps(db, sender);

    const report = await runNotificationWorker({}, d);

    expect(report.dryRun).toBe(true);
    expect(db.reapStale).not.toHaveBeenCalled();
    expect(db.claimPending).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
    expect(db.markSent).not.toHaveBeenCalled();
    expect(db.markFailed).not.toHaveBeenCalled();
    expect(db.pendingStats).toHaveBeenCalledWith(NOW);
    expect(report).toMatchObject({ sender: "spy", reaped: 0, claimed: 0, sent: 0, wouldReap: 2, pending: 4, oldestPendingAgeMs: 90_000 });
    expect(report.skipped).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({ level: "info", event: "notify.worker_run", dryRun: true });
  });

  test("dryRun:true 를 명시해도 같다 — 미구성 sender 여도 dry-run 은 reap 하지 않는다", async () => {
    const db = fakeDb({ reap: [row({ id: 5 })] });
    const { deps: d } = deps(db, unconfiguredSender());
    const report = await runNotificationWorker({ dryRun: true }, d);
    expect(db.reapStale).not.toHaveBeenCalled();
    expect(report.reaped).toBe(0);
    expect(report.skipped).toBe("sender_not_configured");
  });

  test("pending 이 없으면 oldestPendingAgeMs 는 null", async () => {
    const { deps: d } = deps(fakeDb(), spySender());
    const report = await runNotificationWorker({}, d);
    expect(report.oldestPendingAgeMs).toBeNull();
    expect(report.pending).toBe(0);
  });
});

// =============================================================================
// 3. 정상 경로
// =============================================================================
describe("runNotificationWorker — 정상", () => {
  test("claim N → send N → markSent N, 카운트 일치, providerMessageId 가 markSent 로 전달된다", async () => {
    const rows = [row({ id: 1 }), row({ id: 2, template: "created.owner.sms", to: "01099990000" }), row({ id: 3, channel: "email", to: EMAIL, template: "created.owner.email" })];
    const db = fakeDb({ claim: rows, reap: [], stats: { pending: 0 } });
    const sender = spySender();
    const { deps: d } = deps(db, sender);

    const report = await runNotificationWorker({ dryRun: false, limit: 10 }, d);

    expect(db.claimPending).toHaveBeenCalledWith(10, SPY_CHANNELS);
    expect(sender.send).toHaveBeenCalledTimes(3);
    expect(sender.send.mock.calls.map((c) => c[0])).toEqual([
      { id: 1, channel: "sms", to: PHONE, template: "created.customer.sms", reservationId: RID },
      { id: 2, channel: "sms", to: "01099990000", template: "created.owner.sms", reservationId: RID },
      { id: 3, channel: "email", to: EMAIL, template: "created.owner.email", reservationId: RID },
    ]);
    expect(db.markSent.mock.calls).toEqual([
      [1, "pm-1"],
      [2, "pm-2"],
      [3, "pm-3"],
    ]);
    expect(db.markFailed).not.toHaveBeenCalled();
    expect(report).toMatchObject({ dryRun: false, sender: "spy", claimed: 3, sent: 3, failed: 0, duplicate: 0, gaveUp: 0, reaped: 0, limit: 10 });
    expect(report.ids.sent).toEqual([1, 2, 3]);
    expect(report.skipped).toBeUndefined();
  });

  test("providerMessageId 가 null 이어도 markSent(id, null) 로 넘긴다 (제공자가 id 를 안 주는 채널)", async () => {
    const db = fakeDb({ claim: [row({ id: 4 })] });
    const { deps: d } = deps(db, spySender(() => ({ ok: true, providerMessageId: null })));
    await runNotificationWorker({ dryRun: false }, d);
    expect(db.markSent).toHaveBeenCalledWith(4, null);
  });

  test("limit 기본값은 DEFAULT_WORKER_LIMIT 이고 1 이상의 정수만 받는다 — 0·음수·소수·NaN 은 throw, DB 호출 0", async () => {
    const db = fakeDb();
    const { deps: d } = deps(db, spySender());
    const report = await runNotificationWorker({ dryRun: false }, d);
    expect(report.limit).toBe(DEFAULT_WORKER_LIMIT);
    expect(db.claimPending).toHaveBeenCalledWith(DEFAULT_WORKER_LIMIT, SPY_CHANNELS);
    expect(DEFAULT_WORKER_LIMIT).toBeGreaterThanOrEqual(1);

    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const db2 = fakeDb();
      const { deps: d2 } = deps(db2, spySender());
      await expect(runNotificationWorker({ dryRun: false, limit: bad }, d2)).rejects.toThrow(/limit/);
      expect(db2.reapStale).not.toHaveBeenCalled();
      expect(db2.claimPending).not.toHaveBeenCalled();
    }
  });

  test("claim 결과가 비면 send·mark 를 부르지 않고 보고만 한다", async () => {
    const db = fakeDb({ claim: [] });
    const sender = spySender();
    const { deps: d } = deps(db, sender);
    const report = await runNotificationWorker({ dryRun: false }, d);
    expect(sender.send).not.toHaveBeenCalled();
    expect(report.claimed).toBe(0);
  });
});

// =============================================================================
// 4. 실패 경로
// =============================================================================
describe("runNotificationWorker — 실패", () => {
  test("ok:false → markFailed(행, error) 1회 · markSent 0 · 보고서 failed 1 · notify.send_failed warn 로그 1줄(id·channel·template·error, to 없음)", async () => {
    const r = row({ id: 11, attempts: 2 });
    const db = fakeDb({ claim: [r] });
    const { deps: d, log } = deps(db, spySender(() => ({ ok: false, error: "provider_timeout", retryable: true })));

    const report = await runNotificationWorker({ dryRun: false }, d);

    expect(db.markSent).not.toHaveBeenCalled();
    expect(db.markFailed).toHaveBeenCalledTimes(1);
    expect(db.markFailed.mock.calls[0][0]).toMatchObject({ id: 11, attempts: 2 });
    expect(db.markFailed.mock.calls[0][1]).toBe("provider_timeout");
    expect(report).toMatchObject({ claimed: 1, sent: 0, failed: 1, gaveUp: 0, duplicate: 0 });
    expect(report.ids.failed).toEqual([11]);

    const failedLogs = log.mock.calls.map((c) => c[0]).filter((e) => e.event === "notify.send_failed");
    expect(failedLogs).toHaveLength(1);
    expect(failedLogs[0]).toMatchObject({ level: "warn", id: 11, channel: "sms", template: "created.customer.sms", attempts: 2, error: "provider_timeout", retryable: true, gaveUp: false });
    expect(failedLogs[0]).not.toHaveProperty("to");
  });

  test("send 가 throw → 잡아서 markFailed(행, 'sender_threw:<sender 이름>') · 예외 문구는 DB 에도 로그에도 싣지 않는다 · 다음 행은 계속 처리한다", async () => {
    const rows = [row({ id: 21 }), row({ id: 22 })];
    const db = fakeDb({ claim: rows });
    const { deps: d, log } = deps(
      db,
      spySender((req) => {
        if (req.id === 21) throw new Error(`boom ${PHONE}`);
        return { ok: true, providerMessageId: "pm-22" };
      }),
    );

    const report = await runNotificationWorker({ dryRun: false }, d);

    expect(db.markFailed).toHaveBeenCalledTimes(1);
    expect(db.markFailed.mock.calls[0][0]).toMatchObject({ id: 21 });
    expect(db.markFailed.mock.calls[0][1]).toBe("sender_threw:spy");
    expect(db.markSent.mock.calls).toEqual([[22, "pm-22"]]);
    expect(report).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
    for (const line of logJson(log)) {
      expect(line).not.toContain("boom");
      expect(line).not.toContain(PHONE);
    }
  });

  test("5회째(attempts = MAX_ATTEMPTS) 실패는 give_up — 보고서 gaveUp 1 · failed 1, 로그 gaveUp:true (실제 전이는 0005 mark_notification_failed 가 한다)", async () => {
    const db = fakeDb({ claim: [row({ id: 31, attempts: MAX_ATTEMPTS })] });
    const { deps: d, log } = deps(db, spySender(() => ({ ok: false, error: "dead", retryable: false })));
    const report = await runNotificationWorker({ dryRun: false }, d);
    expect(db.markFailed).toHaveBeenCalledWith({ id: 31, attempts: MAX_ATTEMPTS }, "dead");
    expect(report).toMatchObject({ failed: 1, gaveUp: 1 });
    expect(log.mock.calls.map((c) => c[0]).find((e) => e.event === "notify.send_failed")).toMatchObject({ gaveUp: true, retryable: false });
  });

  test("retryable:false 여도 markFailed 는 같은 모양이다 — 백오프·give_up 판정은 0005 와 retryPlanAfterFailure 가 한다(이 태스크는 그 함수를 고치지 않는다)", async () => {
    const db = fakeDb({ claim: [row({ id: 32, attempts: 1 })] });
    const { deps: d } = deps(db, spySender(() => ({ ok: false, error: "invalid_recipient", retryable: false })));
    const report = await runNotificationWorker({ dryRun: false }, d);
    expect(db.markFailed).toHaveBeenCalledWith({ id: 32, attempts: 1 }, "invalid_recipient");
    expect(report.gaveUp).toBe(0);
  });

  test("lease 가 이미 지난 행은 보내지도 mark 하지도 않는다 — leaseExpired +1, warn 로그 1줄 (다른 발송기가 잡을 수 있는 행)", async () => {
    const expired = row({ id: 41, next_attempt_at: new Date(NOW.getTime() - 1).toISOString() });
    const fresh = row({ id: 42 });
    const db = fakeDb({ claim: [expired, fresh] });
    const sender = spySender();
    const { deps: d, log } = deps(db, sender);
    const report = await runNotificationWorker({ dryRun: false }, d);
    expect(sender.send.mock.calls.map((c) => c[0].id)).toEqual([42]);
    expect(db.markFailed).not.toHaveBeenCalled();
    expect(report).toMatchObject({ claimed: 2, sent: 1, leaseExpired: 1 });
    expect(report.ids.leaseExpired).toEqual([41]);
    expect(log.mock.calls.map((c) => c[0]).filter((e) => e.event === "notify.lease_expired")).toHaveLength(1);
  });

  test("template 이 TEMPLATE_KEYS 에 없는 행은 보내지 않고 markFailed('unknown_template') — 제공자 어댑터가 문안을 찾을 수 없는 행이다", async () => {
    const db = fakeDb({ claim: [row({ id: 52, template: "created.owner.fax" })] });
    const sender = spySender();
    const { deps: d } = deps(db, sender);
    const report = await runNotificationWorker({ dryRun: false }, d);
    expect(sender.send).not.toHaveBeenCalled();
    expect(db.markFailed).toHaveBeenCalledWith({ id: 52, attempts: 1 }, "unknown_template");
    expect(report).toMatchObject({ failed: 1, sent: 0 });
  });

  test("attempts 가 MAX_ATTEMPTS 를 넘는 행(불변식 위반)은 보내지 않고 markFailed('claim_invariant_violated') 로 닫는다", async () => {
    const db = fakeDb({ claim: [row({ id: 51, attempts: MAX_ATTEMPTS + 1 })] });
    const sender = spySender();
    const { deps: d } = deps(db, sender);
    const report = await runNotificationWorker({ dryRun: false }, d);
    expect(sender.send).not.toHaveBeenCalled();
    expect(db.markFailed).toHaveBeenCalledWith({ id: 51, attempts: MAX_ATTEMPTS + 1 }, "claim_invariant_violated");
    expect(report).toMatchObject({ failed: 1, gaveUp: 1, sent: 0 });
  });

  test("send 성공 뒤 markSent 가 throw 하면(DB 오류) 그 행은 sentUnmarked +1 · markErrors +1 · ids.sentUnmarked · error 로그(op:markSent), 나머지 행은 계속 — 중복 수신 창을 보고서가 드러낸다(리뷰 N1)", async () => {
    const db = fakeDb({ claim: [row({ id: 61 }), row({ id: 62 })] });
    db.markSent.mockImplementationOnce(async () => {
      throw new Error("outbox.markSent: [08006] connection lost");
    });
    const { deps: d, log } = deps(db, spySender());
    const report = await runNotificationWorker({ dryRun: false }, d);
    expect(db.markSent).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ claimed: 2, sent: 1, markErrors: 1, sentUnmarked: 1, failed: 0 });
    expect(report.ids.sentUnmarked).toEqual([61]);
    expect(report.ids.sent).toEqual([62]);
    expect(log.mock.calls.map((c) => c[0]).filter((e) => e.event === "notify.mark_failed")).toMatchObject([
      { level: "error", id: 61, op: "markSent", error: "outbox.markSent: [08006] connection lost" },
    ]);
  });

  test("실패 경로에서 markFailed 자체가 throw 하면 그 행은 markErrors +1 · error 로그(op:markFailed) · failed/gaveUp 미증가 · sentUnmarked 아님, 다음 행은 계속 (리뷰 M1-a)", async () => {
    const db = fakeDb({ claim: [row({ id: 63, attempts: MAX_ATTEMPTS }), row({ id: 64 })] });
    db.markFailed.mockImplementationOnce(async () => {
      throw new Error("outbox.markFailed: [57014] statement timeout");
    });
    const sender = spySender((req) => (req.id === 63 ? { ok: false, error: "provider_timeout", retryable: true } : { ok: true, providerMessageId: "pm-64" }));
    const { deps: d, log } = deps(db, sender);
    const report = await runNotificationWorker({ dryRun: false }, d);

    expect(db.markFailed).toHaveBeenCalledTimes(1);
    expect(db.markFailed.mock.calls[0][0]).toMatchObject({ id: 63, attempts: MAX_ATTEMPTS });
    expect(sender.send.mock.calls.map((c) => c[0].id)).toEqual([63, 64]);
    expect(db.markSent.mock.calls).toEqual([[64, "pm-64"]]);
    expect(report).toMatchObject({ claimed: 2, sent: 1, failed: 0, gaveUp: 0, markErrors: 1, sentUnmarked: 0 });
    expect(report.ids.failed).toEqual([]);
    expect(report.ids.sentUnmarked).toEqual([]);
    const entries = log.mock.calls.map((c) => c[0]);
    expect(entries.filter((e) => e.event === "notify.mark_failed")).toMatchObject([{ level: "error", id: 63, op: "markFailed", error: "outbox.markFailed: [57014] statement timeout" }]);
    // 못 적었으니 send_failed 도 남기지 않는다 — 기록된 것처럼 보이면 안 된다
    expect(entries.filter((e) => e.event === "notify.send_failed")).toEqual([]);
  });

  test("reapStale 이 throw 하면 실행 전체가 throw — claim 도 send 도 없이 (크론 500, 리뷰 M1-b)", async () => {
    const db = fakeDb({ claim: [row()] });
    db.reapStale.mockImplementationOnce(async () => {
      throw new Error("outbox.reapStale: [42883] function reap_stale_notifications() does not exist");
    });
    const sender = spySender();
    const { deps: d, log } = deps(db, sender);
    await expect(runNotificationWorker({ dryRun: false }, d)).rejects.toThrow(/reapStale/);
    expect(db.claimPending).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
    expect(db.pendingStats).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  test("claimPending 이 throw 하면 실행 전체가 throw (reap 은 이미 됨)", async () => {
    const db = fakeDb();
    db.claimPending.mockImplementationOnce(async () => {
      throw new Error("outbox.claimPending: [42501] permission denied");
    });
    const { deps: d } = deps(db, spySender());
    await expect(runNotificationWorker({ dryRun: false }, d)).rejects.toThrow(/claimPending/);
    expect(db.reapStale).toHaveBeenCalledTimes(1);
  });

  test("pendingStats 가 throw 하면 실행 전체가 throw — dry-run 에서도 (보고서 없는 200 은 없다)", async () => {
    for (const dryRun of [true, false]) {
      const db = fakeDb();
      db.pendingStats.mockImplementationOnce(async () => {
        throw new Error("worker.pendingStats: boom");
      });
      const { deps: d, log } = deps(db, spySender());
      await expect(runNotificationWorker({ dryRun }, d), String(dryRun)).rejects.toThrow(/pendingStats/);
      expect(log, String(dryRun)).not.toHaveBeenCalled();
    }
  });
});

// =============================================================================
// 5. 중복
// =============================================================================
describe("runNotificationWorker — 중복", () => {
  test("markSent 가 false(같은 키에 이미 sent) → duplicate +1 · sent 그대로 · 예외 아님 · warn 로그", async () => {
    const db = fakeDb({ claim: [row({ id: 71 }), row({ id: 72 })], markSent: (id) => id !== 71 });
    const { deps: d, log } = deps(db, spySender());
    const report = await runNotificationWorker({ dryRun: false }, d);
    expect(report).toMatchObject({ claimed: 2, sent: 1, duplicate: 1, failed: 0 });
    expect(report.ids.duplicate).toEqual([71]);
    expect(report.ids.sent).toEqual([72]);
    expect(db.markFailed).not.toHaveBeenCalled();
    expect(log.mock.calls.map((c) => c[0]).filter((e) => e.event === "notify.duplicate_sent")).toMatchObject([{ level: "warn", id: 71 }]);
  });
});

// =============================================================================
// 6. 순서
// =============================================================================
describe("runNotificationWorker — 순서", () => {
  test("reap → claim → (send → mark) × N — 행마다 send 직후 mark, 다음 행으로 (invocationCallOrder)", async () => {
    const db = fakeDb({ claim: [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })] });
    const sender = spySender((req) => (req.id === 2 ? { ok: false, error: "x", retryable: true } : { ok: true, providerMessageId: "pm" }));
    const { deps: d } = deps(db, sender);
    await runNotificationWorker({ dryRun: false }, d);

    const reap = db.reapStale.mock.invocationCallOrder[0];
    const claim = db.claimPending.mock.invocationCallOrder[0];
    const sends = sender.send.mock.invocationCallOrder;
    const [sent1, sent3] = db.markSent.mock.invocationCallOrder;
    const [failed2] = db.markFailed.mock.invocationCallOrder;
    const stats = db.pendingStats.mock.invocationCallOrder[0];

    expect(reap).toBeLessThan(claim);
    expect(claim).toBeLessThan(sends[0]);
    expect(sends[0]).toBeLessThan(sent1);
    expect(sent1).toBeLessThan(sends[1]);
    expect(sends[1]).toBeLessThan(failed2);
    expect(failed2).toBeLessThan(sends[2]);
    expect(sends[2]).toBeLessThan(sent3);
    // 통계는 처리가 끝난 뒤 — 남은 backlog 를 보고한다
    expect(sent3).toBeLessThan(stats);
  });
});

// =============================================================================
// 7. 개인정보 0
// =============================================================================
describe("runNotificationWorker — 보고서·로그에 개인정보 0", () => {
  test("더미 행에 전화·메일을 넣고 sender 오류 문구에도 섞어도 — 보고서·로그 JSON 어디에도 그 값이 없고 'to' 키도 없다", async () => {
    const rows = [
      row({ id: 1, to: PHONE }),
      row({ id: 2, to: EMAIL, channel: "email", template: "created.owner.email" }),
      row({ id: 3, to: "010-1234-5678", template: "created.owner.sms" }),
      row({ id: 4, to: PHONE, template: "confirmed.customer.sms", event: "confirmed" }),
      row({ id: 5, to: PHONE, template: "created.owner.sms" }), // markSent 가 throw (수신처가 섞인 DB 오류) → sentUnmarked
      row({ id: 6, to: EMAIL, channel: "email", template: "created.owner.email", event: "confirmed" }), // markFailed 가 throw
    ];
    const db = fakeDb({ claim: rows, reap: [row({ id: 9, status: "failed", attempts: 5 })], stats: { pending: 1 } });
    db.markSent.mockImplementation(async (id) => {
      if (id === 5) throw new Error(`outbox.markSent: [23505] duplicate key value violates … (to_phone)=(${PHONE})`);
      return true;
    });
    db.markFailed.mockImplementation(async (r) => {
      if (r.id === 6) throw new Error(`outbox.markFailed: detail ${EMAIL}`);
    });
    const sender = spySender((req) => {
      if (req.id === 1) return { ok: false, error: `rejected recipient ${req.to}`, retryable: false };
      if (req.id === 2) throw new Error(`smtp: ${req.to} unknown`);
      if (req.id === 3) return { ok: false, error: `bad number 01012345678 (${req.to})`, retryable: true };
      if (req.id === 6) return { ok: false, error: "smtp_5xx", retryable: true };
      return { ok: true, providerMessageId: `pm-${req.to}` };
    });
    const { deps: d, log } = deps(db, sender);

    const report = await runNotificationWorker({ dryRun: false }, d);
    // 1·2·3 실패 기록됨(failed 3) · 4 sent · 5 보냈는데 못 적음(sentUnmarked) · 6 실패를 못 적음(markErrors 에만)
    expect(report).toMatchObject({ claimed: 6, sent: 1, failed: 3, sentUnmarked: 1, markErrors: 2 });
    expect(report.ids.sentUnmarked).toEqual([5]);

    const reportJson = JSON.stringify(report);
    const all = [reportJson, ...logJson(log)];
    expect(all.length).toBeGreaterThan(1);
    for (const s of all) {
      expect(s).not.toContain(PHONE);
      expect(s).not.toContain("1234");
      expect(s).not.toContain(EMAIL);
      expect(s).not.toContain("example.com");
      // 키로서의 to·name·phone·email·message 가 없다 (값 "email" 은 channel 코드라 허용 — 키 형태 `"email":` 만 잡는다)
      expect(s).not.toMatch(/"(to|to_phone|name|phone|email|message)":/);
    }
    // 오류 문구는 수신처를 지운 뒤 DB 로도 간다
    for (const call of db.markFailed.mock.calls) {
      expect(call[1]).not.toContain(PHONE);
      expect(call[1]).not.toContain(EMAIL);
      expect(call[1]).not.toContain("1234");
    }
    // providerMessageId 에 수신처가 들어 있으면(제공자 버그) 보고서에 싣지 않는다 — 보고서는 id·카운트뿐
    expect(reportJson).not.toContain("pm-");
    expect(report.sent).toBe(1);
    // mark 오류 로그(op:markSent·markFailed)도 수신처를 지운 뒤 남는다
    const markLogs = log.mock.calls.map((c) => c[0]).filter((e) => e.event === "notify.mark_failed");
    expect(markLogs.map((e) => (e.event === "notify.mark_failed" ? e.op : ""))).toEqual(["markSent", "markFailed"]);
    expect(JSON.stringify(markLogs)).toContain("[to]");
  });

  test("scrubError — 수신처(원문·숫자만·하이픈 제거)를 지우고 길이를 200자로 자른다", () => {
    expect(scrubError(`rejected ${PHONE}`, PHONE)).toBe("rejected [to]");
    expect(scrubError("bad 010-1234-5678 / 01012345678", "010-1234-5678")).toBe("bad [to] / [to]");
    expect(scrubError(`smtp ${EMAIL} unknown`, EMAIL)).toBe("smtp [to] unknown");
    expect(scrubError("x".repeat(500), PHONE)).toHaveLength(200);
    expect(scrubError("plain", "")).toBe("plain");
  });

  test("보고서 키 집합 — 카운트·id·시각뿐 (to·name·template 문안 없음)", async () => {
    const db = fakeDb({ claim: [row()] });
    const { deps: d } = deps(db, spySender());
    const report = await runNotificationWorker({ dryRun: false }, d);
    expect(Object.keys(report).sort()).toEqual(
      [
        // P4-5 — claim 대상 채널(개인정보 아님: 'sms'·'email' 같은 낱말뿐)
        "channels",
        "claimed",
        "dryRun",
        "duplicate",
        "failed",
        "gaveUp",
        "ids",
        "leaseExpired",
        "limit",
        "markErrors",
        "nowIso",
        "oldestPendingAgeMs",
        "pending",
        "pendingTruncated",
        "reaped",
        "sender",
        "sent",
        "sentUnmarked",
        "wouldReap",
      ].sort(),
    );
    expect(Object.keys(report.ids).sort()).toEqual(["duplicate", "failed", "leaseExpired", "reaped", "sent", "sentUnmarked"]);
  });
});

// =============================================================================
// lib/log.ts — info 레벨 (worker_run 정상 실행은 warn 이 아니다)
// =============================================================================
describe("structuredLog — info 레벨", () => {
  test("level:'info' 는 console.info 로 한 줄 JSON", async () => {
    // 이 파일은 라우트 테스트 때문에 @/lib/log 를 mock 한다 — 여기서는 실제 구현을 가져온다
    const { structuredLog: realLog } = await vi.importActual<typeof import("@/lib/log")>("@/lib/log");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      realLog({ level: "info", event: "notify.worker_run" });
      expect(info).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({ level: "info", event: "notify.worker_run" });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });
});

// =============================================================================
// supabaseWorkerDb — supabase-js 호출 모양 (가짜 빌더)
// =============================================================================
type SbCall = { kind: "rpc"; fn: string; args: unknown } | { kind: "from"; table: string; chain: { op: string; args: unknown[] }[] };

function fakeSupabase(opts: { rpc?: Record<string, unknown>; select?: unknown[]; selectError?: { message: string } | null } = {}) {
  const calls: SbCall[] = [];
  const client = {
    rpc(fn: string, args?: unknown) {
      calls.push({ kind: "rpc", fn, args });
      return Promise.resolve({ data: opts.rpc?.[fn] ?? null, error: null });
    },
    from(table: string) {
      const chain: { op: string; args: unknown[] }[] = [];
      calls.push({ kind: "from", table, chain });
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "eq", "order", "limit"]) {
        builder[op] = (...args: unknown[]) => {
          chain.push({ op, args });
          return builder;
        };
      }
      builder.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve({ data: opts.selectError ? null : (opts.select ?? []), error: opts.selectError ?? null }).then(onOk, onErr);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("supabaseWorkerDb — 0005·0007 어댑터 연결 + pendingStats 쿼리 모양", () => {
  const dbRow = {
    id: 5,
    reservation_id: RID,
    event: "created",
    channel: "sms",
    to_phone: PHONE,
    template: "created.owner.sms",
    status: "pending",
    attempts: 1,
    last_error: null,
    updated_at: NOW.toISOString(),
    next_attempt_at: LEASE_UNTIL,
  };

  test("reapStale / claimPending / markSent / markFailed 는 outbox.ts 어댑터를 그대로 부른다", async () => {
    const { client, calls } = fakeSupabase({ rpc: { claim_pending_notifications: [dbRow], reap_stale_notifications: [], mark_notification_sent: true } });
    const db = supabaseWorkerDb(client);
    expect(await db.reapStale()).toEqual([]);
    const claimed = await db.claimPending(7, ["sms"]);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: 5, to: PHONE });
    expect(await db.markSent(5, "pm")).toBe(true);
    await db.markFailed({ id: 5, attempts: 1 }, "timeout");
    const rpcs = calls.filter((c): c is Extract<SbCall, { kind: "rpc" }> => c.kind === "rpc");
    expect(rpcs.map((c) => c.fn)).toEqual(["reap_stale_notifications", "claim_pending_notifications", "mark_notification_sent", "mark_notification_failed"]);
    expect(rpcs[1].args).toEqual({ p_limit: 7, p_channels: ["sms"] });
    expect(rpcs[2].args).toEqual({ p_id: 5, p_provider_message_id: "pm" });
    expect(rpcs[3].args).toEqual({ p_id: 5, p_error: "timeout", p_give_up: false, p_retry_after_ms: 1 * MINUTE });
  });

  test("pendingStats: notifications_log 에서 개인정보 아닌 컬럼만 · status=pending · created_at asc · limit — 개수·최고령·회수 대상을 계산한다", async () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    const future = new Date(NOW.getTime() + 1000).toISOString();
    const pendingRows = [
      { id: 1, created_at: new Date(NOW.getTime() - 10 * MINUTE).toISOString(), attempts: 5, next_attempt_at: past }, // 회수 대상
      { id: 2, created_at: new Date(NOW.getTime() - 5 * MINUTE).toISOString(), attempts: 4, next_attempt_at: past }, // 재시도 대상
      { id: 3, created_at: new Date(NOW.getTime() - 1 * MINUTE).toISOString(), attempts: 5, next_attempt_at: future }, // lease 중
      { id: 4, created_at: NOW.toISOString(), attempts: 5, next_attempt_at: NOW.toISOString() }, // 경계: <= now 는 회수 대상
    ];
    const { client, calls } = fakeSupabase({ select: pendingRows });
    const stats = await supabaseWorkerDb(client).pendingStats(NOW);
    expect(stats).toEqual<PendingStats>({ pending: 4, truncated: false, oldestCreatedAt: pendingRows[0].created_at, wouldReap: 2 });

    const from = calls.find((c): c is Extract<SbCall, { kind: "from" }> => c.kind === "from");
    expect(from?.table).toBe("notifications_log");
    const ops = from?.chain ?? [];
    expect(ops.map((o) => o.op)).toEqual(["select", "eq", "order", "limit"]);
    expect(ops[0].args[0]).toBe(PENDING_STATS_COLUMNS);
    expect(String(ops[0].args[0])).not.toMatch(/to_phone|\*/);
    expect(ops[1].args).toEqual(["status", "pending"]);
    expect(ops[2].args).toEqual(["created_at", { ascending: true }]);
    expect(ops[3].args).toEqual([PENDING_STATS_SCAN_LIMIT]);
    expect(PENDING_STATS_SCAN_LIMIT).toBeGreaterThanOrEqual(100);
  });

  test("pendingStats: 행이 scanLimit 만큼이면 truncated:true, 0행이면 oldestCreatedAt null, 오류는 throw", async () => {
    const many = Array.from({ length: PENDING_STATS_SCAN_LIMIT }, (_, i) => ({ id: i, created_at: NOW.toISOString(), attempts: 0, next_attempt_at: NOW.toISOString() }));
    expect((await supabaseWorkerDb(fakeSupabase({ select: many }).client).pendingStats(NOW)).truncated).toBe(true);
    expect(await supabaseWorkerDb(fakeSupabase({ select: [] }).client).pendingStats(NOW)).toEqual<PendingStats>({ pending: 0, truncated: false, oldestCreatedAt: null, wouldReap: 0 });
    await expect(supabaseWorkerDb(fakeSupabase({ selectError: { message: "boom" } }).client).pendingStats(NOW)).rejects.toThrow(/pendingStats.*boom/);
  });
});

// =============================================================================
// 8. 정적 — env·지시어·제공자 심볼
// =============================================================================
describe("정적 — lib/notify/worker.ts · sender.ts 는 순수, route.ts 만 env 를 본다", () => {
  const worker = readFileSync(path.join(ROOT, "lib", "notify", "worker.ts"), "utf-8");
  const sender = readFileSync(path.join(ROOT, "lib", "notify", "sender.ts"), "utf-8");
  const route = readFileSync(path.join(ROOT, "app", "api", "cron", "notify", "route.ts"), "utf-8");

  test("worker.ts · sender.ts — process.env 0 · 'use server' 0 · server-only 0 · 제공자(SDK) 심볼 0", () => {
    for (const [name, src] of [
      ["worker.ts", worker],
      ["sender.ts", sender],
    ] as const) {
      expect(src, name).not.toMatch(/process\.env/);
      expect(src, name).not.toMatch(/["']use server["']/);
      expect(src, name).not.toMatch(/import\s+["']server-only["']/);
      expect(src, name).not.toMatch(/solapi/i);
      expect(src, name).not.toMatch(/\bfetch\(/);
    }
  });

  test("route.ts — timingSafeEqual · dry 쿼리 · no-store · createServiceClient · NOTIFY_SENDER 분기 · 'use server' 없음", () => {
    expect(route).toContain("timingSafeEqual");
    expect(route).toMatch(/searchParams\.get\("dry"\)\s*!==\s*"0"/);
    expect(route).toContain("no-store");
    expect(route).toContain("createServiceClient");
    expect(route).toContain("NOTIFY_SENDER");
    expect(route).toContain('runtime = "nodejs"');
    expect(route).toContain('dynamic = "force-dynamic"');
    expect(route).not.toMatch(/["']use server["']/);
    expect(route).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    // sender 선택은 이 파일에서만 env 를 본다 — P4-2 가 여기 한 분기를 추가한다
    expect(route).toMatch(/P4-2/);
  });
});

// =============================================================================
// 라우트 GET /api/cron/notify — CRON_SECRET · dry 기본 · sender 선택 · 응답
// =============================================================================
vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));

const routeState: {
  pending: Record<string, unknown>[];
  claim: Record<string, unknown>[];
  reap: Record<string, unknown>[];
  rpcs: { fn: string; args: unknown }[];
  /** 설정되면 claim RPC 가 이 오류를 돌려준다 (500 경로). */
  claimError: { code: string; message: string } | null;
} = { pending: [], claim: [], reap: [], rpcs: [], claimError: null };
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => routeSupabase() }));
function routeSupabase() {
  return {
    rpc(fn: string, args?: unknown) {
      routeState.rpcs.push({ fn, args });
      if (fn === "reap_stale_notifications") return Promise.resolve({ data: routeState.reap.splice(0), error: null });
      if (fn === "claim_pending_notifications") {
        if (routeState.claimError) return Promise.resolve({ data: null, error: routeState.claimError });
        return Promise.resolve({ data: routeState.claim.splice(0), error: null });
      }
      if (fn === "mark_notification_sent") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from() {
      const b: Record<string, unknown> = {};
      for (const op of ["select", "eq", "order", "limit"]) b[op] = () => b;
      b.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => Promise.resolve({ data: routeState.pending, error: null }).then(onOk, onErr);
      return b;
    },
  };
}

describe("GET /api/cron/notify", () => {
  const SECRET = "test-cron-secret-0123456789";
  const URL_BASE = "http://localhost/api/cron/notify";
  const AUTH = { Authorization: `Bearer ${SECRET}` };

  const claimDbRow = (id: number) => ({
    id,
    reservation_id: RID,
    event: "created",
    channel: "sms",
    to_phone: PHONE,
    template: "created.customer.sms",
    status: "pending",
    attempts: 1,
    last_error: null,
    updated_at: new Date().toISOString(),
    next_attempt_at: new Date(Date.now() + CLAIM_LEASE_MS).toISOString(),
  });

  async function call(headers: Record<string, string>, query = ""): Promise<{ status: number; body: unknown; text: string; res: Response }> {
    process.env.CRON_SECRET = SECRET;
    const { GET } = await import("@/app/api/cron/notify/route");
    const res = await GET(new Request(`${URL_BASE}${query}`, { headers }));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text, res };
  }

  afterEach(() => {
    routeState.pending = [];
    routeState.claim = [];
    routeState.reap = [];
    routeState.rpcs = [];
    routeState.claimError = null;
    delete process.env.NOTIFY_SENDER;
    delete process.env.VERCEL_ENV;
    vi.mocked(structuredLog).mockClear();
  });

  test("Authorization 없음 → 401, DB 호출 0", async () => {
    const r = await call({});
    expect(r.status).toBe(401);
    expect(r.text).not.toContain("claimed");
    expect(routeState.rpcs).toEqual([]);
  });

  test("시크릿 틀림 → 401 (길이 다름·같은 길이 다른 값·Bearer 없음)", async () => {
    expect((await call({ Authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ Authorization: `Bearer ${SECRET.slice(0, -1)}X` })).status).toBe(401);
    expect((await call({ Authorization: SECRET })).status).toBe(401);
  });

  test("CRON_SECRET 미설정이면 어떤 요청도 401 (fail-closed)", async () => {
    process.env.CRON_SECRET = SECRET;
    const { GET } = await import("@/app/api/cron/notify/route");
    delete process.env.CRON_SECRET;
    const res = await GET(new Request(URL_BASE, { headers: { Authorization: "Bearer " } }));
    expect(res.status).toBe(401);
  });

  test("시크릿 맞음 + dry 없음 → dry-run 보고: RPC 0회(reap 도 claim 도 없음) · sender 는 unconfigured · wouldReap 계산", async () => {
    routeState.pending = [{ id: 1, created_at: new Date(Date.now() - MINUTE).toISOString(), attempts: 5, next_attempt_at: new Date(Date.now() - 1000).toISOString() }];
    routeState.claim = [claimDbRow(1)];
    const r = await call(AUTH);
    expect(r.status).toBe(200);
    const report = r.body as WorkerReport;
    expect(report.dryRun).toBe(true);
    expect(report.sender).toBe(UNCONFIGURED_SENDER_NAME);
    expect(report.wouldReap).toBe(1);
    expect(report.pending).toBe(1);
    expect(routeState.rpcs).toEqual([]);
  });

  test("?dry=1 · ?dry=true · ?dry= · ?dry=no 도 dry-run — 오직 dry=0 만 실행", async () => {
    for (const q of ["?dry=1", "?dry=true", "?dry=", "?dry=no"]) {
      const r = await call(AUTH, q);
      expect((r.body as WorkerReport).dryRun, q).toBe(true);
    }
    expect(routeState.rpcs).toEqual([]);
  });

  test("?dry=0 + NOTIFY_SENDER 미설정 → 미구성: reap RPC 1회 · claim RPC 0회 · skipped:'sender_not_configured'", async () => {
    routeState.claim = [claimDbRow(1)];
    const r = await call(AUTH, "?dry=0");
    expect(r.status).toBe(200);
    const report = r.body as WorkerReport;
    expect(report).toMatchObject({ dryRun: false, sender: UNCONFIGURED_SENDER_NAME, skipped: "sender_not_configured", claimed: 0 });
    expect(routeState.rpcs.map((c) => c.fn)).toEqual(["reap_stale_notifications"]);
  });

  test("?dry=0 + NOTIFY_SENDER=memory → memory sender 로 claim → mark_notification_sent (로컬 실증 경로)", async () => {
    process.env.NOTIFY_SENDER = "memory";
    routeState.claim = [claimDbRow(1), claimDbRow(2)];
    const r = await call(AUTH, "?dry=0");
    expect(r.status).toBe(200);
    const report = r.body as WorkerReport;
    expect(report).toMatchObject({ dryRun: false, sender: MEMORY_SENDER_NAME, claimed: 2, sent: 2 });
    expect(report.skipped).toBeUndefined();
    expect(routeState.rpcs.map((c) => c.fn)).toEqual([
      "reap_stale_notifications",
      "claim_pending_notifications",
      "mark_notification_sent",
      "mark_notification_sent",
    ]);
    expect(routeState.rpcs[2].args).toEqual({ p_id: 1, p_provider_message_id: "memory-1" });
  });

  test("NOTIFY_SENDER=memory 라도 VERCEL_ENV=production 이면 무시 — 운영에서 발송 없이 sent 처리되는 사고를 막는다", async () => {
    process.env.NOTIFY_SENDER = "memory";
    process.env.VERCEL_ENV = "production";
    routeState.claim = [claimDbRow(1)];
    const r = await call(AUTH, "?dry=0");
    const report = r.body as WorkerReport;
    expect(report.sender).toBe(UNCONFIGURED_SENDER_NAME);
    expect(report.skipped).toBe("sender_not_configured");
    expect(routeState.rpcs.map((c) => c.fn)).toEqual(["reap_stale_notifications"]);
    // 무시했다는 것을 warn 로그로 남긴다
    expect(vi.mocked(structuredLog).mock.calls.map((c) => c[0])).toContainEqual(expect.objectContaining({ level: "warn", event: "notify.memory_sender_refused" }));
  });

  test("응답 본문·로그에 수신처 값이 없다 (to_phone 은 DB 행에만)", async () => {
    process.env.NOTIFY_SENDER = "memory";
    routeState.claim = [claimDbRow(1)];
    routeState.pending = [{ id: 2, created_at: new Date().toISOString(), attempts: 0, next_attempt_at: new Date().toISOString() }];
    const r = await call(AUTH, "?dry=0");
    expect(r.text).not.toContain(PHONE);
    expect(r.text).not.toMatch(/"(to|to_phone|name|phone|email|message)":/);
    for (const c of vi.mocked(structuredLog).mock.calls) {
      expect(JSON.stringify(c[0])).not.toContain(PHONE);
    }
  });

  test("응답은 캐시되지 않는다 (Cache-Control: no-store) · JSON", async () => {
    const r = await call(AUTH);
    expect(r.res.headers.get("cache-control")).toContain("no-store");
    expect(r.res.headers.get("content-type")).toContain("application/json");
  });

  test("worker 가 throw 하면(claim RPC 오류) 500 · 본문은 error 코드뿐 · error 로그 1줄 · 수신처 없음", async () => {
    process.env.NOTIFY_SENDER = "memory";
    routeState.claimError = { code: "42501", message: "permission denied" };
    const r = await call(AUTH, "?dry=0");
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: "notify_failed" });
    const errors = vi.mocked(structuredLog).mock.calls.map((c) => c[0]).filter((e) => e.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ event: "notify.worker_error" });
    expect(JSON.stringify(errors[0])).toMatch(/claimPending/);
    expect(JSON.stringify(errors[0])).not.toContain(PHONE);
  });
});

// =============================================================================
// vercel.json — 5분 주기 (lease 5분과 맞춤), purge 항목 유지
// =============================================================================
describe("vercel.json crons", () => {
  const p = path.join(ROOT, "vercel.json");
  const json = JSON.parse(readFileSync(p, "utf-8")) as { crons?: { path: string; schedule: string }[] };

  test("/api/cron/notify 가 '*/5 * * * *' 로 있다 — CLAIM_LEASE_MS(5분)와 같은 간격", () => {
    expect(existsSync(p)).toBe(true);
    const entry = json.crons?.find((c) => c.path.split("?")[0] === "/api/cron/notify");
    expect(entry).toBeDefined();
    expect(entry?.schedule).toBe("*/5 * * * *");
    expect(CLAIM_LEASE_MS).toBe(5 * MINUTE);
  });

  test("purge 항목은 그대로 ('0 19 * * *') 이고 크론은 정확히 2개", () => {
    expect(json.crons?.find((c) => c.path.split("?")[0] === "/api/cron/purge")?.schedule).toBe("0 19 * * *");
    expect(json.crons).toHaveLength(2);
  });
});

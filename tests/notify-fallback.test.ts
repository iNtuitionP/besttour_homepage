/**
 * P4-4 — 발송이 끝내 실패하면 사장님께 알린다 (플랜 v4 · ADR-7 · CLAUDE.md §3·§7).
 *
 * 브리프 §검증 1~9 를 그대로 단언한다:
 *   1. give_up 에서만 1건 — 실패 1~4회는 새 행 0건, 5회째(give_up)에 정확히 1건
 *   2. 🔴 **재귀 차단** — `*.owner.failure.email` 이 5회 실패해도 새 행 0건. **이 단언이 이 파일의 존재 이유다**
 *   3. 묶임 — 같은 예약의 created 통지 2건이 모두 죽어도 알림 1건(유니크 키), confirmed 가 나중에 죽으면 그때 1건 더
 *   4. OWNER_EMAIL 없음 → 행 0건이고 **보고서에 이유가 드러난다**(조용히 넘어가지 않는다)
 *   5. 개인정보 0 — 렌더된 문안·넣는 행·보고서·로그 어디에도 고객 이름·전화·메일·문의내용이 없다
 *   6. From 은 MAIL_FROM 뿐 — 수신 전용 주소를 발신에 쓰지 않는다
 *   7. 기존 문안 4종 **바이트 무변경**(sha256 고정) · verbatim 무손상
 *   8. DB 실증 — 실제 행으로 1·2·3 을 재현(로컬 스택 + REQUIRE_DB_TESTS=1)
 *
 * 주의: tests/ 아래라 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { VERBATIM } from "@/lib/legal/disclosures";
import {
  FAILURE_NOTICE_CHANNEL,
  FAILURE_TEMPLATE_BY_EVENT,
  isFailureTemplate,
  planFailureNotice,
  type FailureNoticeSkipReason,
} from "@/lib/notify/fallback";
import { ALL_TEMPLATE_KEYS, FAILURE_TEMPLATE_KEYS, MAX_ATTEMPTS, TEMPLATE_KEYS } from "@/lib/notify/outbox";
import { memorySender, type NotificationSender, type SendOutcome } from "@/lib/notify/sender";
import { TEMPLATE_AUDIENCE } from "@/lib/notify/solapi";
import { ADMIN_NOTIFICATIONS_PATH, renderTemplate, renderVariants, type CustomerVars, type OwnerVars } from "@/lib/notify/templates";
import {
  runNotificationWorker,
  supabaseWorkerDb,
  type PendingStats,
  type WorkerDb,
  type WorkerLogEntry,
  type WorkerReport,
} from "@/lib/notify/worker";
import { consentFields } from "@/lib/reservations/consent";
import type { NewOutboxRow, NotifyEvent, OutboxRow } from "@/lib/types";
import { withNotificationsLock } from "./helpers/db-lock";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf-8");
const MINUTE = 60_000;

const NOW = new Date("2026-09-16T00:00:00.000Z");
const LEASE_UNTIL = new Date(NOW.getTime() + 5 * MINUTE).toISOString();
const RID = "00000000-0000-4000-8000-000000000044";

/** 사장님 수신 주소 — 이 값은 **행의 수신처로만** 나가고 보고서·로그에는 실리지 않는다. */
const OWNER_EMAIL = "owner-inbox@example.test";

/** 고객 개인정보 — 알림 어디에도 다시 실려서는 안 되는 값들 (§5). */
const PII = {
  name: "한지원",
  phone: "01020488585",
  phoneDashed: "010-2048-8585",
  email: "customer@example.test",
  message: "공항에서 새벽에 출발합니다",
} as const;

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 1,
    reservation_id: RID,
    event: "created",
    channel: "sms",
    to: PII.phone,
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

/**
 * 실제 `enqueue` 의 사전 중복 확인을 흉내 낸다 — 같은 `(reservation_id, event, channel, template)` 가 이미 있으면
 * 넣지 않고 `[]` 를 돌려준다(outbox.ts enqueue). 묶임을 단위 테스트에서 재현하려면 이 성질이 필요하다.
 */
function fakeOutbox() {
  const inserted: NewOutboxRow[] = [];
  const keys = new Set<string>();
  let nextId = 900;
  const enqueueFailureNotice = vi.fn<WorkerDb["enqueueFailureNotice"]>(async (r) => {
    const key = `${r.reservation_id}|${r.event}|${r.channel}|${r.template}`;
    if (keys.has(key)) return [];
    keys.add(key);
    inserted.push(r);
    return [(nextId += 1)];
  });
  return { inserted, enqueueFailureNotice };
}

function fakeDb(claim: OutboxRow[], outbox = fakeOutbox(), reap: OutboxRow[] = []): WorkerDb & { inserted: NewOutboxRow[] } {
  const batches = [claim];
  const reapBatches = [reap];
  return {
    inserted: outbox.inserted,
    reapStale: vi.fn<WorkerDb["reapStale"]>(async () => reapBatches.shift() ?? []),
    claimPending: vi.fn<WorkerDb["claimPending"]>(async () => batches.shift() ?? []),
    markSent: vi.fn<WorkerDb["markSent"]>(async () => true),
    markFailed: vi.fn<WorkerDb["markFailed"]>(async () => {}),
    enqueueFailureNotice: outbox.enqueueFailureNotice,
    pendingStats: vi.fn<WorkerDb["pendingStats"]>(async () => emptyStats),
  };
}

/** 언제나 실패하는 sender — 전 채널을 받는다(memorySender 와 같은 계약). */
function failingSender(outcome: SendOutcome = { ok: false, error: "provider_403", retryable: false }): NotificationSender {
  return memorySender(() => outcome);
}

/**
 * `ownerEmail` 은 **객체로 받는다** — 기본값 매개변수로 두면 `undefined` 를 명시적으로 넘겨도 기본값이 되살아나,
 * "OWNER_EMAIL 이 없을 때" 를 단언하려던 테스트가 실제로는 있는 상태를 재는 사고가 난다(2026-09-16 실측으로 한 번 밟았다).
 */
function runDeps(db: WorkerDb, sender: NotificationSender, over: { ownerEmail?: string } = { ownerEmail: OWNER_EMAIL }) {
  const log = vi.fn<(entry: WorkerLogEntry) => void>();
  return { deps: { db, sender, ownerEmail: over.ownerEmail, now: () => NOW, log }, log };
}

const noticeLogs = (log: { mock: { calls: unknown[][] } }) =>
  log.mock.calls.map((c) => c[0] as WorkerLogEntry).filter((e) => e.event === "notify.failure_notice");

// =============================================================================
// 1. 키 카탈로그 · 재귀 판정식
// =============================================================================
describe("1. 키 — 실패 알림 키는 예약 통지 키와 분리돼 있다", () => {
  test("예약 통지 키 4종은 그대로이고, 실패 알림 키 2종이 따로 있다 (ALL_TEMPLATE_KEYS 가 합집합)", () => {
    expect([...TEMPLATE_KEYS]).toEqual(["created.owner.sms", "created.owner.email", "created.customer.sms", "confirmed.customer.sms"]);
    expect([...FAILURE_TEMPLATE_KEYS]).toEqual(["created.owner.failure.email", "confirmed.owner.failure.email"]);
    expect([...ALL_TEMPLATE_KEYS]).toEqual([...TEMPLATE_KEYS, ...FAILURE_TEMPLATE_KEYS]);
    expect(new Set(ALL_TEMPLATE_KEYS).size).toBe(ALL_TEMPLATE_KEYS.length);
  });

  test("event 마다 실패 알림 키가 정확히 하나 있고, 키 안의 event 와 일치한다", () => {
    const events: NotifyEvent[] = ["created", "confirmed"];
    expect(Object.keys(FAILURE_TEMPLATE_BY_EVENT).sort()).toEqual([...events].sort());
    for (const event of events) {
      const key = FAILURE_TEMPLATE_BY_EVENT[event];
      expect(key.startsWith(`${event}.`), key).toBe(true);
      expect(FAILURE_TEMPLATE_KEYS).toContain(key);
    }
  });

  test("실패 알림은 메일 채널이다 — 문자가 죽어서 알리는 마당에 같은 문자로 알리지 않는다", () => {
    expect(FAILURE_NOTICE_CHANNEL).toBe("email");
    for (const key of FAILURE_TEMPLATE_KEYS) expect(key.endsWith(".email"), key).toBe(true);
  });

  test("🔴 isFailureTemplate — 실패 알림 키는 전부 참, 예약 통지 키는 전부 거짓", () => {
    for (const key of FAILURE_TEMPLATE_KEYS) expect(isFailureTemplate(key), key).toBe(true);
    for (const key of TEMPLATE_KEYS) expect(isFailureTemplate(key), key).toBe(false);
  });

  test("🔴 isFailureTemplate — 목록에 없어도 `failure` 마디가 있으면 막는다 (등록을 잊어도 재귀가 열리지 않게)", () => {
    for (const unknown of ["confirmed.owner.failure.sms", "failure", "failure.owner.email", "created.owner.failure.alimtalk"]) {
      expect(isFailureTemplate(unknown), unknown).toBe(true);
    }
    // 마디 단위로 본다 — 비슷하지만 다른 낱말은 막지 않는다(과잉 차단으로 정상 통지를 잃지 않게).
    for (const ok of ["created.owner.failures.email", "created.notfailure.email", "created.customer.sms", ""]) {
      expect(isFailureTemplate(ok), ok).toBe(false);
    }
  });

  test("🔴 isFailureTemplate — 문자열이 아닌 값은 막는 쪽으로 판정한다 (DB 에서 온 값은 무엇이든 될 수 있다)", () => {
    for (const bad of [undefined, null, 7, {}]) expect(isFailureTemplate(bad as unknown as string), String(bad)).toBe(true);
  });
});

// =============================================================================
// 2. planFailureNotice — 순수 판정
// =============================================================================
describe("2. planFailureNotice — 넣을 것인가, 무엇을 넣을 것인가", () => {
  const opts = { gaveUp: true, ownerEmail: OWNER_EMAIL };

  test("give_up + 예약 통지 → 넣는다. event 는 **원래 행의 것 그대로**, 채널은 메일, 수신처는 OWNER_EMAIL", () => {
    for (const event of ["created", "confirmed"] as const) {
      const plan = planFailureNotice(row({ event, template: event === "created" ? "created.customer.sms" : "confirmed.customer.sms" }), opts);
      expect(plan.enqueue, event).toBe(true);
      if (!plan.enqueue) return;
      expect(plan.row).toEqual<NewOutboxRow>({
        reservation_id: RID,
        event,
        channel: "email",
        to: OWNER_EMAIL,
        template: FAILURE_TEMPLATE_BY_EVENT[event],
      });
    }
  });

  test("🔴 실패한 행이 실패 알림이면 **아무것도 넣지 않는다** — OWNER_EMAIL 이 멀쩡해도, give_up 이어도", () => {
    for (const key of FAILURE_TEMPLATE_KEYS) {
      const plan = planFailureNotice(row({ template: key, channel: "email", to: OWNER_EMAIL }), opts);
      expect(plan, key).toEqual({ enqueue: false, reason: "recursion" satisfies FailureNoticeSkipReason });
    }
  });

  test("🔴 재귀 차단이 다른 모든 조건보다 앞선다 — OWNER_EMAIL 이 없어도, give_up 이 아니어도 이유는 recursion", () => {
    const r = row({ template: "created.owner.failure.email", channel: "email" });
    expect(planFailureNotice(r, { gaveUp: false, ownerEmail: undefined })).toEqual({ enqueue: false, reason: "recursion" });
  });

  test("give_up 이 아니면 넣지 않는다 — 매 실패마다 넣으면 한 건에 알림이 다섯 번 간다", () => {
    expect(planFailureNotice(row(), { gaveUp: false, ownerEmail: OWNER_EMAIL })).toEqual({ enqueue: false, reason: "not_given_up" });
    // 참이 아닌 값은 전부 거짓으로 본다(정확히 true 일 때만 넣는다)
    for (const odd of [undefined, "true", 1, null]) {
      expect(planFailureNotice(row(), { gaveUp: odd as unknown as boolean, ownerEmail: OWNER_EMAIL }).enqueue, String(odd)).toBe(false);
    }
  });

  test("OWNER_EMAIL 이 비면 넣지 않는다 — 보낼 곳이 없다. 주소를 지어내지 않는다", () => {
    for (const empty of [undefined, "", "   "]) {
      expect(planFailureNotice(row(), { gaveUp: true, ownerEmail: empty }), String(empty)).toEqual({ enqueue: false, reason: "no_owner_email" });
    }
  });

  test("앞뒤 공백은 잘라서 수신처로 쓴다 (env 에서 오는 값이다)", () => {
    const plan = planFailureNotice(row(), { gaveUp: true, ownerEmail: `  ${OWNER_EMAIL}  ` });
    expect(plan.enqueue && plan.row.to).toBe(OWNER_EMAIL);
  });

  test("예약이 없는 행은 넣지 않는다 — 유니크 키가 성립하지 않아 묶이지 않고, 알릴 대상도 없다", () => {
    for (const none of [null, "", undefined]) {
      expect(planFailureNotice(row({ reservation_id: none as unknown as string }), opts).enqueue, String(none)).toBe(false);
      expect(planFailureNotice(row({ reservation_id: none as unknown as string }), opts)).toEqual({ enqueue: false, reason: "no_reservation" });
    }
  });

  test("모르는 event 는 넣지 않는다 (DB CHECK 가 막지만 방어)", () => {
    expect(planFailureNotice(row({ event: "failed" as unknown as NotifyEvent }), opts)).toEqual({ enqueue: false, reason: "unknown_event" });
  });

  test("넣는 행에는 고객 개인정보가 한 글자도 없다 — 죽은 행의 수신처·오류 문구도 옮기지 않는다", () => {
    const dead = row({ to: PII.phone, last_error: `rejected ${PII.phone} / ${PII.email}`, template: "created.customer.sms" });
    const plan = planFailureNotice(dead, opts);
    expect(plan.enqueue).toBe(true);
    const json = JSON.stringify(plan);
    for (const value of Object.values(PII)) expect(json, value).not.toContain(value);
    expect(json).not.toContain("rejected");
  });
});

// =============================================================================
// 3. 워커 통합 — 실제 실행 경로
// =============================================================================
describe("3. 워커 — give_up 에서만 · 재귀 차단 · 묶임 · OWNER_EMAIL", () => {
  test("§1 실패 1~4회 → 새 행 0건. 5회째(give_up) → 정확히 1건", async () => {
    for (const attempts of [1, 2, 3, 4]) {
      const db = fakeDb([row({ id: 10 + attempts, attempts })]);
      const { deps, log } = runDeps(db, failingSender());
      const report = await runNotificationWorker({ dryRun: false }, deps);
      expect(report.gaveUp, `attempts=${attempts}`).toBe(0);
      expect(db.enqueueFailureNotice, `attempts=${attempts}`).not.toHaveBeenCalled();
      expect(report.failureNotices.enqueued, `attempts=${attempts}`).toBe(0);
      expect(noticeLogs(log), `attempts=${attempts}`).toEqual([]);
    }

    const db = fakeDb([row({ id: 15, attempts: MAX_ATTEMPTS })]);
    const { deps, log } = runDeps(db, failingSender());
    const report = await runNotificationWorker({ dryRun: false }, deps);
    expect(report.gaveUp).toBe(1);
    expect(db.enqueueFailureNotice).toHaveBeenCalledTimes(1);
    expect(db.inserted).toEqual<NewOutboxRow[]>([
      { reservation_id: RID, event: "created", channel: "email", to: OWNER_EMAIL, template: "created.owner.failure.email" },
    ]);
    expect(report.failureNotices.enqueued).toBe(1);
    expect(noticeLogs(log)).toMatchObject([{ level: "warn", event: "notify.failure_notice", id: 15, outcome: "enqueued", noticeId: 901 }]);
  });

  test("🔴 §2 재귀 차단 — 실패 알림 행이 5회 실패해도 새 행 **0건**", async () => {
    const outbox = fakeOutbox();
    const reports: WorkerReport[] = [];
    for (let attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
      const db = fakeDb([row({ id: 20, attempts, channel: "email", to: OWNER_EMAIL, template: "created.owner.failure.email" })], outbox);
      const { deps } = runDeps(db, failingSender());
      reports.push(await runNotificationWorker({ dryRun: false }, deps));
    }
    // 5회째는 분명히 give_up 이었다 — 그런데도 넣지 않았다는 것이 요점이다(빈손으로 통과한 것이 아니다).
    expect(reports.map((r) => r.gaveUp)).toEqual([0, 0, 0, 0, 1]);
    expect(outbox.enqueueFailureNotice).not.toHaveBeenCalled();
    expect(outbox.inserted).toEqual([]);
    expect(reports[MAX_ATTEMPTS - 1].failureNotices).toMatchObject({ enqueued: 0, recursion: 1 });
  });

  test("🔴 §2 재귀 차단은 OWNER_EMAIL 이 멀쩡하고 예약도 있는 상태에서 걸린다 (없어서 통과한 것이 아니다)", async () => {
    // 대조군: 같은 조건에서 template 만 예약 통지로 바꾸면 1건이 들어간다.
    const control = fakeDb([row({ id: 21, attempts: MAX_ATTEMPTS, channel: "email", to: OWNER_EMAIL, template: "created.owner.email" })]);
    const { deps: cd } = runDeps(control, failingSender());
    expect((await runNotificationWorker({ dryRun: false }, cd)).failureNotices.enqueued).toBe(1);

    const db = fakeDb([row({ id: 22, attempts: MAX_ATTEMPTS, channel: "email", to: OWNER_EMAIL, template: "created.owner.failure.email" })]);
    const { deps, log } = runDeps(db, failingSender());
    const report = await runNotificationWorker({ dryRun: false }, deps);
    expect(report.failureNotices).toMatchObject({ enqueued: 0, recursion: 1 });
    expect(db.enqueueFailureNotice).not.toHaveBeenCalled();
    expect(noticeLogs(log)).toMatchObject([{ id: 22, template: "created.owner.failure.email", outcome: "recursion" }]);
  });

  test("§3 묶임 — 같은 예약·같은 event 의 통지 2건이 모두 죽어도 알림은 1건 (유니크 키)", async () => {
    const db = fakeDb([
      row({ id: 31, attempts: MAX_ATTEMPTS, template: "created.owner.sms" }),
      row({ id: 32, attempts: MAX_ATTEMPTS, template: "created.customer.sms" }),
    ]);
    const { deps, log } = runDeps(db, failingSender());
    const report = await runNotificationWorker({ dryRun: false }, deps);
    expect(report.gaveUp).toBe(2);
    // 두 번 시도했지만 실제로 들어간 것은 하나다 — 두 번째는 "이미 있다"(duplicate).
    expect(db.enqueueFailureNotice).toHaveBeenCalledTimes(2);
    expect(db.inserted).toHaveLength(1);
    expect(report.failureNotices).toMatchObject({ enqueued: 1, duplicate: 1 });
    expect(noticeLogs(log).map((e) => (e.event === "notify.failure_notice" ? e.outcome : ""))).toEqual(["enqueued", "duplicate"]);
  });

  test("§3 event 가 다르면 따로 간다 — confirmed 가 나중에 죽으면 그때 1건 더", async () => {
    const outbox = fakeOutbox();
    const first = fakeDb([row({ id: 33, attempts: MAX_ATTEMPTS, template: "created.customer.sms", event: "created" })], outbox);
    await runNotificationWorker({ dryRun: false }, runDeps(first, failingSender()).deps);
    const second = fakeDb([row({ id: 34, attempts: MAX_ATTEMPTS, template: "confirmed.customer.sms", event: "confirmed" })], outbox);
    const report = await runNotificationWorker({ dryRun: false }, runDeps(second, failingSender()).deps);

    expect(outbox.inserted.map((r) => [r.event, r.template])).toEqual([
      ["created", "created.owner.failure.email"],
      ["confirmed", "confirmed.owner.failure.email"],
    ]);
    expect(report.failureNotices).toMatchObject({ enqueued: 1, duplicate: 0 });
  });

  test("§4 OWNER_EMAIL 이 없으면 행 0건이고 **보고서에 이유가 드러난다**", async () => {
    const db = fakeDb([row({ id: 41, attempts: MAX_ATTEMPTS })]);
    const { deps, log } = runDeps(db, failingSender(), {});
    const report = await runNotificationWorker({ dryRun: false }, deps);
    expect(db.enqueueFailureNotice).not.toHaveBeenCalled();
    expect(report.failureNotices).toEqual({
      enqueued: 0,
      duplicate: 0,
      enqueue_failed: 0,
      recursion: 0,
      not_given_up: 0,
      unknown_event: 0,
      no_reservation: 0,
      no_owner_email: 1,
    });
    expect(JSON.stringify(report)).toContain("no_owner_email");
    expect(noticeLogs(log)).toMatchObject([{ id: 41, outcome: "no_owner_email" }]);
  });

  test("보고서의 결과 칸은 전부 0 으로 시작해 항상 존재한다 — 조용히 사라지는 값이 없다", async () => {
    const db = fakeDb([row({ id: 42 })]);
    const { deps } = runDeps(db, memorySender());
    const report = await runNotificationWorker({ dryRun: false }, deps);
    expect(Object.keys(report.failureNotices).sort()).toEqual(
      ["duplicate", "enqueue_failed", "enqueued", "no_owner_email", "no_reservation", "not_given_up", "recursion", "unknown_event"].sort(),
    );
    expect(Object.values(report.failureNotices).every((n) => n === 0)).toBe(true);
    // 보고서 키 집합에 failureNotices 가 있고, 개인정보 키는 여전히 없다
    expect(Object.keys(report)).toContain("failureNotices");
  });

  // ── 회수 경로 (독립 리뷰 중대-1) ─────────────────────────────────────────
  /**
   * 행이 `failed` 로 끝나는 경로는 **둘**이다. 두 번째가 `reap_stale_notifications`(0007)이고, P4-4 는 처음에 그것을 놓쳤다:
   * 5회째 claim 뒤 워커가 mark 없이 죽으면 행은 `attempts=5 · pending` 으로 남고 claim 의 `attempts < 5` 때문에
   * **다시 잡히지 않는다** — reaper 가 조용히 종착시킨다. 통지가 끝내 못 나갔는데 아무도 모르는, 바로 그 상황이다.
   */
  test("🔴 §6 회수(reap)로 종착한 행도 알린다 — 그 경로가 P4-4 가 막으려던 바로 그 상황이다", async () => {
    const reaped = row({ id: 71, status: "failed", attempts: MAX_ATTEMPTS, last_error: "lease_expired_after_max_attempts" });
    const db = fakeDb([], fakeOutbox(), [reaped]);
    const { deps, log } = runDeps(db, memorySender());
    const report = await runNotificationWorker({ dryRun: false }, deps);

    expect(report.reaped).toBe(1);
    // 회수는 claim 경로가 아니다 — gaveUp 은 0 인 채로 알림만 나간다
    expect(report.gaveUp).toBe(0);
    expect(report.failureNotices).toMatchObject({ enqueued: 1 });
    expect(db.inserted).toEqual<NewOutboxRow[]>([
      { reservation_id: RID, event: "created", channel: "email", to: OWNER_EMAIL, template: "created.owner.failure.email" },
    ]);
    expect(noticeLogs(log)).toMatchObject([{ id: 71, outcome: "enqueued" }]);
  });

  test("🔴 §6 회수 경로에서도 재귀 차단이 듣는다 — 실패 알림이 reaper 로 죽어도 새 행 0건", async () => {
    const reaped = row({ id: 72, status: "failed", attempts: MAX_ATTEMPTS, channel: "email", to: OWNER_EMAIL, template: "created.owner.failure.email" });
    const db = fakeDb([], fakeOutbox(), [reaped]);
    const { deps, log } = runDeps(db, memorySender());
    const report = await runNotificationWorker({ dryRun: false }, deps);

    expect(report.reaped).toBe(1);
    expect(db.enqueueFailureNotice).not.toHaveBeenCalled();
    expect(report.failureNotices).toMatchObject({ enqueued: 0, recursion: 1 });
    expect(noticeLogs(log)).toMatchObject([{ id: 72, template: "created.owner.failure.email", outcome: "recursion" }]);
  });

  test("🔴 §6 회수 경로도 같은 판정을 탄다 — OWNER_EMAIL 이 없으면 이유가 보고서에 남는다", async () => {
    const reaped = row({ id: 73, status: "failed", attempts: MAX_ATTEMPTS });
    const db = fakeDb([], fakeOutbox(), [reaped]);
    const { deps } = runDeps(db, memorySender(), {});
    const report = await runNotificationWorker({ dryRun: false }, deps);
    expect(db.enqueueFailureNotice).not.toHaveBeenCalled();
    expect(report.failureNotices).toMatchObject({ enqueued: 0, no_owner_email: 1 });
  });

  test("§6 회수와 give_up 이 같은 실행에서 같은 예약·event 를 종착시키면 알림은 1건(두 번째는 duplicate)", async () => {
    const outbox = fakeOutbox();
    const reaped = row({ id: 74, status: "failed", attempts: MAX_ATTEMPTS, template: "created.owner.sms" });
    const db = fakeDb([row({ id: 75, attempts: MAX_ATTEMPTS, template: "created.customer.sms" })], outbox, [reaped]);
    const { deps } = runDeps(db, failingSender());
    const report = await runNotificationWorker({ dryRun: false }, deps);
    expect(report.failureNotices).toMatchObject({ enqueued: 1, duplicate: 1 });
    expect(outbox.inserted).toHaveLength(1);
  });

  test("dry-run 은 아무것도 넣지 않는다 (claim 자체를 하지 않으므로 give_up 도 없다)", async () => {
    const db = fakeDb([row({ id: 43, attempts: MAX_ATTEMPTS })]);
    const { deps } = runDeps(db, failingSender());
    const report = await runNotificationWorker({}, deps);
    expect(db.enqueueFailureNotice).not.toHaveBeenCalled();
    expect(report.failureNotices.enqueued).toBe(0);
  });

  test("markFailed 가 throw 하면 알림도 넣지 않는다 — 실패를 기록하지도 못한 행은 종착이 아니다", async () => {
    const db = fakeDb([row({ id: 44, attempts: MAX_ATTEMPTS })]);
    db.markFailed = vi.fn<WorkerDb["markFailed"]>(async () => {
      throw new Error("outbox.markFailed: [57014] statement timeout");
    });
    const { deps } = runDeps(db, failingSender());
    const report = await runNotificationWorker({ dryRun: false }, deps);
    expect(db.enqueueFailureNotice).not.toHaveBeenCalled();
    expect(report.gaveUp).toBe(0);
    expect(report.markErrors).toBe(1);
  });

  test("알림 insert 가 throw 해도 실행은 계속된다 — 보고서 enqueue_failed 1, 다음 행은 그대로 처리", async () => {
    const db = fakeDb([row({ id: 45, attempts: MAX_ATTEMPTS }), row({ id: 46 })]);
    db.enqueueFailureNotice = vi.fn<WorkerDb["enqueueFailureNotice"]>(async () => {
      throw new Error(`outbox.enqueue.insert: [23503] detail ${PII.phone}`);
    });
    const { deps, log } = runDeps(db, memorySender((req) => (req.id === 45 ? { ok: false, error: "x", retryable: true } : { ok: true, providerMessageId: null })));
    const report = await runNotificationWorker({ dryRun: false }, deps);
    expect(report.failureNotices).toMatchObject({ enqueue_failed: 1, enqueued: 0 });
    expect(report.sent).toBe(1);
    // 오류 문구에서도 수신처는 지워진다
    const entry = noticeLogs(log)[0];
    expect(entry).toMatchObject({ level: "error", outcome: "enqueue_failed" });
    expect(JSON.stringify(entry)).not.toContain(PII.phone);
    expect(JSON.stringify(entry)).toContain("[to]");
  });

  test("§5 개인정보 0 — 보고서·로그·넣는 행 어디에도 고객 이름·전화·메일·문의내용이 없다", async () => {
    const db = fakeDb([
      row({ id: 51, attempts: MAX_ATTEMPTS, to: PII.phone, template: "created.customer.sms" }),
      row({ id: 52, attempts: MAX_ATTEMPTS, to: PII.phoneDashed, template: "created.owner.sms" }),
      row({ id: 53, attempts: MAX_ATTEMPTS, to: PII.email, channel: "email", template: "created.owner.email" }),
      row({ id: 54, attempts: MAX_ATTEMPTS, to: PII.phone, event: "confirmed", template: "confirmed.customer.sms" }),
    ]);
    // sender 는 계약대로 짧은 코드만 돌려준다(lib/notify/sender.ts) — 그래도 행의 수신처는 원문 개인정보다.
    const { deps, log } = runDeps(db, memorySender(() => ({ ok: false, error: "provider_403:forbidden", retryable: false })));
    const report = await runNotificationWorker({ dryRun: false }, deps);
    expect(report.failureNotices.enqueued).toBe(2); // created 1건 + confirmed 1건

    const haystack = [JSON.stringify(report), JSON.stringify(log.mock.calls.map((c) => c[0])), JSON.stringify(db.inserted)];
    for (const s of haystack) {
      for (const value of Object.values(PII)) expect(s, value).not.toContain(value);
      expect(s).not.toContain("2048");
      expect(s).not.toMatch(/"(to_phone|name|phone|message)":/);
    }
    // 넣은 행의 수신처는 사장님 주소뿐이다
    expect(db.inserted.map((r) => r.to)).toEqual([OWNER_EMAIL, OWNER_EMAIL]);
  });
});

// =============================================================================
// 4. 문안 — 실패 알림은 무엇이 실패했는지만 말한다
// =============================================================================
describe("4. 문안", () => {
  const ORIGIN = "https://bestour.co.kr";
  const CUSTOMER: CustomerVars = { publicCode: "BT12ABCD", origin: ORIGIN };

  test("실패 알림 2종이 렌더된다 — 접수번호 · 어떤 통지인지 · 발송 내역 링크 · 제목", () => {
    const labels: Record<string, string> = { "created.owner.failure.email": "접수", "confirmed.owner.failure.email": "확정" };
    for (const key of FAILURE_TEMPLATE_KEYS) {
      const r = renderTemplate(key, CUSTOMER);
      expect(r.key).toBe(key);
      expect(r.text).toContain(CUSTOMER.publicCode);
      expect(r.text).toContain(`${ORIGIN}${ADMIN_NOTIFICATIONS_PATH}`);
      expect(r.text).toContain(labels[key]);
      expect(r.subject, `${key} 에 제목이 없다 — 메일 채널이다`).toBeTruthy();
      expect(r.subject).toContain(CUSTOMER.publicCode);
      // 시도 횟수는 상수에서 온다 — 문안에 숫자를 적어 두지 않는다
      expect(r.text).toContain(`${MAX_ATTEMPTS}번`);
    }
  });

  test("접수 실패와 확정 실패의 문안이 서로 다르다 (무엇이 못 나갔는지 사장님이 구분한다)", () => {
    const a = renderTemplate("created.owner.failure.email", CUSTOMER).text;
    const b = renderTemplate("confirmed.owner.failure.email", CUSTOMER).text;
    expect(a).not.toBe(b);
  });

  test("§5 개인정보 0 — 변수에 이름·전화를 몰래 끼워 넣어도 문안에 나오지 않는다 (타입에 자리가 없다)", () => {
    const smuggled = { ...CUSTOMER, ...PII } as CustomerVars;
    for (const key of FAILURE_TEMPLATE_KEYS) {
      const v = renderVariants(key, smuggled);
      for (const text of [v.sms, v.lms, v.subject ?? ""]) {
        for (const value of Object.values(PII)) expect(text, `${key} / ${value}`).not.toContain(value);
      }
    }
  });

  test("§5 실패 알림의 변수 타입에는 원문 개인정보 키가 없다 (컴파일 잠금)", () => {
    type FailureVars = Parameters<typeof renderTemplate<(typeof FAILURE_TEMPLATE_KEYS)[number]>>[1];
    type RawPii = Extract<keyof FailureVars, "name" | "phone" | "email" | "message" | "reservationId">;
    const noRawPii: RawPii extends never ? true : never = true;
    expect(noRawPii).toBe(true);
  });

  test("실패 알림에 verbatim 을 넣지 않는다 — 고객에게 하는 약속이지 사장님께 하는 보고가 아니다", () => {
    for (const key of FAILURE_TEMPLATE_KEYS) {
      expect(renderTemplate(key, CUSTOMER).text, key).not.toContain(VERBATIM.bookingNotice);
      expect(renderTemplate(key, CUSTOMER).text, key).not.toContain(VERBATIM.showcaseNotice);
    }
  });

  test("실패 알림은 사장님 조회(개인정보 9컬럼)를 부르지 않는다 — 어댑터가 고객 변수 경로를 탄다", () => {
    for (const key of FAILURE_TEMPLATE_KEYS) expect(TEMPLATE_AUDIENCE[key], key).toBe("customer");
    // 예약 통지의 구분은 그대로다(회귀)
    expect(TEMPLATE_AUDIENCE["created.owner.sms"]).toBe("owner");
    expect(TEMPLATE_AUDIENCE["created.owner.email"]).toBe("owner");
  });

  test("발송 내역 경로 상수가 실제 라우트를 가리키고 lib/admin 의 같은 상수와 값이 같다", () => {
    expect(ADMIN_NOTIFICATIONS_PATH).toBe("/admin/notifications");
    expect(existsSync(path.join(ROOT, "app", "admin", "(protected)", "notifications", "page.tsx"))).toBe(true);
    expect(read("lib/admin/notifications.ts")).toContain(`ADMIN_NOTIFICATIONS_PATH = "${ADMIN_NOTIFICATIONS_PATH}"`);
  });

  // ── §7 기존 문안 4종 바이트 무변경 ──────────────────────────────────────
  /**
   * P4-3 이 독립 리뷰를 통과한 문안 4종의 **바이트 지문**. 렌더 결과의 UTF-8 바이트를 sha256 한 값이며
   * 2026-09-16(P4-4 착수 직전) 저장소 상태에서 뜬 것이다. 한 글자·한 공백이라도 바뀌면 여기서 멈춘다.
   */
  const BASELINE: Record<string, { sms: string; lms: string; subject: string | null }> = {
    "created.owner.sms": {
      sms: "7440f20f1777ed35cf9c156286ce11369031794a58ca656db4af4135970db80d",
      lms: "ff82ee61cf5fc5a929f45da862f919e3ceab4b68ce66b7ca52ed81a282fe1ff3",
      subject: null,
    },
    "created.owner.email": {
      sms: "7440f20f1777ed35cf9c156286ce11369031794a58ca656db4af4135970db80d",
      lms: "ff82ee61cf5fc5a929f45da862f919e3ceab4b68ce66b7ca52ed81a282fe1ff3",
      subject: "9da53af3273e129084506dad0fe63e55384ae3ef41eb267bbf743ada23b7c371",
    },
    "created.customer.sms": {
      sms: "84e4fe880d029fb880ed688fa14b29d232e084764009c0de3680f489c9d031e7",
      lms: "9d73bfd26818f2e9029e0a7d6450bc401948fef460d2a7dc11a24eb14baee46c",
      subject: null,
    },
    "confirmed.customer.sms": {
      sms: "223c640aaad4bc5b564d97320a1a2f6865b642499f12a90e31d1d6b8521651ef",
      lms: "dbafda6c81753f401d45d2354abcedaa1819e8d1ec72233e61dbe104fb6e988f",
      subject: null,
    },
  };

  const BASELINE_OWNER: OwnerVars = {
    publicCode: "BT12ABCD",
    origin: ORIGIN,
    reservationId: "3f2b9c14-5f0a-4a2e-9c1b-8d7e6f5a4b3c",
    name: "한지원",
    phone: "+821020488585",
    vehicleLabel: "45인승 우등",
    departAtKst: "2026-10-03 08:00",
    originLabel: "서울",
    destinationLabel: "부산",
    busCount: 2,
    passengers: 80,
  };

  const sha = (s: string): string => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

  test("§7 기존 문안 4종 바이트 무변경 — P4-4 는 추가만 했다", () => {
    expect(Object.keys(BASELINE).sort()).toEqual([...TEMPLATE_KEYS].sort());
    for (const key of TEMPLATE_KEYS) {
      const v = key.includes(".owner.") ? renderVariants(key, BASELINE_OWNER) : renderVariants(key, CUSTOMER);
      expect(sha(v.sms), `${key}.sms 의 바이트가 바뀌었다`).toBe(BASELINE[key].sms);
      expect(sha(v.lms), `${key}.lms 의 바이트가 바뀌었다`).toBe(BASELINE[key].lms);
      expect(v.subject === undefined ? null : sha(v.subject), `${key}.subject 가 바뀌었다`).toBe(BASELINE[key].subject);
    }
  });

  test("§7 verbatim 무손상 — 고객 문안 2종에 바이트 열 그대로 남아 있다", () => {
    const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
    for (const key of ["created.customer.sms", "confirmed.customer.sms"] as const) {
      expect(hex(renderTemplate(key, CUSTOMER).text), key).toContain(hex(VERBATIM.bookingNotice));
    }
  });
});

// =============================================================================
// 5. 배선 · 정적 — env 는 라우트만 본다 · 발신 주소 규약
// =============================================================================
describe("5. 배선", () => {
  const ROUTE = "app/api/cron/notify/route.ts";
  const FALLBACK = "lib/notify/fallback.ts";

  test("OWNER_EMAIL 을 읽는 곳은 라우트뿐이고 워커에 주입한다 (P4-1 경계)", () => {
    const route = read(ROUTE);
    expect(route).toMatch(/ownerEmail:\s*process\.env\.OWNER_EMAIL/);
    for (const rel of [FALLBACK, "lib/notify/worker.ts", "lib/notify/templates.ts"]) {
      expect(read(rel), rel).not.toMatch(/process\.env/);
    }
  });

  test("§6 발신은 MAIL_FROM 뿐 — OWNER_EMAIL 을 From 으로 쓰지 않는다", () => {
    const route = read(ROUTE);
    expect(route).toMatch(/from:\s*MAIL_FROM/);
    expect(route).not.toMatch(/from:\s*\w*OWNER_EMAIL/);
    // 수신 전용 주소를 코드가 발신에 쓰지 않는다 — 어떤 형태로도 적혀 있지 않다
    for (const rel of [ROUTE, FALLBACK, "lib/notify/mail.ts", "lib/notify/templates.ts"]) {
      expect(read(rel).toLowerCase(), rel).not.toContain("@naver");
    }
  });

  test("fallback.ts 는 순수 모듈이다 — 서버 지시어·네트워크·DB·시계 0", () => {
    const src = read(FALLBACK);
    expect(src).not.toMatch(/["']use server["']/);
    expect(src).not.toMatch(/import\s+["']server-only["']/);
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/createServiceClient|SupabaseClient|supabase/);
    expect(src).not.toMatch(/new Date\(|Date\.now\(/);
  });

  test("워커는 주입받은 포트로 행을 넣는다 — DB 를 직접 알지 못한다", () => {
    const src = read("lib/notify/worker.ts");
    // 행을 넣는 경로는 db 포트 하나뿐이다
    expect(src).toMatch(/db\.enqueueFailureNotice\(/);
    expect(src).not.toMatch(/\.from\(TABLE\)\.insert|\.insert\(/);
  });

  test(".env.example 이 OWNER_EMAIL 의 새 용도와 발신 금지를 적어 둔다", () => {
    const env = read(".env.example");
    expect(env).toMatch(/^OWNER_EMAIL=$/m);
    expect(env).toContain("MAIL_FROM");
    expect(env).toContain("failureNotices.no_owner_email");
  });

  test("마이그레이션을 추가하지 않았다 — event 는 원래 행의 것을 쓰고 template 에는 CHECK 가 없다", () => {
    const init = read("supabase/migrations/0001_init.sql");
    // event CHECK 는 우리가 쓰는 두 값뿐이고, 그대로 쓴다
    expect(init).toContain("check (event in ('created', 'confirmed'))");
    // template 컬럼에는 CHECK 가 없다 — 새 키에 스키마 변경이 필요하지 않은 근거
    expect(init).toMatch(/template text not null,\s*$/m);
    // 0015 를 만들지 않았다
    expect(existsSync(path.join(ROOT, "supabase", "migrations", "0015_failure_notice.sql"))).toBe(false);
  });
});

// =============================================================================
// 6. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만 (원격에는 어떤 쓰기도 하지 않는다)
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[notify-fallback.test] DB 실증 블록 skip — ${gate.reason}`);
}

describe.skipIf(!gate.allowed || !env.hasServiceRole)("6. DB — 실제 행으로 재귀 차단·give_up·묶임 (로컬 스택)", () => {
  // claim 은 표 전체를 집어간다 — 맨 위에서 잡아 이 블록의 정리가 끝난 뒤 풀리게 한다(CLAUDE.md §7).
  withNotificationsLock();

  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const TEST_PREFIX = "p44test-";
  let reservationId = "";
  let db: WorkerDb;

  async function rest(method: string, pathAndQuery: string, json?: unknown, prefer?: string) {
    const res = await fetch(`${env.restRoot}${pathAndQuery}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // JSON 이 아니면 문자열 그대로
    }
    return { status: res.status, body };
  }

  type LogRow = { id: number; event: string; channel: string; to_phone: string; template: string; status: string; attempts: number };

  const logs = async (): Promise<LogRow[]> =>
    (
      await rest("GET", `/notifications_log?select=id,event,channel,to_phone,template,status,attempts&reservation_id=eq.${reservationId}&order=id`)
    ).body as LogRow[];

  const wipe = () => rest("DELETE", `/notifications_log?reservation_id=eq.${reservationId}`);

  async function insertPending(overrides: Record<string, unknown>) {
    const r = await rest(
      "POST",
      "/notifications_log",
      {
        reservation_id: reservationId,
        event: "created",
        channel: "sms",
        to_phone: PII.phone,
        template: "created.customer.sms",
        status: "pending",
        ...overrides,
      },
      "return=representation",
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return (r.body as { id: number }[])[0].id;
  }

  /** 백오프로 미래에 찍힌 next_attempt_at 을 과거로 되돌린다 — 다음 크론을 기다리지 않고 5회를 재현하기 위해. */
  const rewind = () => rest("PATCH", `/notifications_log?reservation_id=eq.${reservationId}&status=eq.pending`, { next_attempt_at: "1970-01-01T00:00:00Z" });

  /** 크론 한 번. 언제나 실패하는 sender 로 돌린다. ownerEmail 은 객체로 받는다(기본값 매개변수 함정 — runDeps 주석 참고). */
  const runOnce = (over: { ownerEmail?: string } = { ownerEmail: OWNER_EMAIL }) =>
    runNotificationWorker(
      { dryRun: false, limit: 50 },
      { db, sender: failingSender(), ownerEmail: over.ownerEmail, now: () => new Date(), log: () => {} },
    );

  /** 5회 = 소진. 매 회 사이에 백오프를 되감는다. */
  async function burnFiveTimes(over: { ownerEmail?: string } = { ownerEmail: OWNER_EMAIL }): Promise<WorkerReport[]> {
    const out: WorkerReport[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await rewind();
      out.push(await runOnce(over));
    }
    return out;
  }

  beforeAll(async () => {
    const probe = await rest("GET", "/notifications_log?select=attempts,next_attempt_at&limit=0");
    if (probe.status !== 200) {
      throw new Error(`0005 이상의 마이그레이션이 이 DB 에 적용되지 않았다 — HTTP ${probe.status}: ${JSON.stringify(probe.body).slice(0, 200)}`);
    }
    const now = new Date();
    const created = await rest(
      "POST",
      "/reservations",
      {
        public_code: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
        name: PII.name,
        phone: PII.phoneDashed,
        vehicle_slug: "bus45",
        purpose_code: "family",
        origin_code: "SEL",
        destination_code: "BSN",
        waypoint_codes: [],
        trip_type: "oneway",
        depart_at: new Date(now.getTime() + 7 * 24 * 60 * MINUTE).toISOString(),
        return_at: null,
        nights: 0,
        bus_count: 1,
        locale: "ko",
        ...consentFields({ privacyConsent: true, marketingConsent: false }, now),
      },
      "return=representation",
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    reservationId = (created.body as { id: string }[])[0].id;
    db = supabaseWorkerDb(createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, env.serviceRoleKey, { auth: { persistSession: false } }));
  });

  afterAll(async () => {
    if (!reservationId) return;
    await wipe();
    await rest("DELETE", `/reservations?public_code=like.${TEST_PREFIX}*`);
    expect((await rest("GET", `/notifications_log?select=id&reservation_id=eq.${reservationId}`)).body).toEqual([]);
    expect((await rest("GET", `/reservations?select=id&public_code=like.${TEST_PREFIX}*`)).body).toEqual([]);
  });

  test("§1 DB — 1~4회 실패 동안 새 행 0건, 5회째에 실패 알림 행이 정확히 1건 생긴다", async () => {
    await wipe();
    const victim = await insertPending({});
    for (let i = 1; i <= MAX_ATTEMPTS - 1; i++) {
      await rewind();
      const r = await runOnce();
      expect(r.gaveUp, `${i}회째`).toBe(0);
      expect((await logs()).map((l) => l.template), `${i}회째`).toEqual(["created.customer.sms"]);
    }
    await rewind();
    const last = await runOnce();
    expect(last.gaveUp).toBe(1);
    expect(last.failureNotices.enqueued).toBe(1);

    const rows = await logs();
    expect(rows.map((l) => l.template)).toEqual(["created.customer.sms", "created.owner.failure.email"]);
    const dead = rows.find((l) => l.id === victim) as LogRow;
    expect(dead.status).toBe("failed");
    expect(dead.attempts).toBe(MAX_ATTEMPTS);
    const notice = rows.find((l) => l.template === "created.owner.failure.email") as LogRow;
    expect(notice).toMatchObject({ event: "created", channel: "email", to_phone: OWNER_EMAIL, status: "pending", attempts: 0 });
  });

  test("🔴 §2 DB — 그 실패 알림 행을 다시 5회 죽여도 새 행이 **0건**이다 (재귀 차단)", async () => {
    const before = await logs();
    const notice = before.find((l) => l.template === "created.owner.failure.email") as LogRow;
    expect(notice, "앞 테스트가 만든 실패 알림 행이 있어야 한다").toBeTruthy();

    const reports = await burnFiveTimes();
    expect(reports.map((r) => r.gaveUp)).toEqual([0, 0, 0, 0, 1]);
    expect(reports.map((r) => r.failureNotices.enqueued)).toEqual([0, 0, 0, 0, 0]);
    expect(reports[MAX_ATTEMPTS - 1].failureNotices.recursion).toBe(1);

    const after = await logs();
    expect(after.map((l) => l.template)).toEqual(before.map((l) => l.template));
    expect(after.filter((l) => l.template === "created.owner.failure.email")).toHaveLength(1);
    const dead = after.find((l) => l.id === notice.id) as LogRow;
    expect(dead).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
  });

  test("§3 DB — 같은 event 의 통지 2건이 모두 죽어도 알림 1건, confirmed 가 죽으면 그때 1건 더", async () => {
    await wipe();
    await insertPending({ template: "created.owner.sms", to_phone: PII.phoneDashed });
    await insertPending({ template: "created.customer.sms" });
    await burnFiveTimes();

    let rows = await logs();
    expect(rows.filter((l) => l.template === "created.owner.failure.email")).toHaveLength(1);
    expect(rows.filter((l) => l.status === "failed")).toHaveLength(2);

    await insertPending({ event: "confirmed", template: "confirmed.customer.sms" });
    await burnFiveTimes();

    rows = await logs();
    expect(rows.filter((l) => l.template === "created.owner.failure.email")).toHaveLength(1);
    expect(rows.filter((l) => l.template === "confirmed.owner.failure.email")).toHaveLength(1);
    // 재귀는 여기서도 멈춰 있다 — 실패 알림 2건 말고 다른 알림은 없다
    expect(rows.filter((l) => isFailureTemplate(l.template))).toHaveLength(2);
  });

  test("§4 DB — OWNER_EMAIL 이 없으면 행이 생기지 않고 보고서가 이유를 말한다", async () => {
    await wipe();
    await insertPending({});
    const reports = await burnFiveTimes({});
    expect(reports[MAX_ATTEMPTS - 1].failureNotices).toMatchObject({ enqueued: 0, no_owner_email: 1 });
    expect((await logs()).map((l) => l.template)).toEqual(["created.customer.sms"]);
  });

  /**
   * 회수 경로(0007 `reap_stale_notifications`)로 종착하는 행을 실제로 만든다.
   * `status=pending · attempts=5 · next_attempt_at 과거` 가 그 조건이다(0007:38) — 5회째 claim 뒤 워커가 mark 없이 죽은 모습이며,
   * claim 의 `attempts < 5` 때문에 **다시 잡히지 않는** 행이다(그래서 조용히 죽는다).
   */
  const insertReapable = (overrides: Record<string, unknown>) =>
    insertPending({ attempts: MAX_ATTEMPTS, next_attempt_at: "1970-01-01T00:00:00Z", ...overrides });

  test("🔴 §6 DB — 회수(reap)로 종착한 행에도 알림이 1건 생긴다 (중대-1 이 지적한 두 번째 종착 경로)", async () => {
    await wipe();
    const victim = await insertReapable({});
    const report = await runOnce();

    expect(report.reaped).toBe(1);
    expect(report.gaveUp).toBe(0); // claim 경로가 아니다 — 회수다
    expect(report.failureNotices).toMatchObject({ enqueued: 1 });

    const rows = await logs();
    expect(rows.map((l) => l.template)).toEqual(["created.customer.sms", "created.owner.failure.email"]);
    expect(rows.find((l) => l.id === victim)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    const notice = rows.find((l) => l.template === "created.owner.failure.email") as LogRow;
    expect(notice).toMatchObject({ event: "created", channel: "email", to_phone: OWNER_EMAIL, status: "pending" });
    // 회수는 claim **앞** 단계라(worker 실행 순서: reap → claim → send) 이 알림 행은 **같은 실행에서 바로 집혀** 한 번 시도된다.
    // give_up 경로에서 생긴 알림(claim 뒤에 만들어진다)은 attempts 0 으로 남는다 — 그래서 0 또는 1 이다.
    // 어느 쪽이든 종착이 아니므로 재귀는 열리지 않는다(다음 테스트가 그것을 회수 경로로 확인한다).
    expect([0, 1], `실패 알림 행의 attempts=${notice.attempts}`).toContain(notice.attempts);
  });

  test("🔴 §6 DB — 그 알림이 이번엔 **회수로** 죽어도 새 행이 0건이다 (재귀 차단은 두 경로 모두에서 듣는다)", async () => {
    const before = await logs();
    const notice = before.find((l) => l.template === "created.owner.failure.email") as LogRow;
    expect(notice, "앞 테스트가 만든 실패 알림 행이 있어야 한다").toBeTruthy();
    // 그 알림 행을 회수 대상으로 만든다(5회째 claim 뒤 워커가 죽은 모습)
    await rest("PATCH", `/notifications_log?id=eq.${notice.id}`, { attempts: MAX_ATTEMPTS, next_attempt_at: "1970-01-01T00:00:00Z" });

    const report = await runOnce();
    expect(report.reaped).toBe(1);
    expect(report.failureNotices).toMatchObject({ enqueued: 0, recursion: 1 });

    const after = await logs();
    expect(after.map((l) => l.template)).toEqual(before.map((l) => l.template));
    expect(after.find((l) => l.id === notice.id)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
  });

  test("§5 DB — 만들어진 알림 행의 어느 컬럼에도 고객 개인정보가 없다", async () => {
    await wipe();
    await insertPending({ to_phone: PII.phone });
    await burnFiveTimes();
    const full = await rest("GET", `/notifications_log?select=*&reservation_id=eq.${reservationId}&template=eq.created.owner.failure.email`);
    const rows = full.body as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    const json = JSON.stringify(rows[0]);
    for (const value of Object.values(PII)) expect(json, value).not.toContain(value);
    expect(json).toContain(OWNER_EMAIL);
  });
});

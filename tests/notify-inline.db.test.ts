/**
 * P4-7 — 즉시 발송 실DB 실증 (로컬 스택 + REQUIRE_DB_TESTS=1 일 때만. 원격에는 어떤 쓰기도 하지 않는다).
 *
 * 무엇이 진짜인가: createReservation(접수 → notifications_log pending) · lib/notify/deps.ts 배선(env 스위치 · selectSender ·
 * createServiceClient → 로컬 스택) · runNotificationWorker · 0005/0007/0014 RPC(claim·mark·reap).
 * 무엇이 대체인가: runAfter — 요청 스코프가 없으므로 "응답 뒤" 를 테스트가 직접 돌린다. sender 는 **memory** 뿐이다(실제 발송 0).
 *
 * 🔴 실제 발송 차단: 제공자 키(SOLAPI·RESEND)·VERCEL_ENV 를 블록 동안 **지운다**. 그러면 memory 지시가 어떤 이유로 무시돼도
 * sender 는 unconfigured 로 떨어져 claim 조차 하지 않는다(두 겹). tests/helpers/load-env-local 이 .env.local 의 빈 칸을 채우므로
 * 이 삭제가 필요하다.
 *
 * 아웃박스는 표 전체를 훑는다(claim 에 소유자 조건이 없다) — 그래서 withNotificationsLock() 안에서만 돈다.
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { withNotificationsLock } from "./helpers/db-lock";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

vi.mock("server-only", () => ({}));
// lib/admin/* 는 세션 클라이언트를 만들려고 next/headers 를 import 한다 — 여기서는 서비스 롤 클라이언트를 직접 넘기므로 부르지 않는다.
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })) }));

import { getNotificationSummary } from "@/lib/admin/notifications";
import { getNotifyCorrections } from "@/lib/admin/stats";
import { PURPOSES } from "@/lib/codes";
import { notifyAfterResponse } from "@/lib/notify/deps";
import { runInlineNotify } from "@/lib/notify/inline";
import { resendSender } from "@/lib/notify/mail";
import { memorySender } from "@/lib/notify/sender";
import { templateVars } from "@/lib/notify/vars";
import { runNotificationWorker, supabaseWorkerDb, type WorkerDb, type WorkerDeps } from "@/lib/notify/worker";

import { allowInlineNotifyInTests } from "./helpers/notify-env";
import { createReservation } from "@/lib/reservations/create";
import { supabaseReservationDb } from "@/lib/reservations/db";
import { formDataToRaw } from "@/lib/reservations/formData";
import { createServiceClient } from "@/lib/supabase/server";
import { ReservationInput } from "@/lib/types";

const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[notify-inline.db] DB 실증 블록 skip — ${gate.reason}`);
}

const MARK = `p47inline-${randomUUID().slice(0, 8)}`;
const SCRUBBED_ENV = [
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

describe.skipIf(!gate.allowed || !env.hasServiceRole)("DB — 접수 뒤 즉시 발송: 켜면 sent, 끄면 pending 그대로 (로컬 스택)", () => {
  // 접수가 claimable pending 을 남기고, 즉시 발송이 claim/reap 을 돈다 — 둘 다 아웃박스 잠금의 (A)·(B) 다.
  withNotificationsLock();
  // 이 블록은 즉시 발송 배선을 실DB 로 시험한다 — NODE_ENV=test 가드를 여기서만 명시적으로 푼다(sender 는 memory 뿐).
  allowInlineNotifyInTests();

  const saved: Record<string, string | undefined> = {};
  const restHeaders = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  async function rest<T>(method: string, pathAndQuery: string): Promise<{ status: number; body: T }> {
    const res = await fetch(`${env.restRoot}${pathAndQuery}`, { method, headers: restHeaders });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }

  interface LogRow {
    id: number;
    template: string;
    status: string;
    attempts: number;
    provider_message_id: string | null;
  }

  beforeAll(() => {
    for (const k of SCRUBBED_ENV) {
      saved[k] = process.env[k];
      // delete 가 아니라 "" — loadDotEnvLocal 은 undefined 만 채운다(tests/helpers/notify-env.ts)
      process.env[k] = "";
    }
  });

  afterAll(async () => {
    const rows = await rest<{ id: string }[]>("GET", `/reservations?name=eq.${encodeURIComponent(MARK)}&select=id`);
    const ids = Array.isArray(rows.body) ? rows.body.map((r) => r.id) : [];
    if (ids.length > 0) {
      await rest("DELETE", `/notifications_log?reservation_id=in.(${ids.join(",")})`);
      await rest("DELETE", `/reservations?name=eq.${encodeURIComponent(MARK)}`);
    }
    for (const k of SCRUBBED_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  /** 진짜 접수 한 건 — reservations 1행 + notifications_log 고객 SMS pending 1행(사장님 env 를 지웠으므로). */
  async function book(): Promise<string> {
    const fd = new FormData();
    const fields: Record<string, string> = {
      name: MARK,
      phone: "010-1234-5678",
      vehicleSlug: "bus45",
      purposeCode: PURPOSES[0],
      originCode: "SEL",
      destinationCode: "ICN",
      tripType: "round",
      departAtLocal: "2026-10-01T08:00",
      returnAtLocal: "2026-10-01T18:00",
      busCount: "1",
      passengers: "30",
      locale: "ko",
      privacyConsent: "on",
      withdrawalConsent: "on",
    };
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const input = ReservationInput.parse(formDataToRaw(fd).raw);
    const created = await createReservation(input, {
      db: supabaseReservationDb(createServiceClient()),
      now: () => new Date(),
      randomBytes,
      log: () => {},
    });
    expect(created.notifyQueued).toBe(true);
    return created.reservationId;
  }

  const logsOf = async (reservationId: string) =>
    (await rest<LogRow[]>("GET", `/notifications_log?reservation_id=eq.${reservationId}&select=id,template,status,attempts,provider_message_id&order=id.asc`)).body;

  function collectingRunAfter(): { runAfter: (task: () => void | Promise<void>) => void; flush: () => Promise<void>; count: () => number } {
    const tasks: Array<() => void | Promise<void>> = [];
    return {
      runAfter: (task) => {
        tasks.push(task);
      },
      flush: async () => {
        for (const t of tasks.splice(0)) await t();
      },
      count: () => tasks.length,
    };
  }

  test("NOTIFY_INLINE 없음 → 작업을 맡기지 않고, 통지는 pending · attempts 0 그대로", async () => {
    process.env.NOTIFY_SENDER = "memory";
    const id = await book();
    const after = collectingRunAfter();
    expect(notifyAfterResponse("created", after.runAfter)).toBe(false);
    expect(after.count()).toBe(0);
    await after.flush();
    const rows = await logsOf(id);
    expect(rows.map((r) => [r.template, r.status, r.attempts])).toEqual([["created.customer.sms", "pending", 0]]);
    process.env.NOTIFY_SENDER = "";
  });

  test("NOTIFY_INLINE=1 · 제공자 미구성 → 응답 뒤 워커가 돌아도 claim 0 — pending · attempts 0 그대로", async () => {
    process.env.NOTIFY_INLINE = "1";
    const id = await book();
    const after = collectingRunAfter();
    expect(notifyAfterResponse("created", after.runAfter)).toBe(true);
    await after.flush();
    const rows = await logsOf(id);
    expect(rows.map((r) => [r.template, r.status, r.attempts])).toEqual([["created.customer.sms", "pending", 0]]);
    process.env.NOTIFY_INLINE = "";
  });

  test("NOTIFY_INLINE=1 · NOTIFY_SENDER=memory → 응답 직후 그 통지가 sent (attempts 1, memory 메시지 id)", async () => {
    process.env.NOTIFY_INLINE = "1";
    process.env.NOTIFY_SENDER = "memory";
    const id = await book();
    const before = await logsOf(id);
    expect(before.map((r) => r.status)).toEqual(["pending"]);

    const after = collectingRunAfter();
    expect(notifyAfterResponse("created", after.runAfter)).toBe(true);
    // 응답 전 — 아직 아무것도 바뀌지 않았다
    expect((await logsOf(id)).map((r) => r.status)).toEqual(["pending"]);
    await after.flush();

    const rows = await logsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ template: "created.customer.sms", status: "sent", attempts: 1 });
    expect(rows[0].provider_message_id).toMatch(/^memory-/);
    process.env.NOTIFY_INLINE = "";
    process.env.NOTIFY_SENDER = "";
  });

  /**
   * 동시성 (브리프 원칙 3) — 즉시 발송 둘과 크론 하나가 **동시에** 같은 큐를 훑어도 한 행은 한 번만 나간다.
   * 보장은 새로 만든 것이 아니라 0005/0014 claim 의 `for update skip locked` + lease 다. 여기서는 그것을 깨지 않았음을
   * 실DB 에서 본다: 발송기마다 따로 센 memory sender 호출의 합 = 행 수, 겹치는 id 0, 모든 행 attempts 1.
   * send 에 지연을 넣어 세 실행이 실제로 겹치게 한다.
   */
  test("동시성 — 즉시 발송 2 + 크론 1 을 동시에 돌려도 행마다 발송 1회 (skip locked + lease)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await book());
    const slow = () => memorySender(async (req) => {
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true, providerMessageId: `memory-${req.id}` };
    });
    const senders = [slow(), slow(), slow()];
    const db = supabaseWorkerDb(createServiceClient());
    const deps = (i: number): WorkerDeps => ({ db, sender: senders[i], now: () => new Date(), log: () => {} });
    const inline = (i: number) =>
      runInlineNotify("created", { workerDeps: () => deps(i), run: runNotificationWorker, sleep: async () => {}, now: () => new Date(), log: () => {} });

    // 크론 몫은 limit 3 으로 줄여 돌린다 — 어느 한 실행도 6행을 혼자 가져갈 수 없게(즉시 발송은 5) 해서 겹침이 반드시 생긴다.
    await Promise.all([inline(0), inline(1), runNotificationWorker({ dryRun: false, limit: 3 }, deps(2))]);

    const sentIds = senders.flatMap((s) => s.calls.map((c) => c.id));
    expect(new Set(sentIds).size, `같은 행이 두 발송기에서 나갔다: ${JSON.stringify(senders.map((s) => s.calls.map((c) => c.id)))}`).toBe(sentIds.length);
    // 세 실행이 실제로 일을 나눠 가졌다(한 발송기가 전부 가져가면 겹침을 본 것이 아니다) — 적어도 둘이 1건 이상 보냈다
    expect(senders.filter((s) => s.calls.length > 0).length).toBeGreaterThanOrEqual(2);
    for (const id of ids) {
      const rows = await logsOf(id);
      expect(rows.map((r) => [r.status, r.attempts]), id).toEqual([["sent", 1]]);
      expect(sentIds.filter((x) => x === rows[0].id)).toHaveLength(1);
    }
  });

  /**
   * 재시도 간격의 대가(브리프 §4) — ㄱ 을 실DB 에서 본다. 첫 시도가 일시 오류로 실패하면 markFailed 가 첫 백오프(10초)를 걸고,
   * **같은 즉시 발송 호출이** 그만큼 기다렸다 다시 claim 해 보낸다. 하루를 기다리지 않는다. (진짜 sleep — 약 12초 걸린다.)
   */
  test("짧은 재시도 — 첫 시도 일시 오류 → 같은 호출 안에서 약 12초 뒤 두 번째 시도로 sent (attempts 2)", async () => {
    const id = await book();
    let first = true;
    const flaky = memorySender(async (req) => {
      if (first) {
        first = false;
        return { ok: false, error: "provider_503", retryable: true };
      }
      return { ok: true, providerMessageId: `memory-${req.id}` };
    });
    const db = supabaseWorkerDb(createServiceClient());
    const outcome = await runInlineNotify("created", {
      workerDeps: () => ({ db, sender: flaky, now: () => new Date(), log: () => {} }),
      run: runNotificationWorker,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => new Date(),
      log: () => {},
    });
    expect(outcome).toEqual({ passes: 2 });
    const rows = await logsOf(id);
    expect(rows.map((r) => [r.status, r.attempts])).toEqual([["sent", 2]]);
    expect(flaky.calls.filter((c) => c.id === rows[0].id)).toHaveLength(2);
  }, 60_000);

  /**
   * P4-7 수정 라운드 2 · 리뷰 P1-2 — 보냈는데 기록을 끝내 못 하면 그 행을 **격리**한다(마이그레이션 없이, 기존 0005 함수로).
   * 실DB 에서: 격리된 행은 pending 이지만 next_attempt_at 이 아주 먼 미래라 claim 이 집지 않는다 → 다음 날 재발송 0.
   */
  test("기록 실패 → 격리 — 행은 pending · sent_unmarked 표식 · 아주 먼 next_attempt_at, 뒤의 실행이 다시 보내지 않는다", async () => {
    const id = await book();
    const client = createServiceClient();
    const real = supabaseWorkerDb(client);
    const brokenMark: WorkerDb = {
      ...real,
      markSent: async () => {
        throw new Error("outbox.markSent: [08006] connection lost");
      },
    };
    const first = memorySender();
    const r1 = await runNotificationWorker({ dryRun: false }, { db: brokenMark, sender: first, now: () => new Date(), log: () => {}, sleep: async () => {} });
    const [row] = await logsOf(id);
    expect(r1.ids.quarantined).toContain(row.id);
    const full = (await rest<{ status: string; last_error: string; next_attempt_at: string }[]>("GET", `/notifications_log?id=eq.${row.id}&select=status,last_error,next_attempt_at`)).body[0];
    expect(full.status).toBe("pending");
    expect(full.last_error).toBe(`sent_unmarked:memory-${row.id}`);
    expect(new Date(full.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 365 * 24 * 60 * 60_000);

    const second = memorySender();
    await runNotificationWorker({ dryRun: false }, { db: real, sender: second, now: () => new Date(), log: () => {}, sleep: async () => {} });
    expect(second.calls.map((c) => c.id)).not.toContain(row.id);
    expect(first.calls.filter((c) => c.id === row.id)).toHaveLength(1);
  });

  /**
   * P4-7 수정 라운드 2 · 리뷰 P1-3 — 동시 give-up 경합으로 **실패 알림 행이 둘** 생긴 뒤의 경로를 실DB 로 잰다.
   * (경합 자체는 enqueue 의 SELECT→INSERT 사이라 재현이 스케줄에 달렸다 — 여기서는 경합이 남긴 **결과 상태**(알림 행 둘)를 직접 만든다.
   *  두 워커가 동시에 알림 행을 넣는 경합 자체는 tests/notify-mail.test.ts §9 가 결정적으로 재현한다.)
   * 가짜 Resend 는 문서화된 멱등성 의미만 흉내 낸다: 같은 키·같은 본문 → 원래 응답, 재발송 없음.
   */
  test("실패 알림 행 둘 → 같은 중복 방지 키 → 도착 1통 · 한 행 sent, 다른 행은 failed/duplicate_sent (DB 의 sent_once 가 흡수)", async () => {
    const reservationId = await book();
    const client = createServiceClient();
    const ins = await fetch(`${env.restRoot}/notifications_log`, {
      method: "POST",
      headers: { ...restHeaders, Prefer: "return=representation" },
      body: JSON.stringify(
        [0, 1].map(() => ({
          reservation_id: reservationId,
          event: "created",
          channel: "email",
          to_phone: "boss@example.test",
          template: "created.owner.failure.email",
          status: "pending",
        })),
      ),
    });
    expect(ins.status).toBe(201);
    const alertIds = ((await ins.json()) as { id: number }[]).map((r) => r.id);
    expect(alertIds).toHaveLength(2);

    const seen = new Map<string, { body: string; id: string }>();
    const delivered: string[] = [];
    const keys: string[] = [];
    const fakeFetch = async (_url: string, init: RequestInit): Promise<Response> => {
      const key = new Headers(init.headers).get("Idempotency-Key") ?? "";
      keys.push(key);
      const body = String(init.body);
      const prior = seen.get(key);
      if (prior === undefined) {
        const id = `mail-${delivered.length + 1}`;
        seen.set(key, { body, id });
        delivered.push(key);
        return new Response(JSON.stringify({ id }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (prior.body === body) return new Response(JSON.stringify({ id: prior.id }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ name: "invalid_idempotent_request" }), { status: 409, headers: { "content-type": "application/json" } });
    };
    const sender = resendSender({
      apiKey: "re_FAKE_NOT_A_REAL_KEY",
      from: "noreply@send.example.test",
      fetch: fakeFetch,
      log: () => {},
      vars: templateVars({ client, origin: "https://bestour.co.kr" }),
    });
    expect(sender.channels).toEqual(["email"]);
    const report = await runNotificationWorker({ dryRun: false }, { db: supabaseWorkerDb(client), sender, now: () => new Date(), log: () => {}, sleep: async () => {} });

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(`notify/created.owner.failure.email/${reservationId}`);
    expect(keys[1]).toBe(keys[0]);
    expect(delivered).toHaveLength(1);
    expect(report.sent).toBe(1);
    expect(report.duplicate).toBe(1);

    const rows = (await rest<{ id: number; status: string; last_error: string | null; provider_message_id: string | null }[]>(
      "GET",
      `/notifications_log?id=in.(${alertIds.join(",")})&select=id,status,last_error,provider_message_id&order=id.asc`,
    )).body;
    expect(rows.map((r) => [r.status, r.last_error, r.provider_message_id])).toEqual([
      ["sent", null, "mail-1"],
      ["failed", "duplicate_sent", null],
    ]);

    // 수정 라운드 3 · P2-8 — 그 중복 억제 행은 발송 내역 요약의 "실패" 로 세지지 않는다(메일은 한 통 도착했다)
    const summary = await getNotificationSummary({}, client as never);
    const dupOnly = await rest<{ id: number }[]>("GET", `/notifications_log?status=eq.failed&last_error=eq.duplicate_sent&select=id`);
    expect(dupOnly.body.length).toBeGreaterThanOrEqual(1);
    const allFailed = await rest<{ id: number }[]>("GET", `/notifications_log?status=eq.failed&select=id`);
    expect(summary.failed).toBe(allFailed.body.length - dupOnly.body.length);
  });

  /**
   * 수정 라운드 3 · 리뷰 P1-B — 격리 행 **자가 복구**. 기존 0005 `mark_notification_sent` 는 `where status='pending'` 이라
   * 격리 행(pending)을 받아들인다(마이그레이션 없음). DB 가 회복된 뒤의 실행이 저장된 제공자 id 로 기록을 마치고,
   * 행은 sent · last_error null · provider_message_id 복원 — 통계·요약에서 사라진다. 발송은 다시 하지 않는다.
   */
  test("자가 복구 — 격리 행이 다음 실행에서 저장된 제공자 id 로 sent 가 된다(재발송 0) · 요약의 '기록 확인 필요' 에서 빠진다", async () => {
    const id = await book();
    const client = createServiceClient();
    const real = supabaseWorkerDb(client);
    const broken: WorkerDb = {
      ...real,
      markSent: async () => {
        throw new Error("outbox.markSent: [08006] connection lost");
      },
    };
    const first = memorySender();
    await runNotificationWorker({ dryRun: false }, { db: broken, sender: first, now: () => new Date(), log: () => {}, sleep: async () => {} });
    const [row] = await logsOf(id);
    expect(row.status).toBe("pending");

    const before = await getNotificationSummary({}, client as never);
    expect(before.sentUnconfirmed).toBeGreaterThanOrEqual(1);

    const second = memorySender();
    const report = await runNotificationWorker({ dryRun: false }, { db: real, sender: second, now: () => new Date(), log: () => {}, sleep: async () => {} });
    expect(report.ids.healed).toContain(row.id);
    expect(second.calls.map((c) => c.id)).not.toContain(row.id);
    const [after] = await logsOf(id);
    expect(after).toMatchObject({ status: "sent", provider_message_id: `memory-${row.id}` });
    const full = (await rest<{ last_error: string | null }[]>("GET", `/notifications_log?id=eq.${row.id}&select=last_error`)).body[0];
    expect(full.last_error).toBeNull();

    const later = await getNotificationSummary({}, client as never);
    // 이 실행이 복구한 격리 행 수만큼 줄었다(앞 테스트가 남긴 격리 행이 있으면 함께 복구된다 — 그것이 설계다)
    expect(later.sentUnconfirmed).toBe(before.sentUnconfirmed - report.ids.healed.length);
  });

  test("통계 보정(getNotifyCorrections) — 로컬 DB 에서 격리 행·중복 억제 행을 센다(0022 와 같은 창)", async () => {
    const client = createServiceClient();
    const id = await book();
    const [row] = await logsOf(id);
    const q = await fetch(`${env.restRoot}/rpc/mark_notification_failed`, {
      method: "POST",
      headers: restHeaders,
      body: JSON.stringify({ p_id: row.id, p_error: "sent_unmarked:pm-probe", p_give_up: false, p_retry_after_ms: 315_360_000_000 }),
    });
    expect([200, 204]).toContain(q.status);
    const c = await getNotifyCorrections({ window_days: 7, stuck_hours: 1 }, new Date(), client as never);
    expect(c.sentUnconfirmed).toBeGreaterThanOrEqual(1);
    // 방금 만든 행은 1시간이 안 됐다 — "멈춘 대기" 보정에는 들어가지 않는다
    const young = await getNotifyCorrections({ window_days: 7, stuck_hours: 1 }, new Date(), client as never);
    const aged = await getNotifyCorrections({ window_days: 7, stuck_hours: 1 }, new Date(Date.now() + 2 * 60 * 60_000), client as never);
    expect(aged.sentUnconfirmedStuck).toBeGreaterThan(young.sentUnconfirmedStuck);
  });
});

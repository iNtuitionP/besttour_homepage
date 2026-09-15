/**
 * P4-1 — 0007 회수기(reaper) 계약 테스트 (플랜 v4 · 리뷰 M3).
 *
 * M3: claim 이 attempts 를 올리고 lease(5분)를 건 뒤 발송기가 죽으면 행은 pending 인 채 남는다. attempts < 5 인 동안은
 * lease 만료 후 다시 claim 되지만, 5회째 claim 뒤 죽으면 attempts = 5 라 다시는 claim 되지 않고 아무도 failed 로 바꾸지
 * 않는다 — 조용히 사라진다. 0007 reap_stale_notifications() 가 그 행을 failed/lease_expired_after_max_attempts 로 회수한다.
 *
 * 브리프 §검증 9~11:
 *   9.  SQL 텍스트 — 함수명 · attempts >= 5 · status = 'failed' · last_error 값 · security definer · set search_path ·
 *       revoke anon/authenticated · 롤백은 drop function 만 + begin;/commit;
 *   10. MAX_ATTEMPTS === 5 와 SQL 의 숫자 대조 — 0005(claim 의 attempts < 5)와 0007(attempts >= 5) 둘 다
 *   11. DB — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만: attempts=5·lease 만료 행만 failed, attempts=4 행과 lease 미래 행은 그대로.
 *       원격이면 skip 을 가드 테스트로 단언한다.
 * 그리고 lib/notify/outbox.ts reapStale 어댑터(RPC 이름 · 행 변환 · 오류 throw).
 *
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { MAX_ATTEMPTS, reapStale } from "@/lib/notify/outbox";
import { consentFields } from "@/lib/reservations/consent";
import type { OutboxRow } from "@/lib/types";
import { withNotificationsLock } from "./helpers/db-lock";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const ROLLBACKS_DIR = path.join(ROOT, "supabase", "rollbacks");
const UP_SQL_PATH = path.join(MIGRATIONS_DIR, "0007_outbox_reaper.sql");
const DOWN_SQL_PATH = path.join(ROLLBACKS_DIR, "0007_outbox_reaper.down.sql");
const OUTBOX_SQL_PATH = path.join(MIGRATIONS_DIR, "0005_outbox.sql");

const FN = "reap_stale_notifications";
const REAP_ERROR = "lease_expired_after_max_attempts";
const MINUTE = 60_000;

const readSql = (p: string) => readFileSync(p, "utf-8");
const stripSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const commentLines = (sql: string) => sql.split("\n").filter((l) => /^\s*--/.test(l)).join("\n");

// =============================================================================
// 9. 0007_outbox_reaper.sql 텍스트
// =============================================================================
describe("supabase/migrations/0007_outbox_reaper.sql", () => {
  test("존재하고, 0007 번호는 이 파일 하나뿐이다. migrations/ 안에 롤백 파일이 섞여 있지 않다", () => {
    expect(existsSync(UP_SQL_PATH)).toBe(true);
    expect(readdirSync(MIGRATIONS_DIR).filter((f) => /^0007_/.test(f))).toEqual(["0007_outbox_reaper.sql"]);
    const stray = readdirSync(MIGRATIONS_DIR).filter((f) => /^[0-9]+_.*\.sql$/.test(f) && /\.down\.sql$|rollback/i.test(f));
    expect(stray).toEqual([]);
  });

  test("함수 — reap_stale_notifications() · returns setof notifications_log · security definer · set search_path = public", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toContain(`create or replace function ${FN}()`);
    expect(code).toContain("returns setof notifications_log");
    expect(code).toMatch(/security definer/);
    expect(code).toContain("set search_path = public");
  });

  test("대상 — status = 'pending' and attempts >= 5 and next_attempt_at <= now() (5회째 lease 가 만료된 행만)", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toMatch(/where status = 'pending' and attempts >= 5 and next_attempt_at <= now\(\)/);
  });

  test("조치 — status = 'failed' · last_error = 'lease_expired_after_max_attempts' · updated_at = now() · 바뀐 행 반환", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toMatch(/set status = 'failed'/);
    expect(code).toContain(`last_error = '${REAP_ERROR}'`);
    expect(code).toMatch(/updated_at = now\(\)/);
    expect(code).toMatch(/returning \*|returning n\.\*/);
  });

  test("회수는 update 뿐이다 — delete 도, attempts 초기화도, 다른 상태 전이도 없다", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).not.toMatch(/\bdelete\b/);
    expect(code).not.toMatch(/attempts = 0/);
    expect(code).not.toMatch(/set status = 'pending'/);
    expect(code).not.toMatch(/set status = 'sent'/);
    // claim 함수 등 0005 의 함수를 다시 정의하지 않는다
    expect(code).not.toContain("claim_pending_notifications");
    expect(code).not.toContain("mark_notification_sent");
    expect(code).not.toContain("mark_notification_failed");
  });

  test("security definer 함수는 anon·authenticated 가 RPC 로 부를 수 없다 — execute 회수 + service_role 에만 부여 (0005 §6 과 동일)", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toMatch(new RegExp(`revoke (all|execute) on function ${FN}\\(\\) from public, anon, authenticated`));
    expect(code).toMatch(new RegExp(`grant execute on function ${FN}\\(\\) to service_role`));
  });

  test("주석에 M3(왜 회수기가 필요한가)와 anon 회수 이유가 있다", () => {
    const comments = commentLines(readSql(UP_SQL_PATH));
    expect(comments).toMatch(/M3/);
    expect(comments).toMatch(/lease/i);
    expect(comments).toMatch(/anon/);
  });
});

// =============================================================================
// 10. 최대 시도 횟수 — TS 상수 · 0005 · 0007 이 같은 숫자
// =============================================================================
describe("MAX_ATTEMPTS 와 SQL 의 숫자 대조", () => {
  test("MAX_ATTEMPTS === 5", () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });

  test("0005 claim 은 attempts < 5, 0007 reap 은 attempts >= 5 — 서로 여집합이라 같은 행을 두 함수가 동시에 잡지 않는다", () => {
    const claim = compact(stripSqlComments(readSql(OUTBOX_SQL_PATH)));
    const reap = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(claim).toContain(`attempts < ${MAX_ATTEMPTS}`);
    expect(reap).toContain(`attempts >= ${MAX_ATTEMPTS}`);
    // 0007 이 다른 숫자를 쓰고 있지 않다
    expect(reap).not.toMatch(/attempts >= (?!5\b)\d+/);
  });
});

// =============================================================================
// 롤백 0007_outbox_reaper.down.sql
// =============================================================================
describe("supabase/rollbacks/0007_outbox_reaper.down.sql", () => {
  test("rollbacks/ 에 있고 함수 drop 만 한다 — failed 로 바뀐 행은 되돌리지 않는다(그 행은 진실이다)", () => {
    expect(existsSync(DOWN_SQL_PATH)).toBe(true);
    const code = compact(stripSqlComments(readSql(DOWN_SQL_PATH)));
    expect(code).toContain(`drop function if exists ${FN}()`);
    expect(code).not.toMatch(/\bupdate notifications_log\b/);
    expect(code).not.toMatch(/\bdelete\b/);
    expect(code).not.toMatch(/set status = 'pending'/);
  });

  test("트랜잭션 안에서 실행되고, 수동 실행·repair 안내가 있다 (0006 규약)", () => {
    const raw = readSql(DOWN_SQL_PATH);
    expect(raw).toMatch(/\bbegin;/);
    expect(raw).toMatch(/\bcommit;/);
    expect(commentLines(raw)).toMatch(/migration repair --status reverted 0007/);
  });
});

// =============================================================================
// reapStale 어댑터 — 가짜 클라이언트로 호출 모양을 고정 (네트워크 없음)
// =============================================================================
function fakeClient(responses: { data: unknown; error: { code?: string; message: string } | null }[]) {
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    rpc(fn: string, args?: unknown) {
      calls.push({ fn, args });
      const r = responses.shift();
      if (!r) throw new Error("fakeClient: 준비된 응답이 없다");
      return Promise.resolve(r);
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const RID = "00000000-0000-4000-8000-000000000007";

describe("lib/notify/outbox.ts reapStale", () => {
  test("RPC reap_stale_notifications 를 인자 없이 부르고, 행을 OutboxRow(to) 로 변환한다", async () => {
    const dbRow = {
      id: 9,
      reservation_id: RID,
      event: "created",
      channel: "sms",
      to_phone: "010",
      template: "created.customer.sms",
      status: "failed",
      provider_message_id: null,
      error: null,
      created_at: "2026-09-13T00:00:00+00:00",
      attempts: 5,
      last_error: REAP_ERROR,
      updated_at: "2026-09-13T01:00:00+00:00",
      next_attempt_at: "2026-09-13T00:55:00+00:00",
    };
    const { client, calls } = fakeClient([{ data: [dbRow], error: null }]);
    const reaped = await reapStale(client);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe(FN);
    expect(calls[0].args ?? {}).toEqual({});
    expect(reaped).toEqual<OutboxRow[]>([
      {
        id: 9,
        reservation_id: RID,
        event: "created",
        channel: "sms",
        to: "010",
        template: "created.customer.sms",
        status: "failed",
        attempts: 5,
        last_error: REAP_ERROR,
        updated_at: "2026-09-13T01:00:00+00:00",
        next_attempt_at: "2026-09-13T00:55:00+00:00",
      },
    ]);
  });

  test("회수 대상이 없으면 [] (data null 도 [])", async () => {
    const { client } = fakeClient([{ data: null, error: null }]);
    await expect(reapStale(client)).resolves.toEqual([]);
  });

  test("DB 오류는 throw — 회수 실패가 조용히 넘어가면 M3 가 다시 생긴다", async () => {
    const { client } = fakeClient([{ data: null, error: { code: "42883", message: "function does not exist" } }]);
    await expect(reapStale(client)).rejects.toThrow(/reapStale.*42883.*function does not exist/);
  });
});

// =============================================================================
// 11. DB — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만 (원격 notifications_log 에는 어떤 쓰기도 하지 않는다)
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[outbox-reaper.test] DB 실증 블록 skip — ${gate.reason}`);
}

test("DB 쓰기 가드 — 원격 URL 이면 REQUIRE_DB_TESTS=1 을 강제해도 닫힌다", () => {
  const forced = dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, REQUIRE_DB_TESTS: "1" });
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|kong)(:|\/|$)/i.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
    expect(forced.allowed).toBe(false);
    expect(gate.allowed).toBe(false);
  } else {
    expect(forced.allowed).toBe(true);
  }
});

describe.skipIf(!gate.allowed || !env.hasServiceRole)("DB — 0007 회수기 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)", () => {
  // reap 도 claim 도 테이블 전체가 대상이다 — 같은 테이블을 쓰는 다른 파일과 직렬화한다 (tests/helpers/db-lock.ts).
  withNotificationsLock();

  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const TEST_PREFIX = "p41reap-";
  let reservationId = "";

  type RestResult = { status: number; body: unknown };
  async function rest(method: string, pathAndQuery: string, json?: unknown, prefer?: string): Promise<RestResult> {
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
      // 본문이 JSON 이 아니면 문자열 그대로
    }
    return { status: res.status, body };
  }

  async function insertLog(overrides: Record<string, unknown>): Promise<number> {
    const r = await rest(
      "POST",
      "/notifications_log",
      {
        reservation_id: reservationId,
        event: "created",
        channel: "sms",
        to_phone: "010-0000-0000",
        template: "created.customer.sms",
        status: "pending",
        ...overrides,
      },
      "return=representation",
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return (r.body as { id: number }[])[0].id;
  }
  async function logById(id: number) {
    const r = await rest("GET", `/notifications_log?select=id,status,attempts,last_error&id=eq.${id}`);
    return (r.body as { id: number; status: string; attempts: number; last_error: string | null }[])[0];
  }
  async function wipeLogs() {
    await rest("DELETE", `/notifications_log?reservation_id=eq.${reservationId}`);
  }

  let serviceClient: SupabaseClient;

  beforeAll(async () => {
    const probe = await rest("POST", `/rpc/${FN}`, {});
    if (probe.status !== 200) {
      throw new Error(
        `0007_outbox_reaper.sql 이 이 DB(${process.env.NEXT_PUBLIC_SUPABASE_URL})에 적용되지 않은 것으로 보인다 — HTTP ${probe.status}: ${JSON.stringify(probe.body).slice(0, 200)}`,
      );
    }
    const { createClient } = await import("@supabase/supabase-js");
    serviceClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, env.serviceRoleKey, { auth: { persistSession: false } });

    const now = new Date();
    const created = await rest(
      "POST",
      "/reservations",
      {
        public_code: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
        name: "테스트",
        phone: "010-0000-0000",
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
  });

  afterAll(async () => {
    if (!reservationId) return;
    await wipeLogs();
    await rest("DELETE", `/reservations?public_code=like.${TEST_PREFIX}*`);
    const leftLogs = await rest("GET", `/notifications_log?select=id&reservation_id=eq.${reservationId}`);
    const leftRes = await rest("GET", `/reservations?select=id&public_code=like.${TEST_PREFIX}*`);
    expect(leftLogs.body).toEqual([]);
    expect(leftRes.body).toEqual([]);
  });

  test("attempts=5 · lease 만료 행만 failed/lease_expired_after_max_attempts — attempts=4 행과 lease 미래 행은 pending 그대로", async () => {
    await wipeLogs();
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 5 * MINUTE).toISOString();
    const stale = await insertLog({ attempts: MAX_ATTEMPTS, next_attempt_at: past, template: "created.customer.sms" });
    const stillRetrying = await insertLog({ attempts: MAX_ATTEMPTS - 1, next_attempt_at: past, template: "created.owner.sms", channel: "alimtalk" });
    const inFlight = await insertLog({ attempts: MAX_ATTEMPTS, next_attempt_at: future, template: "created.owner.email", channel: "email", to_phone: "o@x.kr" });

    const reaped = await reapStale(serviceClient);
    // reap 도 테이블 전체가 대상이다 — 결과가 어긋나면 남의 행을 회수한 것이다. 어느 행인지 메시지에 남긴다.
    expect(
      reaped.map((r) => r.id),
      `reap 결과에 이 파일 밖의 행이 섞였다 (notifications-log 잠금을 안 잡은 DB 블록이 있다): ${JSON.stringify(reaped)}`,
    ).toEqual([stale]);
    expect(reaped[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, last_error: REAP_ERROR });

    expect(await logById(stale)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, last_error: REAP_ERROR });
    expect(await logById(stillRetrying)).toMatchObject({ status: "pending", attempts: MAX_ATTEMPTS - 1, last_error: null });
    expect(await logById(inFlight)).toMatchObject({ status: "pending", attempts: MAX_ATTEMPTS, last_error: null });

    // 두 번째 회수는 아무것도 잡지 않는다(멱등). attempts=4 행은 claim 이 다시 잡는다(회수 대상이 아니라 재시도 대상).
    expect(await reapStale(serviceClient)).toEqual([]);
    const claimed = await rest("POST", "/rpc/claim_pending_notifications", { p_limit: 10 });
    expect((claimed.body as { id: number }[]).map((r) => r.id)).toEqual([stillRetrying]);
  });

  test("sent·failed 행은 attempts·시각과 무관하게 건드리지 않는다", async () => {
    await wipeLogs();
    const past = new Date(Date.now() - 1000).toISOString();
    const sent = await insertLog({ status: "sent", attempts: MAX_ATTEMPTS, next_attempt_at: past });
    const failed = await insertLog({ status: "failed", attempts: MAX_ATTEMPTS, next_attempt_at: past, last_error: "dead", channel: "alimtalk" });
    expect(await reapStale(serviceClient)).toEqual([]);
    expect(await logById(sent)).toMatchObject({ status: "sent" });
    expect(await logById(failed)).toMatchObject({ status: "failed", last_error: "dead" });
  });

  test.skipIf(!env.anonKey)("anon 은 회수 RPC 를 부를 수 없다 (security definer 함수의 execute 회수)", async () => {
    const res = await fetch(`${env.restRoot}/rpc/${FN}`, {
      method: "POST",
      headers: { apikey: env.anonKey as string, Authorization: `Bearer ${env.anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect([401, 403, 404]).toContain(res.status);
  });
});

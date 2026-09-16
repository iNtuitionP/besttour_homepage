/**
 * P4-5 — 0014 채널을 가려서 claim 하기 (플랜 v4 · ADR-7).
 *
 * 이 파일이 지키는 사고: **사장님 알림이 조용히 죽는 것.**
 * 0005 `claim_pending_notifications(p_limit)` 의 where 절에는 channel 조건이 없다. 그래서 사장님 번호가 없어 생긴
 * `channel='email'` 행을 문자 어댑터가 집어가고(`lib/notify/solapi.ts` → `unsupported_channel:email`, retryable:false),
 * 그 행은 5회를 확정적으로 태운 뒤 failed 로 종착한다 — 고객 문자만 나가고 사장님은 아무것도 못 받는다.
 * 0014 는 claim 에 채널 화이트리스트를 붙이고, sender 는 자기가 보낼 수 있는 채널만 넘긴다. 보낼 수 없는 행은 **집지 않는다**.
 *
 * 브리프 §검증 1·2·6:
 *   1. SQL 텍스트 — 1-인자 drop 이 create 보다 앞 · revoke/grant 재기술(같은 트랜잭션) · 자기검증 3항 · 롤백의 무조건 승인 플래그
 *   2. DB 실증 — 채널별 claim 결과, **집히지 않은 행의 attempts 불변**(이 단언이 이 태스크의 존재 이유다)
 *   6. 회귀 — 같은 픽스처로 "고치기 전"과 "고친 뒤"를 나란히 돌린다
 *
 * 실제 발송 0 — 제공자 fetch 는 전부 가짜다. DB 는 로컬 스택 전용(dbWriteGate).
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { MAX_ATTEMPTS, claimPending } from "@/lib/notify/outbox";
import { resendSender } from "@/lib/notify/mail";
import { routingSender } from "@/lib/notify/router";
import type { NotificationSender } from "@/lib/notify/sender";
import { solapiSender, type TemplateVarsPort } from "@/lib/notify/solapi";
import type { CustomerVars, OwnerVars } from "@/lib/notify/templates";
import { runNotificationWorker, supabaseWorkerDb, type WorkerDb } from "@/lib/notify/worker";
import { consentFields } from "@/lib/reservations/consent";
import type { NotifyChannel } from "@/lib/types";
import { withNotificationsLock } from "./helpers/db-lock";
import { runLocalSql } from "./helpers/local-stack-sql";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const ROLLBACKS_DIR = path.join(ROOT, "supabase", "rollbacks");
const UP_SQL_PATH = path.join(MIGRATIONS_DIR, "0014_claim_by_channel.sql");
const DOWN_SQL_PATH = path.join(ROLLBACKS_DIR, "0014_claim_by_channel.down.sql");
const FN = "claim_pending_notifications";
const ACK_FLAG = "bestour.rollback_0014_ack";

const MINUTE = 60_000;
const readSql = (p: string) => readFileSync(p, "utf-8");
const stripSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// =============================================================================
// 1. 0014_claim_by_channel.sql 텍스트
// =============================================================================
describe("1. supabase/migrations/0014_claim_by_channel.sql", () => {
  test("존재하고, 0014 번호는 이 파일 하나뿐이다", () => {
    expect(existsSync(UP_SQL_PATH)).toBe(true);
    expect(readdirSync(MIGRATIONS_DIR).filter((f) => /^0014_/.test(f))).toEqual(["0014_claim_by_channel.sql"]);
  });

  test("1-인자 구버전 drop 이 create 보다 **앞**에 있다 — 기본값만 더하면 1-인자 호출이 모호해진다", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    const drop = code.indexOf(`drop function if exists ${FN}(int)`);
    const create = code.indexOf(`create or replace function ${FN}(`);
    expect(drop, "1-인자 drop 문이 없다").toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
  });

  test("새 시그니처 — p_limit int default 10 · p_channels text[] default null (구 호출 호환)", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toContain(`create or replace function ${FN}(p_limit int default 10, p_channels text[] default null)`);
  });

  test("where 절 — null 이면 전 채널, 아니면 channel = any(p_channels)", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toContain("status = 'pending' and next_attempt_at <= now() and attempts < 5");
    expect(code).toContain("(p_channels is null or channel = any (p_channels))");
  });

  test("security definer + search_path 에 pg_temp 까지 — 임시 릴레이션 섀도잉 차단", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toContain("security definer");
    expect(code).toContain("set search_path = public, pg_temp");
  });

  test("drop 이 ACL 을 지우므로 revoke/grant 를 새 시그니처로 다시 쓴다 — **같은 파일(=같은 트랜잭션)** 안에서", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toContain(`revoke all on function ${FN}(int, text[]) from public, anon, authenticated`);
    expect(code).toContain(`grant execute on function ${FN}(int, text[]) to service_role`);
    const create = code.indexOf(`create or replace function ${FN}(`);
    expect(code.indexOf(`revoke all on function ${FN}(int, text[])`)).toBeGreaterThan(create);
    // 중간에 트랜잭션을 끊으면 drop~grant 사이에 definer 함수가 공개된다. 이 파일에는 commit 이 없어야 한다.
    expect(code).not.toMatch(/(^|;|\s)commit\s*;/);
    expect(code).not.toMatch(/(^|;|\s)begin\s*;/);
  });

  test("PostgREST 스키마 캐시 갱신 — 시그니처가 바뀌면 캐시된 스키마로는 새 인자를 못 본다", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toContain("notify pgrst, 'reload schema'");
  });

  test("자기검증 do 블록 3항 — ① 구버전 잔존 ② EXECUTE 보유자 ③ 채널 필터 실제 동작", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toContain("do $$");
    // ① 시그니처가 정확히 (int) 인 함수 객체가 남아 있지 않은가
    expect(code).toContain(`to_regprocedure('public.${FN}(int)')`);
    // ② EXECUTE 보유자가 service_role 뿐인가 (anon·authenticated·PUBLIC 0)
    expect(code).toContain("has_function_privilege");
    expect(code).toContain("aclexplode");
    expect(code).toContain("service_role");
    // ③ 메일 행이 '{sms}' claim 에 나오지 않는가 — 임시 행으로 실제로 불러 본다
    expect(code).toContain("array['sms']");
    expect(code).toContain("insert into notifications_log");
    // 세 항목 모두 어긋나면 멈춘다 + 원인을 짚는 hint
    expect((code.match(/raise exception/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((code.match(/using hint =/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test("자기검증의 임시 행은 되돌린다 — 표에 흔적을 남기지 않는다(서브트랜잭션 + 예외)", () => {
    const code = compact(stripSqlComments(readSql(UP_SQL_PATH)));
    expect(code).toContain("exception");
    expect(code).toContain("0014_probe_rollback");
  });
});

// =============================================================================
// 2. 롤백 — 승인 플래그를 **조건 없이** 요구한다 (0012 리뷰 M2 규약)
// =============================================================================
describe("2. supabase/rollbacks/0014_claim_by_channel.down.sql", () => {
  test("존재하고 migrations/ 밖에 있다 — CLI 가 롤백까지 적용하지 않도록", () => {
    expect(existsSync(DOWN_SQL_PATH)).toBe(true);
    expect(readdirSync(MIGRATIONS_DIR).filter((f) => /down/.test(f))).toEqual([]);
  });

  test("승인 플래그를 조건 없이 요구한다 — 행 수를 보지 않는다", () => {
    const code = compact(stripSqlComments(readSql(DOWN_SQL_PATH)));
    expect(code).toContain(`current_setting('${ACK_FLAG}', true)`);
    expect(code).toContain("raise exception");
    // "행이 없으면 그냥 진행" 같은 조건부 예외가 아니다 — count(*) 로 판단하지 않는다
    expect(code).not.toMatch(/if .*count\(\*\)/);
  });

  test("예외 메시지가 되돌림의 결과를 적는다 — 메일 행을 문자 어댑터가 다시 태운다", () => {
    const raw = readSql(DOWN_SQL_PATH);
    expect(raw).toMatch(/메일/);
    expect(raw).toMatch(/attempts/);
  });

  test("2-인자를 drop 하고 0005 의 1-인자를 복원 + grant 복원", () => {
    const code = compact(stripSqlComments(readSql(DOWN_SQL_PATH)));
    expect(code).toContain(`drop function if exists ${FN}(int, text[])`);
    expect(code).toContain(`create or replace function ${FN}(p_limit int default 10)`);
    expect(code).toContain(`revoke all on function ${FN}(int) from public, anon, authenticated`);
    expect(code).toContain(`grant execute on function ${FN}(int) to service_role`);
    expect(code).toContain("begin;");
    expect(code).toContain("commit;");
  });
});

// =============================================================================
// DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1
// =============================================================================
const env = dbSmokeEnv();
const gate = dbWriteGate();
if (!gate.allowed) console.info(`[outbox-claim-channel] DB 실증 skip — ${gate.reason}`);

const RID_FAKE = "00000000-0000-4000-8000-000000000042";
const CUSTOMER_VARS: CustomerVars = { publicCode: "ABCD2345", origin: "https://example.test" };
const OWNER_VARS: OwnerVars = {
  ...CUSTOMER_VARS,
  reservationId: RID_FAKE,
  name: "테스트",
  phone: "010-0000-0000",
  vehicleLabel: "45인승 우등",
  departAtKst: "2026-10-01 08:00",
  originLabel: "서울",
  destinationLabel: "부산",
  busCount: 1,
  passengers: 40,
};
/** 문안 변수 포트 — DB 를 읽지 않는 고정값(이 파일이 보는 것은 claim 이지 문안이 아니다). */
const varsPort: TemplateVarsPort = {
  async ownerVars() {
    return OWNER_VARS;
  },
  async customerVars() {
    return CUSTOMER_VARS;
  },
};

/** 실제 발송 0 — 제공자에 닿지 않는다. 문자 어댑터가 성공했다고 답하도록 접수 응답만 흉내 낸다. */
const acceptingFetch = async (): Promise<Response> =>
  new Response(
    JSON.stringify({
      groupInfo: { groupId: "G-TEST", count: { total: 1, registeredSuccess: 1, registeredFailed: 0 } },
      failedMessageList: [],
      messageList: [{ messageId: "M-TEST" }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const smsOnlySender = () =>
  solapiSender({
    apiKey: "TESTKEY",
    apiSecret: "TESTSECRET",
    from: "15666188",
    fetch: acceptingFetch,
    now: () => new Date(),
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i),
    log: () => {},
    vars: varsPort,
  });

describe.skipIf(!gate.allowed || !env.hasServiceRole)("DB — 0014 채널 필터 claim 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)", () => {
  // claim 은 표 전체를 집어간다 — 맨 위에서 잡아 이 블록의 정리가 끝난 뒤 풀리게 한다 (tests/helpers/db-lock.ts).
  withNotificationsLock();

  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const TEST_PREFIX = "p45test-";
  let reservationId = "";
  let serviceClient: SupabaseClient;

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
  const rpc = (fn: string, args: Record<string, unknown>) => rest("POST", `/rpc/${fn}`, args);

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
  const smsRow = () => insertLog({ channel: "sms", template: "created.customer.sms", to_phone: "010-0000-0000" });
  const emailRow = () => insertLog({ channel: "email", template: "created.owner.email", to_phone: "owner@example.test" });
  const alimtalkRow = () => insertLog({ channel: "alimtalk", template: "created.customer.sms", to_phone: "010-0000-0000" });

  async function logById(id: number) {
    const r = await rest("GET", `/notifications_log?select=id,channel,status,attempts,last_error&id=eq.${id}`);
    return (r.body as { id: number; channel: string; status: string; attempts: number; last_error: string | null }[])[0];
  }
  async function wipeLogs() {
    await rest("DELETE", `/notifications_log?reservation_id=eq.${reservationId}`);
  }
  /** 백오프로 미래에 찍힌 next_attempt_at 을 현재로 되돌린다 — 크론 5회를 기다리지 않고 재시도를 재현한다. */
  async function makeDue() {
    await rest("PATCH", `/notifications_log?reservation_id=eq.${reservationId}&status=eq.pending`, {
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
    });
  }

  beforeAll(async () => {
    const probe = await rpc(FN, { p_limit: 0, p_channels: ["sms"] });
    if (probe.status !== 200) {
      throw new Error(
        `0014_claim_by_channel.sql 이 이 DB(${process.env.NEXT_PUBLIC_SUPABASE_URL})에 적용되지 않은 것으로 보인다 — HTTP ${probe.status}: ${JSON.stringify(probe.body).slice(0, 200)}`,
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

  // ── 채널별 claim ────────────────────────────────────────────────────────
  test("p_channels => '{sms}' → 문자 행만. **메일·알림톡 행의 attempts 는 그대로 0** (이 단언이 이 태스크의 존재 이유다)", async () => {
    await wipeLogs();
    const sms = await smsRow();
    const email = await emailRow();
    const ata = await alimtalkRow();

    const claimed = await rpc(FN, { p_limit: 10, p_channels: ["sms"] });
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    const ids = (claimed.body as { id: number }[]).map((r) => r.id);
    expect(ids, `claim 결과에 이 파일 밖의 행이 섞였다: ${JSON.stringify(claimed.body)}`).toEqual([sms]);

    expect(await logById(sms)).toMatchObject({ status: "pending", attempts: 1 });
    expect(await logById(email)).toMatchObject({ status: "pending", attempts: 0, last_error: null });
    expect(await logById(ata)).toMatchObject({ status: "pending", attempts: 0, last_error: null });
  });

  test("p_channels => '{email}' → 메일 행만. 문자 행의 attempts 는 그대로", async () => {
    await wipeLogs();
    const sms = await smsRow();
    const email = await emailRow();

    const claimed = await rpc(FN, { p_limit: 10, p_channels: ["email"] });
    expect((claimed.body as { id: number }[]).map((r) => r.id)).toEqual([email]);
    expect(await logById(email)).toMatchObject({ attempts: 1 });
    expect(await logById(sms)).toMatchObject({ attempts: 0 });
  });

  test("여러 채널을 주면 그만큼 집는다", async () => {
    await wipeLogs();
    const sms = await smsRow();
    const email = await emailRow();
    const ata = await alimtalkRow();
    const claimed = await rpc(FN, { p_limit: 10, p_channels: ["sms", "email"] });
    expect((claimed.body as { id: number }[]).map((r) => r.id).sort((a, b) => a - b)).toEqual([sms, email].sort((a, b) => a - b));
    expect(await logById(ata)).toMatchObject({ attempts: 0 });
  });

  test("p_channels => null → 전 채널(0005 와 같은 구 동작) — 롤백·구버전 워커가 살아 있다", async () => {
    await wipeLogs();
    const sms = await smsRow();
    const email = await emailRow();
    const claimed = await rpc(FN, { p_limit: 10, p_channels: null });
    expect((claimed.body as { id: number }[]).map((r) => r.id).sort((a, b) => a - b)).toEqual([sms, email].sort((a, b) => a - b));
  });

  test("p_channels => '{}' (빈 배열) → **0행**. 전 채널이 아니다 — 아무 행의 attempts 도 오르지 않는다", async () => {
    await wipeLogs();
    const sms = await smsRow();
    const email = await emailRow();
    const claimed = await rpc(FN, { p_limit: 10, p_channels: [] });
    expect(claimed.body).toEqual([]);
    expect(await logById(sms)).toMatchObject({ attempts: 0 });
    expect(await logById(email)).toMatchObject({ attempts: 0 });
  });

  test("1-인자 호출(p_limit 만)은 여전히 동작하고 **모호하지 않다** — 구버전 함수는 drop 됐고 기본값이 받는다", async () => {
    await wipeLogs();
    const sms = await smsRow();
    const email = await emailRow();
    const claimed = await rpc(FN, { p_limit: 10 });
    expect(claimed.status, `모호(42725) 하면 여기서 300번대·400번대가 온다: ${JSON.stringify(claimed.body)}`).toBe(200);
    expect((claimed.body as { id: number }[]).map((r) => r.id).sort((a, b) => a - b)).toEqual([sms, email].sort((a, b) => a - b));
  });

  test("anon 은 이 RPC 를 부를 수 없다 — drop 이 지운 ACL 을 다시 잠갔다", async () => {
    const res = await fetch(`${env.restRoot}/rpc/${FN}`, {
      method: "POST",
      headers: { apikey: env.anonKey as string, Authorization: `Bearer ${env.anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_limit: 1, p_channels: ["sms"] }),
    });
    expect([401, 403, 404]).toContain(res.status);
  });

  // ── 워커 배선 ───────────────────────────────────────────────────────────
  test("supabaseWorkerDb.claimPending 이 sender 의 채널을 RPC 로 그대로 넘긴다 (호출부와 함수가 맞는가)", async () => {
    await wipeLogs();
    const sms = await smsRow();
    const email = await emailRow();
    const db = supabaseWorkerDb(serviceClient);

    const onlySms = await db.claimPending(10, ["sms"]);
    expect(onlySms.map((r) => r.id)).toEqual([sms]);
    expect(await logById(email)).toMatchObject({ attempts: 0 });

    const onlyEmail = await db.claimPending(10, ["email"]);
    expect(onlyEmail.map((r) => r.id)).toEqual([email]);
  });

  // ── 회귀: 고치기 전 → 고친 뒤 ───────────────────────────────────────────
  describe("회귀 — 사장님 알림이 죽던 경로", () => {
    /** 고치기 전의 발송기 DB 포트: claim 에 채널을 넘기지 않는다(0005 그대로 = 전 채널). */
    function legacyWorkerDb(client: SupabaseClient): WorkerDb {
      const real = supabaseWorkerDb(client);
      return { ...real, claimPending: (limit: number) => claimPending(limit, client) };
    }

    const runOnce = (db: WorkerDb, sender: NotificationSender) =>
      runNotificationWorker({ dryRun: false, limit: 10 }, { db, sender, now: () => new Date(), log: () => {} });

    test("고치기 전 — 채널을 안 가리면 메일 행이 문자 어댑터에 끌려가 5회를 태우고 failed 로 종착한다", async () => {
      await wipeLogs();
      const sms = await smsRow();
      const email = await emailRow();
      const db = legacyWorkerDb(serviceClient);
      const sender = smsOnlySender();

      const attemptsSeen: number[] = [];
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await makeDue();
        await runOnce(db, sender);
        attemptsSeen.push((await logById(email)).attempts);
      }

      // 문자는 나갔고
      expect(await logById(sms)).toMatchObject({ status: "sent" });
      // 사장님 알림은 매 회 끌려가 attempts 를 태우다 종착했다
      expect(attemptsSeen).toEqual([1, 2, 3, 4, 5]);
      expect(await logById(email)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, last_error: "unsupported_channel:email" });
    });

    test("고친 뒤 — 문자 sender 만 구성되면 메일 행은 **집히지 않는다**: pending 유지 · attempts 0 · last_error 없음", async () => {
      await wipeLogs();
      const sms = await smsRow();
      const email = await emailRow();
      const db = supabaseWorkerDb(serviceClient);
      const sender = routingSender({ sms: smsOnlySender() });
      expect(sender.channels).toEqual(["sms"]);

      let lastReport = await runOnce(db, sender);
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await makeDue();
        lastReport = await runOnce(db, sender);
      }

      expect(await logById(sms)).toMatchObject({ status: "sent" });
      expect(await logById(email)).toMatchObject({ status: "pending", attempts: 0, last_error: null });
      // 보고서가 "보낼 수 없는 행이 남아 있다"를 드러낸다 — 조용히 사라지지 않는다
      expect(lastReport.pending).toBeGreaterThanOrEqual(1);
      expect(lastReport.channels).toEqual(["sms"]);
    });

    test("메일 키가 오면 그 행이 그대로 나간다 — 태우지 않고 남겨 둔 attempts 덕분이다", async () => {
      await wipeLogs();
      await smsRow();
      const email = await emailRow();
      const db = supabaseWorkerDb(serviceClient);

      // 1) 문자만 구성된 동안 다섯 번 돈다
      const smsOnly = routingSender({ sms: smsOnlySender() });
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await makeDue();
        await runOnce(db, smsOnly);
      }
      expect(await logById(email)).toMatchObject({ status: "pending", attempts: 0 });

      // 2) 메일 키가 들어온다
      const mail = resendSender({
        apiKey: "re_TESTKEY",
        from: "no-reply@send.example.test",
        fetch: async () => new Response(JSON.stringify({ id: "mail-1" }), { status: 200, headers: { "content-type": "application/json" } }),
        log: () => {},
        vars: varsPort,
      });
      const both = routingSender({ sms: smsOnlySender(), email: mail });
      expect(both.channels).toEqual(["sms", "email"]);

      await makeDue();
      const report = await runOnce(db, both);
      expect(report.sent).toBeGreaterThanOrEqual(1);
      expect(await logById(email)).toMatchObject({ status: "sent", attempts: 1 });
    });
  });
});

// =============================================================================
// 3. 채널 목록의 형태 — 타입과 DB CHECK 가 같은 낱말을 쓴다
// =============================================================================
// 2-B. 권한 실측 — pg_catalog 를 직접 본다 (notifications_log 행을 건드리지 않으므로 잠금 밖에 둔다)
//      runLocalSql 은 supabase CLI 프로세스를 띄운다 — 이 PC 실측 호출당 약 12초라 제한시간을 넉넉히 준다.
// =============================================================================
describe.skipIf(!gate.allowed)("2-B. DB — claim RPC 실행 권한 실측 (로컬 스택)", { timeout: 300_000 }, () => {
  /**
   * ACL 을 pg_proc 에서 직접 본다 — REST 401/403 보다 한 겹 아래다.
   *
   * 근거(2026-09-16 로컬 실측): 이 DB 에는
   *   `alter default privileges for role postgres in schema public grant all on functions to anon, authenticated;`
   * 가 걸려 있다. 그래서 함수를 **새로 만들면**(drop 뒤 create, 또는 첫 create) EXECUTE 가 공개 롤에게
   * **자동으로 부여된다** — 같은 실험에서 drop+create 직후 anon=t·authenticated=t·PUBLIC(`=X/`) 이 찍혔고,
   * revoke 뒤 사라졌다. 즉 "빠뜨려서 남는" 것이 아니라 "적극적으로 주어지는" 권한이다.
   * 그대로 두면 공개 롤이 아웃박스 큐를 변경하고(attempts +1 · lease) 수신처가 든 행을 돌려받을 수 있다.
   * 앞으로 누가 이 함수를 다시 만들더라도 여기서 잡힌다.
   *
   * (`create or replace` 는 **이미 있는** 함수의 ACL 은 보존한다 — 그래서 위험한 순간은 첫 적용과 drop 직후다.
   *  원격 DB 에는 2-인자 함수가 아직 없으므로 컨트롤러의 적용이 바로 그 "첫 적용" 이다.)
   */
  test("pg_proc ACL — EXECUTE 보유자는 service_role 뿐이고 1-인자 구버전은 없다 (기본권한이 되돌려 놓는 것을 회수했는가)", () => {
    const verdict = runLocalSql(
      "select 'acl_check=' || " +
        "case when has_function_privilege('anon', p.oid, 'execute') then 'anon_has_execute ' else '' end || " +
        "case when has_function_privilege('authenticated', p.oid, 'execute') then 'authenticated_has_execute ' else '' end || " +
        "case when not has_function_privilege('service_role', p.oid, 'execute') then 'service_role_missing ' else '' end || " +
        "case when p.proacl::text ~ '(^\\{|,)=X/' then 'public_has_execute ' else '' end || " +
        "case when to_regprocedure('public.claim_pending_notifications(int)') is not null then 'old_1arg_present ' else '' end || " +
        "'END' as verdict from pg_proc p where p.oid = to_regprocedure('public.claim_pending_notifications(int, text[])')",
    );
    expect(verdict, "2-인자 함수를 찾지 못했다면 0014 가 적용되지 않은 DB 다").toContain("acl_check=");
    expect(verdict.replace(/\s+/g, " ")).toContain("acl_check=END");
  });
});

// =============================================================================
describe("3. 채널 낱말", () => {
  test("0005 의 channel CHECK 와 NotifyChannel 이 같다", () => {
    const outbox = compact(stripSqlComments(readSql(path.join(MIGRATIONS_DIR, "0005_outbox.sql"))));
    const channels: NotifyChannel[] = ["sms", "alimtalk", "email"];
    expect(outbox).toContain(`check (channel in (${channels.map((c) => `'${c}'`).join(", ")}))`);
  });
});

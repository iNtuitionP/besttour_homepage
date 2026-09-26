/**
 * P1-4 — 0005 통지 아웃박스 + lib/notify/outbox.ts 계약 테스트 (플랜 v4 · ADR-7).
 *
 * 브리프 §검증 1~5 를 그대로 단언한다:
 *   1. 0005_outbox.sql 텍스트 — pending 포함 CHECK, 부분 유니크(where status = 'sent'), 컬럼, channel 에 email,
 *      claim 함수의 for update skip locked + security definer + anon 실행 권한 회수
 *   2. 0005_outbox.down.sql — 함수·인덱스·컬럼 제거, CHECK 를 ('sent','failed') 로 복원
 *   3. planNotifications — created 2건 / owner email 폴백 / owner 생략 + warning / confirmed 1건 / 번호 그대로 통과
 *   4. nextAttemptDecision·retryPlanAfterFailure — 고정 시각 주입. 백오프 1m·5m·30m·2h·12h, 5회 give_up
 *   5. DB — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만: sent 중복 insert 실패 / failed 후 sent 성공 / claim 2회 겹침 0
 *      원격이면 skip 을 가드 테스트로 단언한다
 *
 * 이 파일에는 Solapi 호출도, 문자 문안도 없다(P4). template 컬럼에는 키만 들어간다.
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  BACKOFF_MS,
  CLAIM_LEASE_MS,
  MAX_ATTEMPTS,
  TEMPLATE_KEYS,
  claimPending,
  enqueue,
  markFailed,
  markSent,
  nextAttemptDecision,
  planNotifications,
  retryPlanAfterFailure,
} from "@/lib/notify/outbox";
import { consentFields } from "@/lib/reservations/consent";
import type { NewOutboxRow, OutboxRow } from "@/lib/types";
import { withNotificationsLock } from "./helpers/db-lock";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const ROLLBACKS_DIR = path.join(ROOT, "supabase", "rollbacks");
const UP_SQL_PATH = path.join(MIGRATIONS_DIR, "0005_outbox.sql");
const DOWN_SQL_PATH = path.join(ROLLBACKS_DIR, "0005_outbox.down.sql");
const INIT_SQL_PATH = path.join(MIGRATIONS_DIR, "0001_init.sql");
const LIB_PATH = path.join(ROOT, "lib", "notify", "outbox.ts");

const NEW_COLUMNS = ["attempts", "last_error", "updated_at", "next_attempt_at"] as const;
const FUNCTIONS = ["claim_pending_notifications", "mark_notification_sent", "mark_notification_failed"] as const;

const MINUTE = 60_000;
const readSql = (p: string) => readFileSync(p, "utf-8");
const compact = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

const RID = "00000000-0000-4000-8000-000000000001";
const reservation = { id: RID };

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 1,
    reservation_id: RID,
    event: "created",
    channel: "sms",
    to: "01012345678",
    template: "created.customer.sms",
    status: "pending",
    attempts: 0,
    last_error: null,
    next_attempt_at: "2026-09-11T00:00:00.000Z",
    updated_at: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

// =============================================================================
// 1. 0005_outbox.sql 텍스트
// =============================================================================
describe("supabase/migrations/0005_outbox.sql", () => {
  test("존재하고, 0005 번호는 이 파일 하나뿐이다. 0001~0004 는 손대지 않았다(아웃박스 컬럼이 0001 에 없다)", () => {
    expect(existsSync(UP_SQL_PATH)).toBe(true);
    expect(readdirSync(MIGRATIONS_DIR).filter((f) => /^0005_/.test(f))).toEqual(["0005_outbox.sql"]);
    const init = readSql(INIT_SQL_PATH);
    for (const col of NEW_COLUMNS) expect(init, col).not.toContain(col);
    expect(init).not.toContain("pending");
  });

  test("컬럼 — attempts int not null default 0 · last_error text · updated_at/next_attempt_at timestamptz not null default now()", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toMatch(/add column attempts int not null default 0/);
    expect(code).toMatch(/add column last_error text\s*[,;]/);
    expect(code).toMatch(/add column updated_at timestamptz not null default now\(\)/);
    expect(code).toMatch(/add column next_attempt_at timestamptz not null default now\(\)/);
  });

  test("status CHECK — 기존 익명 CHECK 를 pg_constraint 에서 정의문으로 찾아 drop 하고 pending 을 포함해 다시 건다", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toContain("from pg_constraint");
    expect(code).toContain("pg_get_constraintdef(con.oid)");
    expect(code).toContain("drop constraint %i");
    expect(code).toContain("check (status in ('pending', 'sent', 'failed'))");
    // event CHECK 는 건드리지 않는다
    expect(code).not.toMatch(/check \(event in/);
  });

  test("channel CHECK — email 추가 (P4-4/P4-5 폴백 메일이 같은 아웃박스를 쓴다)", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toContain("check (channel in ('sms', 'alimtalk', 'email'))");
  });

  test("부분 유니크 인덱스 — 같은 (reservation_id, event, channel, template) 로 sent 는 한 번만. template 이 없으면 created 의 사장님/고객 SMS 가 서로 막는다", () => {
    const raw = readSql(UP_SQL_PATH);
    const code = compact(stripComments(raw, UP_SQL_PATH));
    expect(code).toContain(
      "create unique index if not exists notifications_log_sent_once on notifications_log (reservation_id, event, channel, template) where status = 'sent'",
    );
    expect(raw.split("\n").filter((l) => /^\s*--/.test(l)).join("\n")).toMatch(/template 이 키에 들어가는 이유/);
  });

  test("pending 인덱스 — 발송기가 집어갈 행을 빨리 찾는다", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toContain(
      "create index if not exists notifications_log_pending on notifications_log (created_at) where status = 'pending'",
    );
  });

  test("claim 함수 — security definer · for update skip locked · 같은 문장에서 lease 를 찍어 두 번째 호출이 같은 행을 못 잡게 한다", () => {
    const raw = readSql(UP_SQL_PATH);
    const code = compact(stripComments(raw, UP_SQL_PATH));
    expect(code).toContain("create or replace function claim_pending_notifications(p_limit int");
    expect(code).toContain("for update skip locked");
    expect(code).toMatch(/security definer/);
    expect(code).toContain("set search_path = public");
    // 잠금은 함수 트랜잭션이 끝나면 풀린다 — select 만으로는 두 번째 호출이 같은 행을 다시 본다. update 가 같은 문장에 있어야 한다.
    expect(code).toMatch(/update notifications_log n set attempts = n\.attempts \+ 1/);
    expect(code).toContain("status = 'pending' and next_attempt_at <= now()");
    // 최대 시도 횟수는 TS 상수와 같은 숫자여야 한다 (한쪽만 바꾸면 여기서 빨간불)
    expect(code).toContain(`attempts < ${MAX_ATTEMPTS}`);
    // 주석에 skip locked 를 쓰는 이유가 있다
    expect(raw).toMatch(/skip locked/i);
    expect(raw.split("\n").filter((l) => /^\s*--/.test(l)).join("\n")).toMatch(/동시|경합|두 개/);
  });

  test("mark 함수 2개 — sent 는 unique_violation 을 duplicate_sent 로 흡수, failed 는 give_up 이면 status failed", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    expect(code).toContain("create or replace function mark_notification_sent(p_id bigint, p_provider_message_id text)");
    expect(code).toContain("when unique_violation then");
    expect(code).toContain("last_error = 'duplicate_sent'");
    expect(code).toContain(
      "create or replace function mark_notification_failed(p_id bigint, p_error text, p_give_up boolean, p_retry_after_ms bigint)",
    );
  });

  test("security definer 함수는 anon·authenticated 가 RPC 로 부를 수 없다 — execute 권한 회수 + service_role 에만 부여", () => {
    const code = compact(stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH));
    for (const fn of FUNCTIONS) {
      expect(code, fn).toMatch(new RegExp(`revoke (all|execute) on function ${fn}\\([^)]*\\) from public, anon, authenticated`));
      expect(code, fn).toMatch(new RegExp(`grant execute on function ${fn}\\([^)]*\\) to service_role`));
    }
  });

  test("기존 행 가드가 없고, 그 이유가 주석에 있다 (컬럼에 전부 default 가 있어 기존 행이 있어도 안전)", () => {
    const raw = readSql(UP_SQL_PATH);
    const code = stripComments(raw, UP_SQL_PATH);
    expect(code).not.toMatch(/raise\s+exception/i);
    expect(raw.split("\n").filter((l) => /^\s*--/.test(l)).join("\n")).toMatch(/가드/);
  });
});

// =============================================================================
// 2. 0005_outbox.down.sql
// =============================================================================
describe("supabase/rollbacks/0005_outbox.down.sql", () => {
  test("migrations/ 안에는 CLI 패턴에 걸리는 롤백 파일이 없고, rollbacks/ 에 0005 롤백이 있다", () => {
    const stray = readdirSync(MIGRATIONS_DIR).filter(
      (f) => /^[0-9]+_.*\.sql$/.test(f) && /\.down\.sql$|rollback/i.test(f),
    );
    expect(stray).toEqual([]);
    expect(existsSync(DOWN_SQL_PATH)).toBe(true);
  });

  test("함수 3개·인덱스 2개·컬럼 4개 제거, CHECK 를 ('sent','failed') / ('sms','alimtalk') 로 복원", () => {
    const code = compact(stripComments(readSql(DOWN_SQL_PATH), DOWN_SQL_PATH));
    for (const fn of FUNCTIONS) expect(code, fn).toContain(`drop function if exists ${fn}(`);
    expect(code).toContain("drop index if exists notifications_log_sent_once");
    expect(code).toContain("drop index if exists notifications_log_pending");
    for (const col of NEW_COLUMNS) expect(code, col).toContain(`drop column if exists ${col}`);
    expect(code).toContain("check (status in ('sent', 'failed'))");
    expect(code).toContain("check (channel in ('sms', 'alimtalk'))");
  });

  test("pending·email 행이 남아 있으면 멈춘다 — 복원 CHECK 가 그 행 때문에 실패하기 전에 사람이 알게", () => {
    const code = stripComments(readSql(DOWN_SQL_PATH), DOWN_SQL_PATH);
    const iGuard = code.search(/status\s*=\s*'pending'\s+or\s+channel\s*=\s*'email'/i);
    const iRaise = code.search(/raise\s+exception/i);
    const iDrop = code.search(/drop\s+column/i);
    expect(iGuard).toBeGreaterThan(-1);
    expect(iRaise).toBeGreaterThan(iGuard);
    expect(iDrop).toBeGreaterThan(iRaise);
  });
});

// =============================================================================
// 3. planNotifications — 순수
// =============================================================================
describe("planNotifications", () => {
  const customer = "010-1234-5678";
  const owner = "010-9999-0000";

  test("created → 사장님 SMS + 고객 SMS 2건. 번호는 그대로 통과(마스킹은 표시 계층)", () => {
    const { rows, warnings } = planNotifications(reservation, "created", { ownerPhone: owner, customerPhone: customer });
    expect(warnings).toEqual([]);
    expect(rows).toEqual<NewOutboxRow[]>([
      { reservation_id: RID, event: "created", channel: "sms", to: owner, template: "created.owner.sms" },
      { reservation_id: RID, event: "created", channel: "sms", to: customer, template: "created.customer.sms" },
    ]);
  });

  test("created · ownerPhone 없고 ownerEmail 있으면 사장님 건은 email 채널", () => {
    const { rows, warnings } = planNotifications(reservation, "created", {
      ownerEmail: "owner@example.com",
      customerPhone: customer,
    });
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      reservation_id: RID,
      event: "created",
      channel: "email",
      to: "owner@example.com",
      template: "created.owner.email",
    });
    expect(rows[1].channel).toBe("sms");
  });

  test("created · 둘 다 없으면 고객 1건만 + warning (조용히 넘어가지 않는다)", () => {
    const { rows, warnings } = planNotifications(reservation, "created", { customerPhone: customer });
    expect(rows).toHaveLength(1);
    expect(rows[0].template).toBe("created.customer.sms");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/owner/i);
  });

  test("빈 문자열 ownerPhone 은 없는 것으로 본다 (env 가 빈 값으로 들어오는 흔한 사고)", () => {
    const { rows } = planNotifications(reservation, "created", { ownerPhone: "  ", ownerEmail: "o@x.kr", customerPhone: customer });
    expect(rows[0].channel).toBe("email");
  });

  test("confirmed → 고객 1건 (사장님 건 없음)", () => {
    const { rows, warnings } = planNotifications(reservation, "confirmed", { ownerPhone: owner, customerPhone: customer });
    expect(warnings).toEqual([]);
    expect(rows).toEqual<NewOutboxRow[]>([
      { reservation_id: RID, event: "confirmed", channel: "sms", to: customer, template: "confirmed.customer.sms" },
    ]);
  });

  test("customerPhone 이 비면 throw — 고객 통지 없는 접수는 프로그래밍 오류다", () => {
    expect(() => planNotifications(reservation, "created", { customerPhone: "" })).toThrow(/customerPhone/);
  });

  test("template 은 키뿐이다 — TEMPLATE_KEYS 에 등록된 값만 나오고, 문안(한글 문장)은 없다", () => {
    const all = [
      ...planNotifications(reservation, "created", { ownerPhone: owner, customerPhone: customer }).rows,
      ...planNotifications(reservation, "created", { ownerEmail: "o@x.kr", customerPhone: customer }).rows,
      ...planNotifications(reservation, "confirmed", { customerPhone: customer }).rows,
    ];
    for (const r of all) {
      expect(TEMPLATE_KEYS).toContain(r.template);
      expect(r.template).toMatch(/^(created|confirmed)\.(owner|customer)\.(sms|alimtalk|email)$/);
    }
    expect(new Set(TEMPLATE_KEYS).size).toBe(TEMPLATE_KEYS.length);
  });
});

// =============================================================================
// 4. 재시도 판정 — 고정 시각 주입
// =============================================================================
describe("nextAttemptDecision / retryPlanAfterFailure", () => {
  const T0 = new Date("2026-09-11T00:00:00.000Z");
  const at = (ms: number) => new Date(T0.getTime() + ms);

  // P4-7: 첫 칸 1m → 10s. 크론이 하루 1회가 되면서 첫 실패의 재시도는 즉시 발송 호출 안에서 이 백오프만큼 기다렸다 한다
  // (lib/notify/inline.ts INLINE_RETRY_DELAY_MS ≥ BACKOFF_MS[0] 은 tests/notify-inline.test.ts 가 잠근다).
  test("상수 — 최대 5회, 백오프 10s·5m·30m·2h·12h, lease 는 첫 백오프보다 길다", () => {
    expect(MAX_ATTEMPTS).toBe(5);
    expect([...BACKOFF_MS]).toEqual([10_000, 5 * MINUTE, 30 * MINUTE, 120 * MINUTE, 720 * MINUTE]);
    expect(CLAIM_LEASE_MS).toBeGreaterThan(BACKOFF_MS[0]);
  });

  test("attempts 0 · next_attempt_at 도래 → send", () => {
    expect(nextAttemptDecision(row({ attempts: 0, next_attempt_at: T0.toISOString() }), T0)).toBe("send");
  });

  test("실패 1회 후 백오프(10s) 전 → wait, 도래 후 → send", () => {
    const failedAt = T0;
    const plan = retryPlanAfterFailure(1);
    expect(plan).toEqual({ giveUp: false, retryAfterMs: 10_000 });
    const next = at(plan.giveUp ? 0 : plan.retryAfterMs).toISOString();
    const r = row({ attempts: 1, last_error: "x", next_attempt_at: next });
    expect(nextAttemptDecision(r, at(5_000))).toBe("wait");
    expect(nextAttemptDecision(r, at(10_000))).toBe("send");
    expect(nextAttemptDecision(r, at(2 * MINUTE))).toBe("send");
    expect(failedAt.getTime()).toBe(T0.getTime());
  });

  test("백오프 계단 — 2회 5m · 3회 30m · 4회 2h. 5회는 give_up", () => {
    expect(retryPlanAfterFailure(2)).toEqual({ giveUp: false, retryAfterMs: 5 * MINUTE });
    expect(retryPlanAfterFailure(3)).toEqual({ giveUp: false, retryAfterMs: 30 * MINUTE });
    expect(retryPlanAfterFailure(4)).toEqual({ giveUp: false, retryAfterMs: 120 * MINUTE });
    expect(retryPlanAfterFailure(5)).toEqual({ giveUp: true });
    expect(retryPlanAfterFailure(9)).toEqual({ giveUp: true });
  });

  test("attempts >= 5 → give_up (시각과 무관)", () => {
    expect(nextAttemptDecision(row({ attempts: 5, next_attempt_at: T0.toISOString() }), at(999 * MINUTE))).toBe("give_up");
    expect(nextAttemptDecision(row({ attempts: 7 }), T0)).toBe("give_up");
  });

  test("status 가 failed(확정)·sent 면 시도하지 않는다", () => {
    expect(nextAttemptDecision(row({ status: "failed", attempts: 2 }), at(999 * MINUTE))).toBe("give_up");
    expect(nextAttemptDecision(row({ status: "sent" }), at(999 * MINUTE))).toBe("give_up");
  });

  test("retryPlanAfterFailure(0) 은 throw — 실패 없이 재시도 계획을 묻는 것은 호출 오류", () => {
    expect(() => retryPlanAfterFailure(0)).toThrow();
  });
});

// =============================================================================
// 5-a. DB 어댑터 — 가짜 클라이언트로 호출 모양을 고정 (네트워크 없음)
// =============================================================================
type Call = { kind: "rpc"; fn: string; args: unknown } | { kind: "select" | "insert"; table: string; payload: unknown; filters: unknown[] };

function fakeClient(responses: { data: unknown; error: { code?: string; message: string } | null }[]) {
  const calls: Call[] = [];
  const next = () => {
    const r = responses.shift();
    if (!r) throw new Error("fakeClient: 준비된 응답이 없다");
    return Promise.resolve(r);
  };
  const client = {
    rpc(fn: string, args: unknown) {
      calls.push({ kind: "rpc", fn, args });
      return next();
    },
    from(table: string) {
      const filters: unknown[] = [];
      const pending: Call = { kind: "select", table, payload: undefined, filters };
      const builder = {
        select(cols: string) {
          if (pending.kind === "select") pending.payload = cols;
          return builder;
        },
        in(col: string, vals: unknown[]) {
          filters.push([col, vals]);
          return builder;
        },
        insert(rows: unknown) {
          pending.kind = "insert";
          pending.payload = rows;
          return builder;
        },
        then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
          calls.push(pending);
          return next().then(onOk, onErr);
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("DB 어댑터 (가짜 클라이언트)", () => {
  const rows: NewOutboxRow[] = [
    { reservation_id: RID, event: "created", channel: "sms", to: "010", template: "created.owner.sms" },
    { reservation_id: RID, event: "created", channel: "sms", to: "011", template: "created.customer.sms" },
  ];

  test("enqueue — pending 으로 insert, to → to_phone 로 매핑, 반환은 id 배열", async () => {
    const { client, calls } = fakeClient([
      { data: [], error: null },
      { data: [{ id: 10 }, { id: 11 }], error: null },
    ]);
    await expect(enqueue(rows, client)).resolves.toEqual([10, 11]);
    expect(calls[1].kind).toBe("insert");
    const inserted = (calls[1] as { payload: unknown }).payload as Record<string, unknown>[];
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toEqual({
      reservation_id: RID,
      event: "created",
      channel: "sms",
      to_phone: "010",
      template: "created.owner.sms",
      status: "pending",
    });
    expect(inserted[0]).not.toHaveProperty("to");
  });

  test("enqueue — 같은 (reservation, event, channel) 에 이미 pending/sent 가 있으면 그 건은 건너뛴다 (이미 보냈거나 보낼 예정)", async () => {
    const { client, calls } = fakeClient([
      { data: [{ reservation_id: RID, event: "created", channel: "sms", template: "created.owner.sms" }], error: null },
      { data: [{ id: 12 }], error: null },
    ]);
    await expect(enqueue(rows, client)).resolves.toEqual([12]);
    const inserted = (calls[1] as { payload: unknown }).payload as Record<string, unknown>[];
    expect(inserted.map((r) => r.template)).toEqual(["created.customer.sms"]);
  });

  test("enqueue — 전부 이미 있으면 insert 를 호출하지 않고 [] 를 돌려준다", async () => {
    const { client, calls } = fakeClient([
      {
        data: [
          { reservation_id: RID, event: "created", channel: "sms", template: "created.owner.sms" },
          { reservation_id: RID, event: "created", channel: "sms", template: "created.customer.sms" },
        ],
        error: null,
      },
    ]);
    await expect(enqueue(rows, client)).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  test("enqueue — 빈 배열은 DB 를 건드리지 않는다", async () => {
    const { client, calls } = fakeClient([]);
    await expect(enqueue([], client)).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  test("enqueue — DB 오류는 throw (조용히 사라지지 않는다 — ADR-7 의 요지)", async () => {
    const { client } = fakeClient([{ data: null, error: { code: "42P01", message: "boom" } }]);
    await expect(enqueue(rows, client)).rejects.toThrow(/boom/);
  });

  test("claimPending — RPC claim_pending_notifications(p_limit, p_channels), 행은 OutboxRow(to) 로 변환", async () => {
    const dbRow = {
      id: 5,
      reservation_id: RID,
      event: "created",
      channel: "sms",
      to_phone: "010",
      template: "created.owner.sms",
      status: "pending",
      provider_message_id: null,
      error: null,
      created_at: "2026-09-11T00:00:00+00:00",
      attempts: 1,
      last_error: null,
      updated_at: "2026-09-11T00:00:00+00:00",
      next_attempt_at: "2026-09-11T00:05:00+00:00",
    };
    const { client, calls } = fakeClient([{ data: [dbRow], error: null }]);
    const claimed = await claimPending(3, client);
    // P4-5(0014): 채널을 생략하면 p_channels=null 로 나간다 — 0005 와 같은 전 채널 동작이다.
    expect(calls[0]).toEqual({ kind: "rpc", fn: "claim_pending_notifications", args: { p_limit: 3, p_channels: null } });
    expect(claimed).toEqual<OutboxRow[]>([
      {
        id: 5,
        reservation_id: RID,
        event: "created",
        channel: "sms",
        to: "010",
        template: "created.owner.sms",
        status: "pending",
        attempts: 1,
        last_error: null,
        updated_at: "2026-09-11T00:00:00+00:00",
        next_attempt_at: "2026-09-11T00:05:00+00:00",
      },
    ]);

    // 채널을 주면 그대로 배열로 실어 보낸다. 빈 배열은 "전 채널" 이 아니라 **0행** 이다(0014 §2).
    const withChannels = fakeClient([{ data: [], error: null }]);
    await claimPending(3, withChannels.client, ["sms"]);
    expect(withChannels.calls[0]).toEqual({ kind: "rpc", fn: "claim_pending_notifications", args: { p_limit: 3, p_channels: ["sms"] } });

    const empty = fakeClient([{ data: [], error: null }]);
    await claimPending(3, empty.client, []);
    expect(empty.calls[0]).toEqual({ kind: "rpc", fn: "claim_pending_notifications", args: { p_limit: 3, p_channels: [] } });
  });

  test("markSent — RPC mark_notification_sent, boolean 반환(false = 이미 다른 행이 sent → duplicate_sent 로 처리됨)", async () => {
    const { client, calls } = fakeClient([{ data: true, error: null }, { data: false, error: null }]);
    await expect(markSent(5, "MSG-1", client)).resolves.toBe(true);
    await expect(markSent(6, "MSG-2", client)).resolves.toBe(false);
    expect(calls[0]).toEqual({ kind: "rpc", fn: "mark_notification_sent", args: { p_id: 5, p_provider_message_id: "MSG-1" } });
  });

  test("markFailed — attempts 로 재시도 계획을 계산해 RPC 에 넘긴다 (1회 → 10s 뒤, 5회 → give_up)", async () => {
    const { client, calls } = fakeClient([{ data: null, error: null }, { data: null, error: null }]);
    await markFailed({ id: 5, attempts: 1 }, "timeout", client);
    await markFailed({ id: 6, attempts: 5 }, "timeout", client);
    expect(calls[0]).toEqual({
      kind: "rpc",
      fn: "mark_notification_failed",
      args: { p_id: 5, p_error: "timeout", p_give_up: false, p_retry_after_ms: 10_000 },
    });
    expect(calls[1]).toEqual({
      kind: "rpc",
      fn: "mark_notification_failed",
      args: { p_id: 6, p_error: "timeout", p_give_up: true, p_retry_after_ms: 0 },
    });
  });

  test("markFailed — 오류 문자열은 2000자로 자른다 (Solapi 응답 덤프가 통째로 들어오는 사고 방지)", async () => {
    const { client, calls } = fakeClient([{ data: null, error: null }]);
    await markFailed({ id: 5, attempts: 1 }, "x".repeat(5000), client);
    const args = (calls[0] as Extract<Call, { kind: "rpc" }>).args as { p_error: string };
    expect(args.p_error).toHaveLength(2000);
  });

  test("lib/notify/outbox.ts 에 'use server'·server-only 가 없고 solapi import 도 없다 (lib 순수 모듈 — P3 서버액션이 호출)", () => {
    const src = readFileSync(LIB_PATH, "utf-8");
    expect(src).not.toMatch(/^\s*["']use server["'];?\s*$/m);
    expect(src).not.toMatch(/from\s+["']solapi["']/);
    expect(src).not.toMatch(/import\s+["']server-only["']/);
  });
});

// =============================================================================
// 5-b. DB — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만 (원격 notifications_log 에는 어떤 쓰기도 하지 않는다)
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[outbox.test] DB 실증 블록 skip — ${gate.reason}`);
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

describe.skipIf(!gate.allowed || !env.hasServiceRole)("DB — 0005 아웃박스 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)", () => {
  // claim 은 테이블 전체를 집어간다 — 같은 테이블에 pending 을 남기는 다른 파일과 겹치면 서로의 행을 먹는다.
  // 맨 위에서 잡아 이 블록의 정리가 끝난 뒤 풀리게 한다 (tests/helpers/db-lock.ts).
  withNotificationsLock();

  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const TEST_PREFIX = "p14test-";
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
  const rpc = (fn: string, args: Record<string, unknown>) => rest("POST", `/rpc/${fn}`, args);
  const errorOf = (r: RestResult) => (r.body ?? {}) as { code?: string; message?: string };

  async function insertLog(overrides: Record<string, unknown>): Promise<RestResult> {
    return rest(
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
  }
  async function wipeLogs() {
    await rest("DELETE", `/notifications_log?reservation_id=eq.${reservationId}`);
  }
  async function logsByStatus(status: string) {
    const r = await rest("GET", `/notifications_log?select=id,status,attempts,last_error&reservation_id=eq.${reservationId}&status=eq.${status}&order=id`);
    return r.body as { id: number; status: string; attempts: number; last_error: string | null }[];
  }

  beforeAll(async () => {
    const probe = await rest("GET", "/notifications_log?select=attempts,next_attempt_at&limit=0");
    if (probe.status !== 200) {
      throw new Error(
        `0005_outbox.sql 이 이 DB(${process.env.NEXT_PUBLIC_SUPABASE_URL})에 적용되지 않은 것으로 보인다 — HTTP ${probe.status}: ${JSON.stringify(probe.body).slice(0, 200)}`,
      );
    }
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
        ...consentFields({ privacyConsent: true, marketingConsent: false, withdrawalConsent: true }, now),
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

  test("같은 (reservation, event, channel) 로 sent 2회 insert → 두 번째는 409 · 23505 (notifications_log_sent_once)", async () => {
    await wipeLogs();
    const first = await insertLog({ status: "sent" });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await insertLog({ status: "sent" });
    expect(second.status).toBe(409);
    expect(errorOf(second).code).toBe("23505");
    expect(errorOf(second).message).toContain("notifications_log_sent_once");
  });

  test("같은 예약·이벤트·채널이라도 template 이 다르면(사장님/고객) 둘 다 sent 가 된다", async () => {
    await wipeLogs();
    expect((await insertLog({ status: "sent", template: "created.owner.sms" })).status).toBe(201);
    expect((await insertLog({ status: "sent", template: "created.customer.sms" })).status).toBe(201);
  });

  test("failed 뒤 같은 키로 sent insert → 성공 (실패건은 재발송 허용). pending 도 sent 와 공존한다", async () => {
    await wipeLogs();
    expect((await insertLog({ status: "failed", attempts: 1, last_error: "x" })).status).toBe(201);
    expect((await insertLog({ status: "sent" })).status).toBe(201);
    expect((await insertLog({ status: "pending" })).status).toBe(201);
  });

  test("status CHECK 는 pending 을 받고 다른 값은 거부한다. channel 은 email 을 받는다", async () => {
    await wipeLogs();
    const bad = await insertLog({ status: "sending" });
    expect(bad.status).toBe(400);
    expect(errorOf(bad).code).toBe("23514");
    const email = await insertLog({ channel: "email", to_phone: "owner@example.com", template: "created.owner.email" });
    expect(email.status, JSON.stringify(email.body)).toBe(201);
  });

  test("claim 2회 연속 → 겹치는 id 0. 잡힌 행은 attempts+1, lease 만큼 next_attempt_at 이 미래", async () => {
    await wipeLogs();
    for (let i = 0; i < 3; i++) expect((await insertLog({ template: `created.customer.sms` })).status).toBe(201);
    const a = await rpc("claim_pending_notifications", { p_limit: 2 });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const b = await rpc("claim_pending_notifications", { p_limit: 2 });
    const idsA = (a.body as { id: number }[]).map((r) => r.id);
    const idsB = (b.body as { id: number }[]).map((r) => r.id);
    // claim 은 테이블 전체가 대상이다 — 개수가 어긋나면 남의 행을 집어간 것이다. 어느 행인지 메시지에 남긴다.
    const foreign = "claim 결과에 이 파일 밖의 행이 섞였다 (notifications-log 잠금을 안 잡은 DB 블록이 있다): ";
    expect(idsA, foreign + JSON.stringify(a.body)).toHaveLength(2);
    expect(idsB, foreign + JSON.stringify(b.body)).toHaveLength(1);
    expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
    const c = await rpc("claim_pending_notifications", { p_limit: 2 });
    expect(c.body, foreign + JSON.stringify(c.body)).toEqual([]);
    const claimed = (a.body as { attempts: number; next_attempt_at: string; status: string }[])[0];
    expect(claimed.attempts).toBe(1);
    expect(claimed.status).toBe("pending");
    expect(new Date(claimed.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + CLAIM_LEASE_MS - 60 * MINUTE);
  });

  test("mark_notification_sent — pending → sent. 같은 키의 두 번째 행은 false 를 돌려주고 failed/duplicate_sent 가 된다", async () => {
    await wipeLogs();
    const r1 = (await insertLog({})).body as { id: number }[];
    const r2 = (await insertLog({})).body as { id: number }[];
    const ok = await rpc("mark_notification_sent", { p_id: r1[0].id, p_provider_message_id: "MSG-1" });
    expect(ok.body).toBe(true);
    const dup = await rpc("mark_notification_sent", { p_id: r2[0].id, p_provider_message_id: "MSG-2" });
    expect(dup.status, JSON.stringify(dup.body)).toBe(200);
    expect(dup.body).toBe(false);
    expect(await logsByStatus("sent")).toMatchObject([{ id: r1[0].id }]);
    expect(await logsByStatus("failed")).toMatchObject([{ id: r2[0].id, last_error: "duplicate_sent" }]);
  });

  test("mark_notification_failed — 재시도면 pending 유지 + next_attempt_at 뒤로, give_up 이면 failed", async () => {
    await wipeLogs();
    const r1 = (await insertLog({})).body as { id: number }[];
    const r2 = (await insertLog({ channel: "alimtalk" })).body as { id: number }[];
    await rpc("mark_notification_failed", { p_id: r1[0].id, p_error: "timeout", p_give_up: false, p_retry_after_ms: 60 * MINUTE });
    await rpc("mark_notification_failed", { p_id: r2[0].id, p_error: "dead", p_give_up: true, p_retry_after_ms: 0 });
    const pending = await logsByStatus("pending");
    expect(pending).toMatchObject([{ id: r1[0].id, last_error: "timeout" }]);
    expect(await logsByStatus("failed")).toMatchObject([{ id: r2[0].id, last_error: "dead" }]);
    // 백오프 중인 행은 claim 에 잡히지 않는다
    const c = await rpc("claim_pending_notifications", { p_limit: 10 });
    expect(c.body, `claim 결과에 이 파일 밖의 행이 섞였다: ${JSON.stringify(c.body)}`).toEqual([]);
  });

  test.skipIf(!env.anonKey)("anon 은 claim RPC 를 부를 수 없다 (security definer 함수의 execute 회수)", async () => {
    const res = await fetch(`${env.restRoot}/rpc/claim_pending_notifications`, {
      method: "POST",
      headers: { apikey: env.anonKey as string, Authorization: `Bearer ${env.anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_limit: 1 }),
    });
    expect([401, 403, 404]).toContain(res.status);
  });
});

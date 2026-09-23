/**
 * P1-5 — 개인정보 파기 배치 계약 테스트 (플랜 v4 · PIPA §21 · 전자상거래법 §6③).
 *
 * 브리프 §검증 1~5 를 그대로 단언한다:
 *   1. selectPurgeCandidates — 고정 시각 주입 판정표(상태×기간). 경계는 "초과만 purge". KST 자정 경계에서도 인스턴트 비교라 결과 동일
 *   2. purge — dry-run 이 기본값이라 delete 가 호출되지 않는다(mock). dryRun:false + limit 3 + 후보 10 → 3건만
 *   3. 라우트 — 시크릿 없음/틀림 → 401, 맞음 → dry-run 보고, `?dry=0` 일 때만 실삭제, 응답 본문에 개인정보 필드 0
 *   4. vercel.json — `/api/cron/purge` · `0 19 * * *`(= KST 04:00)
 *   5. DB — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만 실제 insert/purge. 원격이면 skip 을 단언한다
 *
 * 주의: 이 파일은 tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { PRIVACY_NOTICE } from "@/lib/legal/disclosures";
import { consentFields } from "@/lib/reservations/consent";
import {
  CONFIRMED_KEEP_YEARS,
  DEFAULT_PURGE_LIMIT,
  legalHoldUntil,
  purge,
  selectPurgeCandidates,
  supabasePurgeClient,
  type PurgeClient,
  type PurgeReport,
  type RetentionRow,
} from "@/lib/retention/purge";
import { dbSmokeEnv, dbWriteGate, isLocalStack } from "./helpers/load-env-local";

const ROOT = path.resolve(import.meta.dirname, "..");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 고정 "지금": KST 2026-09-12 00:00:00 = UTC 2026-09-11 15:00:00 — 자정 경계 케이스에 그대로 쓴다.
const NOW = new Date("2026-09-11T15:00:00.000Z");

function row(overrides: Partial<RetentionRow> & { id?: string } = {}): RetentionRow {
  return {
    id: overrides.id ?? randomUUID(),
    created_at: "2025-09-01T00:00:00.000Z",
    status: "new",
    retention_until: "2026-09-01T00:00:00.000Z",
    confirmed_at: null,
    ...overrides,
  };
}

function isoPlus(base: Date, ms: number): string {
  return new Date(base.getTime() + ms).toISOString();
}

// =============================================================================
// 1. selectPurgeCandidates — 판정표
// =============================================================================
describe("selectPurgeCandidates — 상태×기간 판정표 (고정 시각)", () => {
  const policy = { confirmedKeepYears: 5 } as const;

  test("미확정(new) · retention_until 경과 → purge", () => {
    const r = row({ status: "new", retention_until: isoPlus(NOW, -1) });
    const out = selectPurgeCandidates([r], NOW, policy);
    expect(out.purge).toEqual([r.id]);
    expect(out.keep).toEqual([]);
  });

  test("미확정(new) · retention_until 전 → keep(retention_active)", () => {
    const r = row({ status: "new", retention_until: isoPlus(NOW, +1) });
    const out = selectPurgeCandidates([r], NOW, policy);
    expect(out.purge).toEqual([]);
    expect(out.keep).toEqual([{ id: r.id, reason: "retention_active" }]);
  });

  test("미확정(cancelled, 확정 이력 없음) · retention_until 경과 → purge (계약 기록이 아니다)", () => {
    const r = row({ status: "cancelled", confirmed_at: null, retention_until: isoPlus(NOW, -1) });
    expect(selectPurgeCandidates([r], NOW, policy).purge).toEqual([r.id]);
  });

  test("확정(confirmed) · retention 경과 · created_at+5년 전 → keep(legal_hold)", () => {
    const created = new Date(NOW.getTime() - 2 * 365 * MS_PER_DAY); // 2년 전 접수
    const r = row({
      status: "confirmed",
      created_at: created.toISOString(),
      confirmed_at: isoPlus(created, MS_PER_DAY),
      retention_until: isoPlus(created, PRIVACY_NOTICE.retentionDays * MS_PER_DAY), // 1년 → 이미 경과
    });
    const out = selectPurgeCandidates([r], NOW, policy);
    expect(out.purge).toEqual([]);
    expect(out.keep).toEqual([{ id: r.id, reason: "legal_hold" }]);
  });

  test("확정(confirmed) · created_at+5년 경과 → purge", () => {
    const created = new Date(Date.UTC(2021, 0, 15, 3, 0, 0)); // 2021-01-15 → +5년 = 2026-01-15 < NOW
    const r = row({
      status: "confirmed",
      created_at: created.toISOString(),
      confirmed_at: isoPlus(created, MS_PER_DAY),
      retention_until: isoPlus(created, PRIVACY_NOTICE.retentionDays * MS_PER_DAY),
    });
    expect(selectPurgeCandidates([r], NOW, policy).purge).toEqual([r.id]);
  });

  test("done(운행 완료) 도 계약 기록 — 5년 전이면 keep(legal_hold), 5년 경과면 purge", () => {
    const young = row({ status: "done", created_at: isoPlus(NOW, -2 * 365 * MS_PER_DAY), retention_until: isoPlus(NOW, -1) });
    const old = row({ status: "done", created_at: "2020-06-01T00:00:00.000Z", retention_until: "2021-06-01T00:00:00.000Z" });
    const out = selectPurgeCandidates([young, old], NOW, policy);
    expect(out.keep).toEqual([{ id: young.id, reason: "legal_hold" }]);
    expect(out.purge).toEqual([old.id]);
  });

  test("cancelled 이지만 confirmed_at 이 있으면(확정 후 취소) 계약·청약철회 기록 — 5년 보존", () => {
    const r = row({
      status: "cancelled",
      created_at: isoPlus(NOW, -2 * 365 * MS_PER_DAY),
      confirmed_at: isoPlus(NOW, -2 * 365 * MS_PER_DAY + MS_PER_DAY),
      retention_until: isoPlus(NOW, -1),
    });
    expect(selectPurgeCandidates([r], NOW, policy).keep).toEqual([{ id: r.id, reason: "legal_hold" }]);
  });

  test("경계: retention_until == now → keep (초과만 purge)", () => {
    const r = row({ status: "new", retention_until: NOW.toISOString() });
    const out = selectPurgeCandidates([r], NOW, policy);
    expect(out.purge).toEqual([]);
    expect(out.keep).toEqual([{ id: r.id, reason: "retention_active" }]);
  });

  test("경계: 확정건 created_at+5년 == now → keep, +5년+1ms 경과 → purge", () => {
    const createdExact = new Date(Date.UTC(2021, 8, 11, 15, 0, 0, 0)); // +5년 == NOW
    const exact = row({ status: "confirmed", created_at: createdExact.toISOString(), retention_until: "2022-09-11T15:00:00.000Z" });
    const justOver = row({
      status: "confirmed",
      created_at: new Date(createdExact.getTime() - 1).toISOString(),
      retention_until: "2022-09-11T15:00:00.000Z",
    });
    const out = selectPurgeCandidates([exact, justOver], NOW, policy);
    expect(out.keep).toEqual([{ id: exact.id, reason: "legal_hold" }]);
    expect(out.purge).toEqual([justOver.id]);
  });

  test("KST 자정 경계 — 같은 인스턴트를 UTC 표기와 +09:00 표기로 넣어도 판정이 같다 (timestamptz 는 TZ 무관)", () => {
    // NOW = KST 2026-09-12 00:00:00. 1초 전(KST 09-11 23:59:59)은 purge, 정각은 keep.
    const utcBefore = row({ retention_until: "2026-09-11T14:59:59.000Z" });
    const kstBefore = row({ retention_until: "2026-09-11T23:59:59.000+09:00" });
    const utcExact = row({ retention_until: "2026-09-11T15:00:00.000Z" });
    const kstExact = row({ retention_until: "2026-09-12T00:00:00.000+09:00" });
    const out = selectPurgeCandidates([utcBefore, kstBefore, utcExact, kstExact], NOW, policy);
    expect(out.purge.sort()).toEqual([utcBefore.id, kstBefore.id].sort());
    expect(out.keep.map((k) => k.id).sort()).toEqual([utcExact.id, kstExact.id].sort());
    // KST 벽시계 날짜만 보고 "오늘 만료"로 묶으면 틀린다 — 인스턴트로만 비교한다는 것을 한 번 더 못박는다.
    const nowAsKstString = new Date("2026-09-12T00:00:00+09:00");
    expect(nowAsKstString.getTime()).toBe(NOW.getTime());
  });

  test("입력 순서를 유지하고, 같은 행을 purge 와 keep 양쪽에 넣지 않는다", () => {
    const rows = [
      row({ id: "a", retention_until: isoPlus(NOW, -1) }),
      row({ id: "b", retention_until: isoPlus(NOW, +1) }),
      row({ id: "c", retention_until: isoPlus(NOW, -2) }),
    ];
    const out = selectPurgeCandidates(rows, NOW, policy);
    expect(out.purge).toEqual(["a", "c"]);
    expect(out.keep.map((k) => k.id)).toEqual(["b"]);
  });

  test("파싱 불가한 시각은 throw — 모르는 행을 지우지 않는다", () => {
    expect(() => selectPurgeCandidates([row({ retention_until: "not a date" })], NOW, policy)).toThrow(/retention_until/);
    expect(() => selectPurgeCandidates([row({ status: "confirmed", created_at: "" })], NOW, policy)).toThrow(/created_at/);
    expect(() => selectPurgeCandidates([row()], new Date(NaN), policy)).toThrow(/now/);
  });

  test("legalHoldUntil = created_at + N년 (UTC 달력 연도 가산)", () => {
    expect(legalHoldUntil(new Date("2021-03-10T01:02:03.004Z"), 5).toISOString()).toBe("2026-03-10T01:02:03.004Z");
    expect(CONFIRMED_KEEP_YEARS).toBe(5);
  });
});

// =============================================================================
// 2. purge 어댑터 — dry-run 기본값 · 상한
// =============================================================================
function fakeClient(rows: RetentionRow[]) {
  const deleted: string[][] = [];
  const client: PurgeClient = {
    selectExpired: vi.fn(async () => rows),
    deleteReservations: vi.fn(async (ids: string[]) => {
      deleted.push([...ids]);
      return ids.length;
    }),
  };
  return { client, deleted };
}

describe("purge — dry-run 이 기본값, 실삭제는 명시 플래그 + 상한", () => {
  const expired = Array.from({ length: 10 }, (_, i) => row({ id: `exp-${i}`, retention_until: isoPlus(NOW, -(i + 1) * 1000) }));

  test("옵션 없이 호출하면 dry-run: delete 가 호출되지 않고 보고만 한다", async () => {
    const { client } = fakeClient(expired);
    const report = await purge({ now: NOW }, client);
    expect(report.dryRun).toBe(true);
    expect(client.deleteReservations).not.toHaveBeenCalled();
    expect(report.candidates).toBe(10);
    expect(report.purged).toBe(0);
    expect(report.limit).toBe(DEFAULT_PURGE_LIMIT);
    expect(DEFAULT_PURGE_LIMIT).toBe(200);
  });

  test("dryRun:true 를 명시해도 동일하게 delete 미호출", async () => {
    const { client } = fakeClient(expired);
    await purge({ dryRun: true, now: NOW }, client);
    expect(client.deleteReservations).not.toHaveBeenCalled();
  });

  test("dryRun:false + limit 3 + 후보 10 → delete 는 3건만 (가장 오래 만료된 순)", async () => {
    const { client, deleted } = fakeClient(expired);
    const report = await purge({ dryRun: false, limit: 3, now: NOW }, client);
    expect(report.dryRun).toBe(false);
    expect(client.deleteReservations).toHaveBeenCalledTimes(1);
    expect(deleted[0]).toHaveLength(3);
    expect(report.purged).toBe(3);
    expect(report.candidates).toBe(10);
    expect(report.limitReached).toBe(true);
    // 어댑터가 넘긴 행은 selectExpired 순서(retention_until asc)를 그대로 따른다
    expect(deleted[0]).toEqual(expired.slice(0, 3).map((r) => r.id));
  });

  test("dry-run 도 limit 를 존중해 '이번 실행이 지울 건수'를 보고한다", async () => {
    const { client } = fakeClient(expired);
    const report = await purge({ limit: 4, now: NOW }, client);
    expect(report.wouldPurge).toBe(4);
    expect(report.entries.filter((e) => e.decision === "purge")).toHaveLength(4);
    expect(report.entries.filter((e) => e.decision === "deferred")).toHaveLength(6);
  });

  test("후보 0건이면 dryRun:false 여도 delete 를 호출하지 않는다", async () => {
    const { client } = fakeClient([row({ retention_until: isoPlus(NOW, +1000) })]);
    const report = await purge({ dryRun: false, now: NOW }, client);
    expect(client.deleteReservations).not.toHaveBeenCalled();
    expect(report.kept.retention_active).toBe(1);
    expect(report.purged).toBe(0);
  });

  test("법정 보존 행은 keep(legal_hold) 로 집계되고 지워지지 않는다", async () => {
    const held = row({ status: "confirmed", created_at: isoPlus(NOW, -400 * MS_PER_DAY), retention_until: isoPlus(NOW, -1) });
    const { client, deleted } = fakeClient([held, ...expired]);
    const report = await purge({ dryRun: false, now: NOW }, client);
    expect(report.kept.legal_hold).toBe(1);
    expect(deleted.flat()).not.toContain(held.id);
  });

  test("limit 은 1 이상의 정수여야 한다 — 0·음수·소수·NaN 은 throw (실수로 전부 지우는 경로 차단)", async () => {
    const { client } = fakeClient(expired);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(purge({ limit: bad, now: NOW }, client)).rejects.toThrow(/limit/);
    }
    expect(client.deleteReservations).not.toHaveBeenCalled();
  });

  test("보고서: now 는 ISO 인스턴트 + KST 달력 날짜, 삭제 개수 불일치는 그대로 드러낸다", async () => {
    const { client } = fakeClient(expired);
    client.deleteReservations = vi.fn(async () => 2); // DB 가 3건 중 2건만 지웠다고 응답
    const report = await purge({ dryRun: false, limit: 3, now: NOW }, client);
    expect(report.nowIso).toBe("2026-09-11T15:00:00.000Z");
    expect(report.nowKstDate).toBe("2026-09-12");
    expect(report.purged).toBe(2);
    expect(report.wouldPurge).toBe(3);
  });

  test("감사 로그: console.info 에 구조화 JSON 1건 — id·created_at·status 만, 이름·전화 없음", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const { client } = fakeClient(expired.slice(0, 2));
      await purge({ dryRun: false, now: NOW }, client);
      const lines = spy.mock.calls.map((c) => String(c[0])).filter((s) => s.includes("retention_purge"));
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]) as { event: string; entries: Record<string, unknown>[] };
      expect(parsed.event).toBe("retention_purge");
      expect(parsed.entries).toHaveLength(2);
      for (const e of parsed.entries) {
        expect(Object.keys(e).sort()).toEqual(["created_at", "decision", "id", "reason", "status"]);
      }
      expect(lines[0]).not.toMatch(/"(name|phone|email|message)"/);
    } finally {
      spy.mockRestore();
    }
  });
});

// =============================================================================
// 2-b. supabasePurgeClient — supabase-js 호출 형태 (가짜 빌더로 쿼리 모양을 고정)
// =============================================================================
type Call = { table: string; op: string; args: unknown[] }[];
function fakeSupabase(selectRows: RetentionRow[], deleteCounts: Record<string, number | null> = {}) {
  const calls: Call = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = (op: string) => (...args: unknown[]) => {
      calls.push({ table, op, args });
      return builder;
    };
    for (const op of ["select", "lt", "order", "limit", "delete", "in"]) builder[op] = chain(op);
    // thenable: await 하면 결과를 낸다
    builder.then = (resolve: (v: unknown) => void) => {
      const ops = calls.filter((c) => c.table === table).map((c) => c.op);
      if (ops.includes("delete")) {
        resolve({ error: null, count: deleteCounts[table] ?? 0 });
      } else {
        resolve({ data: selectRows, error: null });
      }
    };
    return builder;
  };
  return { supabase: { from } as never, calls };
}

describe("supabasePurgeClient — 쿼리 모양", () => {
  test("selectExpired: reservations 에서 개인정보 아닌 5컬럼만, retention_until < now, asc, limit", async () => {
    const rows = [row()];
    const { supabase, calls } = fakeSupabase(rows);
    const client = supabasePurgeClient(supabase);
    const got = await client.selectExpired(NOW.toISOString(), 1000);
    expect(got).toEqual(rows);
    const select = calls.find((c) => c.op === "select");
    expect(select?.table).toBe("reservations");
    expect(String(select?.args[0]).split(",").map((s) => s.trim()).sort()).toEqual(
      ["confirmed_at", "created_at", "id", "retention_until", "status"].sort(),
    );
    expect(calls.find((c) => c.op === "lt")?.args).toEqual(["retention_until", NOW.toISOString()]);
    expect(calls.find((c) => c.op === "limit")?.args).toEqual([1000]);
  });

  test("deleteReservations: notifications_log(FK·to_phone) 를 먼저 지우고 reservations 를 지운다", async () => {
    const { supabase, calls } = fakeSupabase([], { reservations: 2, notifications_log: 5 });
    const client = supabasePurgeClient(supabase);
    const n = await client.deleteReservations(["a", "b"]);
    expect(n).toBe(2);
    const deletes = calls.filter((c) => c.op === "delete").map((c) => c.table);
    expect(deletes).toEqual(["notifications_log", "reservations"]);
    const ins = calls.filter((c) => c.op === "in");
    expect(ins[0].args).toEqual(["reservation_id", ["a", "b"]]);
    expect(ins[1].args).toEqual(["id", ["a", "b"]]);
  });

  test("deleteReservations([]) 는 DB 를 호출하지 않는다", async () => {
    const { supabase, calls } = fakeSupabase([]);
    expect(await supabasePurgeClient(supabase).deleteReservations([])).toBe(0);
    expect(calls).toEqual([]);
  });
});

// =============================================================================
// 3. 라우트 — CRON_SECRET · dry 플래그 · 응답에 개인정보 0
// =============================================================================
vi.mock("server-only", () => ({}));
const routeRows: RetentionRow[] = [];
const routeDeleted: string[][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => fakeSupabaseForRoute(),
}));
function fakeSupabaseForRoute() {
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    let isDelete = false;
    let inIds: string[] = [];
    const chain = (op: string) => (...args: unknown[]) => {
      if (op === "delete") isDelete = true;
      if (op === "in") inIds = args[1] as string[];
      return b;
    };
    for (const op of ["select", "lt", "order", "limit", "delete", "in"]) b[op] = chain(op);
    b.then = (resolve: (v: unknown) => void) => {
      if (isDelete) {
        if (table === "reservations") routeDeleted.push(inIds);
        resolve({ error: null, count: inIds.length });
      } else {
        resolve({ data: routeRows, error: null });
      }
    };
    return b;
  };
  return { from };
}

describe("GET /api/cron/purge", () => {
  const SECRET = "test-cron-secret-0123456789";
  const URL_BASE = "http://localhost/api/cron/purge";

  async function call(headers: Record<string, string>, query = ""): Promise<{ status: number; body: unknown; text: string }> {
    process.env.CRON_SECRET = SECRET;
    const { GET } = await import("@/app/api/cron/purge/route");
    const res = await GET(new Request(`${URL_BASE}${query}`, { headers }));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  }

  afterEach(() => {
    routeRows.length = 0;
    routeDeleted.length = 0;
    vi.restoreAllMocks();
  });

  test("Authorization 없음 → 401, 본문에 보고서 없음", async () => {
    const r = await call({});
    expect(r.status).toBe(401);
    expect(r.text).not.toContain("candidates");
  });

  test("시크릿 틀림 → 401 (길이 다른 값·같은 길이 다른 값 모두)", async () => {
    expect((await call({ Authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ Authorization: `Bearer ${SECRET.slice(0, -1)}X` })).status).toBe(401);
    expect((await call({ Authorization: SECRET })).status).toBe(401); // Bearer 접두사 없음
  });

  test("CRON_SECRET 미설정이면 어떤 요청도 401 (fail-closed)", async () => {
    process.env.CRON_SECRET = SECRET;
    const { GET } = await import("@/app/api/cron/purge/route");
    delete process.env.CRON_SECRET;
    const res = await GET(new Request(URL_BASE, { headers: { Authorization: "Bearer " } }));
    expect(res.status).toBe(401);
  });

  test("시크릿 맞음 + ?dry=0 없음 → dry-run 보고, 삭제 0", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    routeRows.push(row({ retention_until: isoPlus(NOW, -MS_PER_DAY) }));
    const r = await call({ Authorization: `Bearer ${SECRET}` });
    expect(r.status).toBe(200);
    const report = r.body as PurgeReport;
    expect(report.dryRun).toBe(true);
    expect(report.candidates).toBe(1);
    expect(report.purged).toBe(0);
    expect(routeDeleted).toEqual([]);
  });

  test("?dry=1 · ?dry=true 도 dry-run — 오직 dry=0 만 실삭제", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    routeRows.push(row({ retention_until: isoPlus(NOW, -MS_PER_DAY) }));
    for (const q of ["?dry=1", "?dry=true", "?dry=", "?dry=no"]) {
      const r = await call({ Authorization: `Bearer ${SECRET}` }, q);
      expect((r.body as PurgeReport).dryRun, q).toBe(true);
    }
    expect(routeDeleted).toEqual([]);
  });

  test("시크릿 맞음 + ?dry=0 → 실삭제", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const target = row({ retention_until: isoPlus(NOW, -MS_PER_DAY) });
    routeRows.push(target);
    const r = await call({ Authorization: `Bearer ${SECRET}` }, "?dry=0");
    expect(r.status).toBe(200);
    const report = r.body as PurgeReport;
    expect(report.dryRun).toBe(false);
    expect(report.purged).toBe(1);
    expect(routeDeleted).toEqual([[target.id]]);
  });

  test("응답 본문에 이름·전화·이메일·메시지 필드가 없다 (id·created_at·status 뿐)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    routeRows.push(row({ retention_until: isoPlus(NOW, -MS_PER_DAY) }), row({ retention_until: isoPlus(NOW, +MS_PER_DAY) }));
    const r = await call({ Authorization: `Bearer ${SECRET}` });
    expect(r.text).not.toMatch(/"(name|phone|email|message|to_phone)"/);
    const report = r.body as PurgeReport;
    expect(report.entries.length).toBe(2);
    for (const e of report.entries) expect(Object.keys(e).sort()).toEqual(["created_at", "decision", "id", "reason", "status"]);
  });

  test("응답은 캐시되지 않는다 (Cache-Control: no-store)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.CRON_SECRET = SECRET;
    const { GET } = await import("@/app/api/cron/purge/route");
    const res = await GET(new Request(URL_BASE, { headers: { Authorization: `Bearer ${SECRET}` } }));
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

// =============================================================================
// 4. vercel.json · .env.example · middleware 제외
// =============================================================================
describe("vercel.json / .env.example / middleware", () => {
  test("vercel.json crons 에 /api/cron/purge 가 '0 19 * * *'(UTC 19:00 = KST 04:00) 로 있다", () => {
    const p = path.join(ROOT, "vercel.json");
    expect(existsSync(p)).toBe(true);
    const json = JSON.parse(readFileSync(p, "utf-8")) as { crons?: { path: string; schedule: string }[] };
    const entry = json.crons?.find((c) => c.path.split("?")[0] === "/api/cron/purge");
    expect(entry).toBeDefined();
    expect(entry?.schedule).toBe("0 19 * * *");
  });

  test(".env.example 에 CRON_SECRET 이 있다", () => {
    const env = readFileSync(path.join(ROOT, ".env.example"), "utf-8");
    expect(env).toMatch(/^CRON_SECRET=/m);
  });

  test("middleware matcher 가 /api 를 제외한다 — 크론 GET 이 로케일 리다이렉트에 걸리지 않는 이유", () => {
    // next-intl 미들웨어는 vitest(node)에서 import 가 안 되므로 소스 텍스트로 확인한다 — 정적 사실이라 충분하다.
    const src = readFileSync(path.join(ROOT, "middleware.ts"), "utf-8");
    const matcher = /matcher:\s*\[([^\]]*)\]/.exec(src)?.[1] ?? "";
    expect(matcher).toContain("?!api");
  });

  test("route.ts 는 'use server' 를 쓰지 않고 서비스 롤 클라이언트만 쓴다", () => {
    const src = readFileSync(path.join(ROOT, "app", "api", "cron", "purge", "route.ts"), "utf-8");
    expect(src).not.toMatch(/["']use server["']/);
    expect(src).toContain("createServiceClient");
    expect(src).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });
});

// =============================================================================
// 5. DB — 로컬 스택 + REQUIRE_DB_TESTS=1 일 때만 (원격 reservations 에는 어떤 쓰기도 하지 않는다)
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[purge.test] DB 파기 실증 블록 skip — ${gate.reason}`);
}

test("원격 URL 이면 DB 파기 블록은 REQUIRE_DB_TESTS=1 이어도 skip 이다", () => {
  if (!isLocalStack()) {
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, REQUIRE_DB_TESTS: "1" }).allowed).toBe(false);
    expect(gate.allowed).toBe(false);
  } else {
    expect(gate.allowed).toBe(process.env.REQUIRE_DB_TESTS === "1");
  }
});

describe.skipIf(!gate.allowed || !env.hasServiceRole)("DB — 파기 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)", () => {
  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const TEST_PREFIX = "p15test-";
  const ids: string[] = [];

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
      // not JSON
    }
    return { status: res.status, body };
  }

  // retention_until 은 앱이 넣는 값이라 과거로도 넣을 수 있다(0003 제약은 created_at 이후만 요구) — created_at 을 함께 과거로 둔다.
  function seed(createdAt: Date, retentionUntil: Date) {
    const consent = consentFields({ privacyConsent: true, marketingConsent: false, withdrawalConsent: true }, createdAt);
    return {
      public_code: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
      created_at: createdAt.toISOString(),
      name: "테스트",
      phone: "010-0000-0000",
      vehicle_slug: "bus45",
      purpose_code: "family",
      origin_code: "SEL",
      destination_code: "BSN",
      waypoint_codes: [],
      trip_type: "oneway",
      depart_at: new Date(createdAt.getTime() + 7 * MS_PER_DAY).toISOString(),
      return_at: null,
      nights: 0,
      bus_count: 1,
      locale: "ko",
      ...consent,
      retention_until: retentionUntil.toISOString(),
    };
  }

  async function insert(rowJson: Record<string, unknown>): Promise<string> {
    const r = await rest("POST", "/reservations", rowJson, "return=representation");
    if (r.status !== 201 || !Array.isArray(r.body)) throw new Error(`insert 실패 HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    const id = (r.body as { id: string }[])[0].id;
    ids.push(id);
    return id;
  }

  async function count(): Promise<number> {
    const r = await rest("GET", `/reservations?select=id&public_code=like.${TEST_PREFIX}*`);
    return Array.isArray(r.body) ? r.body.length : -1;
  }

  beforeAll(async () => {
    const probe = await rest("GET", "/reservations?select=retention_until&limit=0");
    if (probe.status !== 200) throw new Error(`0003 미적용으로 보임 — HTTP ${probe.status}`);
  });

  afterAll(async () => {
    await rest("DELETE", `/reservations?public_code=like.${TEST_PREFIX}*`);
    expect(await count()).toBe(0);
  });

  test("만료 2 + 미만료 1 → dry-run 보고 2·삭제 0 → 실삭제 2·잔존 1", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, env.serviceRoleKey, { auth: { persistSession: false } });
    const client = supabasePurgeClient(supabase);
    const now = new Date();
    const twoYearsAgo = new Date(now.getTime() - 2 * 365 * MS_PER_DAY);
    const e1 = await insert(seed(twoYearsAgo, new Date(now.getTime() - MS_PER_DAY)));
    const e2 = await insert(seed(twoYearsAgo, new Date(now.getTime() - 2 * MS_PER_DAY)));
    const alive = await insert(seed(now, new Date(now.getTime() + MS_PER_DAY)));

    const dry = await purge({ now }, client);
    const dryIds = dry.entries.filter((e) => e.decision === "purge").map((e) => e.id);
    expect(dryIds).toEqual(expect.arrayContaining([e1, e2]));
    expect(dryIds).not.toContain(alive);
    expect(await count()).toBe(3);

    const live = await purge({ dryRun: false, now }, client);
    expect(live.purged).toBeGreaterThanOrEqual(2);
    const remaining = await rest("GET", `/reservations?select=id&public_code=like.${TEST_PREFIX}*`);
    const remainingIds = (remaining.body as { id: string }[]).map((r) => r.id);
    expect(remainingIds).toEqual([alive]);
  });
});

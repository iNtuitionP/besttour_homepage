/**
 * OF2-C — 자체 방문자 통계를 **실제 로컬 DB** 에서 증명한다 (마이그레이션 0027).
 *
 *   ① 표 두 개(site_stats_daily · site_visitors_seen) — RLS 켜짐 · 공개 롤(anon·authenticated·service_role·PUBLIC)에 **어떤 권한도 없다**
 *      (권한 종류는 acldefault 에서 열거한다 — TRUNCATE·MAINTAIN 포함 — 하드코딩하지 않는다)
 *   ② record_site_view — service_role 만 실행 · anon·관리자 세션은 EXECUTE 거부 · vid 모양이 아니면(IP 같은 값) 거부
 *   ③ 세기 — 새 방문자는 조회수·방문자 +1 · 같은 vid 는 조회수만 +1(하루 한 번) · 다른 vid 는 둘 다 +1
 *   ④ admin_site_stats — 관리자만(가드) · 30일 빈 날 0 채움 · 누적 · 범위 밖 인자 거부
 *   ⑤ 삭제 — 오늘·어제보다 오래된 일회용 값은 record 때, 그리고 purge_site_visitors_seen(크론)이 지운다. 날짜별 숫자는 남는다.
 *
 * 실행 조건: dbWriteGate() — 로컬 스택 + REQUIRE_DB_TESTS=1. 원격이면 닫힌다.
 * 잠금: 이 두 표를 만지는 파일은 이 파일뿐이라 별도 잠금이 필요 없다(숫자는 **차이**로 단언한다). 통지 아웃박스·갤러리·노선 표를 건드리지 않는다.
 * 만든 사용자·행은 끝에서 지운다.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { expectFunctionPrivilegeDenied, expectRaisedDenied, expectTablePrivilegeDenied } from "./helpers/expect-denied";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";
import { runLocalSql, sqlCells } from "./helpers/local-stack-sql";

const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) console.warn(`[site-stats-db] DB 블록 skip — ${gate.reason}`);

describe.skipIf(!gate.allowed || !env.hasServiceRole)("OF2-C DB — 방문 통계 표 · 함수 (로컬 스택 + REQUIRE_DB_TESTS=1)", { timeout: 120_000 }, () => {
  const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceHeaders = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const PASSWORD = `of2c-${randomUUID()}`;
  const emailFor = (who: string) => `of2c-${RUN}-${who}@example.test`;

  type Res = { status: number; body: unknown };
  async function call(method: string, url: string, hdrs: Record<string, string>, json?: unknown): Promise<Res> {
    const res = await fetch(url, { method, headers: hdrs, body: json === undefined ? undefined : JSON.stringify(json) });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // JSON 이 아니면 문자열 그대로
    }
    return { status: res.status, body };
  }
  const asService = (method: string, p: string, json?: unknown) => call(method, `${env.restRoot}${p}`, serviceHeaders, json);
  const asUser = (token: string, method: string, p: string, json?: unknown) =>
    call(method, `${env.restRoot}${p}`, { apikey: env.anonKey as string, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, json);
  const asAnon = (method: string, p: string, json?: unknown) => call(method, `${env.restRoot}${p}`, { apikey: env.anonKey as string, "Content-Type": "application/json" }, json);

  async function createUser(email: string): Promise<string> {
    const r = await call("POST", `${baseUrl()}/auth/v1/admin/users`, serviceHeaders, { email, password: PASSWORD, email_confirm: true });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBeLessThan(300);
    return (r.body as { id: string }).id;
  }
  async function signIn(email: string): Promise<string> {
    const r = await call("POST", `${baseUrl()}/auth/v1/token?grant_type=password`, { apikey: env.anonKey as string, "Content-Type": "application/json" }, { email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    return (r.body as { access_token: string }).access_token;
  }

  interface Stats {
    today: string;
    days: { day: string; views: number; visitors: number }[];
    total_views: number;
    total_visitors: number;
  }
  const vid = () => randomBytes(16).toString("hex");
  const record = (v: string) => asService("POST", "/rpc/record_site_view", { p_vid: v });
  let adminId = "";
  let adminToken = "";
  let plainToken = "";
  const stats = async (days = 30): Promise<Stats> => {
    const r = await asUser(adminToken, "POST", "/rpc/admin_site_stats", { p_days: days });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as Stats;
  };
  const todayRow = (s: Stats) => s.days[s.days.length - 1];
  const sql = (q: string) => runLocalSql(q);
  const madeDays: string[] = [];

  beforeAll(async () => {
    adminId = await createUser(emailFor("admin"));
    await createUser(emailFor("plain"));
    adminToken = await signIn(emailFor("admin"));
    plainToken = await signIn(emailFor("plain"));
    const add = await asService("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "OF2-C test" });
    expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);
  });

  afterAll(async () => {
    // 이 파일이 심은 행만 지운다(마커 vid 는 'beef' 로 시작 · 옛 집계 행은 madeDays)
    try {
      sql("delete from site_visitors_seen where vid like 'beef%'");
      for (const d of madeDays) sql(`delete from site_stats_daily where day = '${d}'`);
    } catch {
      // 정리 실패는 다음 단언을 가리지 않는다
    }
    await asService("DELETE", `/admin_users?user_id=eq.${adminId}`);
    const list = await call("GET", `${baseUrl()}/auth/v1/admin/users?page=1&per_page=200`, serviceHeaders);
    const users = ((list.body as { users?: { id: string; email: string }[] })?.users ?? []).filter((u) => u.email.startsWith(`of2c-${RUN}-`));
    for (const u of users) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${u.id}`, serviceHeaders);
  });

  test("① 표 두 개 — RLS 켜짐 · 공개 롤·PUBLIC 에 권한이 하나도 없다(종류는 acldefault 에서 열거: TRUNCATE·MAINTAIN 포함)", async () => {
    const rls = sqlCells(
      sql(
        "select coalesce(string_agg(relname || '=' || relrowsecurity::text, ','), 'NONE') as v from pg_class where oid in ('public.site_stats_daily'::regclass, 'public.site_visitors_seen'::regclass)",
      ),
    );
    expect(rls.join("\n")).toContain("site_stats_daily=true");
    expect(rls.join("\n")).toContain("site_visitors_seen=true");

    // 직접 부여와 유효값을 모두 본다 — 권한 종류는 이 서버가 아는 전부(acldefault)와 실제 ACL 에서 얻는다
    const effective = sqlCells(
      sql(`
        select coalesce(string_agg(t.n || ':' || r.r || ':' || k.p, ','), 'NONE') as v
          from (values ('site_stats_daily'), ('site_visitors_seen')) t(n),
               (values ('anon'), ('authenticated'), ('service_role')) r(r),
               (select privilege_type as p from aclexplode(acldefault('r', (select relowner from pg_class where oid = 'public.site_stats_daily'::regclass)))
                union
                select a.privilege_type from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                 where c.oid in ('public.site_stats_daily'::regclass, 'public.site_visitors_seen'::regclass)) k
         where has_table_privilege(r.r, 'public.' || t.n, k.p)
            or has_table_privilege(r.r, 'public.' || t.n, k.p || ' WITH GRANT OPTION')`),
    );
    expect(effective, "공개 롤에 열린 표 권한").toContain("NONE");
    const direct = sqlCells(
      sql(`
        select coalesce(string_agg(c.relname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || ':' || a.privilege_type, ','), 'NONE') as v
          from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         where c.oid in ('public.site_stats_daily'::regclass, 'public.site_visitors_seen'::regclass)
           and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))`),
    );
    expect(direct, "ACL 에 직접 남은 공개 롤 항목").toContain("NONE");
    const colPriv = sqlCells(
      sql(`
        select coalesce(string_agg(t.n || ':' || r.r, ','), 'NONE') as v
          from (values ('site_stats_daily'), ('site_visitors_seen')) t(n), (values ('anon'), ('authenticated'), ('service_role')) r(r)
         where has_any_column_privilege(r.r, 'public.' || t.n, 'SELECT') or has_any_column_privilege(r.r, 'public.' || t.n, 'INSERT')
            or has_any_column_privilege(r.r, 'public.' || t.n, 'UPDATE') or has_any_column_privilege(r.r, 'public.' || t.n, 'REFERENCES')`),
    );
    expect(colPriv, "컬럼 단위 권한").toContain("NONE");

    // 실제 요청으로도 거부된다(서비스 롤 포함 — 쓰기는 definer 함수 하나뿐이다)
    for (const table of ["site_stats_daily", "site_visitors_seen"]) {
      expectTablePrivilegeDenied(await asAnon("GET", `/${table}?select=*`), table, `anon 이 ${table} 를 읽는다`);
      expectTablePrivilegeDenied(await asUser(adminToken, "GET", `/${table}?select=*`), table, `관리자 세션이 ${table} 를 직접 읽는다`);
      expectTablePrivilegeDenied(await asService("GET", `/${table}?select=*`), table, `service_role 이 ${table} 를 직접 읽는다`);
      expectTablePrivilegeDenied(await asService("POST", `/${table}`, table === "site_stats_daily" ? { day: "2031-01-01", views: 1, visitors: 1 } : { day: "2031-01-01", vid: vid() }), table, `service_role 이 ${table} 에 직접 쓴다`);
      expectTablePrivilegeDenied(await asService("DELETE", `/${table}?day=eq.2031-01-01`), table, `service_role 이 ${table} 를 직접 지운다`);
    }
  });

  test("② record_site_view — service_role 만 · anon·관리자 세션은 실행 거부 · vid 모양이 아니면(IP 등) 거부", async () => {
    const v = "beef" + vid().slice(4);
    expectFunctionPrivilegeDenied(await asAnon("POST", "/rpc/record_site_view", { p_vid: v }), "record_site_view", "anon");
    expectFunctionPrivilegeDenied(await asUser(adminToken, "POST", "/rpc/record_site_view", { p_vid: v }), "record_site_view", "관리자 세션");
    for (const bad of ["203.0.113.77", "", "x".repeat(32), "BEEF" + "0".repeat(28), "0".repeat(31), "0".repeat(33)]) {
      const r = await record(bad);
      expect(r.status, `${bad} → ${JSON.stringify(r.body)}`).toBe(400);
      expect((r.body as { code?: string }).code, bad).toBe("22023");
    }
    const ok = await record(v);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  test("③ 세기 — 새 방문자: 조회수·방문자 +1 · 같은 vid: 조회수만 +1 · 다른 vid: 둘 다 +1", async () => {
    const before = todayRow(await stats());
    const a = "beef" + vid().slice(4);
    const b = "beef" + vid().slice(4);

    expect((await record(a)).body).toBe(true);
    let s = todayRow(await stats());
    expect([s.views - before.views, s.visitors - before.visitors]).toEqual([1, 1]);

    expect((await record(a)).body).toBe(false);
    s = todayRow(await stats());
    expect([s.views - before.views, s.visitors - before.visitors]).toEqual([2, 1]);

    expect((await record(b)).body).toBe(true);
    s = todayRow(await stats());
    expect([s.views - before.views, s.visitors - before.visitors]).toEqual([3, 2]);

    // 저장된 일회용 값은 32자 hex 뿐이다(IP·UA 가 들어갈 칸이 없다) — 이 파일의 마커로 읽는다
    const stored = sqlCells(sql(`select coalesce(string_agg(vid, ','), 'NONE') as v from site_visitors_seen where vid in ('${a}', '${b}')`));
    expect(stored.join(",")).toContain(a);
    expect(stored.join(",")).toContain(b);
    expect(stored.every((c) => !/\./.test(c))).toBe(true);
  });

  test("④ admin_site_stats — 관리자만 · 오늘은 KST 날짜 · 30일 연속(빈 날 0) · 누적 = 모든 날의 합 · 범위 밖 인자 거부", async () => {
    const s = await stats(30);
    expect(s.days).toHaveLength(30);
    expect(s.today).toBe(new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10));
    expect(todayRow(s).day).toBe(s.today);
    for (let i = 1; i < s.days.length; i += 1) {
      expect(Date.parse(s.days[i].day) - Date.parse(s.days[i - 1].day), s.days[i].day).toBe(86_400_000);
      expect(s.days[i].views).toBeGreaterThanOrEqual(s.days[i].visitors);
    }
    expect(s.total_views).toBeGreaterThanOrEqual(s.days.reduce((n, d) => n + d.views, 0));
    expect(s.total_visitors).toBeGreaterThanOrEqual(s.days.reduce((n, d) => n + d.visitors, 0));
    expect((await stats(7)).days).toHaveLength(7);

    expectRaisedDenied(await asUser(plainToken, "POST", "/rpc/admin_site_stats", { p_days: 30 }), "admin_site_stats: 관리자 명단에 없는 호출자다", "비관리자 세션");
    expectFunctionPrivilegeDenied(await asAnon("POST", "/rpc/admin_site_stats", { p_days: 30 }), "admin_site_stats", "anon");
    expectFunctionPrivilegeDenied(await asService("POST", "/rpc/admin_site_stats", { p_days: 30 }), "admin_site_stats", "service_role");
    for (const bad of [0, -1, 91, 1000]) {
      const r = await asUser(adminToken, "POST", "/rpc/admin_site_stats", { p_days: bad });
      expect(r.status, `${bad}`).toBe(400);
      expect((r.body as { code?: string }).code, `${bad}`).toBe("22023");
    }
  });

  test("⑤ 삭제 — 오늘·어제보다 오래된 일회용 값은 purge_site_visitors_seen 이 지운다 · 날짜별 숫자(집계)는 남는다 · 실행은 service_role 만", async () => {
    const mk = (offset: number) => ({ offset, vid: "beef" + randomBytes(14).toString("hex") });
    const rows = [mk(-5), mk(-3), mk(-2), mk(-1), mk(0)];
    const kst = `(now() at time zone 'Asia/Seoul')::date`;
    sql(`insert into site_visitors_seen (day, vid) values ${rows.map((r) => `(${kst} + ${r.offset}, '${r.vid}')`).join(", ")}`);
    const oldDay = sqlCells(sql(`select (${kst} - 40)::text as d`)).find((c) => /^\d{4}-\d{2}-\d{2}$/.test(c)) as string;
    madeDays.push(oldDay);
    sql(`insert into site_stats_daily (day, views, visitors) values ('${oldDay}', 9, 4) on conflict (day) do nothing`);

    const present = () => {
      const out = sqlCells(sql(`select coalesce(string_agg(vid, ','), 'NONE') as v from site_visitors_seen where vid like 'beef%'`)).join(",");
      return rows.filter((r) => out.includes(r.vid)).map((r) => r.offset);
    };
    expect(present()).toEqual([-5, -3, -2, -1, 0]);

    expectFunctionPrivilegeDenied(await asAnon("POST", "/rpc/purge_site_visitors_seen", {}), "purge_site_visitors_seen", "anon");
    expectFunctionPrivilegeDenied(await asUser(adminToken, "POST", "/rpc/purge_site_visitors_seen", {}), "purge_site_visitors_seen", "관리자 세션");
    expect(present(), "거부된 호출이 지웠다").toEqual([-5, -3, -2, -1, 0]);

    const purged = await asService("POST", "/rpc/purge_site_visitors_seen", {});
    expect(purged.status, JSON.stringify(purged.body)).toBe(200);
    expect(purged.body as number).toBeGreaterThanOrEqual(3);
    // 남는 것은 어제·오늘뿐 — 가장 오래 남는 값도 3일을 넘지 않는다
    expect(present()).toEqual([-1, 0]);
    // 날짜별 숫자는 그대로
    expect(sqlCells(sql(`select views::text as v from site_stats_daily where day = '${oldDay}'`))).toContain("9");
  });

  test("⑤-b record_site_view 도 옛 값을 지운다 — 방문이 이어지는 동안은 크론을 기다리지 않는다", async () => {
    const old = "beef" + randomBytes(14).toString("hex");
    sql(`insert into site_visitors_seen (day, vid) values ((now() at time zone 'Asia/Seoul')::date - 4, '${old}')`);
    expect(sqlCells(sql(`select count(*)::text as v from site_visitors_seen where vid = '${old}'`))).toContain("1");
    expect((await record("beef" + vid().slice(4))).status).toBe(200);
    expect(sqlCells(sql(`select count(*)::text as v from site_visitors_seen where vid = '${old}'`))).toContain("0");
  });
});

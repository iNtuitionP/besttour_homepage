/**
 * OF2-B — 홈 접수 현황의 노출 규칙을 **실제 로컬 DB** 에서 증명한다 (마이그레이션 0026).
 *
 *   ① 숨김 칸 `hidden_from_feed` — 기본 false · 표 권한을 새로 열지 않는다(anon·authenticated 가 읽지도 쓰지도 못한다).
 *   ② `admin_set_feed_hidden` — 관리자만(definer 가드), anon 은 EXECUTE 거부, 없는 id 는 noop.
 *   ③ 취소는 상담완료 시각을 지우지 않는다 — 상담완료 뒤 취소는 홈에서 여전히 "상담완료"다.
 *   ④ 노출 규칙 — 접수 · 상담완료 · 상담완료 뒤 취소 · 운행 완료 = 보임 / 상담 없이 취소 · 숨김 · 90일 밖 = 안 보임, 최신 10건.
 *
 * 실행 조건: tests/helpers/load-env-local.ts `dbWriteGate()` — 로컬 스택 + REQUIRE_DB_TESTS=1. 원격이면 닫힌다(고객 개인정보 표).
 * 만든 행·사용자는 끝에서 지운다. 이 파일은 통지 아웃박스를 건드리지 않는다(상담완료 전이 함수를 부르지 않고, 행을 직접 심는다).
 * 이름 마커(RUN)로 행을 가려서 읽으므로 다른 파일의 접수와 겹치지 않는다.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { expectFunctionPrivilegeDenied, expectRaisedDenied, expectTablePrivilegeDenied } from "./helpers/expect-denied";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

vi.mock("server-only", () => ({}));

import { getRecentReservationsMasked, type ServiceClient } from "@/lib/queries/recent";
import { createServiceClient } from "@/lib/supabase/server";

const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) console.warn(`[feed-hidden-db] DB 블록 skip — ${gate.reason}`);

describe.skipIf(!gate.allowed || !env.hasServiceRole)("OF2-B DB — 숨김 칸 · 함수 · 노출 규칙 (로컬 스택 + REQUIRE_DB_TESTS=1)", { timeout: 120_000 }, () => {
  const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceHeaders = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const PASSWORD = `of2b-${randomUUID()}`;
  const emailFor = (who: string) => `of2b-${RUN}-${who}@example.test`;
  const DAY = 86_400_000;

  type Res = { status: number; body: unknown };
  async function call(method: string, url: string, hdrs: Record<string, string>, json?: unknown, prefer?: string): Promise<Res> {
    const res = await fetch(url, { method, headers: prefer ? { ...hdrs, Prefer: prefer } : hdrs, body: json === undefined ? undefined : JSON.stringify(json) });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // JSON 이 아니면 문자열 그대로
    }
    return { status: res.status, body };
  }
  const rest = (method: string, pathAndQuery: string, json?: unknown, prefer?: string) => call(method, `${env.restRoot}${pathAndQuery}`, serviceHeaders, json, prefer);
  const asUser = (token: string, method: string, pathAndQuery: string, json?: unknown) =>
    call(method, `${env.restRoot}${pathAndQuery}`, { apikey: env.anonKey as string, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, json);
  const asAnon = (method: string, pathAndQuery: string, json?: unknown) =>
    call(method, `${env.restRoot}${pathAndQuery}`, { apikey: env.anonKey as string, "Content-Type": "application/json" }, json);

  async function createUser(email: string): Promise<string> {
    const r = await call("POST", `${baseUrl()}/auth/v1/admin/users`, serviceHeaders, { email, password: PASSWORD, email_confirm: true });
    expect(r.status, `사용자 생성 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300);
    return (r.body as { id: string }).id;
  }
  async function signIn(email: string): Promise<string> {
    const r = await call("POST", `${baseUrl()}/auth/v1/token?grant_type=password`, { apikey: env.anonKey as string, "Content-Type": "application/json" }, { email, password: PASSWORD });
    expect(r.status, `로그인 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
    return (r.body as { access_token: string }).access_token;
  }

  let adminId = "";
  let adminToken = "";
  let plainToken = "";
  const made: string[] = [];
  let seq = 0;

  interface SeedOpts {
    name: string;
    status: "new" | "confirmed" | "done" | "cancelled";
    departDay: number;
    confirmedAt?: string | null;
    hidden?: boolean;
    createdAt?: string;
  }
  /** 행을 직접 심는다(상태 전이 함수를 거치지 않으므로 통지가 생기지 않는다). departDay → 2031-03-DD 00:00 KST. */
  async function seed(o: SeedOpts): Promise<string> {
    seq += 1;
    // 동의 시각은 접수 시각 근처여야 한다(reservations_consent_* CHECK) — created_at 을 옮기면 같이 옮긴다.
    const now = o.createdAt === undefined ? new Date() : new Date(o.createdAt);
    const later = new Date(Date.now() + 30 * DAY);
    const body: Record<string, unknown> = {
      public_code: `OB${RUN.slice(0, 4).toUpperCase()}${seq}`.slice(0, 12),
      status: o.status,
      name: o.name,
      phone: "010-0000-0000",
      intake: "wizard",
      vehicle_slug: "bus45",
      purpose_code: "family",
      origin_code: "SEL",
      destination_code: "BSN",
      waypoint_codes: [],
      trip_type: "oneway",
      depart_at: `2031-03-${String(o.departDay).padStart(2, "0")}T00:00:00+09:00`,
      return_at: null,
      nights: 0,
      bus_count: 1,
      locale: "ko",
      privacy_consent_at: now.toISOString(),
      privacy_policy_version: "2026-09-11",
      marketing_consent_at: null,
      retention_until: later.toISOString(),
      withdrawal_consent_at: now.toISOString(),
    };
    if (o.confirmedAt !== undefined) body.confirmed_at = o.confirmedAt;
    if (o.hidden !== undefined) body.hidden_from_feed = o.hidden;
    if (o.createdAt !== undefined) body.created_at = o.createdAt;
    const ins = await rest("POST", "/reservations", body, "return=representation");
    expect(ins.status, JSON.stringify(ins.body).slice(0, 300)).toBe(201);
    const id = (ins.body as { id: string }[])[0].id;
    made.push(id);
    return id;
  }

  /** 이름 마커로 가려 읽는 서비스 클라이언트 — reservations select 뒤에 LIKE 를 걸어 다른 파일의 접수와 섞이지 않게 한다. */
  function scoped(prefix: string): ServiceClient {
    const real = createServiceClient();
    return {
      from(table: string) {
        if (table !== "reservations") return real.from(table);
        return { select: (cols: string) => real.from("reservations").select(cols).like("name", `${prefix}%`) };
      },
    } as unknown as ServiceClient;
  }
  const feedByDay = async (prefix: string, limit?: number) =>
    Object.fromEntries((await getRecentReservationsMasked(limit, scoped(prefix))).map((i) => [i.departDateKst, i.status]));

  const setHidden = (token: string, id: string, hidden: boolean) => asUser(token, "POST", "/rpc/admin_set_feed_hidden", { p_id: id, p_hidden: hidden });
  const rowOf = async (id: string) =>
    ((await rest("GET", `/reservations?select=status,confirmed_at,hidden_from_feed&id=eq.${id}`)).body as { status: string; confirmed_at: string | null; hidden_from_feed: boolean }[])[0];

  beforeAll(async () => {
    const probe = await rest("GET", "/reservations?select=hidden_from_feed&limit=1");
    expect(probe.status, `0026 이 로컬 스택에 적용되지 않았다 (hidden_from_feed 읽기 ${probe.status})`).toBe(200);
    adminId = await createUser(emailFor("admin"));
    await createUser(emailFor("plain"));
    adminToken = await signIn(emailFor("admin"));
    plainToken = await signIn(emailFor("plain"));
    const add = await rest("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "OF2-B test" });
    expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);
  });

  afterAll(async () => {
    if (made.length > 0) await rest("DELETE", `/reservations?id=in.(${made.join(",")})`);
    await rest("DELETE", `/admin_users?user_id=eq.${adminId}`);
    const list = await call("GET", `${baseUrl()}/auth/v1/admin/users?page=1&per_page=200`, serviceHeaders);
    const users = ((list.body as { users?: { id: string; email: string }[] })?.users ?? []).filter((u) => u.email.startsWith(`of2b-${RUN}-`));
    for (const u of users) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${u.id}`, serviceHeaders);
  });

  test("① 숨김 칸 — 기본 false · 공개 롤은 읽지도 쓰지도 못한다", async () => {
    const id = await seed({ name: `${RUN}d`, status: "new", departDay: 20 });
    expect((await rowOf(id)).hidden_from_feed).toBe(false);
    // anon: 표 SELECT 가 없다(0017) — 새 칸이 몰래 공개되지 않았다
    expectTablePrivilegeDenied(await asAnon("GET", `/reservations?select=hidden_from_feed&id=eq.${id}`), "reservations", "anon 이 숨김 칸을 읽는다");
    // authenticated(관리자 포함): 표 UPDATE 가 없다 — 쓰기 길은 함수 하나뿐이다
    expectTablePrivilegeDenied(await asUser(adminToken, "PATCH", `/reservations?id=eq.${id}`, { hidden_from_feed: true }), "reservations", "관리자 세션이 숨김 칸을 직접 쓴다");
    expectTablePrivilegeDenied(await asAnon("PATCH", `/reservations?id=eq.${id}`, { hidden_from_feed: true }), "reservations", "anon 이 숨김 칸을 직접 쓴다");
    expect((await rowOf(id)).hidden_from_feed).toBe(false);
  });

  test("② 함수 — 관리자는 숨기고 다시 보이게 · 비관리자는 가드 거부 · anon 은 EXECUTE 거부 · 없는 id 는 noop", async () => {
    const id = await seed({ name: `${RUN}f`, status: "new", departDay: 21 });

    const hide = await setHidden(adminToken, id, true);
    expect(hide.status, JSON.stringify(hide.body)).toBe(200);
    expect(hide.body).toEqual([{ outcome: "hidden" }]);
    expect((await rowOf(id)).hidden_from_feed).toBe(true);
    // 같은 값을 다시 눌러도 오류가 아니다(두 번 클릭)
    expect((await setHidden(adminToken, id, true)).body).toEqual([{ outcome: "hidden" }]);

    const show = await setHidden(adminToken, id, false);
    expect(show.body).toEqual([{ outcome: "shown" }]);
    expect((await rowOf(id)).hidden_from_feed).toBe(false);

    expect((await setHidden(adminToken, randomUUID(), true)).body).toEqual([{ outcome: "noop" }]);

    expectRaisedDenied(await setHidden(plainToken, id, true), "admin_set_feed_hidden: 관리자 명단에 없는 호출자다", "비관리자 세션");
    expectFunctionPrivilegeDenied(await asAnon("POST", "/rpc/admin_set_feed_hidden", { p_id: id, p_hidden: true }), "admin_set_feed_hidden", "anon");
    expect((await rowOf(id)).hidden_from_feed).toBe(false);
  });

  test("③ 취소는 상담완료 시각을 지우지 않는다 — 상담완료 뒤 취소는 홈에서 여전히 상담완료", async () => {
    const confirmedAt = new Date().toISOString();
    const id = await seed({ name: `${RUN}c`, status: "confirmed", departDay: 22, confirmedAt });
    const cancel = await asUser(adminToken, "POST", "/rpc/admin_cancel_reservation", { p_id: id, p_memo: null });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    const after = await rowOf(id);
    expect(after.status).toBe("cancelled");
    expect(after.confirmed_at, "취소가 confirmed_at 을 지웠다").not.toBeNull();
    expect(Date.parse(after.confirmed_at as string)).toBe(Date.parse(confirmedAt));
    expect(await feedByDay(`${RUN}c`)).toEqual({ "3/22": "confirmed" });
  });

  test("④ 노출 규칙 — 접수·상담완료·상담완료 뒤 취소·운행 완료는 보이고, 상담 없이 취소·숨김·90일 밖은 안 보인다", async () => {
    const consulted = new Date(Date.now() - 3_600_000).toISOString();
    const name = `${RUN}a`;
    await seed({ name, status: "new", departDay: 1 }); // 접수
    await seed({ name, status: "confirmed", departDay: 2, confirmedAt: consulted }); // 상담완료
    await seed({ name, status: "cancelled", departDay: 3, confirmedAt: consulted }); // 상담완료 뒤 취소 → 상담완료
    await seed({ name, status: "cancelled", departDay: 4 }); // 상담 없이 취소 → 제외
    await seed({ name, status: "done", departDay: 5, confirmedAt: consulted }); // 운행 완료 → 상담완료
    await seed({ name, status: "new", departDay: 6, hidden: true }); // 숨김 → 제외
    await seed({ name, status: "new", departDay: 7, createdAt: new Date(Date.now() - 89 * DAY).toISOString() }); // 89일 → 포함
    await seed({ name, status: "new", departDay: 8, createdAt: new Date(Date.now() - 91 * DAY).toISOString() }); // 91일 → 제외
    await seed({ name, status: "confirmed", departDay: 9, confirmedAt: consulted, hidden: true }); // 상담완료여도 숨김 → 제외

    expect(await feedByDay(name)).toEqual({ "3/1": "new", "3/2": "confirmed", "3/3": "confirmed", "3/5": "confirmed", "3/7": "new" });
  });

  test("④-b 숨기기 → 홈에서 빠지고, 다시 보이기 → 돌아온다 (함수와 피드가 이어진다)", async () => {
    const name = `${RUN}h`;
    const id = await seed({ name, status: "new", departDay: 12 });
    expect(await feedByDay(name)).toEqual({ "3/12": "new" });
    expect((await setHidden(adminToken, id, true)).status).toBe(200);
    expect(await feedByDay(name)).toEqual({});
    expect((await setHidden(adminToken, id, false)).status).toBe(200);
    expect(await feedByDay(name)).toEqual({ "3/12": "new" });
  });

  test("④-c 화면 건수 — 기본은 최신 10건 (12건을 넣으면 가장 오래된 둘이 빠진다)", async () => {
    const name = `${RUN}L`;
    for (let i = 1; i <= 12; i++) {
      await seed({ name, status: "new", departDay: i, createdAt: new Date(Date.now() - (13 - i) * 60_000).toISOString() });
    }
    const feed = await feedByDay(name);
    expect(Object.keys(feed).sort()).toEqual(["3/10", "3/11", "3/12", "3/3", "3/4", "3/5", "3/6", "3/7", "3/8", "3/9"].sort());
    expect(feed["3/1"]).toBeUndefined();
    expect(feed["3/2"]).toBeUndefined();
  });
});

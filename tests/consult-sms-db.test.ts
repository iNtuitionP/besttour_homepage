/**
 * OF3-R4 — 상담완료 문자를 **실제 로컬 DB** 에서 증명한다 (마이그레이션 0028).
 *
 *   ① 상담완료(admin_confirm_reservation)는 상태만 바꾼다 — 통지 큐 0건 · enqueued 0.
 *   ② admin_send_reservation_sms — anon·service_role 은 EXECUTE 거부, 명단 밖 로그인은 함수 가드 거부(42501 · 메시지까지).
 *   ③ 상담완료가 아닌 예약(new · 상담완료 뒤 취소 · 없는 id)에는 큐에 넣지 않는다.
 *   ④ 받는 번호는 **그 예약의 전화번호** — 인자로 번호를 받는 서명 자체가 없다(PGRST202).
 *   ⑤ 본문 길이 상한(UTF-8 2000바이트) · 빈 본문 거부(22023).
 *   ⑥ 여러 번 보낼 수 있다 — 직접 쓴 문자 두 통이 모두 sent 가 된다(부분 유니크는 자동 통지에만 걸린다).
 *   ⑦ 표 CHECK — body 는 직접 쓴 문자 키(consult.customer.sms · 문자 채널)에만, 그 키에는 반드시.
 *   ⑧ 발송기 claim 이 body 를 돌려준다(0005·0014 의 `returns setof notifications_log` 가 새 칸을 싣는다).
 *   ⑨ 새 칸·새 함수의 권한 — 카탈로그 실측(has_column_privilege · aclexplode · has_function_privilege).
 *
 * 실행 조건: tests/helpers/load-env-local.ts `dbWriteGate()` — 로컬 스택 + REQUIRE_DB_TESTS=1. 원격이면 닫힌다(고객 개인정보 표).
 * 이 파일은 claim 가능한 pending 행을 만들고 claim 을 부른다 → 블록 전체가 withNotificationsLock() 안에서 돈다(CLAUDE.md §7).
 * 실제 문자는 나가지 않는다 — 발송기·제공자를 부르지 않고, 상태 전이는 0005 의 mark RPC 로만 한다.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { withNotificationsLock } from "./helpers/db-lock";
import { expectFunctionPrivilegeDenied, expectRaisedDenied } from "./helpers/expect-denied";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";
import { runLocalSql, sqlCells } from "./helpers/local-stack-sql";

vi.mock("server-only", () => ({}));

const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) console.warn(`[consult-sms-db] DB 블록 skip — ${gate.reason}`);

const FN = "admin_send_reservation_sms";
const CONSULT_TEMPLATE = "consult.customer.sms";
const GUARD = `${FN}: 관리자 명단에 없는 호출자다`;

describe.skipIf(!gate.allowed || !env.hasServiceRole)("OF3-R4 DB — 상담완료 문자 (로컬 스택 + REQUIRE_DB_TESTS=1)", { timeout: 120_000 }, () => {
  withNotificationsLock();

  const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceHeaders = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const PASSWORD = `of3r4-${randomUUID()}`;
  const emailFor = (who: string) => `of3r4-${RUN}-${who}@example.test`;
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

  /** 행을 직접 심는다(상태 전이 함수를 거치지 않는다). phone 은 저장형 E.164 — 받는 번호 대조에 쓴다. */
  async function seed(status: "new" | "confirmed" | "done" | "cancelled", phone: string, confirmedAt: string | null = null): Promise<string> {
    seq += 1;
    const now = new Date();
    const later = new Date(now.getTime() + 30 * DAY);
    const body: Record<string, unknown> = {
      public_code: `R4${RUN.slice(0, 5).toUpperCase()}${seq}`.slice(0, 12),
      status,
      name: `R4${RUN}`,
      phone,
      intake: "wizard",
      vehicle_slug: "bus45",
      purpose_code: "family",
      origin_code: "SEL",
      destination_code: "BSN",
      waypoint_codes: [],
      trip_type: "oneway",
      depart_at: later.toISOString(),
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
    if (confirmedAt !== null) body.confirmed_at = confirmedAt;
    const ins = await rest("POST", "/reservations", body, "return=representation");
    expect(ins.status, JSON.stringify(ins.body).slice(0, 300)).toBe(201);
    const id = (ins.body as { id: string }[])[0].id;
    made.push(id);
    return id;
  }

  const send = (token: string, id: string, text: string | null) => asUser(token, "POST", `/rpc/${FN}`, { p_id: id, p_body: text });
  interface LogRow {
    id: number;
    event: string;
    channel: string;
    template: string;
    status: string;
    to_phone: string;
    body: string | null;
  }
  const logsOf = async (id: string): Promise<LogRow[]> =>
    (await rest("GET", `/notifications_log?select=id,event,channel,template,status,to_phone,body&reservation_id=eq.${id}&order=id`)).body as LogRow[];
  const consulted = () => new Date(Date.now() - 3_600_000).toISOString();

  beforeAll(async () => {
    const probe = await rest("GET", "/notifications_log?select=body&limit=1");
    expect(probe.status, `0028 이 로컬 스택에 적용되지 않았다 (notifications_log.body 읽기 ${probe.status})`).toBe(200);
    adminId = await createUser(emailFor("admin"));
    await createUser(emailFor("plain"));
    adminToken = await signIn(emailFor("admin"));
    plainToken = await signIn(emailFor("plain"));
    const add = await rest("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "OF3-R4 test" });
    expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);
  });

  afterAll(async () => {
    if (made.length > 0) {
      await rest("DELETE", `/notifications_log?reservation_id=in.(${made.join(",")})`);
      await rest("DELETE", `/reservations?id=in.(${made.join(",")})`);
    }
    await rest("DELETE", `/admin_users?user_id=eq.${adminId}`);
    const list = await call("GET", `${baseUrl()}/auth/v1/admin/users?page=1&per_page=200`, serviceHeaders);
    const users = ((list.body as { users?: { id: string; email: string }[] })?.users ?? []).filter((u) => u.email.startsWith(`of3r4-${RUN}-`));
    for (const u of users) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${u.id}`, serviceHeaders);
  });

  test("① 상담완료는 상태만 바꾼다 — 통지 큐 0건 · enqueued 0 (0028 이 0010 의 확정 통지 적재를 걷었다)", async () => {
    const id = await seed("new", "+821011110001");
    const r = await asUser(adminToken, "POST", "/rpc/admin_confirm_reservation", { p_id: id, p_memo: "R4 memo" });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body).toEqual([{ outcome: "confirmed", public_code: expect.any(String), enqueued: 0 }]);
    const row = (await rest("GET", `/reservations?select=status,confirmed_at,admin_memo&id=eq.${id}`)).body as { status: string; confirmed_at: string | null; admin_memo: string }[];
    expect(row[0]).toMatchObject({ status: "confirmed", admin_memo: "R4 memo" });
    expect(row[0].confirmed_at).not.toBeNull();
    expect(await logsOf(id), "상담완료가 통지를 큐에 넣었다 — 자동 발송은 없어야 한다").toEqual([]);
    // 가드·경합 방어는 그대로 — 두 번째는 noop, 명단 밖은 가드 거부
    expect(((await asUser(adminToken, "POST", "/rpc/admin_confirm_reservation", { p_id: id, p_memo: null })).body as { outcome: string }[])[0].outcome).toBe("noop");
    expectRaisedDenied(
      await asUser(plainToken, "POST", "/rpc/admin_confirm_reservation", { p_id: id, p_memo: null }),
      "admin_confirm_reservation: 관리자 명단에 없는 호출자다",
      "명단 밖 세션의 상담완료",
    );
  });

  test("② 문자 보내기 권한 — anon·service_role 은 EXECUTE 거부 · 명단 밖 로그인은 함수 가드 거부 · 아무것도 쌓이지 않는다", async () => {
    const id = await seed("confirmed", "+821011110002", consulted());
    expectFunctionPrivilegeDenied(await asAnon("POST", `/rpc/${FN}`, { p_id: id, p_body: "x" }), FN, "anon");
    expectFunctionPrivilegeDenied(await rest("POST", `/rpc/${FN}`, { p_id: id, p_body: "x" }), FN, "service_role");
    expectRaisedDenied(await send(plainToken, id, "x"), GUARD, "명단 밖 로그인 세션");
    expect(await logsOf(id)).toEqual([]);
  });

  test("③ 상담완료가 아닌 예약에는 넣지 않는다 — 새 접수 · 상담완료 뒤 취소 · 없는 id", async () => {
    const fresh = await seed("new", "+821011110003");
    expect((await send(adminToken, fresh, "안녕하세요")).body).toEqual([{ outcome: "not_consulted", notification_id: null }]);
    const cancelled = await seed("cancelled", "+821011110004", consulted());
    expect((await send(adminToken, cancelled, "안녕하세요")).body).toEqual([{ outcome: "not_consulted", notification_id: null }]);
    expect((await send(adminToken, randomUUID(), "안녕하세요")).body).toEqual([{ outcome: "noop", notification_id: null }]);
    expect(await logsOf(fresh)).toEqual([]);
    expect(await logsOf(cancelled)).toEqual([]);
  });

  test("④ 받는 번호 = 그 예약의 전화번호 · pending 1건 · 직접 쓴 본문 그대로 — 번호를 인자로 받는 서명은 없다", async () => {
    const phone = "+821055556666";
    const id = await seed("confirmed", phone, consulted());
    const text = `[테스트] 상담 내용 ${RUN}\n■ 대금\n- 계약금`;
    const r = await send(adminToken, id, text);
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const out = r.body as { outcome: string; notification_id: number | null }[];
    expect(out[0].outcome).toBe("queued");
    expect(typeof out[0].notification_id).toBe("number");
    const logs = await logsOf(id);
    expect(logs).toEqual([
      { id: out[0].notification_id, event: "confirmed", channel: "sms", template: CONSULT_TEMPLATE, status: "pending", to_phone: phone, body: text },
    ]);
    // 받는 번호를 고르는 길이 없다 — 세 번째 인자를 붙이면 그런 함수가 없다(PostgREST 404 · PGRST202)
    const withTo = await asUser(adminToken, "POST", `/rpc/${FN}`, { p_id: id, p_body: text, p_to: "+821099999999" });
    expect(withTo.status, JSON.stringify(withTo.body).slice(0, 200)).toBe(404);
    expect((withTo.body as { code?: string }).code).toBe("PGRST202");
    expect((await logsOf(id)).length).toBe(1);
  });

  test("⑤ 본문 — 빈 값·null·UTF-8 2000바이트 초과는 22023 으로 거부 · 2000바이트는 받는다", async () => {
    const id = await seed("confirmed", "+821011110005", consulted());
    for (const [label, text] of [
      ["공백뿐", "   \n  "],
      ["null", null],
      ["2001바이트", `${"가".repeat(666)}abc`], // 1998 + 3 = 2001
    ] as const) {
      const r = await send(adminToken, id, text);
      expect(r.status, `${label}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(400);
      expect((r.body as { code?: string }).code, label).toBe("22023");
    }
    expect(await logsOf(id)).toEqual([]);
    const ok = await send(adminToken, id, `${"가".repeat(666)}ab`); // 2000바이트
    expect((ok.body as { outcome: string }[])[0].outcome).toBe("queued");
  });

  test("⑥ 여러 번 보낼 수 있다 — 직접 쓴 문자 두 통이 모두 sent (자동 통지의 '한 번만' 유니크는 그대로)", async () => {
    const id = await seed("confirmed", "+821011110006", consulted());
    const a = ((await send(adminToken, id, "첫 번째")).body as { notification_id: number }[])[0].notification_id;
    const b = ((await send(adminToken, id, "두 번째")).body as { notification_id: number }[])[0].notification_id;
    for (const nid of [a, b]) {
      const m = await rest("POST", "/rpc/mark_notification_sent", { p_id: nid, p_provider_message_id: `r4-${nid}` });
      expect(m.body, `id ${nid} 를 sent 로 바꾸지 못했다 (부분 유니크에 걸렸다)`).toBe(true);
    }
    expect((await logsOf(id)).map((l) => l.status)).toEqual(["sent", "sent"]);

    // 대조군 — body 없는 자동 통지는 여전히 같은 키로 sent 가 한 번뿐이다(0005 notifications_log_sent_once)
    const auto = { reservation_id: id, event: "created", channel: "sms", to_phone: "+821011110006", template: "created.customer.sms", status: "sent" };
    expect((await rest("POST", "/notifications_log", auto)).status).toBe(201);
    const dup = await rest("POST", "/notifications_log", auto);
    expect(dup.status).toBe(409);
    expect((dup.body as { code?: string }).code).toBe("23505");
  });

  test("⑦ 표 CHECK — body 는 직접 쓴 문자 키(문자 채널)에만 · 그 키에는 반드시 (23514)", async () => {
    const id = await seed("confirmed", "+821011110007", consulted());
    const base = { reservation_id: id, event: "confirmed", to_phone: "+821011110007", status: "pending" };
    for (const [label, row] of [
      ["자동 통지 키에 body", { ...base, channel: "sms", template: "confirmed.customer.sms", body: "x" }],
      ["직접 쓴 문자 키에 body 없음", { ...base, channel: "sms", template: CONSULT_TEMPLATE, body: null }],
      ["직접 쓴 문자 키가 메일 채널", { ...base, channel: "email", template: CONSULT_TEMPLATE, body: "x" }],
      ["body 가 2001바이트", { ...base, channel: "sms", template: CONSULT_TEMPLATE, body: `${"가".repeat(666)}abc` }],
    ] as const) {
      const r = await rest("POST", "/notifications_log", row);
      expect(r.status, `${label}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(400);
      expect((r.body as { code?: string }).code, label).toBe("23514");
    }
    expect(await logsOf(id)).toEqual([]);
  });

  test("⑧ 발송기 claim 이 body 를 싣는다 — 직접 쓴 본문이 그대로 발송기로 간다", async () => {
    const id = await seed("confirmed", "+821011110008", consulted());
    const text = `claim 확인 ${RUN}`;
    const nid = ((await send(adminToken, id, text)).body as { notification_id: number }[])[0].notification_id;
    const claimed = await rest("POST", "/rpc/claim_pending_notifications", { p_limit: 200, p_channels: ["sms"] });
    expect(claimed.status, JSON.stringify(claimed.body).slice(0, 200)).toBe(200);
    const mine = (claimed.body as { id: number; body: string | null; template: string; to_phone: string }[]).find((r) => r.id === nid);
    expect(mine, "claim 이 직접 쓴 문자 행을 집지 않았다").toBeDefined();
    expect(mine).toMatchObject({ body: text, template: CONSULT_TEMPLATE, to_phone: "+821011110008" });
    // 정리 — 집은 행은 sent 로 닫는다(다른 파일의 claim 에 섞이지 않게)
    await rest("POST", "/rpc/mark_notification_sent", { p_id: nid, p_provider_message_id: `r4-${nid}` });
  });

  test("⑨ 권한 실측 — body 칸: anon 0 · authenticated SELECT 만 · PUBLIC 0 / 함수: EXECUTE 는 authenticated 하나 · definer · search_path 고정", () => {
    const out = runLocalSql(`
      select json_build_object(
        'anon', (select string_agg(p, ',') from unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
                  where has_column_privilege('anon', 'public.notifications_log', 'body', p)),
        'auth', (select string_agg(p, ',') from unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
                  where has_column_privilege('authenticated', 'public.notifications_log', 'body', p)),
        'col_public', (select count(*) from pg_attribute a cross join lateral aclexplode(a.attacl) x
                  where a.attrelid = 'public.notifications_log'::regclass and a.attname = 'body' and x.grantee = 0),
        'tbl_public', (select count(*) from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
                  where c.oid = 'public.notifications_log'::regclass and x.grantee = 0),
        'exec', (select string_agg(r, ',' order by r) from unnest(array['anon','authenticated','service_role']) r
                  where has_function_privilege(r, 'public.${FN}(uuid,text)', 'EXECUTE')),
        'exec_public', (select count(*) from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                  where p.oid = 'public.${FN}(uuid,text)'::regprocedure and x.grantee = 0),
        'definer', (select prosecdef from pg_proc where oid = 'public.${FN}(uuid,text)'::regprocedure),
        'cfg', (select array_to_string(proconfig, ' ') from pg_proc where oid = 'public.${FN}(uuid,text)'::regprocedure),
        'confirm_exec', (select string_agg(r, ',' order by r) from unnest(array['anon','authenticated','service_role']) r
                  where has_function_privilege(r, 'public.admin_confirm_reservation(uuid,text)', 'EXECUTE'))
      )::text as v`);
    const cell = sqlCells(out).find((c) => c.startsWith("{"));
    expect(cell, out.slice(0, 500)).toBeDefined();
    expect(JSON.parse(cell as string)).toEqual({
      anon: null,
      auth: "SELECT",
      col_public: 0,
      tbl_public: 0,
      exec: "authenticated",
      exec_public: 0,
      definer: true,
      cfg: "search_path=public, pg_temp",
      confirm_exec: "authenticated",
    });
  });
});

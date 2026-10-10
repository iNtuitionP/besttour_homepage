/**
 * OF-T3-6 — 비밀번호 로그인의 세션 쿠키가 **실제로** 심어지는가 · 비밀번호 변경이 실제로 먹는가 (로컬 스택 + REQUIRE_DB_TESTS=1).
 *
 * 왜 따로 있나: lib/supabase/ssr.ts 의 setAll 은 쿠키 쓰기 실패를 삼킨다(서버 컴포넌트용 — 거기서는 cookies().set 이 던진다).
 * 그래서 mock 단위 테스트(tests/admin-auth.test.ts 4-b)가 "redirect 됐다" 를 단언해도, 쿠키가 하나도 안 심긴 채 관리자 홈으로 보내
 * 다시 로그인 화면으로 튕기는 상태를 잡지 못한다(계획 T3-6 테스트 항목). 여기서는 **진짜 createSsrClient + 진짜 로컬 Auth** 로
 *   1. 틀린 비밀번호 → credentials · 세션 쿠키 0
 *   2. 맞는 비밀번호 → /admin 으로 redirect · sb-*-auth-token 쿠키가 심어짐 · 그 쿠키만으로 getUser() 와 requireAdmin 의 판정(resolveAdminSession)이 통과
 *   3. 내 계정 액션(changeAdminPassword)이 그 쿠키 세션으로 비밀번호를 바꾼다 — 옛 비밀번호는 credentials, 새 비밀번호는 로그인
 *   4. 원격 규칙 오류가 실제 Auth 응답으로도 사람 말 상태가 된다(로컬 하한 6자 → weakLength · 같은 비밀번호 → same)
 * 를 단언한다.
 *
 * 원격에는 어떤 쓰기도 하지 않는다(dbWriteGate). 로컬 config.toml 은 CAPTCHA 가 꺼져 있어 토큰은 형식만 맞춰 보낸다.
 * 이 블록은 통지·갤러리·대표 노선 표를 건드리지 않아 잠금이 필요 없다(CLAUDE.md §7). 만든 사용자·명단 행은 마지막 테스트와 afterAll 에서 지운다.
 * 비밀번호는 매 실행 무작위이고 어디에도 출력하지 않는다.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test, vi } from "vitest";

import type { RateLimiterSet } from "@/lib/guard";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
    this.name = "RedirectSignal";
  }
}

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new RedirectSignal(to);
  }),
}));
vi.mock("@/lib/guard/deps", () => ({ adminGuardDeps: vi.fn() }));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));

import { cookies, headers } from "next/headers";

import { changeAdminPassword } from "@/actions/admin/account";
import { signInAdmin } from "@/actions/admin/auth";
import { ACCOUNT_CONFIRM_PASSWORD_FIELD, ACCOUNT_NEW_PASSWORD_FIELD } from "@/lib/auth/adminAccount";
import { ADMIN_CAPTCHA_FIELD, ADMIN_EMAIL_FIELD, ADMIN_HOME_PATH, ADMIN_MODE_FIELD, ADMIN_PASSWORD_FIELD, MIN_PASSWORD_RESPONSE_MS } from "@/lib/auth/adminLogin";
import { resolveAdminSession } from "@/lib/auth/requireAdmin";
import { adminGuardDeps } from "@/lib/guard/deps";
import { createSsrClient } from "@/lib/supabase/ssr";

const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[admin-password-login.test] DB 블록 skip — ${gate.reason}`);
}

/** 요청 하나의 쿠키 저장소 흉내 — next/headers cookies() 와 같은 getAll/set. 값이 빈 set 은 삭제로 본다. */
function cookieJar() {
  const jar = new Map<string, string>();
  const store = {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    },
  };
  return { jar, store };
}

const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;
const sessionCookies = (jar: Map<string, string>) => [...jar].filter(([name, value]) => SESSION_COOKIE.test(name) && value.length > 0);

function allowAll(): RateLimiterSet {
  const make = () => ({ limit: async () => ({ success: true, reset: 0 }) });
  return { known: { short: make(), long: make() }, unknown: { short: make(), long: make() } };
}

describe.skipIf(!gate.allowed || !env.hasServiceRole)("OF-T3-6 DB — 비밀번호 로그인 쿠키 · 비밀번호 변경 (로컬 스택)", { timeout: 60_000 }, () => {
  const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceHeaders = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const EMAIL = `t36-${RUN}@example.test`;
  const PW1 = `T36-${randomUUID()}`;
  const PW2 = `T36-${randomUUID()}`;
  const savedEmails = process.env.ADMIN_EMAILS;
  let userId = "";

  const call = async (method: string, url: string, json?: unknown) => {
    const res = await fetch(url, { method, headers: serviceHeaders, body: json === undefined ? undefined : JSON.stringify(json) });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as unknown) : null };
  };

  const loginForm = (password: string) => {
    const fd = new FormData();
    fd.set(ADMIN_MODE_FIELD, "password");
    fd.set(ADMIN_EMAIL_FIELD, EMAIL);
    fd.set(ADMIN_PASSWORD_FIELD, password);
    fd.set(ADMIN_CAPTCHA_FIELD, "XXXX.DUMMY.TOKEN.XXXX");
    return fd;
  };

  /** 이 요청의 쿠키 저장소를 jar 로 바꿔 끼운다(서버액션이 cookies() 로 받는 그것). */
  const useJar = (store: ReturnType<typeof cookieJar>["store"]) =>
    vi.mocked(cookies).mockResolvedValue(store as unknown as Awaited<ReturnType<typeof cookies>>);

  async function cleanup(): Promise<void> {
    if (!userId) return;
    await call("DELETE", `${env.restRoot}/admin_users?user_id=eq.${userId}`);
    await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${userId}`);
  }

  afterAll(async () => {
    if (savedEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = savedEmails;
    await cleanup(); // 중간 실패 대비(정상 경로에서는 마지막 테스트가 이미 지웠다)
  });

  test("준비 — 관리자 사용자 1명(메일 확인됨) + 명단 행 · 허용 목록 · 한도 통과", async () => {
    vi.mocked(headers).mockResolvedValue({ get: () => null } as unknown as Awaited<ReturnType<typeof headers>>);
    vi.mocked(adminGuardDeps).mockReturnValue({
      now: () => new Date(),
      secret: "0123456789abcdef0123456789abcdef0123456789abcdef",
      rateLimit: { limiters: allowAll(), timeoutMs: 5_000 },
    });
    process.env.ADMIN_EMAILS = EMAIL;

    const u = await call("POST", `${baseUrl()}/auth/v1/admin/users`, { email: EMAIL, password: PW1, email_confirm: true });
    expect(u.status, "사용자 생성").toBeLessThan(300);
    userId = (u.body as { id: string }).id;
    const add = await call("POST", `${env.restRoot}/admin_users`, { user_id: userId, email: EMAIL, note: "OF-T3-6 test" });
    expect(add.status, "명단 행").toBeLessThan(300);
  });

  test("틀린 비밀번호 → credentials · 세션 쿠키 0 · 바닥(1초)", async () => {
    const { jar, store } = cookieJar();
    useJar(store);
    const t0 = Date.now();
    expect(await signInAdmin(loginForm(`${PW1}-wrong`))).toEqual({ state: "credentials" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(MIN_PASSWORD_RESPONSE_MS - 20);
    expect(sessionCookies(jar)).toEqual([]);
  });

  test("🔴 맞는 비밀번호 → /admin 으로 redirect · 세션 쿠키가 실제로 심어지고 그 쿠키만으로 게이트가 통과한다", async () => {
    const { jar, store } = cookieJar();
    useJar(store);
    const err = await signInAdmin(loginForm(PW1)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RedirectSignal);
    expect((err as RedirectSignal).to).toBe(ADMIN_HOME_PATH);

    const set = sessionCookies(jar);
    expect(set.length, "sb-*-auth-token 쿠키").toBeGreaterThan(0);

    // 새 요청이 그 쿠키만 들고 왔다고 치고 — 세션 확인(getUser · Auth 서버 검증)과 관리자 게이트 판정(is_admin)
    const next = cookieJar();
    for (const [name, value] of jar) next.store.set(name, value);
    const { data } = await createSsrClient(next.store).auth.getUser();
    expect(data.user?.id).toBe(userId);
    useJar(next.store);
    expect(await resolveAdminSession()).toEqual({ userId, email: EMAIL });
  });

  test("내 계정 — 그 쿠키 세션으로 비밀번호를 바꾼다. 옛 비밀번호는 credentials, 새 비밀번호로 로그인된다", async () => {
    const login = cookieJar();
    useJar(login.store);
    await expect(signInAdmin(loginForm(PW1))).rejects.toBeInstanceOf(RedirectSignal);
    expect(sessionCookies(login.jar).length).toBeGreaterThan(0);

    // 실제 Auth 의 거부도 사람 말 상태로 — 로컬 하한(config.toml minimum_password_length = 6) · 같은 비밀번호
    const form = (pw: string) => {
      const fd = new FormData();
      fd.set(ACCOUNT_NEW_PASSWORD_FIELD, pw);
      fd.set(ACCOUNT_CONFIRM_PASSWORD_FIELD, pw);
      return fd;
    };
    expect(await changeAdminPassword(form("12345"))).toEqual({ state: "weakLength" });
    expect(await changeAdminPassword(form(PW1))).toEqual({ state: "same" });
    expect(await changeAdminPassword(form(PW2))).toEqual({ state: "changed" });

    const old = cookieJar();
    useJar(old.store);
    expect(await signInAdmin(loginForm(PW1))).toEqual({ state: "credentials" });
    expect(sessionCookies(old.jar)).toEqual([]);

    const fresh = cookieJar();
    useJar(fresh.store);
    await expect(signInAdmin(loginForm(PW2))).rejects.toBeInstanceOf(RedirectSignal);
    expect(sessionCookies(fresh.jar).length).toBeGreaterThan(0);
  });

  test("세션 없이 부른 비밀번호 변경은 로그인 화면으로 — 비밀번호가 바뀌지 않는다", async () => {
    const empty = cookieJar();
    useJar(empty.store);
    const fd = new FormData();
    fd.set(ACCOUNT_NEW_PASSWORD_FIELD, `${PW2}-x`);
    fd.set(ACCOUNT_CONFIRM_PASSWORD_FIELD, `${PW2}-x`);
    await expect(changeAdminPassword(fd)).rejects.toBeInstanceOf(RedirectSignal);
    // PW2 가 그대로 살아 있다
    const again = cookieJar();
    useJar(again.store);
    await expect(signInAdmin(loginForm(PW2))).rejects.toBeInstanceOf(RedirectSignal);
  });

  test("정리 — 명단 행 · 사용자 삭제", async () => {
    await cleanup();
    const left = await call("GET", `${env.restRoot}/admin_users?select=user_id&user_id=eq.${userId}`);
    expect(left.body).toEqual([]);
    const gone = await call("GET", `${baseUrl()}/auth/v1/admin/users/${userId}`);
    expect(gone.status).toBe(404);
    userId = "";
  });
});

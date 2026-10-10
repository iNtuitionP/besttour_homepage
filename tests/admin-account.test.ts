/**
 * OF-T3-6 — 관리자 비밀번호 변경(내 계정) · 로그인 화면 렌더 (사장님 요청 13 · 결정 6).
 *
 * 이 파일이 잠그는 것
 *   1. 비밀번호 변경은 **requireAdmin 뒤에만** 돈다 — 세션 없음·명단 밖이면 updateUser 를 부르지 않고 로그인 화면으로 간다
 *   2. 입력 판정(빈 칸·불일치·72자 초과)은 Supabase 를 부르지 않는다 · 하한은 원격 규칙에 맡긴다(짧아도 서버는 보낸다)
 *   3. 원격 오류 → 사람 말 상태(weak_password 의 reasons · same_password · reauthentication_needed · 그 밖)
 *   4. 비밀번호가 로그·응답·DOM 에 남지 않는다
 *   5. 화면 렌더(ko) — 로그인: 메일 + 비밀번호 기본 · 메일 링크 보조 · Turnstile(action admin) · 사이트 키 없으면 닫힘 /
 *      내 계정: 두 칸 new-password · 주소 읽기 전용
 * 쿠키가 실제로 심어지는지(로컬 스택)는 tests/admin-password-login.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

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
vi.mock("next/image", () => ({
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => createElement("img", { src, alt, className }),
}));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("@/lib/supabase/ssr", () => ({ createSsrClient: vi.fn() }));
vi.mock("@/lib/guard/deps", () => ({ adminGuardDeps: vi.fn() }));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));
vi.mock("next-intl/server", async () => {
  const { createTranslator: ct } = await import("next-intl");
  const { readFileSync: rf } = await import("node:fs");
  const p = await import("node:path");
  const messages = JSON.parse(rf(p.resolve(import.meta.dirname, "..", "messages", "ko.json"), "utf8"));
  return {
    getTranslations: vi.fn(async (opts?: { namespace?: string } | string) => {
      const namespace = typeof opts === "string" ? opts : opts?.namespace;
      return ct({ locale: "ko", messages, namespace: namespace as never });
    }),
  };
});

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { changeAdminPassword } from "@/actions/admin/account";
import AdminAccountPage from "@/app/admin/(protected)/account/page";
import AdminLoginPage from "@/app/admin/login/page";
import {
  ACCOUNT_CONFIRM_PASSWORD_FIELD,
  ACCOUNT_NEW_PASSWORD_FIELD,
  ACCOUNT_STATES,
  accountStateFromAuthError,
  checkPasswordInput,
} from "@/lib/auth/adminAccount";
import { ADMIN_LOGIN_PATH, ADMIN_PASSWORD_MAX_LENGTH } from "@/lib/auth/adminLogin";
import { adminGuardDeps } from "@/lib/guard/deps";
import { structuredLog } from "@/lib/log";
import { createSsrClient } from "@/lib/supabase/ssr";

const ROOT = path.resolve(import.meta.dirname, "..");
const ko = JSON.parse(readFileSync(path.join(ROOT, "messages/ko.json"), "utf-8")) as { admin: Record<string, Record<string, string>> };
const L = ko.admin.login;
const A = ko.admin.account;

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const tags = (h: string, name: string) => [...h.matchAll(new RegExp(`<${name}\\b[^>]*>`, "g"))].map((m) => m[0]);
const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const has = (tag: string, name: string) => new RegExp(`\\s${name}(=|\\s|>|/)`).test(tag);

const ADMIN_EMAIL = "boss@bestour.co.kr";
const NEW_PW = "Brand-New-Pass-2026";

/** 세션·명단·updateUser 를 흉내 내는 가짜 SSR 클라이언트 — 네트워크 0. */
function fakeClient(opts: { user?: { id: string; email?: string } | null; isAdmin?: unknown; updateError?: object | null; updateThrows?: boolean } = {}) {
  const signOut = vi.fn(async () => ({ error: null }));
  const getUser = vi.fn(async () => ({ data: { user: opts.user === undefined ? { id: "u-1", email: ADMIN_EMAIL } : opts.user }, error: null }));
  const rpc = vi.fn(async () => ({ data: opts.isAdmin === undefined ? true : opts.isAdmin, error: null }));
  const updateUser = vi.fn<(args: { password: string }) => Promise<{ data: { user: null }; error: object | null }>>(async () => {
    if (opts.updateThrows) throw new Error("fetch failed");
    return { data: { user: null }, error: opts.updateError ?? null };
  });
  return { client: { auth: { getUser, signOut, updateUser }, rpc }, signOut, getUser, rpc, updateUser };
}

function pwChangeForm(next: string | null, confirm: string | null): FormData {
  const fd = new FormData();
  if (next !== null) fd.set(ACCOUNT_NEW_PASSWORD_FIELD, next);
  if (confirm !== null) fd.set(ACCOUNT_CONFIRM_PASSWORD_FIELD, confirm);
  return fd;
}

beforeEach(() => {
  vi.mocked(cookies).mockResolvedValue({ getAll: () => [], set: () => {} } as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(createSsrClient).mockReset();
  vi.mocked(redirect).mockClear();
  vi.mocked(structuredLog).mockClear();
});

// =============================================================================
// 1. requireAdmin 뒤에만
// =============================================================================
describe("1. changeAdminPassword — requireAdmin 뒤에만 돈다", () => {
  test("세션이 없으면 로그인 화면으로 가고 updateUser 는 부르지 않는다", async () => {
    const f = fakeClient({ user: null });
    vi.mocked(createSsrClient).mockReturnValue(f.client as never);
    await expect(changeAdminPassword(pwChangeForm(NEW_PW, NEW_PW))).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith(ADMIN_LOGIN_PATH);
    expect(f.updateUser).not.toHaveBeenCalled();
  });

  test("명단 밖 세션(is_admin false)이면 로그아웃시키고 로그인 화면 — updateUser 0", async () => {
    const f = fakeClient({ isAdmin: false });
    vi.mocked(createSsrClient).mockReturnValue(f.client as never);
    await expect(changeAdminPassword(pwChangeForm(NEW_PW, NEW_PW))).rejects.toBeInstanceOf(RedirectSignal);
    expect(f.signOut).toHaveBeenCalledTimes(1);
    expect(f.updateUser).not.toHaveBeenCalled();
  });

  test("관리자 세션이면 세션 사용자 자신의 비밀번호를 바꾼다 — updateUser({ password }) 한 번 · changed", async () => {
    const f = fakeClient();
    vi.mocked(createSsrClient).mockReturnValue(f.client as never);
    expect(await changeAdminPassword(pwChangeForm(NEW_PW, NEW_PW))).toEqual({ state: "changed" });
    expect(f.updateUser).toHaveBeenCalledTimes(1);
    expect(f.updateUser.mock.calls[0][0]).toEqual({ password: NEW_PW });
    // 게이트(getUser → is_admin)가 updateUser 보다 먼저다
    expect(f.getUser.mock.invocationCallOrder[0]).toBeLessThan(f.updateUser.mock.invocationCallOrder[0]);
    expect(f.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.updateUser.mock.invocationCallOrder[0]);
  });
});

// =============================================================================
// 2. 입력 판정 · 3. 원격 오류
// =============================================================================
describe("2. 입력 판정 — Supabase 를 부르지 않는다 · 하한은 원격에 맡긴다", () => {
  test.for([
    ["빈 칸", "", ""],
    ["확인 칸 없음", NEW_PW, null],
    ["불일치", NEW_PW, `${NEW_PW}x`],
    ["72자 초과", "a".repeat(ADMIN_PASSWORD_MAX_LENGTH + 1), "a".repeat(ADMIN_PASSWORD_MAX_LENGTH + 1)],
  ] as const)("%s → 상태만 돌려주고 updateUser 0", async ([, next, confirm]) => {
    const f = fakeClient();
    vi.mocked(createSsrClient).mockReturnValue(f.client as never);
    const r = await changeAdminPassword(pwChangeForm(next, confirm));
    expect(r.state).not.toBe("changed");
    expect(f.updateUser).not.toHaveBeenCalled();
  });

  test("checkPasswordInput — empty · mismatch · tooLong · 통과(null). 짧은 비밀번호도 통과한다(하한은 원격 규칙)", () => {
    expect(checkPasswordInput("", "")).toBe("empty");
    expect(checkPasswordInput(null, "a")).toBe("empty");
    expect(checkPasswordInput("abc", "abd")).toBe("mismatch");
    expect(checkPasswordInput("a".repeat(73), "a".repeat(73))).toBe("tooLong");
    expect(checkPasswordInput("a".repeat(72), "a".repeat(72))).toBeNull();
    expect(checkPasswordInput("short", "short")).toBeNull();
    expect(checkPasswordInput(" sp ", " sp ")).toBeNull(); // 공백도 비밀번호의 일부 — trim 하지 않는다
  });
});

describe("3. 원격 오류 → 사람 말 상태", () => {
  test("accountStateFromAuthError — code 와 reasons 만 본다(문구에 기대지 않는다)", () => {
    expect(accountStateFromAuthError(null)).toBe("changed");
    expect(accountStateFromAuthError({ code: "weak_password", reasons: ["length"] })).toBe("weakLength");
    expect(accountStateFromAuthError({ code: "weak_password", reasons: ["characters"] })).toBe("weakCharacters");
    expect(accountStateFromAuthError({ code: "weak_password", reasons: ["pwned"] })).toBe("weakPwned");
    expect(accountStateFromAuthError({ code: "weak_password", reasons: ["characters", "length"] })).toBe("weakLength");
    expect(accountStateFromAuthError({ code: "weak_password" })).toBe("weakLength");
    expect(accountStateFromAuthError({ code: "same_password" })).toBe("same");
    expect(accountStateFromAuthError({ code: "reauthentication_needed" })).toBe("reauth");
    expect(accountStateFromAuthError({ code: "over_request_rate_limit" })).toBe("failed");
    expect(accountStateFromAuthError({})).toBe("failed");
  });

  test.for([
    [{ code: "weak_password", reasons: ["length"], message: "Password should be at least 10 characters." }, "weakLength"],
    [{ code: "same_password", message: "New password should be different from the old password." }, "same"],
    [{ code: "reauthentication_needed", message: "Password update requires reauthentication." }, "reauth"],
  ] as const)("원격 거부 %j → %s", async ([error, state]) => {
    const f = fakeClient({ updateError: error });
    vi.mocked(createSsrClient).mockReturnValue(f.client as never);
    expect(await changeAdminPassword(pwChangeForm(NEW_PW, NEW_PW))).toEqual({ state });
  });

  test("네트워크 오류(throw) → failed", async () => {
    const f = fakeClient({ updateThrows: true });
    vi.mocked(createSsrClient).mockReturnValue(f.client as never);
    expect(await changeAdminPassword(pwChangeForm(NEW_PW, NEW_PW))).toEqual({ state: "failed" });
  });

  test("🔴 비밀번호는 로그·응답에 남지 않는다(응답은 상태 이름 하나)", async () => {
    const f = fakeClient({ updateError: { code: "weak_password", reasons: ["length"], message: `bad ${NEW_PW}` } });
    vi.mocked(createSsrClient).mockReturnValue(f.client as never);
    const r = await changeAdminPassword(pwChangeForm(NEW_PW, NEW_PW));
    expect(Object.keys(r)).toEqual(["state"]);
    expect(JSON.stringify(r)).not.toContain(NEW_PW);
    const f2 = fakeClient();
    vi.mocked(createSsrClient).mockReturnValue(f2.client as never);
    await changeAdminPassword(pwChangeForm(NEW_PW, NEW_PW));
    const logged = JSON.stringify(vi.mocked(structuredLog).mock.calls);
    expect(logged).toContain("weak_password");
    expect(logged).not.toContain(NEW_PW);
    expect(logged).not.toContain(ADMIN_EMAIL);
  });

  test("상태마다 화면 문구가 있다(ko · 해요체)", () => {
    for (const k of ACCOUNT_STATES) {
      expect(A[k], k).toBeTruthy();
      expect(A[k], k).not.toMatch(/니다(?=[\s.,!?…]|$)/u);
    }
  });
});

// =============================================================================
// 5. 화면 렌더 (ko)
// =============================================================================
async function renderPage(node: Promise<ReactNode> | ReactNode): Promise<string> {
  return renderToStaticMarkup(createElement("div", null, await node));
}

describe("5-a. 로그인 화면 렌더", () => {
  const saved = { emails: process.env.ADMIN_EMAILS, key: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY };
  const restore = () => {
    if (saved.emails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = saved.emails;
    if (saved.key === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = saved.key;
  };

  beforeEach(() => {
    vi.mocked(adminGuardDeps).mockReturnValue({} as never);
  });

  test("메일 + 비밀번호가 기본 · 메일 링크는 보조 버튼 · Turnstile(action admin) · 한국어", async () => {
    try {
      process.env.ADMIN_EMAILS = ADMIN_EMAIL;
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
      const html = await renderPage(AdminLoginPage({ searchParams: Promise.resolve({}) }));
      const t = text(html);
      for (const k of ["title", "sub", "emailLabel", "passwordLabel", "submit", "linkHint", "linkSubmit"]) expect(t, k).toContain(L[k]);

      const inputs = tags(html, "input");
      const email = inputs.find((i) => attr(i, "name") === "email")!;
      const pw = inputs.find((i) => attr(i, "name") === "password")!;
      expect(attr(email, "type")).toBe("email");
      expect(attr(email, "autoComplete") ?? attr(email, "autocomplete")).toBe("username");
      expect(attr(pw, "type")).toBe("password");
      expect(attr(pw, "autoComplete") ?? attr(pw, "autocomplete")).toBe("current-password");
      expect(has(pw, "value"), "비밀번호 칸에 값이 실려 나가지 않는다").toBe(false);
      expect(has(pw, "disabled")).toBe(false);

      // 제출 버튼 둘 — 첫 번째(엔터 키)가 비밀번호, 두 번째가 메일 링크
      const submits = tags(html, "button").filter((b) => attr(b, "type") === "submit");
      expect(submits.map((b) => [attr(b, "name"), attr(b, "value")])).toEqual([
        ["mode", "password"],
        ["mode", "link"],
      ]);
      expect(html.indexOf(L.submit)).toBeLessThan(html.indexOf(L.linkSubmit));

      // Turnstile 자리 — 관리자 전용 action
      expect(html).toMatch(/data-testid="turnstile"[^>]*data-action="admin"/);
      // 허니팟은 그대로
      expect(inputs.some((i) => attr(i, "name") === "website" && attr(i, "aria-hidden") === "true")).toBe(true);
    } finally {
      restore();
    }
  });

  test("사이트 키가 없으면 닫힌다 — '지금은 받을 수 없어요' 안내 · 입력·버튼 비활성 · 위젯 없음", async () => {
    try {
      process.env.ADMIN_EMAILS = ADMIN_EMAIL;
      delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
      const html = await renderPage(AdminLoginPage({ searchParams: Promise.resolve({}) }));
      expect(text(html)).toContain(L.unavailable);
      expect(html).not.toContain('data-testid="turnstile"');
      for (const b of tags(html, "button")) expect(has(b, "disabled"), b).toBe(true);
      for (const i of tags(html, "input").filter((x) => ["email", "password"].includes(attr(x, "name") ?? ""))) expect(has(i, "disabled"), i).toBe(true);
    } finally {
      restore();
    }
  });

  test("허용 목록이 비면 closed 가 먼저다(사이트 키가 있어도)", async () => {
    try {
      delete process.env.ADMIN_EMAILS;
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
      const html = await renderPage(AdminLoginPage({ searchParams: Promise.resolve({}) }));
      expect(text(html)).toContain(L.closed);
    } finally {
      restore();
    }
  });
});

describe("6. 매뉴얼 동조화 — 매뉴얼이 인용한 화면 문구가 카탈로그와 한 글자도 다르지 않다", () => {
  const manual = readFileSync(path.join(ROOT, "docs/ops/admin-manual.md"), "utf-8");
  test.for([
    ["login", "submitting"],
    ["login", "linkSubmit"],
    ["login", "credentials"],
    ["login", "captchaWaiting"],
    ["login", "unavailable"],
    ["account", "newPasswordLabel"],
    ["account", "confirmPasswordLabel"],
    ["account", "submit"],
    ["account", "changed"],
    ["tabs", "myAccount"],
  ] as const)("admin.%s.%s", ([ns, key]) => {
    expect(manual).toContain(ko.admin[ns][key]);
  });

  test("'비밀번호가 없습니다' 라는 옛 서술이 남아 있지 않다 · 결정 번복과 수용한 위험이 적혀 있다", () => {
    expect(manual).not.toMatch(/비밀번호가 없습니다|이 화면에는 비밀번호가 없고/);
    expect(manual).toMatch(/네이버웍스\(회사 메일\) 비밀번호와 같은 것/);
    expect(manual).toMatch(/OTP\)은 붙이지 않습니다/);
  });
});

describe("5-b. 내 계정 화면 렌더", () => {
  test("게이트 뒤에서 열린다 — 제목 '내 계정' · 주소 읽기 전용(username) · 새 비밀번호 두 칸(new-password · 값 없음) · 저장 버튼", async () => {
    const f = fakeClient();
    vi.mocked(createSsrClient).mockReturnValue(f.client as never);
    const html = await renderPage(AdminAccountPage());
    const t = text(html);
    for (const k of ["title", "sub", "emailLabel", "newPasswordLabel", "confirmPasswordLabel", "hint", "submit"]) expect(t, k).toContain(A[k]);
    const inputs = tags(html, "input");
    const email = inputs.find((i) => attr(i, "type") === "email")!;
    expect(attr(email, "value")).toBe(ADMIN_EMAIL);
    expect(has(email, "readOnly") || has(email, "readonly")).toBe(true);
    expect(has(email, "name"), "주소 칸은 서버로 보내지 않는다(바꾸는 대상은 세션 사용자)").toBe(false);
    const pws = inputs.filter((i) => attr(i, "type") === "password");
    expect(pws.map((i) => attr(i, "name"))).toEqual([ACCOUNT_NEW_PASSWORD_FIELD, ACCOUNT_CONFIRM_PASSWORD_FIELD]);
    for (const p of pws) {
      expect(attr(p, "autoComplete") ?? attr(p, "autocomplete")).toBe("new-password");
      expect(has(p, "value")).toBe(false);
    }
  });

  test("세션이 없으면 화면이 열리지 않는다(redirect)", async () => {
    vi.mocked(createSsrClient).mockReturnValue(fakeClient({ user: null }).client as never);
    await expect(AdminAccountPage()).rejects.toBeInstanceOf(RedirectSignal);
  });
});

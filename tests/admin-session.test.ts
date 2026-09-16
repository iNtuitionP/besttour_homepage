/**
 * P5-11 — 관리자 **로그아웃**(D5) + 삭제 확인 단계 통일 (플랜 v4 P5-11 · CLAUDE.md §3·§6·§7).
 *
 * 이 태스크 전까지 사장님이 관리자 화면에서 스스로 나갈 방법이 없었다. `signOut()` 은 저장소 전체에서
 * lib/auth/requireAdmin.ts 한 곳뿐이었고 그것은 **명단 밖 사용자를 쫓아내는 강제 경로**다.
 * 그 화면에는 손님 이름과 원문 전화번호가 마스킹 없이 보인다.
 *
 * 이 파일이 지키는 것 여섯 가지:
 *   1. 로그아웃 액션이 **게이트를 우회하지 않고 탄다** — 첫 문장이 `await requireAdmin();` 이고,
 *      scripts/check-admin-gate.mjs 의 예외 목록은 **5건 그대로**다(늘지 않았다).
 *   2. 그 게이트를 일부러 빼면 스크립트가 **실패한다**(임시 픽스처로 실측 — 저장소 파일은 건드리지 않는다).
 *   3. ADR-3 — 'use server' 모듈의 export 가 정확히 하나.
 *   4. 동작 — signOut 뒤 /admin/login 으로 redirect. 명단 밖 세션이 쳐도 안전(강제 로그아웃 + redirect).
 *   5. **POST 전용** — 링크·라우트 핸들러로는 로그아웃되지 않는다(프리페치·크롤러가 사장님을 내보내면 안 된다).
 *   6. 삭제 확인은 어느 화면이든 **두 단계**(무장 체크박스 + 확인창)이고, 매뉴얼이 인용한 화면 문구가 카탈로그와 같다.
 *
 * tests/ 아래라 게이트 3종의 검사 대상이다 — 픽스처 소스의 `use server` 는 **문자열일 뿐** 이라
 * 이 파일이 서버액션으로 오인되지 않는다(AST 게이트의 요점).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PUBLIC_ACTIONS, PUBLIC_ROUTES } from "../scripts/check-admin-gate.mjs";
import { stripComments } from "./helpers/strip-comments";

// server-only 는 vitest(node) 에서 import 즉시 throw 한다 — 빈 모듈로 바꿔치기(admin-auth.test.ts 선례).
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new RedirectSignal(to);
  }),
}));
vi.mock("@/lib/supabase/ssr", () => ({ createSsrClient: vi.fn() }));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOutAdmin } from "@/actions/admin/session";
import { ADMIN_LOGIN_PATH } from "@/lib/auth/adminLogin";
import { createSsrClient } from "@/lib/supabase/ssr";

/** next/navigation redirect() 는 실제로 throw 한다 — mock 도 같은 모양이어야 뒤 코드가 실행되지 않는다. */
class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
    this.name = "RedirectSignal";
  }
}

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const exists = (rel: string) => existsSync(path.join(ROOT, rel));
const code = (rel: string) => stripComments(read(rel), rel);

const SESSION_ACTION = "actions/admin/session.ts";
const PROTECTED_LAYOUT = "app/admin/(protected)/layout.tsx";
const TABS_UI = "components/admin/AdminTabs.tsx";
const POPUP_FORM = "components/admin/PopupForm.tsx";
const NOTICE_FORM = "components/admin/NoticeForm.tsx";
const PHOTO_CARD = "components/admin/GalleryPhotoCard.tsx";
const ALBUMS_UI = "components/admin/GalleryAlbums.tsx";
const ADMIN_CSS = "components/admin/admin.module.css";
const MANUAL = "docs/ops/admin-manual.md";
const GATE_SCRIPT = path.join(ROOT, "scripts/check-admin-gate.mjs");
const GATE_TIMEOUT_MS = 60_000;

const ko = JSON.parse(read("messages/ko.json")) as {
  admin: Record<string, Record<string, unknown>>;
};
const adminMsg = (namespace: string, key: string): string => String(ko.admin[namespace][key]);

// =============================================================================
// 0. 산출물 · 배선
// =============================================================================
describe("0. 산출물", () => {
  test("로그아웃 액션 파일이 생겼고, 관리자 영역의 다른 산출물은 그대로다", () => {
    expect(exists(SESSION_ACTION), SESSION_ACTION).toBe(true);
    expect(exists(PROTECTED_LAYOUT)).toBe(true);
    expect(exists(TABS_UI)).toBe(true);
  });

  test("레이아웃이 로그아웃 라벨을 기본 로케일 카탈로그에서 풀어 탭 줄에 내린다 (관리자 영역은 로케일 밖)", () => {
    const src = code(PROTECTED_LAYOUT);
    expect(src, "admin.session 네임스페이스를 서버에서 푼다").toMatch(/namespace:\s*"admin\.session"/);
    expect(src).toMatch(/signOutLabel=\{/);
    expect(src, "클라이언트에서 useTranslations 를 쓸 수 없다").not.toMatch(/useTranslations/);
  });

  test("messages/ko.json — admin.session.signOut 이 생겼고 admin 은 여전히 마지막 최상위 키다. en 은 비어 있다", () => {
    const keys = Object.keys(JSON.parse(read("messages/ko.json")) as Record<string, unknown>);
    expect(keys[keys.length - 1]).toBe("admin");
    expect(adminMsg("session", "signOut")).toBeTruthy();
    expect(JSON.parse(read("messages/en.json"))).toEqual({});
  });

  test("CSS — 로그아웃 버튼 클래스가 admin.module.css 에 있고 색은 역할 토큰뿐이다", () => {
    const css = read(ADMIN_CSS);
    expect(css).toMatch(/\.signOut\s*\{/);
    const block = css.slice(css.indexOf(".signOut {"), css.indexOf(".signOut:focus-visible"));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\brgba?\(/);
  });
});

// =============================================================================
// 1. 게이트 — 화이트리스트를 늘리지 않고 기존 게이트를 탄다
// =============================================================================
interface GateResult {
  status: number | null;
  out: string;
}

function runGate(projectDir: string): Promise<GateResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [GATE_SCRIPT], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      windowsHide: true,
    });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => {
      out += c;
    });
    child.stderr.setEncoding("utf8").on("data", (c: string) => {
      out += c;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, out }));
  });
}

/**
 * 저장소를 흉내 낸 최소 픽스처. **로그아웃 액션만 저장소의 실제 소스**를 그대로 넣는다 —
 * 그래야 "게이트를 빼면 실패한다" 가 가짜 샘플이 아니라 배포되는 그 파일에 대한 실측이 된다.
 * 픽스처는 테스트가 끝나면 지워진다(tests/admin-gate.test.ts 와 같은 방식).
 */
function seedFixture(dir: string, sessionSource: string): void {
  const put = (rel: string, content: string): void => {
    const p = path.join(dir, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  const SERVER = '"use server";';
  const publicAction = (fn: string): string =>
    [SERVER, "", `export async function ${fn}(): Promise<number> {`, "  return 1;", "}", ""].join("\n");

  put(
    "lib/auth/requireAdmin.ts",
    [
      "export interface AdminSession {",
      "  userId: string;",
      "  email: string;",
      "}",
      "",
      "export async function resolveAdminSession(): Promise<AdminSession | null> {",
      "  return null;",
      "}",
      "",
      "export async function requireAdmin(): Promise<AdminSession> {",
      '  return { userId: "u", email: "e" };',
      "}",
      "",
    ].join("\n"),
  );
  put("actions/reservation.ts", publicAction("submitReservation"));
  put("actions/reservation-check.ts", publicAction("checkReservation"));
  put("actions/admin/auth.ts", publicAction("requestAdminLoginLink"));
  put("app/admin/login/page.tsx", ["export default function LoginPage() {", "  return null;", "}", ""].join("\n"));
  put("app/admin/auth/callback/route.ts", ["export async function GET(): Promise<Response> {", "  return new Response(null);", "}", ""].join("\n"));
  put(SESSION_ACTION, sessionSource);
}

describe("1. 게이트", { timeout: GATE_TIMEOUT_MS }, () => {
  /**
   * 예외 목록에 한 줄을 더하는 것이 이 저장소에서 인가를 무르게 만드는 가장 싼 방법이다.
   * 로그아웃은 **이미 들어와 있는 사람이 나가는 동작**이라 게이트를 부를 수 있고, 불러야 한다 —
   * 그래서 목록이 5건 그대로여야 한다(tests/admin-gate.test.ts 가 항목 하나하나를 단언한다).
   */
  test("예외(인증 전) 화이트리스트가 5건 그대로다 — 로그아웃은 예외가 아니다", () => {
    expect([...PUBLIC_ACTIONS, ...PUBLIC_ROUTES]).toHaveLength(5);
    expect([...PUBLIC_ACTIONS]).toHaveLength(3);
    expect([...PUBLIC_ROUTES]).toHaveLength(2);
    expect([...PUBLIC_ACTIONS], "로그아웃 액션이 예외 목록에 들어가면 안 된다").not.toContain(SESSION_ACTION);
    expect([...PUBLIC_ROUTES]).not.toContain(SESSION_ACTION);
  });

  test("액션의 첫 문장이 게이트다 — 조건·try·앞선 return 없이 그대로 `await requireAdmin();`", () => {
    const src = code(SESSION_ACTION);
    expect(src.split("\n")[0].trim()).toMatch(/^["']use server["'];?$/);
    expect(src).toMatch(/import\s*\{\s*requireAdmin\s*\}\s*from\s*"@\/lib\/auth\/requireAdmin";/);
    expect(src).toMatch(/export async function signOutAdmin\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
  });

  test("게이트가 새 파일을 검사 대상으로 잡고 통과시킨다 (픽스처 exit 0)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bestour-p511-green-"));
    try {
      seedFixture(dir, read(SESSION_ACTION));
      const r = await runGate(dir);
      expect(r.status, r.out).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("게이트를 일부러 빼면 **실패한다** — 첫 문장의 await requireAdmin(); 제거 (픽스처 exit 1)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bestour-p511-red-"));
    try {
      const broken = read(SESSION_ACTION)
        .split("\n")
        .filter((l) => !/^\s*await requireAdmin\(\);\s*$/.test(l))
        .join("\n");
      // 주석에도 게이트 문장이 설명으로 적혀 있다 — 코드에서 사라졌는지를 본다(파서로 주석 제거).
      expect(
        stripComments(broken, SESSION_ACTION),
        "제거가 실제로 일어났는지 확인 — 안 그러면 이 red 테스트는 아무것도 지키지 않는다",
      ).not.toMatch(/await requireAdmin\(\);/);
      seedFixture(dir, broken);
      const r = await runGate(dir);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain("signOutAdmin");
      expect(r.out).toContain(SESSION_ACTION);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("게이트를 if 로 감싸도 실패한다 — 조건부 게이트는 게이트가 아니다 (P5-3 리뷰 F1)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bestour-p511-if-"));
    try {
      const broken = read(SESSION_ACTION).replace(
        /^\s*await requireAdmin\(\);\s*$/m,
        "  if (process.argv.length > 0) await requireAdmin();",
      );
      seedFixture(dir, broken);
      const r = await runGate(dir);
      expect(r.status, r.out).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// 2. ADR-3 — 'use server' 모듈의 export 는 정확히 하나
// =============================================================================
describe("2. ADR-3 export 규약", () => {
  test("액션 파일 — 'use server' 첫 줄 · export 1개 · async 함수", () => {
    const src = code(SESSION_ACTION);
    const exports = [...src.matchAll(/^export\s/gm)];
    expect(exports.length, "'use server' 파일의 export 는 전부 공개 POST 엔드포인트가 된다 (ADR-3)").toBe(1);
    expect(src).toMatch(/export async function signOutAdmin/);
  });

  test("서비스 롤을 부르지 않는다 (ADR-2) · 환경변수 분기 0", () => {
    const src = code(SESSION_ACTION);
    expect(src).not.toMatch(/SERVICE_ROLE|createServiceClient|service_role/i);
    expect(src).not.toMatch(/process\s*\.\s*env|NODE_ENV/);
  });

  test("로그에 주소·user id·오류 메시지를 싣지 않는다 (requireAdmin.ts 와 같은 규약)", () => {
    const src = code(SESSION_ACTION);
    expect(src).not.toMatch(/\bemail\b/);
    expect(src).not.toMatch(/userId/);
    expect(src, "오류 메시지에는 주소가 섞여 올 수 있다 — name 만 남긴다").not.toMatch(/error\.message|err\.message/);
  });
});

// =============================================================================
// 3. 동작 — 게이트를 태운 뒤 signOut → /admin/login
// =============================================================================
interface FakeClient {
  auth: {
    getUser: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
  };
  rpc: ReturnType<typeof vi.fn>;
}

function fakeClient(opts: { user?: { id: string; email: string } | null; isAdmin?: unknown; signOutError?: { name: string } | null }): FakeClient {
  const user = opts.user === undefined ? { id: "admin-uuid", email: "owner@example.test" } : opts.user;
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
      signOut: vi.fn(async () => ({ error: opts.signOutError ?? null })),
    },
    rpc: vi.fn(async () => ({ data: opts.isAdmin ?? true, error: null })),
  };
}

/** 액션을 부르고 redirect 대상을 돌려준다. redirect 가 없으면 실패다(로그인된 화면 앞에 남으면 안 된다). */
async function callSignOut(): Promise<string> {
  try {
    await signOutAdmin();
  } catch (err) {
    if (err instanceof RedirectSignal) return err.to;
    throw err;
  }
  throw new Error("signOutAdmin() 이 redirect 하지 않고 정상 반환했다");
}

describe("3. signOutAdmin 동작", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue({ getAll: () => [], set: () => {} } as never);
  });

  afterEach(() => {
    vi.mocked(createSsrClient).mockReset();
  });

  test("관리자 — 게이트를 먼저 타고(getUser → is_admin) 그 다음 signOut, 그리고 /admin/login 으로 redirect", async () => {
    const client = fakeClient({});
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    expect(await callSignOut()).toBe(ADMIN_LOGIN_PATH);
    expect(client.auth.getUser).toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith("is_admin");
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(
      client.auth.getUser.mock.invocationCallOrder[0],
      "게이트가 signOut 보다 먼저 돈다 — 우회 경로가 아니라 게이트를 타는 것이 이 설계의 핵심이다",
    ).toBeLessThan(client.auth.signOut.mock.invocationCallOrder[0]);
    expect(vi.mocked(redirect)).toHaveBeenCalledWith(ADMIN_LOGIN_PATH);
  });

  test("명단 밖 세션이 쳐도 안전하다 — requireAdmin 이 먼저 강제 로그아웃시키고 로그인 화면으로 보낸다", async () => {
    const client = fakeClient({ isAdmin: false });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    expect(await callSignOut()).toBe(ADMIN_LOGIN_PATH);
    // 게이트 안의 signOut 한 번. 액션 본문은 redirect(throw) 때문에 도달하지 않는다 — 결과는 같다(로그아웃).
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  test("세션이 아예 없으면 Supabase 를 더 부르지 않고 로그인 화면으로 간다", async () => {
    const client = fakeClient({ user: null });
    vi.mocked(createSsrClient).mockReturnValue(client as never);

    expect(await callSignOut()).toBe(ADMIN_LOGIN_PATH);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  test("signOut 이 오류를 돌려줘도 로그인 화면으로 보낸다 — 실패를 알리고 머무르면 로그인된 화면 앞에 남는다", async () => {
    const client = fakeClient({ signOutError: { name: "AuthApiError" } });
    vi.mocked(createSsrClient).mockReturnValue(client as never);
    expect(await callSignOut()).toBe(ADMIN_LOGIN_PATH);
  });

  test("Supabase 클라이언트를 못 만들어도(env 부재·네트워크) 500 이 아니라 로그인 화면이다 (fail-closed)", async () => {
    const client = fakeClient({});
    vi.mocked(createSsrClient)
      .mockReturnValueOnce(client as never) // 게이트는 통과
      .mockImplementationOnce(() => {
        throw new Error("no env");
      });
    expect(await callSignOut()).toBe(ADMIN_LOGIN_PATH);
  });

  test("scope 를 지정하지 않는다 — 기본 global 이라 사장님의 모든 기기에서 리프레시 토큰이 회수된다", () => {
    expect(code(SESSION_ACTION)).toMatch(/auth\.signOut\(\)/);
    expect(code(SESSION_ACTION), "scope 를 좁히면 다른 기기의 로그인이 살아남는다").not.toMatch(/scope:/);
  });
});

// =============================================================================
// 4. POST 전용 — GET 으로는 로그아웃되지 않는다
// =============================================================================
describe("4. POST 전용", () => {
  test("탭 줄의 로그아웃은 form 제출이다 — 링크(<a>·<Link>)가 아니다", () => {
    const src = code(TABS_UI);
    expect(src).toMatch(/<form\s+action=\{signOutAdmin\}/);
    expect(src).toMatch(/<button\s+type="submit"/);
    expect(src, "GET 으로 상태를 바꾸면 프리페치·크롤러가 사장님을 로그아웃시킨다").not.toMatch(
      /<(a|Link)[^>]*(signOut|logout|sign-out)/i,
    );
  });

  test("로그아웃 전용 라우트 핸들러가 없다 — GET 엔드포인트가 생기면 프리페치 한 번이 세션을 끊는다", () => {
    for (const rel of ["app/admin/logout/route.ts", "app/admin/signout/route.ts", "app/admin/(protected)/logout/route.ts"]) {
      expect(exists(rel), `${rel} 이 생겼다 — 로그아웃은 서버액션 POST 하나뿐이어야 한다`).toBe(false);
    }
  });

  test("액션을 부르는 곳은 탭 줄 하나뿐이다 (열거 가능한 하나의 출구)", () => {
    const src = code(TABS_UI);
    expect(src).toMatch(/from "@\/actions\/admin\/session"/);
  });
});

// =============================================================================
// 5. 레이아웃의 게이트는 여전히 무조건이다 (P5-3 리뷰 F1)
// =============================================================================
describe("5. 레이아웃", () => {
  test("(protected) 레이아웃의 requireAdmin() 이 조건 없이 첫 문장이다", () => {
    const src = code(PROTECTED_LAYOUT);
    expect(src).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
    const gateLines = src.split("\n").filter((l) => /\brequireAdmin\s*\(/.test(l));
    expect(gateLines).toHaveLength(1);
    expect(gateLines[0].trim()).toBe("await requireAdmin();");
  });

  test("로그아웃 버튼이 보호 구역 전 화면에 보인다 — 탭 줄은 레이아웃이 렌더한다", () => {
    expect(code(PROTECTED_LAYOUT)).toMatch(/<AdminTabs[\s\S]*signOutLabel=/);
  });
});

// =============================================================================
// 6. 삭제 확인 — 어느 화면이든 두 단계
// =============================================================================
/** 무장 체크박스 + 확인창 + 무장 전 비활성. 공지·사진이 원본이고 팝업·앨범을 여기에 맞췄다. */
const TWO_STEP: ReadonlyArray<{ file: string; armLabel: string; confirmLabel: string }> = [
  { file: NOTICE_FORM, armLabel: adminMsg("notices", "deleteArm"), confirmLabel: adminMsg("notices", "deleteConfirm") },
  { file: PHOTO_CARD, armLabel: adminMsg("gallery", "deleteArm"), confirmLabel: adminMsg("gallery", "deleteConfirm") },
  { file: POPUP_FORM, armLabel: adminMsg("popups", "deleteArm"), confirmLabel: adminMsg("popups", "deleteConfirm") },
  { file: ALBUMS_UI, armLabel: adminMsg("gallery", "albumDeleteArm"), confirmLabel: adminMsg("gallery", "albumDeleteConfirm") },
];

describe("6. 삭제 확인 2단계", () => {
  for (const { file, armLabel, confirmLabel } of TWO_STEP) {
    test(`${file} — 무장 체크박스 + 확인창, 무장 전에는 삭제 버튼이 비활성`, () => {
      const src = code(file);
      expect(src, "무장 상태").toMatch(/\[armed, setArmed\] = useState\(false\)/);
      expect(src, "type=\"checkbox\" 로 무장한다").toMatch(/type="checkbox"[\s\S]{0,200}checked=\{armed\}/);
      expect(src, "무장 전에는 눌리지 않는다").toMatch(/disabled=\{pending \|\| !armed\}/);
      expect(src, "브라우저가 한 번 더 묻는다").toMatch(/window\.confirm\(labels\.\w*[Dd]eleteConfirm\)/);
      expect(armLabel.length, "무장 문구가 카탈로그에 있다").toBeGreaterThan(5);
      expect(confirmLabel.length, "확인 문구가 카탈로그에 있다").toBeGreaterThan(5);
    });
  }

  test("무장 문구는 네 화면이 **같은 문장**을 쓴다 — 새 경고 문구를 지어내지 않았다", () => {
    const arms = new Set([
      adminMsg("notices", "deleteArm"),
      adminMsg("gallery", "deleteArm"),
      adminMsg("popups", "deleteArm"),
      adminMsg("gallery", "albumDeleteArm"),
    ]);
    expect([...arms]).toHaveLength(1);
  });

  /**
   * 0008 의 FK 가 `on delete set null` 이다 — 앨범을 지워도 사진 행은 남고 '미분류'가 된다.
   * 사장님께 가장 중요한 정보라 확인 문구가 그 사실을 **먼저** 말한다(추측이 아니라 마이그레이션 근거).
   */
  test("앨범 삭제 확인 문구가 '사진은 남는다'를 말한다 — 0008 의 on delete set null 이 근거다", () => {
    const sql = read("supabase/migrations/0008_gallery_albums.sql");
    expect(sql).toMatch(/album_id\s+int\s+references\s+gallery_albums\s*\(id\)\s+on delete set null/);
    expect(adminMsg("gallery", "albumDeleteConfirm")).toContain("사진은 지워지지 않고");
    expect(adminMsg("gallery", "albumDeleteNote")).toContain("미분류");
  });

  test("삭제를 더 쉽게 만들지 않았다 — 공지·사진의 두 단계가 그대로 남아 있다", () => {
    expect(code(NOTICE_FORM)).toMatch(/data-testid="admin-notice-danger"/);
    expect(code(PHOTO_CARD)).toMatch(/data-testid="admin-gallery-delete"/);
  });
});

// =============================================================================
// 7. 매뉴얼 동조화 — 인용한 화면 문구가 카탈로그와 한 글자도 다르지 않다
// =============================================================================
/**
 * 이 태스크가 docs/ops/admin-manual.md 를 틀리게 만든다("로그아웃 버튼이 없습니다"). 문서가 조용히 낡는 것을
 * 막으려고, 매뉴얼이 인용한 라벨을 **카탈로그에서 읽어** 문서 안에 그대로 있는지 본다.
 */
const MANUAL_QUOTES: ReadonlyArray<[namespace: string, key: string]> = [
  ["session", "signOut"],
  ["notices", "deleteArm"],
  ["notices", "deleteConfirm"],
  ["popups", "deleteArm"],
  ["popups", "deleteConfirm"],
  ["gallery", "deleteArm"],
  ["gallery", "deleteConfirm"],
  ["gallery", "albumDelete"],
  ["gallery", "albumDeleteArm"],
  ["gallery", "albumDeleteConfirm"],
  ["gallery", "albumDeleteNote"],
  ["tabs", "reservations"],
  ["tabs", "popups"],
  ["tabs", "notices"],
  ["tabs", "gallery"],
  ["tabs", "routes"],
  ["tabs", "notifications"],
];

describe("7. 매뉴얼 동조화", () => {
  const manual = read(MANUAL);

  for (const [namespace, key] of MANUAL_QUOTES) {
    test(`매뉴얼이 admin.${namespace}.${key} 를 그대로 인용한다`, () => {
      expect(manual, `admin.${namespace}.${key} 가 매뉴얼과 어긋났다`).toContain(adminMsg(namespace, key));
    });
  }

  test("'로그아웃이 없다'는 옛 서술이 남아 있지 않다", () => {
    for (const stale of [
      "로그아웃 버튼이 아직 없습니다",
      "화면에 로그아웃 버튼이 아직 없습니다",
      "아직 **로그아웃 버튼이 없습니다**",
      "**로그아웃 버튼** | 아직 없습니다",
    ]) {
      expect(manual, `낡은 서술: ${stale}`).not.toContain(stale);
    }
  });

  test("3장(손님 연락처)이 '보고 나면 로그아웃' 을 안내한다 — 그 장이 이 기능을 가장 필요로 한다", () => {
    const start = manual.indexOf("## 3. 손님 연락처 다루기");
    const end = manual.indexOf("## 4. ");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const chapter = manual.slice(start, end);
    expect(chapter).toContain(adminMsg("session", "signOut"));
  });

  test("팝업 장이 더는 '체크박스 단계 없이' 라고 적지 않는다", () => {
    expect(manual).not.toContain("체크박스 단계 없이");
  });
});

/**
 * P5-4 Part 1 — 관리자 인가 게이트를 **구문 트리(AST)로** 검사한다
 * (플랜 v4 P5-4 · P5-3 독립 리뷰 §재-2 · P5-4 독립 리뷰 §재공격).
 *
 * 이 파일이 지키는 것은 하나다: **게이트가 공격을 견디는가.** 그래서 테스트의 대부분이 red 픽스처다 —
 * 임시 디렉터리에 가짜 저장소를 만들고 `CLAUDE_PROJECT_DIR` 로 그곳을 루트로 위장해 스크립트를 돌린 뒤
 * exit code 와 메시지를 본다. 픽스처는 테스트가 끝나면 지워진다(P0-5 규약 · tests/gates.test.ts 와 같은 방식).
 *
 * 왜 정규식이 아니라 AST 인가: 1·2세대 게이트는 정규식이었고 독립 리뷰가 두 번 공격해 다음을 통과시켰다 —
 *   F3 `"use server"; // 주석`(줄 끝 주석 하나로 지시어 판정이 꺼졌다) · M5 매개변수 그림자 ·
 *   M6 네 디렉터리 밖의 가짜 게이트 모듈 · M8 `const s: AdminSession = await requireAdmin();` **정상 코드 반려**.
 * 주석·공백은 트리에 없고, 이름의 출처는 텍스트가 아니라 바인딩 해석으로 답한다. 아래 §2-c 가 그 넷을 고정한다.
 *
 * 이 파일은 tests/ 아래라 게이트 3종(가격·법정문구·임시값)의 검사 대상이기도 하다 — 금지 리터럴을 그대로 두지 않는다.
 * 픽스처 소스 안의 `use server` 문자열은 **문자열일 뿐** 이라 게이트가 이 파일을 서버액션으로 보지 않는다(그것이 AST 의 요점이다).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { PUBLIC_ACTION_REASONS, PUBLIC_ACTIONS, PUBLIC_ROUTE_REASONS, PUBLIC_ROUTES } from "../scripts/check-admin-gate.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT_REL = "scripts/check-admin-gate.mjs";
const SCRIPT = path.join(ROOT, SCRIPT_REL);
const GATE_TIMEOUT_MS = 60_000;

interface GateResult {
  status: number | null;
  out: string;
}

/** 스크립트를 node 로 돌린다 — bash 도, 셸 해석도 필요 없다(1·2세대와 달라진 점). */
function runGate(projectDir: string): Promise<GateResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
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

class Fixture {
  constructor(readonly dir: string) {}

  put(rel: string, content: string): void {
    const p = path.join(this.dir, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }

  remove(rel: string): void {
    rmSync(path.join(this.dir, rel), { force: true });
  }

  run(): Promise<GateResult> {
    return runGate(this.dir);
  }
}

const it = test.extend<{ fx: Fixture }>({
  fx: async ({ task }, provide) => {
    const dir = mkdtempSync(path.join(tmpdir(), `bestour-admin-gate-${task.id.replace(/[^\w-]/g, "")}-`));
    await provide(seed(new Fixture(dir)));
    rmSync(dir, { recursive: true, force: true });
  },
});

// ── 정상 저장소의 최소 모양 ───────────────────────────────────────────────
const GATE_MODULE = [
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
].join("\n");

const IMPORT_GATE = 'import { requireAdmin } from "@/lib/auth/requireAdmin";';
const SERVER = '"use server";';

const GATED_PAGE = [IMPORT_GATE, "", "export default async function Page() {", "  await requireAdmin();", "  return null;", "}", ""].join("\n");
const GATED_LAYOUT = [
  IMPORT_GATE,
  "",
  "export default async function Layout({ children }: { children: React.ReactNode }) {",
  "  await requireAdmin();",
  "  return children;",
  "}",
  "",
].join("\n");
const GATED_ACTION = [
  SERVER,
  "",
  IMPORT_GATE,
  "",
  "export async function createPopup(formData: FormData): Promise<number> {",
  "  await requireAdmin();",
  "  return formData ? 1 : 0;",
  "}",
  "",
].join("\n");
const GATED_ROUTE = [
  IMPORT_GATE,
  "",
  "export async function GET(): Promise<Response> {",
  "  await requireAdmin();",
  "  return new Response(null);",
  "}",
  "",
  "export async function POST(): Promise<Response> {",
  "  await requireAdmin();",
  "  return new Response(null);",
  "}",
  "",
].join("\n");

/** 공개(인증 전) 액션 3종 — 게이트가 없어야 정상이다. */
const PUBLIC_ACTION_SRC = (fn: string): string => [SERVER, "", `export async function ${fn}(): Promise<number> {`, "  return 1;", "}", ""].join("\n");

/** 게이트가 통과시켜야 하는 최소 저장소. 각 red 케이스는 여기에 파일 하나를 덮어쓰거나 더한다. */
function seed(fx: Fixture): Fixture {
  fx.put("lib/auth/requireAdmin.ts", GATE_MODULE);
  fx.put("actions/reservation.ts", PUBLIC_ACTION_SRC("submitReservation"));
  fx.put("actions/reservation-check.ts", PUBLIC_ACTION_SRC("checkReservation"));
  fx.put("actions/admin/auth.ts", PUBLIC_ACTION_SRC("requestAdminLoginLink"));
  fx.put("actions/admin/popup.ts", GATED_ACTION);
  fx.put("app/admin/layout.tsx", ["export default function AdminShell({ children }: { children: unknown }) {", "  return children;", "}", ""].join("\n"));
  fx.put("app/admin/login/page.tsx", ["export default function LoginPage() {", "  return null;", "}", ""].join("\n"));
  fx.put("app/admin/auth/callback/route.ts", ["export async function GET(): Promise<Response> {", "  return new Response(null);", "}", ""].join("\n"));
  fx.put("app/admin/(protected)/layout.tsx", GATED_LAYOUT);
  fx.put("app/admin/(protected)/page.tsx", GATED_PAGE);
  fx.put("app/admin/(protected)/popups/page.tsx", GATED_PAGE);
  fx.put("lib/admin/popups.ts", ['export const POPUP_TABLE = "popups";', ""].join("\n"));
  fx.put("components/admin/PopupForm.tsx", ['"use client";', "export function PopupForm() {", "  return null;", "}", ""].join("\n"));
  return fx;
}

// =============================================================================
// 0. 산출물 · 배선 · 예외 목록
// =============================================================================
describe("0. 산출물", () => {
  test("AST 스크립트가 있고, 정규식 시절 스크립트는 남아 있지 않다", () => {
    expect(existsSync(SCRIPT), SCRIPT_REL).toBe(true);
    expect(existsSync(path.join(ROOT, "scripts/check-admin-gate.sh")), "게이트가 둘이면 규칙이 갈라진다").toBe(false);
  });

  test("package.json · CI 가 새 스크립트를 부른다", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["check:admin-gate"]).toBe(`node ${SCRIPT_REL}`);
    expect(pkg.scripts["check:admin"]).toBe("bash scripts/check-admin-no-service-role.sh");
    const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain(`node ${SCRIPT_REL}`);
    expect(ci, "정규식 게이트를 CI 가 계속 부르면 안 된다").not.toContain("bash scripts/check-admin-gate.sh");
  });

  /**
   * 독립 리뷰 F2·M7: 목록은 게이트에서 가장 무른 곳이다. 이제 **해석된 배열 자체**를 단언한다 —
   * 따옴표 유무·줄바꿈·주석 같은 텍스트 문제를 통째로 건너뛴다. 인덱스 대입·재선언은 스크립트가 스스로 막는다.
   */
  test("예외 목록 — 해석된 배열이 공개 접수 3건 · 공개 화면 2건, 그게 전부다", () => {
    expect([...PUBLIC_ACTIONS]).toEqual(["actions/reservation.ts", "actions/reservation-check.ts", "actions/admin/auth.ts"]);
    expect([...PUBLIC_ROUTES]).toEqual(["app/admin/login/page.tsx", "app/admin/auth/callback/route.ts"]);
    for (const rel of PUBLIC_ACTIONS) expect((PUBLIC_ACTION_REASONS as Record<string, string>)[rel]?.length, rel).toBeGreaterThan(20);
    for (const rel of PUBLIC_ROUTES) expect((PUBLIC_ROUTE_REASONS as Record<string, string>)[rel]?.length, rel).toBeGreaterThan(10);
    // 목록의 파일은 실제로 있어야 한다(낡은 예외 금지)
    for (const rel of [...PUBLIC_ACTIONS, ...PUBLIC_ROUTES]) expect(existsSync(path.join(ROOT, rel)), rel).toBe(true);
  });

  test("목록을 나중에 고치는 경로가 없다 — 인덱스 대입·push·재선언 0", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).not.toMatch(/(PUBLIC_ACTIONS|PUBLIC_ROUTES)\s*(\+=|\[[^\]]*\]\s*=|\.push|\.unshift|\.splice)/);
    for (const name of ["PUBLIC_ACTION_REASONS", "PUBLIC_ROUTE_REASONS"]) {
      expect((src.match(new RegExp(`^const ${name} = `, "gm")) ?? []).length, name).toBe(1);
    }
  });
});

// =============================================================================
// 1. 실제 저장소
// =============================================================================
describe("1. 실제 저장소", { timeout: GATE_TIMEOUT_MS }, () => {
  test("현재 저장소가 통과한다 (exit 0)", async () => {
    const r = await runGate(ROOT);
    expect(r.status, r.out).toBe(0);
  });

  test("무엇을 훑는지 출력한다 — 저장소 전체의 use server + 관리자 경로", async () => {
    const r = await runGate(ROOT);
    expect(r.out).toContain("use server");
    for (const dir of ["app/admin", "actions/admin", "lib/admin", "components/admin"]) expect(r.out, dir).toContain(dir);
  });
});

// =============================================================================
// 2. use server 파일 — 첫 문장 게이트 (리뷰 (가)(나)(라))
// =============================================================================
describe.concurrent("2. use server 파일의 게이트", { timeout: GATE_TIMEOUT_MS }, () => {
  it("green — 정상 저장소는 통과한다", async ({ fx }) => {
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  it("red — 게이트가 아예 없는 서버액션 (라)", async ({ fx }) => {
    fx.put("actions/admin/popup.ts", [SERVER, "", "export async function createPopup(): Promise<number> {", "  return 1;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("createPopup");
  });

  it("red — 게이트가 if 로 감싸였다 (가)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [SERVER, "", IMPORT_GATE, "", "export async function createPopup(flag: boolean): Promise<number> {", "  if (flag) {", "    await requireAdmin();", "  }", "  return 1;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — 게이트가 try/catch 안이다 — redirect 는 throw 라 catch 가 게이트를 삼킨다 (가)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [SERVER, "", IMPORT_GATE, "", "export async function createPopup(): Promise<number> {", "  try {", "    await requireAdmin();", "  } catch {}", "  return 1;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — 게이트 앞에 early return 이 있다 (나)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [SERVER, "", IMPORT_GATE, "", "export async function createPopup(mode: string): Promise<number> {", '  if (mode === "x") return 0;', "  await requireAdmin();", "  return 1;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — 예외 목록에 없는 두 번째 무게이트 액션 파일", async ({ fx }) => {
    fx.put("actions/admin/notice.ts", [SERVER, "", "export async function createNotice(): Promise<number> {", "  return 1;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("actions/admin/notice.ts");
  });

  it("red — 화살표 함수 export 도 검사한다 (게이트 없으면 실패)", async ({ fx }) => {
    fx.put("actions/admin/popup.ts", [SERVER, "", "export const createPopup = async (): Promise<number> => {", "  return 1;", "};", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — export{ } 로 내보낸 함수도 따라가 검사한다", async ({ fx }) => {
    fx.put("actions/admin/popup.ts", [SERVER, "", "async function createPopup(): Promise<number> {", "  return 1;", "}", "", "export{createPopup};", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("createPopup");
  });

  it("red — 다른 모듈에서 재수출해 게이트를 숨긴다", async ({ fx }) => {
    fx.put("lib/admin/raw.ts", ["export async function createPopup(): Promise<number> {", "  return 1;", "}", ""].join("\n"));
    fx.put("actions/admin/popup.ts", [SERVER, "", 'export { createPopup } from "@/lib/admin/raw";', ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — requireAdmin 을 그 파일 안에서 새로 정의했다 (같은 이름의 가짜 게이트)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [SERVER, "", "async function requireAdmin(): Promise<void> {", "  return;", "}", "", "export async function createPopup(): Promise<number> {", "  await requireAdmin();", "  return 1;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("green — 게이트 위의 주석·빈 줄은 문장이 아니다", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        SERVER,
        "",
        IMPORT_GATE,
        "",
        "export async function createPopup(): Promise<number> {",
        "  /* redirect() 는 throw 다 — 관리자가 아니면 여기서 끝난다. */",
        "  // 이 줄도 문장이 아니다",
        "",
        "  await requireAdmin();",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });
});

// =============================================================================
// 2-b. 대상은 폴더가 아니다 (리뷰 F4 · F1 · M3)
// =============================================================================
describe.concurrent("2-b. 대상은 지시어로 정한다", { timeout: GATE_TIMEOUT_MS }, () => {
  const UNGATED = [SERVER, "", "export async function writeThing(): Promise<number> {", "  return 1;", "}", ""].join("\n");

  for (const rel of [
    "lib/admin/writes.ts",
    "components/admin/act.ts",
    "app/admin/(protected)/popups/actions.ts",
    "actions/tools.ts",
    "lib/queries/secret-writes.ts",
    "app/(site)/hidden/actions.ts",
  ]) {
    it(`red — ${rel} 의 use server 모듈 (F4)`, async ({ fx }) => {
      fx.put(rel, UNGATED);
      const r = await fx.run();
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain(rel);
    });
  }

  it("red — 컴포넌트 함수 안의 인라인 서버액션 (M3)", async ({ fx }) => {
    fx.put(
      "components/admin/PopupForm.tsx",
      ['"use client";', "export function PopupForm() {", "  async function save(): Promise<number> {", `    ${SERVER}`, "    return 1;", "  }", "  return save;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("use server");
  });

  it("green — 지시어가 없는 평범한 파일은 그대로 통과한다 (헛경보 0)", async ({ fx }) => {
    fx.put(
      "lib/admin/popups.ts",
      ['import { createSsrClient } from "@/lib/supabase/ssr";', "", "export async function listPopups(): Promise<unknown[]> {", "  const db = createSsrClient();", "  return db ? [] : [];", "}", ""].join("\n"),
    );
    fx.put("components/admin/util.ts", ["export function labelOf(x: string): string {", "  return x.trim();", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });
});

// =============================================================================
// 2-c. 오늘의 공격 — 주석·그림자·가짜 모듈·정상 코드 반려 (리뷰 §재공격)
// =============================================================================
describe.concurrent("2-c. 재공격 고정", { timeout: GATE_TIMEOUT_MS }, () => {
  for (const [label, directive] of [
    ["줄 끝 주석", `${SERVER} // 관리자 쓰기 액션`],
    ["앞 블록 주석", `/* 서버 전용 */ ${SERVER}`],
    ["작은따옴표 + 주석", "'use server'; // 액션"],
  ] as const) {
    it(`red — ${label} 이 붙어도 use server 파일이다 (F3)`, async ({ fx }) => {
      fx.put("actions/admin/popup.ts", [directive, "", "export async function createPopup(): Promise<number> {", "  return 1;", "}", ""].join("\n"));
      const r = await fx.run();
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain("createPopup");
    });
  }

  it("red — 매개변수가 게이트 이름을 가린다 (M5)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        SERVER,
        "",
        IMPORT_GATE,
        "",
        "export async function createPopup(requireAdmin = async () => undefined): Promise<number> {",
        "  await requireAdmin();",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("가려져");
  });

  it("red — 지역 선언이 게이트 이름을 가린다 (M5 변종)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        SERVER,
        "",
        IMPORT_GATE,
        "",
        "export async function createPopup(): Promise<number> {",
        "  return inner();",
        "}",
        "",
        "async function inner(): Promise<number> {",
        "  const requireAdmin = async () => undefined;",
        "  await requireAdmin();",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  /**
   * 리뷰 M9 — 본문 안에 **호이스팅된** 가짜 게이트를 두고 정본 import 는 남겨 둔다.
   * 첫 문장은 글자 그대로 `await requireAdmin();` 이지만 실행되는 것은 지역 함수다(리뷰어가 정본을 throw 로 바꿔 실증했다).
   * 2세대 isShadowed 는 fn 에서 **위로만** 걸어 자기 본문을 한 번도 보지 않았다.
   */
  it("red — 본문 안에 호이스팅한 가짜 게이트 (M9 · 액션)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        SERVER,
        "",
        IMPORT_GATE,
        "",
        "export async function createPopup(): Promise<number> {",
        "  await requireAdmin();",
        "  return 1;",
        "",
        "  async function requireAdmin(): Promise<void> {",
        "    return;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("가려져");
  });

  it("red — 본문 안에 호이스팅한 가짜 게이트 (M9 · 화면)", async ({ fx }) => {
    fx.put(
      "app/admin/(protected)/popups/page.tsx",
      [
        IMPORT_GATE,
        "",
        "export default async function Page() {",
        "  await requireAdmin();",
        "  return null;",
        "",
        "  async function requireAdmin(): Promise<void> {",
        "    return;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — 블록 안에 숨긴 지역 게이트도 같은 스코프다 (M9 변종)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        SERVER,
        "",
        IMPORT_GATE,
        "",
        "export async function createPopup(flag: boolean): Promise<number> {",
        "  await requireAdmin();",
        "  if (flag) {",
        "    const requireAdmin = async () => undefined;",
        "    void requireAdmin;",
        "  }",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("green — 중첩 함수 안의 같은 이름은 이 스코프를 가리지 않는다 (M9 헛경보 방지)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        SERVER,
        "",
        IMPORT_GATE,
        "",
        "export async function createPopup(): Promise<number> {",
        "  await requireAdmin();",
        "  const helper = (requireAdmin: string): string => requireAdmin.trim();",
        '  return helper(" x ").length;',
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  it("red — 네 디렉터리 밖의 가짜 게이트 모듈 (M6)", async ({ fx }) => {
    fx.put("lib/fake/requireAdmin.ts", ["export async function requireAdmin(): Promise<void> {", "  return;", "}", ""].join("\n"));
    fx.put(
      "actions/admin/popup.ts",
      [SERVER, "", 'import { requireAdmin } from "@/lib/fake/requireAdmin";', "", "export async function createPopup(): Promise<number> {", "  await requireAdmin();", "  return 1;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("lib/auth/requireAdmin.ts");
  });

  it("red — 다른 함수를 requireAdmin 으로 별칭했다 — 그 함수는 redirect 하지 않는다 (M2)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        SERVER,
        "",
        'import { resolveAdminSession as requireAdmin } from "@/lib/auth/requireAdmin";',
        "",
        "export async function createPopup(): Promise<number> {",
        "  await requireAdmin();",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("green — 타입을 붙인 변수 선언도 같은 첫 문장이다 (M8 · N6)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        SERVER,
        "",
        'import { requireAdmin, type AdminSession } from "@/lib/auth/requireAdmin";',
        "",
        "export async function createPopup(): Promise<string> {",
        "  const session: AdminSession = await requireAdmin();",
        "  return session.email;",
        "}",
        "",
        "export const alsoFine = async (): Promise<number> => {",
        "  await requireAdmin();",
        "  return 1;",
        "};",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  it("green — 세미콜론을 빼도(ASI) 같은 문장이다 (N7)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [SERVER, "", IMPORT_GATE, "", "export async function createPopup(): Promise<number> {", "  await requireAdmin()", "  return 1", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  it("green — 여러 줄 named import · 타입 전용 import 가 섞여도 통과한다", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        SERVER,
        "",
        'import type { AdminSession } from "@/lib/auth/requireAdmin";',
        "import {",
        "  requireAdmin,",
        '} from "@/lib/auth/requireAdmin";',
        "",
        "export async function createPopup(): Promise<AdminSession> {",
        "  const session: AdminSession = await requireAdmin();",
        "  return session;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  /**
   * `return await requireAdmin();` 은 게이트가 아니다 — 세션을 **돌려주는** 함수이지 그 뒤에 지킬 것이 없다.
   * 그래서 이 형태는 반려한다: 게이트는 "이 아래를 보호한다" 는 뜻이어야 하고, 통과 여부를 호출부에 미루면
   * 그 호출부가 또 검사 대상이 된다(= 게이트가 한 단계 안쪽으로 숨는다).
   */
  it("red — return await requireAdmin() 은 게이트가 아니라 반환이다", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [SERVER, "", IMPORT_GATE, "", "export async function createPopup(): Promise<unknown> {", "  return await requireAdmin();", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("green — 상대 경로로 정본 모듈을 가져와도 같은 파일이면 통과한다", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [SERVER, "", 'import { requireAdmin } from "../../lib/auth/requireAdmin";', "", "export async function createPopup(): Promise<number> {", "  await requireAdmin();", "  return 1;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });
});

// =============================================================================
// 3. app/admin 화면·라우트 (리뷰 (다))
// =============================================================================
describe.concurrent("3. 화면·라우트 게이트", { timeout: GATE_TIMEOUT_MS }, () => {
  it("red — 게이트 없는 page.tsx", async ({ fx }) => {
    fx.put("app/admin/(protected)/popups/page.tsx", ["export default async function Page() {", "  return null;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("popups/page.tsx");
  });

  it("red — 게이트 없는 layout.tsx", async ({ fx }) => {
    fx.put("app/admin/(protected)/layout.tsx", ["export default async function Layout({ children }: { children: unknown }) {", "  return children;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — route.ts 의 HTTP 메서드가 게이트를 빠뜨렸다 (다)", async ({ fx }) => {
    fx.put(
      "app/admin/(protected)/export/route.ts",
      [IMPORT_GATE, "", "export async function GET(): Promise<Response> {", "  await requireAdmin();", "  return new Response(null);", "}", "", "export async function POST(): Promise<Response> {", "  return new Response(null);", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("POST");
  });

  it("green — 메서드마다 게이트가 첫 문장이면 통과한다", async ({ fx }) => {
    fx.put("app/admin/(protected)/export/route.ts", GATED_ROUTE);
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  it("red — 기본 export 가 async 함수가 아니다", async ({ fx }) => {
    fx.put("app/admin/(protected)/popups/page.tsx", ["export default function Page() {", "  return null;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — 관리자 화면을 프리렌더하려는 generateStaticParams", async ({ fx }) => {
    fx.put(
      "app/admin/(protected)/popups/page.tsx",
      [IMPORT_GATE, "", "export async function generateStaticParams(): Promise<unknown[]> {", "  return [];", "}", "", "export default async function Page() {", "  await requireAdmin();", "  return null;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("generateStaticParams");
  });

  it("red — generateMetadata 가 게이트를 빠뜨렸다 (요청마다 서버에서 돈다)", async ({ fx }) => {
    fx.put(
      "app/admin/(protected)/popups/page.tsx",
      [IMPORT_GATE, "", "export async function generateMetadata(): Promise<unknown> {", "  return {};", "}", "", "export default async function Page() {", "  await requireAdmin();", "  return null;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — 공개 예외 파일이 사라졌다 (예외 목록이 낡았다)", async ({ fx }) => {
    fx.remove("app/admin/login/page.tsx");
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — 로그인 화면을 감싸는 바깥 레이아웃이 게이트를 걸었다 (무한 리다이렉트)", async ({ fx }) => {
    fx.put("app/admin/layout.tsx", GATED_LAYOUT);
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("green — 세그먼트 설정 export 는 화면·라우트 양쪽에서 허용한다", async ({ fx }) => {
    fx.put("app/admin/(protected)/popups/page.tsx", ['export const dynamic = "force-dynamic";', "", GATED_PAGE].join("\n"));
    fx.put("app/admin/(protected)/export/route.ts", ['export const dynamic = "force-dynamic";', "", GATED_ROUTE].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  it("green — 대상이 하나도 없는 저장소는 통과한다", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bestour-admin-gate-empty-"));
    try {
      writeFileSync(path.join(dir, "README.md"), "# 빈 저장소\n");
      const r = await runGate(dir);
      expect(r.status, r.out).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// 4. 라우트 그룹·폴더 이름에 기대지 않는다 (리뷰 (마))
// =============================================================================
describe.concurrent("4. 경로 하드코딩 없음", { timeout: GATE_TIMEOUT_MS }, () => {
  it("red — 그룹 밖 app/admin/popups/page.tsx 가 게이트를 빠뜨렸다 (마)", async ({ fx }) => {
    fx.put("app/admin/popups/page.tsx", ["export default async function Page() {", "  return null;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("app/admin/popups/page.tsx");
  });

  it("red — 새 라우트 그룹 (danger) 아래도 대상이다", async ({ fx }) => {
    fx.put("app/admin/(danger)/tools/page.tsx", ["export default async function Page() {", "  return null;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("green — 그룹 밖이라도 게이트가 첫 문장이면 통과한다", async ({ fx }) => {
    fx.put("app/admin/popups/page.tsx", GATED_PAGE);
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  /**
   * 리뷰 N10 — `app/admin/**` 접두사로 화면을 고르면 `app/(admin)/…` 라우트 그룹이 규칙 밖이 된다.
   * 판정을 **세그먼트**(`admin` 또는 `(admin)`)로 바꿨다: URL 에 나타나지 않는 그룹 표기까지 같은 뜻으로 읽는다.
   */
  it("red — 라우트 그룹 app/(admin)/dashboard/page.tsx 도 화면 규칙 대상이다 (N10)", async ({ fx }) => {
    fx.put("app/(admin)/dashboard/page.tsx", ["export default async function Page() {", "  return null;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("app/(admin)/dashboard/page.tsx");
  });

  it("red — app/(admin) 아래의 route.ts 도 메서드마다 게이트를 요구한다 (N10)", async ({ fx }) => {
    fx.put("app/(admin)/export/route.ts", ["export async function GET(): Promise<Response> {", "  return new Response(null);", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("green — app/(admin) 아래도 게이트가 첫 문장이면 통과한다 (N10)", async ({ fx }) => {
    fx.put("app/(admin)/dashboard/page.tsx", GATED_PAGE);
    fx.put("app/(admin)/export/route.ts", GATED_ROUTE);
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  it("green — 이름이 비슷할 뿐인 공개 경로는 관리자 경로가 아니다 (N10 헛경보 방지)", async ({ fx }) => {
    fx.put("app/[locale]/(site)/admin-guide/page.tsx", ["export default function Guide() {", "  return null;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });
});

// =============================================================================
// 5. 삭제된 우회 심볼 · 환경변수 분기
// =============================================================================
describe.concurrent("5. 우회 심볼 · 환경변수 분기", { timeout: GATE_TIMEOUT_MS }, () => {
  const SYMBOLS = ["preview" + "Admin", "ADMIN" + "_PREVIEW", "adminPreview" + "Allowed", "isAdmin" + "Preview", "PREVIEW" + "_ADMIN_ROWS"];

  for (const symbol of SYMBOLS) {
    it(`red — 삭제된 우회 심볼 ${symbol.slice(0, 6)}… 가 되살아났다`, async ({ fx }) => {
      fx.put("lib/admin/popups.ts", [`export const ${symbol} = true;`, ""].join("\n"));
      const r = await fx.run();
      expect(r.status, r.out).toBe(1);
    });
  }

  it("red — 주석 안에 숨겨 둔 우회 심볼도 잡는다", async ({ fx }) => {
    fx.put("components/admin/PopupForm.tsx", [`// ${"ADMIN" + "_PREVIEW"} 로 열 수 있었다`, '"use client";', "export function PopupForm() {", "  return null;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — 관리자 경로의 NODE_ENV 분기", async ({ fx }) => {
    fx.put(
      "app/admin/(protected)/popups/page.tsx",
      [IMPORT_GATE, "", "export default async function Page() {", "  await requireAdmin();", '  if (process.env.NODE_ENV !== "production") return null;', "  return null;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("NODE_ENV");
  });

  it("green — 주석에 적힌 NODE_ENV 설명은 코드가 아니다 (사고 경위 기록을 지우게 만들지 않는다)", async ({ fx }) => {
    fx.put(
      "app/admin/(protected)/popups/page.tsx",
      [IMPORT_GATE, "", "/** 예전 우회 분기는 NODE_ENV 와 process.env 를 봤다 — 그 기록을 남겨 둔다. */", "export default async function Page() {", "  await requireAdmin();", "  return null;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  it('green — "미리보기" 기능 자체는 막지 않는다 (팝업 미리보기는 정당하다)', async ({ fx }) => {
    fx.put(
      "app/admin/(protected)/popups/[id]/page.tsx",
      [IMPORT_GATE, 'import { HomePopup } from "@/components/home/HomePopup";', "", "export default async function Page() {", "  await requireAdmin();", "  return HomePopup;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });
});

/**
 * P5-4 Part 1 — 관리자 인가 게이트를 **구조로** 검사한다 (플랜 v4 P5-4 · P5-3 독립 리뷰 §재-2 (가)~(마)).
 *
 * 왜 이 파일이 생겼나: P5-3 이 만든 구조 단언 3종은 **줄 단위 정규식**이었고 `app/admin/(protected)` 만 걸었다.
 * 리뷰어가 다섯 가지 사각지대를 지목했다 —
 *   (가) `if (…) {` ⏎ `await requireAdmin();` ⏎ `}` 와 `try { await requireAdmin(); } catch {}` 가 통과한다
 *        (redirect() 는 throw 라 catch 가 게이트를 통째로 삼킨다)
 *   (나) 게이트보다 앞선 early return 을 보지 않는다
 *   (다) `route.ts` 를 보지 않는다 — Route Handler 는 레이아웃을 타지 않는다
 *   (라) `actions/admin/**` 이 검사 트리 밖이다 — `use server` export 는 전부 공개 POST 엔드포인트다
 *   (마) `(protected)` 경로가 하드코딩이라 그룹 **밖**에 만든 화면은 대상이 아니다
 *
 * 그래서 검사를 **함수 본문의 첫 문장**으로 옮겼다. "첫 문장이 `await requireAdmin();` 인가" 하나로 (가)(나)가 동시에 닫히고,
 * 대상을 `app/admin` 전체 + `actions/admin` 전체로 넓혀 (다)(라)(마)가 닫힌다.
 *
 * 게이트 자체를 픽스처로 실증한다(P0-5 규약 · tests/gates.test.ts 와 같은 방식):
 * 임시 디렉터리에 가짜 저장소를 만들고 `CLAUDE_PROJECT_DIR` 로 그곳을 루트로 위장해 exit code 를 본다.
 * 픽스처는 테스트가 끝나면 지워진다(저장소에 남지 않는다).
 *
 * 이 파일은 tests/ 아래라 게이트 3종(가격·법정문구·임시값)의 검사 대상이기도 하다 — 금지 리터럴을 그대로 두지 않는다.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT_REL = "scripts/check-admin-gate.sh";
const SCRIPT = path.join(ROOT, SCRIPT_REL);
const GATE_TIMEOUT_MS = 60_000;

// ── bash 해석 (tests/gates.test.ts 와 같은 구현 — Windows 의 WSL bash 를 피한다) ──────────
function resolveBash(): { bin: string; env: NodeJS.ProcessEnv } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.env.BASH_PATH) return { bin: process.env.BASH_PATH, env };
  if (process.platform !== "win32") return { bin: "bash", env };

  const roots: string[] = [];
  try {
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    roots.push(path.resolve(execPath, "..", "..", ".."));
  } catch {
    // git 이 PATH 에 없으면 아래 고정 후보로
  }
  roots.push("C:\\Program Files\\Git", "C:\\Program Files (x86)\\Git");
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, "Programs", "Git"));

  for (const root of roots) {
    const bin = path.join(root, "bin", "bash.exe");
    if (!existsSync(bin)) continue;
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = [path.join(root, "usr", "bin"), path.join(root, "mingw64", "bin"), env[pathKey] ?? ""].join(path.delimiter);
    return { bin, env };
  }
  return { bin: "bash", env };
}

const BASH = resolveBash();
const toPosix = (p: string): string => p.split(path.sep).join("/");

interface GateResult {
  status: number | null;
  out: string;
}

function runGate(projectDir: string): Promise<GateResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(BASH.bin, [toPosix(SCRIPT)], {
      env: { ...BASH.env, CLAUDE_PROJECT_DIR: toPosix(projectDir) },
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

// ── 픽스처 ───────────────────────────────────────────────────────────────
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
const IMPORT_GATE = 'import { requireAdmin } from "@/lib/auth/requireAdmin";';

const GATED_PAGE = [
  IMPORT_GATE,
  "",
  "export default async function Page() {",
  "  await requireAdmin();",
  "  return null;",
  "}",
  "",
].join("\n");

const GATED_LAYOUT = [
  IMPORT_GATE,
  "",
  "export default async function Layout({ children }: { children: React.ReactNode }) {",
  "  await requireAdmin();",
  "  return children;",
  "}",
  "",
].join("\n");

/** 공개 예외 2건 — 인증 전이라 게이트가 없다. */
const PUBLIC_PAGE = ["export default function LoginPage() {", "  return null;", "}", ""].join("\n");
const PUBLIC_ROUTE = [
  "export async function GET(): Promise<Response> {",
  "  return new Response(null, { status: 302 });",
  "}",
  "",
].join("\n");

/** 로그인 액션 — 인증 전(예외 1건). */
const UNGATED_ACTION = ['"use server";', "", "export async function requestAdminLoginLink(): Promise<void> {", "  return;", "}", ""].join("\n");

const GATED_ACTION = [
  '"use server";',
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

/** 게이트가 통과시켜야 하는 최소 저장소. 각 red 케이스는 여기에 파일 하나를 덮어쓴다. */
function seed(fx: Fixture): Fixture {
  fx.put("app/admin/layout.tsx", ["export default function AdminShell({ children }: { children: unknown }) {", "  return children;", "}", ""].join("\n"));
  fx.put("app/admin/login/page.tsx", PUBLIC_PAGE);
  fx.put("app/admin/auth/callback/route.ts", PUBLIC_ROUTE);
  fx.put("app/admin/(protected)/layout.tsx", GATED_LAYOUT);
  fx.put("app/admin/(protected)/page.tsx", GATED_PAGE);
  fx.put("app/admin/(protected)/popups/page.tsx", GATED_PAGE);
  fx.put("actions/admin/auth.ts", UNGATED_ACTION);
  fx.put("actions/admin/popup.ts", GATED_ACTION);
  fx.put("lib/admin/popups.ts", ["export const POPUP_TABLE = \"popups\";", ""].join("\n"));
  fx.put("components/admin/PopupForm.tsx", ['"use client";', "export function PopupForm() {", "  return null;", "}", ""].join("\n"));
  return fx;
}

// =============================================================================
// 0. 산출물 · 배선
// =============================================================================
describe("0. 산출물", () => {
  test("스크립트가 있고 package.json 이 부른다", () => {
    expect(existsSync(SCRIPT), SCRIPT_REL).toBe(true);
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["check:admin-gate"]).toBe(`bash ${SCRIPT_REL}`);
    // 기존 게이트는 그대로 — 둘은 서로 다른 것을 본다(서비스 롤 / 인가 호출)
    expect(pkg.scripts["check:admin"]).toBe("bash scripts/check-admin-no-service-role.sh");
  });

  /**
   * 예외 목록은 **스크립트 안에 상수로** 있고, 그 내용이 정확히 아래 세 줄이어야 한다.
   * 예외가 하나라도 늘면 이 단언이 깨진다 — 게이트를 우회하는 가장 쉬운 방법이 "예외 목록에 한 줄 추가"이기 때문이다.
   */
  /**
   * 독립 리뷰 F2: 처음 이 검사는 **큰따옴표가 붙은 항목만** 모으고 `^NAME=(` 첫 번째 것만 읽었다.
   * 그래서 따옴표 없이 한 줄 더하거나 `PUBLIC_ROUTES+=(...)` 로 덧붙이면 게이트도 테스트도 지나갔다.
   * 이제 배열 본문을 **토큰 단위로 전부** 풀어 목록 전체를 비교하고, `+=` 와 중복 대입을 따로 막는다
   * (스크립트 자신도 실행 첫머리에 같은 것을 확인하고 걸리면 exit 2 다).
   */
  test("예외 목록은 공개 라우트 2건 · 인증 전 액션 1건, 그게 전부다", () => {
    const src = readFileSync(SCRIPT, "utf8");
    const listOf = (name: string): string[] => {
      const assigns = [...src.matchAll(new RegExp(`^${name}=\\(`, "gm"))];
      expect(assigns.length, `${name} 대입은 정확히 한 번이어야 한다`).toBe(1);
      const start = (assigns[0].index ?? 0) + assigns[0][0].length;
      const end = src.indexOf(")", start);
      expect(end, `${name} 배열이 닫히지 않았다`).toBeGreaterThan(start);
      return src
        .slice(start, end)
        .split("\n")
        .map((line) => line.replace(/#.*$/, "")) // 사유 주석 제거
        .flatMap((line) => line.trim().split(/\s+/)) // 따옴표가 없어도 토큰으로 잡힌다
        .map((token) => token.replace(/^['"]|['"]$/g, "").trim())
        .filter((token) => token.length > 0);
    };
    expect(listOf("PUBLIC_ROUTES")).toEqual(["app/admin/login/page.tsx", "app/admin/auth/callback/route.ts"]);
    expect(listOf("UNGATED_ACTIONS")).toEqual(["actions/admin/auth.ts"]);
    // 나중에 덧붙이는 경로를 막는다 — 목록은 한 곳에서 한 번만 정의한다
    expect(src, "예외 목록을 += 로 덧붙였다").not.toMatch(/(PUBLIC_ROUTES|UNGATED_ACTIONS)\s*\+=/);
    // 예외마다 사유가 주석으로 붙어 있다
    for (const rel of ["app/admin/login/page.tsx", "app/admin/auth/callback/route.ts", "actions/admin/auth.ts"]) {
      expect(src, `${rel} 의 사유 주석이 없다`).toMatch(new RegExp(`${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*#`));
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

  test("검사 대상 네 디렉터리를 전부 훑는다고 출력한다", async () => {
    const r = await runGate(ROOT);
    for (const dir of ["app/admin", "actions/admin", "lib/admin", "components/admin"]) {
      expect(r.out, dir).toContain(dir);
    }
  });
});

// =============================================================================
// 2. 규칙 1·2 — actions/admin/** 의 export 는 첫 문장이 게이트다 (리뷰 (가)(나)(라))
// =============================================================================
describe.concurrent("2. actions/admin 게이트", { timeout: GATE_TIMEOUT_MS }, () => {
  it("green — 정상 저장소는 통과한다", async ({ fx }) => {
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  it("red — 게이트가 아예 없는 서버액션 (라)", async ({ fx }) => {
    fx.put("actions/admin/popup.ts", ['"use server";', "", "export async function createPopup(): Promise<number> {", "  return 1;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("actions/admin/popup.ts");
    expect(r.out).toContain("createPopup");
  });

  it("red — 게이트가 if 로 감싸였다 (가)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        '"use server";',
        "",
        IMPORT_GATE,
        "",
        "export async function createPopup(flag: boolean): Promise<number> {",
        "  if (flag) {",
        "    await requireAdmin();",
        "  }",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("createPopup");
  });

  it("red — 게이트가 try/catch 안이다 — redirect 는 throw 라 catch 가 게이트를 삼킨다 (가)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        '"use server";',
        "",
        IMPORT_GATE,
        "",
        "export async function createPopup(): Promise<number> {",
        "  try {",
        "    await requireAdmin();",
        "  } catch {}",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/try|catch/);
  });

  it("red — 게이트 앞에 early return 이 있다 (나)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        '"use server";',
        "",
        IMPORT_GATE,
        "",
        "export async function createPopup(mode: string): Promise<number> {",
        '  if (mode === "x") return 0;',
        "  await requireAdmin();",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("createPopup");
  });

  it("red — 예외 목록에 없는 두 번째 무게이트 액션 파일", async ({ fx }) => {
    fx.put("actions/admin/notice.ts", ['"use server";', "", "export async function createNotice(): Promise<number> {", "  return 1;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("actions/admin/notice.ts");
  });

  it("red — 화살표 함수 export 는 구조를 확인할 수 없어 거부한다", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      ['"use server";', "", IMPORT_GATE, "", "export const createPopup = async (): Promise<number> => {", "  await requireAdmin();", "  return 1;", "};", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — requireAdmin 을 그 파일 안에서 새로 정의했다 (같은 이름의 가짜 게이트)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        '"use server";',
        "",
        "async function requireAdmin(): Promise<void> {",
        "  return;",
        "}",
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

  it("green — 주석은 첫 문장이 아니다 (게이트 위의 설명 주석은 허용)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        '"use server";',
        "",
        IMPORT_GATE,
        "",
        "export async function createPopup(): Promise<number> {",
        "  /* redirect() 는 throw 다 — 관리자가 아니면 여기서 끝난다. */",
        "  // 이 주석도 문장이 아니다",
        "  await requireAdmin();",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  /**
   * ─── 독립 리뷰가 뚫은 자리 (P5-4-review.md) ────────────────────────────────────────
   * 아홉 번의 시도 중 셋이 통과했다. 그 셋과 리뷰어가 덧붙인 변종을 전부 red 로 고정한다.
   */
  it("red — export{ 로 붙여 쓰면 export 탐지 자체가 꺼졌다 (M1)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      ['"use server";', "", "async function createPopup(): Promise<number> {", "  return 1;", "}", "", "export{createPopup};", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — 다른 함수를 requireAdmin 으로 별칭했다 — 그 함수는 redirect 하지 않는다 (M2)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        '"use server";',
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

  it("green — 타입 export 는 런타임에 사라진다 — 액션 파일에서도 허용한다 (M4 헛경보)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        '"use server";',
        "",
        IMPORT_GATE,
        "",
        "export type PopupResult = { ok: boolean };",
        "",
        "export async function createPopup(): Promise<PopupResult> {",
        "  await requireAdmin();",
        "  return { ok: true };",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  it("green — 여러 줄로 나눈 named import 도 이름 그대로면 통과한다 (M2 헛경보 방지)", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        '"use server";',
        "",
        "import {",
        "  requireAdmin,",
        '} from "@/lib/auth/requireAdmin";',
        "",
        "export async function createPopup(): Promise<number> {",
        "  await requireAdmin();",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  it("green — 세션을 받아 쓰는 형태(const s = await requireAdmin();)도 첫 문장이면 통과한다", async ({ fx }) => {
    fx.put(
      "actions/admin/popup.ts",
      [
        '"use server";',
        "",
        IMPORT_GATE,
        "",
        "export async function createPopup(): Promise<string> {",
        "  const session = await requireAdmin();",
        "  return session.email;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });
});

// =============================================================================
// 2-b. 규칙 1(a)(b) — 서버액션은 **지시어**로 찾는다, 그리고 한 곳에만 둔다 (독립 리뷰 F1·M3)
//
// 폴더 이름으로 대상을 고르면, 같은 지시어를 다른 폴더에 두는 것만으로 게이트 밖으로 나간다.
// 아래 네 자리는 전부 "화면을 거치지 않는 공개 POST 엔드포인트" 이고, 전부 red 여야 한다.
// =============================================================================
describe.concurrent("2-b. use server 는 지시어로 찾고 한 곳에만 둔다", { timeout: GATE_TIMEOUT_MS }, () => {
  const UNGATED_SERVER_MODULE = [
    '"use server";',
    "",
    "export async function writePopup(): Promise<number> {",
    "  return 1;",
    "}",
    "",
  ].join("\n");

  for (const rel of ["lib/admin/writes.ts", "components/admin/act.ts", "app/admin/(protected)/popups/actions.ts"]) {
    it(`red — ${rel} 의 use server 모듈 (F1)`, async ({ fx }) => {
      fx.put(rel, UNGATED_SERVER_MODULE);
      const r = await fx.run();
      expect(r.status, r.out).toBe(1);
      expect(r.out, "지시어의 위치 자체가 위반이어야 한다").toContain("use server");
      expect(r.out).toContain(rel);
    });
  }

  it("red — 게이트가 있어도 actions/admin 밖이면 거부한다 — 쓰기 액션은 한 곳에 모은다 (F1-b)", async ({ fx }) => {
    fx.put(
      "lib/admin/writes.ts",
      ['"use server";', "", IMPORT_GATE, "", "export async function writePopup(): Promise<number> {", "  await requireAdmin();", "  return 1;", "}", ""].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — 컴포넌트 함수 안의 인라인 서버액션 (M3)", async ({ fx }) => {
    fx.put(
      "components/admin/PopupForm.tsx",
      [
        '"use client";',
        "export function PopupForm() {",
        "  async function save() {",
        '    "use server";',
        "    return 1;",
        "  }",
        "  return save;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("use server");
  });

  it("green — 지시어가 없는 평범한 lib/admin·components/admin 파일은 그대로 통과한다 (헛경보 0)", async ({ fx }) => {
    fx.put(
      "lib/admin/popups.ts",
      [
        'import { createSsrClient } from "@/lib/supabase/ssr";',
        "",
        "export async function listPopups(): Promise<unknown[]> {",
        "  const db = createSsrClient();",
        "  return db ? [] : [];",
        "}",
        "",
        "export const POPUP_TABLE = \"popups\";",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });
});

// =============================================================================
// 3. 규칙 3 — app/admin 의 page·layout·route (리뷰 (다))
// =============================================================================
describe.concurrent("3. app/admin 화면·라우트 게이트", { timeout: GATE_TIMEOUT_MS }, () => {
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

  it("red — 기본 export 가 async 함수가 아니다 (동기 함수는 게이트를 걸 수 없다)", async ({ fx }) => {
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

  it("red — 공개 예외 파일이 사라졌다 (예외 목록이 낡았다)", async ({ fx }) => {
    fx.remove("app/admin/login/page.tsx");
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — 로그인 화면을 감싸는 바깥 레이아웃이 게이트를 걸었다 (로그인이 자기 자신으로 무한 리다이렉트한다)", async ({ fx }) => {
    fx.put("app/admin/layout.tsx", GATED_LAYOUT);
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("green — 대상 디렉터리가 하나도 없으면 통과한다 (대상이 생기는 순간부터 검사)", async () => {
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
// 4. 규칙 4 — (protected) 를 하드코딩하지 않는다 (리뷰 (마))
// =============================================================================
describe.concurrent("4. 라우트 그룹 밖도 대상이다", { timeout: GATE_TIMEOUT_MS }, () => {
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
});

// =============================================================================
// 5. 규칙 5 — 삭제된 우회 심볼 · 환경변수 분기 (리뷰 F1 · 브리프 §5)
// =============================================================================
describe.concurrent("5. 우회 심볼 · 환경변수 분기", { timeout: GATE_TIMEOUT_MS }, () => {
  // 심볼 이름을 문자열 결합으로 조립한다 — 이 파일도 게이트의 검사 대상이 될 수 있다
  const SYMBOLS = ["preview" + "Admin", "ADMIN" + "_PREVIEW", "adminPreview" + "Allowed", "isAdmin" + "Preview", "PREVIEW" + "_ADMIN_ROWS"];

  for (const symbol of SYMBOLS) {
    it(`red — 삭제된 우회 심볼 ${symbol.slice(0, 6)}… 가 되살아났다`, async ({ fx }) => {
      fx.put("lib/admin/popups.ts", [`export const ${symbol} = true;`, ""].join("\n"));
      const r = await fx.run();
      expect(r.status, r.out).toBe(1);
    });
  }

  it("red — 주석 안에 숨겨 둔 우회 심볼도 잡는다 (되살릴 조각을 남기지 않는다)", async ({ fx }) => {
    fx.put("components/admin/PopupForm.tsx", [`// ${"ADMIN" + "_PREVIEW"} 로 열 수 있었다`, '"use client";', "export function PopupForm() {", "  return null;", "}", ""].join("\n"));
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
  });

  it("red — 관리자 경로의 NODE_ENV 분기", async ({ fx }) => {
    fx.put(
      "app/admin/(protected)/popups/page.tsx",
      [
        IMPORT_GATE,
        "",
        "export default async function Page() {",
        "  await requireAdmin();",
        '  if (process.env.NODE_ENV !== "production") return null;',
        "  return null;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("NODE_ENV");
  });

  it("green — 주석에 적힌 NODE_ENV 설명은 코드가 아니다 (사고 경위 기록을 지우게 만들지 않는다)", async ({ fx }) => {
    fx.put(
      "app/admin/(protected)/popups/page.tsx",
      [
        IMPORT_GATE,
        "",
        "/** 예전 우회 분기는 NODE_ENV 와 process.env 를 봤다 — 그 기록을 남겨 둔다. */",
        "export default async function Page() {",
        "  await requireAdmin();",
        "  return null;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });

  it('green — "미리보기" 기능 자체는 막지 않는다 (브리프 §5 — 팝업 미리보기는 정당하다)', async ({ fx }) => {
    fx.put(
      "app/admin/(protected)/popups/[id]/page.tsx",
      [
        IMPORT_GATE,
        'import { HomePopup } from "@/components/home/HomePopup";',
        "",
        "export default async function Page() {",
        "  await requireAdmin();",
        "  return HomePopup;",
        "}",
        "",
      ].join("\n"),
    );
    const r = await fx.run();
    expect(r.status, r.out).toBe(0);
  });
});

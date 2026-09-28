/**
 * P5-18 — 관리자 화면 전환이 느리다: 원인 제거 (사용자 지시 2026-09-27 · 브리프 P5-18).
 *
 * 로컬 실측(사본 서버 · fetch 계측)으로 확인한 원인 세 가지와, 이 파일이 잠그는 것:
 *   1. **함수 지역** — vercel.json 에 regions 가 없어 함수가 기본값 iad1(미국 동부)에서 돌았다. DB·Auth 는 서울이다.
 *      탭 한 번 = 서버 함수가 태평양을 건너 Supabase 를 3~7번 **직렬로** 부른다. → `regions: ["icn1"]` 하나로 잠근다.
 *   2. **로딩 경계 없음** — 누른 뒤 서버 응답이 올 때까지 화면이 그대로 멈춰 있었다(실측: 첫 반응 = 본문 도착).
 *      → (protected)(탭 사이)와 상세가 있는 네 구역(목록↔상세)에 loading.tsx. ?쿼리만 바뀌는 이동(필터·페이지)에는 Next 가 경계를
 *        띄우지 않는다 — §3-a 주석. **loading 은 게이트와 무관하게 렌더된다**(레이아웃의 형제 칸 · 공유 레이아웃을 건너뛴 부분 렌더) —
 *        그래서 규칙은 데이터 0 이고, 모든 loading 을 파일시스템에서 찾아 잠근다(§3-c · 독립 리뷰 P1-1). 경계를 게이트 레이아웃 안쪽에
 *        두어 지켜지는 것은 비로그인 전체 로드의 307 뿐이라, 게이트 레이아웃의 조상에는 loading 을 두지 않는다(§3-c · 리뷰 P2-12).
 *   3. **직렬 왕복** — 서로 독립인 조회가 `await` 로 줄을 섰다(발송 내역 7단 · 통계 6단 · 예약 목록·상세 4단). → Promise.all.
 *   + 한 요청 안에서 레이아웃과 페이지가 둘 다 requireAdmin() 을 부르면 is_admin 이 두 번 나갔다
 *     (getUser 는 Next 의 fetch 중복 제거가 이미 한 번으로 줄이고 있었다). → resolveAdminSession 을 React cache() 로.
 *
 * 보안 성질은 그대로여야 한다 — 이 파일이 그것도 잠근다:
 *   · getUser()(Auth 서버 검증)를 그대로 쓴다 — getSession()·getClaims() 로 바꾸지 않았다.
 *   · 모든 화면이 여전히 자기 자리에서 requireAdmin() 을 부르고(심층 방어), 조회는 게이트가 **끝난 뒤에만** 시작한다.
 *   · cache() 는 요청 범위다 — 요청이 바뀌면 다시 확인한다(여기서는 요청 범위를 흉내 낸 memo 로 그 계약을 단언한다.
 *     실제 요청 범위의 근거는 React Flight 서버의 `request.cache = new Map()` — 보고서 ④).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { stripComments } from "./helpers/strip-comments";

vi.mock("server-only", () => ({}));

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const exists = (rel: string) => existsSync(path.join(ROOT, rel));
const codeOf = (rel: string) => stripComments(read(rel), rel);

function walk(absDir: string): string[] {
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir).flatMap((n) => {
    const p = path.join(absDir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

/** next/navigation redirect() 는 throw 다 — mock 도 같은 모양이어야 뒤 코드가 돌지 않는다. */
class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
    this.name = "RedirectSignal";
  }
}

// =============================================================================
// 1. 함수 지역 — vercel.json
// =============================================================================
describe("1. 함수 지역 (vercel.json)", () => {
  const json = JSON.parse(read("vercel.json")) as { regions?: unknown; crons?: { path: string; schedule: string }[] };

  test("함수 지역은 서울 icn1 단 하나다 — Vercel Hobby 는 함수 지역을 1개만 받아 2개 이상이면 배포가 빌드 전에 거부된다 (DB·Auth 는 서울 ap-northeast-2, 기본값 iad1 은 미국 동부)", () => {
    expect(json.regions).toEqual(["icn1"]);
  });

  test("지역을 바꿔도 크론 계약은 그대로다 — 두 개, 스케줄 불변", () => {
    expect(json.crons).toEqual([
      { path: "/api/cron/purge", schedule: "0 19 * * *" },
      { path: "/api/cron/notify", schedule: "0 23 * * *" },
    ]);
  });

  test("세그먼트마다 preferredRegion 으로 지역을 덮어쓰지 않는다 — 지역은 vercel.json 한 곳에서만 정한다", () => {
    const files = [...walk(path.join(ROOT, "app")), path.join(ROOT, "middleware.ts")].filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) => /\bpreferredRegion\b/.test(stripComments(readFileSync(f, "utf-8"), f)));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});

// =============================================================================
// 2. 한 요청 안에서 세션 확인은 한 번 — React cache()
// =============================================================================
const REQUIRE_ADMIN = "lib/auth/requireAdmin.ts";

describe("2-a. requireAdmin.ts 의 모양 — 검증은 그대로, 결과만 요청 단위로 재사용", () => {
  test("resolveAdminSession 은 React 의 cache() 로 감싼다 (요청 범위 memo — 데이터 캐시가 아니다)", () => {
    const src = codeOf(REQUIRE_ADMIN);
    expect(src).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*"react";/);
    expect(src).toMatch(/export const resolveAdminSession\s*=\s*cache\(/);
  });

  test("Auth 서버 검증(getUser)을 그대로 쓴다 — getSession·getClaims 로 바꾸지 않았다", () => {
    const src = codeOf(REQUIRE_ADMIN);
    expect(src).toMatch(/\.auth\.getUser\(\)/);
    expect(src).not.toMatch(/getSession\s*\(|getClaims\s*\(/);
  });

  test("요청을 넘어 남는 캐시(unstable_cache · 'use cache' · 모듈 변수)를 쓰지 않는다", () => {
    const src = codeOf(REQUIRE_ADMIN);
    expect(src).not.toMatch(/unstable_cache|use cache|next\/cache/);
    // 모듈 최상위에 세션을 담아 둘 let 이 없다 — 요청 사이에 새는 가장 흔한 길
    expect(src).not.toMatch(/^let\s/m);
  });

  test("requireAdmin 은 캐시하지 않는다 — 부를 때마다 자기 자리에서 redirect 를 판단한다(throw)", () => {
    const src = codeOf(REQUIRE_ADMIN);
    expect(src).toMatch(/export async function requireAdmin\(\): Promise<AdminSession> \{\s*const session = await resolveAdminSession\(\);\s*if \(!session\) redirect\(ADMIN_LOGIN_PATH\);\s*return session;\s*\}/);
    expect(src).not.toMatch(/export const requireAdmin\s*=\s*cache\(/);
  });

  test("한글 리터럴 0 (주석 제외) — 문구는 카탈로그에서", () => {
    const offenders = codeOf(REQUIRE_ADMIN)
      .split("\n")
      .filter((l) => HANGUL.test(l));
    expect(offenders).toEqual([]);
  });
});

describe("2-b. 요청 범위 계약 — 한 요청에서는 한 번, 요청이 바뀌면 다시", () => {
  /** 요청 범위를 흉내 낸 memo. `newRequest()` 가 React 가 요청마다 새 Map 을 만드는 것과 같은 일을 한다. */
  let scope = new Map<unknown, unknown>();
  const newRequest = () => {
    scope = new Map();
  };

  interface FakeClient {
    auth: { getUser: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn> };
    rpc: ReturnType<typeof vi.fn>;
  }
  function fakeClient(opts: { user?: { id: string; email?: string } | null; isAdmin?: unknown }): FakeClient {
    return {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: opts.user === undefined ? { id: "u-1", email: "owner@example.test" } : opts.user }, error: null })),
        signOut: vi.fn(async () => ({ error: null })),
      },
      rpc: vi.fn(async () => ({ data: opts.isAdmin ?? true, error: null })),
    };
  }

  let gate: typeof import("@/lib/auth/requireAdmin");
  let createSsrClient: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    newRequest();
    vi.doMock("react", async () => {
      const actual = await vi.importActual<typeof import("react")>("react");
      return {
        ...actual,
        cache: <F extends (...args: never[]) => unknown>(fn: F): F =>
          ((...args: never[]) => {
            if (!scope.has(fn)) scope.set(fn, fn(...args));
            return scope.get(fn);
          }) as F,
      };
    });
    vi.doMock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })) }));
    vi.doMock("next/navigation", () => ({
      redirect: vi.fn((to: string) => {
        throw new RedirectSignal(to);
      }),
    }));
    createSsrClient = vi.fn();
    vi.doMock("@/lib/supabase/ssr", () => ({ createSsrClient }));
    vi.doMock("@/lib/log", () => ({ structuredLog: vi.fn() }));
    gate = await import("@/lib/auth/requireAdmin");
  });

  afterAll(() => {
    for (const m of ["react", "next/headers", "next/navigation", "@/lib/supabase/ssr", "@/lib/log"]) vi.doUnmock(m);
    vi.resetModules();
  });

  test("레이아웃과 페이지가 한 요청에서 둘 다 requireAdmin() 을 불러도 getUser·is_admin 은 한 번씩", async () => {
    const client = fakeClient({});
    createSsrClient.mockReturnValue(client);
    const [layout, page] = await Promise.all([gate.requireAdmin(), gate.requireAdmin()]);
    expect(layout).toEqual({ userId: "u-1", email: "owner@example.test" });
    expect(page).toEqual(layout);
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("is_admin");
  });

  test("요청이 바뀌면 다시 확인한다 — 앞 요청의 통과가 다음 요청으로 새지 않는다", async () => {
    const admin = fakeClient({});
    createSsrClient.mockReturnValue(admin);
    await gate.requireAdmin();

    newRequest();
    const outsider = fakeClient({ user: { id: "u-2", email: "x@example.test" }, isAdmin: false });
    createSsrClient.mockReturnValue(outsider);
    await expect(gate.requireAdmin()).rejects.toBeInstanceOf(RedirectSignal);
    expect(outsider.auth.getUser).toHaveBeenCalledTimes(1);
    expect(outsider.rpc).toHaveBeenCalledTimes(1);
  });

  test("명단 밖 세션 — 한 요청에서 두 번 불러도 로그아웃은 한 번, 두 자리 모두 로그인 화면으로 보낸다", async () => {
    const outsider = fakeClient({ isAdmin: false });
    createSsrClient.mockReturnValue(outsider);
    const results = await Promise.allSettled([gate.requireAdmin(), gate.requireAdmin()]);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(RedirectSignal);
    }
    expect(outsider.auth.signOut).toHaveBeenCalledTimes(1);
  });

  test("세션이 없으면 같은 요청의 두 자리 모두 로그인 화면이고 is_admin 은 부르지 않는다", async () => {
    const anonymous = fakeClient({ user: null });
    createSsrClient.mockReturnValue(anonymous);
    const results = await Promise.allSettled([gate.requireAdmin(), gate.requireAdmin()]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(anonymous.rpc).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 3. 로딩 경계 — 누르는 즉시 탭 바는 그대로, 본문은 스켈레톤
// =============================================================================
const PROTECTED = "app/admin/(protected)";
/**
 * (protected) 는 탭 사이 이동을, 상세가 있는 네 구역은 목록↔상세 이동을 맡는다.
 * 갤러리·발송 내역·통계에는 두지 않는다 — 그 구역 안의 이동은 ?쿼리(필터·페이지)뿐이고, Next 는 쿼리만 바뀌는 이동에
 * loading.tsx 를 띄우지 않는다(같은 화면의 경계를 쿼리 없이 식별해 그대로 둔다 — 실측 2026-09-27: 응답이 올 때까지 이전 화면이 남는다).
 * 그런 파일은 아무 일도 하지 않으면서 "필터에도 스켈레톤이 뜬다" 는 오해만 남긴다.
 */
const LOADING_FILES = [
  `${PROTECTED}/loading.tsx`,
  `${PROTECTED}/reservations/loading.tsx`,
  `${PROTECTED}/popups/loading.tsx`,
  `${PROTECTED}/notices/loading.tsx`,
  `${PROTECTED}/routes/loading.tsx`,
];
const SKELETON = "components/admin/AdminSkeleton.tsx";
const SKELETON_CSS = "components/admin/AdminSkeleton.module.css";
const SKELETON_IMPORT = "@/components/admin/AdminSkeleton";

// ── 파일시스템에서 유도하는 도구 (P5-18 독립 리뷰 P1-1 · P2-12) ─────────────────────────────
// 게이트 스크립트(scripts/check-admin-gate.mjs 규칙 7)와 **따로 구현한다** — 한쪽이 무너져도 다른 쪽이 잡는다.
const toRel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");
const CODE_FILE = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/;
const stemOf = (rel: string) => path.posix.basename(rel).replace(/\.[^.]+$/, "");
const dirOf = (rel: string) => path.posix.dirname(rel);
/** 게이트 스크립트와 같은 판정 — 경로 세그먼트(파일 이름 제외)에 `admin` 또는 `(admin)` 이 있다. */
const inAdminSegment = (rel: string) => rel.split("/").slice(0, -1).some((s) => s === "admin" || s === "(admin)");
const appFiles = () => walk(path.join(ROOT, "app")).map(toRel).filter((rel) => CODE_FILE.test(rel));
/** 문 하나가 통째로 게이트 호출(대입 허용) — tests/admin-reservations.test.ts 의 F1 판정과 같은 모양. */
const UNCONDITIONAL_GATE = /^\s*(?:const\s+[\w$]+(?:\s*:\s*[^=]+)?\s*=\s*)?await\s+requireAdmin\(\)\s*;?\s*$/m;
const GATED_STEMS = new Set(["page", "layout", "template", "default"]);

/** 네트워크·쿠키·동적 로딩 호출. `require` 는 CommonJS 로딩, `draftMode` 는 요청 상태다. */
const DATA_CALLS = new Set(["fetch", "require", "cookies", "headers", "draftMode"]);

interface ModuleShape {
  /** 런타임 import·재수출 지정자(타입 전용 제외). */
  imports: string[];
  /** 비동기·동적 로딩·네트워크·환경 흔적 — `줄: 무엇`. */
  findings: string[];
  /** 기본 export 말고 런타임에 남는 export. */
  otherExports: string[];
  hasDefault: boolean;
  /** export 된 함수(기본 포함)의 매개변수 수. */
  exportedParams: Record<string, number>;
}

/** TypeScript 구문 트리로 모듈 모양을 읽는다(주석·문자열에 속지 않는다 — 게이트와 같은 이유). */
function moduleShape(rel: string): ModuleShape {
  const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const mods = (n: ts.Node) => (ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []) : []);
  const has = (n: ts.Node, k: ts.SyntaxKind) => mods(n).some((m) => m.kind === k);
  const shape: ModuleShape = { imports: [], findings: [], otherExports: [], hasDefault: false, exportedParams: {} };
  const fnParams = (e: ts.Expression | undefined) => (e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) ? e.parameters.length : undefined);

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      if (!st.importClause?.isTypeOnly) shape.imports.push((st.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isImportEqualsDeclaration(st)) {
      shape.findings.push(`${line(st)}: import = require`);
    } else if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      if (st.moduleSpecifier) shape.imports.push((st.moduleSpecifier as ts.StringLiteral).text);
      shape.otherExports.push(st.getText(sf).slice(0, 40));
    } else if (ts.isExportAssignment(st)) {
      shape.hasDefault = true;
    } else if (has(st, ts.SyntaxKind.ExportKeyword)) {
      if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) continue;
      const isDefault = has(st, ts.SyntaxKind.DefaultKeyword);
      if (ts.isFunctionDeclaration(st)) {
        shape.exportedParams[st.name?.text ?? "default"] = st.parameters.length;
        if (isDefault) shape.hasDefault = true;
        else shape.otherExports.push(st.name?.text ?? "?");
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          const name = ts.isIdentifier(d.name) ? d.name.text : "?";
          const n = fnParams(d.initializer);
          if (n !== undefined) shape.exportedParams[name] = n;
          shape.otherExports.push(name);
        }
      } else {
        shape.otherExports.push("?");
      }
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && has(node, ts.SyntaxKind.AsyncKeyword)) shape.findings.push(`${line(node)}: async`);
    if (ts.isAwaitExpression(node)) shape.findings.push(`${line(node)}: await`);
    if (ts.isForOfStatement(node) && node.awaitModifier) shape.findings.push(`${line(node)}: for await`);
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) shape.findings.push(`${line(node)}: import()`);
      else if (ts.isIdentifier(node.expression) && DATA_CALLS.has(node.expression.text)) shape.findings.push(`${line(node)}: ${node.expression.text}()`);
    }
    if (ts.isPropertyAccessExpression(node) && node.getText(sf).replace(/\s/g, "") === "process.env") shape.findings.push(`${line(node)}: process.env`);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return shape;
}

/** 게이트를 무조건 부르는 화면(page·layout·template·default) — 관리자 세그먼트에서 유도한다. */
function gatedScreens(): { rel: string; stem: string }[] {
  return appFiles()
    .filter((rel) => inAdminSegment(rel) && GATED_STEMS.has(stemOf(rel)))
    .filter((rel) => UNCONDITIONAL_GATE.test(codeOf(rel)))
    .map((rel) => ({ rel, stem: stemOf(rel) }));
}

describe("3-a. 로딩 경계 파일", () => {
  test("(protected) 와 상세 화면이 있는 네 구역에 loading.tsx 가 있다", () => {
    for (const rel of LOADING_FILES) expect(exists(rel), rel).toBe(true);
  });

  test("상세([id]) 화면이 있는 구역은 빠짐없이 목록↔상세 경계를 갖는다 — 새 상세 화면이 생겨도 잡힌다", () => {
    const sections = readdirSync(path.join(ROOT, PROTECTED)).filter((d) => statSync(path.join(ROOT, PROTECTED, d)).isDirectory());
    const withDetail = sections.filter((d) => exists(`${PROTECTED}/${d}/[id]/page.tsx`));
    expect(withDetail.sort()).toEqual(["notices", "popups", "reservations", "routes"]);
    for (const d of withDetail) expect(exists(`${PROTECTED}/${d}/loading.tsx`), `${d}/loading.tsx`).toBe(true);
  });
});

/**
 * **loading 은 게이트와 무관하게 렌더된다** (P5-18 독립 리뷰 P1-1). Next 는 세그먼트를 `[segment, 레이아웃 노드, 자식 seed, loadingData, …]` 로
 * 직렬화하고 loading 은 레이아웃의 자식이 아니라 **형제 칸**이다(next/dist/server/app-render/create-component-tree.js) — 레이아웃의
 * `await requireAdmin()` 이 막지 않는다(실측: 비로그인 307 응답의 RSC 페이로드에 스켈레톤이 실렸다). 클라이언트 이동에서는 서버가 요청의
 * 라우터 상태 헤더를 보고 공유 레이아웃을 건너뛰므로(walk-tree-with-flight-router-state.js) 구역 loading 은 게이트가 한 번도 돌지 않은 채
 * 렌더될 수 있다(실측: 쿠키 없는 프리페치 요청이 리다이렉트 0 으로 구역 스켈레톤을 받아 갔다 — 보고서 「수정 라운드」 R-1).
 * 그래서 규칙은 **데이터 0** 이고, 목록을 손으로 적지 않고 파일시스템에서 찾는다(새 loading 이 생겨도 잡힌다).
 */
describe("3-c. 게이트 밖 경계 — 파일시스템에서 유도한 데이터 0 잠금 (리뷰 P1-1 · P2-12)", () => {
  const adminLoadings = () => appFiles().filter((rel) => inAdminSegment(rel) && stemOf(rel) === "loading");

  test("관리자 세그먼트의 loading.* 를 전부 찾는다 — 손으로 적은 목록(LOADING_FILES)보다 좁지 않다", () => {
    const found = adminLoadings();
    expect(found.length, "찾은 것이 없으면 아래 잠금은 아무것도 지키지 않는다").toBeGreaterThan(0);
    for (const rel of LOADING_FILES) expect(found, rel).toContain(rel);
  });

  test("모든 로딩 경계는 데이터 0 — async·await 없음 · import 는 정본 스켈레톤 하나(또는 없음) · 동적 import·fetch·쿠키·env 0 · export 는 기본 하나", () => {
    for (const rel of adminLoadings()) {
      const s = moduleShape(rel);
      expect(s.imports.filter((spec) => spec !== SKELETON_IMPORT), `${rel} — 정본 스켈레톤 말고 import 한 것`).toEqual([]);
      expect(s.findings, `${rel} — 비동기·데이터 흔적`).toEqual([]);
      expect(s.otherExports, `${rel} — 기본 export 말고 남는 export`).toEqual([]);
      expect(s.hasDefault, `${rel} — 기본 export 가 없다`).toBe(true);
      expect(codeOf(rel).split("\n").filter((l) => HANGUL.test(l)), rel).toEqual([]);
    }
  });

  test("정본 스켈레톤도 데이터 0 — import 는 문구(next-intl)·로케일·자기 CSS 뿐 · 매개변수 0 · fetch·쿠키·헤더·동적 import·env 0", () => {
    const s = moduleShape(SKELETON);
    const allow = new Set(["next-intl/server", "@/i18n/routing", "./AdminSkeleton.module.css"]);
    expect(s.imports.filter((spec) => !allow.has(spec)), "허용 목록 밖 import").toEqual([]);
    // 문구를 불러오느라 async 는 허용한다(getTranslations) — 나머지 흔적은 0 이어야 한다
    expect(s.findings.filter((f) => !/: (async|await)$/.test(f)), "데이터 흔적").toEqual([]);
    expect(Object.keys(s.exportedParams).length, "export 된 컴포넌트가 없다").toBeGreaterThan(0);
    for (const [name, n] of Object.entries(s.exportedParams)) expect(n, `${name} 이 값을 받는다 — 데이터를 실어 나를 통로`).toBe(0);
  });

  test("게이트 스크립트에 규칙이 없는 서버 경계 관례(not-found·forbidden·unauthorized)는 관리자 세그먼트에 없다", () => {
    const unruled = appFiles().filter((rel) => inAdminSegment(rel) && ["not-found", "forbidden", "unauthorized"].includes(stemOf(rel)));
    expect(unruled).toEqual([]);
  });

  test("게이트 레이아웃의 바깥 조상(app/ 까지 유도)에는 로딩 경계가 없다 (P2-12)", () => {
    const layouts = gatedScreens().filter((f) => f.stem === "layout");
    expect(layouts.length, "게이트 레이아웃을 하나도 찾지 못했다").toBeGreaterThan(0);
    const loadingIn = (dir: string) => appFiles().filter((rel) => dirOf(rel) === dir && stemOf(rel) === "loading");
    for (const { rel } of layouts) {
      const ancestors: string[] = [];
      for (let d = dirOf(dirOf(rel)); d === "app" || d.startsWith("app/"); d = dirOf(d)) ancestors.push(d);
      expect(ancestors.at(-1), `${rel} — 조상 목록이 루트 app 까지 닿아야 한다`).toBe("app");
      for (const d of ancestors) expect(loadingIn(d), `${rel} 의 조상 ${d} — 셸이 게이트보다 먼저 흘러나간다`).toEqual([]);
    }
  });

  test("어느 게이트 화면도 게이트 레이아웃 밖의 로딩 경계에 감싸이지 않는다 — 게이트 레이아웃이 없는 화면까지 일반화", () => {
    const screens = gatedScreens();
    const gatedLayoutDirs = screens.filter((f) => f.stem === "layout").map((f) => dirOf(f.rel));
    const covered = (dir: string) => gatedLayoutDirs.some((g) => dir === g || dir.startsWith(`${g}/`));
    const offenders: string[] = [];
    for (const loading of appFiles().filter((rel) => stemOf(rel) === "loading")) {
      const L = dirOf(loading);
      if (covered(L)) continue;
      // loading 은 같은 폴더의 page·default 와 그 아래 전부를, 레이아웃·템플릿은 아래 폴더의 것만 감싼다(같은 폴더의 loading 은 레이아웃 안쪽)
      const wrapped = screens.filter(({ rel, stem }) =>
        stem === "page" || stem === "default" ? dirOf(rel) === L || dirOf(rel).startsWith(`${L}/`) : dirOf(rel).startsWith(`${L}/`),
      );
      if (wrapped.length > 0) offenders.push(`${loading} → ${wrapped.map((w) => w.rel).join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  test("주석이 보안 모델을 바로 말한다 — 'loading 은 게이트와 무관하게 렌더된다' (리뷰: '레이아웃 안쪽이라 보호된다' 로 읽히던 문장)", () => {
    for (const rel of [`${PROTECTED}/loading.tsx`, SKELETON]) {
      const src = read(rel);
      expect(src, rel).toContain("게이트와 무관하게 렌더");
      expect(src, rel).not.toContain("안쪽**이라, 비로그인 요청은 셸이 흘러나가기 전에");
    }
  });
});

/** 서버 컴포넌트를 호출해 돌아온 element 트리에서 props 를 전부 모은다(DOM 없이). */
interface Node {
  type: unknown;
  props: Record<string, unknown>;
}
function collect(node: unknown, out: Node[] = []): Node[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const c of node) collect(c, out);
    return out;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.props) {
    out.push({ type: el.type, props: el.props });
    collect(el.props.children, out);
  }
  return out;
}
const textOf = (node: unknown): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as { props: { children?: unknown } }).props.children);
  return "";
};

describe("3-b. 스켈레톤 — 스크린리더에는 '불러오는 중' 한 번, 장식은 숨김", () => {
  const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, Record<string, string>> };

  afterEach(() => {
    vi.doUnmock("next-intl/server");
    vi.resetModules();
  });

  async function renderSkeleton(): Promise<unknown> {
    vi.resetModules();
    vi.doMock("next-intl/server", () => ({
      getTranslations: async ({ namespace }: { namespace: string }) => {
        const [root, ns] = namespace.split(".");
        const table = (ko as unknown as Record<string, Record<string, Record<string, string>>>)[root][ns];
        return (key: string) => {
          if (!(key in table)) throw new Error(`missing message ${namespace}.${key}`);
          return table[key];
        };
      },
    }));
    const mod = (await import("@/components/admin/AdminSkeleton")) as { AdminSkeleton: () => Promise<unknown> };
    return mod.AdminSkeleton();
  }

  test("messages/ko.json — admin.loading.label 이 있고(한국어), en 에는 admin 이 없다", () => {
    expect(ko.admin.loading?.label).toBe("불러오는 중");
    expect((JSON.parse(read("messages/en.json")) as Record<string, unknown>).admin).toBeUndefined();
  });

  test("상태 알림(role=status)이 정확히 하나이고, 그 글자는 카탈로그의 '불러오는 중' 이다", async () => {
    const nodes = collect(await renderSkeleton());
    const statuses = nodes.filter((n) => n.props.role === "status");
    expect(statuses).toHaveLength(1);
    expect(textOf(statuses[0].props.children)).toBe(ko.admin.loading.label);
    // 같은 문구가 트리 어디에도 두 번 나오지 않는다 — 스크린리더가 한 번만 읽는다
    const all = nodes.map((n) => (typeof n.props.children === "string" ? n.props.children : "")).filter((t) => t === ko.admin.loading.label);
    expect(all).toHaveLength(1);
  });

  test("본문 자리를 차지하는 main 이고 data-testid=admin-loading · aria-busy — 탭 바는 레이아웃에 남는다", async () => {
    const tree = (await renderSkeleton()) as { type: unknown; props: Record<string, unknown> };
    expect(tree.type).toBe("main");
    expect(tree.props["data-testid"]).toBe("admin-loading");
    expect(tree.props["aria-busy"]).toBe("true");
  });

  test("회색 막대(장식)는 전부 aria-hidden 덩어리 안에 있다 — 읽을 것이 없다", async () => {
    const nodes = collect(await renderSkeleton());
    const hidden = nodes.filter((n) => n.props["aria-hidden"] === "true");
    expect(hidden.length).toBeGreaterThanOrEqual(1);
    const decorative = hidden.flatMap((h) => collect(h.props.children));
    expect(decorative.length, "막대가 하나도 없으면 스켈레톤이 아니다").toBeGreaterThanOrEqual(4);
    for (const d of decorative) expect(textOf(d.props.children), "장식 안에 글자가 있다").toBe("");
  });

  test("스켈레톤 컴포넌트 — 서버 컴포넌트('use client' 없음) · 데이터 접근 0 · 한글 리터럴 0", () => {
    const src = codeOf(SKELETON);
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    expect(src).not.toMatch(/requireAdmin|@\/lib\/(admin|supabase|queries|auth)|next\/headers|cookies\(/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });

  test("CSS — prefers-reduced-motion 이면 움직임을 끈다 · 색은 역할 토큰뿐 · 글꼴 선언 0", () => {
    const css = codeOf(SKELETON_CSS);
    expect(css).toMatch(/@keyframes/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\{[^}]*animation:\s*none/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/);
    expect(css).not.toMatch(/var\(\s*--(brand|gray|gold|white|black)[-\w]*\s*\)/);
    expect(css).not.toMatch(/font-family|(^|[;\s{])font\s*:/);
  });
});

// =============================================================================
// 4. 서로 독립인 조회는 동시에 — 직렬이면 여기서 멈춘다
// =============================================================================
/**
 * 문 하나: n 개가 모두 도착해야 열린다. 조회가 직렬(`await` 로 줄 서기)이면 첫 조회가 두 번째를 영원히 기다려
 * `within()` 이 시간 초과로 실패한다. 조회가 게이트보다 먼저 시작하면 `beforeGate` 에 이름이 남는다.
 */
function gateAndBarrier(n: number) {
  let gateDone = false;
  let arrived = 0;
  let release!: () => void;
  const opened = new Promise<void>((r) => {
    release = r;
  });
  const beforeGate: string[] = [];
  return {
    requireAdmin: async () => {
      await new Promise((r) => setTimeout(r, 5));
      gateDone = true;
      return { userId: "u-1", email: "owner@example.test" };
    },
    arrive: async (name: string) => {
      if (!gateDone) beforeGate.push(name);
      arrived += 1;
      if (arrived >= n) release();
      await opened;
    },
    beforeGate,
    arrived: () => arrived,
  };
}

function within<T>(p: Promise<T>, label: string, ms = 4000): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: ${ms}ms 안에 끝나지 않았다 — 독립 조회가 직렬로 줄 서 있다`)), ms),
    ),
  ]);
}

/** 조회 하나가 문에 도착한 뒤에야 응답하는 thenable 체인(supabase 빌더 흉내). */
function barrierClient(bar: ReturnType<typeof gateAndBarrier>, response: (idx: number) => unknown) {
  let q = -1;
  return {
    from() {
      q += 1;
      const idx = q;
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "lt", "like", "or", "order", "range", "in", "limit"]) chain[m] = () => chain;
      chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        bar
          .arrive(`q${idx}`)
          .then(() => response(idx))
          .then(ok, bad);
      return chain;
    },
  };
}

// rich — 예약 상세의 처리 영역 라벨(취소 시트 본문의 굵은 글씨 · P5-19)이 t.rich 를 부른다. 이 파일은 순서만 보므로 키를 그대로 돌려준다.
const translate = Object.assign((k: string) => k, { raw: () => ({}), rich: (k: string) => k });

/** 화면 렌더에서 갈아 끼우는 모듈 — 테스트가 끝나면 전부 되돌린다. */
const RENDER_MOCKS = [
  "@/lib/auth/requireAdmin",
  "next-intl/server",
  "@/lib/admin/reservations",
  "@/lib/admin/notifications",
  "@/lib/admin/stats",
  "@/lib/admin/gallery",
  "@/lib/queries",
  "@/lib/queries/vehicles",
  "@/lib/analytics/dashboard",
  "next/navigation",
];

const WIZARD_ROW = {
  id: "7b0267f2-0a2c-45c3-8ef5-c6017ddc0863",
  public_code: "P518WIZ1",
  status: "new",
  intake: "wizard",
  name: "customer",
  phone: "+821000000001",
  vehicle_slug: "bus45",
  origin_code: "SEL",
  destination_code: "ICN",
  trip_type: "round",
  depart_at: "2026-10-07T00:00:00.000Z",
  return_at: "2026-10-08T00:00:00.000Z",
  bus_count: 1,
  passengers: 40,
  created_at: "2026-09-27T01:00:00.000Z",
  confirmed_at: null,
  email: null,
  purpose_code: "family",
  waypoint_codes: [],
  contact_method: null,
  payment_method: null,
  parking_included: null,
  vat_included: null,
  message: null,
  admin_memo: null,
  privacy_consent_at: "2026-09-27T01:00:00.000Z",
  marketing_consent_at: null,
  retention_until: "2027-09-27T01:00:00.000Z",
  withdrawal_consent_at: "2026-09-27T01:00:00.000Z",
  withdrawal_consent_legacy: false,
};

const EMPTY_STATS = {
  range: { from: "2026-09-01", to: "2026-09-27", days: 27, bucket: "day", prev_from: null, prev_to: null, has_prev: false },
  intake: { total: 0, prev_total: null, delta: null },
  confirmation: { total: 0, confirmed: 0, rate_pct: null, pending: 0 },
  response_time: { sample: 0, median_minutes: null, enough: false },
  backlog: { new_total: 0, over_72h: 0, hours: 72 },
  notifications: { failed: 0, stuck: 0, window_days: 7, stuck_hours: 1 },
  trend: [],
  purposes: [],
  vehicles: [],
  segments: [],
  lead_time: [],
};

describe("4-a. 조회 함수 — 집계 세 번을 동시에", () => {
  test("발송 내역 요약(getNotificationSummary) — 실패·멈춤·기록 확인 필요 세 집계가 동시에 나간다", async () => {
    const { getNotificationSummary } = await import("@/lib/admin/notifications");
    const bar = gateAndBarrier(3);
    const client = barrierClient(bar, () => ({ count: 0, error: null }));
    const summary = await within(getNotificationSummary({ now: new Date("2026-09-27T03:00:00.000Z") }, client as never), "getNotificationSummary");
    expect(summary.ok).toBe(true);
    expect(bar.arrived()).toBe(3);
  });

  test("요약 — 동시에 보내도 오류 판정 순서는 그대로다(첫 집계의 오류가 먼저 던져진다)", async () => {
    const { getNotificationSummary } = await import("@/lib/admin/notifications");
    const bar = gateAndBarrier(3);
    const client = barrierClient(bar, (i) => (i === 0 ? { count: null, error: { code: "42501", message: "permission denied" } } : { count: 0, error: null }));
    await expect(within(getNotificationSummary({}, client as never), "summary-error")).rejects.toThrow(/summary\.failed.*42501/);
  });

  test("통계 보정(getNotifyCorrections) — 세 집계가 동시에 나간다", async () => {
    const { getNotifyCorrections } = await import("@/lib/admin/stats");
    const bar = gateAndBarrier(3);
    const client = barrierClient(bar, (i) => ({ count: [4, 1, 2][i], error: null }));
    const got = await within(getNotifyCorrections({ window_days: 7, stuck_hours: 1 }, new Date("2026-09-27T03:00:00.000Z"), client as never), "getNotifyCorrections");
    expect(got).toEqual({ sentUnconfirmed: 4, sentUnconfirmedStuck: 1, suppressedDuplicates: 2 });
  });
});

describe("4-b. 화면 — 게이트가 끝난 뒤, 독립 조회는 동시에", () => {
  afterEach(() => {
    for (const m of RENDER_MOCKS) vi.doUnmock(m);
    vi.resetModules();
  });

  function common(bar: ReturnType<typeof gateAndBarrier>) {
    vi.resetModules();
    vi.doMock("@/lib/auth/requireAdmin", () => ({ requireAdmin: bar.requireAdmin }));
    vi.doMock("next-intl/server", () => ({ getTranslations: async () => translate }));
  }

  test("예약 목록 — 목록 · 탭 건수 · 차량 라벨을 동시에 읽는다 (P5-21 — 탭 건수가 셋째 조회)", async () => {
    const bar = gateAndBarrier(3);
    common(bar);
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) }));
    vi.doMock("@/lib/admin/reservations", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/reservations")),
      listReservations: async () => {
        await bar.arrive("listReservations");
        return { items: [], hasMore: false, nextCursor: null };
      },
      countReservationsByStatus: async () => {
        await bar.arrive("countReservationsByStatus");
        return { new: 0, confirmed: 0, done: 0, cancelled: 0 };
      },
    }));
    vi.doMock("@/lib/queries", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/queries")),
      getVehicles: async () => {
        await bar.arrive("getVehicles");
        return [];
      },
    }));
    const page = (await import("@/app/admin/(protected)/reservations/page")) as {
      default: (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
    };
    await within(page.default({ searchParams: Promise.resolve({}) }), "reservations");
    expect(bar.beforeGate, "조회가 게이트보다 먼저 시작했다").toEqual([]);
    expect(bar.arrived()).toBe(3);
  });

  test("예약 목록 · 확정 탭 — 다가오는 운행 · 지난 확정 · 탭 건수 · 차량 라벨을 동시에 읽는다 (P5-21 수정 라운드 — 리뷰 P1-1 의 두 조회)", async () => {
    const bar = gateAndBarrier(4);
    common(bar);
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) }));
    vi.doMock("@/lib/admin/reservations", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/reservations")),
      listReservations: async () => {
        await bar.arrive("listReservations");
        return { items: [], hasMore: false, nextCursor: null };
      },
      listConfirmedPast: async () => {
        await bar.arrive("listConfirmedPast");
        return { items: [], total: 0 };
      },
      countReservationsByStatus: async () => {
        await bar.arrive("countReservationsByStatus");
        return { new: 0, confirmed: 0, done: 0, cancelled: 0 };
      },
    }));
    vi.doMock("@/lib/queries", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/queries")),
      getVehicles: async () => {
        await bar.arrive("getVehicles");
        return [];
      },
    }));
    const page = (await import("@/app/admin/(protected)/reservations/page")) as {
      default: (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
    };
    await within(page.default({ searchParams: Promise.resolve({ status: "confirmed" }) }), "reservations-confirmed");
    expect(bar.beforeGate, "조회가 게이트보다 먼저 시작했다").toEqual([]);
    expect(bar.arrived()).toBe(4);
  });

  test("예약 상세 — 예약 한 건과 차량 라벨을 동시에 읽는다", async () => {
    const bar = gateAndBarrier(2);
    common(bar);
    vi.doMock("@/lib/admin/reservations", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/reservations")),
      getReservation: async () => {
        await bar.arrive("getReservation");
        return WIZARD_ROW;
      },
    }));
    vi.doMock("@/lib/queries", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/queries")),
      getVehicles: async () => {
        await bar.arrive("getVehicles");
        return [{ id: 1, slug: "bus45", nameKo: "vehicle-45", nameEn: "45", capacity: 45, sort: 1, active: true }];
      },
    }));
    const page = (await import("@/app/admin/(protected)/reservations/[id]/page")) as {
      default: (p: { params: Promise<{ id: string }> }) => Promise<unknown>;
    };
    const tree = await within(page.default({ params: Promise.resolve({ id: WIZARD_ROW.id }) }), "reservation detail");
    expect(bar.beforeGate).toEqual([]);
    // 차량 라벨은 여전히 이름으로 풀린다(slug 폴백이 아니다)
    expect(collect(tree).some((n) => n.props.children === "vehicle-45")).toBe(true);
  });

  test("예약 상세 — uuid 가 아닌 경로면 DB 를 부르지 않는다(동시에 보내도 그대로)", async () => {
    const bar = gateAndBarrier(1);
    common(bar);
    const getReservation = vi.fn();
    const getVehicles = vi.fn();
    vi.doMock("@/lib/admin/reservations", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/reservations")),
      getReservation,
    }));
    vi.doMock("@/lib/queries", async () => ({ ...(await vi.importActual<Record<string, unknown>>("@/lib/queries")), getVehicles }));
    const page = (await import("@/app/admin/(protected)/reservations/[id]/page")) as {
      default: (p: { params: Promise<{ id: string }> }) => Promise<unknown>;
    };
    await within(page.default({ params: Promise.resolve({ id: "not-a-uuid" }) }), "detail-bad-id");
    expect(getReservation).not.toHaveBeenCalled();
    expect(getVehicles).not.toHaveBeenCalled();
  });

  test("발송 내역 — 요약과 목록을 동시에 읽는다", async () => {
    const bar = gateAndBarrier(2);
    common(bar);
    vi.doMock("@/lib/admin/notifications", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/notifications")),
      getNotificationSummary: async () => {
        await bar.arrive("getNotificationSummary");
        return { failed: 0, stuck: 0, sentUnconfirmed: 0, windowHours: 24, ok: true };
      },
      listNotifications: async () => {
        await bar.arrive("listNotifications");
        return { items: [], hasMore: false, nextCursor: null };
      },
    }));
    const page = (await import("@/app/admin/(protected)/notifications/page")) as {
      default: (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
    };
    await within(page.default({ searchParams: Promise.resolve({}) }), "notifications");
    expect(bar.beforeGate).toEqual([]);
  });

  test("통계 — 0022 집계 · 보정 집계 · 차량 이름을 동시에 읽는다", async () => {
    const bar = gateAndBarrier(3);
    common(bar);
    vi.doMock("@/lib/analytics/dashboard", () => ({ vercelAnalyticsUrl: () => null }));
    vi.doMock("@/lib/queries/vehicles", () => ({
      getVehicles: async () => {
        await bar.arrive("getVehicles");
        return [];
      },
    }));
    vi.doMock("@/lib/admin/stats", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/stats")),
      getAdminStats: async () => {
        await bar.arrive("getAdminStats");
        return EMPTY_STATS;
      },
      getNotifyCorrections: async () => {
        await bar.arrive("getNotifyCorrections");
        return { sentUnconfirmed: 0, sentUnconfirmedStuck: 0, suppressedDuplicates: 0 };
      },
    }));
    const page = (await import("@/app/admin/(protected)/stats/page")) as {
      default: (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
    };
    await within(page.default({ searchParams: Promise.resolve({}) }), "stats");
    expect(bar.beforeGate).toEqual([]);
    expect(bar.arrived()).toBe(3);
  });

  test("갤러리 — 앨범 · 사진 · 사용량을 동시에 읽는다 (P6-2 부터 그랬다 — 되돌아가지 않게 잠근다)", async () => {
    const bar = gateAndBarrier(3);
    common(bar);
    vi.doMock("@/lib/admin/gallery", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/gallery")),
      listAdminAlbums: async () => {
        await bar.arrive("listAdminAlbums");
        return [];
      },
      listAdminPhotos: async () => {
        await bar.arrive("listAdminPhotos");
        return [];
      },
      galleryUsage: async () => {
        await bar.arrive("galleryUsage");
        return { photos: 0, bytes: 0 };
      },
    }));
    const page = (await import("@/app/admin/(protected)/gallery/page")) as {
      default: (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
    };
    await within(page.default({ searchParams: Promise.resolve({}) }), "gallery");
    expect(bar.beforeGate).toEqual([]);
  });
});

// =============================================================================
// 5. 탭 링크 — 전체 새로고침이 아니라 클라이언트 이동
// =============================================================================
describe("5. 탭 링크", () => {
  test("AdminTabs 는 next/link 의 Link 로 탭을 그린다 — <a href> 전체 새로고침이 아니다 · prefetch 를 끄지 않았다", () => {
    const src = codeOf("components/admin/AdminTabs.tsx");
    expect(src).toMatch(/import Link from "next\/link";/);
    expect(src).toMatch(/<Link\s[\s\S]*?href=\{item\.href\}/);
    expect(src).not.toMatch(/<a\s[^>]*href=\{item\.href\}/);
    expect(src).not.toMatch(/prefetch=\{false\}/);
  });
});

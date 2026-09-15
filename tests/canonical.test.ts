/**
 * P7-2b — canonical URL + 검색엔진 소유확인 메타 계약 테스트.
 *
 * 무엇을 잠그는가
 *   (1) `lib/site-url.ts` 의 canonical 헬퍼 — 쿼리·해시·로케일 prefix 를 떼고 `siteOrigin()` 기준 절대 URL 을 만든다.
 *       이 태스크의 존재 이유가 여기다: 옛 URL 301 의 목적지에 옛 쿼리가 그대로 붙는다(`/about?bo_page=greeting`).
 *   (2) 공개 라우트 전수 × canonical 유무 — **있어야 할 곳에 있고 없어야 할 곳에 없다**.
 *       파일시스템에서 `page.tsx` 를 모으므로(=`tests/redirects.test.ts` 와 같은 방식) 새 페이지를 만들고
 *       canonical 을 빠뜨리면 빨간불이다.
 *   (3) noindex 라우트(`/quote/done`, 부재 공지)에는 canonical 이 **없다** — 색인하지 말라면서 정본을 알려 주는 것은 모순이다.
 *   (4) `hreflang`(`alternates.languages`) 0건 — `messages/en.json` 이 비어 있어 선언할 언어 대안이 실재하지 않는다.
 *   (5) 소유확인 메타 — env 두 개가 없으면 `verification` 키 자체가 없고(빈 `content=""` 는 콘솔이 실패로 읽는다),
 *       있으면 값이 그대로 들어간다.
 *   (6) `app/sitemap.ts` 의 정적 라우트 집합 == canonical 을 내는 정적 라우트 집합. 둘이 갈라지면 빨간불.
 *
 * 왜 `generateMetadata()` 를 직접 호출하지 않는가
 *   vitest 는 node 환경이고 tsconfig 가 `jsx: "preserve"` 라 `.tsx` 모듈을 import 하면 vite 가
 *   "Failed to parse source for import analysis ... make sure to not set jsx to preserve" 로 죽는다(실측).
 *   vitest 설정은 이 태스크의 범위가 아니므로(다른 세션이 같은 저장소를 편집 중) 페이지 계약은
 *   `tests/pages.test.ts` 와 같은 **소스 정적 검사**로 잠그고, 실제 렌더되는 `<link rel="canonical">` 은
 *   `next start` + curl 실측으로 보고서에 남긴다. 헬퍼(`.ts`)는 진짜로 호출해서 값을 확인한다.
 *
 * 주의: tests/ 아래라 세 게이트(check-no-pricing · check-legal-disclosures · check-temp-values)의 검사 대상이다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { canonicalUrl, siteVerification } from "@/lib/site-url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FALLBACK_ORIGIN = "https://bestour.co.kr";

const LOCALE_LAYOUT = "app/[locale]/layout.tsx";
const SITE_URL_LIB = "lib/site-url.ts";
const ENV_EXAMPLE = ".env.example";

const GOOGLE_ENV = "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION";
const NAVER_ENV = "NEXT_PUBLIC_NAVER_SITE_VERIFICATION";

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/** 주석 제거 — 블록 주석 전체, 줄 주석은 문자열 밖의 // 부터 (tests/pages.test.ts 와 같은 규칙) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      let inStr: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inStr) {
          if (ch === "\\") i++;
          else if (ch === inStr) inStr = null;
        } else if (ch === '"' || ch === "'" || ch === "`") inStr = ch;
        else if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

// =============================================================================
// 공개 라우트 수집 — tests/redirects.test.ts 의 방식 재사용(라우트 그룹은 세그먼트에서 뺀다)
// =============================================================================
const GROUP_DIRS = ["app/[locale]/(site)", "app/[locale]/(legal)"] as const;

type RouteFile = { route: string; rel: string; dynamic: boolean };

function collectRouteFiles(): RouteFile[] {
  const out: RouteFile[] = [];

  const walk = (absDir: string, relDir: string, segments: string[], hasDynamic: boolean) => {
    for (const name of readdirSync(absDir)) {
      const abs = path.join(absDir, name);
      if (statSync(abs).isDirectory()) {
        const isGroup = name.startsWith("(") && name.endsWith(")");
        const isDynamic = name.startsWith("[");
        walk(abs, `${relDir}/${name}`, isGroup ? segments : [...segments, name], hasDynamic || isDynamic);
        continue;
      }
      if (name !== "page.tsx") continue;
      const route = `/${segments.join("/")}`.replace(/\/+$/, "") || "/";
      out.push({ route, rel: `${relDir}/page.tsx`, dynamic: hasDynamic });
    }
  };

  for (const dir of GROUP_DIRS) walk(path.join(ROOT, dir), dir, [], false);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

const ROUTE_FILES = collectRouteFiles();

/**
 * canonical 을 내지 **않는** 정적 라우트 — 페이지가 `robots: { index: false }` 를 내는 곳.
 * 여기 넣는 것은 "색인하지 마라"와 "정본은 여기다"를 동시에 말하지 않겠다는 결정이다.
 */
const NO_CANONICAL = new Set<string>(["/quote/done"]);

/** 동적 라우트의 canonical 인자 — 소스에 그대로 있어야 하는 텍스트. */
const DYNAMIC_CANONICAL_ARG: Record<string, string> = {
  "/notices/[id]": "`/notices/${notice.id}`",
  // P6-3b — 앨범 상세. 정본은 조회한 행의 slug 다(라우트 파라미터의 표기를 그대로 쓰지 않는다).
  "/gallery/[album]": "`/gallery/${album.slug}`",
};

/** 소스에서 `canonicalUrl(<인자>)` 호출의 인자 텍스트를 전부 뽑는다. */
function canonicalArgs(src: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(src).matchAll(/canonicalUrl\(\s*([^)]*?)\s*\)/g)) out.push(m[1]);
  return out;
}

/** `if (<조건>) {` 뒤의 블록 본문을 중괄호 짝을 세어 잘라낸다. */
function blockAfter(src: string, marker: RegExp): string {
  const m = marker.exec(src);
  expect(m, `블록 시작 표식을 찾지 못했다: ${marker}`).not.toBeNull();
  const open = src.indexOf("{", m!.index);
  expect(open, `${marker} 뒤에 여는 중괄호가 없다`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`${marker} 블록의 짝이 맞는 중괄호를 찾지 못했다`);
}

// =============================================================================
// 1. 헬퍼 — canonicalUrl()
// =============================================================================
describe("P7-2b — lib/site-url.ts canonicalUrl()", () => {
  const SAVED = process.env.NEXT_PUBLIC_SITE_URL;
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
  afterEach(() => {
    if (SAVED === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = SAVED;
  });

  test("절대 URL 을 만든다 — siteOrigin() + 경로", () => {
    expect(canonicalUrl("/about")).toBe(`${FALLBACK_ORIGIN}/about`);
    expect(canonicalUrl("/reservation/check")).toBe(`${FALLBACK_ORIGIN}/reservation/check`);
    expect(canonicalUrl("/notices/12")).toBe(`${FALLBACK_ORIGIN}/notices/12`);
  });

  test("홈은 끝 슬래시 하나 — sitemap 의 홈 표기와 같다", () => {
    expect(canonicalUrl("/")).toBe(`${FALLBACK_ORIGIN}/`);
  });

  test("쿼리를 뗀다 — 이 태스크의 존재 이유(옛 URL 301 이 쿼리를 데려온다)", () => {
    expect(canonicalUrl("/about?bo_page=greeting")).toBe(`${FALLBACK_ORIGIN}/about`);
    expect(canonicalUrl("/fleet?bo_page=intro1&x=2")).toBe(`${FALLBACK_ORIGIN}/fleet`);
    expect(canonicalUrl("/notices?page=3")).toBe(`${FALLBACK_ORIGIN}/notices`);
  });

  test("해시를 뗀다", () => {
    expect(canonicalUrl("/about#location")).toBe(`${FALLBACK_ORIGIN}/about`);
    expect(canonicalUrl("/about?bo_page=map#location")).toBe(`${FALLBACK_ORIGIN}/about`);
    expect(canonicalUrl("/about#location?x=1")).toBe(`${FALLBACK_ORIGIN}/about`);
  });

  test("로케일 prefix 를 뗀다 — 영문 경로의 정본은 한국어 경로다", () => {
    expect(canonicalUrl("/en/about")).toBe(`${FALLBACK_ORIGIN}/about`);
    expect(canonicalUrl("/ko/about")).toBe(`${FALLBACK_ORIGIN}/about`);
    expect(canonicalUrl("/en")).toBe(`${FALLBACK_ORIGIN}/`);
    expect(canonicalUrl("/en/")).toBe(`${FALLBACK_ORIGIN}/`);
    expect(canonicalUrl("/en/notices/12?x=1")).toBe(`${FALLBACK_ORIGIN}/notices/12`);
  });

  test("로케일 코드로 시작하는 다른 경로는 건드리지 않는다 (경계)", () => {
    expect(canonicalUrl("/english")).toBe(`${FALLBACK_ORIGIN}/english`);
    expect(canonicalUrl("/entrance/en")).toBe(`${FALLBACK_ORIGIN}/entrance/en`);
    expect(canonicalUrl("/koala")).toBe(`${FALLBACK_ORIGIN}/koala`);
  });

  test("끝 슬래시·중복 슬래시를 정규화한다", () => {
    expect(canonicalUrl("/about/")).toBe(`${FALLBACK_ORIGIN}/about`);
    expect(canonicalUrl("//about//x/")).toBe(`${FALLBACK_ORIGIN}/about/x`);
    expect(canonicalUrl("about")).toBe(`${FALLBACK_ORIGIN}/about`);
    expect(canonicalUrl("")).toBe(`${FALLBACK_ORIGIN}/`);
  });

  test("NEXT_PUBLIC_SITE_URL 을 따른다 (끝 슬래시 정규화) — 호출 시점에 읽는다", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://preview.example.com/";
    expect(canonicalUrl("/about")).toBe("https://preview.example.com/about");
    expect(canonicalUrl("/")).toBe("https://preview.example.com/");
  });

  test("어떤 입력에도 쿼리·해시·로케일 prefix 가 남지 않는다", () => {
    const inputs = [
      "/",
      "/about?bo_page=greeting",
      "/en/about?bo_page=greeting#location",
      "/ko/fares#routes",
      "/notices/12?from=list",
      "/quote?vehicle=bus45",
    ];
    for (const input of inputs) {
      const url = canonicalUrl(input);
      expect(url.startsWith(FALLBACK_ORIGIN), input).toBe(true);
      const rest = url.slice(FALLBACK_ORIGIN.length);
      expect(rest, input).not.toContain("?");
      expect(rest, input).not.toContain("#");
      expect(rest, input).not.toMatch(/^\/(ko|en)(\/|$)/);
      expect(() => new URL(url), input).not.toThrow();
    }
  });
});

// =============================================================================
// 2. 라우트 × canonical 유무
// =============================================================================
describe("P7-2b — 공개 라우트 전수 × canonical", () => {
  test("수집한 라우트가 있고, 동적 라우트도 하나는 있다 (테스트가 의미 있으려면)", () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(0);
    expect(ROUTE_FILES.filter((r) => r.dynamic).length).toBeGreaterThan(0);
  });

  test.for(ROUTE_FILES.map((r) => [r.route, r] as const))("%s — canonical 이 있어야 할 곳에만 있다", ([, file]) => {
    const args = canonicalArgs(read(file.rel));

    if (NO_CANONICAL.has(file.route)) {
      expect(args, `${file.rel} 은 noindex 라우트다 — canonical 을 내면 안 된다`).toEqual([]);
      return;
    }

    expect(args.length, `${file.rel} 에 canonical 이 정확히 한 번 있어야 한다`).toBe(1);
    const expected = file.dynamic ? DYNAMIC_CANONICAL_ARG[file.route] : `"${file.route}"`;
    expect(expected, `동적 라우트 ${file.route} 의 기대 인자를 표에 적어야 한다`).toBeDefined();
    expect(args[0], file.rel).toBe(expected);
  });

  test.for(ROUTE_FILES.filter((r) => !NO_CANONICAL.has(r.route)).map((r) => [r.route, r] as const))(
    "%s — alternates.canonical 자리에 헬퍼로 넣는다 (하드코딩 원점 0)",
    ([, file]) => {
      const src = stripComments(read(file.rel));
      expect(src, file.rel).toMatch(/alternates:\s*\{\s*canonical:\s*canonicalUrl\(/);
      expect(src, `${file.rel} — 원점을 하드코딩하지 않는다`).not.toContain("bestour.co.kr");
      // URL 인스턴스를 넘기면 Next 가 그것을 base 로 보고 **요청 pathname·searchParams 를 다시 붙인다**
      // (node_modules/next/dist/lib/metadata/resolvers/resolve-basics.js resolveAlternateUrl). 문자열만 넘긴다.
      expect(src, `${file.rel} — canonical 에 URL 인스턴스를 넘기지 않는다`).not.toMatch(
        /canonical:\s*new\s+URL/,
      );
      expect(src, `${file.rel} — 헬퍼를 lib/site-url 에서 가져온다`).toMatch(
        /import\s*\{[^}]*\bcanonicalUrl\b[^}]*\}\s*from\s*["']@\/lib\/site-url["']/,
      );
    },
  );

  test("/quote/done — noindex 를 유지하고 canonical 은 없다", () => {
    const file = ROUTE_FILES.find((r) => r.route === "/quote/done");
    expect(file, "/quote/done 페이지가 있어야 한다").toBeDefined();
    const src = stripComments(read(file!.rel));
    expect(src).toMatch(/robots:\s*\{\s*index:\s*false/);
    expect(src).not.toContain("canonical");
  });

  test("/notices/[id] — 공지가 있으면 id 를 담은 canonical, 부재(noindex)면 canonical 없음", () => {
    const file = ROUTE_FILES.find((r) => r.route === "/notices/[id]");
    expect(file, "/notices/[id] 페이지가 있어야 한다").toBeDefined();
    const src = stripComments(read(file!.rel));

    // 부재 분기: `if (!notice) { ... }` 블록 안에 canonical 이 없고 noindex 는 그대로다
    const missingBranch = blockAfter(src, /if\s*\(\s*!notice\s*\)\s*\{/);
    expect(missingBranch).toMatch(/robots:\s*\{\s*index:\s*false/);
    expect(missingBranch, "부재 공지에 정본을 알려 주지 않는다").not.toContain("canonical");

    // 존재 분기: canonical 이 id 를 담는다
    expect(canonicalArgs(src)).toEqual(["`/notices/${notice.id}`"]);
  });
});

// =============================================================================
// 3. hreflang 금지
// =============================================================================
describe("P7-2b — hreflang 을 선언하지 않는다", () => {
  /** app/[locale] 아래 전체 파일(관리자 영역은 로케일 밖이라 대상 아님). */
  function walkFiles(absDir: string, relDir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(absDir)) {
      const abs = path.join(absDir, name);
      if (statSync(abs).isDirectory()) out.push(...walkFiles(abs, `${relDir}/${name}`));
      else out.push(`${relDir}/${name}`);
    }
    return out;
  }

  const LOCALE_FILES = walkFiles(path.join(ROOT, "app/[locale]"), "app/[locale]").filter((f) => f.endsWith(".tsx"));

  test("대상 파일이 있다", () => {
    expect(LOCALE_FILES.length).toBeGreaterThan(0);
  });

  test.for(LOCALE_FILES.map((f) => [f] as const))("%s — alternates.languages · hreflang 0건", ([rel]) => {
    const src = stripComments(read(rel));
    expect(src, `${rel} — 번역이 없는데 언어 대안을 선언하지 않는다`).not.toMatch(/languages\s*:/);
    expect(src, rel).not.toMatch(/hreflang/i);
  });

  test("헬퍼도 언어 대안을 만들지 않는다", () => {
    const src = stripComments(read(SITE_URL_LIB));
    expect(src).not.toMatch(/languages\s*:/);
    expect(src).not.toMatch(/hreflang/i);
  });
});

// =============================================================================
// 4. 소유확인 메타
// =============================================================================
describe("P7-2b — 검색엔진 소유확인 메타", () => {
  const SAVED = { google: process.env[GOOGLE_ENV], naver: process.env[NAVER_ENV] };

  beforeEach(() => {
    delete process.env[GOOGLE_ENV];
    delete process.env[NAVER_ENV];
  });
  afterEach(() => {
    for (const [key, value] of [
      [GOOGLE_ENV, SAVED.google],
      [NAVER_ENV, SAVED.naver],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("env 둘 다 없으면 undefined — 빈 content 태그를 내지 않는다", () => {
    expect(siteVerification()).toBeUndefined();
  });

  test("공백만 있는 값도 없는 것으로 본다", () => {
    process.env[GOOGLE_ENV] = "   ";
    process.env[NAVER_ENV] = "";
    expect(siteVerification()).toBeUndefined();
  });

  test("구글만 있으면 google 만 — naver 키 없음", () => {
    process.env[GOOGLE_ENV] = "google-token-abc";
    expect(siteVerification()).toEqual({ google: "google-token-abc" });
  });

  test("네이버만 있으면 other['naver-site-verification'] 만 — google 키 없음", () => {
    process.env[NAVER_ENV] = "naver-token-xyz";
    expect(siteVerification()).toEqual({ other: { "naver-site-verification": "naver-token-xyz" } });
  });

  test("둘 다 있으면 둘 다, 값은 그대로(앞뒤 공백만 정리)", () => {
    process.env[GOOGLE_ENV] = " google-token-abc ";
    process.env[NAVER_ENV] = "naver-token-xyz";
    expect(siteVerification()).toEqual({
      google: "google-token-abc",
      other: { "naver-site-verification": "naver-token-xyz" },
    });
  });

  test("로케일 레이아웃은 헬퍼로만 붙이고, 값이 없으면 verification 키 자체를 넣지 않는다", () => {
    const src = stripComments(read(LOCALE_LAYOUT));
    expect(src).toMatch(/export\s+(async\s+)?function\s+generateMetadata/);
    expect(src).toMatch(/import\s*\{[^}]*\bsiteVerification\b[^}]*\}\s*from\s*["']@\/lib\/site-url["']/);
    // 조건부 스프레드 — 값이 없을 때 키가 생기지 않는다
    expect(src).toMatch(/\.\.\.\(\s*verification\s*\?\s*\{\s*verification\s*\}\s*:\s*\{\}\s*\)/);
    // 토큰은 env 에서만 온다 — 레이아웃에 env 이름도 값도 없다
    expect(src, "레이아웃이 env 를 직접 읽지 않는다(헬퍼 한 곳)").not.toContain("process.env");
    expect(src).not.toContain(GOOGLE_ENV);
    expect(src).not.toContain(NAVER_ENV);
  });

  test("metadataBase 는 siteOrigin() 에서 온다 — 하드코딩 0", () => {
    const src = stripComments(read(LOCALE_LAYOUT));
    expect(src).toMatch(/metadataBase:\s*new\s+URL\(\s*siteOrigin\(\)\s*\)/);
    expect(src).not.toContain("bestour.co.kr");
  });

  test(".env.example 에 두 키가 공란으로 있고 기존 키는 그대로다", () => {
    const env = read(ENV_EXAMPLE);
    expect(env).toMatch(new RegExp(`^${GOOGLE_ENV}=$`, "m"));
    expect(env).toMatch(new RegExp(`^${NAVER_ENV}=$`, "m"));
    for (const key of [
      "NEXT_PUBLIC_SITE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "GUARD_SECRET",
      "ADMIN_EMAILS",
      "CRON_SECRET",
    ]) {
      expect(env, key).toMatch(new RegExp(`^${key}=$`, "m"));
    }
  });
});

// =============================================================================
// 5. sitemap ↔ canonical 라우트 집합
// =============================================================================
describe("P7-2b — sitemap 과 canonical 이 같은 집합을 가리킨다", () => {
  const SAVED = process.env.NEXT_PUBLIC_SITE_URL;
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
  afterEach(() => {
    if (SAVED === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = SAVED;
  });

  test("sitemap 의 정적 라우트 == canonical 을 내는 정적 라우트 (11개)", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    const sitemapPaths = sitemap()
      .map((entry) => new URL(entry.url).pathname)
      .sort();

    const canonicalRoutes = ROUTE_FILES.filter((r) => !r.dynamic && canonicalArgs(read(r.rel)).length > 0)
      .map((r) => r.route)
      .sort();

    expect(canonicalRoutes).toEqual(sitemapPaths);
    expect(canonicalRoutes.length).toBe(11);
  });

  /**
   * 주의: 이것은 **헬퍼 값**과 sitemap 의 대조다. 렌더된 `<link rel="canonical">` 은 홈에서만 한 글자 다르다 —
   * Next 가 경로 `/` 뿐인 canonical 을 origin 형태로 줄인다(`https://bestour.co.kr`, 실측). 같은 URI 다(RFC 3986 §6.2.3).
   */
  test("sitemap 의 각 URL 은 그 라우트의 canonical 과 문자 그대로 같다", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    for (const entry of sitemap()) {
      const pathname = new URL(entry.url).pathname;
      expect(canonicalUrl(pathname), pathname).toBe(entry.url);
    }
  });

  test("canonical 을 내지 않는 정적 라우트는 sitemap 에도 없다", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    const sitemapPaths = new Set(sitemap().map((entry) => new URL(entry.url).pathname));
    for (const route of NO_CANONICAL) {
      expect(sitemapPaths.has(route), route).toBe(false);
    }
  });
});

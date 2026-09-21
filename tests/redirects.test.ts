/**
 * P7-1 · P7-2 — 옛 사이트 URL 영구 리다이렉트 + robots · sitemap 계약 테스트.
 *
 * 무엇을 잠그는가
 *   (1) `next.config.ts` 의 `redirects()` 를 **실제로 호출**해 얻은 배열이 아래 REDIRECTS 표와 1:1 이다.
 *       표는 보고서(`P7-1-2-report.md`)의 표와 같은 순서·같은 내용이며, 한쪽만 고치면 이 테스트가 빨간불이 된다.
 *   (2) 목적지가 살아 있다 — `lib/legacy-menu-map.ts` 의 ready 경로(또는 `/`)이고, 실제 page.tsx 파일이 있다.
 *       (죽은 곳으로 보내는 리다이렉트는 404 보다 나쁘다.)
 *   (3) 로케일 prefix 없는 목적지 — `/ko/about` 로 보내면 미들웨어가 307 을 한 번 더 태운다.
 *   (4) `/css/*` 는 리다이렉트하지 않는다(자산 404 는 정상).
 *   (5) `app/robots.ts` — 운영만 색인 허용, 비운영은 전면 disallow(ADR-10).
 *   (6) `app/sitemap.ts` — 파일시스템의 정적 공개 라우트 집합과 1:1. 새 페이지를 만들고 sitemap 에 안 넣으면 빨간불.
 *
 * 상태코드 메모: `permanent: true` 를 쓰면 Next 는 **308** 을 낸다. 옛 URL 은 GET 문서뿐이고
 * 국내 검색엔진(Naver Yeti)의 308 처리는 문서로 확인되지 않아, 문자 그대로의 **301** 을 낸다
 * (`statusCode: 301`). 보고서 §판단이 갈린 지점 참조.
 *
 * 주의: tests/ 아래라 세 게이트(check-no-pricing · check-legal-disclosures · check-temp-values)의 검사 대상이다.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { LEGACY_MENU } from "@/lib/legacy-menu-map";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FALLBACK_ORIGIN = "https://bestour.co.kr";

// =============================================================================
// 옛 URL 전수 — P0-6 크롤 manifest 의 HTML 문서 18건 (css 2건 제외).
// 이 목록은 URL 패턴만 담는다(크롤 원문은 gitignore 된 docs/private 에 있고 저장소는 public 이다).
// =============================================================================
const CRAWLED_HTML_URLS: readonly string[] = [
  "/index.php?from=",
  "/page/page.php?bo_page=greeting",
  "/page/page.php?bo_page=intro1",
  "/page/page.php?bo_page=intro2",
  "/page/page.php?bo_page=intro3",
  "/page/page.php?bo_page=intro4",
  "/page/page.php?bo_page=intro5",
  "/page/page.php?bo_page=intro6",
  "/page/page.php?bo_page=intro7",
  "/page/page.php?bo_page=intro8",
  "/page/page.php?bo_page=intro9",
  "/page/page.php?bo_page=intro10",
  "/page/page.php?bo_page=intro11",
  "/page/page.php?bo_page=map",
  "/page/page.php?bo_page=estimate",
  "/bbs/board.php?bo_table=notice",
  "/bbs/board.php?bo_table=thema1",
  "/bbs/board.php?bo_table=free",
];

type Row = {
  /** 옛 URL(쿼리 포함). 보고서 표의 왼쪽 열. */
  url: string;
  /** 새 경로. 로케일 prefix 없음. */
  destination: string;
  /** false 면 쿼리를 보지 않고 경로만 매칭한다(옛 홈은 `?from=` 유무와 무관하게 홈이다). */
  matchQuery?: false;
};

/** 목적지를 확정한 옛 URL 전수 — 보고서 표와 1:1. */
const REDIRECTS: readonly Row[] = [
  { url: "/index.php?from=", destination: "/", matchQuery: false },
  { url: "/page/page.php?bo_page=greeting", destination: "/about" },
  { url: "/page/page.php?bo_page=map", destination: "/about#location" },
  { url: "/page/page.php?bo_page=intro1", destination: "/fleet" },
  { url: "/page/page.php?bo_page=intro2", destination: "/fleet" },
  { url: "/page/page.php?bo_page=intro3", destination: "/fleet" },
  { url: "/page/page.php?bo_page=intro4", destination: "/fleet" },
  { url: "/page/page.php?bo_page=intro5", destination: "/fleet" },
  { url: "/page/page.php?bo_page=intro6", destination: "/fleet" },
  { url: "/page/page.php?bo_page=intro7", destination: "/fleet" },
  { url: "/page/page.php?bo_page=intro8", destination: "/fleet" },
  { url: "/page/page.php?bo_page=intro9", destination: "/fleet" },
  { url: "/page/page.php?bo_page=intro10", destination: "/fleet" },
  { url: "/page/page.php?bo_page=intro11", destination: "/fares" },
  { url: "/page/page.php?bo_page=estimate", destination: "/guide" },
  { url: "/bbs/board.php?bo_table=notice", destination: "/notices" },
  { url: "/bbs/board.php?bo_table=thema1", destination: "/gallery" },
  // 아래 2건은 크롤 대상이 아니었다(CRAWLED_HTML_URLS 에 없다) — 인벤토리 기록만으로 목적지를 정했다.
  { url: "/bbs/board.php?bo_table=estimate", destination: "/quote" },
  { url: "/bbs/board.php?bo_table=confirm", destination: "/reservation/check" },
];

/**
 * 크롤하지 않았지만 인벤토리가 정체를 적어 둔 게시판 2종.
 * `estimate` 는 확정(개인정보 우려로 크롤 제외), `confirm` 은 인벤토리 §5 의 "예약확인으로 추정" 이다 —
 * 추정임을 보고서 §미확정 에 남긴 채 리다이렉트한다(틀려도 404 가 아니라 실재 페이지로 간다. 컨트롤러 결정).
 */
const UNCRAWLED_BOARDS: readonly string[] = [
  "/bbs/board.php?bo_table=estimate",
  "/bbs/board.php?bo_table=confirm",
];

/**
 * 목적지를 정하지 못한 옛 URL — 보고서 §미확정 과 1:1.
 * 지어낸 목적지보다 매칭 없는 404(정상 문서, known-defects D1)가 낫다.
 */
const UNRESOLVED: readonly string[] = ["/bbs/board.php?bo_table=free"];

// =============================================================================
// 헬퍼
// =============================================================================
type HasClause = { type: string; key: string; value?: string };
type RedirectEntry = {
  source: string;
  destination: string;
  statusCode?: number;
  permanent?: boolean;
  has?: HasClause[];
  missing?: HasClause[];
  locale?: false;
};

async function loadRedirects(): Promise<RedirectEntry[]> {
  const mod = await import("@/next.config");
  const config = mod.default as { redirects?: () => Promise<unknown> };
  expect(typeof config.redirects, "next.config.ts 가 redirects() 를 내보내야 한다").toBe("function");
  const list = (await config.redirects!()) as RedirectEntry[];
  expect(Array.isArray(list)).toBe(true);
  return list;
}

/** 옛 URL 문자열 → 설정 항목의 정규화 키(`경로` 또는 `경로?키=값`). */
function normalizeRow(row: Row): string {
  const [pathname, query] = row.url.split("?");
  if (row.matchQuery === false || !query) return pathname;
  return `${pathname}?${query}`;
}

/** 설정 항목 → 같은 형태의 정규화 키. */
function normalizeEntry(entry: RedirectEntry): string {
  const queries = (entry.has ?? []).filter((h) => h.type === "query");
  if (queries.length === 0) return entry.source;
  const parts = queries.map((q) => `${q.key}=${q.value ?? ""}`).sort();
  return `${entry.source}?${parts.join("&")}`;
}

/** 목적지에서 해시를 뗀 경로. */
function destPath(destination: string): string {
  return destination.split("#")[0];
}

const READY_MENU_HREFS = LEGACY_MENU.filter((m) => m.ready && !m.external).map((m) => m.href);
const ALLOWED_DESTINATIONS = new Set<string>([...READY_MENU_HREFS, "/"]);

/** 라우트 그룹 디렉터리를 훑어 정적 라우트 경로를 모은다(동적 세그먼트 제외). */
const GROUP_DIRS = ["app/[locale]/(site)", "app/[locale]/(legal)"] as const;
const SITEMAP_EXCLUDED = new Set<string>(["/quote/done"]);

function collectRoutes(): { paths: string[]; dynamic: string[] } {
  const paths: string[] = [];
  const dynamic: string[] = [];

  const walk = (absDir: string, segments: string[], hasDynamic: boolean) => {
    for (const name of readdirSync(absDir)) {
      const abs = path.join(absDir, name);
      if (statSync(abs).isDirectory()) {
        const isGroup = name.startsWith("(") && name.endsWith(")");
        const isDynamic = name.startsWith("[");
        walk(abs, isGroup ? segments : [...segments, name], hasDynamic || isDynamic);
        continue;
      }
      if (name !== "page.tsx") continue;
      const route = `/${segments.join("/")}`.replace(/\/+$/, "") || "/";
      (hasDynamic ? dynamic : paths).push(route);
    }
  };

  for (const dir of GROUP_DIRS) walk(path.join(ROOT, dir), [], false);
  return { paths: [...new Set(paths)].sort(), dynamic: [...new Set(dynamic)].sort() };
}

/** 그 경로에 실제 page.tsx 가 있는가(목적지가 404 가 아님을 파일로 확인). */
function routeFileExists(route: string): boolean {
  const rel = route === "/" ? "" : route;
  return GROUP_DIRS.some((dir) => existsSync(path.join(ROOT, dir, rel, "page.tsx")));
}

// =============================================================================
// 1. 리다이렉트 표
// =============================================================================
describe("P7-1 — next.config.ts redirects()", () => {
  test("표 전수: 설정의 옛 URL 집합이 REDIRECTS 표와 1:1", async () => {
    const entries = await loadRedirects();
    const actual = entries.map(normalizeEntry).sort();
    const expected = REDIRECTS.map(normalizeRow).sort();
    expect(actual).toEqual(expected);
    expect(entries.length).toBe(REDIRECTS.length);
  });

  test("각 옛 URL 의 목적지가 표와 같다", async () => {
    const entries = await loadRedirects();
    const byKey = new Map(entries.map((e) => [normalizeEntry(e), e.destination]));
    for (const row of REDIRECTS) {
      expect(byKey.get(normalizeRow(row)), row.url).toBe(row.destination);
    }
  });

  test("전부 영구 리다이렉트 — statusCode 301 (permanent:true 는 308 이라 쓰지 않는다)", async () => {
    for (const entry of await loadRedirects()) {
      expect(entry.statusCode, entry.source).toBe(301);
      expect(entry.permanent, entry.source).toBeUndefined();
    }
  });

  test("목적지는 로케일 prefix 없는 절대 경로다", async () => {
    for (const entry of await loadRedirects()) {
      expect(entry.destination.startsWith("/"), entry.destination).toBe(true);
      expect(entry.destination).not.toMatch(/^\/(ko|en)(\/|#|$)/);
      expect(entry.destination).not.toMatch(/^https?:/);
    }
  });

  test("목적지는 legacy-menu-map 의 ready 경로이거나 홈이고, page.tsx 가 실재한다", async () => {
    for (const entry of await loadRedirects()) {
      expect(ALLOWED_DESTINATIONS.has(entry.destination), entry.destination).toBe(true);
      expect(routeFileExists(destPath(entry.destination)), entry.destination).toBe(true);
    }
  });

  test("/css 는 리다이렉트하지 않는다 — 자산 404 는 정상", async () => {
    const entries = await loadRedirects();
    expect(entries.filter((e) => e.source.includes("/css")).length).toBe(0);
    expect(REDIRECTS.filter((r) => r.url.includes("/css")).length).toBe(0);
  });

  test("source+has 조합 중복 0", async () => {
    const keys = (await loadRedirects()).map(normalizeEntry);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("쿼리 매칭은 query 타입 has 로만 한다 (경로 매칭 항목은 홈 하나)", async () => {
    const entries = await loadRedirects();
    for (const entry of entries) {
      for (const clause of entry.has ?? []) {
        expect(clause.type, entry.source).toBe("query");
        expect(typeof clause.value, `${entry.source}?${clause.key}`).toBe("string");
      }
      expect(entry.missing, entry.source).toBeUndefined();
    }
    expect(entries.filter((e) => (e.has ?? []).length === 0).map((e) => e.source)).toEqual(["/index.php"]);
  });

  test("옛 URL 전수 감사: 크롤한 18건 = 리다이렉트 + 미확정 (크롤 밖 2건은 따로 센다)", () => {
    const fromCrawl = REDIRECTS.map((r) => r.url).filter((url) => !UNCRAWLED_BOARDS.includes(url));
    const covered = [...fromCrawl, ...UNRESOLVED].sort();
    expect(covered).toEqual([...CRAWLED_HTML_URLS].sort());
    expect(new Set(covered).size).toBe(CRAWLED_HTML_URLS.length);
  });

  test("크롤 밖 게시판 2종은 인벤토리 기록이 있는 것만 — 리다이렉트 표에 정확히 그 2건", () => {
    const extras = REDIRECTS.map((r) => r.url).filter((url) => !CRAWLED_HTML_URLS.includes(url));
    expect([...extras].sort()).toEqual([...UNCRAWLED_BOARDS].sort());

    const byUrl = new Map(REDIRECTS.map((r) => [r.url, r.destination]));
    expect(byUrl.get("/bbs/board.php?bo_table=estimate")).toBe("/quote");
    expect(byUrl.get("/bbs/board.php?bo_table=confirm")).toBe("/reservation/check");
  });

  test("크롤 밖 2건도 같은 계약을 지킨다 — 301 · ready 목적지 · 로케일 prefix 없음", async () => {
    const entries = await loadRedirects();
    for (const url of UNCRAWLED_BOARDS) {
      const [pathname, query] = url.split("?");
      const entry = entries.find((e) => normalizeEntry(e) === `${pathname}?${query}`);
      expect(entry, url).toBeDefined();
      expect(entry!.statusCode, url).toBe(301);
      expect(entry!.permanent, url).toBeUndefined();
      expect(entry!.destination.startsWith("/"), url).toBe(true);
      expect(entry!.destination, url).not.toMatch(/^\/(ko|en)(\/|#|$)/);
      expect(ALLOWED_DESTINATIONS.has(entry!.destination), entry!.destination).toBe(true);
      expect(routeFileExists(destPath(entry!.destination)), entry!.destination).toBe(true);
    }
  });

  test("정체를 모르는 게시판(story · rentcar)과 후신 없는 자유게시판은 리다이렉트하지 않는다", async () => {
    const entries = await loadRedirects();
    for (const value of ["free", "story", "rentcar"]) {
      const hit = entries.find((e) => normalizeEntry(e) === `/bbs/board.php?bo_table=${value}`);
      expect(hit, value).toBeUndefined();
    }
  });

  test("미확정 URL 은 리다이렉트 표에 없다", async () => {
    const entries = await loadRedirects();
    for (const url of UNRESOLVED) {
      const [pathname, query] = url.split("?");
      const hit = entries.find((e) => e.source === pathname && normalizeEntry(e) === `${pathname}?${query}`);
      expect(hit, url).toBeUndefined();
    }
  });
});

// =============================================================================
// 2. robots
// =============================================================================
describe("P7-2 — app/robots.ts", () => {
  const SAVED = { vercel: process.env.VERCEL_ENV, site: process.env.NEXT_PUBLIC_SITE_URL };

  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
  afterEach(() => {
    if (SAVED.vercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = SAVED.vercel;
    if (SAVED.site === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = SAVED.site;
  });

  test("운영(VERCEL_ENV=production): 전체 허용 + /admin disallow + sitemap 절대 URL", async () => {
    process.env.VERCEL_ENV = "production";
    const robots = (await import("@/app/robots")).default;
    const out = robots();
    const rules = Array.isArray(out.rules) ? out.rules : [out.rules];

    expect(rules.length).toBe(1);
    expect(rules[0].userAgent).toBe("*");
    expect(rules[0].allow).toBe("/");
    const disallow = rules[0].disallow;
    expect(Array.isArray(disallow) ? disallow : [disallow]).toContain("/admin");
    expect(out.sitemap).toBe(`${FALLBACK_ORIGIN}/sitemap.xml`);
  });

  test("비운영(preview·미설정): 전면 disallow, sitemap 광고 없음", async () => {
    const robots = (await import("@/app/robots")).default;

    for (const env of ["preview", "development", undefined]) {
      if (env === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = env;

      const out = robots();
      const rules = Array.isArray(out.rules) ? out.rules : [out.rules];
      expect(rules.length, String(env)).toBe(1);
      expect(rules[0].userAgent, String(env)).toBe("*");
      expect(rules[0].disallow, String(env)).toBe("/");
      expect(rules[0].allow, String(env)).toBeUndefined();
      expect(out.sitemap, String(env)).toBeUndefined();
    }
  });

  test("sitemap URL 은 NEXT_PUBLIC_SITE_URL 을 따른다 (끝 슬래시 정규화)", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://preview.example.com/";
    const robots = (await import("@/app/robots")).default;
    expect(robots().sitemap).toBe("https://preview.example.com/sitemap.xml");
  });
});

// =============================================================================
// 3. sitemap
// =============================================================================
describe("P7-2 — app/sitemap.ts", () => {
  const SAVED = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
  afterEach(() => {
    if (SAVED === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = SAVED;
  });

  test("파일시스템의 정적 공개 라우트 × 로케일(ko·en)과 1:1 (제외: /quote/done · 동적 세그먼트)", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    const { paths, dynamic } = collectRoutes();
    const kept = paths.filter((p) => !SITEMAP_EXCLUDED.has(p));
    // 홈은 `https://bestour.co.kr/` — 끝 슬래시를 붙인 형태가 sitemap 관례다. 영문 홈은 `/en`(as-needed prefix).
    // P2-6: messages/en.json 이 채워져 `/en/*` 이 독립 문서가 됐다 — 영문 경로도 색인시킨다.
    const expected = [
      ...kept.map((p) => `${FALLBACK_ORIGIN}${p}`),
      ...kept.map((p) => `${FALLBACK_ORIGIN}/en${p === "/" ? "" : p}`),
    ];

    const urls = sitemap().map((e) => e.url);
    expect([...urls].sort()).toEqual([...expected].sort());
    expect(dynamic.length, "동적 세그먼트 라우트가 하나는 있어야 이 테스트가 의미 있다").toBeGreaterThan(0);
  });

  test("/admin · /quote/done · 동적 세그먼트는 없다", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    for (const entry of sitemap()) {
      expect(entry.url).not.toContain("/admin");
      expect(entry.url).not.toContain("/quote/done");
      expect(entry.url).not.toContain("[");
    }
  });

  test("전부 절대 URL 이고 ko 는 prefix 없음, en 은 `/en` 하나 — `/ko` prefix 는 없다 (as-needed)", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(0);
    let en = 0;
    for (const entry of entries) {
      expect(entry.url.startsWith(`${FALLBACK_ORIGIN}`), entry.url).toBe(true);
      const rest = entry.url.slice(FALLBACK_ORIGIN.length);
      expect(rest).not.toMatch(/^\/ko(\/|$)/);
      expect(rest).not.toMatch(/^\/en\/en(\/|$)/);
      if (/^\/en(\/|$)/.test(rest)) en += 1;
    }
    expect(en * 2, "ko 와 en 이 같은 수다").toBe(entries.length);
  });

  test("항목마다 언어 대안(ko·en·x-default)을 싣는다 — 페이지의 hreflang 과 같은 헬퍼(pageAlternates)", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    for (const entry of sitemap()) {
      const langs = entry.alternates?.languages ?? {};
      expect(Object.keys(langs).sort(), entry.url).toEqual(["en", "ko", "x-default"]);
      expect(Object.values(langs), entry.url).toContain(entry.url);
    }
  });

  test("NEXT_PUBLIC_SITE_URL 을 따른다 (끝 슬래시 정규화)", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://preview.example.com/";
    const sitemap = (await import("@/app/sitemap")).default;
    for (const entry of sitemap()) {
      expect(entry.url.startsWith("https://preview.example.com/"), entry.url).toBe(true);
      expect(entry.url).not.toContain("//sitemap");
    }
  });

  test("빌드 시각을 넣지 않는다 — 두 번 호출해도 완전히 같다", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    expect(sitemap()).toEqual(sitemap());
    for (const entry of sitemap()) expect(entry.lastModified).toBeUndefined();
  });

  test("DB 를 읽지 않는다 — supabase·queries import 0", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(path.join(ROOT, "app/sitemap.ts"), "utf8");
    expect(src).not.toMatch(/@\/lib\/(supabase|queries)/);
    expect(src).not.toMatch(/supabase/i);
    expect(src).not.toMatch(/await/);
  });
});

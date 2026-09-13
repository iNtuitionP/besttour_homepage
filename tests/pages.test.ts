/**
 * P6-3 — 공개 서브페이지 5종(`/about` `/fleet` `/fares` `/notices` `/notices/[id]` `/gallery`) + 옛 메뉴 매핑 완성 계약 테스트.
 *
 * vitest 는 node 환경이다 — DOM 렌더 테스트용 패키지를 설치하지 않는다. 여기서는
 *   (1) 소스 정적 검사(라우트 파일·`revalidate`·요청 시점 API 0·서비스 롤 0·`dangerouslySetInnerHTML` 0·한글 리터럴 0),
 *   (2) 카피 규칙(실증 불가 수치·BM 금지어·타사 상호·"면허"·금액·요금표·비교 광고 표현 0, 인벤토리 원문 대조, `home.*` 재사용),
 *   (3) 순수 함수(`parseNoticeId` · `getNotice` mock 클라이언트 · `splitParagraphs`),
 *   (4) `LEGACY_MENU` ready 플래그
 * 만 잠그고, 실제 렌더(375/1280 오버플로·콘솔·`aria-disabled` 잔여·404 문서)는 browse 로 실측해 보고서에 남긴다.
 *
 * 주의: tests/ 아래라 세 게이트(check-no-pricing · check-legal-disclosures · check-temp-values)의 검사 대상이다.
 * 금지어·임시값 마커 리터럴은 유니코드 이스케이프/문자열 결합으로 조립한다(tests/home.test.ts · tests/gates.test.ts 규약).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { PREFILL_PARAMS } from "@/components/quote/prefill";
import { splitParagraphs } from "@/components/pages/paragraphs";
import { LEGACY_MENU } from "@/lib/legacy-menu-map";
import { COMPANY, INSURANCE, PAYMENT, QUOTE_BASIS, VERBATIM } from "@/lib/legal/disclosures";
import { getNotice, getNotices, parseNoticeId } from "@/lib/queries";
import type { AnonClient } from "@/lib/supabase/anon";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SITE = "app/[locale]/(site)";
const PAGE_FILES = {
  about: `${SITE}/about/page.tsx`,
  fleet: `${SITE}/fleet/page.tsx`,
  fares: `${SITE}/fares/page.tsx`,
  notices: `${SITE}/notices/page.tsx`,
  noticeDetail: `${SITE}/notices/[id]/page.tsx`,
  gallery: `${SITE}/gallery/page.tsx`,
} as const;
const PAGES_DIR = "components/pages";
const MENU_MAP = "lib/legacy-menu-map.ts";
const NOTICES_QUERY = "lib/queries/notices.ts";
const INVENTORY = "docs/ops/legacy-content-inventory.md";
const MESSAGES_KO = "messages/ko.json";
const ALLOWLIST = "scripts/gates/temp-allowlist.txt";
const TEMP_MARKER = "[TEMP" + "]";

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const exists = (rel: string) => existsSync(path.join(ROOT, rel));

function walk(absDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(absDir)) {
    const p = path.join(absDir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const toPosix = (p: string) => p.split(path.sep).join("/");

/** 주석 제거 — 블록 주석 전체, 줄 주석은 문자열 밖의 // 부터 (tests/layout.test.ts 와 같은 규칙) */
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

function ledgerImports(src: string): string[] {
  const names: string[] = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/legal\/disclosures["']/g;
  for (const m of src.matchAll(re)) {
    for (const raw of m[1].split(",")) {
      const n = raw.trim().split(/\s+as\s+/)[0].trim();
      if (n) names.push(n);
    }
  }
  return names;
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

/** 객체의 모든 문자열 잎(leaf)을 모은다 — ko.json 네임스페이스 전수 검사용 */
function leaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) leaves(x, out);
  return out;
}

const pageEntries = Object.entries(PAGE_FILES) as ReadonlyArray<[keyof typeof PAGE_FILES, string]>;
const pageSources = pageEntries.filter(([, rel]) => exists(rel)).map(([key, rel]) => ({ key, rel, text: read(rel) }));
const pagesDirFiles = exists(PAGES_DIR)
  ? walk(path.join(ROOT, PAGES_DIR)).map((p) => toPosix(path.relative(ROOT, p)))
  : [];
const componentSources = pagesDirFiles.filter((f) => /\.(tsx?|css)$/.test(f)).map((rel) => ({ rel, text: read(rel) }));
/** 새 코드 전체(페이지 + components/pages) — 카피·금지어 검사 대상 */
const allNewSources = [...pageSources, ...componentSources];

const koText = read(MESSAGES_KO);
const ko = JSON.parse(koText) as Record<string, unknown>;
const pagesKo = (ko.pages ?? {}) as Record<string, unknown>;
const pagesKoText = JSON.stringify(pagesKo);
const pagesLeaves = leaves(pagesKo);
const homeKo = (ko.home ?? {}) as Record<string, unknown>;
const homeLeaves = leaves(homeKo);

// ── 금지어 (리터럴 금지 — 헤더 참조) ──────────────────────────────────────
// 코드 포인트로 조립한다 — 이 파일도 check-legal-disclosures.sh 의 검사 대상이라 리터럴을 두면 게이트가 빨강이다.
const cp = (...codes: number[]) => String.fromCharCode(...codes);
const W_LICENSE = cp(0xba74, 0xd5c8); // "등록"이 맞다 — CLAUDE.md §3
const W_RIVAL = cp(0xc804, 0xc138, 0xbc84, 0xc2a4, 0xd558, 0xb098); // 타사 상호
const W_BM_OUTBOUND = cp(0xb098, 0xac00, 0xb294, 0x20, 0xbc84, 0xc2a4); // soul §10.2
const W_BM_TAKEOUT = cp(0xd0dc, 0xc6b0, 0xace0, 0x20, 0xb098, 0xac00); // soul §10.2
const W_BM_EMPTY = cp(0xacf5, 0xcc28); // soul §10.2
const W_BM_RETURN = cp(0xd68c, 0xc1a1); // soul §10.2
const FORBIDDEN = [W_LICENSE, W_RIVAL, W_BM_OUTBOUND, W_BM_TAKEOUT, W_BM_EMPTY, W_BM_RETURN];

/** 실증 불가 수치·주장 (CLAUDE.md §3 · 브리프 §하지 말 것). "2013년부터"(원장 establishedYear 보간)는 허용이므로 13년 앞에 숫자가 없을 때만 잡는다. */
const UNPROVEN: ReadonlyArray<[string, RegExp]> = [
  ["4,800", /4,800/],
  ["70만", /70만/],
  ["만 명", /만\s*명/],
  ["13년", /(?<!\d)13년/],
  ["17건", /17건/],
  ["연중무휴", /연중무휴/],
  ["누적", /누적/],
  ["운행 경력", /운행 경력/],
  ["2013 하드코딩", /(?<![\w-])2013(?![\w-])/],
  ["무사고", /무사고/],
  ["사고 없", /사고\s*없/],
  ["큰 사고", /큰 사고/],
  ["차량 대수 주장", /\d+\s*대\s*(보유|의 차량|규모)/],
  ["연식", /연식/],
  ["년식", /년식/],
  ["외국인 관광객 수송 문장", /외국인 관광객/],
  ["국토여행", /국토여행/],
];

/** /fares 무가격 규칙 (브리프 §/fares) — 금액 셀·km 단가·요금표·비교 광고 표현 */
const PRICE_TABLE: ReadonlyArray<[string, RegExp]> = [
  ["원 단위 금액", /\d{1,3}(,\d{3})+\s*원/],
  ["만원 리터럴", /\d+(\.\d+)?\s*만\s*원/],
  ["km당", /km\s*당/i],
  ["초과", /초과/],
  ["요금표", /요금표/],
  ["저렴", /저렴/],
  ["최저", /최저/],
  ["할인율", /\d+\s*%/],
];

/** check-no-pricing.sh 와 같은 패턴 — 게이트가 이 파일도 보므로 심볼을 조각으로 조립한다 */
const PRICING_SYMBOLS = new RegExp(
  ["esti" + "mate\\(", "price_" + "state", "est_" + "price", "route_" + "prices", "PRICE_DISPLAY" + "_MODE"].join("|"),
);

// =============================================================================
// 1. 라우트 파일 6개 — 존재 · 정적 렌더(ISR 600) · 요청 시점 API 0 · 서비스 롤 0 · HTML 렌더 0
// =============================================================================
describe("1. 라우트 파일 — 존재 · revalidate = 600 · 요청 시점 API 0", () => {
  test.for(pageEntries)("%s 라우트 파일이 있다 (%s)", ([, rel]) => {
    expect(exists(rel), `${rel} 없음`).toBe(true);
  });

  test("검사 대상이 실제로 있다 (빈 배열 통과 방지)", () => {
    expect(pageSources.length).toBe(6);
    expect(componentSources.length).toBeGreaterThanOrEqual(2);
  });

  test.for(pageEntries)("%s — `export const revalidate = 600` · force-dynamic 없음", ([, rel]) => {
    const code = stripComments(read(rel));
    expect(code).toMatch(/export\s+const\s+revalidate\s*=\s*600\b/);
    expect(/force-dynamic/.test(code)).toBe(false);
  });

  test.for(pageEntries)("%s — headers()·cookies()·searchParams·draftMode 0 (정적 렌더 유지)", ([, rel]) => {
    const code = stripComments(read(rel));
    expect(/\bheaders\s*\(/.test(code), "headers()").toBe(false);
    expect(/\bcookies\s*\(/.test(code), "cookies()").toBe(false);
    expect(/searchParams/.test(code), "searchParams").toBe(false);
    expect(/draftMode/.test(code), "draftMode").toBe(false);
    expect(/from\s+["']next\/headers["']/.test(code), "next/headers import").toBe(false);
  });

  test.for(pageEntries)("%s — 서버 액션·서비스 롤·Next 캐시 우회 0 (anon + RLS 읽기 전용)", ([, rel]) => {
    const code = stripComments(read(rel));
    expect(/['"]use server['"]/.test(code), "use server").toBe(false);
    expect(/createServiceClient|service_role|SUPABASE_SERVICE_ROLE_KEY/.test(code), "서비스 롤").toBe(false);
    expect(/@\/lib\/supabase\/server/.test(code), "서비스 롤 모듈").toBe(false);
    expect(/@\/actions\//.test(code), "서버 액션 import").toBe(false);
  });

  test.for(pageEntries)("%s — dangerouslySetInnerHTML 0 · next/link 직접 import 0 · 'use client' 0", ([, rel]) => {
    const text = read(rel);
    expect(text.includes("dangerouslySetInnerHTML")).toBe(false);
    expect(/from\s+["']next\/link["']/.test(text)).toBe(false);
    expect(/^\s*["']use client["']/m.test(text)).toBe(false);
  });

  test("components/pages/** 도 'use client'·dangerouslySetInnerHTML·next/link·조회(lib/queries)·서비스 롤 0", () => {
    for (const { rel, text } of componentSources) {
      expect(/^\s*["']use client["']/m.test(text), `${rel} 가 클라이언트 컴포넌트다`).toBe(false);
      expect(text.includes("dangerouslySetInnerHTML"), rel).toBe(false);
      expect(/from\s+["']next\/link["']/.test(text), rel).toBe(false);
      expect(/@\/lib\/queries|createAnonClient|@\/lib\/supabase/.test(text), `${rel} 가 직접 조회한다`).toBe(false);
    }
  });

  test.for(pageEntries)("%s — generateMetadata 가 있고 setRequestLocale 을 부른다", ([, rel]) => {
    const code = stripComments(read(rel));
    expect(code).toMatch(/export\s+(async\s+)?function\s+generateMetadata/);
    expect(code).toMatch(/setRequestLocale\(/);
    expect(code).toMatch(/COMPANY\.brandName/);
  });

  test("상세 페이지 — 동적 세그먼트 + ISR: dynamicParams = true · generateStaticParams 없음 · notFound() · getNotice(", () => {
    const code = stripComments(read(PAGE_FILES.noticeDetail));
    expect(code).toMatch(/export\s+const\s+dynamicParams\s*=\s*true/);
    expect(/generateStaticParams/.test(code)).toBe(false);
    expect(code).toMatch(/import\s*\{[^}]*\bnotFound\b[^}]*\}\s*from\s*["']next\/navigation["']/);
    expect(code).toMatch(/notFound\(\)/);
    expect(code).toMatch(/getNotice\(/);
    expect(code).toMatch(/splitParagraphs\(/);
  });

  test("목록은 getNotices(50) · 갤러리는 getGallery(60) · 차량은 getVehicles() · 운임료는 getShowcaseRoutes()", () => {
    expect(stripComments(read(PAGE_FILES.notices))).toMatch(/getNotices\(\s*50\s*\)/);
    expect(stripComments(read(PAGE_FILES.gallery))).toMatch(/getGallery\(\s*60\s*\)/);
    expect(stripComments(read(PAGE_FILES.fleet))).toMatch(/getVehicles\(\s*\)/);
    expect(stripComments(read(PAGE_FILES.fares))).toMatch(/getShowcaseRoutes\(\s*\)/);
  });

  test("페이지·components/pages 에 한글 리터럴 0건 (주석 제외) — 문구는 ko.json pages.* · home.* · 원장에서만", () => {
    for (const { rel, text } of allNewSources) {
      if (rel.endsWith(".css")) continue;
      const hits = stripComments(text)
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => HANGUL.test(l));
      expect(hits, `${rel} 에 한글 리터럴`).toEqual([]);
    }
  });

  test("새 CSS Module 은 components/pages 에 정확히 1개 (페이지마다 새 디자인을 발명하지 않는다)", () => {
    const modules = pagesDirFiles.filter((f) => f.endsWith(".module.css"));
    expect(modules).toEqual([`${PAGES_DIR}/pages.module.css`]);
    // 페이지가 import 하는 CSS Module 은 홈·법정·pages 의 기존 4개뿐
    const allowed = new Set([
      "@/components/home/home.module.css",
      "@/components/home/Sections.module.css",
      "@/components/legal/legal.module.css",
      "@/components/pages/pages.module.css",
    ]);
    for (const { rel, text } of allNewSources) {
      for (const m of text.matchAll(/from\s+["']([^"']+\.module\.css)["']/g)) {
        const spec = m[1].startsWith(".") ? `@/${toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])))}` : m[1];
        expect(allowed.has(spec), `${rel} 가 허용되지 않은 CSS Module 을 import: ${m[1]}`).toBe(true);
      }
    }
  });

  test("페이지 상단 브레드크럼 — 모든 페이지가 PageHeader(홈 → 현재) 를 렌더하고 i18n Link 를 쓴다", () => {
    for (const { rel, text } of pageSources) {
      expect(text, rel).toMatch(/from\s+["']@\/components\/pages\/PageHeader["']/);
      expect(text, rel).toMatch(/<PageHeader\b/);
    }
    const header = read(`${PAGES_DIR}/PageHeader.tsx`);
    expect(header).toMatch(/from\s+["']@\/i18n\/navigation["']/);
    expect(header).toMatch(/href="\/"/);
    expect(header).toMatch(/aria-current="page"/);
    expect(header).toMatch(/<h1\b/);
  });
});

// =============================================================================
// 2. LEGACY_MENU — 6개 ready:true, blog 는 그대로(env 의존), reservationCheck 는 P6-3a 의 값 그대로
// =============================================================================
describe("2. lib/legacy-menu-map.ts — ready 플래그", () => {
  const byKey = new Map(LEGACY_MENU.map((m) => [m.key, m]));

  test.for([["about"], ["location"], ["fleet"], ["fares"], ["notices"], ["gallery"]] as const)(
    "%s → ready:true",
    ([key]) => {
      expect(byKey.get(key)?.ready, key).toBe(true);
    },
  );

  test("blog 는 여전히 ready:false + external + env 의존 (URL 미수령 — 지어내지 않는다)", () => {
    const blog = byKey.get("blog");
    expect(blog?.ready).toBe(false);
    expect(blog?.external).toBe(true);
    const src = read(MENU_MAP);
    expect(src).toContain("NEXT_PUBLIC_NAVER_BLOG_URL");
    expect(src.match(/https?:\/\/[^"'\s)]+/g) ?? []).toEqual([]);
    expect(src).toContain(`${TEMP_MARKER} LEGACY_MENU.blog.href`);
  });

  test("이제 ready:false 인 내부 항목은 없다 — 네이버 블로그(외부) 하나만 남는다", () => {
    const notReady = LEGACY_MENU.filter((m) => !m.ready).map((m) => m.key);
    expect(notReady).toEqual(["blog"]);
  });

  test("ready:true 인 내부 항목 9개의 라우트 파일이 전부 있다", () => {
    for (const m of LEGACY_MENU) {
      if (!m.ready || m.external) continue;
      const clean = m.href.split("#")[0].replace(/^\//, "");
      const candidates = readdirSync(path.join(ROOT, "app", "[locale]"))
        .filter((e) => e.startsWith("(") && e.endsWith(")"))
        .map((g) => path.join(ROOT, "app", "[locale]", g, clean, "page.tsx"));
      expect(candidates.some((p) => existsSync(p)), `${m.key} → ${m.href}`).toBe(true);
    }
  });

  test("location 은 /about#location — about 페이지에 id=\"location\" 앵커가 있다", () => {
    expect(byKey.get("location")?.href).toBe("/about#location");
    expect(read(PAGE_FILES.about)).toMatch(/id="location"/);
  });
});

// =============================================================================
// 3. 카피 규칙 — 전 페이지 + ko.json pages.* : 금지어 · 실증 불가 수치 · 원장 문구 복제 0
// =============================================================================
describe("3. 카피 규칙 (pages.* + 페이지 소스)", () => {
  test("ko.json 에 pages 네임스페이스가 있고 5개 페이지 키 + common 이 있다", () => {
    for (const k of ["common", "about", "fleet", "fares", "notices", "gallery"]) {
      expect(pagesKo, `pages.${k} 없음`).toHaveProperty(k);
    }
    expect(pagesLeaves.length).toBeGreaterThan(10);
  });

  test("게이트 금지어 0건 — ko.json pages.* + 새 소스 전부", () => {
    for (const w of FORBIDDEN) expect(pagesKoText.includes(w), `pages.* 에 금지어`).toBe(false);
    for (const { rel, text } of allNewSources) {
      const code = stripComments(text);
      for (const w of FORBIDDEN) expect(code.includes(w), `${rel} 에 금지어`).toBe(false);
    }
  });

  test.for(UNPROVEN.map(([label, re]) => [label, re] as const))("실증 불가 수치·주장 0건 — %s", ([, re]) => {
    expect(re.test(pagesKoText)).toBe(false);
    for (const { rel, text } of allNewSources) expect(re.test(stripComments(text)), rel).toBe(false);
  });

  test("원장 문구·값의 문자열 리터럴 0건 — 소스와 ko.json pages.* 양쪽 (원장 import 로만)", () => {
    const fragments = [
      VERBATIM.bookingNotice,
      VERBATIM.showcaseNotice,
      QUOTE_BASIS.line,
      PAYMENT.line,
      INSURANCE.body,
      COMPANY.legalName,
      COMPANY.bizRegNo,
      COMPANY.mailOrderNo,
      COMPANY.tel,
      COMPANY.address,
      COMPANY.representative,
      "45인승 당일왕복",
      "상담 후 확정",
      "결제 진행됩니다",
      "10만원",
    ];
    for (const { rel, text } of allNewSources) {
      const code = stripComments(text);
      for (const frag of fragments) expect(code.includes(frag), `${rel} 에 원장 문구 리터럴: ${frag}`).toBe(false);
    }
    for (const frag of fragments) expect(pagesKoText.includes(frag), `ko.json pages 에 원장 문구 복제: ${frag}`).toBe(false);
  });

  test("home.* 문장을 pages.* 에 복제하지 않았다 (같은 문장은 재사용한다)", () => {
    const home = new Set(homeLeaves.map((s) => s.trim()).filter((s) => s.length >= 4));
    const dup = pagesLeaves.filter((s) => home.has(s.trim()));
    expect(dup, "pages.* 가 home.* 의 문장을 그대로 복제했다 — getTranslations(\"home.…\") 로 재사용하세요").toEqual([]);
  });

  test("확정 표기 — '송영' 은 '(송영 전문)' 안에서만 (soul §10.2)", () => {
    const alone = pagesKoText.replace(/\(송영 전문\)/g, "");
    expect(alone.includes("송영")).toBe(false);
  });

  test("메타 title·description 에 숫자 0 (실증 불가 수치가 들어올 자리를 없앤다)", () => {
    for (const [key, ns] of Object.entries(pagesKo)) {
      const metas: unknown[] = [];
      const collect = (v: unknown) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
            if (k === "meta") metas.push(x);
            else collect(x);
          }
        }
      };
      collect(ns);
      if (key !== "common") expect(metas.length, `pages.${key}.meta 없음`).toBeGreaterThan(0);
      for (const m of metas) for (const s of leaves(m)) expect(/\d/.test(s), `pages.${key} meta 에 숫자: ${s}`).toBe(false);
    }
  });
});

// =============================================================================
// 4. /about — 인사말은 home.company 재사용 + 안전한 2문장만 · 회사 정보는 원장 · 지도 임베드 0
// =============================================================================
describe("4. /about", () => {
  const src = read(PAGE_FILES.about);
  const code = stripComments(src);
  const inventory = read(INVENTORY);
  const about = (pagesKo.about ?? {}) as Record<string, unknown>;

  test("인사말 lead·body 는 CompanyIntro(home.company) 재사용 — 같은 문장이 ko.json 에 두 번 없다", () => {
    expect(src).toMatch(/from\s+["']@\/components\/home\/CompanyIntro["']/);
    expect(code).toMatch(/<CompanyIntro\b/);
    const company = (homeKo.company ?? {}) as { lead?: string; body?: string[] };
    const sentences = [company.lead, ...(company.body ?? [])].filter((s): s is string => Boolean(s));
    expect(sentences.length).toBeGreaterThanOrEqual(3);
    for (const s of sentences) {
      const count = koText.split(JSON.stringify(s).slice(1, -1)).length - 1;
      expect(count, `ko.json 에 "${s.slice(0, 20)}…" 가 ${count}번`).toBe(1);
    }
  });

  test("덧붙인 문장은 정확히 2개이고, 인벤토리 §2 H2 원문에 그대로 있다 (윤문 0)", () => {
    const more = about.more as string[] | undefined;
    expect(Array.isArray(more)).toBe(true);
    expect(more).toHaveLength(2);
    for (const s of more ?? []) expect(inventory.includes(s), `인벤토리에 없는 문장: ${s}`).toBe(true);
    expect(more?.[0]).toMatch(/^가족 같은 직원의 안전을 기반으로/);
    expect(more?.[1]).toMatch(/^저희는 "고객이 행복한 미소를 지으며 버스에서 내릴 때/);
    expect(code).toMatch(/t\.raw\(\s*["']more["']\s*\)|["']more["']/);
  });

  test("제외 3문장(70만 명·큰 사고·외국인 관광객 국토여행) 0 · 서명은 COMPANY.representative", () => {
    for (const w of ["70만", "큰 사고", "외국인 관광객", "국토여행", "불철주야"]) {
      expect(JSON.stringify(about).includes(w), w).toBe(false);
    }
    // 서명은 CompanyIntro 가 COMPANY.representative 로 렌더한다(tests/home.test.ts 가 잠금) — 페이지가 이름을 다시 쓰지 않는다
    expect(code.includes(COMPANY.representative)).toBe(false);
  });

  test("회사 정보 표는 원장 COMPANY 필드 + 라벨(LEGAL_LABELS) 로만 — 리터럴 0", () => {
    const imported = ledgerImports(src);
    expect(imported).toEqual(expect.arrayContaining(["COMPANY", "LEGAL_LABELS"]));
    for (const f of ["legalName", "representative", "bizRegNo", "mailOrderNo", "address", "tel", "email", "establishedYear"]) {
      expect(code, `COMPANY.${f}`).toMatch(new RegExp(`COMPANY\\.${f}\\b`));
    }
    expect(code).toMatch(/LegalRecordList/);
  });

  test("#location — 주소는 원장, 지도 임베드 0(iframe·script 0), 외부 링크 2개(카카오·네이버 검색 URL 에 주소 인코딩), 대중교통 안내 0", () => {
    expect(code).toMatch(/id="location"/);
    expect(/<iframe/i.test(code)).toBe(false);
    expect(/<script/i.test(code)).toBe(false);
    expect(/dapi\.kakao|apis\.map\.kakao|openapi\.map\.naver|oapi\.map\.naver/.test(code)).toBe(false);
    expect(code).toMatch(/map\.kakao\.com/);
    expect(code).toMatch(/map\.naver\.com/);
    expect(code).toMatch(/encodeURIComponent\(\s*COMPANY\.address\s*\)/);
    expect(code).toMatch(/rel="noreferrer noopener"/);
    for (const w of ["지하철", "역에서", "정류장", "버스를 타고", "도보", "대중교통", "출구"]) {
      expect(JSON.stringify(about).includes(w), `대중교통 안내 창작: ${w}`).toBe(false);
    }
  });

  test("지도 임베드 보류는 임시값 마커(주석)로 남기고 허용 목록에 사유와 함께 등록했다", () => {
    const markerLine = src.split("\n").find((l) => l.includes(TEMP_MARKER));
    expect(markerLine, "about 페이지에 지도 임베드 보류 마커 없음").toBeDefined();
    expect(markerLine).toMatch(/^\s*(\/\/|\*|\/\*)/);
    const allow = read(ALLOWLIST)
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("#"))
      .filter((l) => l.startsWith(`${PAGE_FILES.about}:`));
    expect(allow).toHaveLength(1);
    const pattern = new RegExp(allow[0].slice(allow[0].indexOf(":") + 1));
    expect(pattern.test(markerLine ?? "")).toBe(true);
  });
});

// =============================================================================
// 5. /fleet — 차량 카드는 FleetSection 재사용 · 보험 문구는 인벤토리 ★2 그대로(원장 INSURANCE) · 대수·연식 0
// =============================================================================
describe("5. /fleet", () => {
  const src = read(PAGE_FILES.fleet);
  const code = stripComments(src);
  const inventory = read(INVENTORY);

  /** 인벤토리 §2 "### ★2" 블록 — 제목 줄 + 두 문장(인용 `> `) */
  function inventoryInsurance(): { title: string; sentences: string[] } {
    const lines = inventory.split("\n");
    const start = lines.findIndex((l) => l.startsWith("### ★2"));
    expect(start, "인벤토리에 ★2 절이 없다").toBeGreaterThan(-1);
    const quoted: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("### ")) break;
      if (l.startsWith("> ")) quoted.push(l.slice(2).trim());
    }
    const title = quoted[0].replace(/^\*\*|\*\*$/g, "");
    return { title, sentences: quoted.slice(1, 3) };
  }

  test("원장 INSURANCE.title·body == 인벤토리 ★2 블록(파일을 읽어 대조) — 옮기다 바뀌면 여기서 빨강", () => {
    const { title, sentences } = inventoryInsurance();
    expect(sentences).toHaveLength(2);
    expect(INSURANCE.title).toBe(title);
    expect(INSURANCE.body).toBe(sentences.join(" "));
  });

  test("페이지는 INSURANCE 를 원장에서 import 해 title·body 를 렌더한다 (ko.json 에 복제 0)", () => {
    expect(ledgerImports(src)).toContain("INSURANCE");
    expect(code).toMatch(/INSURANCE\.title/);
    expect(code).toMatch(/INSURANCE\.body/);
    expect(koText.includes(INSURANCE.body)).toBe(false);
    expect(koText.includes("손해보험회사")).toBe(false);
  });

  test("차량 카드는 홈 FleetSection 재사용 — CTA 는 /quote?vehicle=<slug> 프리필(위저드가 vehicle 을 받는다)", () => {
    expect(src).toMatch(/from\s+["']@\/components\/home\/FleetSection["']/);
    expect(code).toMatch(/<FleetSection\s+vehicles=/);
    expect(PREFILL_PARAMS).toContain("vehicle");
    expect(read("components/home/FleetSection.tsx")).toMatch(/quoteHref\(\{\s*vehicle:/);
  });

  test("차량이 0대여도 페이지가 비지 않는다 (FleetSection 은 null 을 돌려주므로 빈 상태 문구가 따로 있다)", () => {
    expect(code).toMatch(/vehicles\.length\s*===\s*0/);
  });

  test("옛 사이트 차종 원문(intro3~9) 문장 0 — 25인승 복붙 오류 문장 포함", () => {
    const fleetKo = JSON.stringify(pagesKo.fleet ?? {});
    for (const w of ["25인승 관광버스의 이용관련 안내", "미니25인승", "직영차량", "제공해 드리는 최고의 버스", "운송사업자는 여객자동차운수사업법"]) {
      expect(fleetKo.includes(w), w).toBe(false);
      expect(code.includes(w), w).toBe(false);
    }
  });
});

// =============================================================================
// 6. /fares — 무가격: 산정 기준·대금은 원장, 예시는 KrMap(verbatim 고지 포함), 금액·요금표·비교 광고 0
// =============================================================================
describe("6. /fares (P6-3b)", () => {
  const src = read(PAGE_FILES.fares);
  const code = stripComments(src);
  const faresKo = JSON.stringify(pagesKo.fares ?? {});

  test("원장 import — QUOTE_BASIS · PAYMENT · VERBATIM · COMPANY 를 가져와 그대로 렌더한다", () => {
    expect(ledgerImports(src)).toEqual(expect.arrayContaining(["QUOTE_BASIS", "PAYMENT", "VERBATIM", "COMPANY"]));
    expect(code).toMatch(/QUOTE_BASIS\.(factors|line)/);
    expect(code).toMatch(/PAYMENT\.line/);
    expect(code).toMatch(/VERBATIM\.bookingNotice/);
  });

  test("Top-5 고지는 KrMap 이 VERBATIM.showcaseNotice 로 렌더한다 (바이트 동일 — 원장 참조) · 페이지가 다시 렌더하지 않는다", () => {
    expect(src).toMatch(/from\s+["']@\/components\/KrMap\/KrMap["']/);
    expect(code).toMatch(/<KrMap\s+routes=/);
    expect(read("components/KrMap/KrMap.tsx")).toMatch(/VERBATIM\.showcaseNotice/);
    expect(code.includes("showcaseNotice")).toBe(false);
    // 원장 값 자체가 CLAUDE.md §3 의 문구와 바이트 동일한지 (게이트도 보지만 여기서 한 번 더)
    const expected = Buffer.from(
      "대표 노선 예시 견적 · 45인승 당일왕복 기준 · 실제 견적은 상담 후 확정",
      "utf8",
    );
    expect(Buffer.compare(Buffer.from(VERBATIM.showcaseNotice, "utf8"), expected)).toBe(0);
  });

  test("홈 RoutesSection 의 설명문('저렴')은 가져오지 않는다 — SectionHead + KrMap 조립", () => {
    expect(/from\s+["']@\/components\/home\/RoutesSection["']/.test(src)).toBe(false);
    expect(src).toMatch(/from\s+["']@\/components\/home\/SectionHead["']/);
  });

  test.for(PRICE_TABLE.map(([label, re]) => [label, re] as const))("금액·요금표·비교 광고 표현 0 — %s", ([, re]) => {
    expect(re.test(faresKo), "ko.json pages.fares").toBe(false);
    expect(re.test(code), "fares/page.tsx").toBe(false);
  });

  test("가격 심볼 0 (check-no-pricing 패턴) · price_from/priceFrom 연산 0 — 새 소스 전부", () => {
    for (const { rel, text } of allNewSources) {
      expect(PRICING_SYMBOLS.test(text), rel).toBe(false);
      expect(/priceFrom\s*[*/+%-]|price_from/.test(text), rel).toBe(false);
      expect(/toLocaleString|Intl\.NumberFormat/.test(text), rel).toBe(false);
    }
  });

  test("CTA — /quote 링크 + 원장 COMPANY.tel 전화 링크", () => {
    expect(code).toMatch(/href="\/quote"/);
    expect(code).toMatch(/tel:\$\{COMPANY\.tel\}/);
  });

  test("인벤토리 §4 요금 매트릭스의 숫자(300,000 · 350,000 · 400,000 · 180,000 · 5,500 · 40km)가 어디에도 없다", () => {
    for (const n of ["300,000", "350,000", "400,000", "250,000", "180,000", "5,500", "40km", "300km"]) {
      expect(faresKo.includes(n), n).toBe(false);
      expect(code.includes(n), n).toBe(false);
    }
  });
});

// =============================================================================
// 7. getNotice — 순수 검증 + mock 클라이언트 (DB 없이) · 목록 limit 50
// =============================================================================
type Call = { method: string; args: unknown[] };

/** 모든 메서드가 자기 자신을 돌려주는 체인 + thenable. from/select/eq/… 호출을 기록한다. */
function fakeClient(result: { data: unknown; error: { message: string } | null }): { client: AnonClient; calls: Call[] } {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "select", "eq", "order", "limit", "maybeSingle", "single", "overrideTypes"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return { client: chain as unknown as AnonClient, calls };
}

const ROW = { id: 12, title: "T", body: "B1\n\nB2", category: "notice", published_at: "2026-09-01", active: true };

describe("7. lib/queries/notices.ts — parseNoticeId · getNotice", () => {
  test("parseNoticeId — serial(int4) 양의 정수만: 선행 0·부호·소수·지수·공백·범위 밖은 null", () => {
    expect(parseNoticeId("12")).toBe(12);
    expect(parseNoticeId("1")).toBe(1);
    expect(parseNoticeId("2147483647")).toBe(2147483647);
    for (const bad of ["0", "-1", "1.5", "abc", "1e3", "", "007", " 12", "12 ", "2147483648", "12abc", "0x1f", "null", "undefined"]) {
      expect(parseNoticeId(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  test("잘못된 id 형식 → null, DB 호출 0 (from 조차 부르지 않는다)", async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null });
    for (const bad of ["abc", "0", "-1", "1.5", "does-not-exist", "1; drop table notices"]) {
      expect(await getNotice(bad, client), bad).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  test("부재(미공개 포함) → null — notices 를 id + active 로 한 건만 조회한다", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    expect(await getNotice("12", client)).toBeNull();
    const from = calls.find((c) => c.method === "from");
    expect(from?.args).toEqual(["notices"]);
    const eqs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual(expect.arrayContaining([["id", 12], ["active", true]]));
    expect(calls.some((c) => c.method === "maybeSingle")).toBe(true);
    expect(calls.some((c) => c.method === "limit")).toBe(false);
  });

  test("select 컬럼 — 제목·본문·게시일(+id·category·active)만, `*` 없음", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await getNotice("12", client);
    const select = calls.find((c) => c.method === "select");
    const cols = String(select?.args[0]).split(",").map((s) => s.trim());
    expect(cols).toEqual(expect.arrayContaining(["title", "body", "published_at"]));
    expect(cols.includes("*")).toBe(false);
    expect(new Set(cols).size).toBe(cols.length);
    expect(cols.every((c) => /^[a-z_]+$/.test(c))).toBe(true);
  });

  test("존재 → Notice 뷰 (컬럼을 버리지 않고 camelCase)", async () => {
    const { client } = fakeClient({ data: ROW, error: null });
    expect(await getNotice("12", client)).toEqual({
      id: 12,
      title: "T",
      body: "B1\n\nB2",
      category: "notice",
      publishedAt: "2026-09-01",
      active: true,
    });
  });

  test("숫자 id 도 받는다 (페이지는 문자열, 내부 재사용은 숫자)", async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null });
    expect((await getNotice(12, client))?.id).toBe(12);
    expect(calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual(expect.arrayContaining([["id", 12]]));
    const { client: c2, calls: calls2 } = fakeClient({ data: ROW, error: null });
    expect(await getNotice(1.5, c2)).toBeNull();
    expect(calls2).toEqual([]);
  });

  test("DB 오류는 삼키지 않고 throw (404 로 위장하지 않는다)", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    await expect(getNotice("12", client)).rejects.toThrow(/getNotice: boom/);
  });

  test("getNotices(50) — 목록 페이지 상한이 limit 검증을 통과하고 그대로 전달된다", async () => {
    const { client, calls } = fakeClient({ data: [ROW], error: null });
    const list = await getNotices(50, client);
    expect(list.map((n) => n.id)).toEqual([12]);
    expect(calls.find((c) => c.method === "limit")?.args).toEqual([50]);
  });

  test("index.ts 가 getNotice · parseNoticeId 를 export 하고, notices.ts 는 여전히 anon + Next 무의존", () => {
    const index = read("lib/queries/index.ts");
    expect(index).toMatch(/getNotice\b/);
    expect(index).toMatch(/parseNoticeId\b/);
    const src = read(NOTICES_QUERY);
    expect(src).toMatch(/createAnonClient/);
    expect(/from\s+['"]next(\/|['"])/.test(src)).toBe(false);
    expect(/createServiceClient|service_role|supabase\/server['"]/.test(src)).toBe(false);
  });
});

// =============================================================================
// 8. 본문 렌더 — plain text 문단 (HTML 렌더 금지)
// =============================================================================
describe("8. splitParagraphs — 본문은 \\n\\n 으로만 문단을 나눈다 (HTML 해석 0)", () => {
  test("빈 줄로 문단을 나누고 앞뒤 공백·빈 문단을 버린다", () => {
    expect(splitParagraphs("a\n\nb")).toEqual(["a", "b"]);
    expect(splitParagraphs("  a  \n\n\n\n  b  \n\n")).toEqual(["a", "b"]);
    expect(splitParagraphs("\r\n\r\na\r\n\r\nb\r\n")).toEqual(["a", "b"]);
  });

  test("한 줄 바꿈은 같은 문단 안에 남는다 (표시 계층이 pre-line 으로 줄을 바꾼다)", () => {
    expect(splitParagraphs("a\nb\n\nc")).toEqual(["a\nb", "c"]);
  });

  test("빈 본문 → []", () => {
    expect(splitParagraphs("")).toEqual([]);
    expect(splitParagraphs("   \n\n  ")).toEqual([]);
  });

  test("HTML 은 문자열 그대로 — 태그를 해석하거나 벗기지 않는다 (React 가 이스케이프해 렌더한다)", () => {
    expect(splitParagraphs("<b>x</b>\n\n<script>alert(1)</script>")).toEqual(["<b>x</b>", "<script>alert(1)</script>"]);
  });

  test("상세 페이지·components/pages 어디에도 dangerouslySetInnerHTML · innerHTML · html-react-parser 0", () => {
    for (const { rel, text } of allNewSources) {
      expect(/dangerouslySetInnerHTML|innerHTML|html-react-parser|sanitize-html|DOMPurify/.test(text), rel).toBe(false);
    }
  });
});

// =============================================================================
// 9. /notices · /gallery — 빈 상태 · 재사용
// =============================================================================
describe("9. /notices · /gallery", () => {
  test("/notices — 0건이면 빈 상태 문구(pages.notices.empty), 있으면 NoticeList(카테고리 배지는 home.notice.category 재사용)", () => {
    const code = stripComments(read(PAGE_FILES.notices));
    expect(code).toMatch(/notices\.length\s*===\s*0/);
    expect(code).toMatch(/<NoticeList\b/);
    const notices = pagesKo.notices as Record<string, unknown>;
    expect(typeof notices.empty).toBe("string");
    const list = read(`${PAGES_DIR}/NoticeList.tsx`);
    expect(list).toMatch(/href=\{`\/notices\/\$\{/);
    expect(list).toMatch(/from\s+["']@\/i18n\/navigation["']/);
    expect(code).toMatch(/getTranslations\(\s*["']home\.notice["']\s*\)|t\.raw\(\s*["']category["']\s*\)/);
    expect(JSON.stringify(notices).includes('"category"')).toBe(false);
  });

  test("/gallery — 0건이면 '준비 중' + 홈 링크, 있으면 GalleryGrid(홈 GallerySection 과 같은 카드) · alt 는 캡션(없으면 빈 alt)", () => {
    const code = stripComments(read(PAGE_FILES.gallery));
    expect(code).toMatch(/pictures\.length\s*===\s*0/);
    expect(code).toMatch(/href="\/"/);
    expect(code).toMatch(/<GalleryGrid\b/);
    const grid = read("components/home/GalleryGrid.tsx");
    expect(grid).toMatch(/alt=\{[^}]*caption\s*\?\?\s*""\s*\}/);
    expect(grid).toMatch(/from\s+["']next\/image["']/);
    expect(read("components/home/GallerySection.tsx")).toMatch(/<GalleryGrid\b/);
    const gallery = pagesKo.gallery as Record<string, unknown>;
    expect(typeof gallery.empty).toBe("string");
    expect(String(gallery.empty)).toContain("준비 중");
  });

  test("next.config — Supabase Storage 공개 객체 호스트가 remotePatterns 에 있다 (갤러리 next/image)", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toMatch(/\*\.supabase\.co/);
    expect(cfg).toMatch(/\/storage\/v1\/object\/public\/\*\*/);
  });

  test("공지 날짜 포맷은 홈 NoticeSection 과 같은 함수(notice-date.ts)를 쓴다", () => {
    expect(read("components/home/NoticeSection.tsx")).toMatch(/from\s+["']\.\/notice-date["']/);
    expect(read(`${PAGES_DIR}/NoticeList.tsx`)).toMatch(/from\s+["']@\/components\/home\/notice-date["']/);
    expect(read(PAGE_FILES.noticeDetail)).toMatch(/from\s+["']@\/components\/home\/notice-date["']/);
  });
});

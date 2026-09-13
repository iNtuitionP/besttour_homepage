/**
 * P2-3 — 공개 셸(헤더·푸터·플로팅 문의) + semantic 간격/라운드/고도 토큰 계약 테스트.
 *
 * vitest 는 node 환경이다 — DOM 렌더 테스트용 패키지를 설치하지 않는다(브리프 §검증).
 * 여기서는 (1) 순수 데이터(LEGACY_MENU), (2) 소스 정적 검사, (3) CSS 토큰 규약만 잠그고,
 * 실제 렌더(로고 로드·메뉴 수·햄버거 토글·가로 스크롤 0)는 browse 로 실측해 보고서에 남긴다.
 *
 * 주의: 이 파일은 tests/ 아래라 세 게이트(check-no-pricing · check-legal-disclosures ·
 * check-temp-values)의 검사 대상이다. 금지어·임시값 마커 리터럴은 이스케이프로 조립한다
 * (tests/legal.test.ts · tests/gates.test.ts 와 같은 규약).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { LEGACY_MENU, type MenuItem } from "@/lib/legacy-menu-map";
import { LEGAL_LINKS } from "@/lib/legal/disclosures";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const LAYOUT_DIR = "components/layout";
const SITE_LAYOUT = "app/[locale]/(site)/layout.tsx";
const ADMIN_LAYOUT = "app/admin/layout.tsx";
const MENU_MAP = "lib/legacy-menu-map.ts";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

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

/** components/layout/** 의 모든 파일 (상대경로, posix) */
const layoutFiles = walk(path.join(ROOT, LAYOUT_DIR)).map((p) => toPosix(path.relative(ROOT, p)));
const layoutTsx = layoutFiles.filter((f) => f.endsWith(".tsx"));
const layoutSources = layoutFiles.map((file) => ({ file, text: read(file) }));

/** components/** 의 모든 CSS Module (KrMap · legal · layout) */
const cssModules = walk(path.join(ROOT, "components"))
  .map((p) => toPosix(path.relative(ROOT, p)))
  .filter((f) => f.endsWith(".module.css"));

/** 주석(`//` 줄 끝, 블록)을 걷어낸 코드만 남긴다 — tests/legal-pages.test.ts 와 같은 구현 */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock
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

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

/** `import { A, B } from "@/lib/legal/disclosures"` 에서 가져온 식별자 */
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

// =============================================================================
// 1. LEGACY_MENU — "기존 메뉴 삭제 금지" 규칙의 실체
// =============================================================================
/**
 * 옛 사이트(bestour.co.kr) 좌측 메뉴 10개. 플랜 v4 §6 P6-3 매핑표 그대로 박아 둔다.
 * 이 배열이 줄면 사장님 요구(기존 메뉴·기능 삭제 금지, 재배치만)를 어긴 것이다.
 */
const LEGACY_LABELS = [
  "회사소개 · 인사말",
  "찾아오시는 길",
  "차량소개 · 보험내용",
  "차량운임료",
  "견적요청",
  "예약확인",
  "공지사항",
  "이용안내",
  "갤러리",
  "네이버 블로그",
] as const;

/** 플랜 P6-3 매핑표의 새 경로. 외부 링크(블로그)는 env 로 주입되므로 빈 문자열이 정상이다. */
const EXPECTED_HREF: Record<string, string> = {
  about: "/about",
  location: "/about#location",
  fleet: "/fleet",
  fares: "/fares",
  quote: "/quote",
  reservationCheck: "/reservation/check",
  notices: "/notices",
  guide: "/guide",
  gallery: "/gallery",
  blog: process.env.NEXT_PUBLIC_NAVER_BLOG_URL ?? "",
};

/**
 * 구현된 라우트: /guide(P1-6) · /quote(P3-4) · /reservation/check(P6-3a) · /about·/about#location·/fleet·/fares·/notices·/gallery(P6-3).
 * 남은 것은 네이버 블로그(외부, URL 미수령)뿐이다. 페이지가 생기는 태스크가 이 표와 플래그를 함께 올린다.
 */
const EXPECTED_READY = new Set([
  "guide",
  "quote",
  "reservationCheck",
  "about",
  "location",
  "fleet",
  "fares",
  "notices",
  "gallery",
]);

describe("1. LEGACY_MENU — 10개, 중복 없음, 옛 메뉴와 1:1", () => {
  test("정확히 10개다", () => {
    expect(LEGACY_MENU).toHaveLength(10);
  });

  test("key 중복 0", () => {
    const keys = LEGACY_MENU.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("라벨이 옛 사이트 메뉴 10개와 순서까지 1:1", () => {
    expect(LEGACY_MENU.map((m) => m.labelKo)).toEqual([...LEGACY_LABELS]);
  });

  test("새 경로가 플랜 P6-3 매핑표와 일치한다", () => {
    for (const m of LEGACY_MENU) {
      expect(EXPECTED_HREF, `${m.key} 가 매핑표에 없음`).toHaveProperty(m.key);
      expect(m.href, m.key).toBe(EXPECTED_HREF[m.key]);
    }
  });

  test("ready 플래그는 구현된 라우트에만 켜져 있다", () => {
    for (const m of LEGACY_MENU) {
      expect(m.ready, `${m.key} 의 ready 가 기대와 다름`).toBe(EXPECTED_READY.has(m.key));
    }
  });

  test("group 은 4종(company·fleet·quote·support)뿐이고 각 그룹이 비어 있지 않다", () => {
    const groups = new Set<MenuItem["group"]>(["company", "fleet", "quote", "support"]);
    for (const m of LEGACY_MENU) expect(groups, m.key).toContain(m.group);
    for (const g of groups) {
      expect(LEGACY_MENU.filter((m) => m.group === g).length, `${g} 그룹이 비었다`).toBeGreaterThan(0);
    }
  });

  test("외부 링크는 블로그 1건뿐이고, URL 은 env 에서 온다 (하드코딩 0)", () => {
    const ext = LEGACY_MENU.filter((m) => m.external);
    expect(ext.map((m) => m.key)).toEqual(["blog"]);
    const src = read(MENU_MAP);
    expect(src).toContain("NEXT_PUBLIC_NAVER_BLOG_URL");
    // 소스에 URL 리터럴을 박지 않는다 — 미회신 값을 지어내지 않았다는 증거
    expect(src.match(/https?:\/\/[^"'\s)]+/g) ?? []).toEqual([]);
  });

  test("labelKo 는 전부 비어 있지 않다", () => {
    for (const m of LEGACY_MENU) expect(m.labelKo.trim().length, m.key).toBeGreaterThan(0);
  });
});

// =============================================================================
// 2. 존재하지 않는 라우트로 링크하지 않는다
// =============================================================================
/** `/about#location` → app/[locale]/(그룹)/about/page.tsx 또는 app/[locale]/about/page.tsx 존재 여부 */
function routeExists(href: string): boolean {
  const clean = href.split("#")[0].replace(/^\//, "");
  if (clean === "") return existsSync(path.join(ROOT, "app/[locale]/(site)/page.tsx"));
  const localeDir = path.join(ROOT, "app", "[locale]");
  const candidates = [path.join(localeDir, clean, "page.tsx")];
  for (const entry of readdirSync(localeDir)) {
    if (entry.startsWith("(") && entry.endsWith(")")) {
      candidates.push(path.join(localeDir, entry, clean, "page.tsx"));
    }
  }
  return candidates.some((p) => existsSync(p.split("/").join(path.sep)));
}

describe("2. ready:false 는 링크를 만들지 않는다", () => {
  test("ready:true 인 내부 항목은 실제 라우트 파일이 있다 (404 링크 금지)", () => {
    for (const m of LEGACY_MENU) {
      if (!m.ready || m.external) continue;
      expect(routeExists(m.href), `${m.key} → ${m.href} 라우트 파일 없음`).toBe(true);
    }
  });

  test("ready:false 인 내부 항목의 라우트는 아직 없다 (플래그가 현실과 어긋나지 않는다)", () => {
    for (const m of LEGACY_MENU) {
      if (m.ready || m.external) continue;
      expect(routeExists(m.href), `${m.key} → ${m.href} 라우트가 생겼는데 ready 가 false 다`).toBe(false);
    }
  });

  test("Nav.tsx 에 aria-disabled 분기가 있고, ready 를 판정한다", () => {
    const src = read(`${LAYOUT_DIR}/Nav.tsx`);
    expect(src).toMatch(/aria-disabled=\{?["{]?true/);
    expect(src).toMatch(/\.ready/);
    // 외부 링크는 href(env) 유무로 숨긴다
    expect(src).toMatch(/\.external/);
  });

  test("components/layout/** 에 href=\"#\" 죽은 링크 0건", () => {
    // 주석에 목업 상태를 설명하는 것은 허용 — 검사 대상은 실제로 렌더되는 코드다
    for (const { file, text } of layoutSources) {
      expect(/href=\{?["']#["']\}?/.test(stripComments(text)), `${file} 에 href=\"#\"`).toBe(false);
    }
  });

  test("법정 링크는 원장 LEGAL_LINKS 를 쓰고, 그 내부 경로 3개는 실재한다", () => {
    const footer = read(`${LAYOUT_DIR}/Footer.tsx`);
    for (const k of ["privacy", "terms", "guide"] as const) {
      expect(footer, k).toMatch(new RegExp(`LEGAL_LINKS\\.${k}`));
      expect(routeExists(LEGAL_LINKS[k]), `${LEGAL_LINKS[k]} 라우트 없음`).toBe(true);
    }
    expect(footer).toMatch(/LEGAL_LINKS\.ftcBizInfo/);
  });
});

// =============================================================================
// 3. 문구는 전부 원장/i18n 에서 — components/layout 에 한글 리터럴 0건
// =============================================================================
describe("3. components/layout/** — 한글 리터럴 0건 + 원장 import", () => {
  test.for(layoutFiles.map((f) => [f] as const))("%s 에 한글 리터럴 없음 (주석 제외)", ([rel]) => {
    const code = stripComments(read(rel));
    const hits = code
      .split("\n")
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => HANGUL.test(l));
    expect(hits, "문구는 원장(lib/legal/disclosures.ts) 또는 messages/ 에서만 온다").toEqual([]);
  });

  test("원장 상수 5종을 import 한다 (VERBATIM·COMPANY·RELATED_COMPANY·LEGAL_LINKS·LEGAL_LABELS)", () => {
    const imported = new Set(layoutSources.flatMap(({ text }) => ledgerImports(text)));
    for (const name of ["VERBATIM", "COMPANY", "RELATED_COMPANY", "LEGAL_LINKS", "LEGAL_LABELS"]) {
      expect(imported, `${name} import 없음`).toContain(name);
    }
  });

  test("푸터는 사업자 정보 3종(사업자등록번호·통신판매업신고·보호책임자)을 원장 필드로 렌더한다", () => {
    const src = read(`${LAYOUT_DIR}/Footer.tsx`);
    for (const field of [
      "COMPANY.bizRegNo",
      "COMPANY.mailOrderNo",
      "COMPANY.privacyOfficer",
      "RELATED_COMPANY.bizRegNo",
      "RELATED_COMPANY.note",
      "VERBATIM.bookingNotice",
    ]) {
      expect(src, field).toContain(field);
    }
  });

  test("실증 불가 수치·문구를 옮기지 않았다 (목업 상단바의 상담 가능 시간·운행 연차 등)", () => {
    // 목업 문구를 그대로 적지 않도록 이스케이프로 조립한다
    const UNPROVEN = [
      "연중무휴", // 연중무휴
      "24시간", // 24시간
      "운행 13년", // 운행 13년
      "대 보유", // 대 보유
      "누적", // 누적
    ];
    for (const { file, text } of layoutSources) {
      const code = stripComments(text);
      for (const w of UNPROVEN) {
        expect(code.includes(w), `${file} 에 실증 불가 문구`).toBe(false);
      }
    }
    // i18n 카탈로그도 같은 규칙 — 셸 네임스페이스(common·layout·errors)에 슬쩍 들어오지 못하게 한다.
    // home.* 는 tests/home.test.ts 가 따로 잠근다(플랜 §7 C4 "24시간 접수" 폴백 표현은 홈 신뢰 지표에만 허용 — P2-4).
    const ko = JSON.parse(read("messages/ko.json")) as Record<string, unknown>;
    for (const ns of ["common", "layout", "errors"]) {
      const text = JSON.stringify(ko[ns] ?? {});
      for (const w of UNPROVEN) expect(text.includes(w), `messages/ko.json ${ns} 에 실증 불가 문구`).toBe(false);
    }
  });

  test("헤더에 관계사 로고(best mobility)를 넣지 않는다 (스펙 §13.1)", () => {
    expect(read(`${LAYOUT_DIR}/Header.tsx`)).not.toContain("bestmobility");
  });

  test("verbatim 문자열 리터럴 0건 — 문구는 원장 참조로만", () => {
    const fragments = ["45인승", "상담 후 확정", "결제 진행됩니다"];
    for (const { file, text } of layoutSources) {
      for (const f of fragments) expect(text.includes(f), `${file} 에 verbatim 조각`).toBe(false);
    }
  });
});

// =============================================================================
// 4. CSS Modules — px 리터럴·HEX·원시 토큰 직접 참조 금지
// =============================================================================
/**
 * 간격 역할을 가진 속성에는 px 리터럴을 쓰지 않는다(= semantic.css 의 역할 토큰을 쓴다).
 * 치수(width·height·min-width·max-width 등)·타이포(font-size)·선 두께(border-width·outline-offset·
 * stroke-width)는 토큰화 대상이 아니므로 px 를 허용한다 — 8px 그리드는 "간격"의 규칙이지 "크기"의 규칙이 아니다.
 */
const SPACING_PROP = /^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left|border-radius)(-[a-z]+)*$/;

/**
 * 허용 목록 — 원시 스케일(8px 배수)에 없는 목업 실측 수치.
 * 이 값들을 8px 로 반올림하면 KrMap·법정 페이지에 시각 회귀가 난다(브리프 §0: "시각적으로 변하지 않았음").
 * 새 파일(components/layout/**)에는 단 한 건도 없다 — 아래 테스트가 그것을 단언한다.
 */
const PX_ALLOW: ReadonlyArray<{ file: string; decl: string; why: string }> = [
  // ── KrMap (목업 variant-08 §대표 노선) ──
  { file: "components/KrMap/KrMap.module.css", decl: "margin-top: 10px", why: "범례 여백 — 목업 .krmap" },
  { file: "components/KrMap/KrMap.module.css", decl: "margin-right: 6px", why: "견본·불릿 간격 — 목업 .routes__disc" },
  { file: "components/KrMap/KrMap.module.css", decl: "border-radius: 2px", why: "10px 견본 사각형 — --r-xs(4px)면 원에 가까워진다" },
  { file: "components/KrMap/KrMap.module.css", decl: "gap: 10px", why: "카드 리스트 간격 — 목업 .rcard" },
  { file: "components/KrMap/KrMap.module.css", decl: "gap: 12px", why: "카드 내부 3열 간격 — 목업 .rcard" },
  { file: "components/KrMap/KrMap.module.css", decl: "padding: 12px 14px", why: "카드 패딩 — 목업 .rcard" },
  { file: "components/KrMap/KrMap.module.css", decl: "margin-top: 2px", why: "배지 한 줄 내림 — 목업 .rcard b" },
  { file: "components/KrMap/KrMap.module.css", decl: "margin-top: 14px", why: "CTA 여백 — 목업 .routes CTA" },
  { file: "components/KrMap/KrMap.module.css", decl: "padding: 12px 24px", why: "버튼 패딩 — 목업 .btn" },
  { file: "components/KrMap/KrMap.module.css", decl: "padding: 20px 16px", why: "빈 상태 패딩" },
  { file: "components/KrMap/KrMap.module.css", decl: "padding: 12px 16px", why: "고지 패딩 — 목업 .routes__disc" },
  // ── 법정 페이지 셸 (P1-6) ──
  { file: "components/legal/legal.module.css", decl: "padding: 40px 16px 56px", why: "본문 상·하 여백 56px — 하단 링크와의 거리" },
  { file: "components/legal/legal.module.css", decl: "margin-top: 4px", why: "연속 문단·목록 항목 간격" },
  { file: "components/legal/legal.module.css", decl: "padding: 12px 16px", why: "고지 박스 패딩" },
  { file: "components/legal/legal.module.css", decl: "padding: 8px 12px", why: "표 셀 패딩" },
  { file: "components/legal/legal.module.css", decl: "margin: 0 0 12px", why: "레코드 표 사이" },
  { file: "components/legal/legal.module.css", decl: "margin: 0 0 4px", why: "표 캡션 아래" },
  { file: "components/legal/legal.module.css", decl: "border-radius: 2px", why: "포커스 링 라운드" },
];

type Decl = { file: string; prop: string; value: string; decl: string };

/** 중괄호 블록 안쪽만 읽는다 — 선택자(.navLink:hover)나 at-rule prelude 를 선언으로 오인하지 않도록 */
function declarations(rel: string): Decl[] {
  const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Decl[] = [];
  for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
    for (const m of block[1].matchAll(/([-a-z]+)\s*:\s*([^;]+)/g)) {
      const prop = m[1].trim();
      const value = m[2].trim();
      out.push({ file: rel, prop, value, decl: `${prop}: ${value}` });
    }
  }
  return out;
}

const allDecls = cssModules.flatMap(declarations);

describe("4. components/**/*.module.css — 토큰 규약", () => {
  test("검사 대상 CSS Module 이 실제로 있다 (빈 배열 통과 방지)", () => {
    expect(cssModules.length).toBeGreaterThanOrEqual(3);
    expect(cssModules).toContain("components/layout/Header.module.css");
    expect(cssModules).toContain("components/layout/Footer.module.css");
    expect(cssModules).toContain("components/layout/FloatingContact.module.css");
  });

  test("간격 속성에 px 리터럴 0건 (허용 목록 제외)", () => {
    const allow = new Set(PX_ALLOW.map((a) => `${a.file}|${a.decl}`));
    const hits = allDecls
      .filter((d) => SPACING_PROP.test(d.prop) && /\d(\.\d+)?px/.test(d.value))
      .filter((d) => !allow.has(`${d.file}|${d.decl}`))
      .map((d) => `${d.file} — ${d.decl}`);
    expect(hits, `역할 토큰으로 바꾸거나 PX_ALLOW 에 사유와 함께 등록하세요:\n${hits.join("\n")}`).toEqual([]);
  });

  test("허용 목록에 죽은 항목이 없다 (지워진 규칙이 남아 있지 않다)", () => {
    for (const a of PX_ALLOW) {
      const found = allDecls.some((d) => d.file === a.file && d.decl === a.decl);
      expect(found, `${a.file} 에 더는 없는 항목: ${a.decl}`).toBe(true);
    }
  });

  test("새 셸(components/layout/**)은 허용 목록 0건 — 간격이 전부 역할 토큰이다", () => {
    expect(PX_ALLOW.filter((a) => a.file.startsWith(LAYOUT_DIR))).toEqual([]);
  });

  test("HEX 리터럴 0건", () => {
    for (const rel of cssModules) {
      const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], rel).toEqual([]);
    }
  });

  test("rgb()/rgba()/hsl() 0건 — 색은 역할 토큰만", () => {
    for (const rel of cssModules) {
      const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(/\b(rgba?|hsla?)\(/.test(css), rel).toBe(false);
    }
  });

  test("원시 토큰(--s\\d · --r · --r-s · --r-xs · --sh-\\d · --maxw · --ease · --t) 직접 참조 0건", () => {
    const PRIMITIVE = /var\(\s*--(s[1-9]|r|r-s|r-xs|sh-[12]|maxw|ease|t)\s*[,)]/;
    for (const rel of cssModules) {
      const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, "");
      const hits = css.split("\n").filter((l) => PRIMITIVE.test(l));
      expect(hits, `${rel} 가 원시 토큰을 직접 참조한다`).toEqual([]);
    }
  });

  test("box-shadow 는 고도 토큰이거나 inset 링뿐이다", () => {
    for (const d of allDecls) {
      if (d.prop !== "box-shadow") continue;
      const ok = /var\(--elevation-/.test(d.value) || d.value.startsWith("inset");
      expect(ok, `${d.file} — ${d.decl}`).toBe(true);
    }
  });

  test("모든 var(--x) 참조가 styles/semantic.css 에 정의돼 있다", () => {
    const semantic = read("styles/semantic.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const defined = new Set([...semantic.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]));
    for (const rel of cssModules) {
      const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, "");
      const refs = [...new Set([...css.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map((m) => m[1]))];
      const missing = refs.filter((r) => !defined.has(r));
      expect(missing, `${rel} — semantic.css 에 없는 참조: ${missing.join(", ")}`).toEqual([]);
    }
  });
});

// =============================================================================
// 5. semantic.css — 간격·라운드·고도 역할 토큰 (P0-3 테스트 확장)
// =============================================================================
const ROLE_TOKENS = [
  "--space-inline-xs",
  "--space-inline-sm",
  "--space-inline-md",
  "--space-inline-lg",
  "--space-stack-xs",
  "--space-stack-sm",
  "--space-stack-md",
  "--space-stack-lg",
  "--space-stack-xl",
  "--space-section",
  "--space-page-x",
  "--radius-chip",
  "--radius-control",
  "--radius-surface",
  "--elevation-raised",
  "--elevation-overlay",
  "--layout-maxw",
  "--motion-ease",
  "--motion-base",
] as const;

describe("5. semantic.css — 역할 토큰 계약", () => {
  const semanticCss = read("styles/semantic.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const tokensCss = read("styles/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const primitives = new Set([...tokensCss.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const semanticDecls = [...semanticCss.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;}]+)[;}]/g)].map((m) => ({
    name: m[1],
    value: m[2].trim(),
  }));

  test.for(ROLE_TOKENS.map((t) => [t] as const))("%s 가 정의돼 있다", ([name]) => {
    expect(semanticDecls.some((d) => d.name === name)).toBe(true);
  });

  test("모든 역할 토큰의 값이 원시 토큰 참조다 (리터럴 하드코딩 금지)", () => {
    for (const d of semanticDecls) {
      expect(/^var\(\s*--[A-Za-z0-9-]+\s*\)$/.test(d.value), `${d.name} = ${d.value}`).toBe(true);
    }
  });

  test("semantic.css 의 모든 var(--x) 참조가 tokens.css 에 있다", () => {
    const refs = [...new Set([...semanticCss.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map((m) => m[1]))];
    const missing = refs.filter((r) => !primitives.has(r));
    expect(missing, `tokens.css 에 없는 참조: ${missing.join(", ")}`).toEqual([]);
  });

  test("--space-page-x 는 데스크톱에서 넓어진다 (미디어쿼리 재정의)", () => {
    const occurrences = [...semanticCss.matchAll(/--space-page-x\s*:\s*var\(\s*(--[A-Za-z0-9-]+)\s*\)/g)].map(
      (m) => m[1],
    );
    expect(occurrences.length).toBe(2);
    expect(new Set(occurrences).size).toBe(2);
    expect(/@media[^{]*min-width[^{]*\{\s*:root\s*\{[^}]*--space-page-x/.test(semanticCss)).toBe(true);
  });

  test("번호 그림자 별칭(--shadow-N)은 남기지 않는다 — 역할 이름(--elevation-*)으로 통일", () => {
    expect(/--shadow-\d\s*:/.test(semanticCss)).toBe(false);
  });
});

// =============================================================================
// 6. 서버 컴포넌트 경계 — 'use client' 는 토글/경로 인지 컴포넌트만
// =============================================================================
const CLIENT_ALLOWED = ["components/layout/Nav.tsx", "components/layout/MobileMenu.tsx"];

describe("6. 'use client' 경계", () => {
  test("Header.tsx · Footer.tsx · FloatingContact.tsx 최상위에 'use client' 가 없다", () => {
    for (const f of ["Header.tsx", "Footer.tsx", "FloatingContact.tsx"]) {
      const src = read(`${LAYOUT_DIR}/${f}`);
      expect(/^\s*["']use client["']/m.test(src), `${f} 가 클라이언트 컴포넌트다`).toBe(false);
    }
  });

  test("'use client' 는 허용된 파일에만 있다 (파일명으로 단언)", () => {
    const clients = layoutTsx.filter((f) => /^\s*["']use client["']/m.test(read(f)));
    expect(clients.sort()).toEqual([...CLIENT_ALLOWED].sort());
  });

  test("클라이언트 컴포넌트는 원장을 import 하지 않는다 (법정 문구가 번들로 새지 않는다)", () => {
    for (const f of CLIENT_ALLOWED) {
      expect(ledgerImports(read(f)), f).toEqual([]);
    }
  });

  test("next/link 직접 import 0건 — 로케일 프리픽스가 빠진다", () => {
    for (const { file, text } of layoutSources) {
      expect(/from\s+["']next\/link["']/.test(text), file).toBe(false);
    }
  });
});

// =============================================================================
// 7. 셸 배선 — (site) 만 헤더·푸터를 갖는다 (ADR-1)
// =============================================================================
describe("7. 셸 배선", () => {
  test("(site)/layout.tsx 가 Header·Footer·FloatingContact 를 렌더한다", () => {
    const src = read(SITE_LAYOUT);
    for (const c of ["Header", "Footer", "FloatingContact"]) {
      expect(src, c).toMatch(new RegExp(`<${c}\\s*/>`));
      expect(src, `${c} import`).toMatch(new RegExp(`from ["']@/components/layout/${c}["']`));
    }
  });

  test("/admin 은 공개 셸을 상속하지 않는다 (ADR-1 회귀 방지)", () => {
    const src = read(ADMIN_LAYOUT);
    expect(/components\/layout/.test(src), "admin 이 공개 셸을 import 한다").toBe(false);
    for (const c of ["Header", "Footer", "FloatingContact"]) {
      expect(src.includes(`<${c}`), `admin 에 ${c}`).toBe(false);
    }
  });

  test("(legal) 레이아웃도 공개 셸을 상속하지 않는다 (P1-6 유지)", () => {
    const src = read("app/[locale]/(legal)/layout.tsx");
    expect(/components\/layout\/(Header|Footer|FloatingContact)/.test(src)).toBe(false);
  });

  test("루트 레이아웃은 여전히 셸을 갖지 않는다", () => {
    expect(/components\/layout/.test(read("app/layout.tsx"))).toBe(false);
  });
});

// =============================================================================
// 8. FloatingContact — env 가 없으면 버튼을 만들지 않는다
// =============================================================================
describe("8. FloatingContact — 죽은 버튼 금지 · 네이버 라벨 금지", () => {
  const src = read(`${LAYOUT_DIR}/FloatingContact.tsx`);

  test("카카오·네이버 URL 을 env 에서 읽는다", () => {
    expect(src).toContain("NEXT_PUBLIC_KAKAO_CHANNEL_URL");
    expect(src).toContain("NEXT_PUBLIC_NAVER_TALK_URL");
  });

  test("env 가 비면 그 버튼을 렌더하지 않는다 (조건부 렌더가 소스에 있다)", () => {
    // 채널 배열을 만들고 href 가 있는 것만 남긴다
    expect(src).toMatch(/\.filter\(/);
    expect(src).toMatch(/href/);
  });

  test("버튼 위에 읽어야 하는 텍스트 라벨이 없다 — 아이콘 + aria-label 만 (네이버 2.25:1)", () => {
    // 버튼 내부에 텍스트 컨테이너(<span>·<b>·<small>)를 두지 않는다
    expect(/<(span|b|small|p)[\s>]/.test(src), "버튼 안에 텍스트 요소가 있다").toBe(false);
    expect((src.match(/aria-label=/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("position: fixed + safe-area 하단 여백", () => {
    const css = read(`${LAYOUT_DIR}/FloatingContact.module.css`);
    expect(css).toMatch(/position:\s*fixed/);
    expect(css).toContain("env(safe-area-inset-bottom)");
  });

  test("전화 버튼은 원장 COMPANY.tel 을 tel: 로 건다", () => {
    expect(src).toMatch(/tel:\$\{COMPANY\.tel\}|`tel:\$\{COMPANY\.tel\}`/);
  });
});

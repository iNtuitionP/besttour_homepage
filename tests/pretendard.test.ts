/**
 * P7-3 ① — 한국어 전부 Pretendard (사용자 지시 2026-09-27 "한국어 전부 pretendard 로 통일해").
 *
 * 무엇을 잠그는가
 *   1. body 스택의 첫 항목이 "Pretendard Variable" 이고, 폼 컨트롤(button·input·select·textarea)이 그것을 상속한다.
 *      브라우저 기본값은 폼 컨트롤에 글꼴을 물려주지 않는다 — 관리자 화면에서 "아닌 게 조금 있는" 원인이 그것이었다.
 *   2. 글꼴은 **자체 호스팅**이다 — `@font-face` 의 src 는 전부 `/fonts/pretendard/` 이고, 가리키는 파일이 실제로 있다(woff2 서명까지).
 *      런타임에 제3자(jsDelivr·Google Fonts 등)로 요청이 나가면 방문자 IP 가 넘어가 처리방침 국외이전·위탁 고지가 필요해진다.
 *   3. SIL OFL 1.1 원문(LICENSE.txt)이 글꼴 파일 옆에 있다.
 *   4. 글꼴을 정하는 곳은 전역 body 하나다 — 모듈 CSS·다른 전역 CSS·인라인 style 에 font-family 0 (허용 목록 없음).
 *      `font:` 단축 속성은 글꼴 이름을 초기화하므로 `inherit` 만 허용한다.
 *
 * 루트 레이아웃(app/layout.tsx)이 글꼴 CSS 를 import 한다 — 공개 셸(app/[locale]/layout.tsx)·관리자(app/admin/layout.tsx)·
 * 전역 404(app/not-found.tsx)가 전부 그 아래라 한 번으로 모든 화면에 실린다. 실제 렌더 글꼴은 보고서 ③의 브라우저 실측이 본다.
 * 메일 HTML 템플릿(lib/notify/*)은 웹폰트를 못 쓰므로 대상이 아니다.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const toPosix = (p: string) => p.split(path.sep).join("/");

const GLOBALS = "app/globals.css";
const ROOT_LAYOUT = "app/layout.tsx";
const FONT_CSS = "styles/pretendard.css";
const FONT_DIR = "public/fonts/pretendard";
const FONT_URL_PREFIX = "/fonts/pretendard/";

/** 브리프 §① 의 스택 — 글자 그대로. */
const STACK = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

function walk(absDir: string): string[] {
  if (!existsSync(absDir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(absDir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = path.join(absDir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const filesUnder = (dir: string) => walk(path.join(ROOT, dir)).map((p) => toPosix(path.relative(ROOT, p)));

/** 중괄호 블록을 선택자·본문으로 — @font-face 처럼 한 단계짜리 규칙만 읽는다(@media 안쪽도 본문으로 잡힌다). */
function rules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  for (const m of stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}
const declValue = (body: string, prop: string): string | undefined =>
  new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim();
const normSpace = (s: string) => s.replace(/\s+/g, " ").trim();

// =============================================================================
// 1. 전역 — body 스택 · 폼 컨트롤 상속 · 루트 레이아웃 import
// =============================================================================
describe("1. 전역 CSS — body 는 Pretendard Variable 부터, 폼 컨트롤은 상속", () => {
  const globals = rules(read(GLOBALS));

  test("body 의 font-family 가 브리프 스택 그대로다 — 첫 항목 \"Pretendard Variable\"", () => {
    const body = globals.filter((r) => r.selector.split(",").map((s) => s.trim()).includes("body"));
    const families = body.map((r) => declValue(r.body, "font-family")).filter((v): v is string => v !== undefined);
    expect(families, "body 에 font-family 선언이 정확히 하나").toHaveLength(1);
    expect(normSpace(families[0])).toBe(STACK);
    expect(families[0].split(",")[0].trim()).toBe('"Pretendard Variable"');
  });

  test("button · input · select · textarea { font: inherit } — 브라우저 기본 폼 글꼴을 쓰지 않는다", () => {
    const hit = globals.find((r) => {
      const sel = new Set(r.selector.split(",").map((s) => s.trim()));
      return ["button", "input", "select", "textarea"].every((t) => sel.has(t));
    });
    expect(hit, "네 요소를 함께 묶은 전역 규칙이 없다").toBeDefined();
    expect(declValue(hit?.body ?? "", "font")).toBe("inherit");
  });

  test("루트 레이아웃이 글꼴 CSS 를 import 한다 — 공개·관리자·전역 404 가 모두 이 레이아웃 아래다", () => {
    const layout = stripComments(read(ROOT_LAYOUT), ROOT_LAYOUT);
    expect(layout).toMatch(/import\s+["']\.\.\/styles\/pretendard\.css["'];/);
    // 전역 규칙(globals.css)보다 먼저 싣는다 — @font-face 가 앞에 있어야 읽는 사람이 순서를 헷갈리지 않는다
    expect(layout.indexOf("styles/pretendard.css")).toBeLessThan(layout.indexOf("./globals.css"));
  });
});

// =============================================================================
// 2. @font-face — 자체 호스팅 · 파일 실재 · 동적 서브셋
// =============================================================================
describe("2. @font-face — src 는 전부 /fonts/pretendard/ 이고 파일이 실제로 있다", () => {
  const faces = rules(read(FONT_CSS)).filter((r) => r.selector === "@font-face");
  const woff2 = filesUnder(FONT_DIR).filter((f) => f.endsWith(".woff2"));

  test("조각이 있다 — @font-face 수 = 폴더의 woff2 수 (빠진 파일도, 남는 파일도 없다)", () => {
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.length).toBe(woff2.length);
  });

  test("모든 조각: family 'Pretendard Variable' · src 한 개가 /fonts/pretendard/…woff2 · unicode-range · swap · 가변 굵기 범위", () => {
    const seen = new Set<string>();
    for (const [i, f] of faces.entries()) {
      expect(declValue(f.body, "font-family")?.replace(/["']/g, ""), `#${i} family`).toBe("Pretendard Variable");
      const src = declValue(f.body, "src") ?? "";
      const urls = [...src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]);
      expect(urls, `#${i} src 의 url 은 하나`).toHaveLength(1);
      expect(urls[0].startsWith(FONT_URL_PREFIX), `#${i} ${urls[0]}`).toBe(true);
      expect(urls[0].endsWith(".woff2"), `#${i} ${urls[0]}`).toBe(true);
      expect(src).toMatch(/format\(\s*['"]woff2(-variations)?['"]\s*\)/);
      expect(declValue(f.body, "unicode-range"), `#${i} unicode-range`).toMatch(/^U\+/i);
      expect(declValue(f.body, "font-display"), `#${i} font-display`).toBe("swap");
      expect(declValue(f.body, "font-weight"), `#${i} font-weight`).toMatch(/^\d+ \d+$/);
      seen.add(urls[0]);
    }
    expect(seen.size, "같은 파일을 두 번 가리키지 않는다").toBe(faces.length);
  });

  test("가리키는 파일이 public/ 아래에 있고 진짜 woff2 다 (서명 wOF2 — 내려받기 실패로 저장된 HTML 이 아니다)", () => {
    for (const f of faces) {
      const url = [...(declValue(f.body, "src") ?? "").matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)][0][2];
      const abs = path.join(ROOT, "public", ...url.split("/").filter(Boolean));
      expect(existsSync(abs), url).toBe(true);
      const head = readFileSync(abs).subarray(0, 4).toString("latin1");
      expect(head, url).toBe("wOF2");
    }
  });

  test("SIL OFL 1.1 원문 LICENSE.txt 가 글꼴 옆에 있다", () => {
    const license = path.join(ROOT, FONT_DIR, "LICENSE.txt");
    expect(existsSync(license)).toBe(true);
    const text = readFileSync(license, "utf8");
    expect(text).toMatch(/SIL OPEN FONT LICENSE/i);
    expect(text).toMatch(/Version 1\.1/);
    expect(text).toMatch(/Pretendard/);
  });

  test("글꼴 CSS 머리말에 출처(저장소)와 라이선스가 남아 있다", () => {
    const head = read(FONT_CSS).slice(0, 2000);
    expect(head).toMatch(/orioncactus\/pretendard/);
    expect(head).toMatch(/SIL Open Font License/i);
  });
});

// =============================================================================
// 3. 외부 글꼴 주소 0 — 런타임 소스 전수
// =============================================================================
describe("3. 외부 글꼴 요청 0 — Google Fonts · jsDelivr · unpkg · cdnjs 없음", () => {
  const EXTERNAL = /fonts\.googleapis\.com|fonts\.gstatic\.com|jsdelivr|unpkg\.com|cdnjs|use\.typekit\.net|fonts\.bunny\.net|next\/font\/google/i;
  const TEXT_EXT = /\.(tsx?|mjs|cjs|js|css|json|html|svg|txt|xml|webmanifest)$/;
  const sources = [
    ...["app", "components", "lib", "styles", "i18n", "messages", "actions", "public"].flatMap(filesUnder),
    "middleware.ts",
    "next.config.ts",
  ].filter((f) => TEXT_EXT.test(f));

  test("검사 대상이 있다 (빈 통과 방지)", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources).toContain(FONT_CSS);
    expect(sources).toContain(GLOBALS);
  });

  test("어떤 런타임 소스에도 외부 글꼴 주소·next/font/google 이 없다", () => {
    const hits = sources.filter((f) => EXTERNAL.test(read(f)));
    expect(hits).toEqual([]);
  });
});

// =============================================================================
// 4. 글꼴을 정하는 곳은 body 하나 — 모듈 CSS·전역 CSS·인라인 style
// =============================================================================
describe("4. 글꼴을 덮는 선언 0 — 모듈 CSS · 다른 전역 CSS · 인라인 style (허용 목록 없음)", () => {
  const moduleCss = [...filesUnder("app"), ...filesUnder("components")].filter((f) => f.endsWith(".module.css"));
  const allCss = [...filesUnder("app"), ...filesUnder("components"), ...filesUnder("styles")].filter((f) => f.endsWith(".css"));

  test("검사 대상 모듈 CSS 가 있다 — 관리자 두 파일 포함", () => {
    expect(moduleCss.length).toBeGreaterThan(10);
    expect(moduleCss).toContain("components/admin/admin.module.css");
    expect(moduleCss).toContain("app/admin/login/login.module.css");
  });

  test("모듈 CSS 에 font-family 선언 0 · font 단축 속성은 inherit 만", () => {
    const hits: string[] = [];
    for (const f of moduleCss) {
      for (const r of rules(read(f))) {
        for (const m of r.body.matchAll(/(?:^|;|\s)(font-family|font)\s*:\s*([^;]+)/g)) {
          if (m[1] === "font-family" || m[2].trim() !== "inherit") hits.push(`${f} — ${r.selector} { ${m[1]}: ${m[2].trim()} }`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  test("font-family 속성은 전역 body 하나뿐이다 (@font-face 서술자는 속성이 아니다)", () => {
    const hits: string[] = [];
    for (const f of allCss) {
      for (const r of rules(read(f))) {
        if (r.selector === "@font-face") continue;
        if (!/(?:^|;|\s)font-family\s*:/.test(r.body)) continue;
        const isBody = f === GLOBALS && r.selector.split(",").map((s) => s.trim()).includes("body");
        if (!isBody) hits.push(`${f} — ${r.selector}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test("TSX 인라인 style 에 fontFamily 0 (app · components)", () => {
    const tsx = [...filesUnder("app"), ...filesUnder("components")].filter((f) => /\.tsx?$/.test(f));
    const hits = tsx.filter((f) => /fontFamily/.test(stripComments(read(f), f)));
    expect(hits).toEqual([]);
  });
});

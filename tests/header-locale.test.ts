/**
 * P2-6b — 헤더 세 가지 결함 수정의 계약.
 *
 *   1. 모바일 메뉴 패널이 헤더 가로 flex 줄(`.inner`) 안에 폭 없이 들어가 오른쪽 32px 띠로 렌더되던 결함(90d0fc0 부터, ko·en 공통).
 *      → 패널을 줄 **밖**(헤더의 직계, 줄의 형제)으로 옮겨 헤더 전체 폭으로 펼친다 — 목업 variant-08 의 `.hdr__in` / `.drawer` 구조와 같다.
 *      **구조로 잠근다**: TypeScript AST 로 JSX 트리를 걸어 "패널 요소의 조상 중에 `className={styles.inner}` 가 없다"를 단언한다.
 *      (CSS 폭 규칙은 누가 flex 규칙을 바꾸면 조용히 깨지지만, 줄 밖에 있는 한 flex 항목이 될 수 없다.)
 *   2. `/en` 을 한 번 방문하면 NEXT_LOCALE 쿠키 때문에 `/` 가 `/en` 으로 리다이렉트되고(Accept-Language 도 같다) 돌아갈 방법이 없던 결함.
 *      → 컨트롤러 결정: `localeDetection: false`. `/` 는 언제나 한국어, `/en` 은 언제나 영어.
 *        쿠키 자체도 쓰지 않는다(`localeCookie: false`) — 읽지 않는 쿠키를 심을 이유가 없고, 처리방침(원장
 *        PRIVACY_POLICY_SECTIONS.cookies)은 브라우저 저장소(localStorage)만 고지한다.
 *      → 언어 전환 링크: 한국어 화면 "English", 영문 화면 "한국어". 같은 경로의 다른 로케일. 헤더 오른쪽(데스크톱) + 모바일 패널 맨 위.
 *   3. 위저드 영문 단위 "1 buses" — ICU plural. ko 는 렌더 결과를 바꾸지 않는다.
 *
 * 렌더 실측 블록(§4)은 EN_BASE_URL 이 있을 때만 GET 으로 돈다(dev 서버는 운영 DB 를 본다 — POST 금지).
 * 주의: tests/ 아래라 게이트(check-no-pricing · check-legal-disclosures · check-temp-values)의 검사 대상이다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import ts from "typescript";
import { createTranslator } from "use-intl/core";
import { describe, expect, test } from "vitest";

import { routing } from "@/i18n/routing";
import { LOCALE_NAMES } from "@/lib/i18n/locale-names";
import { middleware } from "@/middleware";

import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);

const HEADER = "components/layout/Header.tsx";
const MOBILE_MENU = "components/layout/MobileMenu.tsx";
const LOCALE_SWITCH = "components/layout/LocaleSwitch.tsx";
const HEADER_CSS = "components/layout/Header.module.css";

const ko = JSON.parse(read("messages/ko.json")) as Record<string, unknown>;
const en = JSON.parse(read("messages/en.json")) as Record<string, unknown>;

// =============================================================================
// JSX 구조 도우미 — TypeScript AST
// =============================================================================
type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

function parseTsx(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function openingOf(node: JsxNode): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function tagName(node: JsxNode): string {
  return openingOf(node).tagName.getText();
}

/** 속성 값의 원문(`{styles.inner}` → `styles.inner`, `"x"` → `x`). 없으면 null. */
function attr(node: JsxNode, name: string): string | null {
  for (const p of openingOf(node).attributes.properties) {
    if (!ts.isJsxAttribute(p) || p.name.getText() !== name) continue;
    const init = p.initializer;
    if (!init) return "";
    if (ts.isStringLiteral(init)) return init.text;
    if (ts.isJsxExpression(init) && init.expression) return init.expression.getText();
  }
  return null;
}

function allJsx(sf: ts.SourceFile): JsxNode[] {
  const out: JsxNode[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** JSX 조상(가까운 것부터). JsxSelfClosingElement 는 자식이 없으므로 조상이 될 수 없다. */
function jsxAncestors(node: ts.Node): ts.JsxElement[] {
  const out: ts.JsxElement[] = [];
  for (let p = node.parent; p; p = p.parent) if (ts.isJsxElement(p)) out.push(p);
  return out;
}

// =============================================================================
// 1. 모바일 메뉴 패널 — 헤더 줄 밖, 전체 폭
// =============================================================================
describe("1. 모바일 메뉴 패널은 헤더 가로 줄(.inner)의 자식이 아니다 — 구조 잠금", () => {
  const menu = parseTsx(MOBILE_MENU);
  const menuJsx = allJsx(menu);
  const panel = menuJsx.find((n) => attr(n, "id") === "PANEL_ID");
  const row = menuJsx.find((n) => attr(n, "className") === "styles.inner");

  test("MobileMenu 가 헤더 줄(.inner)과 패널(#PANEL_ID)을 함께 그린다 — 둘 다 찾을 수 있다", () => {
    expect(panel, "패널 요소(id={PANEL_ID})를 찾지 못했다").toBeDefined();
    expect(row, "헤더 줄(className={styles.inner})을 찾지 못했다 — 줄이 MobileMenu 밖으로 나갔다면 이 테스트를 새 구조에 맞춰라").toBeDefined();
  });

  test("패널의 JSX 조상 어디에도 className={styles.inner} 가 없다 (= flex 항목이 될 수 없다)", () => {
    const classes = jsxAncestors(panel!).map((a) => attr(a, "className"));
    expect(classes).not.toContain("styles.inner");
  });

  test("햄버거 버튼(aria-controls={PANEL_ID})은 줄 안에 있다 — 버튼 자리는 그대로", () => {
    const burger = menuJsx.find((n) => attr(n, "aria-controls") === "PANEL_ID");
    expect(burger, "햄버거 버튼을 찾지 못했다").toBeDefined();
    expect(jsxAncestors(burger!).map((a) => attr(a, "className"))).toContain("styles.inner");
  });

  test("패널은 줄 뒤에 온다 — 헤더 바로 아래로 펼쳐진다(목업 .hdr__in → .drawer 순서)", () => {
    expect(panel!.getStart()).toBeGreaterThan(row!.getEnd());
  });

  test("Header 는 MobileMenu 를 줄(.inner) 안에 두지 않는다 — header 의 직계 자식이다", () => {
    const header = parseTsx(HEADER);
    const jsx = allJsx(header);
    const mm = jsx.find((n) => tagName(n) === "MobileMenu");
    expect(mm, "Header 가 MobileMenu 를 렌더하지 않는다").toBeDefined();
    const ancestors = jsxAncestors(mm!);
    expect(ancestors.map((a) => attr(a, "className"))).not.toContain("styles.inner");
    expect(ancestors[0] ? tagName(ancestors[0]) : null, "MobileMenu 의 가장 가까운 JSX 부모는 <header> 여야 한다").toBe("header");
  });

  test("CSS — 패널에 줄을 가정한 폭·위치 규칙이 없고(가운데 정렬 max-width 도 없다), 닫힘은 hidden 으로", () => {
    const css = codeOf(HEADER_CSS);
    const panelBlock = /\.panel\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(panelBlock, ".panel 규칙이 없다").not.toBe("");
    expect(panelBlock).not.toMatch(/max-width|flex\s*:|position\s*:\s*absolute/);
    expect(css).toMatch(/\.panel\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
  });

  // P7-4: 잠금은 body 가 아니라 문서 루트에(lib/scroll-lock.ts — body 에 걸면 붙어 있는 머리글이 패널째 화면 밖으로 떨어졌다.
  // 잠금 함수 자체는 tests/uiux-polish.test.ts §1 이 잠근다)
  test("닫힘 동작 — Escape · 바깥 누름(pointerdown) · 링크 누름, 열린 동안 배경 스크롤 잠금(문서 루트)", () => {
    const src = codeOf(MOBILE_MENU);
    expect(src).toMatch(/event\.key\s*===\s*["']Escape["']/);
    expect(src).toMatch(/addEventListener\(\s*["']pointerdown["']/);
    expect(src).toMatch(/removeEventListener\(\s*["']pointerdown["']/);
    expect(src).toMatch(/\.contains\(/);
    expect(src).toMatch(/const unlock = lockDocumentScroll\(\);/);
    expect(src).toMatch(/unlock\(\);/);
    expect(src).toMatch(/onNavigate=\{/);
  });
});

// =============================================================================
// 2. 로케일 감지 끔 — 쿠키·Accept-Language 로 옮기지 않는다
// =============================================================================
async function run(url: string, headers: Record<string, string> = {}) {
  return await middleware(new NextRequest(url, { headers }));
}
const isRedirect = (res: Response) => res.status >= 300 && res.status < 400;

describe("2. 로케일은 경로만 정한다 — localeDetection:false · localeCookie:false", () => {
  test("routing 설정", () => {
    expect(routing.localeDetection).toBe(false);
    expect(routing.localeCookie).toBe(false);
  });

  test("NEXT_LOCALE=en 쿠키 + 영어 Accept-Language 여도 `/` 는 리다이렉트되지 않는다", async () => {
    const res = await run("http://localhost:3000/", { cookie: "NEXT_LOCALE=en", "accept-language": "en-US,en;q=0.9" });
    expect(isRedirect(res), `status ${res.status} → ${res.headers.get("location")}`).toBe(false);
    expect(res.headers.get("location")).toBeNull();
  });

  test("영어 Accept-Language 만 있어도 `/fleet` 은 리다이렉트되지 않는다 (첫 방문 외국인도 주소 그대로)", async () => {
    const res = await run("http://localhost:3000/fleet", { "accept-language": "en-US,en;q=0.9" });
    expect(isRedirect(res), `status ${res.status} → ${res.headers.get("location")}`).toBe(false);
  });

  test("`/en/fleet` 은 그대로 영어 — 한국어 Accept-Language·ko 쿠키여도 리다이렉트되지 않는다", async () => {
    const res = await run("http://localhost:3000/en/fleet", { cookie: "NEXT_LOCALE=ko", "accept-language": "ko-KR,ko;q=0.9" });
    expect(isRedirect(res), `status ${res.status} → ${res.headers.get("location")}`).toBe(false);
  });

  test("`/en` 을 방문해도 로케일 쿠키를 심지 않는다", async () => {
    const res = await run("http://localhost:3000/en", { "accept-language": "ko-KR,ko;q=0.9", "sec-fetch-dest": "document" });
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/NEXT_LOCALE/);
  });

  test("대조군 — `/ko/about` 같은 기본 로케일 접두사는 여전히 접두사 없는 주소로 보낸다(as-needed 유지 · 옛 링크 호환)", async () => {
    const res = await run("http://localhost:3000/ko/about");
    expect(isRedirect(res)).toBe(true);
    expect(new URL(res.headers.get("location")!, "http://localhost:3000").pathname).toBe("/about");
  });
});

// =============================================================================
// 3. 언어 전환 링크
// =============================================================================
describe("3. 언어 전환 링크 — 같은 경로의 다른 로케일", () => {
  test("로케일 자기 이름(endonym) — 대상 언어로 적는다", () => {
    expect(LOCALE_NAMES).toEqual({ ko: "한국어", en: "English" });
    expect(Object.keys(LOCALE_NAMES).sort()).toEqual([...routing.locales].sort());
  });

  test("LocaleSwitch — 클라이언트 · 현재 경로(usePathname) → 대상 로케일의 정본 경로(getPathname) · hrefLang·lang · 원장 import 0", () => {
    const raw = read(LOCALE_SWITCH);
    const src = codeOf(LOCALE_SWITCH);
    expect(raw.trimStart()).toMatch(/^["']use client["']/);
    expect(src).toMatch(/import\s*\{[^}]*\bgetPathname\b[^}]*\busePathname\b[^}]*\}\s*from\s*["']@\/i18n\/navigation["']/);
    expect(src).toMatch(/getPathname\(\s*\{\s*href:\s*pathname,\s*locale:\s*target\s*\}\s*\)/);
    // next-intl <Link locale=…> 는 접두사를 강제해 영문 → 한국어가 `/ko/…` 가 된다(미들웨어 리다이렉트 한 번 더). 쓰지 않는다.
    expect(src).not.toMatch(/\blocale=\{/);
    expect(src).not.toMatch(/forcePrefix/);
    expect(src).toMatch(/href=\{href\}/);
    expect(src).toMatch(/hrefLang=\{target\}/);
    expect(src).toMatch(/lang=\{target\}/);
    expect(src).toMatch(/LOCALE_NAMES\[target\]/);
    expect(src).not.toMatch(/@\/lib\/legal\/disclosures/);
    expect(src).not.toMatch(/[가-힣]/);
  });

  test("자리 — 헤더 줄(데스크톱) 한 곳 + 모바일 패널 맨 위 한 곳", () => {
    const header = parseTsx(HEADER);
    const inHeader = allJsx(header).filter((n) => tagName(n) === "LocaleSwitch");
    expect(inHeader).toHaveLength(1);

    const menu = parseTsx(MOBILE_MENU);
    const jsx = allJsx(menu);
    const panel = jsx.find((n) => attr(n, "id") === "PANEL_ID") as ts.JsxElement;
    const inPanel = jsx.filter((n) => tagName(n) === "LocaleSwitch");
    expect(inPanel).toHaveLength(1);
    expect(jsxAncestors(inPanel[0])).toContain(panel);
    // 맨 위 — 패널의 첫 JSX 자식(안의 LocaleSwitch)이 Nav 보다 앞
    const firstChild = panel.children.find((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
    expect(firstChild && allJsxWithin(firstChild).some((n) => tagName(n) === "LocaleSwitch")).toBe(true);
    const nav = jsx.find((n) => tagName(n) === "Nav" && jsxAncestors(n).includes(panel));
    expect(nav, "패널 안에 Nav 가 없다").toBeDefined();
    expect(inPanel[0].getStart()).toBeLessThan(nav!.getStart());
  });

  /**
   * 법정 페이지(/privacy·/terms·/guide)는 **사이트 헤더를 상속하지 않는다**(P0-0 · (legal) 셸).
   * 그래서 헤더의 전환 링크가 거기엔 없고, 영문 손님이 `/en/privacy` 에서 한국어로 돌아갈 방법이 사라진다 —
   * P2-6b 가 헤더에서 고친 것과 같은 결함이라 같은 부품을 (legal) 셸 하단 nav 에도 둔다.
   */
  test("자리 — 법정 셸 하단 nav 에도 하나(사이트 헤더가 없는 화면이다)", () => {
    const legal = parseTsx("app/[locale]/(legal)/layout.tsx");
    const inLegal = allJsx(legal).filter((n) => tagName(n) === "LocaleSwitch");
    expect(inLegal, "법정 셸에 언어 전환이 없다 — /en/privacy 에서 한국어로 돌아갈 수 없다").toHaveLength(1);
    const nav = allJsx(legal).find((n) => tagName(n) === "nav");
    expect(nav, "법정 셸에 nav 가 없다").toBeDefined();
    expect(jsxAncestors(inLegal[0])).toContain(nav);
  });

  test("데스크톱 자리는 1280px 미만에서 숨는다(모바일 줄은 로고·전화·햄버거만 — 375px 폭을 넘기지 않는다)", () => {
    const css = codeOf(HEADER_CSS);
    expect(css).toMatch(/\.localeDesktop\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\s*\(min-width:\s*1280px\)\s*\{\s*\.localeDesktop\s*\{[^}]*display:\s*(block|inline-block|flex)/);
  });

  test("영문 화면은 데스크톱에서도 햄버거를 쓴다 — 영문 메뉴 한 줄(901px 실측)이 최대 폭 헤더 줄(메뉴 칸 831px)에 들어가지 않는다", () => {
    const css = codeOf(HEADER_CSS);
    const blocks = [...css.matchAll(/@media\s*\(min-width:\s*1280px\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
    const block = blocks.find((b) => b.includes('html[lang="en"]')) ?? "";
    expect(block, "영문 전용 분기 블록이 없다").not.toBe("");
    expect(block).toMatch(/:global\(html\[lang="en"\]\)\s*\.nav\s*\{\s*display:\s*none/);
    // 데스크톱 언어 전환은 영문에서도 줄 오른쪽에 남는다(숨기지 않는다)
    expect(block).not.toMatch(/localeDesktop/);
    expect(block).toMatch(/:global\(html\[lang="en"\]\)\s*\.burger\s*\{\s*display:\s*grid/);
    expect(block).toMatch(/:global\(html\[lang="en"\]\)\s*\.panel:not\(\[hidden\]\)\s*\{\s*display:\s*block/);
    // 국문 분기점은 건드리지 않는다
    expect(block).not.toMatch(/lang="ko"/);
  });
});

function allJsxWithin(node: ts.Node): JsxNode[] {
  const out: JsxNode[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

// =============================================================================
// 4. 위저드 단위 — ICU plural (next-intl 런타임과 같은 createTranslator 로)
// =============================================================================
// P3-8: 6단계 위저드(단위·정원 안내)는 지웠다. 같은 성질(영문 1/2 문법 · ko 렌더)을 간편 견적 모달의 인원 요약에 건다.
describe("4. 간편 견적 요약의 인원 — en 1 person / 2 people, ko 는 N명", () => {
  const tEn = createTranslator({ locale: "en", messages: en, namespace: "quote.modal" as never }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const tKo = createTranslator({ locale: "ko", messages: ko, namespace: "quote.modal" as never }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;

  test("en — 1 person / 2 people / 30 people", () => {
    expect(tEn("paxValue", { n: 1 })).toBe("1 person");
    expect(tEn("paxValue", { n: 2 })).toBe("2 people");
    expect(tEn("paxValue", { n: 30 })).toBe("30 people");
  });

  test("ko — N명 · 날짜 한 개는 (당일)", () => {
    for (const n of [1, 2, 30]) expect(tKo("paxValue", { n })).toBe(`${n}명`);
    expect(tKo("dateSingle", { date: "2026-10-01" })).toBe("2026-10-01 (당일)");
    expect(tKo("dateRange", { from: "2026-10-01", to: "2026-10-03" })).toBe("2026-10-01 ~ 2026-10-03");
  });

  test("모달이 인원 요약에 숫자를 넘긴다(문자열이면 en 의 plural 이 깨진다)", () => {
    const src = codeOf("components/quote/QuickQuoteModal.tsx");
    expect(src).toMatch(/t\(\s*["']paxValue["']\s*,\s*\{\s*n:\s*Number\(/);
  });
});

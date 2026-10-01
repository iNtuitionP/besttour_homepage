/**
 * P7-4 — 공개 사이트 UIUX 마감 13건 계약 테스트 (브리프 .superpowers/sdd/2026-09-06-bestour-implementation-v4/P7-4-brief.md).
 *
 * vitest 는 node 환경이다(DOM 패키지 없음 — 새 패키지 금지). 그래서
 *   (1) 순수 모듈(날짜 형식 · 메뉴 현재 표시 · 전화 국제 표기 · 공유 메타 · 예약확인 뷰의 로케일 라벨)은 직접 부르고,
 *   (2) 클라이언트·동기 서버 컴포넌트는 react-dom/server 의 renderToStaticMarkup 으로 **첫 화면**을 검사하고,
 *   (3) CSS·소스는 정적으로 읽어 잠근다(스크롤·sticky·터치 영역의 실제 크기는 사본 서버 3001 실측 — 보고서 ⑤).
 * 맨 끝의 HTTP 블록은 EN_BASE_URL 이 있을 때만 돈다(tests/i18n-en.test.ts §8 과 같은 가드).
 *
 * 주의: tests/ 아래라 게이트(check-no-pricing · check-legal-disclosures · check-temp-values)의 검사 대상이다 —
 * 금지어·임시값 마커 리터럴을 쓰지 않는다.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/actions/reservation", () => ({ submitReservation: vi.fn() }));
vi.mock("@/actions/quote-form-token", () => ({ requestQuoteFormToken: vi.fn(async () => null) }));
vi.mock("@/actions/reservation-check", () => ({ checkReservation: vi.fn() }));
// next-intl 의 Link 는 라우터 컨텍스트가 필요하다 — 첫 화면 검사에는 평범한 <a> 로 충분하다.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string | { pathname: string; hash?: string }; children: ReactNode }) =>
    createElement("a", { href: typeof href === "string" ? href : `${href.pathname}${href.hash ? `#${href.hash}` : ""}`, ...rest }, children),
  usePathname: () => "/",
  getPathname: ({ href }: { href: string }) => href,
}));
vi.mock("next/script", () => ({ default: () => null }));

import { HeroCarousel, type HeroSlide } from "@/components/home/HeroCarousel";
import { navCurrent } from "@/components/layout/nav-current";
import { LegalPageHeader } from "@/components/legal/LegalPageHeader";
import { AnalyticsOptOut } from "@/components/legal/AnalyticsOptOut";
import { PageHeader } from "@/components/pages/PageHeader";
import { QuickQuoteForm } from "@/components/quote/QuickQuoteModal";
import { ReservationCard } from "@/components/reservation-check/ReservationCard";
import { loadMessages } from "@/i18n/messages";
import { CONSULT_TEL_HREF, consultPhone, intlPhone, localPhone } from "@/lib/contact-phone";
import { ADMIN_ERROR_COPY, GLOBAL_ERROR_COPY } from "@/lib/i18n/error-copy";
import { LEDGER_UI_KO } from "@/lib/i18n/ledger-ui";
import { COMPANY, PRIVACY_NOTICE, VERBATIM, WITHDRAWAL } from "@/lib/legal/disclosures";
import { formatPublicDate, publicDateLabels } from "@/lib/public-date";
import { lockDocumentScroll } from "@/lib/scroll-lock";
import { CHECK_LOCALE_FIELD, formDataToCheckLocale } from "@/lib/reservation-check/formData";
import { lookupReservation, type ReservationCheckRow } from "@/lib/reservation-check/lookup";
import { toReservationView, type ReservationView } from "@/lib/reservation-check/view";
import { shareMetadata } from "@/lib/share-meta";
import { CL } from "@/components/reservation-check/fields";

import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const exists = (rel: string) => existsSync(path.join(ROOT, rel));
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const RAW_DATE = /\d{4}-\d{2}-\d{2}/;

/** 카탈로그 깊은 읽기(단언 전용) — 어느 깊이든 다음 키로 내려가고, 잎은 문자열로 읽는다. */
type Catalog = { readonly [key: string]: Catalog } & string;
const ko = JSON.parse(read("messages/ko.json")) as Catalog;
const en = JSON.parse(read("messages/en.json")) as Catalog;

function withIntl(locale: "ko" | "en", node: ReactNode): string {
  const providerProps = { locale, messages: loadMessages(locale), timeZone: "Asia/Seoul" } as unknown as Parameters<typeof NextIntlClientProvider>[0];
  return renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps, node));
}
/** 마크업의 글자(태그·속성 제외)만 — 속성(dateTime 등)의 원문 날짜는 화면에 보이지 않는다. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function walk(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const p = path.join(abs, name);
    if (statSync(p).isDirectory()) out.push(...walk(path.relative(ROOT, p)));
    else out.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return out;
}

/** CSS 블록 목록 — `@media` 안쪽 규칙은 prelude 를 함께 기록한다(중첩 1단). 주석은 걷어 낸다. */
function cssBlocks(rel: string): Array<{ media: string | null; selector: string; body: string }> {
  const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Array<{ media: string | null; selector: string; body: string }> = [];
  let i = 0;
  const readBlock = (from: number): [string, number] => {
    let depth = 0;
    for (let j = from; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") {
        depth--;
        if (depth === 0) return [css.slice(from + 1, j), j + 1];
      }
    }
    return [css.slice(from + 1), css.length];
  };
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    const [inner, next] = readBlock(open);
    if (prelude.startsWith("@media")) {
      let k = 0;
      while (k < inner.length) {
        const o = inner.indexOf("{", k);
        if (o < 0) break;
        const c = inner.indexOf("}", o);
        out.push({ media: prelude, selector: inner.slice(k, o).trim(), body: inner.slice(o + 1, c) });
        k = c + 1;
      }
    } else if (!prelude.startsWith("@")) {
      out.push({ media: null, selector: prelude, body: inner });
    }
    i = next;
  }
  return out;
}
const decl = (body: string, prop: string): string[] =>
  [...body.matchAll(new RegExp(`(?:^|[;\\s{])${prop.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+)`, "g"))].map((m) => m[1].trim());
const hasSel = (sel: string, cls: string) => new RegExp(`\\.${cls}(?![\\w-])`).test(sel);

/** px 로 풀 수 있는 치수 — 44px 같은 리터럴 또는 --size-target-min(44px) 토큰. 모르는 값은 null. */
function resolvePx(value: string): number | null {
  const v = value.trim();
  if (/^var\(--size-target-min\)$/.test(v)) return 44;
  const m = /^(\d+(?:\.\d+)?)px$/.exec(v);
  return m ? Number(m[1]) : null;
}

// =============================================================================
// 1. 머리글 고정 — overflow clip · 머리글 높이 변수 하나 · 지도 sticky top · 앵커 여백
// =============================================================================
describe("1. 머리글 고정 (sticky) — overflow-x: clip · 높이 변수 한 곳", () => {
  test("app/globals.css 의 html·body 규칙 — 마지막 overflow-x 는 clip(스크롤 상자를 만들지 않는다) · hidden 은 clip 을 모르는 브라우저용 앞줄 폴백뿐", () => {
    const blocks = cssBlocks("app/globals.css");
    const block = blocks.find((b) => /^html\s*,\s*body$/.test(b.selector));
    expect(block, "html, body 규칙이 없다").toBeDefined();
    const values = decl(block!.body, "overflow-x");
    expect(values.at(-1)).toBe("clip");
    expect(values.filter((v) => v !== "clip" && v !== "hidden")).toEqual([]);
    // 다른 곳에서 html/body 를 다시 hidden 으로 덮지 않는다
    for (const b of blocks) {
      if (b === block) continue;
      if (/(^|,\s*)(html|body)(\s|,|$)/.test(b.selector)) expect(decl(b.body, "overflow-x"), b.selector).toEqual([]);
    }
  });

  test("원시 토큰 --header-h 61px · --header-h-lg 77px · --target 44px, 역할 토큰 --layout-header-h(1280px 이상에서 lg) · --size-target-min", () => {
    const tokens = read("styles/tokens.css");
    expect(tokens).toMatch(/--header-h:\s*61px;/);
    expect(tokens).toMatch(/--header-h-lg:\s*77px;/);
    expect(tokens).toMatch(/--target:\s*44px;/);
    const sem = read("styles/semantic.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sem).toMatch(/--layout-header-h:\s*var\(--header-h\);/);
    expect(sem).toMatch(/@media\s*\(min-width:\s*1280px\)\s*\{\s*:root\s*\{\s*--layout-header-h:\s*var\(--header-h-lg\);\s*\}\s*\}/);
    expect(sem).toMatch(/--size-target-min:\s*var\(--target\);/);
  });

  test("Header.module.css — 줄 높이는 변수에서(1px 아래 테두리 포함) · 리터럴 60/76px 0 · position sticky · 문서 위 scroll-padding 이 머리글 높이를 뺀다", () => {
    const blocks = cssBlocks("components/layout/Header.module.css");
    const inner = blocks.filter((b) => hasSel(b.selector, "inner"));
    const minH = inner.flatMap((b) => decl(b.body, "min-height"));
    expect(minH).toEqual(["calc(var(--layout-header-h) - 1px)"]);
    const header = blocks.find((b) => b.selector === ".header");
    expect(decl(header!.body, "position")).toEqual(["sticky"]);
    expect(decl(header!.body, "border-bottom").join()).toMatch(/^1px /);
    const pad = blocks.find((b) => /:global\(html\):has\(\.header\)/.test(b.selector));
    expect(pad, ":global(html):has(.header) 규칙이 없다").toBeDefined();
    expect(decl(pad!.body, "scroll-padding-top").join()).toMatch(/var\(--layout-header-h\)/);
    // 모바일 패널은 머리글 아래 남은 높이만 쓴다(붙어 있는 머리글 + 패널이 화면을 넘지 않게)
    const panel = blocks.find((b) => b.selector === ".panel");
    expect(decl(panel!.body, "max-height").join(" ")).toMatch(/var\(--layout-header-h\)/);
  });

  test("KrMap.module.css — 960px 이상 지도 sticky top = 머리글 높이 + 간격(변수)", () => {
    const sticky = cssBlocks("components/KrMap/KrMap.module.css").filter((b) => b.media && /min-width:\s*960px/.test(b.media) && hasSel(b.selector, "mapFrame"));
    expect(sticky.flatMap((b) => decl(b.body, "position"))).toEqual(["sticky"]);
    const top = sticky.flatMap((b) => decl(b.body, "top"));
    expect(top).toHaveLength(1);
    expect(top[0]).toMatch(/^calc\(var\(--layout-header-h\) \+ var\(--space-[a-z-]+\)\)$/);
  });

  test("#quote · #location 앵커 — 머리글 높이는 문서의 scroll-padding 한 곳에서만 빼고, 착지점의 scroll-margin 은 작은 틈만(두 번 빼지 않는다)", () => {
    const quote = cssBlocks("components/home/Hero.module.css").find((b) => b.selector === ".quote");
    const qm = decl(quote!.body, "scroll-margin-top");
    expect(qm).toHaveLength(1);
    expect(qm[0]).not.toMatch(/--space-section|--layout-header-h/);
    const anchor = cssBlocks("components/pages/pages.module.css").find((b) => b.selector === ".anchor");
    const am = decl(anchor!.body, "scroll-margin-top");
    expect(am.join()).not.toMatch(/--space-section|--layout-header-h/);
  });

  // 오버레이의 배경 스크롤 잠금 — body 에 overflow: hidden 을 걸면 body 가 다시 스크롤 상자가 되어 붙어 있던 머리글이 문서 맨 위로
  // 떨어진다(실측: 휴대폰 메뉴를 scrollY 1500 에서 열면 머리글·패널이 화면 밖 −1733px). 그리고 <html> 이 스크롤을 맡으므로 잠그지도
  // 못했다(감사 실측: 팝업·견적 모달 뒤 페이지가 휠에 그대로 움직였다). 잠금은 문서 루트에 건다.
  /** 가짜 문서 — <html> 의 style · clientWidth 와 창 폭(innerWidth). 둘의 차이가 자리를 차지하는 스크롤바 폭이다. */
  const withFakeDocument = (innerWidth: number, clientWidth: number, fn: (style: Record<string, string>) => void) => {
    const style: Record<string, string> = { overflow: "auto", scrollbarGutter: "" };
    const g = globalThis as { document?: unknown; innerWidth?: number };
    const had = { document: "document" in g, innerWidth: "innerWidth" in g };
    const before = { document: g.document, innerWidth: g.innerWidth };
    g.document = { documentElement: { style, clientWidth } };
    g.innerWidth = innerWidth;
    try {
      fn(style);
    } finally {
      if (had.document) g.document = before.document;
      else delete g.document;
      if (had.innerWidth) g.innerWidth = before.innerWidth;
      else delete g.innerWidth;
    }
  };

  test("lockDocumentScroll — <html> overflow hidden · 스크롤바가 자리를 차지하면(창 폭 > 문서 폭) scrollbar-gutter stable(사라져도 옆으로 밀리지 않게) · 겹쳐 열어도 마지막이 닫힐 때 원래 값으로 · 두 번 풀어도 한 번", () => {
    withFakeDocument(1280, 1265, (style) => {
      const a = lockDocumentScroll();
      expect(style).toEqual({ overflow: "hidden", scrollbarGutter: "stable" });
      const b = lockDocumentScroll();
      a();
      a();
      expect(style.overflow, "아직 하나가 열려 있다").toBe("hidden");
      b();
      expect(style).toEqual({ overflow: "auto", scrollbarGutter: "" });
    });
  });

  // 후속 ③에서 찾은 것: 스크롤바가 없는 짧은 화면(관리자 목록 등 · Windows 처럼 스크롤바가 자리를 차지하는 환경)에서 gutter 를 늘 남기면
  // 없던 스크롤바 자리가 생겨 화면이 그 폭만큼 옆으로 밀린다. 지금 자리를 차지하는 스크롤바가 있을 때만 남긴다(겹치는 스크롤바 = 폭 0 도 같다).
  test("lockDocumentScroll — 자리를 차지하는 스크롤바가 없으면(창 폭 = 문서 폭) gutter 를 건드리지 않는다(없던 자리를 만들어 밀지 않게)", () => {
    withFakeDocument(375, 375, (style) => {
      const unlock = lockDocumentScroll();
      expect(style).toEqual({ overflow: "hidden", scrollbarGutter: "" });
      unlock();
      expect(style).toEqual({ overflow: "auto", scrollbarGutter: "" });
    });
  });

  // 리뷰 P2-1: ko 는 넓은 화면에서 햄버거·패널을 CSS 로 숨긴다. 메뉴를 연 채 창을 넓히면(큰 태블릿을 돌려도) open 이 남아 <html> 잠금만
  // 남았다(실측 — 휠·PageDown 0). 햄버거가 보이지 않게 되면 닫는다. 분기점은 로케일마다 달라(en 은 넓은 화면에서도 햄버거) 숫자로 판단하지 않는다.
  test("휴대폰 메뉴 — 창 크기가 바뀌어 햄버거가 숨으면 닫는다(분기점 숫자 없이 버튼의 계산된 display 로 · 닫히면 듣기도 해제)", () => {
    const src = codeOf("components/layout/MobileMenu.tsx");
    expect(src).toMatch(/window\.addEventListener\(\s*["']resize["']\s*,\s*(\w+)\s*\)/);
    const handler = src.match(/window\.addEventListener\(\s*["']resize["']\s*,\s*(\w+)\s*\)/)![1];
    expect(src).toMatch(new RegExp(`window\\.removeEventListener\\(\\s*["']resize["']\\s*,\\s*${handler}\\s*\\)`));
    // 핸들러 본문 — 햄버거 버튼(ref)의 계산된 display 가 none 이면 **닫는다**. 여는 것·아무것도 안 하는 것·패널을 보는 것은 여기서 걸린다(델타 리뷰 D-1)
    const body = new RegExp(`const ${handler} = \\(\\) => \\{([\\s\\S]*?)\\n\\s*\\};`).exec(src)?.[1];
    expect(body, `${handler} 의 본문을 찾지 못했다 — 화살표 함수 상수 꼴이 바뀌었다면 이 테스트를 새 꼴에 맞춰라`).toBeDefined();
    const el = /const (\w+) = buttonRef\.current;/.exec(body!)?.[1];
    expect(el, "핸들러가 햄버거 버튼(buttonRef)을 읽지 않는다").toBeDefined();
    expect(body).toMatch(new RegExp(`getComputedStyle\\(\\s*${el}\\s*\\)\\.display\\s*===\\s*["']none["']\\s*\\)\\s*setOpen\\(\\s*false\\s*\\)`));
    expect(src).not.toMatch(/matchMedia|innerWidth|\b1280\b/);
    // 듣기는 열려 있는 동안만 — 잠금과 같은 effect(open 이 false 면 일찍 돌아간다) 안에 있다
    const effect = src.slice(src.indexOf("if (!open) return;"), src.indexOf("}, [open]);"));
    expect(effect).toContain("lockDocumentScroll()");
    expect(effect).toMatch(/addEventListener\(\s*["']resize["']/);
  });

  test("휴대폰 메뉴 · 팝업 · 견적 모달 · 관리자 확인 시트는 lockDocumentScroll 로 잠근다 — body.style.overflow 를 직접 건드리지 않는다", () => {
    for (const f of ["components/layout/MobileMenu.tsx", "components/home/Popup.tsx", "components/quote/QuickQuoteModal.tsx", "components/admin/AdminSheet.tsx"]) {
      const src = codeOf(f);
      expect(src, f).toMatch(/lockDocumentScroll\(\)/);
      expect(src, f).not.toMatch(/body\.style\.overflow/);
    }
  });

  // 후속 ③: 관리자 셸도 P5-21 부터 body 가 overflow-x: clip 이라(위 제목줄 sticky), 시트가 body 에 overflow: hidden 을 걸면 그동안
  // body 가 스크롤 상자가 되어 제목줄이 떨어진다 — 공개 화면과 같은 문제다. 목록을 하드코딩하지 않고 저장소 전체에서 찾는다.
  test("저장소 어디에서도 body 의 overflow 를 직접 바꾸지 않는다(관리자 오버레이 포함 — 잠금은 lib/scroll-lock.ts 하나)", () => {
    const files = [...walk("app"), ...walk("components"), ...walk("lib")].filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(100); // 탐지가 비지 않았다
    const offenders = files.filter((f) => /\bbody\.style\.overflow\b|\bbody\.style\.setProperty\(\s*["']overflow/.test(codeOf(f)));
    expect(offenders).toEqual([]);
  });
});

// =============================================================================
// 2. 히어로 — 화살표는 모든 폭에서 아래 오른쪽 · 자동 넘김 멈춤/재생 버튼 · 옛 "고르실 수 있다" 문장 3곳
// =============================================================================
const SLIDES: HeroSlide[] = [1, 2, 3].map((n) => ({
  key: `s${n}`,
  image: `/hero/bus-0${n}.jpg`,
  ariaLabel: `${n} / 3`,
  dotLabel: `slide ${n}`,
  content: createElement("h2", null, `title ${n}`),
}));
const CAROUSEL_LABELS = { carousel: "c", role: "carousel", slideRole: "slide", prev: "PREV", next: "NEXT", dots: "DOTS", pause: "PAUSE", play: "PLAY" };

describe("2. 히어로 — 화살표 위치 · 멈춤/재생 · 문구", () => {
  const blocks = cssBlocks("components/home/Hero.module.css");

  test("캐러셀과 견적 위젯은 같은 CSS 모듈을 쓴다 — 서로 쓰는 클래스가 겹치지 않고(이름이 같으면 규칙이 섞인다), 쓰는 클래스는 전부 정의돼 있다", () => {
    const used = (rel: string) => new Set([...codeOf(rel).matchAll(/\bs\.(\w+)/g)].map((m) => m[1]));
    const carousel = used("components/home/HeroCarousel.tsx");
    const widget = used("components/home/QuoteWidget.tsx");
    expect([...carousel].filter((c) => widget.has(c))).toEqual([]);
    const defined = new Set(blocks.flatMap((b) => [...b.selector.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1])));
    for (const rel of ["components/home/HeroCarousel.tsx", "components/home/QuoteWidget.tsx", "components/home/Hero.tsx"]) {
      expect([...used(rel)].filter((c) => !defined.has(c)), rel).toEqual([]);
    }
  });

  test("화살표·컨트롤 줄에 세로 가운데 배치(top: 50% · translateY(-50%))가 없다 — 어느 폭에서도 글자 위에 뜨지 않는다", () => {
    for (const b of blocks.filter((x) => /\.(arrow|arrowPrev|arrowNext|controls|navBtn|navGroup)\b/.test(x.selector))) {
      expect(decl(b.body, "top"), b.selector).not.toContain("50%");
      expect(decl(b.body, "transform").join(), b.selector).not.toMatch(/translateY\(-50%\)/);
    }
    // 컨트롤 줄은 슬라이드 아래에 붙는다(bottom)
    const controls = blocks.filter((b) => hasSel(b.selector, "controls"));
    expect(controls.flatMap((b) => decl(b.body, "bottom")).length).toBeGreaterThan(0);
    expect(controls.flatMap((b) => decl(b.body, "position"))).toContain("absolute");
  });

  test("화살표·멈춤 버튼 44×44 · 점은 누르는 영역 44×44 + 보이는 막대는 그대로(30×5)", () => {
    const sized = (cls: string) => {
      const bs = blocks.filter((b) => b.media === null && b.selector.split(",").map((x) => x.trim()).includes(`.${cls}`));
      return { w: bs.flatMap((b) => decl(b.body, "width")).map(resolvePx), h: bs.flatMap((b) => decl(b.body, "height")).map(resolvePx) };
    };
    for (const cls of ["navBtn", "dot"]) {
      const { w, h } = sized(cls);
      expect(w.at(-1), `.${cls} width`).toBeGreaterThanOrEqual(44);
      expect(h.at(-1), `.${cls} height`).toBeGreaterThanOrEqual(44);
    }
    // 좁은 폭에서 다시 줄이지 않는다(옛 38px 규칙 제거)
    for (const b of blocks.filter((x) => x.media && /max-width/.test(x.media) && /\.(navBtn|arrow|dot)\b/.test(x.selector) && !/::before/.test(x.selector))) {
      for (const v of decl(b.body, "height")) expect(resolvePx(v) ?? 44, `${b.media} ${b.selector}`).toBeGreaterThanOrEqual(44);
    }
    const bar = blocks.find((b) => b.media === null && /\.dot::before/.test(b.selector));
    expect(bar, ".dot::before(보이는 막대)").toBeDefined();
    expect(decl(bar!.body, "width")).toEqual(["30px"]);
    expect(decl(bar!.body, "height")).toEqual(["5px"]);
  });

  test("렌더 — 멈춤 버튼(aria-label=멈춤) 1개 · 점 3개 · 이전/다음 · 슬라이드 안에 h1 없음 · 컨트롤은 슬라이드 뒤", () => {
    const html = renderToStaticMarkup(createElement(HeroCarousel, { slides: SLIDES, labels: CAROUSEL_LABELS }));
    expect(html.match(/aria-label="PAUSE"/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('aria-label="PLAY"');
    expect(html.match(/aria-controls=/g) ?? []).toHaveLength(3);
    expect(html).toContain('aria-label="PREV"');
    expect(html).toContain('aria-label="NEXT"');
    expect(html).not.toMatch(/<h1[\s>]/);
    // 탭 순서 = 보이는 순서: 멈춤 → 점 → 이전 → 다음 (APG: 회전 컨트롤이 첫 번째)
    const order = ["PAUSE", "slide 1", "PREV", "NEXT"].map((l) => html.indexOf(`aria-label="${l}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.indexOf('data-slide="s3"')).toBeLessThan(order[0]);
  });

  test("소스 — 멈춤/재생은 사용자 선택(감속 설정이면 기본 멈춤) · hover·focus 정지 유지 · 라벨은 props(한글 리터럴 0)", () => {
    const src = codeOf("components/home/HeroCarousel.tsx");
    expect(src).toMatch(/labels\.pause/);
    expect(src).toMatch(/labels\.play/);
    expect(src).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(src).toMatch(/onMouseEnter/);
    expect(src).toMatch(/onFocus/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    expect(codeOf("components/home/Hero.tsx")).toMatch(/pause:\s*t\(\s*["']pause["']\s*\)/);
    expect(typeof ko.home.hero.pause).toBe("string");
    expect(typeof ko.home.hero.play).toBe("string");
    expect(typeof en.home.hero.pause).toBe("string");
    expect(typeof en.home.hero.play).toBe("string");
  });

  test("옛 문장 3곳 — 간편 견적은 운행 구분·차종을 받지 않는다(고르다·선택 0, ko·en)", () => {
    const pairs: Array<[string, string]> = [
      [ko.home.hero.slides.nationwide.body, en.home.hero.slides.nationwide.body],
      [ko.home.fleet.title, en.home.fleet.title],
      [ko.pages.fleet.empty, en.pages.fleet.empty],
    ];
    for (const [k, e] of pairs) {
      expect(k).not.toMatch(/고르|선택/);
      expect(e).not.toMatch(/\bchoose\b|\bselect\b|\bpick\b/i);
    }
    // 바꾼 자리는 그대로 — 실증 불가 수치·BM 금지어·"면허" 를 새로 들이지 않았다
    const joined = pairs.flat().join(" ");
    for (const w of ["\uBA74\uD5C8", "\uACF5\uCC28", "\uD68C\uC1A1", "\uB204\uC801", "24\uC2DC\uAC04"]) expect(joined.includes(w), w).toBe(false);
  });
});

// =============================================================================
// 3. 페이지 제목 — 슬라이드와 무관한 h1 하나, 슬라이드 제목은 h2
// =============================================================================
describe("3. 홈 h1 — 슬라이드 밖 페이지 제목 하나", () => {
  test("Hero.tsx — 슬라이드 제목은 h2 뿐(조건부 h1 없음) · 페이지 h1 은 캐러셀 밖에 하나(화면에서만 숨김)", () => {
    const src = codeOf("components/home/Hero.tsx");
    expect(src).not.toMatch(/["']h1["']/);
    expect(src.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/<h1 className=\{s\.srOnly\}/);
    expect(src).toMatch(/<h2 className=\{s\.heading\}/);
    expect(src.indexOf("<h1")).toBeLessThan(src.indexOf("<HeroCarousel"));
    const sr = cssBlocks("components/home/Hero.module.css").find((b) => b.selector === ".srOnly");
    expect(sr, ".srOnly").toBeDefined();
    expect(decl(sr!.body, "clip-path").join() + decl(sr!.body, "clip").join()).toMatch(/inset|rect/);
  });
});

// =============================================================================
// 4. 공개 화면 날짜 형식 — 하나의 틀 (KST · 카탈로그 문구)
// =============================================================================
const KO_DATES = publicDateLabels(ko.common.dates);
const EN_DATES = publicDateLabels(en.common.dates);
const NOW_2026 = new Date("2026-09-30T03:00:00.000Z"); // KST 2026-09-30 12:00

describe("4-a. formatPublicDate — 순수 (ko · en · 경계 · 연도)", () => {
  test("카탈로그 common.dates — ko·en 둘 다 · 요일 7 · 달 12 · 틀 5종", () => {
    for (const L of [KO_DATES, EN_DATES]) {
      expect(L.weekdays).toHaveLength(7);
      expect(L.months).toHaveLength(12);
      for (const k of ["day", "dayYear", "date", "time", "dateTime"] as const) expect(L[k].trim().length, k).toBeGreaterThan(0);
    }
    expect(() => publicDateLabels({})).toThrow();
  });

  test("일정(schedule) — ko \"10월 11일 (일)\" · 시각 \"10월 9일 (금) 07:00\" · en \"Sun, Oct 11\" · \"Fri, Oct 9, 07:00\"", () => {
    expect(formatPublicDate("2026-10-11", KO_DATES, { style: "schedule", now: NOW_2026 })).toBe("10월 11일 (일)");
    expect(formatPublicDate("2026-10-09 07:00", KO_DATES, { style: "schedule", time: true, now: NOW_2026 })).toBe("10월 9일 (금) 07:00");
    expect(formatPublicDate("2026-10-11", EN_DATES, { style: "schedule", now: NOW_2026 })).toBe("Sun, Oct 11");
    expect(formatPublicDate("2026-10-09 07:00", EN_DATES, { style: "schedule", time: true, now: NOW_2026 })).toBe("Fri, Oct 9, 07:00");
    // 시각을 달지 않으면 붙이지 않는다 · 날짜만 있는 값에는 시각을 지어내지 않는다
    expect(formatPublicDate("2026-10-09 07:00", KO_DATES, { style: "schedule", now: NOW_2026 })).toBe("10월 9일 (금)");
    expect(formatPublicDate("2026-10-11", KO_DATES, { style: "schedule", time: true, now: NOW_2026 })).toBe("10월 11일 (일)");
  });

  test("게시일·시행일(posted) — 연도 늘 · 요일 없음: ko \"2026년 9월 21일\" · en \"Sep 21, 2026\"", () => {
    expect(formatPublicDate("2026-09-21", KO_DATES, { style: "posted", now: NOW_2026 })).toBe("2026년 9월 21일");
    expect(formatPublicDate("2026-09-21", EN_DATES, { style: "posted", now: NOW_2026 })).toBe("Sep 21, 2026");
  });

  test("일정의 연도 — 올해(KST)가 아니면 붙인다 · KST 자정 경계(12/31 15:30Z = 1/1 00:30 KST)", () => {
    expect(formatPublicDate("2027-01-05", KO_DATES, { style: "schedule", now: NOW_2026 })).toBe("2027년 1월 5일 (화)");
    expect(formatPublicDate("2027-01-05", EN_DATES, { style: "schedule", now: NOW_2026 })).toBe("Tue, Jan 5, 2027");
    expect(formatPublicDate("2026-12-31T15:30:00.000Z", KO_DATES, { style: "schedule", time: true, now: NOW_2026 })).toBe("2027년 1월 1일 (금) 00:30");
    // "올해" 도 KST 로 잰다: 2026-12-31T16:00Z 는 KST 2027-01-01 이므로 2027 날짜에 연도를 붙이지 않는다
    expect(formatPublicDate("2027-01-05", KO_DATES, { style: "schedule", now: new Date("2026-12-31T16:00:00.000Z") })).toBe("1월 5일 (화)");
  });

  test("인스턴트(Date · ISO+zone)는 KST 로 바꿔 읽는다 · 'YYYY-MM-DD HH:mm'·'YYYY-MM-DDTHH:mm' 은 이미 KST 벽시계", () => {
    expect(formatPublicDate(new Date("2026-09-30T23:30:00.000Z"), KO_DATES, { style: "schedule", time: true, now: NOW_2026 })).toBe("10월 1일 (목) 08:30");
    expect(formatPublicDate("2026-09-13T05:04:00+00:00", KO_DATES, { style: "schedule", time: true, now: NOW_2026 })).toBe("9월 13일 (일) 14:04");
    expect(formatPublicDate("2026-10-01T08:30", KO_DATES, { style: "schedule", time: true, now: NOW_2026 })).toBe("10월 1일 (목) 08:30");
  });

  test("읽을 수 없는 값 → null (빈 값 · 없는 날짜 2026-02-30 · 엉뚱한 문자열)", () => {
    for (const v of [null, undefined, "", "  ", "2026-02-30", "nope", "2026-13-01 07:00"]) expect(formatPublicDate(v as never, KO_DATES, { style: "schedule", now: NOW_2026 }), String(v)).toBeNull();
  });

  test("모듈은 순수 — React·Next·원장 import 0 · 한글 리터럴 0(틀은 카탈로그에서)", () => {
    const src = codeOf("lib/public-date.ts");
    expect(src).not.toMatch(/from\s+["'](react|next|next-intl)[/"']/);
    expect(src).not.toMatch(/legal\/disclosures/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });
});

const CARD_ROW: ReservationCheckRow = {
  public_code: "A2B3C4D5",
  name: "홍길동",
  phone: "+821012345678",
  status: "confirmed",
  intake: "wizard",
  trip_type: "round",
  depart_at: "2026-09-30T23:30:00.000Z",
  return_at: "2026-10-01T09:00:00.000Z",
  vehicle_slug: "bus45",
  origin_code: "SEL",
  destination_code: "BSN",
  bus_count: 2,
  passengers: 40,
  created_at: "2026-09-13T05:04:00.000Z",
};
const VEHICLE = { ko: "45인승 관광버스", en: "45-seat Coach" };
const renderCard = (locale: "ko" | "en", view: ReservationView) =>
  withIntl(locale, createElement(ReservationCard, { view, bookingNotice: VERBATIM.bookingNotice, tel: consultPhone(locale), onAgain: () => {} }));

describe("4-b. 원문 날짜 0 — 렌더 (견적 모달 요약 · 예약확인 카드 · 법정 시행일 · 공지)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("예약확인 카드(위저드 · ko) — \"10월 1일 (목) 08:30\" · 도착 일시 \"10월 1일 (목) 18:00\" · 접수 일시 \"9월 13일 (일) 14:04\" · 원문 날짜 0", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_2026);
    const text = textOf(renderCard("ko", toReservationView(CARD_ROW, VEHICLE, "ko")));
    expect(text).not.toMatch(RAW_DATE);
    expect(text).toContain("10월 1일 (목) 08:30");
    expect(text).toContain("10월 1일 (목) 18:00");
    expect(text).toContain("9월 13일 (일) 14:04");
    expect(text).toContain(ko.reservationCheck.card.returnAt);
  });

  test("예약확인 카드(간편 · ko) — 날짜만 \"10월 1일 (목)\" · \"10월 3일 (토)\" · en 위저드 \"Thu, Oct 1, 08:30\"", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_2026);
    const quick = toReservationView(
      { ...CARD_ROW, intake: "quick", trip_type: null, vehicle_slug: null, bus_count: null, depart_at: "2026-09-30T15:00:00.000Z", return_at: "2026-10-02T15:00:00.000Z" },
      null,
      "ko",
    );
    const q = textOf(renderCard("ko", quick));
    expect(q).not.toMatch(RAW_DATE);
    expect(q).toContain("10월 1일 (목)");
    expect(q).toContain("10월 3일 (토)");
    const e = textOf(renderCard("en", toReservationView(CARD_ROW, VEHICLE, "en")));
    expect(e).not.toMatch(RAW_DATE);
    expect(e).toContain("Thu, Oct 1, 08:30");
    expect(e).toContain("Sun, Sep 13, 14:04");
  });

  test("예약확인 카드 — 가린 휴대폰도 영문 화면은 +82 표기(브리프 §7 '전화번호 전부') · 한국어는 그대로 · 가림은 그대로", () => {
    const ko = textOf(renderCard("ko", toReservationView(CARD_ROW, VEHICLE, "ko")));
    expect(ko).toContain("010-****-5678");
    const en = textOf(renderCard("en", toReservationView(CARD_ROW, VEHICLE, "en")));
    expect(en).toContain("+82 10-****-5678");
    expect(en).not.toContain("010-****-5678");
    expect(en).not.toContain("1234");
    // 카드는 클라이언트 트리 — 원장을 번들에 싣지 않는다: 표기 함수는 원장 없는 lib/phone-format 에서, contact-phone 은 타입만
    const src = codeOf("components/reservation-check/ReservationCard.tsx");
    expect(src).toMatch(/import \{ intlPhone \} from "@\/lib\/phone-format";/);
    expect(src).toMatch(/import type \{ ContactPhone \} from "@\/lib\/contact-phone";/);
    expect(src).not.toMatch(/legal\/disclosures/);
    expect(codeOf("lib/phone-format.ts")).not.toMatch(/^import /m);
  });

  test("견적 모달 요약 — \"10월 1일 (목) ~ 10월 3일 (토)\" · 원문 날짜 0 (ko) · en \"Thu, Oct 1 – Sat, Oct 3\"", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_2026);
    const props = (locale: "ko" | "en") => ({
      fields: { originCode: "ICN", destinationCode: "SEL", departDate: "2026-10-01", returnDate: "2026-10-03", passengers: "30" },
      placeLabels: { origin: "A", dest: "B" },
      locale,
      legal: {
        consent: {
          title: PRIVACY_NOTICE.title,
          purpose: PRIVACY_NOTICE.purpose,
          itemsLine: PRIVACY_NOTICE.itemsLine,
          retention: PRIVACY_NOTICE.retention,
          retentionSummary: PRIVACY_NOTICE.retentionSummary,
          refusal: PRIVACY_NOTICE.refusal,
          consentLabel: PRIVACY_NOTICE.consentLabel,
          publicFeedNotice: PRIVACY_NOTICE.publicFeedNotice,
          privacyHref: "/privacy",
          summaryEn: null,
          officialNotice: null,
          bodyLang: undefined,
        },
        withdrawalNotice: createElement("aside", null, WITHDRAWAL.notice),
        withdrawalConsentLabel: LEDGER_UI_KO.consent.withdrawal,
        bookingNotice: VERBATIM.bookingNotice,
        tel: consultPhone(locale),
      },
      formToken: "1.tok",
      turnstileSiteKey: "site-key",
      turnstileAction: "reserve",
      onEdit: () => {},
      onDone: () => {},
      onWidgetErrors: () => {},
      onStaleToken: () => {},
      titleId: "t",
    });
    const summaryOf = (html: string) => textOf(html.match(/<dl[^>]*data-testid="quick-quote-summary"[\s\S]*?<\/dl>/)?.[0] ?? "");
    const k = summaryOf(withIntl("ko", createElement(QuickQuoteForm, props("ko") as never)));
    expect(k).not.toMatch(RAW_DATE);
    expect(k).toContain("10월 1일 (목) ~ 10월 3일 (토)");
    const e = summaryOf(withIntl("en", createElement(QuickQuoteForm, props("en") as never)));
    expect(e).not.toMatch(RAW_DATE);
    expect(e).toContain("Thu, Oct 1 – Sat, Oct 3");
  });

  test("법정 시행일 — <time dateTime=\"2026-09-21\"> 은 기계용 원문, 보이는 글자는 \"2026년 9월 21일\"", () => {
    const html = renderToStaticMarkup(
      createElement(LegalPageHeader, { title: "T", effectiveDate: "2026-09-21", effectiveDateText: "2026년 9월 21일", effectiveDateLabel: "시행일" }),
    );
    expect(html).toContain('dateTime="2026-09-21"');
    expect(textOf(html)).toBe("T 시행일 2026년 9월 21일");
    for (const page of ["app/[locale]/(legal)/privacy/page.tsx", "app/[locale]/(legal)/terms/page.tsx"]) {
      expect(codeOf(page), page).toMatch(/effectiveDateText=\{formatPublicDate\(/);
    }
  });

  test("공지 날짜(홈 · 목록 · 상세) — 표시는 formatPublicDate(게시일 · 연도), dateTime 은 notice-date 의 YYYY-MM-DD", () => {
    for (const f of ["components/home/NoticeSection.tsx", "components/pages/NoticeList.tsx", "app/[locale]/(site)/notices/[id]/page.tsx"]) {
      const src = codeOf(f);
      expect(src, f).toMatch(/formatPublicDate\([^)]*style:\s*["']posted["']/);
      expect(src, f).toMatch(/dateTime=\{date\}/);
      // 원문 문자열을 그대로 화면에 꽂지 않는다
      expect(src, f).not.toMatch(/>\s*\{date\}\s*</);
    }
  });

  test("클라이언트 두 곳(모달 · 카드)은 카탈로그 common.dates 를 useTranslations 로 읽는다 — 원장·서버 모듈 import 0", () => {
    for (const f of ["components/quote/QuickQuoteModal.tsx", "components/reservation-check/ReservationCard.tsx"]) {
      const src = codeOf(f);
      expect(src, f).toMatch(/publicDateLabels\(/);
      expect(src, f).toMatch(/formatPublicDate\(/);
      expect(src, f).not.toMatch(/legal\/disclosures/);
    }
  });
});

// =============================================================================
// 5. 용어 — 손님 화면의 돌아오는 날은 "도착"
// =============================================================================
describe("5. 용어 — 도착일 · 도착 일시", () => {
  test("예약확인 카드 — 위저드 \"도착 일시\" · 간편 \"도착일\" · en 은 Return 그대로", () => {
    expect(ko.reservationCheck.card.returnAt).toBe("도착 일시");
    expect(ko.reservationCheck.card.returnDate).toBe("도착일");
    expect(ko.home.hero.widget.returnDate).toBe("도착일");
    expect(en.reservationCheck.card.returnAt).toBe("Return");
  });

  test("공개 네임스페이스에 \"귀가\" 0", () => {
    for (const ns of ["common", "layout", "errors", "home", "reservation", "quote", "reservationCheck", "pages"]) {
      expect(JSON.stringify(ko[ns]).includes("귀가"), ns).toBe(false);
    }
  });
});

// =============================================================================
// 6. 메뉴 현재 표시 — 해시 링크는 현재가 아니다 · 하위 페이지는 상위 메뉴를 켠다
// =============================================================================
describe("6. navCurrent — 메뉴 현재 표시 규칙", () => {
  test.for([
    ["/about", "/about", "page"],
    ["/about", "/about#location", undefined],
    ["/", "/#quote", undefined],
    ["/notices/1299", "/notices", "true"],
    ["/notices", "/notices", "page"],
    ["/gallery/ux-autumn-trip", "/gallery", "true"],
    ["/noticesx", "/notices", undefined],
    ["/fleet", "/fares", undefined],
    ["/reservation/check", "/reservation/check", "page"],
  ] as const)("%s · %s → %s", ([pathname, href, want]) => {
    expect(navCurrent(pathname, href)).toBe(want);
  });

  test("Nav 는 이 규칙 하나로 aria-current 와 강조 클래스를 정한다 (헤더 · 모바일 패널 · 푸터 공용)", () => {
    const src = codeOf("components/layout/Nav.tsx");
    expect(src).toMatch(/from\s+["']\.\/nav-current["']/);
    expect(src).toMatch(/navCurrent\(\s*pathname\s*,\s*item\.href\s*\)/);
    expect(src).toMatch(/aria-current=\{current\}/);
    expect(src).not.toMatch(/split\(\s*["']#["']\s*\)/);
  });
});

// =============================================================================
// 7. 영문 페이지의 한국어 — 예약확인 라벨 · 전화 +82 · 사장님 글 lang="ko" · 거부 버튼 lang · 영문 404
// =============================================================================
describe("7-a. 예약확인 — 영문 화면은 영문 지명·차종", () => {
  test("toReservationView(row, names, 'en') — 지명 Seoul → Busan · 차종 name_en · ko 는 그대로", () => {
    const e = toReservationView(CARD_ROW, VEHICLE, "en");
    expect(e.originLabel).toBe("Seoul");
    expect(e.destinationLabel).toBe("Busan");
    expect(e.vehicleLabel).toBe("45-seat Coach");
    for (const v of [e.originLabel, e.destinationLabel, e.vehicleLabel ?? ""]) expect(HANGUL.test(v), v).toBe(false);
    const k = toReservationView(CARD_ROW, VEHICLE, "ko");
    expect([k.originLabel, k.destinationLabel, k.vehicleLabel]).toEqual(["서울", "부산", "45인승 관광버스"]);
  });

  test("폴백 — name_en 이 비면 name_ko · 차량 행이 없으면 slug · 코드표 밖 장소는 코드 그대로", () => {
    expect(toReservationView(CARD_ROW, { ko: "45인승 관광버스", en: "  " }, "en").vehicleLabel).toBe("45인승 관광버스");
    expect(toReservationView(CARD_ROW, null, "en").vehicleLabel).toBe("bus45");
    expect(toReservationView({ ...CARD_ROW, origin_code: "XYZ" }, VEHICLE, "en").originLabel).toBe("XYZ");
  });

  test("lookupReservation — deps.locale 로 뷰 라벨을 고르고, 차량 이름(ko·en)은 일치했을 때만 한 번 읽는다", async () => {
    const vehicleNames = vi.fn(async () => VEHICLE);
    const db = { findByPublicCode: vi.fn(async () => CARD_ROW), vehicleNames };
    const out = await lookupReservation({ publicCode: "A2B3C4D5", phoneLast4: "5678" }, { db, locale: "en" });
    expect(out.found).toBe(true);
    if (!out.found) throw new Error("unreachable");
    expect(out.view.originLabel).toBe("Seoul");
    expect(out.view.vehicleLabel).toBe("45-seat Coach");
    expect(vehicleNames).toHaveBeenCalledTimes(1);
    expect(vehicleNames).toHaveBeenCalledWith("bus45");
  });

  test("폼 → 액션: 로케일은 숨은 칸(locale) — en 만 en, 그 밖은 전부 ko(fail-safe) · 클라이언트 사본 CL 과 같은 이름", () => {
    expect(CHECK_LOCALE_FIELD).toBe("locale");
    expect(CL).toBe(CHECK_LOCALE_FIELD);
    const fd = (v?: string) => {
      const f = new FormData();
      if (v !== undefined) f.append("locale", v);
      return f;
    };
    expect(formDataToCheckLocale(fd("en"))).toBe("en");
    for (const v of [undefined, "ko", "EN", "fr", "", " en"]) expect(formDataToCheckLocale(fd(v)), String(v)).toBe("ko");
    for (const notForm of [null, undefined, {}, "en", 42]) expect(formDataToCheckLocale(notForm as never)).toBe("ko");
    const form = codeOf("components/reservation-check/CheckForm.tsx");
    expect(form).toMatch(/<input type="hidden" name=\{CL\} value=\{/);
    const action = codeOf("actions/reservation-check.ts");
    expect(action).toMatch(/formDataToCheckLocale\(formData\)/);
    expect(action).toMatch(/lookupReservation\(outcome\.input,\s*\{\s*db:[^}]*locale\s*\}\)/);
  });
});

describe("7-b. 전화 — 영문 화면은 +82 표기(원장 값은 그대로, 표시만)", () => {
  test("intlPhone — 0 으로 시작하는 국내 번호만 +82 로(앞 0 제거) · 15xx 대표번호는 그대로", () => {
    expect(intlPhone("010-2048-8585")).toBe("+82 10-2048-8585");
    expect(intlPhone("0303-3443-5252")).toBe("+82 303-3443-5252");
    expect(intlPhone("1566-6188")).toBe("1566-6188");
    expect(intlPhone(COMPANY.consultTel)).toBe(COMPANY.consultTelIntl);
  });

  test("localPhone — ko 는 원장 표기 그대로, en 은 +82 · 링크는 언제나 E.164(15xx 는 숫자만)", () => {
    expect(localPhone("010-2048-8585", "ko")).toEqual({ display: "010-2048-8585", href: "tel:+821020488585" });
    expect(localPhone("010-2048-8585", "en")).toEqual({ display: "+82 10-2048-8585", href: "tel:+821020488585" });
    expect(localPhone("1566-6188", "en")).toEqual({ display: "1566-6188", href: "tel:15666188" });
    expect(localPhone(COMPANY.consultTel, "ko").href).toBe(CONSULT_TEL_HREF);
  });

  test("사장님 휴대폰·팩스·보호책임자 번호를 그리는 자리는 localPhone 을 거친다(푸터 · 고객센터 카드 · 회사소개 · 이용안내 · 처리방침)", () => {
    const footer = codeOf("components/layout/Footer.tsx");
    expect(footer).toMatch(/localPhone\(\s*COMPANY\.mobile\s*,\s*locale\s*\)/);
    expect(footer).toMatch(/localPhone\(\s*COMPANY\.fax\s*,\s*locale\s*\)/);
    expect(footer).toMatch(/localPhone\(\s*COMPANY\.privacyOfficer\.phone\s*,\s*locale\s*\)/);
    // 대표전화 1566 한 줄은 그대로(tests/contact-phone.test.ts 가 같은 모양을 잠근다)
    expect(footer).toMatch(/\{\s*label:\s*contactLabels\.tel,\s*value:\s*COMPANY\.tel\s*\}/);
    const notice = codeOf("components/home/NoticeSection.tsx");
    expect(notice).toMatch(/localPhone\(\s*COMPANY\.mobile\s*,\s*locale\s*\)/);
    expect(notice).not.toMatch(/tel:\$\{COMPANY\.mobile\}/);
    expect(codeOf("app/[locale]/(site)/about/page.tsx")).toMatch(/localPhone\(\s*COMPANY\.mobile\s*,\s*locale\s*\)/);
    expect(codeOf("app/[locale]/(legal)/guide/page.tsx")).toMatch(/localPhone\(/);
    expect(codeOf("app/[locale]/(legal)/privacy/page.tsx")).toMatch(/localPhone\(\s*COMPANY\.privacyOfficer\.phone\s*,\s*locale\s*\)/);
  });
});

describe("7-c. 사장님 글은 lang=\"ko\" (영문 화면) · 거부 버튼은 화면 언어", () => {
  test("PageHeader(contentLang) — h1 · 현재 위치 · 설명에 lang", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, { navLabel: "n", homeLabel: "Home", current: "공지", eyebrow: "Notices", title: "공지", desc: "설명", contentLang: "ko" }),
    );
    expect(html).toMatch(/<h1[^>]*lang="ko"/);
    expect(html).toMatch(/aria-current="page"[^>]*lang="ko"|lang="ko"[^>]*aria-current="page"/);
    expect(html).toMatch(/<p[^>]*lang="ko"[^>]*>설명/);
    const plain = renderToStaticMarkup(createElement(PageHeader, { navLabel: "n", homeLabel: "홈", current: "x", eyebrow: "e", title: "t" }));
    expect(plain).not.toContain("lang=");
  });

  test("공지(홈 · 목록 · 상세) · 앨범 카드 · 사진 설명 · 팝업 — 로케일이 en 이면 lang=\"ko\"(koLang)", () => {
    for (const f of [
      "components/home/NoticeSection.tsx",
      "components/pages/NoticeList.tsx",
      "app/[locale]/(site)/notices/[id]/page.tsx",
      "components/pages/AlbumCards.tsx",
      "components/home/GalleryGrid.tsx",
      "components/home/HomePopup.tsx",
      "app/[locale]/(site)/gallery/[album]/page.tsx",
    ]) {
      expect(codeOf(f), f).toMatch(/koLang\(\s*locale\s*\)/);
    }
    const popup = codeOf("components/home/Popup.tsx");
    expect(popup).toMatch(/lang=\{lang\}/);
  });

  test("방문 통계 거부 버튼 — lang 을 받아 루트에 단다(en 화면의 lang=\"ko\" 본문 안에서도 영문으로 읽힌다)", () => {
    const html = renderToStaticMarkup(
      createElement(AnalyticsOptOut, { labels: { optOut: "Opt out", optIn: "Opt in", storageFailed: "x", browserRefused: "y" }, lang: "en" }),
    );
    expect(html).toMatch(/data-testid="analytics-optout"[^>]*lang="en"|lang="en"[^>]*data-testid="analytics-optout"/);
    expect(codeOf("app/[locale]/(legal)/privacy/page.tsx")).toMatch(/<AnalyticsOptOut[^>]*lang=\{/);
  });

  // 후속 ①: 컨트롤러가 원장에 영문 단계(GUIDE_SECTIONS.flow.stepsEn)를 넣었다 — en 은 그것을 lang 없이, ko 는 steps 그대로.
  // 렌더 단언(바이트 일치 · ko 마크업 무변경 · 리터럴 0)은 tests/how-it-works.test.ts 가 한다. 여기서는 소스 모양만.
  test("홈 '이용 방법' 4단계 — en 은 원장 stepsEn(목록에 lang 없음) · 한국어로 남는 두 줄에만 lang + 그 위 공식 안내", () => {
    const src = codeOf("components/home/HowItWorks.tsx");
    expect(src).toMatch(/GUIDE_SECTIONS/);
    expect(src).toMatch(/flow\.stepsEn/);
    expect(src).toMatch(/<ol className=\{s\.steps\} data-testid="how-steps">/);
    expect(src).toMatch(/<OfficialKoreanNotice/);
    expect(src.indexOf("<OfficialKoreanNotice")).toBeGreaterThan(src.indexOf("</ol>"));
    expect((src.match(/lang=\{lang\}/g) ?? []).length).toBe(2);
  });
});

// =============================================================================
// 8. 404 · 오류 화면
// =============================================================================
describe("8. 404 · global-error · 관리자 오류 화면", () => {
  test("전역 404 — 로고 · 홈 링크 · 예약·상담 전화 · 영문 블록(en 카탈로그) · /en 주소면 영문을 보이는 스크립트 · 한글 리터럴 0", () => {
    const src = read("app/not-found.tsx");
    const code = codeOf("app/not-found.tsx");
    expect(src).toMatch(/\/brand\/logo-bestour\.png/);
    expect(src).toMatch(/<a\s[^>]*href="\/"/);
    expect(src).toMatch(/href="\/en"/);
    expect(src).toMatch(/getTranslations\(\{\s*locale:\s*["']en["']/);
    expect(src).toMatch(/suppressHydrationWarning/);
    expect(src).toMatch(/data-locale-block="ko"/);
    expect(src).toMatch(/data-locale-block="en"/);
    expect(src).toMatch(/COMPANY\.consultTelIntl/);
    expect(code.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    const css = cssBlocks("app/errors.module.css");
    expect(css.some((b) => /html\[data-locale="en"\]/.test(b.selector))).toBe(true);
  });

  test("global-error — 'use client' · 자체 <html lang=\"ko\"><body> · 다시 시도(reset) · 홈 · 전화 · 에러 원문 0 · 문구는 카탈로그(지연 로드) · 한글 리터럴 0", () => {
    expect(exists("app/global-error.tsx")).toBe(true);
    const src = read("app/global-error.tsx");
    const code = codeOf("app/global-error.tsx");
    expect(src.trimStart()).toMatch(/^["']use client["']/);
    expect(src).toMatch(/<html lang="ko">/);
    expect(src).toMatch(/<body[\s>]/);
    expect(src).toMatch(/onClick=\{\s*\(\)\s*=>\s*reset\(\)\s*\}/);
    expect(src).toMatch(/import\(\s*["']@\/lib\/i18n\/error-copy["']\s*\)/);
    expect(code).not.toMatch(/error\.message|error\.stack|String\(\s*error\s*\)/);
    expect(code.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    // 문구는 카탈로그 errors 그대로 · 전화는 원장
    expect(GLOBAL_ERROR_COPY.title).toBe(ko.errors.errorTitle);
    expect(GLOBAL_ERROR_COPY.body).toBe(ko.errors.errorBody);
    expect(GLOBAL_ERROR_COPY.retry).toBe(ko.errors.retry);
    expect(GLOBAL_ERROR_COPY.home).toBe(ko.errors.home);
    expect(GLOBAL_ERROR_COPY.tel).toEqual({ display: COMPANY.consultTel, href: CONSULT_TEL_HREF });
  });

  test("관리자 오류 화면 — (protected) 안(셸 유지) · 'use client' · reset · 관리 홈 링크 · 해요체 문구(admin.error) · 원문 0", () => {
    const f = "app/admin/(protected)/error.tsx";
    expect(exists(f)).toBe(true);
    const src = read(f);
    expect(src.trimStart()).toMatch(/^["']use client["']/);
    expect(src).toMatch(/onClick=\{\s*\(\)\s*=>\s*reset\(\)\s*\}/);
    expect(src).toMatch(/href="\/admin"/);
    expect(codeOf(f)).not.toMatch(/error\.message|error\.stack/);
    expect(codeOf(f).split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    for (const k of ["title", "body", "retry", "home", "ref"]) expect(typeof ko.admin.error?.[k], k).toBe("string");
    expect(ADMIN_ERROR_COPY.title).toBe(ko.admin.error.title);
    for (const v of Object.values(ko.admin.error) as string[]) expect(v, v).not.toMatch(/(니다|십시오)(?=[\s.,!?…)]|$)/u);
  });
});

// =============================================================================
// 9. 견적 모달 — 완료 제목 가운데 · 터치 44px (법정 문구·동의·순서는 무변경)
// =============================================================================
describe("9. 견적 모달", () => {
  test("닫기 X 44×44 · [수정] · \"자세히 보기\" 높이 44 이상", () => {
    const qq = cssBlocks("components/quote/QuickQuote.module.css");
    const close = qq.filter((b) => b.media === null && b.selector === ".close");
    expect(resolvePx(decl(close[0].body, "width")[0])).toBeGreaterThanOrEqual(44);
    expect(resolvePx(decl(close[0].body, "height")[0])).toBeGreaterThanOrEqual(44);
    const edit = qq.find((b) => b.selector === ".edit");
    expect(resolvePx(decl(edit!.body, "min-height")[0])).toBeGreaterThanOrEqual(44);
    const more = cssBlocks("components/quote/quote.module.css").find((b) => b.selector === ".moreBtn");
    expect(resolvePx(decl(more!.body, "min-height")[0])).toBeGreaterThanOrEqual(44);
  });

  test("완료 화면 제목 — 좌우 여백이 같다(가운데 정렬 축이 배지·접수번호와 같다)", () => {
    const qq = cssBlocks("components/quote/QuickQuote.module.css");
    const doneTitle = qq.find((b) => /\.done\s+\.title/.test(b.selector));
    expect(doneTitle, ".done .title").toBeDefined();
    const mi = decl(doneTitle!.body, "margin-inline");
    expect(mi).toHaveLength(1);
    expect(mi[0].split(/\s+/)).toHaveLength(1); // 한 값 = 양쪽 같음
  });
});

// =============================================================================
// 10. 작은 글자 · 작은 터치 영역 (공개 화면 CSS)
// =============================================================================
const PUBLIC_CSS = [
  ...walk("components").filter((f) => f.endsWith(".module.css") && !f.startsWith("components/admin/")),
  "app/errors.module.css",
];

describe("10. 최소 글자 12px · 터치 영역 44px", () => {
  test("공개 화면 CSS Module 의 font-size 는 전부 12px 이상", () => {
    const hits: string[] = [];
    for (const f of PUBLIC_CSS) {
      for (const b of cssBlocks(f)) {
        for (const v of decl(b.body, "font-size")) {
          const m = /^(\d+(?:\.\d+)?)px$/.exec(v);
          if (m && Number(m[1]) < 12) hits.push(`${f} ${b.selector} ${v}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  test.for([
    ["components/home/Popup.module.css", ".x", "height"],
    ["components/home/Popup.module.css", ".x", "width"],
    ["components/home/Popup.module.css", ".txt", "min-height"],
    ["components/home/Popup.module.css", ".chk", "min-height"],
    ["components/layout/Footer.module.css", ".menuLink", "min-height"],
    ["components/layout/Footer.module.css", ".legalLink", "min-height"],
    ["components/layout/Footer.module.css", ".tel", "min-height"],
    ["components/layout/Header.module.css", ".tel", "min-height"],
    ["components/layout/Header.module.css", ".brand", "min-height"],
    ["components/layout/Header.module.css", ".panelLocale .localeLink", "min-height"],
    ["components/layout/Header.module.css", ".panelLocale .localeLink", "min-width"],
    ["components/layout/Footer.module.css", ".menuLink", "min-width"],
    ["components/legal/legal.module.css", ".navLink", "min-height"],
    ["components/home/home.module.css", ".btnSm", "min-height"],
    ["components/home/Sections.module.css", ".csList a", "min-height"],
  ] as const)("%s %s %s ≥ 44px", ([file, selector, prop]) => {
    const blocks = cssBlocks(file).filter((b) => b.media === null && b.selector.split(",").map((s) => s.trim()).includes(selector));
    const values = blocks.flatMap((b) => decl(b.body, prop));
    expect(values.length, `${file} ${selector} 에 ${prop} 없음`).toBeGreaterThan(0);
    expect(resolvePx(values.at(-1)!), `${selector} ${prop}: ${values.at(-1)}`).toBeGreaterThanOrEqual(44);
  });

  // 후속 ②: 빵부스러기 "홈" 의 min-width·좌우 안쪽 여백이 링크 상자를 키워 뒤의 "/" 까지 간격이 벌어졌다(컨트롤러 r2 검토).
  // 누르는 영역은 배치에 끼지 않는 절대 위치 ::after 가 맡고, 링크 상자는 원래(커밋 3dfd2e0) 그대로 — 글자·간격이 목업과 같다.
  // 법정 셸 하단 링크의 짧은 이름("홈으로" · "Home")도 같은 이유로 가로는 ::after (세로는 줄 높이 44px 그대로 — 줄이 바뀌는 목록이라).
  const pseudoHit = (file: string, selector: string, anchor: { left: string; translate: string }) => {
    const blocks = cssBlocks(file);
    const hit = blocks.find((b) => b.media === null && b.selector === selector);
    expect(hit, `${file} ${selector}`).toBeDefined();
    expect(decl(hit!.body, "content")).toEqual(['""']);
    expect(decl(hit!.body, "position")).toEqual(["absolute"]);
    expect(decl(hit!.body, "left")).toEqual([anchor.left]);
    expect(decl(hit!.body, "top")).toEqual(["50%"]);
    expect(decl(hit!.body, "translate")).toEqual([anchor.translate]);
    return { blocks, hit: hit! };
  };

  // 빵부스러기: 가장 가까운 두 링크("홈"·"갤러리") 사이는 8 + "/" + 8 ≈ 20px 뿐이라 둘 다 가운데로 넓히면 1px 겹친다(겹친 곳은 뒤 링크가 먹는다).
  // 그래서 첫 항목("홈")만 가운데로, 나머지는 왼쪽 끝을 링크에 붙여 오른쪽(누를 것이 없는 "/"·현재 위치 쪽)으로 넓힌다.
  test("빵부스러기 링크 — 누르는 영역 44×44 는 절대 위치 ::after(첫 항목은 가운데 · 나머지는 오른쪽으로) · 링크 상자는 원래 그대로(크기·여백·표시 방식 선언 0 → 배치·간격 무변경)", () => {
    const file = "components/pages/pages.module.css";
    const { blocks, hit } = pseudoHit(file, ".crumbLink::after", { left: "0", translate: "0 -50%" });
    expect(decl(hit.body, "width")).toEqual(["max(100%, var(--size-target-min))"]);
    expect(decl(hit.body, "height")).toEqual(["max(100%, var(--size-target-min))"]);
    // 첫 항목은 같은 상자를 가운데로만 옮긴다(나머지 선언은 위 ::after 를 물려받는다). 단 페이지 왼쪽 여백보다 더 왼쪽으로는 가지 않는다 —
    // 375px 의 여백은 16px 인데 "홈"(11px)을 가운데로 넓히면 16.5px 가 나가 0.5px 가 화면 밖으로 잘린다.
    const first = blocks.find((b) => b.media === null && b.selector === ".crumbs li:first-child .crumbLink::after");
    expect(first, "첫 항목 ::after 가운데 규칙").toBeDefined();
    expect(decl(first!.body, "left")).toEqual(["max(calc(50% - var(--size-target-min) / 2), calc(-1 * var(--space-page-x)))"]);
    expect(decl(first!.body, "translate")).toEqual(["0 -50%"]);
    for (const prop of ["width", "height", "min-width", "padding", "margin"]) expect(decl(first!.body, prop), prop).toEqual([]);
    const link = blocks.filter((b) => b.media === null && b.selector === ".crumbLink");
    expect(link).toHaveLength(1);
    expect(decl(link[0].body, "position")).toEqual(["relative"]);
    for (const prop of ["display", "min-width", "min-height", "width", "height", "padding", "padding-inline", "padding-block", "margin", "margin-inline", "margin-block", "margin-inline-start"]) {
      expect(decl(link[0].body, prop), `.crumbLink ${prop}`).toEqual([]);
    }
    // 첫 항목("홈")의 링크 상자를 넓히던 규칙(안쪽 여백 + 음수 바깥 여백)은 없다
    expect(blocks.filter((b) => /^\.crumbs\s+li:first-child\s+\.crumbLink$/.test(b.selector))).toEqual([]);
  });

  test("법정 셸 하단 링크 — 줄 높이 44px 그대로 · 짧은 이름의 누르는 폭 44px 는 ::after(min-width 0 — 뒤 간격이 벌어지지 않는다)", () => {
    const { blocks, hit } = pseudoHit("components/legal/legal.module.css", ".navLink::after", { left: "50%", translate: "-50% -50%" });
    expect(decl(hit.body, "width")).toEqual(["max(100%, var(--size-target-min))"]);
    expect(decl(hit.body, "height")).toEqual(["100%"]);
    const link = blocks.find((b) => b.media === null && b.selector === ".navLink")!;
    expect(decl(link.body, "position")).toEqual(["relative"]);
    expect(decl(link.body, "min-width")).toEqual([]);
    expect(resolvePx(decl(link.body, "min-height").at(-1)!)).toBeGreaterThanOrEqual(44);
  });

  test("공지 목록 제목 링크(홈 · /notices) — 보이는 줄은 그대로 두고 누르는 상자만 44px(안쪽 여백 + 같은 만큼 바깥 여백 빼기)", () => {
    for (const file of ["components/home/Sections.module.css", "components/pages/pages.module.css"]) {
      const link = cssBlocks(file).find((b) => b.media === null && b.selector === ".noticeLink");
      expect(decl(link!.body, "padding-block"), file).toEqual(["calc((var(--size-target-min) - 1lh) / 2)"]);
      expect(decl(link!.body, "margin-block"), file).toEqual(["calc((1lh - var(--size-target-min)) / 2)"]);
    }
  });
});

// =============================================================================
// 11. 브라우저 탭 아이콘 — 브랜드 심볼(스캐폴드 favicon 교체)
// =============================================================================
const pngSize = (rel: string) => {
  const b = readFileSync(path.join(ROOT, rel));
  expect(b.subarray(1, 4).toString("latin1"), `${rel} 은 PNG`).toBe("PNG");
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

describe("11. 아이콘 — app/icon.png · app/apple-icon.png · app/favicon.ico", () => {
  test("icon.png 정사각 48px 이상 · apple-icon.png 180×180", () => {
    const icon = pngSize("app/icon.png");
    expect(icon.w).toBe(icon.h);
    expect(icon.w).toBeGreaterThanOrEqual(48);
    expect(pngSize("app/apple-icon.png")).toEqual({ w: 180, h: 180 });
  });

  test("favicon.ico — 스캐폴드(25,931B Next 기본)가 아니다 · ICO 머리 · 16·32·48 세 장(PNG 압축)", () => {
    const b = readFileSync(path.join(ROOT, "app/favicon.ico"));
    expect(b.length).not.toBe(25931);
    expect(b.readUInt16LE(0)).toBe(0);
    expect(b.readUInt16LE(2)).toBe(1);
    const n = b.readUInt16LE(4);
    const sizes = Array.from({ length: n }, (_, i) => b[6 + i * 16] || 256).sort((x, y) => x - y);
    expect(sizes).toEqual([16, 32, 48]);
    for (let i = 0; i < n; i++) {
      const off = b.readUInt32LE(6 + i * 16 + 12);
      expect(b.subarray(off + 1, off + 4).toString("latin1"), `entry ${i}`).toBe("PNG");
    }
  });
});

// =============================================================================
// 12. 공유 미리보기 — Open Graph · Twitter
// =============================================================================
describe("12. 공유 메타 · 공유 이미지(/og.png)", () => {
  // 처음엔 파일 규약 app/[locale]/opengraph-image.tsx 로 했으나, 기본 로케일(ko)의 이미지 주소가 /ko/opengraph-image/… 가 되어
  // next-intl(as-needed)이 307 로 /opengraph-image/…?hash= 로 돌렸다(실측 — 쿼리까지 바뀐다). 크롤러가 리다이렉트를 안 따라가면 미리보기가
  // 비므로, 점이 든 주소(/og.png — 미들웨어 matcher 밖) 하나를 두 로케일이 함께 쓴다(이미지에 글자가 없어 로케일 차이가 없다).
  test("shareMetadata — website · siteName · og:locale ko_KR/en_US(대안 로케일 서로) · 이미지 /og.png 1200×630(alt = 브랜드명) · summary_large_image · 제목·설명은 넣지 않는다(페이지 메타를 물려받는다)", () => {
    const k = shareMetadata("ko", "베스트투어");
    expect(k.openGraph).toEqual({
      type: "website",
      siteName: "베스트투어",
      locale: "ko_KR",
      alternateLocale: ["en_US"],
      images: [{ url: "/og.png", width: 1200, height: 630, type: "image/png", alt: "베스트투어" }],
    });
    expect(k.twitter).toEqual({ card: "summary_large_image", images: [{ url: "/og.png", alt: "베스트투어" }] });
    const e = shareMetadata("en", "Bestour");
    expect(e.openGraph).toEqual({
      type: "website",
      siteName: "Bestour",
      locale: "en_US",
      alternateLocale: ["ko_KR"],
      images: [{ url: "/og.png", width: 1200, height: 630, type: "image/png", alt: "Bestour" }],
    });
  });

  test("파일 규약 opengraph-image·twitter-image 는 두지 않는다(로케일 주소 리다이렉트) — 이미지는 app/og.png/route.tsx 하나", () => {
    for (const f of ["app/opengraph-image.tsx", "app/[locale]/opengraph-image.tsx", "app/twitter-image.tsx", "app/[locale]/twitter-image.tsx"]) expect(exists(f), f).toBe(false);
    expect(exists("app/og.png/route.tsx")).toBe(true);
  });

  test("로케일 레이아웃이 shareMetadata 를 펼친다 · canonical 은 여전히 레이아웃에 없다", () => {
    const src = codeOf("app/[locale]/layout.tsx");
    expect(src).toMatch(/\.\.\.shareMetadata\(\s*locale\s*,\s*common\.siteName\s*\)/);
    expect(src).not.toMatch(/canonical/);
  });

  test("app/og.png/route.tsx — next/og ImageResponse 1200×630 PNG · 빌드 때 한 번(force-static) · 브랜드 자산(로고 — 심볼 포함 가로형)과 원장 색만 · 글자 노드 0(실증 불가 문구 원천 차단)", () => {
    const f = "app/og.png/route.tsx";
    const src = codeOf(f);
    expect(src).toMatch(/from\s+["']next\/og["']/);
    expect(src).toMatch(/export async function GET\(/);
    expect(src).toMatch(/export const dynamic = ["']force-static["']/);
    expect(src).toMatch(/OG_IMAGE_SIZE/); // 크기는 lib/share-meta.ts 의 한 곳(메타의 width·height 와 같은 값)
    expect(src).toMatch(/public\/brand\/logo-bestour\.png/);
    expect(src).toMatch(/styles\/semantic\.css/);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/); // 색은 토큰에서 — HEX 를 다시 적지 않는다
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    // JSX 안에 글자(텍스트 자식)를 두지 않는다 — 한글 글꼴이 satori 형식(woff2 아님)으로 없고, 확정 표기 밖 문구가 끼어들 틈도 없다
    expect(src).not.toMatch(/>\s*[A-Za-z][^<{]*</);
  });
});

// =============================================================================
// 13. 홈 공지 — 상세 링크 · 전체 보기
// =============================================================================
describe("13. 홈 공지 목록", () => {
  test("항목 제목은 /notices/{id} 링크 · 섹션에 공지사항 전체 보기 링크(/notices · 메뉴 ready 일 때만)", () => {
    const src = codeOf("components/home/NoticeSection.tsx");
    expect(src).toMatch(/href=\{`\/notices\/\$\{n\.id\}`\}/);
    expect(src).toMatch(/noticesMenu\?\.ready/);
    expect(src).toMatch(/href=\{noticesMenu\.href\}/);
    expect(src).toMatch(/t\(\s*["']more["']\s*\)/);
    expect(typeof ko.home.notice.more).toBe("string");
    expect(typeof en.home.notice.more).toBe("string");
  });
});

// =============================================================================
// 14. 렌더 실측 — EN_BASE_URL(사본 서버) 이 있을 때만. GET 만 한다.
// =============================================================================
const BASE = process.env.EN_BASE_URL;
const visibleText = (html: string) =>
  textOf(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<template[\s\S]*?<\/template>/g, " ").replace(/<div hidden[^>]*>[\s\S]*?<\/div>/g, " "));

describe.runIf(Boolean(BASE))("14. 렌더 실측 (GET)", { timeout: 180_000 }, () => {
  const get = async (p: string) => {
    const res = await fetch(`${BASE}${p}`);
    return { status: res.status, html: await res.text() };
  };

  test.for([["/"], ["/notices"], ["/privacy"], ["/terms"], ["/en"], ["/en/notices"], ["/en/privacy"]] as const)("%s — 보이는 글자에 원문 날짜 0", async ([route]) => {
    const { status, html } = await get(route);
    expect(status).toBe(200);
    expect(visibleText(html)).not.toMatch(RAW_DATE);
  });

  test.for([["/"], ["/en"]] as const)("%s — 보조기술에 노출되는 h1 은 하나(슬라이드 밖)", async ([route]) => {
    const { html } = await get(route);
    expect(html.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
  });

  test("/en/no-such-page — 404 · 영문 블록 · 로고 · /en 홈 링크", async () => {
    const { status, html } = await get("/en/no-such-page");
    expect(status).toBe(404);
    expect(html).toContain('data-locale-block="en"');
    expect(html).toContain(en.errors.notFoundTitle);
    expect(html).toMatch(/logo-bestour/);
    expect(html).toMatch(/href="\/en"/);
  });

  test("/ · /en — og:image(/og.png · 리다이렉트 없이 200 PNG) · og:locale · twitter:card · icon 링크", async () => {
    for (const [route, loc] of [["/", "ko_KR"], ["/en", "en_US"]] as const) {
      const { html } = await get(route);
      const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
      expect(og, route).toBeDefined();
      expect(new URL(og!).pathname, route).toBe("/og.png");
      const img = await fetch(`${BASE}/og.png`, { redirect: "manual" });
      expect(img.status, route).toBe(200);
      expect(img.headers.get("content-type"), route).toBe("image/png");
      expect(html, route).toContain(`<meta property="og:locale" content="${loc}"`);
      expect(html, route).toMatch(/<meta name="twitter:card" content="summary_large_image"/);
      expect(html, route).toMatch(/<meta name="twitter:image" content="[^"]*\/og\.png"/);
      expect(html, route).toMatch(/<link rel="icon" href="\/icon\.png/);
      expect(html, route).toMatch(/<link rel="apple-touch-icon" href="\/apple-icon\.png/);
    }
  });

  test("/en · /en/about — 사장님 휴대폰·팩스가 +82 표기(lang=ko 법정 원문 밖) · 홈 고객센터의 휴대폰 링크는 E.164", async () => {
    for (const route of ["/en", "/en/about"]) {
      const { html } = await get(route);
      expect(html, route).toContain(intlPhone(COMPANY.mobile));
      expect(html, route).toContain(intlPhone(COMPANY.fax));
      expect(html, route).not.toContain('href="tel:010-');
    }
    // 휴대폰을 링크로 거는 자리는 홈 고객센터 카드뿐이다(회사소개는 글자만)
    expect((await get("/en")).html).toContain(`tel:+82${COMPANY.mobile.replace(/\D/g, "").slice(1)}`);
  });
});

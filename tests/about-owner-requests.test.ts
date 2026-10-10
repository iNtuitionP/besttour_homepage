/**
 * 사장님 요청 23건 — 단계 1 T1-2 회사소개 (2026-10-10, 계획 `.superpowers/sdd/2026-09-06-bestour-implementation-v4/OWNER-FEEDBACK-plan.md`).
 *
 *   3  /about 맨 위의 작은 글씨 소제목(eyebrow) "회사소개" 삭제 — 페이지 머리(PageHeader)와 인사말 구역(CompanyIntro)에
 *      겹쳐 있던 두 개를 /about 에서만 숨긴다. 큰 제목(h1)·인사말 제목(h2)은 남긴다(결정 13 · 접근성).
 *      같은 컴포넌트를 쓰는 다른 화면(홈 #company · /fleet · /gallery · /notices)은 그대로다 — 선택 prop 이라 넘기지 않으면 예전과 같다.
 *   9  /about 회사 정보 표의 개업 값 "2013년부터" → "2013년"(en "Since 2013" → "2013"). 새 키 pages.about.facts.sinceValue.
 *      홈 신뢰 바(home.trust.since "2013년부터")는 그대로다(결정 13).
 *
 * 렌더 검사는 서버 컴포넌트를 실제로 불러 react-dom/server 로 그린다 — next-intl/server 만 가짜(문구는 실제 카탈로그),
 * i18n Link 는 단순 <a> 로 바꾼다(여기서 보는 것은 소제목·제목·표 값이다. 링크 경로는 다른 테스트가 본다).
 * AboutPage 가 돌려주는 트리의 CompanyIntro 는 비동기 자식이라 트리에서 꺼내 같은 props 로 직접 불러 그린다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ locale: "ko" as "ko" | "en" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { readFileSync: rf } = await import("node:fs");
  const p = await import("node:path");
  const load = (l: string) => JSON.parse(rf(p.resolve(import.meta.dirname, "..", "messages", `${l}.json`), "utf8"));
  const messages: Record<string, unknown> = { ko: load("ko"), en: load("en") };
  return {
    getLocale: vi.fn(async () => state.locale),
    setRequestLocale: vi.fn(),
    getTranslations: vi.fn(async (opts?: { namespace?: string } | string) => {
      const namespace = typeof opts === "string" ? opts : opts?.namespace;
      return createTranslator({ locale: state.locale, messages: messages[state.locale] as never, namespace: namespace as never });
    }),
  };
});

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ className, children }: { className?: string; children?: ReactNode }) => createElement("a", { className, "data-link": "" }, children),
  };
});

import AboutPage from "@/app/[locale]/(site)/about/page";
import { CompanyIntro } from "@/components/home/CompanyIntro";
import h from "@/components/home/home.module.css";
import { TrustBar } from "@/components/home/TrustBar";
import { PageHeader } from "@/components/pages/PageHeader";
import { COMPANY } from "@/lib/legal/disclosures";

import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);

type Catalog = Record<string, unknown>;
const ko = JSON.parse(read("messages/ko.json")) as Catalog;
const en = JSON.parse(read("messages/en.json")) as Catalog;
const CATALOG = { ko, en } as const;
const at = (cat: Catalog, dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Catalog)[k] : undefined), cat);
const str = (locale: "ko" | "en", dotted: string): string => {
  const v = at(CATALOG[locale], dotted);
  expect(typeof v, `${locale}.${dotted} 가 문자열이 아니다`).toBe("string");
  return v as string;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const count = (html: string, s: string) => html.split(s).length - 1;
const YEAR = String(COMPANY.establishedYear);
const params = (locale: string) => ({ params: Promise.resolve({ locale }) });
/** 소제목 <p> 의 class 속성 — 홈 섹션 헤드와 같은 클래스(home.module.css .eyebrow) */
const EYEBROW_ATTR = `class="${h.eyebrow}"`;

type El = ReactElement<Record<string, unknown>>;
/** 반환된 JSX 트리에서 조건에 맞는 첫 요소 — 비동기 자식(CompanyIntro)은 그리지 않고 props 만 본다. */
function findEl(node: unknown, pred: (el: El) => boolean): El | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findEl(n, pred);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const el = node as El;
  if (pred(el)) return el;
  return findEl(el.props.children, pred);
}
function mustFind(tree: ReactNode, pred: (el: El) => boolean, what: string): El {
  const el = findEl(tree, pred);
  expect(el, `${what} 를 찾지 못했다`).toBeDefined();
  return el!;
}

async function aboutTree(locale: "ko" | "en"): Promise<ReactNode> {
  state.locale = locale;
  return AboutPage(params(locale));
}

test("전제: 소제목 클래스가 실제 문자열이다(빈 값이면 아래 '없다' 검사가 거짓 초록이 된다)", () => {
  expect(typeof h.eyebrow).toBe("string");
  expect(h.eyebrow.length).toBeGreaterThan(0);
  expect(typeof h.title).toBe("string");
  expect(h.title.length).toBeGreaterThan(0);
});

// =============================================================================
// 3. /about — 작은 글씨 소제목 "회사소개" 두 개를 숨긴다 · h1 · h2 는 남긴다
// =============================================================================
describe.each(["ko", "en"] as const)("3. /about (%s) — 소제목 0 · 큰 제목 유지", (locale) => {
  test("페이지 머리 — 브레드크럼 바로 다음이 h1(메뉴 라벨) · 소제목 <p> 0", async () => {
    const header = mustFind(await aboutTree(locale), (el) => el.type === PageHeader, "PageHeader");
    const html = renderToStaticMarkup(header);
    const title = str(locale, "layout.menu.about");
    expect(html).toContain(`<h1 class="${h.title}">${esc(title)}</h1>`);
    expect(html).not.toContain(EYEBROW_ATTR);
    // 소제목이 있던 자리(</nav> 와 <h1 사이)에 아무것도 없다
    expect(html).toMatch(/<\/nav><h1\b/);
    // 브레드크럼 현재 위치는 그대로
    expect(html).toContain(`aria-current="page">${esc(title)}</span>`);
  });

  test("인사말 구역 — 소제목 <p> 0 · 제목(h2) · 본문 · 대표 서명은 그대로", async () => {
    const intro = mustFind(await aboutTree(locale), (el) => el.type === CompanyIntro, "CompanyIntro");
    expect(intro.props.showEyebrow).toBe(false);
    const html = renderToStaticMarkup(await CompanyIntro(intro.props as Parameters<typeof CompanyIntro>[0]));
    expect(html).not.toContain(EYEBROW_ATTR);
    expect(html).not.toContain(`>${esc(str(locale, "home.company.eyebrow"))}</p>`);
    expect(html).toMatch(new RegExp(`<h2 id="company-h"[^>]*>${esc(str(locale, "home.company.lead")).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h2>`));
    expect(html).toContain('aria-labelledby="company-h"');
    expect(html).toContain('data-testid="company-signature"');
    // 덧붙인 두 문장(pages.about.more)도 그대로
    for (const s of at(CATALOG[locale], "pages.about.more") as string[]) expect(html).toContain(esc(s));
  });
});

describe("3. 다른 화면은 그대로 — 선택 prop 을 넘기지 않으면 예전과 같다", () => {
  test.for(["ko", "en"] as const)("홈 #company (%s) — 소제목이 h2 바로 앞에 그대로 있다", async (locale) => {
    state.locale = locale;
    const html = renderToStaticMarkup(await CompanyIntro());
    expect(html).toContain(`<p ${EYEBROW_ATTR}>${esc(str(locale, "home.company.eyebrow"))}</p><h2 id="company-h"`);
    expect(count(html, EYEBROW_ATTR)).toBe(1);
  });

  test("홈 페이지는 CompanyIntro 에 소제목 끄기 prop 을 넘기지 않는다", () => {
    const home = codeOf("app/[locale]/(site)/page.tsx");
    expect(home).toMatch(/<CompanyIntro\s*\/>/);
    expect(home).not.toMatch(/showEyebrow/);
  });

  test("PageHeader 에 소제목을 넘기면 h1 바로 앞에 그대로 그린다(/fleet · /gallery · /notices 경로)", () => {
    const html = renderToStaticMarkup(createHeader({ eyebrow: "Vehicles" }));
    expect(html).toContain(`<p ${EYEBROW_ATTR}>Vehicles</p><h1 class="${h.title}">t</h1>`);
  });

  test("PageHeader 에 빈 소제목을 넘기면 빈 <p> 를 남기지 않는다", () => {
    const html = renderToStaticMarkup(createHeader({ eyebrow: "" }));
    expect(html).not.toContain(EYEBROW_ATTR);
    expect(html).toMatch(/<\/nav><h1\b/);
  });

  test.for([
    ["app/[locale]/(site)/fleet/page.tsx"],
    ["app/[locale]/(site)/gallery/page.tsx"],
    ["app/[locale]/(site)/gallery/[album]/page.tsx"],
    ["app/[locale]/(site)/notices/page.tsx"],
    ["app/[locale]/(site)/notices/[id]/page.tsx"],
  ] as const)("%s — PageHeader 에 소제목을 계속 넘긴다", ([file]) => {
    const call = /<PageHeader\b[\s\S]*?\/>/.exec(codeOf(file));
    expect(call, `${file} 에 PageHeader 없음`).not.toBeNull();
    expect(call![0]).toMatch(/\beyebrow=\{/);
  });

  test("/about 은 PageHeader 에 소제목을 넘기지 않고, 인사말 구역 소제목을 끈다", () => {
    const code = codeOf("app/[locale]/(site)/about/page.tsx");
    const call = /<PageHeader\b[\s\S]*?\/>/.exec(code);
    expect(call).not.toBeNull();
    expect(call![0]).not.toMatch(/\beyebrow=/);
    expect(code).toMatch(/<CompanyIntro\b[^>]*\bshowEyebrow=\{false\}/);
  });
});

function createHeader(extra: { eyebrow?: string }): ReactElement {
  return PageHeader({ navLabel: "n", homeLabel: "Home", current: "c", title: "t", ...extra });
}

// =============================================================================
// 9. /about 회사 정보 표 — 개업 "2013년"(en "2013") · 홈 신뢰 바는 "2013년부터" 그대로
// =============================================================================
describe("9. 개업 연도 — /about 표는 연도만, 홈 신뢰 바는 그대로", () => {
  test("새 키 pages.about.facts.sinceValue — ko '{year}년' · en '{year}' · 라벨 키(since)는 그대로", () => {
    expect(at(ko, "pages.about.facts.sinceValue")).toBe("{year}년");
    expect(at(en, "pages.about.facts.sinceValue")).toBe("{year}");
    expect(at(ko, "pages.about.facts.since")).toBe("개업");
    expect(at(en, "pages.about.facts.since")).toBe("Opened");
  });

  test("홈 신뢰 바 키(home.trust.since)는 손대지 않았다", () => {
    expect(at(ko, "home.trust.since")).toBe("{year}년부터");
    expect(at(en, "home.trust.since")).toBe("Since {year}");
  });

  test.for([
    ["ko", `${YEAR}년`, `${YEAR}년부터`],
    ["en", YEAR, `Since ${YEAR}`],
  ] as const)("/about (%s) 표의 개업 행 값은 '%s' — '%s' 아님", async ([locale, value, old]) => {
    const facts = mustFind(await aboutTree(locale), (el) => el.props.testId === "company-facts", "company-facts");
    const html = renderToStaticMarkup(facts);
    const label = esc(str(locale, "pages.about.facts.since"));
    expect(html).toContain(`<th scope="row">${label}</th><td>${esc(value)}</td>`);
    expect(html).not.toContain(esc(old));
    // ICU 숫자 포맷이 "2,013" 으로 묶지 않는다
    expect(html).not.toContain(YEAR.replace(/^(\d)(\d{3})$/, "$1,$2"));
  });

  test.for([
    ["ko", `${YEAR}년부터`],
    ["en", `Since ${YEAR}`],
  ] as const)("홈 신뢰 바 (%s) 는 '%s' 그대로", async ([locale, since]) => {
    state.locale = locale;
    const html = renderToStaticMarkup(await TrustBar());
    expect(html).toContain(esc(since));
  });

  test("/about 은 개업 값을 자기 카탈로그(facts.sinceValue)에서 만들고 홈 신뢰 바 카탈로그를 빌리지 않는다", () => {
    const code = codeOf("app/[locale]/(site)/about/page.tsx");
    expect(code).toMatch(/since:\s*t\(\s*["']facts\.sinceValue["']\s*,\s*\{\s*year:\s*String\(\s*COMPANY\.establishedYear\s*\)\s*\}\s*\)/);
    expect(code).not.toMatch(/["']home\.trust["']/);
  });
});

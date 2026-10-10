/**
 * 사장님 요청 23건 — 단계 1 T1-1 (2026-10-10, 계획 `.superpowers/sdd/2026-09-06-bestour-implementation-v4/OWNER-FEEDBACK-plan.md`).
 *
 *   7  히어로 3번 슬라이드의 "배차는 대표가 직접 확인합니다." 삭제(보험 문장은 그대로)
 *   10 공항 노선 골드 강조·공항 배지 제거 — 지도(선·핀)·카드·범례·말풍선·히어로 1번 태그·위젯 그룹명
 *      (결정 13: 모두 뺀다. 지도는 KrMap 입구에서 highlight 를 끈다 — DB 의 highlight 열·geometry 모델은 그대로)
 *   12 견적 위젯의 "공항 … 노선입니다" 안내(airNote) 삭제
 *   17 대표 노선 섹션의 설명 문단 삭제 — 헤드는 split 없이(설명 칸이 비면 2열 격자가 왼쪽에 쏠린다)
 *   18 이용 방법 설명에서 "온라인 결제는 없습니다." 만 삭제
 *   23 "베스트투어 강점" 띠(ServiceStrip) 섹션 통째로 삭제
 *
 * 렌더 검사는 서버 컴포넌트를 실제로 불러 react-dom/server 로 그린다 — next-intl/server 만 가짜(문구는 실제 카탈로그),
 * i18n Link 는 단순 <a> 로 바꾼다(여기서 보는 것은 골드·배지·범례·설명이다. 링크 경로는 tests/krmap-interactive.test.ts §7).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

import { KrMap } from "@/components/KrMap/KrMap";
import { toRouteTips } from "@/components/KrMap/route-tips";
import { RouteTooltip } from "@/components/KrMap/RouteTooltip";
import { RoutesSection } from "@/components/home/RoutesSection";
import { SectionHead } from "@/components/home/SectionHead";
import { PLACES, SHOWCASE_ROUTE_SEED, type PlaceCode } from "@/lib/codes";
import { PLACE_POINTS } from "@/lib/map-coords";
import type { PlacePin, ShowcaseRouteView } from "@/lib/types";

import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);

type Catalog = Record<string, unknown>;
const ko = JSON.parse(read("messages/ko.json")) as Catalog;
const en = JSON.parse(read("messages/en.json")) as Catalog;
const at = (cat: Catalog, dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Catalog)[k] : undefined), cat);

const MARK_KO = "공항 픽업·샌딩 (송영 전문)";
const MARK_EN = "Airport Pickup & Drop-off (Transfer Specialists)";

// ── 픽스처: 스펙 §13.2 16노선 — 시드 그대로(ICN→SEL 이 highlight=true) ───────────
const placeByCode = new Map(PLACES.map((p) => [p.code as string, p]));
function pinOf(code: PlaceCode): PlacePin {
  const p = placeByCode.get(code)!;
  const pt = PLACE_POINTS[code];
  return { code: p.code, nameKo: p.nameKo, nameEn: p.nameEn, kind: p.kind, svgX: pt.x, svgY: pt.y };
}
const ROUTES: ShowcaseRouteView[] = SHOWCASE_ROUTE_SEED.map((s, i) => ({
  id: i + 1,
  originCode: s.originCode,
  destinationCode: s.destinationCode,
  priceFrom: s.priceFrom,
  highlight: s.highlight,
  sort: s.sort,
  active: true,
  origin: pinOf(s.originCode),
  destination: pinOf(s.destinationCode),
}));

async function renderKrMap(locale: "ko" | "en", routes: readonly ShowcaseRouteView[] = ROUTES): Promise<string> {
  state.locale = locale;
  return renderToStaticMarkup(await KrMap({ routes }));
}

/** 반환된 JSX 트리에서 type 이 같은 첫 요소 — 비동기 자식(KrMap)은 그리지 않고 props 만 본다. */
function findElement(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findElement(n, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === type) return el;
  return findElement(el.props.children as ReactNode, type);
}

/** 카드 <li data-card="n"> 의 class 속성 */
function cardClass(html: string, id: number): string {
  const m = new RegExp(`<li[^>]*class="([^"]*)"[^>]*data-card="${id}"`).exec(html);
  expect(m, `카드 ${id} 없음`).not.toBeNull();
  return m![1];
}

/** 핀 <g data-pin="CODE"> 안의 반지름 두 개 [halo, dot] */
function pinRadii(html: string, code: string): string[] {
  const m = new RegExp(`<g[^>]*data-pin="${code}"[^>]*>([\\s\\S]*?)</g>`).exec(html);
  expect(m, `핀 ${code} 없음`).not.toBeNull();
  return [...m![1].matchAll(/\br="([\d.]+)"/g)].map((x) => x[1]);
}

// =============================================================================
// 10. 지도 — 골드 선·골드 핀·골드 카드·범례·공항 배지가 없다
// =============================================================================
describe("10. 대표 노선 지도 — 공항 노선도 다른 노선과 같은 모양", () => {
  test("전제: 픽스처에 공항 강조 노선이 실제로 있다(없으면 아래 검사가 거짓 초록이 된다)", () => {
    expect(ROUTES.filter((r) => r.highlight).map((r) => `${r.originCode}-${r.destinationCode}`)).toEqual(["ICN-SEL"]);
    expect(ROUTES[0].origin.kind).toBe("airport");
  });

  test.for(["ko", "en"] as const)("%s — 선·핀에 accent 톤 0 · 카드 강조 표시 0 · 범례 0 · 공항 배지 문구 0", async (locale) => {
    const html = await renderKrMap(locale);
    // 톤 속성은 남아 있고(검사 대상이 실제로 있다) 전부 brand 다
    expect((html.match(/data-tone="brand"/g) ?? []).length).toBeGreaterThanOrEqual(16);
    expect(html).not.toContain('data-tone="accent"');
    expect(html).not.toContain("data-highlight");
    expect(html).not.toContain("<figcaption");
    expect(html).not.toContain(locale === "ko" ? MARK_KO : MARK_EN);
    expect(html).not.toMatch(/<em[\s>]/);
  });

  test("인천공항 핀은 일반 핀과 같은 크기(12/6) · 서울 허브는 그대로(15/7.5)", async () => {
    const html = await renderKrMap("ko");
    expect(pinRadii(html, "ICN")).toEqual(pinRadii(html, "BSN"));
    expect(pinRadii(html, "ICN")).toEqual(["12", "6"]);
    expect(pinRadii(html, "SEL")).toEqual(["15", "7.5"]);
  });

  test("1번 카드(인천공항 → 서울)의 class 가 2번 카드와 같다 — 골드 테두리 카드가 없다", async () => {
    const html = await renderKrMap("ko");
    expect(cardClass(html, 1)).toBe(cardClass(html, 2));
  });

  test("말풍선 — 공항 노선에도 배지(<em>)가 없다 · 노선 데이터에 airport 필드가 없다", () => {
    const tips = toRouteTips(ROUTES, "ko");
    expect(tips[0].from).toBe(ROUTES[0].origin.nameKo);
    for (const t of tips) expect(Object.keys(t)).not.toContain("airport");
    const html = renderToStaticMarkup(RouteTooltip({ tip: tips[0] }));
    expect(html).toContain(`${tips[0].from} → ${tips[0].to}`);
    expect(html).not.toMatch(/<em[\s>]/);
  });

  test("KrMap.module.css — 골드(--accent-decorative*) 참조 0 · 강조·배지·범례 규칙 0", () => {
    const css = stripComments(read("components/KrMap/KrMap.module.css"), "KrMap.module.css");
    expect(css).not.toMatch(/--accent-decorative/);
    for (const cls of ["routeAccent", "pinAccent", "cardAccent", "cardBadge", "caption", "swatch"]) {
      expect(new RegExp(`\\.${cls}(?![\\w-])`).test(css), cls).toBe(false);
    }
  });

  test("components/KrMap/*.tsx 가 쓰는 CSS 클래스(s.X)는 전부 KrMap.module.css 에 정의돼 있다 — 지운 규칙을 가리키는 코드가 없다", () => {
    const css = stripComments(read("components/KrMap/KrMap.module.css"), "KrMap.module.css");
    const defined = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
    const dir = path.join(ROOT, "components", "KrMap");
    const tsx = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
    expect(tsx.length).toBeGreaterThanOrEqual(5);
    for (const f of tsx) {
      const used = [...new Set([...codeOf(`components/KrMap/${f}`).matchAll(/\bs\.(\w+)/g)].map((m) => m[1]))];
      expect(used.filter((c) => !defined.has(c)), f).toEqual([]);
    }
  });

  test.for(["ko", "en"] as const)("%s 카탈로그 — home.krmap 에 legendAirport · airport 키가 없다", (locale) => {
    const krmap = at(locale === "ko" ? ko : en, "home.krmap") as Catalog;
    expect(krmap).toBeTruthy();
    expect(krmap).not.toHaveProperty("legendAirport");
    expect(krmap).not.toHaveProperty("airport");
  });
});

// =============================================================================
// 10. 히어로 1번 태그 · 위젯 그룹명
// =============================================================================
describe("10. 히어로 1번 태그 · 위젯 공항 그룹명", () => {
  test("히어로 태그는 세 슬라이드 모두 같은 테두리 모양(tagLine) — 공항 슬라이드만 골드 배경이던 분기가 없다", () => {
    const hero = codeOf("components/home/Hero.tsx");
    expect(hero).toMatch(/className=\{s\.tagLine\}/);
    expect(/\bs\.tag\b/.test(hero)).toBe(false);
    expect(/key\s*===\s*["']airport["']/.test(hero)).toBe(false);
    const css = stripComments(read("components/home/Hero.module.css"), "Hero.module.css");
    expect(/\.tag(?![\w-])/.test(css), "Hero.module.css 에 .tag 규칙이 남아 있다").toBe(false);
    expect(css).toMatch(/\.tagLine\s*\{/);
  });

  // 독립 리뷰 P1-1: 공항 슬라이드만 앞의 두 칩(인천공항 픽업·샌딩)을 골드 테두리(.chipOn)로 켜 두고 있었다 — 공항 전용 강조다.
  test("히어로 칩 — 어느 슬라이드도 골드 칩(chipsOn)을 켜지 않는다(공항 슬라이드 포함 · ko·en)", () => {
    for (const cat of [ko, en]) {
      for (const key of ["airport", "nationwide", "trust"]) {
        expect(Number(at(cat, `home.hero.slides.${key}.chipsOn`) ?? 0), key).toBe(0);
      }
    }
  });

  test("위젯 공항 그룹명 — ko '공항' · en 'Airport' (별표·'전문' 없음)", () => {
    expect(at(ko, "home.hero.widget.groupAirport")).toBe("공항");
    expect(at(en, "home.hero.widget.groupAirport")).toBe("Airport");
  });
});

// =============================================================================
// 12. 견적 위젯 — 공항 안내 줄(airNote) 없음
// =============================================================================
describe("12. 견적 위젯 — '공항 … 노선입니다' 안내가 없다", () => {
  test.for(["ko", "en"] as const)("%s 카탈로그 — home.hero.widget.airNote 키가 없다", (locale) => {
    const widget = at(locale === "ko" ? ko : en, "home.hero.widget") as Catalog;
    expect(widget).toBeTruthy();
    expect(widget).not.toHaveProperty("airNote");
  });

  test("Hero 는 airNote 를 내리지 않고, QuoteWidget 에는 안내 블록·공항 판정이 없다 · CSS 규칙도 없다", () => {
    expect(codeOf("components/home/Hero.tsx")).not.toMatch(/airNote/);
    const widget = codeOf("components/home/QuoteWidget.tsx");
    for (const sym of ["airNote", "quote-air", "quoteAir", "isAirport", "AIRPORT_CODE"]) expect(widget.includes(sym), sym).toBe(false);
    expect(/\.quoteAir(?![\w-])/.test(stripComments(read("components/home/Hero.module.css"), "Hero.module.css"))).toBe(false);
  });
});

// =============================================================================
// 17. 대표 노선 — 설명 문단 없음 · split 아님
// =============================================================================
describe("17. 대표 노선 섹션 헤드 — 설명 문단 없이 한 열", () => {
  test.for(["ko", "en"] as const)("%s 카탈로그 — home.routes 는 eyebrow · title 뿐", (locale) => {
    expect(Object.keys(at(locale === "ko" ? ko : en, "home.routes") as Catalog).sort()).toEqual(["eyebrow", "title"]);
  });

  test("RoutesSection 이 SectionHead 에 desc 를 넘기지 않고 split={false} 를 넘긴다 · 그 헤드에 설명 문단·2열 클래스가 없다", async () => {
    state.locale = "ko";
    const tree = await RoutesSection({ routes: ROUTES });
    const head = findElement(tree, SectionHead);
    expect(head, "SectionHead 가 없다").not.toBeNull();
    expect(head!.props.desc).toBeUndefined();
    expect(head!.props.split).toBe(false);
    const html = renderToStaticMarkup(head!);
    expect(html).toContain('id="routes-h"');
    expect(html).not.toMatch(/headSplit/);
    expect(html).not.toMatch(/class="[^"]*_desc_/);
  });
});

// =============================================================================
// 18. 이용 방법 설명 — "온라인 결제는 없습니다." 만 뺐다
// =============================================================================
describe("18. 이용 방법 설명", () => {
  test("ko — 새 문안 그대로", () => {
    expect(at(ko, "home.how.desc")).toBe("복잡한 절차는 저희가 대신합니다. 고객님은 출발지·도착지와 날짜, 인원만 알려 주시면 됩니다.");
  });
  test("en — 같은 뜻(마지막 문장만 뺐다)", () => {
    expect(at(en, "home.how.desc")).toBe(
      "We take care of the complicated parts. All you need to do is tell us where you are going, when, and how many people.",
    );
  });
});

// =============================================================================
// 23. "베스트투어 강점" 띠 — 섹션째 없음
// =============================================================================
describe("23. 강점 띠(ServiceStrip) 삭제", () => {
  test("컴포넌트 파일이 없고 홈 페이지가 import·렌더하지 않는다", () => {
    expect(existsSync(path.join(ROOT, "components/home/ServiceStrip.tsx"))).toBe(false);
    expect(codeOf("app/[locale]/(site)/page.tsx")).not.toMatch(/ServiceStrip/);
  });

  test.for(["ko", "en"] as const)("%s 카탈로그 — home.services 가 없다", (locale) => {
    expect(at(locale === "ko" ? ko : en, "home")).toBeTruthy();
    expect(at(locale === "ko" ? ko : en, "home.services")).toBeUndefined();
  });

  test("띠 전용 CSS(.services · .serviceItem)와 data-section=\"services\" 가 components/home 어디에도 없다", () => {
    const css = stripComments(read("components/home/Sections.module.css"), "Sections.module.css");
    expect(/\.(services|serviceItem)(?![\w-])/.test(css)).toBe(false);
    const dir = path.join(ROOT, "components", "home");
    const files = readdirSync(dir).filter((f) => statSync(path.join(dir, f)).isFile());
    for (const f of files) expect(read(`components/home/${f}`).includes('data-section="services"'), f).toBe(false);
  });
});

// =============================================================================
// 7. 히어로 3번 슬라이드 — 배차 문장만 뺐다
// =============================================================================
describe("7. 히어로 3번 슬라이드 본문", () => {
  test("ko — 보험 문장만 남는다", () => {
    expect(at(ko, "home.hero.slides.trust.body")).toBe(
      "<b>정식 등록 알선업체</b>로 차량 보험에 가입되어 있으며, 원하시는 경우 보험 서류를 받아 보실 수 있습니다.",
    );
  });
  test("en — 같은 뜻", () => {
    expect(at(en, "home.hero.slides.trust.body")).toBe(
      "We are a <b>registered charter bus booking agency</b>. Vehicles are insured, and you can request the insurance documents if you wish.",
    );
  });
  test("홈 카탈로그에 '직접 확인'(ko) · 'personally'(en) 이 없다", () => {
    expect(JSON.stringify(ko.home).includes("직접 확인"), "ko home 에 '직접 확인'").toBe(false);
    expect(/personally/i.test(JSON.stringify(en.home)), "en home 에 'personally'").toBe(false);
  });
});

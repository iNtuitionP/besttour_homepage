/**
 * P2-9 — 대표 노선: 카드는 지도 높이만큼, 나머지는 지도 선 hover/탭 말풍선으로.
 *
 * vitest 는 node 환경이다(DOM 패키지 없음). 그래서
 *   (1) 측정·배치·상태 전이는 순수 함수로 빼서 단위 테스트하고,
 *   (2) 컴포넌트는 react-dom/server 의 renderToStaticMarkup 으로 **SSR 결과**(= 하이드레이션 전 첫 화면)를 검사한다.
 * 실제 측정(ResizeObserver)·hover·탭은 브라우저 실측(보고서 §5)으로 확인한다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { PLACES, SHOWCASE_ROUTE_SEED, type PlaceCode } from "@/lib/codes";
import { PLACE_POINTS } from "@/lib/map-coords";
import type { PlacePin, ShowcaseRouteView } from "@/lib/types";

import { explorerReducer, INITIAL_EXPLORER_STATE, showsTip, type ExplorerState } from "@/components/KrMap/explorer-state";
import { DEFAULT_VISIBLE_CARDS, fitCardCount, tipPlacement } from "@/components/KrMap/fit";
import { routeCurve, routeMidpoint } from "@/components/KrMap/geometry";
import { toRouteTips, type RouteTip } from "@/components/KrMap/route-tips";
import { RouteExplorer, type RouteExplorerCopy } from "@/components/KrMap/RouteExplorer";
import { RouteTooltip } from "@/components/KrMap/RouteTooltip";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

// ── 픽스처: 스펙 §13.2 16노선 (tests/krmap.test.ts 와 같은 조립) ─────────────
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

const COPY: RouteExplorerCopy = {
  listLabel: "LIST",
  airport: "AIRPORT",
  empty: "EMPTY",
  showAll: "SHOW-ALL",
  showLess: "SHOW-LESS",
  moreHints: Array.from({ length: 17 }, (_, n) => (n === 0 ? "" : `MORE-${n}`)),
};

function renderExplorer(tips: RouteTip[], copy: RouteExplorerCopy = COPY, collapse?: boolean): string {
  return renderToStaticMarkup(
    createElement(RouteExplorer, {
      map: createElement("svg", { "data-testid": "map-slot" }),
      legend: null,
      cta: createElement("a", { href: "/#quote", "data-testid": "cta-slot" }, "CTA"),
      tips,
      copy,
      ...(collapse === undefined ? {} : { collapse }),
    }),
  );
}

function attrValues(html: string, re: RegExp): string[] {
  return [...html.matchAll(re)].map((m) => m[1]);
}

// =============================================================================
// 1. 측정 — 카드 높이 배열 · 간격 · 기준 높이 → 완전히 보이는 카드 수
// =============================================================================
describe("fitCardCount — 잘린 카드 없이 기준 높이 안에 들어가는 카드 수", () => {
  test("딱 맞으면 전부 (60+10+60+10+60 = 200)", () => {
    expect(fitCardCount({ heights: [60, 60, 60], gap: 10, budget: 200 })).toBe(3);
  });
  test("1px 모자라면 마지막 카드는 뺀다 (잘린 카드 금지)", () => {
    expect(fitCardCount({ heights: [60, 60, 60], gap: 10, budget: 199 })).toBe(2);
  });
  test("높이가 제각각이어도 앞에서부터 누적한다 (순서 유지 — 건너뛰기 없음)", () => {
    // 60 + 10 + 120 = 190 ≤ 200, 다음 60 을 더하면 260 → 2. 세 번째가 작아도 건너뛰어 넣지 않는다.
    expect(fitCardCount({ heights: [60, 120, 20, 20], gap: 10, budget: 200 })).toBe(2);
  });
  test("기준 높이가 첫 카드보다 작아도 최소 1장은 보인다(min 기본 1)", () => {
    expect(fitCardCount({ heights: [60, 60], gap: 10, budget: 0 })).toBe(1);
    expect(fitCardCount({ heights: [60, 60], gap: 10, budget: 30, min: 0 })).toBe(0);
  });
  test("카드가 없으면 0", () => {
    expect(fitCardCount({ heights: [], gap: 10, budget: 500 })).toBe(0);
  });
  test("넉넉하면 카드 수를 넘지 않는다", () => {
    expect(fitCardCount({ heights: [60, 60], gap: 10, budget: 9999 })).toBe(2);
  });
  test("측정 실패(NaN·음수)는 0 으로 본다 — 무한대로 늘지 않는다", () => {
    expect(fitCardCount({ heights: [60, 60, 60], gap: Number.NaN, budget: 125 })).toBe(2);
    expect(fitCardCount({ heights: [60, 60], gap: 10, budget: Number.NaN })).toBe(1);
  });
  test("SSR 기본값은 6장 — 하이드레이션 전 레이아웃 튐을 줄인다", () => {
    expect(DEFAULT_VISIBLE_CARDS).toBe(6);
  });
});

// =============================================================================
// 2. 말풍선 배치 — 스테이지 밖으로 잘리지 않게 좌우·상하 뒤집기
// =============================================================================
describe("tipPlacement", () => {
  test("가운데는 가운데 정렬 · 위쪽", () => {
    expect(tipPlacement({ xPct: 50, yPct: 60 })).toEqual({ align: "center", side: "above" });
  });
  test("왼쪽 가장자리는 오른쪽으로 펼친다(start)", () => {
    expect(tipPlacement({ xPct: 10, yPct: 60 }).align).toBe("start");
  });
  test("오른쪽 가장자리는 왼쪽으로 펼친다(end)", () => {
    expect(tipPlacement({ xPct: 90, yPct: 60 }).align).toBe("end");
  });
  test("위쪽 가장자리는 아래로 뒤집는다(below)", () => {
    expect(tipPlacement({ xPct: 50, yPct: 10 }).side).toBe("below");
  });
});

// =============================================================================
// 3. 곡선 중점 — 말풍선 기준점. routeCurve 와 같은 제어점을 쓴다
// =============================================================================
describe("routeMidpoint — 2차 베지어 t=0.5", () => {
  test("(0,0)→(100,0): 제어점 (50,-22) → 중점 (50,-11)", () => {
    const a = { svgX: 0, svgY: 0 };
    const b = { svgX: 100, svgY: 0 };
    expect(routeCurve(a, b)).toBe("M0,0 Q50,-22 100,0");
    expect(routeMidpoint(a, b)).toEqual({ svgX: 50, svgY: -11 });
  });
  test("같은 점이면 그 점", () => {
    expect(routeMidpoint({ svgX: 10, svgY: 20 }, { svgX: 10, svgY: 20 })).toEqual({ svgX: 10, svgY: 20 });
  });
});

// =============================================================================
// 4. 말풍선 문구 — 카드와 같은 포맷 · 라벨 숨김 폴백 · 공항 배지 · 로케일 지명
// =============================================================================
describe("toRouteTips — 서버가 카드·말풍선에 같이 내려 주는 노선 문구", () => {
  test("16노선 전부, 순서 그대로(sort_order)", () => {
    const tips = toRouteTips(ROUTES, "ko");
    expect(tips.map((t) => t.id)).toEqual(ROUTES.map((r) => r.id));
  });
  test("ko: name_ko · '40만원' · 인천공항 노선만 airport", () => {
    const [first, second] = toRouteTips(ROUTES, "ko");
    expect(first).toMatchObject({ from: ROUTES[0].origin.nameKo, to: ROUTES[0].destination.nameKo, amount: "40만원", airport: true });
    expect(second).toMatchObject({ airport: false });
    expect(toRouteTips(ROUTES, "ko").filter((t) => t.airport)).toHaveLength(1);
  });
  test("en: name_en · 'KRW 400,000'", () => {
    const [first] = toRouteTips(ROUTES, "en");
    expect(first.from).toBe(ROUTES[0].origin.nameEn);
    expect(first.to).toBe(ROUTES[0].destination.nameEn);
    expect(first.amount).toBe("KRW 400,000");
  });
  test("가격 null → 빈 문자열(라벨 숨김 폴백)", () => {
    const tips = toRouteTips([{ ...ROUTES[1], priceFrom: null }], "ko");
    expect(tips[0].amount).toBe("");
  });
  test("곡선 d 는 지도(MapSvg)와 같은 routeCurve — 히트 영역이 선과 겹친다", () => {
    for (const t of toRouteTips(ROUTES, "ko")) {
      const r = ROUTES.find((x) => x.id === t.id)!;
      expect(t.d).toBe(routeCurve(r.origin, r.destination));
    }
  });
  test("말풍선 기준점은 백분율 문자열, 배치는 tipPlacement 결과", () => {
    for (const t of toRouteTips(ROUTES, "ko")) {
      expect(t.anchor.left).toMatch(/^-?\d+(\.\d+)?%$/);
      expect(t.anchor.top).toMatch(/^-?\d+(\.\d+)?%$/);
      expect(["start", "center", "end"]).toContain(t.place.align);
      expect(["above", "below"]).toContain(t.place.side);
    }
  });
});

describe("RouteTooltip — 렌더", () => {
  const tipsKo = toRouteTips(ROUTES, "ko");
  test("출발 → 도착 · 가격 줄 · 공항 배지", () => {
    const html = renderToStaticMarkup(createElement(RouteTooltip, { tip: tipsKo[0], airportLabel: "AIRPORT" }));
    expect(html).toContain(`${tipsKo[0].from} → ${tipsKo[0].to}`);
    expect(html).toContain("data-tip-amount");
    expect(html).toContain("40만원");
    expect(html).toContain("AIRPORT");
    expect(html).toContain('aria-hidden="true"');
  });
  test("가격 없음 → 가격 줄 자체가 없다", () => {
    const [tip] = toRouteTips([{ ...ROUTES[1], priceFrom: null }], "ko");
    const html = renderToStaticMarkup(createElement(RouteTooltip, { tip, airportLabel: "AIRPORT" }));
    expect(html).not.toContain("data-tip-amount");
    expect(html).not.toContain("만원");
  });
  test("공항 노선이 아니면 배지 없음", () => {
    const html = renderToStaticMarkup(createElement(RouteTooltip, { tip: tipsKo[1], airportLabel: "AIRPORT" }));
    expect(html).not.toContain("AIRPORT");
  });
  test("en → name_en", () => {
    const [tip] = toRouteTips(ROUTES, "en");
    const html = renderToStaticMarkup(createElement(RouteTooltip, { tip, airportLabel: "AIRPORT" }));
    expect(html).toContain(`${ROUTES[0].origin.nameEn} → ${ROUTES[0].destination.nameEn}`);
    expect(html).toContain("KRW 400,000");
  });
});

// =============================================================================
// 5. 상태 전이 — 마우스·터치·카드 연동·토글
// =============================================================================
describe("explorerReducer", () => {
  const s0 = INITIAL_EXPLORER_STATE;
  test("초기: 접힘 · 활성 없음", () => {
    expect(s0).toEqual({ expanded: false, active: null });
  });
  test("토글은 expanded 를 뒤집는다 (aria-expanded 의 원천)", () => {
    const s1 = explorerReducer(s0, { type: "toggle" });
    expect(s1.expanded).toBe(true);
    expect(explorerReducer(s1, { type: "toggle" }).expanded).toBe(false);
  });
  test("마우스: 선에 올리면 말풍선, 벗어나면 사라짐", () => {
    const s1 = explorerReducer(s0, { type: "lineEnter", id: 3 });
    expect(s1.active).toEqual({ id: 3, source: "hover" });
    expect(showsTip(s1)).toBe(true);
    expect(explorerReducer(s1, { type: "lineLeave", id: 3 }).active).toBeNull();
  });
  test("터치: 탭하면 뜨고, 다른 선을 탭하면 바뀌고, 바깥을 탭하면 닫힌다", () => {
    const s1 = explorerReducer(s0, { type: "lineTap", id: 3 });
    expect(s1.active).toEqual({ id: 3, source: "tap" });
    const s2 = explorerReducer(s1, { type: "lineTap", id: 5 });
    expect(s2.active).toEqual({ id: 5, source: "tap" });
    expect(explorerReducer(s2, { type: "dismiss" }).active).toBeNull();
  });
  test("같은 선을 다시 탭하면 닫힌다", () => {
    const s1 = explorerReducer(s0, { type: "lineTap", id: 3 });
    expect(explorerReducer(s1, { type: "lineTap", id: 3 }).active).toBeNull();
  });
  test("탭으로 연 말풍선은 마우스 leave 로 닫히지 않는다", () => {
    const s1 = explorerReducer(s0, { type: "lineTap", id: 3 });
    expect(explorerReducer(s1, { type: "lineLeave", id: 3 }).active).toEqual({ id: 3, source: "tap" });
  });
  test("카드 hover → 선 강조(말풍선은 없음), 벗어나면 해제", () => {
    const s1 = explorerReducer(s0, { type: "cardEnter", id: 7 });
    expect(s1.active).toEqual({ id: 7, source: "card" });
    expect(showsTip(s1)).toBe(false);
    expect(explorerReducer(s1, { type: "cardLeave", id: 7 }).active).toBeNull();
  });
  test("다른 원천의 leave 는 활성을 지우지 않는다", () => {
    const s1: ExplorerState = { expanded: false, active: { id: 7, source: "tap" } };
    expect(explorerReducer(s1, { type: "cardLeave", id: 7 }).active).toEqual({ id: 7, source: "tap" });
    expect(explorerReducer(s1, { type: "lineLeave", id: 8 }).active).toEqual({ id: 7, source: "tap" });
  });
});

// =============================================================================
// 6. RouteExplorer SSR — 히트 영역 16 · 카드 짝 · 가려진 카드도 DOM · 토글
// =============================================================================
describe("RouteExplorer — 첫 화면(SSR)", () => {
  const tips = toRouteTips(ROUTES, "ko");
  const html = renderExplorer(tips);

  test("16개 노선 전부에 히트 영역이 있고 data-route 가 카드(data-card)와 1:1 로 짝지어진다", () => {
    const hitIds = attrValues(html, /<path[^>]*data-hit=""[^>]*data-route="(\d+)"/g);
    const cardIds = attrValues(html, /<li[^>]*data-card="(\d+)"/g);
    expect(hitIds).toHaveLength(16);
    expect(new Set(hitIds)).toEqual(new Set(cardIds));
    expect(cardIds).toEqual(ROUTES.map((r) => String(r.id))); // 카드 순서는 sort_order 그대로
  });

  test("히트 영역은 선과 같은 d 다", () => {
    for (const t of tips) {
      expect(html).toContain(`d="${t.d}"`);
    }
  });

  test("카드 16장 모두 DOM 에 있고, 앞 6장만 보인다 — 나머지 10장은 visually-hidden (hidden 속성·display:none 아님)", () => {
    const cards = [...html.matchAll(/<li([^>]*)data-card="(\d+)"([^>]*)>/g)].map((m) => m[1] + m[3]);
    expect(cards).toHaveLength(16);
    const offscreen = cards.filter((a) => /data-offscreen=""/.test(a));
    expect(offscreen).toHaveLength(16 - DEFAULT_VISIBLE_CARDS);
    for (const a of cards) {
      expect(/\bhidden(=|\s|$)/.test(a.replace(/data-[a-z-]+=""/g, ""))).toBe(false);
      expect(/aria-hidden/.test(a)).toBe(false);
      expect(/display\s*:\s*none/.test(a)).toBe(false);
    }
    // 가려진 카드의 문구도 그대로 있다(스크린리더가 읽는다)
    expect(html).toContain(`${tips[15].from} → ${tips[15].to}`);
  });

  test("가려진 카드 CSS 는 clip 방식이다 — display:none·visibility:hidden 이 아니다", () => {
    const css = stripComments(read("components/KrMap/KrMap.module.css"), "KrMap.module.css");
    const m = /\.cardOffscreen\s*\{([^}]*)\}/.exec(css);
    expect(m, ".cardOffscreen 규칙이 없다").not.toBeNull();
    expect(m![1]).toMatch(/clip-path\s*:\s*inset\(50%\)/);
    expect(m![1]).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);
  });

  test("안내 줄: 가려진 개수(10)", () => {
    expect(html).toContain("MORE-10");
  });

  test("'노선 전체 보기' 토글: button · aria-expanded=false · aria-controls 가 목록 id", () => {
    const m = /<button([^>]*)>([\s\S]*?)<\/button>/.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('type="button"');
    expect(m![1]).toContain('aria-expanded="false"');
    const controls = /aria-controls="([^"]+)"/.exec(m![1])![1];
    const ol = /<ol([^>]*)>/.exec(html);
    expect(ol, "<ol> 없음").not.toBeNull();
    expect(ol![1]).toContain(`id="${controls}"`);
    expect(m![2]).toContain("SHOW-ALL");
  });

  test("말풍선은 첫 화면에 없다(활성 없음)", () => {
    expect(html).not.toContain("data-tip-amount");
    expect(html).not.toContain('data-testid="krmap-tip"');
  });

  test("지도·CTA 는 서버가 넘긴 슬롯 그대로", () => {
    expect(html).toContain('data-testid="map-slot"');
    expect(html).toContain('data-testid="cta-slot"');
  });

  test("노선이 6개 이하면 안내 줄·토글이 없다", () => {
    const few = renderExplorer(tips.slice(0, 4));
    expect(few).not.toContain("MORE-");
    expect(few).not.toContain("<button");
    expect(few).not.toContain("data-offscreen");
  });

  test("노선 0개 → 빈 상태 문구 · 히트 영역 0", () => {
    const empty = renderExplorer([]);
    expect(empty).toContain("EMPTY");
    expect(empty).not.toContain("data-hit");
  });
});

// =============================================================================
// 6-b. collapse={false} — /fares 는 카드 16장 전부 펼침 (컨트롤러 결정 2026-09-27)
// =============================================================================
describe("RouteExplorer collapse={false} (/fares)", () => {
  const tips = toRouteTips(ROUTES, "ko");
  const html = renderExplorer(tips, COPY, false);

  test("카드 16장 전부 보인다 — data-offscreen 0", () => {
    expect(attrValues(html, /<li[^>]*data-card="(\d+)"/g)).toHaveLength(16);
    expect(html).not.toContain("data-offscreen");
  });
  test("안내 줄·토글 없음", () => {
    expect(html).not.toContain("MORE-");
    expect(html).not.toContain("<button");
    expect(html).not.toContain('data-testid="krmap-more"');
  });
  test("지도 선 히트 영역 16 은 그대로 (말풍선 유지)", () => {
    expect(attrValues(html, /<path[^>]*data-hit=""[^>]*data-route="(\d+)"/g)).toHaveLength(16);
  });
  test("기본값(prop 생략)은 접힘 — 홈", () => {
    expect(renderExplorer(tips)).toContain("data-offscreen");
  });
  test("KrMap 은 collapse 를 RouteExplorer 로 넘기고 기본값은 true", () => {
    const krMap = read("components/KrMap/KrMap.tsx");
    expect(krMap).toMatch(/collapse\?\s*:\s*boolean/);
    expect(krMap).toMatch(/collapse\s*=\s*true/);
    expect(krMap).toMatch(/<RouteExplorer[\s\S]*collapse=\{collapse\}/);
  });
  test("/fares 는 collapse={false} · 홈 RoutesSection 은 넘기지 않는다(기본 접힘)", () => {
    expect(read("app/[locale]/(site)/fares/page.tsx")).toMatch(/<KrMap\s+routes=\{routes\}[^>]*collapse=\{false\}/);
    expect(read("components/home/RoutesSection.tsx")).not.toMatch(/collapse=/);
  });
});

// =============================================================================
// 7. 서버 조립 — CTA 는 홈 히어로 앵커, 문구 키 ko·en, 경계
// =============================================================================
describe("KrMap 서버 조립", () => {
  const krMap = read("components/KrMap/KrMap.tsx");

  test("CTA 는 i18n Link 로 홈 히어로 앵커(#quote)를 가리킨다 — /quote 아님", () => {
    expect(krMap).toMatch(/<Link\s+href=\{\{\s*pathname:\s*"\/",\s*hash:\s*"quote"\s*\}\}/);
    for (const f of ["KrMap.tsx", "RouteCards.tsx", "RouteExplorer.tsx"]) {
      expect(read(`components/KrMap/${f}`).includes('"/quote"'), f).toBe(false);
    }
  });

  // 문자열 "/#quote" 는 en 에서 "/en/#quote"(슬래시가 끼어든다)로 풀린다(실측). 그래서 UrlObject 로 넘긴다 —
  // pathname 만 로케일화되고 hash 는 그대로 붙어 ko "/#quote" · en "/en#quote" 가 된다(렌더 결과는 브라우저 실측, 보고서 §5).
  test("그 pathname 은 ko '/' · en '/en' 으로 풀린다 (next-intl getPathname — as-needed 프리픽스)", async () => {
    const { getPathname } = await import("@/i18n/navigation");
    expect(getPathname({ href: { pathname: "/" }, locale: "ko" })).toBe("/");
    expect(getPathname({ href: { pathname: "/" }, locale: "en" })).toBe("/en");
    expect(getPathname({ href: "/#quote", locale: "en" })).toBe("/en/#quote"); // 문자열을 쓰지 않는 이유
  });

  test("'use client' 는 RouteExplorer.tsx 하나 — KrMap·MapSvg 는 서버", () => {
    expect(read("components/KrMap/RouteExplorer.tsx").trimStart()).toMatch(/^["']use client["']/);
    for (const f of ["KrMap.tsx", "MapSvg.tsx", "RouteCards.tsx", "RouteTooltip.tsx"]) {
      expect(/^\s*["']use client["']/m.test(read(`components/KrMap/${f}`)), f).toBe(false);
    }
  });

  test("클라이언트 쪽 파일에 한글 리터럴 0 — 문구는 서버가 props 로 내린다", () => {
    for (const f of ["RouteExplorer.tsx", "RouteCards.tsx", "RouteTooltip.tsx", "explorer-state.ts", "fit.ts"]) {
      const code = stripComments(read(`components/KrMap/${f}`), f);
      expect(/[가-힣]/.test(code), f).toBe(false);
    }
  });

  test("클라이언트 파일은 가격 포맷을 직접 부르지 않는다 — 서버가 만든 문자열(카드와 같은 값)만 쓴다", () => {
    for (const f of ["RouteExplorer.tsx", "RouteCards.tsx", "RouteTooltip.tsx"]) {
      expect(/formatPriceKrw/.test(read(`components/KrMap/${f}`)), f).toBe(false);
    }
    expect(read("components/KrMap/route-tips.ts")).toMatch(/formatPriceKrwEn\(.*\)\s*:\s*formatPriceKrw\(/);
  });

  test("messages home.krmap 새 키가 ko·en 모두 있다 (moreHint 는 {count})", () => {
    for (const loc of ["ko", "en"]) {
      const m = JSON.parse(read(`messages/${loc}.json`)) as { home: { krmap: Record<string, string> } };
      for (const k of ["moreHint", "showAll", "showLess"]) {
        expect(typeof m.home.krmap[k], `${loc} home.krmap.${k}`).toBe("string");
      }
      expect(m.home.krmap.moreHint).toContain("{count}");
    }
  });

  test("SVG desc 가 가려진 카드까지 목록에 있다는 사실과 맞다 — '아래 목록' 대신 '이어지는 목록에 전부'", () => {
    const ko = JSON.parse(read("messages/ko.json")) as { home: { krmap: Record<string, string> } };
    const en = JSON.parse(read("messages/en.json")) as { home: { krmap: Record<string, string> } };
    expect(ko.home.krmap.desc).toContain("이어지는 목록에 전부");
    expect(en.home.krmap.desc).toMatch(/every route is described in full in the list that follows/i);
  });
});

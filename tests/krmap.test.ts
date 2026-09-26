/**
 * P2-2 — KrMap 컴포넌트 계약 테스트 (SVG 레이어 + 카드 리스트, 지도 라벨은 보류).
 *
 * vitest 는 node 환경이다 — DOM 렌더 테스트용 패키지를 설치하지 않는다(브리프 §검증).
 * 여기서는 (1) 순수 함수(가격 표시 포맷·노선 기하)와 (2) 소스 정적 검사만 잠그고,
 * 실제 렌더(카드 16·path 16·핀 수·verbatim·빈 상태)는 browse 로 실측해 보고서에 남긴다.
 *
 * 주의: 이 파일은 tests/ 아래라 그 자체가 check-no-pricing.sh 의 검사 대상이다. 금지 심볼 리터럴을
 * 여기 적으면 저장소 전체가 빨간불이 되므로, 금지 패턴은 스크립트 파일에서 읽어 온다(같은 정규식 보장).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { PLACES, SHOWCASE_ROUTE_SEED, type PlaceCode, type RegionCode } from "@/lib/codes";
import { VERBATIM } from "@/lib/legal/disclosures";
import { PLACE_POINTS, REGION_POINTS, routeGeometry, routePath } from "@/lib/map-coords";
import type { PlacePin, ShowcaseRouteView } from "@/lib/types";

import { formatPriceKrw, formatPriceKrwEn } from "@/components/KrMap/format";
import {
  MAP_VIEWBOX,
  collectPins,
  mapGeometry,
  routeCurve,
  toPercentPosition,
} from "@/components/KrMap/geometry";
import { KR_MAP_LAND_PATH } from "@/components/KrMap/kr-map-path";

const ROOT = path.resolve(import.meta.dirname, "..");
const KRMAP_DIR = path.join(ROOT, "components", "KrMap");
const CSS_MODULE = path.join(KRMAP_DIR, "KrMap.module.css");

// ── 소스 로딩 ────────────────────────────────────────────────────────────
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const componentFiles = walk(KRMAP_DIR);
const sources = componentFiles.map((p) => ({
  file: path.relative(ROOT, p).split(path.sep).join("/"),
  text: readFileSync(p, "utf8"),
}));
const tsxSources = sources.filter(({ file }) => /\.tsx?$/.test(file));

function lines(text: string): string[] {
  return text.split("\n").map((l) => l.replace(/\r$/, ""));
}

// ── 픽스처: 스펙 §13.2 16노선을 ShowcaseRouteView 로 조립 (DB 없이) ────────
const placeByCode = new Map(PLACES.map((p) => [p.code as string, p]));

function pinOf(code: PlaceCode): PlacePin {
  const p = placeByCode.get(code);
  if (!p) throw new Error(`PLACES 에 없는 코드: ${code}`);
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

/** 두 좌표표(REGION_POINTS·PLACE_POINTS)에 같은 코드로 존재하는 6개 — 기하 패리티 검증용. */
const SHARED_CODES = ["ICN", "SEL", "BSN", "DGU", "GWJ", "DJN"] as const satisfies readonly (RegionCode & PlaceCode)[];

// =============================================================================
// 1. formatPriceKrw — 표시 포맷만 (브리프 규칙 1)
// =============================================================================
describe("formatPriceKrw — 표시 포맷", () => {
  test.each([
    [400000, "40만원"],
    [1300000, "130만원"],
    [1250000, "125만원"],
    [700000, "70만원"],
  ])("%d → %s", (input, expected) => {
    expect(formatPriceKrw(input)).toBe(expected);
  });

  test("null → 빈 문자열 (라벨 숨김 폴백 — CLAUDE.md §3)", () => {
    expect(formatPriceKrw(null)).toBe("");
  });

  test("0 → 빈 문자열 (0원은 표시하지 않는다)", () => {
    expect(formatPriceKrw(0)).toBe("");
  });

  test("음수·NaN·Infinity 도 표시하지 않는다", () => {
    expect(formatPriceKrw(-1)).toBe("");
    expect(formatPriceKrw(Number.NaN)).toBe("");
    expect(formatPriceKrw(Number.POSITIVE_INFINITY)).toBe("");
  });

  test("만원 단위가 아닌 값은 소수로 그대로 보인다 (반올림·절사 없음 — 값을 만들지 않는다)", () => {
    expect(formatPriceKrw(1255000)).toBe("125.5만원");
  });

  test("픽스처 16노선 전부 빈 문자열 없이 '…만원' 으로 포맷된다", () => {
    for (const r of ROUTES) {
      expect(formatPriceKrw(r.priceFrom)).toMatch(/^\d+만원$/);
    }
    expect(formatPriceKrw(ROUTES[0].priceFrom)).toBe("40만원");
  });
});

// P2-6 — 영문 화면의 같은 값 표기. 산술 없이 자릿수에 쉼표만 넣는다(값을 만들지 않는다).
describe("formatPriceKrwEn — 영문 표시 포맷 (P2-6)", () => {
  test.each([
    [400000, "KRW 400,000"],
    [1300000, "KRW 1,300,000"],
    [700000, "KRW 700,000"],
    [1255000, "KRW 1,255,000"],
    [999, "KRW 999"],
  ])("%d → %s", (input, expected) => {
    expect(formatPriceKrwEn(input)).toBe(expected);
  });

  test("폴백은 ko 와 같다 — null·0·음수·NaN·Infinity 는 빈 문자열(라벨 숨김)", () => {
    for (const v of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatPriceKrwEn(v)).toBe("");
  });

  test("저장값 그대로를 보인다 — 쉼표를 뗀 영문 숫자가 price_from 의 십진 표기와 같다(모든 픽스처)", () => {
    for (const r of ROUTES) {
      expect(formatPriceKrwEn(r.priceFrom).replace(/^KRW |,/g, "")).toBe(String(r.priceFrom));
    }
  });
});

// =============================================================================
// 2. 노선 기하 — lib/map-coords 와 같은 규칙, 좌표는 props(svgX/svgY)에서만
// =============================================================================
describe("geometry — routeCurve 는 lib/map-coords.routePath 와 같은 곡선을 만든다", () => {
  test("viewBox 는 kr-map.svg 와 같다 (524 × 560)", () => {
    expect(MAP_VIEWBOX).toEqual({ width: 524, height: 560 });
  });

  test("공유 코드 6개는 두 좌표표에서 같은 점이다 (패리티 검증의 전제)", () => {
    for (const c of SHARED_CODES) {
      expect(PLACE_POINTS[c]).toEqual(REGION_POINTS[c]);
    }
  });

  test("공유 코드 6개의 모든 순서쌍(30)에서 routePath 와 바이트 단위로 같다", () => {
    let pairs = 0;
    for (const from of SHARED_CODES) {
      for (const to of SHARED_CODES) {
        if (from === to) continue;
        expect(routeCurve(pinOf(from), pinOf(to)), `${from}→${to}`).toBe(routePath(from, to));
        pairs++;
      }
    }
    expect(pairs).toBe(30);
  });

  test("픽스처 16노선의 path d 는 전부 'M… Q… …' 2차 베지어이고 서로 다르다", () => {
    const ds = ROUTES.map((r) => routeCurve(r.origin, r.destination));
    for (const d of ds) expect(d).toMatch(/^M-?\d+(\.\d)?,-?\d+(\.\d)? Q-?\d+(\.\d)?,-?\d+(\.\d)? -?\d+(\.\d)?,-?\d+(\.\d)?$/);
    expect(new Set(ds).size).toBe(16);
  });

  test("곡선 양 끝은 정확히 출발·도착 핀 좌표다 (핀과 선이 어긋나지 않는다)", () => {
    for (const r of ROUTES) {
      const d = routeCurve(r.origin, r.destination);
      expect(d.startsWith(`M${r.origin.svgX},${r.origin.svgY} `)).toBe(true);
      expect(d.endsWith(` ${r.destination.svgX},${r.destination.svgY}`)).toBe(true);
    }
  });
});

describe("geometry — collectPins / mapGeometry", () => {
  test("16노선 → 핀 17개 (ICN·SEL + 도착 15, 중복 제거) — browse 실측 기준값", () => {
    const pins = collectPins(ROUTES);
    expect(pins).toHaveLength(17);
    expect(new Set(pins.map((p) => p.code)).size).toBe(17);
  });

  test("핀 순서는 첫 등장 순(출발 → 도착)이고, routeGeometry 의 중복 제거 규칙과 같다", () => {
    // 공유 코드만으로 만든 노선 — lib 의 routeGeometry 와 1:1 비교 가능한 부분집합
    const subset = ROUTES.filter(
      (r) => (SHARED_CODES as readonly string[]).includes(r.originCode) && (SHARED_CODES as readonly string[]).includes(r.destinationCode),
    );
    expect(subset.length).toBeGreaterThanOrEqual(4);
    const lib = routeGeometry(
      subset.map((r) => ({ originCode: r.originCode as RegionCode, destinationCode: r.destinationCode as RegionCode })),
    );
    const ours = mapGeometry(subset);
    expect(ours.pins.map((p) => p.code)).toEqual(lib.pins.map((p) => p.code));
    expect(ours.pins.map((p) => ({ x: p.svgX, y: p.svgY }))).toEqual(lib.pins.map((p) => p.point));
    expect(ours.paths.map((p) => p.d)).toEqual(lib.paths.map((p) => p.d));
  });

  test("path 는 노선 수와 같고(16) 강조 노선은 정확히 1개", () => {
    const geo = mapGeometry(ROUTES);
    expect(geo.paths).toHaveLength(16);
    expect(geo.paths.filter((p) => p.highlight)).toHaveLength(1);
    expect(geo.paths[0]).toMatchObject({ routeId: 1, highlight: true });
  });

  test("핀 톤: 강조 노선에만 닿는 핀(ICN)은 accent, 일반 노선에도 닿는 허브(SEL)는 brand", () => {
    const geo = mapGeometry(ROUTES);
    const byCode = new Map(geo.pins.map((p) => [p.code, p]));
    expect(byCode.get("ICN")).toMatchObject({ tone: "accent", hub: false });
    expect(byCode.get("SEL")).toMatchObject({ tone: "brand", hub: true });
    expect(byCode.get("BSN")).toMatchObject({ tone: "brand", hub: false });
    // 허브(2개 이상 노선이 닿는 핀)는 서울 하나뿐
    expect(geo.pins.filter((p) => p.hub).map((p) => p.code)).toEqual(["SEL"]);
    // 골드 핀도 인천공항 하나뿐
    expect(geo.pins.filter((p) => p.tone === "accent").map((p) => p.code)).toEqual(["ICN"]);
  });

  test("빈 배열 → 핀 0 · path 0 (실패 경로: 지도만 뜬다)", () => {
    expect(mapGeometry([])).toEqual({ pins: [], paths: [] });
  });

  test("toPercentPosition — 라벨 레이어(HTML)가 SVG 좌표 위에 올라설 때 쓰는 백분율 변환", () => {
    expect(toPercentPosition({ svgX: 0, svgY: 0 })).toEqual({ left: "0%", top: "0%" });
    expect(toPercentPosition({ svgX: 524, svgY: 560 })).toEqual({ left: "100%", top: "100%" });
    expect(toPercentPosition({ svgX: 262, svgY: 140 })).toEqual({ left: "50%", top: "25%" });
  });
});

// =============================================================================
// 3. 지도 본체 — mockups/assets/kr-map.svg 의 path 를 그대로 인라인 (드리프트 잠금)
// =============================================================================
describe("kr-map-path — 지도 land path 는 자산 파일과 바이트 단위로 같다", () => {
  const asset = readFileSync(path.join(ROOT, "mockups", "assets", "kr-map.svg"), "utf8");

  test("자산의 유일한 <path d> 와 KR_MAP_LAND_PATH 가 일치한다", () => {
    const m = /<path[^>]*\sd="([^"]*)"/.exec(asset);
    expect(m, "kr-map.svg 에서 path d 를 찾지 못함").not.toBeNull();
    expect(KR_MAP_LAND_PATH).toBe(m![1]);
    expect(KR_MAP_LAND_PATH.length).toBeGreaterThan(10_000);
  });

  test("자산의 viewBox 와 MAP_VIEWBOX 가 같다", () => {
    const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(asset);
    expect(vb).not.toBeNull();
    expect(MAP_VIEWBOX).toEqual({ width: Number(vb![1]), height: Number(vb![2]) });
  });
});

// =============================================================================
// 4. 소스 정적 검사 — 가격 금지 심볼·산술, 토큰, 서버 컴포넌트, verbatim 원장 import
// =============================================================================
describe("components/KrMap — 가격 게이트 (정적)", () => {
  test("브리프가 요구한 파일이 전부 있다", () => {
    const names = componentFiles.map((p) => path.basename(p));
    for (const f of ["KrMap.tsx", "MapSvg.tsx", "RouteCards.tsx", "format.ts", "geometry.ts", "KrMap.module.css", "kr-map-path.ts"]) {
      expect(names, `${f} 없음`).toContain(f);
    }
  });

  test("check-no-pricing.sh 의 금지 패턴이 components/KrMap/** 에 0건 (스크립트에서 패턴을 읽어 동일 정규식으로)", () => {
    const script = readFileSync(path.join(ROOT, "scripts", "check-no-pricing.sh"), "utf8");
    const m = /^PATTERN='([^']+)'/m.exec(script);
    expect(m, "스크립트에서 PATTERN 을 찾지 못함").not.toBeNull();
    const pattern = new RegExp(m![1]);
    expect(pattern.source.length).toBeGreaterThan(10);
    for (const { file, text } of sources) {
      expect(pattern.test(text), `${file} 에 금지 심볼 검출`).toBe(false);
    }
  });

  test("price 를 산술 연산자로 다루는 줄은 formatPriceKrw 안의 '/ 10000' 한 곳뿐", () => {
    const ARITH = /price.*[*/+\-]\s*\d/i;
    const hits: string[] = [];
    for (const { file, text } of sources) {
      lines(text).forEach((l, i) => {
        if (ARITH.test(l)) hits.push(`${file}:${i + 1}:${l.trim()}`);
      });
    }
    expect(hits, `허용 밖 price 산술: \n${hits.join("\n")}`).toHaveLength(1);
    expect(hits[0].startsWith("components/KrMap/format.ts:")).toBe(true);
    expect(hits[0]).toContain("/ 10000");

    // 허용 위치 명시: 그 줄은 formatPriceKrw 함수 본문 안이어야 한다.
    const fmt = readFileSync(path.join(KRMAP_DIR, "format.ts"), "utf8");
    const fnStart = fmt.indexOf("export function formatPriceKrw(");
    const hitLine = Number(hits[0].split(":")[1]);
    const hitOffset = lines(fmt).slice(0, hitLine - 1).join("\n").length;
    expect(fnStart).toBeGreaterThanOrEqual(0);
    expect(hitOffset).toBeGreaterThan(fnStart);
    // 그리고 '/ 10000' 은 파일 전체에서 한 번만 등장한다.
    expect(fmt.split("/ 10000").length - 1).toBe(1);
  });

  test("formatPriceKrw 외에 price 값을 받는 함수·변수 이름에 금지 어휘가 없다 (estimate·state)", () => {
    for (const { file, text } of tsxSources) {
      expect(/\b(estimat|price_?state|est_?price)/i.test(text), `${file}`).toBe(false);
    }
  });
});

describe("components/KrMap — 디자인 토큰 (CSS Modules)", () => {
  const css = readFileSync(CSS_MODULE, "utf8");
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const semanticCss = readFileSync(path.join(ROOT, "styles", "semantic.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const semanticTokens = new Set([...semanticCss.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]));

  test("HEX 리터럴 0건", () => {
    const hex = cssNoComments.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `HEX 리터럴: ${hex.join(", ")}`).toEqual([]);
  });

  test("원시 토큰 --brand-N 직접 참조 0건", () => {
    expect(/--brand-\d/.test(cssNoComments)).toBe(false);
  });

  test("rgb()/rgba()/hsl() 색 리터럴·이름 색 0건 (색은 역할 토큰만)", () => {
    expect(/\b(rgba?|hsla?)\(/.test(cssNoComments)).toBe(false);
    // 속성값 자리에 오는 이름 색. transparent·currentColor·none·inherit 는 색이 아니므로 허용.
    const named = cssNoComments.match(/:\s*(white|black|red|blue|green|gray|grey|purple|gold|violet|yellow|orange)\b/gi) ?? [];
    expect(named, `이름 색: ${named.join(", ")}`).toEqual([]);
  });

  test("모든 var(--x) 참조가 styles/semantic.css 에 정의돼 있다", () => {
    const refs = [...new Set([...cssNoComments.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map((m) => m[1]))];
    expect(refs.length).toBeGreaterThanOrEqual(8);
    const missing = refs.filter((r) => !semanticTokens.has(r));
    expect(missing, `semantic.css 에 없는 참조: ${missing.join(", ")}`).toEqual([]);
  });

  test("골드(--accent-decorative*) 는 텍스트 색(color)에 쓰지 않는다 — 대비 2.38:1", () => {
    // `color: var(--accent-decorative…)` 형태만 금지. fill/stroke/background/border 는 장식이라 허용.
    expect(/(^|[^-])color\s*:\s*var\(--accent-decorative/m.test(cssNoComments)).toBe(false);
  });

  test("골드 배경 위에 텍스트를 올리지 않는다 — background 에 골드를 쓴 규칙 블록에 color 선언이 없다", () => {
    const blocks = cssNoComments.match(/\{[^}]*\}/g) ?? [];
    for (const b of blocks) {
      if (/background(-color)?\s*:\s*var\(--accent-decorative/.test(b)) {
        expect(/(^|[^-])color\s*:/m.test(b), `골드 배경 블록에 텍스트 색: ${b}`).toBe(false);
      }
    }
  });

  test("TSX 는 CSS Modules 클래스만 쓰고 인라인 색(style={{color/fill/stroke…}})을 쓰지 않는다", () => {
    for (const { file, text } of tsxSources) {
      expect(/style=\{\{[^}]*(color|fill|stroke|background)/.test(text), `${file}`).toBe(false);
      expect(/#[0-9a-fA-F]{6}\b/.test(text), `${file} 에 HEX 리터럴`).toBe(false);
    }
  });
});

describe("components/KrMap — 서버 컴포넌트 · 링크 · verbatim", () => {
  // P2-9: 지도 선 hover/탭·카드 수 측정은 클라이언트 인터랙션이다 — 'use client' 는 RouteExplorer.tsx 하나에만 허용한다.
  // 데이터·문구·verbatim 고지·CTA Link 는 여전히 서버(KrMap.tsx)가 만든다(tests/krmap-interactive.test.ts §7).
  test("'use client' 는 RouteExplorer.tsx 하나뿐", () => {
    const clients = tsxSources.filter(({ text }) => /['"]use client['"]/.test(text)).map(({ file }) => file);
    expect(clients).toEqual(["components/KrMap/RouteExplorer.tsx"]);
  });

  test("next/link import 0건 — 로케일 프리픽스가 빠진다", () => {
    for (const { file, text } of tsxSources) {
      expect(/from\s+['"]next\/link['"]/.test(text), `${file}`).toBe(false);
    }
  });

  test("i18n/navigation 의 Link 를 쓴다", () => {
    const usesLink = tsxSources.some(({ text }) => /import\s*\{[^}]*\bLink\b[^}]*\}\s*from\s*['"]@\/i18n\/navigation['"]/.test(text));
    expect(usesLink).toBe(true);
  });

  test("VERBATIM 을 lib/legal/disclosures 에서 import 하고 showcaseNotice 를 참조한다", () => {
    const importers = tsxSources.filter(({ text }) => /import\s*\{[^}]*\bVERBATIM\b[^}]*\}\s*from\s*['"]@\/lib\/legal\/disclosures['"]/.test(text));
    expect(importers.length).toBeGreaterThanOrEqual(1);
    expect(importers.some(({ text }) => /VERBATIM\.showcaseNotice/.test(text))).toBe(true);
  });

  test("verbatim 문자열 리터럴 0건 — 원장 밖에 문구를 다시 쓰지 않는다 (부분 문자열까지)", () => {
    const fragments = [VERBATIM.showcaseNotice, "45인승 당일왕복", "상담 후 확정", VERBATIM.bookingNotice];
    for (const { file, text } of sources) {
      for (const f of fragments) {
        expect(text.includes(f), `${file} 에 verbatim 조각 "${f}"`).toBe(false);
      }
    }
  });

  test("KrMap 은 데이터를 fetch 하지 않는다 — lib/queries·supabase import 0건", () => {
    for (const { file, text } of tsxSources) {
      expect(/lib\/queries|supabase/.test(text), `${file}`).toBe(false);
    }
  });

  test("지도 라벨(SVG <text>) 은 이번 범위 밖 — MapSvg 에 <text 0건, 라벨 레이어 슬롯만 있다", () => {
    const mapSvg = readFileSync(path.join(KRMAP_DIR, "MapSvg.tsx"), "utf8");
    expect(/<text[\s>]/.test(mapSvg)).toBe(false);
    const krMap = readFileSync(path.join(KRMAP_DIR, "KrMap.tsx"), "utf8");
    expect(/labels\?\s*:/.test(krMap), "KrMap props 에 labels 슬롯이 없다").toBe(true);
  });

  test("SVG 접근성: role=img + aria-labelledby, 핀·곡선 그룹은 aria-hidden", () => {
    const mapSvg = readFileSync(path.join(KRMAP_DIR, "MapSvg.tsx"), "utf8");
    expect(/role="img"/.test(mapSvg)).toBe(true);
    expect(/aria-labelledby=/.test(mapSvg)).toBe(true);
    expect((mapSvg.match(/aria-hidden(="true"|=\{true\}|\b)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

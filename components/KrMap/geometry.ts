/**
 * KrMap 렌더 기하 — 좌표는 전부 props(`PlacePin.svgX/svgY`, P2-1 이 places 에서 붙여 준다)에서 온다.
 * 이 파일에는 지역·도시 좌표가 하나도 없다.
 *
 * 왜 lib/map-coords.ts 의 routePath/routeGeometry 를 직접 호출하지 않는가:
 *   그 두 함수는 `RegionCode` 를 받아 `REGION_POINTS`(시도 17개)를 찾는다. 대표 노선 16개의 도착지
 *   11개(TYG·PHG·JJU·YSU·HNM·SJG·SCH·GNG·TBK·HCN·WJU)는 도시 코드(PlaceCode)라 RegionCode 가 아니고,
 *   lib/map-coords.ts 는 이번 범위에서 수정 금지다. 그래서 **같은 곡선 규칙**(2차 베지어, 중점에서 수직으로
 *   curvature×거리, 항상 위로 볼록, 소수 1자리)을 점 좌표 입력으로 다시 적용한다.
 *   tests/krmap.test.ts 가 두 좌표표에 공통인 6개 코드의 순서쌍 30개 전부에서 routePath 와 바이트 단위로
 *   같음을 단언한다 — lib 의 규칙이 바뀌면 여기가 빨간불이 난다.
 *   후속 제안: lib/map-coords.ts 에 점 입력 버전(`routePathBetween(p1, p2)`)이 생기면 routeCurve 를 그것으로 바꾸고
 *   이 파일의 곡선 계산을 지운다(보고서 §판단).
 */
import type { PlacePin, ShowcaseRouteView } from "@/lib/types";

/** mockups/assets/kr-map.svg 의 viewBox. kr-map-path.ts 의 path 는 이 좌표계다. */
export const MAP_VIEWBOX = { width: 524, height: 560 } as const;

/** lib/map-coords.ts 의 DEFAULT_CURVATURE 와 같은 값 (패리티 테스트로 잠김). */
const CURVATURE = 0.22;

export type PinPoint = Pick<PlacePin, "svgX" | "svgY">;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 두 핀을 잇는 2차 베지어 SVG path: `M x1,y1 Q cx,cy x2,y2`.
 * 제어점은 중점에서 선분에 수직인 두 방향 중 y 성분이 음수(SVG 에서 위쪽)인 쪽으로 curvature×거리만큼.
 * dx 가 0(완전 수직)이면 (dy,-dx) 쪽. — lib/map-coords.routePath 와 동일 규칙.
 */
export function routeCurve(origin: PinPoint, destination: PinPoint, curvature: number = CURVATURE): string {
  const { cx, cy } = controlPoint(origin, destination, curvature);
  return `M${round1(origin.svgX)},${round1(origin.svgY)} Q${round1(cx)},${round1(cy)} ${round1(destination.svgX)},${round1(destination.svgY)}`;
}

/** routeCurve 의 제어점 (반올림 전). 중점에서 선분에 수직, 위쪽으로 curvature×거리. */
function controlPoint(origin: PinPoint, destination: PinPoint, curvature: number): { cx: number; cy: number } {
  const x1 = origin.svgX;
  const y1 = origin.svgY;
  const x2 = destination.svgX;
  const y2 = destination.svgY;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  if (dist === 0) return { cx: mx, cy: my };

  const candidate = dx >= 0 ? { x: dy, y: -dx } : { x: -dy, y: dx };
  const offset = curvature * dist;
  return { cx: mx + (candidate.x / dist) * offset, cy: my + (candidate.y / dist) * offset };
}

/**
 * 곡선 위 t=0.5 점 — 지도 선 말풍선(P2-9)의 기준점. B(½) = ¼·P0 + ½·C + ¼·P2 (소수 1자리).
 * 좌표 계산일 뿐 값(가격)과 무관하다.
 */
export function routeMidpoint(origin: PinPoint, destination: PinPoint, curvature: number = CURVATURE): PinPoint {
  const { cx, cy } = controlPoint(origin, destination, curvature);
  return {
    svgX: round1(0.25 * origin.svgX + 0.5 * cx + 0.25 * destination.svgX),
    svgY: round1(0.25 * origin.svgY + 0.5 * cy + 0.25 * destination.svgY),
  };
}

/** 핀 톤 — accent(골드)는 강조 노선에만 닿는 핀, brand(퍼플)는 그 밖의 핀. */
export type PinTone = "brand" | "accent";

/** 지도에 찍는 핀 하나. PlacePin 에 렌더 힌트를 얹었다 — 라벨 레이어도 같은 객체를 받는다. */
export interface MapPin extends PlacePin {
  tone: PinTone;
  /** 2개 이상 노선이 닿는 핀(허브). 현재 데이터에서는 서울 하나. */
  hub: boolean;
  /** 이 핀에 닿는 노선 id (첫 등장 순). 라벨 레이어가 강조·필터링에 쓸 수 있다. */
  routeIds: number[];
}

export interface MapRoutePath {
  routeId: number;
  originCode: string;
  destinationCode: string;
  highlight: boolean;
  d: string;
}

export interface MapGeometry {
  pins: MapPin[];
  paths: MapRoutePath[];
}

/** 노선 양 끝 핀을 첫 등장 순(출발 → 도착)으로 모으고 코드로 중복을 제거한다 — lib routeGeometry 와 같은 규칙. */
export function collectPins(routes: readonly ShowcaseRouteView[]): MapPin[] {
  const byCode = new Map<string, MapPin>();
  const touching = new Map<string, ShowcaseRouteView[]>();

  for (const route of routes) {
    for (const pin of [route.origin, route.destination]) {
      if (!byCode.has(pin.code)) {
        byCode.set(pin.code, { ...pin, tone: "brand", hub: false, routeIds: [] });
        touching.set(pin.code, []);
      }
      touching.get(pin.code)!.push(route);
    }
  }

  for (const [code, pin] of byCode) {
    const rs = touching.get(code)!;
    pin.routeIds = rs.map((r) => r.id);
    pin.hub = rs.length >= 2;
    pin.tone = rs.every((r) => r.highlight) ? "accent" : "brand";
  }

  return [...byCode.values()];
}

/** 노선 목록 → 핀(중복 제거) + 곡선 path. 빈 배열이면 둘 다 빈 배열(지도만 뜬다). */
export function mapGeometry(routes: readonly ShowcaseRouteView[]): MapGeometry {
  return {
    pins: collectPins(routes),
    paths: routes.map((r) => ({
      routeId: r.id,
      originCode: r.originCode,
      destinationCode: r.destinationCode,
      highlight: r.highlight,
      d: routeCurve(r.origin, r.destination),
    })),
  };
}

function pct(n: number): string {
  return `${Math.round(n * 1000) / 1000}%`;
}

/**
 * SVG 좌표 → 지도 stage 기준 백분율 위치. HTML 라벨 레이어(보류 중)가 `position:absolute; left/top` 으로
 * 핀 위에 올라설 때 쓴다. stage 는 viewBox 와 같은 종횡비(524/560)를 유지하므로 백분율이 곧 핀 위치다.
 */
export function toPercentPosition(p: PinPoint): { left: string; top: string } {
  return {
    left: pct((p.svgX / MAP_VIEWBOX.width) * 100),
    top: pct((p.svgY / MAP_VIEWBOX.height) * 100),
  };
}

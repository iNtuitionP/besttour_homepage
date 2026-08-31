/**
 * 지도 좌표 카탈로그 + 노선 기하 계산 (순수 로직).
 *
 * REGIONS 17개 전부에 대해 mockups/assets/kr-map.svg (viewBox="0 0 524 560")
 * 위의 핀 좌표를 제공한다. 홈 지도는 노선 개수가 가변(사장님이 admin에서
 * 추가·삭제)이므로, React 컴포넌트(Phase B)가 "어느 지역이든 핀을 찍고
 * 곡선을 그릴 수 있도록" 이 모듈이 좌표·경로 계산을 전담한다.
 *
 * ## 좌표 산출 방법 (최소제곱 적합 — 계산 과정은 report 참고)
 * mockups/variant-08-map-hero.html 에 실측으로 하드코딩되어 있던 6개 핀
 * (SEL·ICN·BSN·GW·DJN·JB)을 캘리브레이션 앵커로 삼아 위경도 → SVG 좌표
 * 선형 변환을 적합했다.
 *
 *   x = 83.043592 * lon - 10348.318693
 *   y = -103.311021 * lat + 3988.951380
 *
 * (완전 아핀 x = a*lon + b*lat + c 형태로 6점을 적합했을 때 회전/전단 계수
 * b, d가 각각 0.02, -0.006으로 잡음 수준에 불과했고, 5개 앵커(SEL·ICN·BSN·
 * DJN·JB)만으로 위 "축별 독립 선형" 형태를 적합하면 잔차가 0.05px 미만으로
 * 사실상 정확히 일치했다 — 즉 kr-map.svg는 회전 없는 단순 등장방형
 * (Plate Carrée류) 투영이다. GW 앵커 1개만 이 모델과 큰 잔차(x≈95px)를
 * 보였는데, 역산해 보면 그 픽셀 좌표는 브리프에 기재된 춘천이 아니라
 * 강릉(37.7519, 128.8761)의 위경도와 0.001° 이내로 정확히 일치한다 — 즉
 * 앵커 표의 "강원(춘천)" 실측 위경도 자체가 실제 핀 위치와 다른 지역을
 * 가리키는 오기로 보인다. 이 사실은 report의 우려사항에 기록했다.
 * 앵커 6개의 SVG 좌표 자체는 표에 있는 값 그대로 하드코딩했다(모델로
 * 재계산하지 않음) — GW도 마찬가지로 실측값(354.0, 88.8)을 그대로 쓴다.
 *
 * 나머지 11개 지역은 위 계수로 계산한 값을 소수점 1자리로 반올림해
 * 하드코딩했다(런타임에 적합 계산을 돌리지 않는다).
 */
import type { RegionCode } from "./codes";

export interface MapPoint {
  x: number;
  y: number;
}

/** REGIONS 17개 전부에 대한 SVG 좌표 (viewBox 0 0 524 560 기준). */
export const REGION_POINTS: Record<RegionCode, MapPoint> = {
  // --- 캘리브레이션 앵커 6개 (실측값, mockups/variant-08-map-hero.html) ---
  ICN: { x: 151.8, y: 118.9 },
  SEL: { x: 196.4, y: 107.9 },
  BSN: { x: 370.6, y: 354.5 },
  GW: { x: 354.0, y: 88.8 },
  DJN: { x: 230.1, y: 233.6 },
  JB: { x: 210.5, y: 287.9 },

  // --- 적합 계산값 (앵커 6점 최소제곱, 잔차 <3px) ---
  INC: { x: 173.7, y: 119.3 },
  DGU: { x: 331.2, y: 283.0 },
  GWJ: { x: 186.0, y: 356.6 },
  ULS: { x: 390.2, y: 317.4 },
  GG: { x: 200.6, y: 139.2 },
  CN: { x: 171.0, y: 201.7 },
  CB: { x: 238.8, y: 203.4 },
  GB: { x: 341.8, y: 211.0 },
  GN: { x: 337.9, y: 349.5 },
  JN: { x: 155.1, y: 374.1 },
  // 제주는 본토 밖이지만 계산 결과 viewBox(0..524, 0..560) 안에 들어오며
  // kr-map.svg에도 해당 좌표 부근(x 164~196, y 521~556)에 실제 섬 path가
  // 그려져 있어 별도 인셋 처리 없이 그대로 사용한다.
  JJ: { x: 159.3, y: 528.1 },
};

/** 라벨 배치 힌트 — 핀 기준 어느 방향에 글자를 둘지 (SVG text-anchor). */
export const REGION_LABEL_ANCHOR: Record<RegionCode, "start" | "middle" | "end"> = {
  // 앵커 6개는 mockups/variant-08-map-hero.html의 실제 text-anchor 값 그대로.
  ICN: "middle",
  SEL: "start",
  BSN: "start",
  GW: "start",
  DJN: "start",
  JB: "middle",

  // 나머지 11개: 인접 핀(ICN/SEL 등)과 겹치기 쉬운 지역은 "middle",
  // 그 외엔 목업 다수 사례를 따라 기본값 "start"로 둔다.
  // (픽셀 단위 최종 배치는 Phase B 컴포넌트 + 디자인 리뷰에서 조정)
  INC: "middle",
  GG: "middle",
  JJ: "middle",
  DGU: "start",
  GWJ: "start",
  ULS: "start",
  CN: "start",
  CB: "start",
  GB: "start",
  GN: "start",
  JN: "start",
};

const DEFAULT_CURVATURE = 0.22;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 두 지역을 잇는 2차 베지어 곡선 SVG path: `M x1,y1 Q cx,cy x2,y2`.
 *
 * 제어점은 두 점의 중점에서 선분에 수직인 방향으로 `curvature * 거리`만큼
 * 이동한 위치다. 부호 규칙(항상 같은 쪽으로 휘게): 두 점을 잇는 벡터를
 * d=(dx,dy)라 할 때, 수직 벡터 후보 (dy,-dx)와 (-dy,dx) 중 y성분이 음수인
 * 쪽(=SVG 좌표계에서 더 "위쪽")을 제어점 방향으로 택한다. dx가 0인 경우
 * (완전 수직선)에는 (dy,-dx) 쪽을 기본으로 쓴다. 이렇게 하면 두 지역의
 * 좌우 배치와 무관하게 곡선이 항상 위로 볼록하게 그려진다.
 */
export function routePath(
  from: RegionCode,
  to: RegionCode,
  curvature: number = DEFAULT_CURVATURE,
): string {
  const p1 = REGION_POINTS[from];
  const p2 = REGION_POINTS[to];

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;

  let cx = mx;
  let cy = my;

  if (dist > 0) {
    // 두 수직 후보 중 y성분이 음수(더 위쪽)인 쪽을 선택.
    const candidate = dx >= 0 ? { x: dy, y: -dx } : { x: -dy, y: dx };
    const ux = candidate.x / dist;
    const uy = candidate.y / dist;
    const offset = curvature * dist;
    cx = mx + ux * offset;
    cy = my + uy * offset;
  }

  const x1 = round1(p1.x);
  const y1 = round1(p1.y);
  const x2 = round1(p2.x);
  const y2 = round1(p2.y);
  const cxr = round1(cx);
  const cyr = round1(cy);

  return `M${x1},${y1} Q${cxr},${cyr} ${x2},${y2}`;
}

export interface RouteInput {
  originCode: RegionCode;
  destinationCode: RegionCode;
}

export interface RouteGeometry {
  pins: { code: RegionCode; point: MapPoint }[];
  paths: { from: RegionCode; to: RegionCode; d: string }[];
}

/** 노선 목록 → 렌더에 필요한 기하 일체 (핀 중복 제거 + 경로). */
export function routeGeometry(routes: RouteInput[]): RouteGeometry {
  const seen = new Set<RegionCode>();
  const pins: RouteGeometry["pins"] = [];

  for (const route of routes) {
    for (const code of [route.originCode, route.destinationCode]) {
      if (!seen.has(code)) {
        seen.add(code);
        pins.push({ code, point: REGION_POINTS[code] });
      }
    }
  }

  const paths = routes.map((route) => ({
    from: route.originCode,
    to: route.destinationCode,
    d: routePath(route.originCode, route.destinationCode),
  }));

  return { pins, paths };
}

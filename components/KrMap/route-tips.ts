/**
 * P2-9 — 노선 한 줄의 표시 데이터(카드·지도 말풍선이 **같이** 쓴다). 서버(KrMap)가 만들어 클라이언트에 props 로 내린다.
 *
 * - 지명은 로케일 필드(ko name_ko · en name_en).
 * - 금액은 카드와 **같은 포맷 함수**(formatPriceKrw / formatPriceKrwEn)의 결과 문자열 하나 — 빈 문자열이면 호출부가 줄을 숨긴다
 *   (CLAUDE.md §3 라벨 숨김 폴백). 계산 없음.
 * - 곡선 d 는 지도(MapSvg)와 같은 routeCurve — 히트 영역이 보이는 선과 정확히 겹친다.
 * - 말풍선 기준점은 곡선 중점(routeMidpoint)의 스테이지 백분율, 배치는 tipPlacement.
 */
import type { ShowcaseRouteView } from "@/lib/types";
import { tipPlacement, type TipAlign, type TipSide } from "./fit";
import { formatPriceKrw, formatPriceKrwEn } from "./format";
import { MAP_VIEWBOX, routeCurve, routeMidpoint, toPercentPosition } from "./geometry";

export interface RouteTip {
  id: number;
  from: string;
  to: string;
  /** 표시 문자열("40만원" · "KRW 400,000"). 빈 문자열 = 실값 미수령 → 숨김. */
  amount: string;
  airport: boolean;
  highlight: boolean;
  /** SVG path d (지도 선과 같다). */
  d: string;
  /** 출발·도착 핀 SVG 좌표 — 활성 노선의 핀 강조 링. */
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** 말풍선 기준점(스테이지 백분율). */
  anchor: { left: string; top: string };
  place: { align: TipAlign; side: TipSide };
}

function touchesAirport(r: ShowcaseRouteView): boolean {
  return r.origin.kind === "airport" || r.destination.kind === "airport";
}

export function toRouteTips(routes: readonly ShowcaseRouteView[], locale: string): RouteTip[] {
  const en = locale === "en";
  return routes.map((r) => {
    const mid = routeMidpoint(r.origin, r.destination);
    return {
      id: r.id,
      from: en ? r.origin.nameEn : r.origin.nameKo,
      to: en ? r.destination.nameEn : r.destination.nameKo,
      amount: en ? formatPriceKrwEn(r.priceFrom) : formatPriceKrw(r.priceFrom),
      airport: touchesAirport(r),
      highlight: r.highlight,
      d: routeCurve(r.origin, r.destination),
      a: { x: r.origin.svgX, y: r.origin.svgY },
      b: { x: r.destination.svgX, y: r.destination.svgY },
      anchor: toPercentPosition(mid),
      place: tipPlacement({
        xPct: (mid.svgX / MAP_VIEWBOX.width) * 100,
        yPct: (mid.svgY / MAP_VIEWBOX.height) * 100,
      }),
    };
  });
}

/**
 * KrMap — 대표 노선 지도 (조합 컴포넌트). 서버 컴포넌트, fetch 없음: 페이지가 getShowcaseRoutes() 로 받아 props 로 내린다.
 *
 * 레이어 구조 (브리프 §왜 라벨을 보류하는가):
 *   <figure .mapFrame>
 *     <div .stage>                 ← viewBox 종횡비 고정 스테이지 (position:relative)
 *       <MapSvg/>                  ← SVG 레이어: 지도 + 곡선 + 핀 (라벨 없음)
 *       <div .labelLayer>{labels}  ← **라벨 레이어 슬롯** (HTML, absolute) — UIUX 결정 후 채운다
 *     </div>
 *     <figcaption/>
 *   </figure>
 *   <RouteCards/>                  ← HTML 레이어: 카드 16장 (정보 층)
 *   <p .notice>VERBATIM.showcaseNotice</p>
 *
 * 라벨 레이어 인터페이스(제안, 보고서 §라벨): `labels` 에 `<MapLabels pins={mapGeometry(routes).pins} />` 를 넣고,
 * 각 라벨은 `toPercentPosition(pin)` 의 left/top 으로 absolute 배치한다. MapPin 에는 tone·hub·routeIds 가 있어
 * "어느 6개를 크게" 같은 정책을 라벨 컴포넌트 안에서만 결정할 수 있다 — SVG·카드 레이어는 손대지 않는다.
 */
import type { ReactNode } from "react";
import { VERBATIM } from "@/lib/legal/disclosures";
import type { ShowcaseRouteView } from "@/lib/types";
import { mapGeometry } from "./geometry";
import { MapSvg } from "./MapSvg";
import { RouteCards } from "./RouteCards";
import s from "./KrMap.module.css";

export interface KrMapProps {
  routes: readonly ShowcaseRouteView[];
  /** 지도 라벨 레이어(HTML) — 보류 중. 넣으면 SVG 위에 absolute 로 겹친다. */
  labels?: ReactNode;
  /** SVG title/desc id 접두사. */
  id?: string;
}

const COPY = {
  section: "대표 노선",
  /** 골드 범례 — 강조 노선이 공항 노선일 때만 보인다(데이터가 바뀌면 문장이 거짓이 되지 않도록). */
  legendAirport: "골드 표시 = 공항 픽업·샌딩 (송영 전문) 노선",
  descEmpty: "대한민국 지도입니다. 표시할 대표 노선이 없습니다.",
} as const;

function describe(routes: readonly ShowcaseRouteView[]): string {
  if (routes.length === 0) return COPY.descEmpty;
  return `대표 노선 ${routes.length}개의 출발지와 도착지를 대한민국 지도 위에 핀과 곡선으로 표시했습니다. 노선별 내용은 아래 목록에 있습니다.`;
}

export function KrMap({ routes, labels, id = "krmap" }: KrMapProps) {
  const geometry = mapGeometry(routes);
  const showAirportLegend = routes.some(
    (r) => r.highlight && (r.origin.kind === "airport" || r.destination.kind === "airport"),
  );

  return (
    <section className={s.root} aria-label={COPY.section} data-testid="krmap">
      <div className={s.grid}>
        <figure className={s.mapFrame}>
          <div className={s.stage} data-testid="krmap-stage">
            <MapSvg geometry={geometry} id={id} description={describe(routes)} />
            {labels ? (
              <div className={s.labelLayer} data-layer="labels">
                {labels}
              </div>
            ) : null}
          </div>
          {showAirportLegend ? (
            <figcaption className={s.caption}>
              <i className={s.swatch} aria-hidden="true" />
              {COPY.legendAirport}
            </figcaption>
          ) : null}
        </figure>

        <RouteCards routes={routes} />
      </div>

      <p className={s.notice} data-testid="krmap-notice">
        {VERBATIM.showcaseNotice}
      </p>
    </section>
  );
}

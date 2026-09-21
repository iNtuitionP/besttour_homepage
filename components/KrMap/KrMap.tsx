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
 *
 * 카피 (P2-6): messages home.krmap(ko 는 이전 COPY 상수와 같은 글자). Top-5 고지는 localizeVerbatim —
 * ko 는 원장 VERBATIM.showcaseNotice 그 자체, en 은 컨트롤러 확정 영문.
 */
import type { ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";

import { localizeVerbatim } from "@/lib/i18n/ledger-ui";
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

export async function KrMap({ routes, labels, id = "krmap" }: KrMapProps) {
  const [t, locale] = await Promise.all([getTranslations("home.krmap"), getLocale()]);
  const geometry = mapGeometry(routes);
  /** 골드 범례 — 강조 노선이 공항 노선일 때만 보인다(데이터가 바뀌면 문장이 거짓이 되지 않도록). */
  const showAirportLegend = routes.some(
    (r) => r.highlight && (r.origin.kind === "airport" || r.destination.kind === "airport"),
  );
  const description = routes.length === 0 ? t("descEmpty") : t("desc", { count: String(routes.length) });

  return (
    <section className={s.root} aria-label={t("section")} data-testid="krmap">
      <div className={s.grid}>
        <figure className={s.mapFrame}>
          <div className={s.stage} data-testid="krmap-stage">
            <MapSvg geometry={geometry} id={id} title={t("mapTitle")} description={description} />
            {labels ? (
              <div className={s.labelLayer} data-layer="labels">
                {labels}
              </div>
            ) : null}
          </div>
          {showAirportLegend ? (
            <figcaption className={s.caption}>
              <i className={s.swatch} aria-hidden="true" />
              {t("legendAirport")}
            </figcaption>
          ) : null}
        </figure>

        <RouteCards
          routes={routes}
          locale={locale}
          copy={{ listLabel: t("listLabel"), airport: t("airport"), cta: t("cta"), empty: t("empty") }}
        />
      </div>

      <p className={s.notice} data-testid="krmap-notice">
        {localizeVerbatim(locale, VERBATIM.showcaseNotice)}
      </p>
    </section>
  );
}

/**
 * KrMap — 대표 노선 지도 (조합 컴포넌트). 서버 컴포넌트, fetch 없음: 페이지가 getShowcaseRoutes() 로 받아 props 로 내린다.
 *
 * 레이어 구조:
 *   <RouteExplorer>                 ← 클라이언트 인터랙션 층(P2-9) — 지도 프레임 + 카드 목록 그리드
 *     <figure .mapFrame>
 *       <div .stage>                ← viewBox 종횡비 고정 스테이지 (position:relative)
 *         <MapSvg/>                 ← SVG 레이어(서버): 지도 + 곡선 + 핀 (라벨 없음)
 *         <div .labelLayer>{labels} ← 라벨 레이어 슬롯 (HTML, absolute) — UIUX 결정 후 채운다
 *         <svg .overlay>            ← 히트 영역 16 + 활성 노선 강조 (P2-9)
 *         <RouteTooltip/>           ← 선 hover/탭 말풍선 (P2-9)
 *       <figcaption/>
 *     <RouteCards/>                 ← 카드 16장(정보 층) — 지도 높이를 넘는 카드는 visually-hidden
 *     안내 줄 · "노선 전체 보기" 토글 · 견적 CTA
 *   <p .notice>VERBATIM.showcaseNotice</p>
 *
 * P2-9 (사용자 지시 2026-09-27): 카드는 지도 높이만큼만, 나머지는 지도 선 hover/탭 말풍선. 목업 variant-08 과 다르다
 * (카드 전부 표시였다 — 보고서 §6). 문구·금액·지명·곡선은 여기서(서버) 만들어 props 로 내린다: toRouteTips 가 카드와
 * 말풍선에 **같은** 포맷 문자열을 준다. 안내 문장은 가려진 개수마다 ICU 로 미리 만든다(클라이언트에 번역 함수가 없다).
 *
 * 카피 (P2-6): messages home.krmap. Top-5 고지는 localizeVerbatim — ko 는 원장 VERBATIM.showcaseNotice 그 자체.
 */
import type { ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { localizeVerbatim } from "@/lib/i18n/ledger-ui";
import { VERBATIM } from "@/lib/legal/disclosures";
import type { ShowcaseRouteView } from "@/lib/types";
import { mapGeometry } from "./geometry";
import { MapSvg } from "./MapSvg";
import { RouteExplorer } from "./RouteExplorer";
import { toRouteTips } from "./route-tips";
import s from "./KrMap.module.css";

export interface KrMapProps {
  routes: readonly ShowcaseRouteView[];
  /** 지도 라벨 레이어(HTML) — 보류 중. 넣으면 SVG 위에 absolute 로 겹친다. */
  labels?: ReactNode;
  /** SVG title/desc id 접두사. */
  id?: string;
  /**
   * 카드 칸을 지도 높이에 맞춰 접을지(P2-9). 기본 true(홈). /fares 는 false — 카드 전부 펼침, 안내 줄·토글 없음
   * (컨트롤러 결정 2026-09-27). 지도 선 hover/탭 말풍선은 어느 쪽이든 동작한다.
   */
  collapse?: boolean;
}

export async function KrMap({ routes, labels, id = "krmap", collapse = true }: KrMapProps) {
  const [t, locale] = await Promise.all([getTranslations("home.krmap"), getLocale()]);
  const geometry = mapGeometry(routes);
  /** 골드 범례 — 강조 노선이 공항 노선일 때만 보인다(데이터가 바뀌면 문장이 거짓이 되지 않도록). */
  const showAirportLegend = routes.some(
    (r) => r.highlight && (r.origin.kind === "airport" || r.destination.kind === "airport"),
  );
  const description = routes.length === 0 ? t("descEmpty") : t("desc", { count: String(routes.length) });
  const total = String(routes.length);

  return (
    <section className={s.root} aria-label={t("section")} data-testid="krmap">
      <RouteExplorer
        map={<MapSvg geometry={geometry} id={id} title={t("mapTitle")} description={description} />}
        labels={labels}
        legend={showAirportLegend ? t("legendAirport") : null}
        tips={toRouteTips(routes, locale)}
        collapse={collapse}
        copy={{
          listLabel: t("listLabel"),
          airport: t("airport"),
          empty: t("empty"),
          showAll: t("showAll", { count: total }),
          showLess: t("showLess"),
          moreHints: Array.from({ length: routes.length + 1 }, (_, n) => (n === 0 ? "" : t("moreHint", { count: String(n) }))),
        }}
        cta={
          // 견적은 홈 히어로의 견적 폼(#quote — P3-8 이 앵커를 붙인다)으로. en 은 /en#quote.
          <Link href={{ pathname: "/", hash: "quote" }} className={s.cta}>
            {t("cta")} <span aria-hidden="true">→</span>
          </Link>
        }
      />

      <p className={s.notice} data-testid="krmap-notice">
        {localizeVerbatim(locale, VERBATIM.showcaseNotice)}
      </p>
    </section>
  );
}

/**
 * 섹션 2 — 대표 노선 (#routes, 목업 variant-08 §01). 서버 컴포넌트.
 * 헤드만 여기서 그리고 지도·카드·verbatim 고지는 <KrMap routes> 가 전부 갖고 있다 — 고지를 여기서 다시 렌더하지 않는다.
 * 설명문의 "다섯 개 노선"(지금은 16개)·카드 hover 로 지도 강조(KrMap 은 정적 카드) 문장은 사실과 달라 뺐다(보고서 §UIUX 요청).
 */
import { getTranslations } from "next-intl/server";

import { KrMap } from "@/components/KrMap/KrMap";
import type { ShowcaseRouteView } from "@/lib/types";

import h from "./home.module.css";
import { RICH } from "./rich";
import { SectionHead } from "./SectionHead";

export async function RoutesSection({ routes }: { routes: readonly ShowcaseRouteView[] }) {
  const t = await getTranslations("home.routes");
  return (
    <section id="routes" className={`${h.section} ${h.toneWhite}`} aria-labelledby="routes-h" data-section="routes">
      <div className={h.wrap}>
        <SectionHead id="routes-h" eyebrow={t("eyebrow")} title={t.rich("title", RICH)} desc={t.rich("desc", RICH)} />
        <KrMap routes={routes} />
      </div>
    </section>
  );
}

/**
 * 섹션 4 — 서비스 스트립 (.section--tight.tone-lav 자리). 서버 컴포넌트.
 *
 * 목업의 이 자리는 "실시간 견적현황"(오늘 접수 17건 · 이번 주 103건 · 가짜 접수 피드 12건)이다 — 전부 실증 불가한
 * 창작 데이터라 옮기지 않았다(공개 접수 현황은 실데이터가 생기는 P4 몫, PRIVACY_NOTICE.publicFeedNotice 가 예고).
 * 대신 목업 #company 의 강점 6개 **제목만** 한 줄 밴드로 놓는다. 본문 문장은 BM 노출("외국인 투어 운행과 묶어 배차")과
 * 실증 불가 문구("13년간")가 섞여 있어 /about(P6-3)에서 UIUX 검토 후 쓴다.
 */
import { getTranslations } from "next-intl/server";

import h from "./home.module.css";
import s from "./Sections.module.css";

export async function ServiceStrip() {
  const t = await getTranslations("home.services");
  const items = t.raw("items") as string[];
  return (
    <section className={`${h.sectionTight} ${h.toneLav}`} aria-label={t("label")} data-section="services">
      <div className={h.wrap}>
        <p className={h.eyebrow}>{t("label")}</p>
        <ul className={s.services} data-testid="service-items">
          {items.map((item) => (
            <li key={item} className={s.serviceItem}>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

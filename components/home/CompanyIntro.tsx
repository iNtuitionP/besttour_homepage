/**
 * 섹션 7 — 회사 소개 · 인사말 요약 (#company). 서버 컴포넌트.
 *
 * 문구는 옛 사이트 인사말 원문(docs/ops/legacy-content-inventory.md §2)에서 3문장만 — "한해 70만 명 이상 외국인 관광객"
 * 문장은 실증 불가 수치라 제외했다(브리프 §7). 전문은 P6-3 /about. 대표 서명은 원장 COMPANY.representative.
 * 목업 #company 의 강점 6개는 ServiceStrip(섹션 4)이 제목만 옮겼다.
 */
import { getTranslations } from "next-intl/server";

import { COMPANY } from "@/lib/legal/disclosures";

import h from "./home.module.css";
import s from "./Sections.module.css";

export async function CompanyIntro() {
  const t = await getTranslations("home.company");
  const body = t.raw("body") as string[];

  return (
    <section id="company" className={`${h.section} ${h.toneWhite}`} aria-labelledby="company-h" data-section="company">
      <div className={h.wrap}>
        <div className={s.company}>
          <p className={h.eyebrow}>{t("eyebrow")}</p>
          <h2 id="company-h" className={s.companyTitle}>
            {t("lead")}
          </h2>
          {body.map((paragraph) => (
            <p key={paragraph} className={s.companyBody}>
              {paragraph}
            </p>
          ))}
          <p className={s.companySign} data-testid="company-signature">
            <span>{t("signaturePrefix")}</span> <b>{COMPANY.representative}</b>
          </p>
        </div>
      </div>
    </section>
  );
}

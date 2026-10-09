/**
 * 섹션 7 — 회사 소개 · 인사말 요약 (#company). 서버 컴포넌트.
 *
 * 문구는 옛 사이트 인사말 원문(docs/ops/legacy-content-inventory.md §2)에서 3문장만 — "한해 70만 명 이상 외국인 관광객"
 * 문장은 실증 불가 수치라 제외했다(브리프 §7). 대표 서명은 원장 COMPANY.representative.
 * /about(P6-3)은 같은 컴포넌트를 재사용하고 `extra` 로 안전한 2문장(ko.json pages.about.more)만 본문 뒤에 덧붙인다 —
 * 인사말 lead·body 가 ko.json 에 두 번 있지 않도록(tests/pages.test.ts). 목업 #company 의 강점 6개는 ServiceStrip(섹션 4)이 제목만 옮겼다.
 */
import { getLocale, getTranslations } from "next-intl/server";

import { ledgerUi } from "@/lib/i18n/ledger-ui";

import h from "./home.module.css";
import s from "./Sections.module.css";

export async function CompanyIntro({ extra = [] }: { extra?: readonly string[] } = {}) {
  const [t, locale] = await Promise.all([getTranslations("home.company"), getLocale()]);
  const body = [...(t.raw("body") as string[]), ...extra];

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
            <span>{t("signaturePrefix")}</span> <b>{ledgerUi(locale).representative}</b>
          </p>
        </div>
      </div>
    </section>
  );
}

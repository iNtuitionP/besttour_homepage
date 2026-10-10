/**
 * 섹션 7 — 회사 소개 · 인사말 요약 (#company). 서버 컴포넌트.
 *
 * 문구는 옛 사이트 인사말 원문(docs/ops/legacy-content-inventory.md §2)에서 3문장만 — "한해 70만 명 이상 외국인 관광객"
 * 문장은 실증 불가 수치라 제외했다(브리프 §7). 대표 서명은 원장 COMPANY.representative.
 * /about(P6-3)은 같은 컴포넌트를 재사용하고 `extra` 로 안전한 2문장(ko.json pages.about.more)만 본문 뒤에 덧붙인다 —
 * 인사말 lead·body 가 ko.json 에 두 번 있지 않도록(tests/pages.test.ts). /about 은 `showEyebrow={false}` 로 소제목을 끈다(사장님 요청 3 ·
 * tests/about-owner-requests.test.ts). 목업 #company 의 강점 6개는 옮기지 않는다 —
 * 제목만 옮기던 강점 띠(옛 ServiceStrip)는 사장님 요청 23(2026-10-10)으로 지웠다.
 */
import { getLocale, getTranslations } from "next-intl/server";

import { ledgerUi } from "@/lib/i18n/ledger-ui";

import h from "./home.module.css";
import s from "./Sections.module.css";

export async function CompanyIntro({
  extra = [],
  showEyebrow = true,
}: {
  extra?: readonly string[];
  /**
   * 제목 위 작은 글씨 소제목(home.company.eyebrow). 홈은 기본값(true) 그대로다.
   * /about 은 false — 사장님 요청 3(2026-10-10): 페이지 제목 "회사소개" 바로 아래에 같은 소제목이 한 번 더 겹쳐 보였다.
   */
  showEyebrow?: boolean;
} = {}) {
  const [t, locale] = await Promise.all([getTranslations("home.company"), getLocale()]);
  const body = [...(t.raw("body") as string[]), ...extra];

  return (
    <section id="company" className={`${h.section} ${h.toneWhite}`} aria-labelledby="company-h" data-section="company">
      <div className={h.wrap}>
        <div className={s.company}>
          {showEyebrow ? <p className={h.eyebrow}>{t("eyebrow")}</p> : null}
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

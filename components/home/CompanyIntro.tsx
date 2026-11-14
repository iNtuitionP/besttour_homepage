/**
 * 섹션 7 — 회사 소개 · 인사말 요약 (#company). 서버 컴포넌트.
 *
 * 문구는 사장님이 준 CEO 인사말 원문 그대로(2026-11-14 — 옛 사이트 인사말 3문장을 대체). 이 인사말만은 원문대로
 * "베스트투어·베스트모빌리티" 두 이름을 쓴다(tests/brand-bestmobility.test.ts 의 예외). 서명은 회사 이름 줄 + "CEO" + 원장 COMPANY.representative.
 * /about(P6-3)은 같은 컴포넌트를 재사용한다 — 새 인사말이 "감사합니다." 로 끝나 옛 덧붙임 2문장(pages.about.more)은 뺐다.
 * `extra` 는 본문 뒤에 문장을 덧붙일 자리로 남겨 둔다. 인사말 lead·body 가 ko.json 에 두 번 있지 않도록(tests/pages.test.ts). /about 은 `showEyebrow={false}` 로 소제목을 끈다(사장님 요청 3 ·
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
            <span className={s.companySignOrg}>{t("signatureOrg")}</span>
            <span>{t("signaturePrefix")}</span> <b>{ledgerUi(locale).representative}</b>
          </p>
        </div>
      </div>
    </section>
  );
}

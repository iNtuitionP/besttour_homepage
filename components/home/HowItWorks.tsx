/**
 * 섹션 5 — 이용 절차 4단계 (.section.tone-white, 목업 variant-08 §03). 서버 컴포넌트.
 *
 * 단계 문구는 원장 GUIDE_SECTIONS.flow.steps 와 **같은 문구**(import) — /guide 와 진실이 하나다.
 * 목업의 단계별 설명문(사장님 확정·알림·결제)은 원장 4단계와 1:1 이 아니라 옮기지 않았다.
 * 아래 고지 3줄은 전부 원장: VERBATIM.bookingNotice · QUOTE_BASIS.line · PAYMENT.line.
 *
 * 로케일 (P2-6): 단계 문구·산정 기준·대금 지급은 원장 한국어 그대로(영문판은 컨트롤러가 따로 확정한다) —
 * en 에서는 단계 목록 위에 컨트롤러 확정 안내를 두고 한국어 블록에 lang="ko" 를 단다. verbatim 은 localizeVerbatim
 * (ko 는 원장 문자열 그 자체, en 은 컨트롤러 확정 영문). 섹션 머리(eyebrow·제목·설명)는 messages home.how.
 */
import { getLocale, getTranslations } from "next-intl/server";

import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { koLang, ledgerUi, localizeVerbatim } from "@/lib/i18n/ledger-ui";
import { GUIDE_SECTIONS, PAYMENT, QUOTE_BASIS, VERBATIM } from "@/lib/legal/disclosures";

import h from "./home.module.css";
import s from "./Sections.module.css";
import { RICH } from "./rich";
import { SectionHead } from "./SectionHead";

type GuideSection = (typeof GUIDE_SECTIONS)[number];
type FlowSection = Extract<GuideSection, { key: "flow" }>;
const isFlow = (section: GuideSection): section is FlowSection => section.key === "flow";

export async function HowItWorks() {
  const [t, locale] = await Promise.all([getTranslations("home.how"), getLocale()]);
  const flow = GUIDE_SECTIONS.find(isFlow);
  if (!flow) throw new Error("HowItWorks: GUIDE_SECTIONS 에 flow 절이 없다");
  const lang = koLang(locale);

  return (
    <section className={`${h.section} ${h.toneWhite}`} aria-labelledby="how-h" data-section="how">
      <div className={h.wrap}>
        <SectionHead id="how-h" eyebrow={t("eyebrow")} title={t.rich("title", RICH)} desc={t("desc")} />

        <OfficialKoreanNotice notice={ledgerUi(locale).officialNotice} />
        <ol className={s.steps} data-testid="how-steps" lang={lang}>
          {flow.steps.map((step, i) => (
            <li key={step} className={s.step}>
              <span className={s.stepNo} aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className={s.stepTitle}>{step}</h3>
            </li>
          ))}
        </ol>

        <div className={s.stepsNotes} data-testid="how-notes">
          <p className={s.stepsNote}>{localizeVerbatim(locale, VERBATIM.bookingNotice)}</p>
          <p className={s.stepsMeta} lang={lang}>
            {QUOTE_BASIS.line}
          </p>
          <p className={s.stepsMeta} lang={lang}>
            {PAYMENT.line}
          </p>
        </div>
      </div>
    </section>
  );
}

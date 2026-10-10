/**
 * 섹션 5 — 이용 절차 4단계 (.section.tone-white, 목업 variant-08 §03). 서버 컴포넌트.
 *
 * 단계 문구는 원장 GUIDE_SECTIONS.flow.steps 와 **같은 문구**(import) — /guide 와 진실이 하나다.
 * 목업의 단계별 설명문(사장님 확정·알림·결제)은 원장 4단계와 1:1 이 아니라 옮기지 않았다.
 * 아래 고지는 원장 한 줄: QUOTE_BASIS.line(견적 산정 기준 — 전자상거래법 §13②3호).
 * 사장님 요청 7 · 20 · 결정 3-2 · 3-5(2026-10-10 · T2-2): verbatim(VERBATIM.bookingNotice)과 대금 지급 줄(PAYMENT.line)을 여기서 뺐다.
 * verbatim 은 견적 모달 제출 위·완료 화면에만, 대금 지급 줄은 견적 모달("자세히 보기" 안)·/guide 에 남는다(§13② 계약 전 표시).
 *
 * 로케일 (P2-6 · P7-4 후속 ①): 단계 문구는 en 이면 원장의 영문 단계 GUIDE_SECTIONS.flow.stepsEn(컨트롤러 작성 — /guide 의 한국어
 * 원문이 정본), 그 밖은 원장 steps 그대로 — 단계 목록에는 lang 을 달지 않는다(en 은 영문이다). 산정 기준은 원장 한국어 그대로라
 * 그 줄에만 lang="ko" 를 달고, 컨트롤러 확정 안내(OfficialKoreanNotice — "아래 한국어가 정본")는 **그 줄 바로 위**에 둔다
 * (영문 단계 위에 두면 안내가 영문을 가리킨다). ko 화면에서는 안내가 렌더되지 않는다(tests/how-it-works.test.ts KO_GOLDEN).
 * 섹션 머리(eyebrow·제목·설명)는 messages home.how.
 */
import { getLocale, getTranslations } from "next-intl/server";

import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import { GUIDE_SECTIONS, QUOTE_BASIS } from "@/lib/legal/disclosures";

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
  const steps: readonly string[] = locale === "en" ? flow.stepsEn : flow.steps;

  return (
    <section className={`${h.section} ${h.toneWhite}`} aria-labelledby="how-h" data-section="how">
      <div className={h.wrap}>
        <SectionHead id="how-h" eyebrow={t("eyebrow")} title={t.rich("title", RICH)} desc={t("desc")} />

        <ol className={s.steps} data-testid="how-steps">
          {steps.map((step, i) => (
            <li key={step} className={s.step}>
              <span className={s.stepNo} aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className={s.stepTitle}>{step}</h3>
            </li>
          ))}
        </ol>

        <div className={s.stepsNotes} data-testid="how-notes">
          <OfficialKoreanNotice notice={ledgerUi(locale).officialNotice} />
          <p className={s.stepsMeta} lang={lang}>
            {QUOTE_BASIS.line}
          </p>
        </div>
      </div>
    </section>
  );
}

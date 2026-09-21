/**
 * /guide — 이용안내 (전자상거래법 §13② 거래조건 표시 + 기존 메뉴 계승).
 * 절 순서·제목은 원장 GUIDE_SECTIONS. verbatim 2건은 견적 산정 기준 절 위에 VERBATIM 에서 렌더한다(CLAUDE.md §3).
 * 취소·환불은 열 표(4행), basis 가 deposit 이면 표 위에 depositNote. 연락처는 레코드 표 — 빈 필드는 숨긴다.
 *
 * 영문(/en/guide · P2-6): 페이지 제목만 영문(ledgerUi)이고 **본문은 원장 한국어 그대로**다(절 제목·표 머리·verbatim 포함 —
 * 법정 문서 한 벌을 섞지 않는다). 본문 위에 컨트롤러 확정 안내, 본문에 lang="ko". ko 화면은 안내도 lang 도 내지 않는다.
 */
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalList, LegalParagraph, LegalSection } from "@/components/legal/LegalArticle";
import { LegalPageHeader } from "@/components/legal/LegalPageHeader";
import { LegalRecordList, LegalTable } from "@/components/legal/LegalTable";
import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import {
  CANCELLATION,
  COMPANY,
  DISPUTE,
  GUIDE_SECTIONS,
  INSURANCE,
  LEGAL_LABELS,
  MINORS,
  PAYMENT,
  QUOTE_BASIS,
  VERBATIM,
} from "@/lib/legal/disclosures";
import { pageAlternates } from "@/lib/site-url";
import styles from "@/components/legal/legal.module.css";

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: ledgerUi(locale).pages.guide,
    robots: { index: true, follow: true },
    // 옛 견적 안내(`?bo_page=estimate`)의 301 목적지. 정본은 요청 로케일의 경로, 언어 대안은 ko·en·x-default — P2-6.
    alternates: pageAlternates("/guide", locale),
  };
}

type Section = (typeof GUIDE_SECTIONS)[number];

const CANCEL_COLUMNS = [
  { key: "when", label: LEGAL_LABELS.cancellation.when },
  { key: "label", label: LEGAL_LABELS.cancellation.label },
] as const;

function SectionBody({ section }: { section: Section }) {
  switch (section.key) {
    case "flow":
      return <LegalList items={section.steps} ordered />;
    case "quoteBasis":
      return <LegalParagraph text={QUOTE_BASIS.line} />;
    case "payment":
      return <LegalParagraph text={PAYMENT.line} />;
    case "cancel":
      return (
        <>
          {CANCELLATION.basis === "deposit" ? <p className={styles.tableNote}>{CANCELLATION.depositNote}</p> : null}
          <LegalTable columns={CANCEL_COLUMNS} rows={CANCELLATION.tiers} testId="cancellation" />
          <p className={styles.tableNote}>{CANCELLATION.referenceTime}</p>
        </>
      );
    case "insurance":
      return <LegalParagraph text={INSURANCE.body} />;
    case "dispute":
      return (
        <>
          <LegalParagraph text={DISPUTE.channel} />
          <LegalParagraph text={DISPUTE.handling} />
          <LegalParagraph text={DISPUTE.mediation} />
        </>
      );
    case "minors":
      return <LegalParagraph text={MINORS.line} />;
    case "contact": {
      const rec = Object.fromEntries(section.fields.map((f) => [f, COMPANY[f]]));
      return <LegalRecordList labels={LEGAL_LABELS.contact} records={[rec]} testId="contact" />;
    }
  }
}

export default async function GuidePage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ui = ledgerUi(locale);

  return (
    <>
      <LegalPageHeader title={ui.pages.guide} effectiveDateLabel={ui.labels.effectiveDate} />
      <OfficialKoreanNotice notice={ui.officialNotice} />
      <div data-testid="guide-sections" lang={koLang(locale)}>
        {GUIDE_SECTIONS.map((s) => (
          <div key={s.key}>
            {s.key === "quoteBasis" ? (
              <aside className={styles.notice} data-testid="verbatim">
                <p>{VERBATIM.bookingNotice}</p>
                <p>{VERBATIM.showcaseNotice}</p>
              </aside>
            ) : null}
            <LegalSection id={s.key} title={s.title}>
              <SectionBody section={s} />
            </LegalSection>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * /guide — 이용안내 (전자상거래법 §13② 거래조건 표시 + 기존 메뉴 계승).
 * 절 순서·제목은 원장 GUIDE_SECTIONS. verbatim 2건은 견적 산정 기준 절 위에 VERBATIM 에서 렌더한다(CLAUDE.md §3).
 * 취소·환불은 열 표(4행), basis 가 deposit 이면 표 위에 depositNote. 연락처는 레코드 표 — 빈 필드는 숨긴다.
 */
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalList, LegalParagraph, LegalSection } from "@/components/legal/LegalArticle";
import { LegalPageHeader } from "@/components/legal/LegalPageHeader";
import { LegalRecordList, LegalTable } from "@/components/legal/LegalTable";
import {
  CANCELLATION,
  COMPANY,
  DISPUTE,
  GUIDE_SECTIONS,
  INSURANCE,
  LEGAL_LABELS,
  LEGAL_PAGES,
  MINORS,
  PAYMENT,
  QUOTE_BASIS,
  VERBATIM,
} from "@/lib/legal/disclosures";
import styles from "@/components/legal/legal.module.css";

export function generateMetadata(): Metadata {
  return {
    title: LEGAL_PAGES.guide.title,
    robots: { index: true, follow: true },
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

export default async function GuidePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <LegalPageHeader title={LEGAL_PAGES.guide.title} />
      <div data-testid="guide-sections">
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

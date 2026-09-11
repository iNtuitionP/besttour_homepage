/**
 * /privacy — 개인정보 처리방침 (PIPA §30① · 시행령 §31).
 * 절 순서·제목은 원장 PRIVACY_POLICY_SECTIONS, 각 절의 내용은 그 절이 가리키는 원장 상수를 key 로 골라 렌더한다.
 * 미확정 필드("")는 LegalRecordList 가 행을 숨긴다 — 빈 <td> 를 내지 않는다.
 */
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalList, LegalParagraph, LegalSection } from "@/components/legal/LegalArticle";
import { LegalPageHeader } from "@/components/legal/LegalPageHeader";
import { LegalRecordList } from "@/components/legal/LegalTable";
import {
  COMPANY,
  LEGAL_LABELS,
  LEGAL_PAGES,
  OVERSEAS_TRANSFERS,
  PRIVACY_NOTICE,
  PRIVACY_POLICY_SECTIONS,
  PROCESSORS,
} from "@/lib/legal/disclosures";

export function generateMetadata(): Metadata {
  return {
    title: LEGAL_PAGES.privacy.title,
    robots: { index: true, follow: true },
  };
}

type Section = (typeof PRIVACY_POLICY_SECTIONS)[number];

function SectionBody({ section }: { section: Section }) {
  if ("body" in section) return <LegalParagraph text={section.body} />;
  switch (section.key) {
    case "purpose":
      return <LegalParagraph text={PRIVACY_NOTICE.purpose} />;
    case "items":
      return <LegalList items={PRIVACY_NOTICE.items} />;
    case "retention":
      return <LegalParagraph text={PRIVACY_NOTICE.retention} />;
    case "processors":
      return (
        <LegalRecordList labels={LEGAL_LABELS.processor} records={PROCESSORS} titleKey="name" testId="processors" />
      );
    case "overseas":
      return (
        <LegalRecordList
          labels={LEGAL_LABELS.overseas}
          records={OVERSEAS_TRANSFERS}
          titleKey="recipient"
          testId="overseas"
        />
      );
    case "publicFeed":
      return <LegalParagraph text={PRIVACY_NOTICE.publicFeedNotice} />;
    case "officer":
      return <LegalRecordList labels={LEGAL_LABELS.officer} records={[COMPANY.privacyOfficer]} testId="officer" />;
  }
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <LegalPageHeader title={LEGAL_PAGES.privacy.title} effectiveDate={LEGAL_PAGES.privacy.effectiveDate} />
      <div data-testid="privacy-sections">
        {PRIVACY_POLICY_SECTIONS.map((s) => (
          <LegalSection key={s.key} id={s.key} title={s.title}>
            <SectionBody section={s} />
          </LegalSection>
        ))}
      </div>
    </>
  );
}

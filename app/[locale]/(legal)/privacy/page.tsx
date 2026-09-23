/**
 * /privacy — 개인정보 처리방침 (PIPA §30① · 시행령 §31).
 * 절 순서·제목은 원장 PRIVACY_POLICY_SECTIONS, 각 절의 내용은 그 절이 가리키는 원장 상수를 key 로 골라 렌더한다.
 * 미확정 필드("")는 LegalRecordList 가 행을 숨긴다 — 빈 <td> 를 내지 않는다.
 *
 * 영문(/en/privacy · P2-6): 페이지 제목·시행일 라벨만 영문(ledgerUi)이고 **본문은 원장 한국어 그대로**다 — 절 제목·표 머리 포함.
 * 법정 문서의 영문판은 컨트롤러가 따로 확정한다(브리프 §3). 본문 위에 컨트롤러 확정 안내를 두고 본문에 lang="ko" 를 단다.
 * ko 화면은 안내도 lang 속성도 내지 않는다(마크업 불변).
 *
 * 방문 통계(P1-7 R2): 국외이전 절의 방문 통계 항목(VISITOR_STATS_TRANSFER) 바로 아래에 '방문 통계 거부' 버튼(AnalyticsOptOut — 클라이언트).
 * 버튼 라벨은 로케일 라벨(ledgerUi — ko 원장 LEGAL_LABELS.analyticsOptOut · en en.json)이다.
 */
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalList, LegalParagraph, LegalSection } from "@/components/legal/LegalArticle";
import { LegalPageHeader } from "@/components/legal/LegalPageHeader";
import { AnalyticsOptOut } from "@/components/legal/AnalyticsOptOut";
import { LegalRecordList } from "@/components/legal/LegalTable";
import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import {
  COMPANY,
  LEGAL_LABELS,
  LEGAL_PAGES,
  OVERSEAS_TRANSFERS,
  PRIVACY_NOTICE,
  PRIVACY_POLICY_SECTIONS,
  PROCESSORS,
  VISITOR_STATS_TRANSFER,
} from "@/lib/legal/disclosures";
import { pageAlternates } from "@/lib/site-url";

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: ledgerUi(locale).pages.privacy,
    robots: { index: true, follow: true },
    // 정본은 요청 로케일의 경로(ko `/privacy` · en `/en/privacy`), 언어 대안은 ko·en·x-default — P2-6.
    alternates: pageAlternates("/privacy", locale),
  };
}

type Section = (typeof PRIVACY_POLICY_SECTIONS)[number];

function SectionBody({ section, ui }: { section: Section; ui: ReturnType<typeof ledgerUi> }) {
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
    case "overseas": {
      // P1-7 R2 — 방문 통계 항목(VISITOR_STATS_TRANSFER) 바로 아래에 거부 버튼을 둔다. 원장 문구가 "이 항목의 '방문 통계 거부' 버튼" 이라고
      // 가리키므로 버튼이 그 항목에 붙어 있어야 한다. 자리는 같은 참조로 찾는다(문자열 비교 없이).
      const cut = OVERSEAS_TRANSFERS.indexOf(VISITOR_STATS_TRANSFER) + 1;
      return (
        <>
          <LegalRecordList labels={LEGAL_LABELS.overseas} records={OVERSEAS_TRANSFERS.slice(0, cut)} titleKey="recipient" testId="overseas" />
          <AnalyticsOptOut labels={ui.labels.analyticsOptOut} />
          <LegalRecordList labels={LEGAL_LABELS.overseas} records={OVERSEAS_TRANSFERS.slice(cut)} titleKey="recipient" testId="overseas-rest" />
        </>
      );
    }
    case "publicFeed":
      return <LegalParagraph text={PRIVACY_NOTICE.publicFeedNotice} />;
    case "officer":
      return <LegalRecordList labels={LEGAL_LABELS.officer} records={[COMPANY.privacyOfficer]} testId="officer" />;
  }
}

export default async function PrivacyPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ui = ledgerUi(locale);

  return (
    <>
      <LegalPageHeader
        title={ui.pages.privacy}
        effectiveDate={LEGAL_PAGES.privacy.effectiveDate}
        effectiveDateLabel={ui.labels.effectiveDate}
      />
      <OfficialKoreanNotice notice={ui.officialNotice} />
      <div data-testid="privacy-sections" lang={koLang(locale)}>
        {PRIVACY_POLICY_SECTIONS.map((s) => (
          <LegalSection key={s.key} id={s.key} title={s.title}>
            <SectionBody section={s} ui={ui} />
          </LegalSection>
        ))}
      </div>
    </>
  );
}

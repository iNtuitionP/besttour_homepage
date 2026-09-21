/**
 * /terms — 이용약관 (전자상거래법 §10①5호). 문구는 원장 TERMS·LEGAL_PAGES 에서만 온다.
 *
 * 영문(/en/terms · P2-6): 페이지 제목·시행일 라벨만 영문(ledgerUi)이고 **조문은 원장 한국어 그대로**다(조 번호·조 제목 포함) —
 * 법정 문서의 진실은 ko 이고 영문판은 컨트롤러가 따로 확정한다(브리프 §3). 조문 위에 컨트롤러 확정 안내, 조문에 lang="ko".
 */
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalArticle } from "@/components/legal/LegalArticle";
import { LegalPageHeader } from "@/components/legal/LegalPageHeader";
import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import { LEGAL_PAGES, TERMS } from "@/lib/legal/disclosures";
import { pageAlternates } from "@/lib/site-url";

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: ledgerUi(locale).pages.terms,
    robots: { index: true, follow: true },
    // 정본은 요청 로케일의 경로(ko `/terms` · en `/en/terms`), 언어 대안은 ko·en·x-default — P2-6.
    alternates: pageAlternates("/terms", locale),
  };
}

export default async function TermsPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ui = ledgerUi(locale);

  return (
    <>
      <LegalPageHeader
        title={ui.pages.terms}
        effectiveDate={LEGAL_PAGES.terms.effectiveDate}
        effectiveDateLabel={ui.labels.effectiveDate}
      />
      <OfficialKoreanNotice notice={ui.officialNotice} />
      <div data-testid="terms-articles" lang={koLang(locale)}>
        {TERMS.articles.map((a) => (
          <LegalArticle key={a.no} no={a.no} title={a.title} body={a.body} />
        ))}
      </div>
    </>
  );
}

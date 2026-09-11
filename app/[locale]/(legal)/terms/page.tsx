/**
 * /terms — 이용약관 (전자상거래법 §10①5호). 문구는 원장 TERMS·LEGAL_PAGES 에서만 온다.
 * 영문(/en/terms)도 같은 한국어를 렌더한다 — 법정 문서의 진실은 ko (브리프 §2).
 */
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalArticle } from "@/components/legal/LegalArticle";
import { LegalPageHeader } from "@/components/legal/LegalPageHeader";
import { LEGAL_PAGES, TERMS } from "@/lib/legal/disclosures";

export function generateMetadata(): Metadata {
  return {
    title: LEGAL_PAGES.terms.title,
    robots: { index: true, follow: true },
  };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <LegalPageHeader title={LEGAL_PAGES.terms.title} effectiveDate={LEGAL_PAGES.terms.effectiveDate} />
      <div data-testid="terms-articles">
        {TERMS.articles.map((a) => (
          <LegalArticle key={a.no} no={a.no} title={a.title} body={a.body} />
        ))}
      </div>
    </>
  );
}

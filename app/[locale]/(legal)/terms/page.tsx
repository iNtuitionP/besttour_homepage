/**
 * /terms — 이용약관 (전자상거래법 §10①5호). 문구는 원장 TERMS·LEGAL_PAGES·WITHDRAWAL 에서만 온다.
 *
 * 제8조(청약철회) 본문 바로 아래에 원장 WITHDRAWAL.notice(사장님 확정 청약철회 제한 고지 — P1-7 브리프 1-B, 계약 전 고지의 두 번째 층)를
 * 붙인다. 조문 본문은 바꾸지 않는다 — 고지는 조문 뒤의 별도 문단이다. 영문 화면은 그 고지만 번역본(noticeEn)을 먼저 싣는다(R2).
 *
 * 영문(/en/terms · P2-6): 페이지 제목·시행일 라벨만 영문(ledgerUi)이고 **조문은 원장 한국어 그대로**다(조 번호·조 제목 포함) —
 * 법정 문서의 진실은 ko 이고 영문판은 컨트롤러가 따로 확정한다(브리프 §3). 조문 위에 컨트롤러 확정 안내, 조문에 lang="ko".
 *
 * 취소·환불 개정(OF-T2-3 · 사장님 요청 16 · 결정 4 B안): 제7조 아래 적용 범위와 제8조 아래 청약철회 고지는 **렌더 시각의 판**이다
 * (lib/refund-policy.ts refundPolicyAt). 제7조는 "이용안내에 게시된 취소·환불 규정" 을 가리키므로, 시행일 전에는 그 아래에
 * 예고 상자(RefundPolicyChangeNotice — en 은 영문 번역 먼저)를 함께 둔다. 시행일부터는 개정 규정의 범위·고지만. ISR 은 /guide 와 같다.
 */
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalArticle } from "@/components/legal/LegalArticle";
import { LegalPageHeader } from "@/components/legal/LegalPageHeader";
import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { RefundPolicyChangeNotice } from "@/components/legal/RefundPolicyChangeNotice";
import { WithdrawalRestrictionText } from "@/components/legal/WithdrawalRestrictionText";
import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import { publicDateLabelsFor } from "@/lib/i18n/public-dates";
import { refundChangeTexts } from "@/lib/i18n/refund-change";
import { LEGAL_PAGES, TERMS } from "@/lib/legal/disclosures";
import { formatPublicDate } from "@/lib/public-date";
import { refundPolicyAt } from "@/lib/refund-policy";
import { pageAlternates } from "@/lib/site-url";
import styles from "@/components/legal/legal.module.css";

/** ISR — 제7조·제8조 아래 고지가 시행일(KST 자정)에 개정 규정으로 바뀌어야 한다(/guide 와 같은 주기 · 보고서 ④). */
export const revalidate = 600;

/** 청약철회 조 — TERMS.articles 의 no. tests/legal-pages.test.ts 가 이 조의 제목이 "청약철회" 임을 단언한다. */
const WITHDRAWAL_ARTICLE_NO = 8;
/** 취소·환불 조 — 본문이 "이용안내에 게시된 취소·환불 규정에 따릅니다" 라고만 하므로, 그 규정의 **적용 범위**를 조 아래에 함께 둔다(R3 [P2-F]). */
const CANCEL_ARTICLE_NO = 7;

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
  // 렌더 순간의 판(OF-T2-3) — 제7조 범위 · 예고 · 제8조 고지가 같은 판을 쓴다.
  const now = new Date();
  const { cancellation, withdrawal } = refundPolicyAt(now);
  const change = refundChangeTexts("ko", now);
  const changeEn = locale === "en" ? refundChangeTexts("en", now) : null;

  return (
    <>
      <LegalPageHeader
        title={ui.pages.terms}
        effectiveDate={LEGAL_PAGES.terms.effectiveDate}
        effectiveDateText={formatPublicDate(LEGAL_PAGES.terms.effectiveDate, publicDateLabelsFor(locale), { style: "posted" })}
        effectiveDateLabel={ui.labels.effectiveDate}
      />
      <OfficialKoreanNotice notice={ui.officialNotice} />
      <div data-testid="terms-articles" lang={koLang(locale)}>
        {TERMS.articles.map((a) => (
          <LegalArticle key={a.no} no={a.no} title={a.title} body={a.body}>
            {a.no === CANCEL_ARTICLE_NO ? (
              <>
                <p className={styles.body} data-legal="cancellation-scope">
                  {cancellation.scope}
                </p>
                {change ? <RefundPolicyChangeNotice notice={change.notice} noticeEn={changeEn?.notice ?? null} /> : null}
              </>
            ) : null}
            {a.no === WITHDRAWAL_ARTICLE_NO ? (
              <WithdrawalRestrictionText notice={withdrawal.notice} noticeEn={withdrawal.noticeEn} locale={locale} className={styles.body} />
            ) : null}
          </LegalArticle>
        ))}
      </div>
    </>
  );
}

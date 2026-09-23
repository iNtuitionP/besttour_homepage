/**
 * /guide — 이용안내 (전자상거래법 §13② 거래조건 표시 + 기존 메뉴 계승).
 * 절 순서·제목은 원장 GUIDE_SECTIONS. verbatim 2건은 견적 산정 기준 절 위에 VERBATIM 에서 렌더한다(CLAUDE.md §3).
 * 취소·환불은 열 표(2행 — 사장님 답변 2026-09-21 A-1), basis 가 deposit 이면 표 위에 depositNote. 표·기준 시각 바로 아래에
 * 청약철회 제한 고지(원장 WITHDRAWAL.notice — 계약 전 고지의 두 번째 층, P1-7 브리프 1-B · 영문 화면은 번역본 noticeEn 도 — R2).
 * 대금 지급 절에는 입금 계좌(PAYMENT.accountLine)와 관계사 고지(RELATED_COMPANY.note)를 함께 싣는다(R2 — 법정 페이지에는 푸터가 없다).
 * 연락처는 레코드 표 — 빈 필드는 숨긴다.
 * 연락처 첫 줄은 예약·상담 전화(P1-7) — 번호 표기만 로케일을 따른다(en +82). 라벨·나머지 값은 원장 한국어 그대로다.
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
import { WithdrawalRestrictionText } from "@/components/legal/WithdrawalRestrictionText";
import { consultPhone } from "@/lib/contact-phone";
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
  RELATED_COMPANY,
  VERBATIM,
  WITHDRAWAL,
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

function SectionBody({ section, locale }: { section: Section; locale: string }) {
  switch (section.key) {
    case "flow":
      return <LegalList items={section.steps} ordered />;
    case "quoteBasis":
      return <LegalParagraph text={QUOTE_BASIS.line} />;
    case "payment":
      // P1-7 R2: 법정 페이지에는 사이트 푸터가 없다 — 대금을 관계사 명의 계좌로 받는다는 사실을 여기 싣는다.
      return (
        <>
          <LegalParagraph text={PAYMENT.line} />
          <LegalParagraph text={PAYMENT.accountLine} />
          <LegalParagraph text={RELATED_COMPANY.note} />
        </>
      );
    case "cancel":
      return (
        <>
          {CANCELLATION.basis === "deposit" ? <p className={styles.tableNote}>{CANCELLATION.depositNote}</p> : null}
          <LegalTable columns={CANCEL_COLUMNS} rows={CANCELLATION.tiers} testId="cancellation" />
          <p className={styles.tableNote}>{CANCELLATION.referenceTime}</p>
          {/* R3 [P2-F]: 표의 적용 범위(고객 사정 취소 · 법정 권리 보존) — 표 바로 아래 */}
          <p className={styles.tableNote} data-legal="cancellation-scope">
            {CANCELLATION.scope}
          </p>
          <WithdrawalRestrictionText notice={WITHDRAWAL.notice} noticeEn={WITHDRAWAL.noticeEn} locale={locale} className={styles.body} />
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
      // 예약·상담 전화는 로케일 표기(en +82 — 해외 방문자가 국가번호를 알 수 있게). 나머지는 원장 값 그대로.
      const rec = Object.fromEntries(
        section.fields.map((f) => [f, f === "consultTel" ? consultPhone(locale).display : COMPANY[f]]),
      );
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
              <SectionBody section={s} locale={locale} />
            </LegalSection>
          </div>
        ))}
      </div>
    </>
  );
}

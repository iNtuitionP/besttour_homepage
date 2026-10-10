/**
 * /guide — 이용안내 (전자상거래법 §13② 거래조건 표시 + 기존 메뉴 계승).
 * 절 순서·제목은 원장 GUIDE_SECTIONS. 견적 산정 기준 절 위의 안내 상자에는 Top-5 고지 verbatim(VERBATIM.showcaseNotice) 하나를 렌더한다(CLAUDE.md §3).
 * 접수 안내 verbatim(VERBATIM.bookingNotice)은 사장님 요청 7 · 결정 3-2(2026-10-10 · T2-2)로 이 상자에서 뺐다 — 그 문장은 견적 모달 제출 위 ·
 * 완료 화면 · 예약 확인 카드(접수 상태)에만 둔다. 대금 지급 절(PAYMENT.line)은 그대로다(전자상거래법 §13② 계약 전 표시).
 * 취소·환불은 열 표(2행 — 사장님 답변 2026-09-21 A-1), basis 가 deposit 이면 표 위에 depositNote. 표·기준 시각 바로 아래에
 * 청약철회 제한 고지(원장 WITHDRAWAL.notice — 계약 전 고지의 두 번째 층, P1-7 브리프 1-B · 영문 화면은 번역본 noticeEn 도 — R2).
 * 대금 지급 절에는 입금 계좌(PAYMENT.accountLine)와 관계사 고지(RELATED_COMPANY.note)를 함께 싣는다(R2 — 법정 페이지에는 푸터가 없다).
 * 연락처는 레코드 표 — 빈 필드는 숨긴다.
 * 연락처 첫 줄은 예약·상담 전화(P1-7) — 번호 표기만 로케일을 따른다(en +82). 라벨·나머지 값은 원장 한국어 그대로다.
 * 사이트의 전화번호는 예약·상담 전화 하나다(P7-5 — 휴대전화 줄은 지웠다).
 *
 * 영문(/en/guide · P2-6): 페이지 제목만 영문(ledgerUi)이고 **본문은 원장 한국어 그대로**다(절 제목·표 머리·verbatim 포함 —
 * 법정 문서 한 벌을 섞지 않는다). 본문 위에 컨트롤러 확정 안내, 본문에 lang="ko". ko 화면은 안내도 lang 도 내지 않는다.
 *
 * 취소·환불 개정(OF-T2-3 · 사장님 요청 16 · 결정 4 B안): 취소·환불 절의 표·기준·범위·청약철회 고지는 **렌더 시각의 판**이다
 * (lib/refund-policy.ts refundPolicyAt — 시행일 원장 REFUND_POLICY_EFFECTIVE_FROM, KST 날짜).
 *   시행일 전: "현재 규정 — {전날} 접수분까지 적용" 머리 → 지금 규정(옛 판) 그대로 → 예고 상자(en 은 영문 번역 먼저) →
 *              "변경 예정 — {시행일} 접수분부터 적용" 머리 아래 개정 규정 전문(표 · 기준 · 범위 · 청약철회 고지 — 표지는 `-next`).
 *   시행일부터: 개정 규정만(머리·예고·변경 예정 묶음 없음 — 시행일 전과 같은 마크업·표지).
 * 정적 페이지가 시행일에 저절로 바뀌도록 ISR(revalidate)로 다시 렌더한다 — 홈(견적 모달)과 같은 주기.
 */
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalList, LegalParagraph, LegalSection } from "@/components/legal/LegalArticle";
import { LegalPageHeader } from "@/components/legal/LegalPageHeader";
import { LegalRecordList, LegalTable } from "@/components/legal/LegalTable";
import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { RefundPolicyChangeNotice } from "@/components/legal/RefundPolicyChangeNotice";
import { WithdrawalRestrictionText } from "@/components/legal/WithdrawalRestrictionText";
import { consultPhone, localPhone } from "@/lib/contact-phone";
import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import { refundChangeTexts } from "@/lib/i18n/refund-change";
import {
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
} from "@/lib/legal/disclosures";
import { refundPolicyAt, upcomingRefundPolicy } from "@/lib/refund-policy";
import { pageAlternates } from "@/lib/site-url";
import styles from "@/components/legal/legal.module.css";

/**
 * ISR — 취소·환불 절이 시행일(KST 자정)에 개정 규정으로 바뀌어야 한다. 완전 정적이면 다음 배포까지 옛 규정이 남는다.
 * 600초 = 홈(견적 모달)과 같은 주기. 시행일 자정 직후 최대 한 주기 동안은 직전 렌더(옛 판 + 예고)가 보일 수 있다(보고서 ④).
 */
export const revalidate = 600;

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

function SectionBody({ section, locale, now }: { section: Section; locale: string; now: Date }) {
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
    case "cancel": {
      // 렌더 시각의 판(OF-T2-3). 본문은 원장 한국어라 머리·예고도 한국어(ko 틀), 영문 화면은 예고만 영문 번역을 먼저 싣는다.
      const { cancellation, withdrawal } = refundPolicyAt(now);
      const next = upcomingRefundPolicy(now);
      const change = refundChangeTexts("ko", now);
      const changeEn = locale === "en" ? refundChangeTexts("en", now) : null;
      return (
        <>
          {change ? (
            <p className={styles.policyTitle} data-legal="refund-policy-current-title">
              {change.currentTitle}
            </p>
          ) : null}
          {cancellation.basis === "deposit" ? <p className={styles.tableNote}>{cancellation.depositNote}</p> : null}
          <LegalTable columns={CANCEL_COLUMNS} rows={cancellation.tiers} testId="cancellation" />
          <p className={styles.tableNote}>{cancellation.referenceTime}</p>
          {/* R3 [P2-F]: 표의 적용 범위(고객 사정 취소 · 법정 권리 보존) — 표 바로 아래 */}
          <p className={styles.tableNote} data-legal="cancellation-scope">
            {cancellation.scope}
          </p>
          <WithdrawalRestrictionText notice={withdrawal.notice} noticeEn={withdrawal.noticeEn} locale={locale} className={styles.body} />
          {change && next ? (
            <div className={styles.policyNext} data-legal="refund-policy-next">
              <RefundPolicyChangeNotice notice={change.notice} noticeEn={changeEn?.notice ?? null} />
              <p className={styles.policyTitle} data-legal="refund-policy-next-title">
                {change.nextTitle}
              </p>
              <LegalTable columns={CANCEL_COLUMNS} rows={next.cancellation.tiers} testId="cancellation-next" />
              <p className={styles.tableNote}>{next.cancellation.referenceTime}</p>
              <p className={styles.tableNote} data-legal="cancellation-scope-next">
                {next.cancellation.scope}
              </p>
              {changeEn ? (
                <p className={styles.body} data-legal="withdrawal-restriction-next-en" lang="en">
                  {next.withdrawal.noticeEn}
                </p>
              ) : null}
              <p className={styles.body} data-legal="withdrawal-restriction-next">
                {next.withdrawal.notice}
              </p>
            </div>
          ) : null}
        </>
      );
    }
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
      // 예약·상담 전화는 로케일 표기(en +82 — 해외 방문자가 국가번호를 알 수 있게). 팩스도 en 은 +82 표기(P7-4 — localPhone,
      // 원장 값은 그대로 · 표시만). 메일·주소는 원장 값 그대로.
      // P7-5: 원장 COMPANY 에서 지운 필드(휴대전화)는 행을 내지 않는다 — fields 가 그 이름을 아직 담고 있어도 값이 없으면 건너뛴다
      // (모든 fields 가 COMPANY 의 문자열 필드인지는 tests/legal-pages.test.ts 가 따로 잠근다 — 조용한 누락이 되지 않게).
      const rec = Object.fromEntries(
        section.fields.flatMap((f: string) => {
          if (f === "consultTel") return [[f, consultPhone(locale).display]];
          const v = f in COMPANY ? COMPANY[f as keyof typeof COMPANY] : undefined;
          if (typeof v !== "string") return [];
          return [[f, f === "fax" ? localPhone(v, locale).display : v]];
        }),
      );
      return <LegalRecordList labels={LEGAL_LABELS.contact} records={[rec]} testId="contact" />;
    }
  }
}

export default async function GuidePage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ui = ledgerUi(locale);
  // 렌더 순간 — 취소·환불 절의 판을 정한다(OF-T2-3). 한 번 읽어 모든 절에 같은 값을 쓴다.
  const now = new Date();

  return (
    <>
      <LegalPageHeader title={ui.pages.guide} effectiveDateLabel={ui.labels.effectiveDate} />
      <OfficialKoreanNotice notice={ui.officialNotice} />
      <div data-testid="guide-sections" lang={koLang(locale)}>
        {GUIDE_SECTIONS.map((s) => (
          <div key={s.key}>
            {s.key === "quoteBasis" ? (
              <aside className={styles.notice} data-testid="verbatim">
                <p>{VERBATIM.showcaseNotice}</p>
              </aside>
            ) : null}
            <LegalSection id={s.key} title={s.title}>
              <SectionBody section={s} locale={locale} now={now} />
            </LegalSection>
          </div>
        ))}
      </div>
    </>
  );
}

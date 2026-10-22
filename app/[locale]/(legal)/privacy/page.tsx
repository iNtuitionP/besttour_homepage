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
 *
 * 처리방침 개정(OF3-H · 원장 PRIVACY_POLICY_REVISION — 네이버 프리미엄 로그 분석 도입):
 *   시행 전: 제목 아래에 개정 예정 안내 상자(공지일·시행일·요약) + '자동 수집 장치' 절 본문 뒤에 개정 문단(cookiesAddendum)을 "(시행일부터 적용)" 표지와 함께 미리 보인다.
 *            표시 시행일은 지금 유효한 판(LEGAL_PAGES.privacy.effectiveDate)이다.
 *   시행일(KST 00:00)부터: 안내 상자·표지가 사라지고 개정 문단이 절 본문의 일부로 이어 붙는다. 표시 시행일은 개정 시행일.
 *   판정은 lib/privacy-revision.ts 한 곳(동의 버전·네이버 스크립트 게이트와 같은 날짜 비교). 정적이면 시행일에 저절로 바뀌지 않으므로 /guide 와 같은 ISR 이다.
 *   안내 상자·표지의 라벨은 messages layout.privacyRevision(ko·en) — 한국어 요약·개정 문단은 원장 그대로이고 en 에서는 lang="ko" 로 표시한다.
 */
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalList, LegalParagraph, LegalSection } from "@/components/legal/LegalArticle";
import { LegalPageHeader } from "@/components/legal/LegalPageHeader";
import { AnalyticsOptOut } from "@/components/legal/AnalyticsOptOut";
import { LegalRecordList } from "@/components/legal/LegalTable";
import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { loadMessages } from "@/i18n/messages";
import { localPhone } from "@/lib/contact-phone";
import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import { publicDateLabelsFor } from "@/lib/i18n/public-dates";
import {
  COMPANY,
  LEGAL_LABELS,
  OVERSEAS_TRANSFERS,
  PRIVACY_NOTICE,
  PRIVACY_POLICY_ITEMS,
  PRIVACY_POLICY_REVISION,
  PRIVACY_POLICY_SECTIONS,
  PROCESSORS,
  VISITOR_STATS_TRANSFER,
} from "@/lib/legal/disclosures";
import { privacyEffectiveDate, privacyRevisionActive } from "@/lib/privacy-revision";
import { formatPublicDate } from "@/lib/public-date";
import { pageAlternates } from "@/lib/site-url";
import styles from "@/components/legal/legal.module.css";

/**
 * ISR — 개정 시행일(KST 자정)에 개정 예정 안내가 사라지고 개정 문단이 본문이 되어야 한다. 완전 정적이면 다음 배포까지 시행 전 모습이 남는다.
 * 600초 = /guide(취소·환불 시행일)와 같은 주기. 시행일 자정 직후 최대 한 주기 동안은 직전 렌더가 보일 수 있다.
 */
export const revalidate = 600;

type Params = Promise<{ locale: string }>;

/** layout.privacyRevision — 개정 안내 라벨(ko·en 카탈로그). 법정 페이지는 번역 훅을 쓰지 않고 순수 카탈로그 조회(loadMessages)로 읽는다(layout.tsx 와 같은 방식). */
interface RevisionCopy {
  upcomingTitle: string;
  upcomingIntro: string;
  appliesFromMark: string;
}
function revisionCopy(locale: string): RevisionCopy {
  return (loadMessages(locale).layout as { privacyRevision: RevisionCopy }).privacyRevision;
}

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

/**
 * 자동 수집 장치 절의 개정 문단(OF3-H). 시행 전에는 "(시행일부터 적용)" 표지를 달아 미리 보이고, 시행일부터는 표지 없이 본문에 이어 붙는다.
 * 같은 문단을 시행 전·후 모두 한 번만 싣는다(개정 예정 안내 상자에 되풀이하지 않는다). 표지는 화면 언어(en 은 영문)라 한국어 블록 안에서 lang 을 다시 단다.
 */
function CookiesAddendum({ active, locale, mark }: { active: boolean; locale: string; mark: string }) {
  return (
    <div className={active ? undefined : styles.addendumPending} data-legal="cookies-addendum" data-state={active ? "active" : "pending"}>
      {active ? null : (
        <p className={styles.policyTitle} data-legal="cookies-addendum-mark" lang={koLang(locale) ? locale : undefined}>
          {mark}
        </p>
      )}
      <LegalParagraph text={PRIVACY_POLICY_REVISION.cookiesAddendum} />
    </div>
  );
}

function SectionBody({
  section,
  ui,
  locale,
  revisionActive,
}: {
  section: Section;
  ui: ReturnType<typeof ledgerUi>;
  locale: string;
  revisionActive: boolean;
}) {
  if (section.key === "cookies") {
    return (
      <>
        <LegalParagraph text={section.body} />
        <CookiesAddendum active={revisionActive} locale={locale} mark={revisionCopy(locale).appliesFromMark} />
      </>
    );
  }
  if ("body" in section) return <LegalParagraph text={section.body} />;
  switch (section.key) {
    case "purpose":
      return <LegalParagraph text={PRIVACY_NOTICE.purpose} />;
    case "items":
      // 처리방침 항목 = 지금 받는 항목 + 옛 6단계 접수분의 보관 항목(P3-8 리뷰 P1-1). 동의 화면의 항목 목록(짧은 쪽)이 아니다.
      return <LegalList items={PRIVACY_POLICY_ITEMS} />;
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
          {/* 버튼 라벨은 화면 언어다(P7-4) — 둘러싼 본문이 en 화면에서 lang="ko" 라 버튼에 화면 언어를 다시 단다(ko 화면은 속성 없음) */}
          <AnalyticsOptOut labels={ui.labels.analyticsOptOut} lang={koLang(locale) ? locale : undefined} />
          <LegalRecordList labels={LEGAL_LABELS.overseas} records={OVERSEAS_TRANSFERS.slice(cut)} titleKey="recipient" testId="overseas-rest" />
        </>
      );
    }
    case "publicFeed":
      return <LegalParagraph text={PRIVACY_NOTICE.publicFeedNotice} />;
    case "officer":
      // 연락처는 en 에서 +82 표기(P7-4 — localPhone · 원장 값은 그대로, 표시만)
      return (
        <LegalRecordList
          labels={LEGAL_LABELS.officer}
          records={[{ ...COMPANY.privacyOfficer, phone: localPhone(COMPANY.privacyOfficer.phone, locale).display }]}
          testId="officer"
        />
      );
  }
}

export default async function PrivacyPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ui = ledgerUi(locale);
  // 렌더 순간 — 시행 전/후 한 번 읽어 표시 시행일·안내 상자·개정 문단이 모두 같은 판을 따른다(lib/privacy-revision.ts).
  const now = new Date();
  const revisionActive = privacyRevisionActive(now);
  const effectiveDate = privacyEffectiveDate(now);
  const dateLabels = publicDateLabelsFor(locale);
  const copy = revisionCopy(locale);

  return (
    <>
      <LegalPageHeader
        title={ui.pages.privacy}
        effectiveDate={effectiveDate}
        effectiveDateText={formatPublicDate(effectiveDate, dateLabels, { style: "posted" })}
        effectiveDateLabel={ui.labels.effectiveDate}
      />
      {revisionActive ? null : (
        <aside className={styles.notice} data-testid="privacy-revision-notice">
          <p className={styles.policyTitle}>{copy.upcomingTitle}</p>
          <p>
            {copy.upcomingIntro
              .replace("{date}", formatPublicDate(PRIVACY_POLICY_REVISION.effectiveDate, dateLabels, { style: "posted" }) ?? PRIVACY_POLICY_REVISION.effectiveDate)
              .replace("{announced}", formatPublicDate(PRIVACY_POLICY_REVISION.announcedOn, dateLabels, { style: "posted" }) ?? PRIVACY_POLICY_REVISION.announcedOn)}
          </p>
          <p lang={koLang(locale)}>{PRIVACY_POLICY_REVISION.summary}</p>
        </aside>
      )}
      <OfficialKoreanNotice notice={ui.officialNotice} />
      <div data-testid="privacy-sections" lang={koLang(locale)}>
        {PRIVACY_POLICY_SECTIONS.map((s) => (
          <LegalSection key={s.key} id={s.key} title={s.title}>
            <SectionBody section={s} ui={ui} locale={locale} revisionActive={revisionActive} />
          </LegalSection>
        ))}
      </div>
    </>
  );
}

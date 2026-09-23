/**
 * 원장 UI 문구 — 한국어 (P2-6). **원장 상수를 그대로 가리킨다 — 값을 여기 다시 적지 않는다.**
 *
 * 왜 따로 떼었나
 *   영문 쪽(lib/i18n/ledger-ui.ts)은 messages/en.json 을 import 한다. 클라이언트 컴포넌트((site)/error.tsx)가 한국어 라벨이
 *   필요할 때 영문 카탈로그 전체가 번들로 딸려 가지 않도록 한국어만 이 파일에 둔다. 서버 쪽은 ledgerUi(locale) 를 쓴다.
 *
 * 담는 것은 "번역해야 하는 원장 문구"뿐이다 — 라벨·제목·동의 체크박스 라벨·verbatim 두 문구·상호·대표자.
 * 법정 본문(취소환불·개인정보 고지·약관 조문·산정 기준 줄…)은 여기 없다. 그것들은 영문판을 만들지 않는다(브리프 §3) —
 * `/en` 에서도 원장 한국어를 그대로 렌더하고 그 위에 컨트롤러 확정 안내를 둔다(tests/i18n-en.test.ts §7 허용 목록).
 */
import {
  COMPANY,
  INSURANCE,
  LEGAL_LABELS,
  LEGAL_PAGES,
  PRIVACY_NOTICE,
  QUOTE_BASIS,
  RELATED_COMPANY,
  VERBATIM,
  WITHDRAWAL,
} from "@/lib/legal/disclosures";

/** 원장 한국어 블록 위에 두는 영문 안내(컨트롤러 확정) — 굵게 쓰는 첫 문장과 나머지. ko 에는 없다(null). */
export interface OfficialNotice {
  lead: string;
  body: string;
}

export interface LedgerUi {
  /** 상호(브랜드) — ko: COMPANY.brandName · en: COMPANY.brandNameEn */
  brand: string;
  /** 대표자 — ko: COMPANY.representative · en: COMPANY.representativeEn */
  representative: string;
  /** en 전용. ko 는 null — 한국어 화면에서는 원장 원문이 곧 정본이다. */
  officialNotice: OfficialNotice | null;
  /** CLAUDE.md §3 verbatim — ko 는 VERBATIM 그대로, en 은 컨트롤러 확정 영문 */
  verbatim: { bookingNotice: string; showcaseNotice: string };
  /** 법정 페이지 제목(LEGAL_PAGES.*.title) — 페이지 h1 · 푸터·법정 셸 링크 · 메타 제목 */
  pages: { privacy: string; terms: string; guide: string };
  /** 원장 블록을 소개하는 제목 — QUOTE_BASIS.title · INSURANCE.title · PRIVACY_NOTICE.title */
  headings: { quoteBasis: string; insurance: string; privacyNotice: string };
  /**
   * 위저드 동의 체크박스 라벨 — PRIVACY_NOTICE.consentLabel · marketingConsentLabel · WITHDRAWAL.consentLabel(P1-7).
   * withdrawal 의 영문은 en.json 이 아니라 **원장의 영문 필드**(WITHDRAWAL.consentLabelEn)에서 온다 — 브리프가 원장에 확정 영문을 두었다.
   */
  consent: { privacy: string; marketing: string; withdrawal: string };
  /** 푸터 관계사 배지 — RELATED_COMPANY.role */
  relatedRole: string;
  /** 원장 라벨(LEGAL_LABELS) 중 공개 셸·서브페이지가 쓰는 것 */
  labels: {
    effectiveDate: string;
    home: string;
    legalNav: string;
    /** tel = 대표전화(푸터 사업자 정보 한 줄) · consultTel = 예약·상담 전화(손님에게 안내하는 번호 — P1-7) */
    contact: { tel: string; consultTel: string; mobile: string; fax: string; email: string };
    officer: { phone: string };
    /** /privacy 방문 통계 거부 버튼 — LEGAL_LABELS.analyticsOptOut (P1-7 R2) */
    analyticsOptOut: { optOut: string; optIn: string; storageFailed: string; browserRefused: string };
    footer: {
      companyInfo: string;
      operator: string;
      representative: string;
      bizRegNo: string;
      mailOrder: string;
      headOffice: string;
      branch: string;
      privacyOfficer: string;
      hosting: string;
      ftcBizInfo: string;
    };
  };
}

const F = LEGAL_LABELS.footer;

export const LEDGER_UI_KO: LedgerUi = {
  brand: COMPANY.brandName,
  representative: COMPANY.representative,
  officialNotice: null,
  verbatim: { bookingNotice: VERBATIM.bookingNotice, showcaseNotice: VERBATIM.showcaseNotice },
  pages: { privacy: LEGAL_PAGES.privacy.title, terms: LEGAL_PAGES.terms.title, guide: LEGAL_PAGES.guide.title },
  headings: { quoteBasis: QUOTE_BASIS.title, insurance: INSURANCE.title, privacyNotice: PRIVACY_NOTICE.title },
  consent: {
    privacy: PRIVACY_NOTICE.consentLabel,
    marketing: PRIVACY_NOTICE.marketingConsentLabel,
    withdrawal: WITHDRAWAL.consentLabel,
  },
  relatedRole: RELATED_COMPANY.role,
  labels: {
    effectiveDate: LEGAL_LABELS.effectiveDate,
    home: LEGAL_LABELS.home,
    legalNav: LEGAL_LABELS.legalNav,
    contact: {
      tel: LEGAL_LABELS.contact.tel,
      consultTel: LEGAL_LABELS.contact.consultTel,
      mobile: LEGAL_LABELS.contact.mobile,
      fax: LEGAL_LABELS.contact.fax,
      email: LEGAL_LABELS.contact.email,
    },
    officer: { phone: LEGAL_LABELS.officer.phone },
    analyticsOptOut: {
      optOut: LEGAL_LABELS.analyticsOptOut.optOut,
      optIn: LEGAL_LABELS.analyticsOptOut.optIn,
      storageFailed: LEGAL_LABELS.analyticsOptOut.storageFailed,
      browserRefused: LEGAL_LABELS.analyticsOptOut.browserRefused,
    },
    footer: {
      companyInfo: F.companyInfo,
      operator: F.operator,
      representative: F.representative,
      bizRegNo: F.bizRegNo,
      mailOrder: F.mailOrder,
      headOffice: F.headOffice,
      branch: F.branch,
      privacyOfficer: F.privacyOfficer,
      hosting: F.hosting,
      ftcBizInfo: F.ftcBizInfo,
    },
  },
};

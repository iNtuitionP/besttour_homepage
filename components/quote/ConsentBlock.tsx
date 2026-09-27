/**
 * 개인정보 수집·이용 동의 블록 — 홈 간편 견적 모달 (ADR-6 · UIUX 브리프 §3-② · P3-8 · P7-3 · P7-3 독립 리뷰 수정 라운드).
 *
 * 문구는 전부 props(ConsentText)로 받는다 — 원장 PRIVACY_NOTICE·LEGAL_LINKS 는 서버 컴포넌트(components/home/Hero.tsx)가 읽어
 * 내린다. 이 파일에는 원장 import 도, 법정 문구 리터럴도 없다(클라이언트 번들에 원장이 실리지 않는다).
 * 체크박스는 필수 동의 하나이고 **기본 해제**(defaultChecked 없음, 상태 초기값 false). 미체크면 제출이 닫힌다(submit-gate).
 * 선택 동의(광고성 정보 수신)는 간편 견적에서 **받지 않는다**(P3-8 컨트롤러 확정 §A) — 체크박스를 그리지 않고, 서버는 marketing_consent_at 을 null 로 둔다.
 *
 * 핵심만 보이고 "자세히 보기"로 전문 (사용자 지시 2026-09-27 · 컨트롤러 결정):
 *   접혀 있어도 보이는 줄 — 수집 목적 → 수집 항목 → 보유 기간(요약 · 강조) → 접수 현황 공개(작은 줄).
 *   목적·공개 고지를 접힌 자리에 둔 것은 독립 리뷰 P2-1 · P2-2 — "위 내용을 확인했으며" 가 가리키는 핵심이 펼치지 않아도 보이고,
 *   정보주체가 가장 예상하지 못할 이용(홈에 마스킹 공개)이 숨지 않게.
 *   보유·이용 기간은 **중요한 내용**(개인정보보호법 시행령 §17③3호)이다. 「개인정보 처리 방법에 관한 고시」(제2023-12호, 2023-10-16 시행)
 *   §4 1호 "글씨의 크기, 색깔, 굵기 또는 밑줄 등을 통하여 그 내용이 명확히 표시되도록 할 것" — 굵게 · 브랜드색 · 별도 줄 · 크게
 *   (.consentRetention). 크기는 우리 **내부 보수 기준**(카드 안 다른 글자의 1.2배 이상)으로 잠근다(tests/quote-disclosure.test.ts §6).
 *   "자세히 보기"(MoreToggle) 안: 보유 기간 전문 · 거부 안내 · 처리방침 링크. 접힌 줄에 이미 보이는 것은 되풀이하지 않는다.
 *   체크박스는 토글 밖이다 — 펼치지 않아도 체크할 수 있다(펼침을 강제하지 않는다).
 *
 * 영문 화면 (P2-6 · 독립 리뷰 P2-6):
 *   - 접힌 줄은 **원장 영문 요약**(summaryEn = PRIVACY_NOTICE.summaryEn, Hero 가 en 에서만 내린다) — 같은 네 줄 · 보유 기간은 같은 강조 줄 ·
 *     공개 고지는 같은 작은 줄. 영어이므로 lang 속성을 달지 않는다.
 *   - 맨 위 안내는 officialNotice(en 에서 Hero 가 officialNoticeCollapsed 를 넣는다 — "The Korean original under “View details” …").
 *   - "자세히 보기" 안은 **구속력 있는 한국어 원문 한 벌**(목적 · 항목 · 보유 기간 전문 · 거부 안내 · 접수 현황 공개) lang="ko"(bodyLang) + 처리방침 링크.
 *   - 제목·라벨·체크박스 라벨은 영문(ledgerUi · messages).
 * ko 에서는 summaryEn · officialNotice 가 null · bodyLang 이 undefined 라 lang 속성을 내지 않는다.
 */
import { useTranslations } from "next-intl";

import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { Link } from "@/i18n/navigation";
import type { OfficialNotice } from "@/lib/i18n/ledger-ui-ko";

import { F } from "./fields";
import { ErrorText } from "./FieldBits";
import { MoreToggle } from "./MoreToggle";
import s from "./quote.module.css";

/** 원장 PRIVACY_NOTICE 의 개인정보 영문 요약 — 접힌 줄에 보인다(en 전용). */
export interface ConsentSummaryEn {
  purpose: string;
  items: string;
  retention: string;
  publicFeed: string;
}

/** 원장 PRIVACY_NOTICE 의 4대 고지 + 보유 기간 요약 + 라벨 + 접수 현황 공개 고지 + 전문 링크 — Hero(서버)가 채운다. */
export interface ConsentText {
  title: string;
  purpose: string;
  itemsLine: string;
  retention: string;
  /** 접힌 줄에 강조해 보이는 보유 기간 요약 — 원장 PRIVACY_NOTICE.retentionSummary (P7-3). 전문(retention)은 자세히 보기 안. */
  retentionSummary: string;
  refusal: string;
  consentLabel: string;
  publicFeedNotice: string;
  privacyHref: string;
  /** en 전용 — 접힌 줄의 원장 영문 요약(PRIVACY_NOTICE.summaryEn). ko 는 null(접힌 줄도 원장 한국어). */
  summaryEn: ConsentSummaryEn | null;
  /** 맨 위 안내 — en 은 officialNoticeCollapsed(컨트롤러 확정), ko 는 null */
  officialNotice: OfficialNotice | null;
  /** 원장 한국어 본문의 lang — ko 는 undefined(속성 없음), en 은 "ko" */
  bodyLang?: string;
}

export function ConsentBlock({
  text,
  privacyConsent,
  onPrivacyChange,
  error,
  idPrefix,
}: {
  text: ConsentText;
  privacyConsent: boolean;
  onPrivacyChange: (checked: boolean) => void;
  error?: string;
  idPrefix: string;
}) {
  const t = useTranslations("quote.consent");
  const titleId = `${idPrefix}-consent-title`;
  const errId = `${idPrefix}-err-privacyConsent`;
  // 접힌 줄 — en 은 원장 영문 요약(lang 없음 = 영어), 그 밖은 원장 한국어(bodyLang)
  const summary = text.summaryEn;
  const keyLang = summary ? undefined : text.bodyLang;

  return (
    <section className={s.agreeCard} aria-labelledby={titleId} data-testid="consent-block" data-field="privacyConsent">
      <h3 className={s.agreeTitle} id={titleId}>
        {text.title}
      </h3>
      <OfficialKoreanNotice notice={text.officialNotice} />

      {/* 접혀 있어도 보이는 줄 — 원장 값 그대로. 보유 기간은 중요한 내용이라 강조, 공개 고지는 작은 줄로 숨기지 않는다. */}
      <dl className={s.consentKey} data-testid="consent-key">
        <div>
          <dt>{t("purpose")}</dt>
          <dd lang={keyLang} data-testid="consent-purpose">
            {summary ? summary.purpose : text.purpose}
          </dd>
        </div>
        <div>
          <dt>{t("items")}</dt>
          <dd lang={keyLang} data-testid="consent-items">
            {summary ? summary.items : text.itemsLine}
          </dd>
        </div>
        <div className={s.consentRetention} data-testid="consent-retention">
          <dt>{t("retention")}</dt>
          <dd lang={keyLang}>{summary ? summary.retention : text.retentionSummary}</dd>
        </div>
      </dl>
      <p className={s.consentNote} data-testid="consent-public-feed" lang={keyLang}>
        {summary ? summary.publicFeed : text.publicFeedNotice}
      </p>

      <MoreToggle testId="consent-more" describedBy={titleId}>
        <dl className={s.consentList}>
          {/* 영문 화면: 접힌 줄이 영문 요약이라, 구속력 있는 한국어 원문을 여기서 빠짐없이 싣는다 */}
          {summary ? (
            <>
              <div>
                <dt>{t("purpose")}</dt>
                <dd lang={text.bodyLang}>{text.purpose}</dd>
              </div>
              <div>
                <dt>{t("items")}</dt>
                <dd lang={text.bodyLang}>{text.itemsLine}</dd>
              </div>
            </>
          ) : null}
          <div>
            <dt>{t("retention")}</dt>
            <dd lang={text.bodyLang}>{text.retention}</dd>
          </div>
        </dl>
        <p className={s.consentNote} lang={text.bodyLang}>
          {text.refusal}
        </p>
        {summary ? (
          <p className={s.consentNote} lang={text.bodyLang}>
            {text.publicFeedNotice}
          </p>
        ) : null}
        <Link href={text.privacyHref} target="_blank" rel="noreferrer noopener" className={s.consentLink}>
          {t("full")} <span aria-hidden="true">{t("newTab")}</span>
        </Link>
      </MoreToggle>

      <label className={s.consentRow} data-checked={privacyConsent}>
        <input
          type="checkbox"
          name={F.privacyConsent}
          checked={privacyConsent}
          onChange={(e) => onPrivacyChange(e.target.checked)}
          aria-describedby={error ? errId : undefined}
          aria-invalid={error ? true : undefined}
          data-testid="consent-privacy"
        />
        <span>{text.consentLabel}</span>
      </label>
      <ErrorText id={errId} message={error} />
    </section>
  );
}

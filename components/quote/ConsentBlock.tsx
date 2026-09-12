/**
 * 개인정보 수집·이용 동의 블록 — 6단계 (ADR-6 · UIUX 브리프 §3-②).
 *
 * 문구는 전부 props(ConsentText)로 받는다 — 원장 PRIVACY_NOTICE·LEGAL_LINKS 는 서버 페이지(app/[locale]/(site)/quote/page.tsx)가 읽어
 * 내린다. 이 파일에는 원장 import 도, 법정 문구 리터럴도 없다(클라이언트 번들에 원장이 실리지 않는다).
 * 체크박스 2종은 **기본 해제**(defaultChecked 없음, 상태 초기값 false, 초안에서 복원하지 않음). 필수 미체크면 제출이 닫힌다(submit-gate).
 */
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

import { F } from "./fields";
import { ErrorText } from "./FieldBits";
import s from "./quote.module.css";

/** 원장 PRIVACY_NOTICE 의 4대 고지 + 라벨 + 접수 현황 공개 고지 + 전문 링크 — page.tsx 가 채운다. */
export interface ConsentText {
  title: string;
  purpose: string;
  itemsLine: string;
  retention: string;
  refusal: string;
  consentLabel: string;
  marketingConsentLabel: string;
  publicFeedNotice: string;
  privacyHref: string;
}

export function ConsentBlock({
  text,
  privacyConsent,
  marketingConsent,
  onPrivacyChange,
  onMarketingChange,
  error,
  idPrefix,
}: {
  text: ConsentText;
  privacyConsent: boolean;
  marketingConsent: boolean;
  onPrivacyChange: (checked: boolean) => void;
  onMarketingChange: (checked: boolean) => void;
  error?: string;
  idPrefix: string;
}) {
  const t = useTranslations("quote.consent");
  const titleId = `${idPrefix}-consent-title`;
  const errId = `${idPrefix}-err-privacyConsent`;

  return (
    <section className={s.consent} aria-labelledby={titleId} data-testid="consent-block" data-field="privacyConsent">
      <h3 className={s.consentTitle} id={titleId}>
        {text.title}
      </h3>
      <dl className={s.consentList}>
        <div>
          <dt>{t("purpose")}</dt>
          <dd>{text.purpose}</dd>
        </div>
        <div>
          <dt>{t("items")}</dt>
          <dd>{text.itemsLine}</dd>
        </div>
        <div>
          <dt>{t("retention")}</dt>
          <dd>{text.retention}</dd>
        </div>
      </dl>
      <p className={s.consentNote}>{text.refusal}</p>

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
      <label className={s.consentRow} data-checked={marketingConsent}>
        <input
          type="checkbox"
          name={F.marketingConsent}
          checked={marketingConsent}
          onChange={(e) => onMarketingChange(e.target.checked)}
          data-testid="consent-marketing"
        />
        <span>{text.marketingConsentLabel}</span>
      </label>
      <ErrorText id={errId} message={error} />

      <p className={s.consentNote} data-testid="consent-public-feed">
        {text.publicFeedNotice}
      </p>
      <Link href={text.privacyHref} target="_blank" rel="noreferrer noopener" className={s.consentLink}>
        {t("full")} <span aria-hidden="true">{t("newTab")}</span>
      </Link>
    </section>
  );
}

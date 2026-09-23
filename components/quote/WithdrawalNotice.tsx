/**
 * 청약철회 고지 — 6단계 제출 버튼 바로 위 (플랜 §11 M2 · 전자상거래법 §17⑥). **서버 컴포넌트** — 원장에서만 가져온다.
 *
 * 순서(브리프 §청약철회 고지 · P1-7 브리프 1-B): VERBATIM.bookingNotice(원문) → QUOTE_BASIS.line → PAYMENT.line →
 * CANCELLATION 2단계 + referenceTime → **바로 아래** 청약철회 제한 고지(원장 WITHDRAWAL.notice — 사장님 확정 2026-09-21 A-2, 눈에 띄게).
 * 그 바로 아래에 필수 체크박스(WITHDRAWAL.consentLabel)가 온다 — 상태가 필요해 클라이언트 Step6Contact 가 그린다.
 * `data-legal="withdrawal-notice"` 를 테스트·browse 가 존재의 증거로 잠근다. 페이지가 이 노드를 만들어 클라이언트 위저드에 props 로 내린다.
 *
 * P1-7 변경: 예전(P3-4)에는 약관 제8조 본문의 첫 문장을 잘라 여기 실었다(components/quote/withdrawal.ts — 삭제). 사장님이 확정한 고지 문안이
 * 원장 WITHDRAWAL 로 생겨 그것으로 바꿨다. "위 취소·환불 규정" 이 가리키는 표가 바로 위에 있다. 약관 제8조 자체는 /terms 에 그대로 있다.
 *
 * 영문 화면 (P2-6 브리프 §3): verbatim 은 컨트롤러 확정 영문(localizeVerbatim), 그 아래 법정 문안(산정 기준·대금·취소환불)은
 * 원장 한국어 그대로 — 그 위에 컨트롤러 확정 안내("한국어가 법적 효력")를 두고 한국어 블록에 lang="ko". 제목·소제목은 messages(quote.steps.contact).
 * 청약철회 제한 고지만은 번역본(WITHDRAWAL.noticeEn)을 먼저 싣고 한국어 원문을 lang="ko" 로 함께 둔다(P1-7 R2 — 동의하는 문장을 읽을 수 있게).
 * 체크박스 라벨은 원장의 확정 영문(WITHDRAWAL.consentLabelEn)이다. ko 화면은 안내도 lang 속성도 내지 않는다(마크업 불변).
 */
import { getLocale, getTranslations } from "next-intl/server";

import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { WithdrawalRestrictionText } from "@/components/legal/WithdrawalRestrictionText";
import { koLang, ledgerUi, localizeVerbatim } from "@/lib/i18n/ledger-ui";
import { CANCELLATION, PAYMENT, QUOTE_BASIS, VERBATIM, WITHDRAWAL } from "@/lib/legal/disclosures";

import s from "./quote.module.css";

export async function WithdrawalNotice() {
  const [t, locale] = await Promise.all([getTranslations("quote.steps.contact"), getLocale()]);
  const lang = koLang(locale);

  return (
    <aside className={s.withdrawal} data-legal="withdrawal-notice" aria-labelledby="quote-withdrawal-title">
      <h3 className={s.withdrawalTitle} id="quote-withdrawal-title">
        {t("noticeTitle")}
      </h3>
      <p className={s.withdrawalVerbatim} data-legal="booking-notice">
        {localizeVerbatim(locale, VERBATIM.bookingNotice)}
      </p>
      <OfficialKoreanNotice notice={ledgerUi(locale).officialNotice} />
      <p data-legal="quote-basis" lang={lang}>
        {QUOTE_BASIS.line}
      </p>
      <p data-legal="payment" lang={lang}>
        {PAYMENT.line}
      </p>
      <div data-legal="cancellation">
        <p className={s.withdrawalSub}>{t("cancelTitle")}</p>
        <ul className={s.tiers} lang={lang}>
          {CANCELLATION.tiers.map((tier) => (
            <li key={tier.when}>
              {tier.when} — {tier.label}
            </li>
          ))}
        </ul>
        <p lang={lang}>{CANCELLATION.referenceTime}</p>
        {/* R3 [P2-F]: 표는 그 자체로 절대적으로 읽힌다 — 적용 범위를 표 바로 아래에서 밝힌다 */}
        <p data-legal="cancellation-scope" lang={lang}>
          {CANCELLATION.scope}
        </p>
      </div>
      {/* P1-7 R2: 영문 화면은 번역본(noticeEn) 다음에 한국어 원문(lang="ko") — withdrawal-text.ts */}
      <WithdrawalRestrictionText notice={WITHDRAWAL.notice} noticeEn={WITHDRAWAL.noticeEn} locale={locale} className={s.withdrawalLaw} />
    </aside>
  );
}

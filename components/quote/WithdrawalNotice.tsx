/**
 * 청약철회 고지 — 6단계 제출 버튼 바로 위 (플랜 §11 M2 · 전자상거래법 §17②). **서버 컴포넌트** — 원장에서만 가져온다.
 *
 * 순서(브리프 §청약철회 고지): VERBATIM.bookingNotice(원문) → QUOTE_BASIS.line → PAYMENT.line → CANCELLATION 4단계 + referenceTime →
 * 약관 제8조의 청약철회 제한 문장(withdrawalSentence — 원장에서 파생, 리터럴 아님).
 * `data-legal="withdrawal-notice"` 를 테스트·browse 가 존재의 증거로 잠근다. 페이지가 이 노드를 만들어 클라이언트 위저드에 props 로 내린다.
 */
import { getTranslations } from "next-intl/server";

import { CANCELLATION, PAYMENT, QUOTE_BASIS, TERMS, VERBATIM } from "@/lib/legal/disclosures";

import s from "./quote.module.css";
import { WITHDRAWAL_ARTICLE_INDEX, withdrawalSentence } from "./withdrawal";

export async function WithdrawalNotice() {
  const t = await getTranslations("quote.steps.contact");
  const article = TERMS.articles[WITHDRAWAL_ARTICLE_INDEX];

  return (
    <aside className={s.withdrawal} data-legal="withdrawal-notice" aria-labelledby="quote-withdrawal-title">
      <h3 className={s.withdrawalTitle} id="quote-withdrawal-title">
        {t("noticeTitle")}
      </h3>
      <p className={s.withdrawalVerbatim} data-legal="booking-notice">
        {VERBATIM.bookingNotice}
      </p>
      <p data-legal="quote-basis">{QUOTE_BASIS.line}</p>
      <p data-legal="payment">{PAYMENT.line}</p>
      <div data-legal="cancellation">
        <p className={s.withdrawalSub}>{t("cancelTitle")}</p>
        <ul className={s.tiers}>
          {CANCELLATION.tiers.map((tier) => (
            <li key={tier.when}>
              {tier.when} — {tier.label}
            </li>
          ))}
        </ul>
        <p>{CANCELLATION.referenceTime}</p>
      </div>
      <p className={s.withdrawalLaw} data-legal="withdrawal-restriction" data-article={article.no}>
        {withdrawalSentence()}
      </p>
    </aside>
  );
}

/**
 * 청약철회 고지 — 간편 견적 모달의 개인정보 동의 다음 (플랜 §11 M2 · 전자상거래법 §17⑥ · P3-8 · P7-3). **서버 컴포넌트** — 원장에서만 가져온다.
 *
 * P7-3 — 핵심만 보이고 "자세히 보기"로 전문 (사용자 지시 2026-09-27 · 컨트롤러 결정 · 독립 리뷰 수정 라운드):
 *   접혀 있어도 보이는 것(§17⑥ "쉽게 알 수 있는 곳에 명확히"):
 *     CANCELLATION 2단계(언제 · 환불) → 날짜 기준(CANCELLATION.referenceTime — 두 구간의 경계를 정하는 문장, 작은 줄 · 리뷰 P2-7)
 *     → 적용 범위(CANCELLATION.scope — 표가 나오는 곳마다 표 묶음 바로 아래, 본문 크기·본문색 · 리뷰 P2-3)
 *     → 청약철회 제한 한 줄(WITHDRAWAL.smsLine, 강조).
 *   "자세히 보기"(MoreToggle — 서버가 만든 전문을 children 으로 넘긴다) 안:
 *     계약금 안내(depositNote — 2단계가 계약금 기준일 때, /guide 와 같은 조건) · 대금 지급(PAYMENT.line) ·
 *     견적 산정 기준(QUOTE_BASIS.line) · 청약철회 제한 고지 전문(원장 WITHDRAWAL.notice — 사장님 확정 2026-09-21 A-2).
 *     날짜 기준은 접힌 자리로 옮겼으므로 여기서 되풀이하지 않는다.
 * 이 블록 바로 아래에 필수 체크박스(WITHDRAWAL.consentLabel)가 온다 — 상태가 필요해 클라이언트 QuickQuoteModal 이 같은 카드 안에 그린다.
 * 체크박스는 펼치지 않아도 누를 수 있다(펼침을 강제하지 않는다 — 브리프 §②).
 * verbatim("사장님 확정 후 연락드리며…")은 이 블록이 아니라 모달의 체크박스 다음·제출 바로 위에 **한 번** 있다(P3-8 브리프 §D-2).
 * `data-legal="withdrawal-notice"` 를 테스트·browse 가 존재의 증거로 잠근다. Hero(서버)가 이 노드를 만들어 클라이언트 위젯에 props 로 내린다.
 *
 * 영문 화면 (P2-6 브리프 §3 · P7-3 후속 · 독립 리뷰 P2-6·P2-9):
 *   - 접힌 핵심은 **원장의 영문 요약 WITHDRAWAL.summaryEn** — 2단계 두 줄(tiers) → 날짜 기준(referenceTime) → 범위(scope) → 제한 한 줄(restriction, 강조).
 *     영어이므로 lang 을 달지 않는다. 문자열은 원장 그대로(나누거나 고치지 않는다). 영문 표지는 `-en`(cancellation-reference-en ·
 *     cancellation-scope-en) — 자세히 보기 안의 한국어 표지와 이름이 겹치지 않게(리뷰 P2-9).
 *   - 맨 위 안내는 officialNoticeCollapsed("The Korean original under “View details” …" — 접힌 자리 아래는 영어라 "below" 라고 하지 않는다, 리뷰 P2-6①).
 *   - "자세히 보기" 안: 계약금·대금 지급·산정 기준은 원장 한국어(lang="ko"), 청약철회 제한 고지는 번역본(WITHDRAWAL.noticeEn, lang="en")을
 *     먼저 싣고, 한국어 원문 **바로 앞**에 구속력 있는 한국어 한 벌(2단계 → 날짜 기준 → 범위, lang="ko", ko 접힌 자리와 같은 마크업)을 둔 뒤
 *     한국어 원문(lang="ko")을 싣는다 — 원문의 "위 취소·환불 규정" 이 가리킬 표가 원문 바로 위에 있다(P7-3 후속 2).
 *   - 제목·소제목·토글은 messages(quote.notice · quote.more). 체크박스 라벨은 원장의 확정 영문(WITHDRAWAL.consentLabelEn).
 * ko 화면은 안내도 lang 속성도 내지 않는다.
 */
import { getLocale, getTranslations } from "next-intl/server";

import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { WithdrawalRestrictionText } from "@/components/legal/WithdrawalRestrictionText";
import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import { CANCELLATION, PAYMENT, QUOTE_BASIS, WITHDRAWAL } from "@/lib/legal/disclosures";

import { MoreToggle } from "./MoreToggle";
import s from "./quote.module.css";

/**
 * 한국어 취소·환불 한 벌 — 2단계 표 → 날짜 기준(작은 줄) → 적용 범위(R3 [P2-F]: 표는 그 자체로 절대적으로 읽힌다 — 범위 문장을 표 묶음 바로 아래에).
 * 같은 마크업을 두 자리가 쓴다: ko 의 접힌 자리(lang 없음) · en 의 "자세히 보기" 안에서 한국어 원문 바로 앞(lang="ko", P7-3 후속 2).
 */
function KoreanCancellationTable({ lang }: { lang: "ko" | undefined }) {
  return (
    <>
      <ul className={s.tiers} lang={lang}>
        {CANCELLATION.tiers.map((tier) => (
          <li key={tier.when}>
            <span>{tier.when}</span> <b>{tier.label}</b>
          </li>
        ))}
      </ul>
      <p className={s.cancelReference} data-legal="cancellation-reference" lang={lang}>
        {CANCELLATION.referenceTime}
      </p>
      <p className={s.cancelScope} data-legal="cancellation-scope" lang={lang}>
        {CANCELLATION.scope}
      </p>
    </>
  );
}

export async function WithdrawalNotice() {
  const [t, locale] = await Promise.all([getTranslations("quote.notice"), getLocale()]);
  const lang = koLang(locale);
  // 접힌 요약의 언어 — 영문 화면만 원장 영문 요약을 쓴다(ledgerUi · withdrawalParagraphs 와 같은 판정).
  const english = locale === "en";

  return (
    <aside className={s.withdrawal} data-legal="withdrawal-notice" aria-labelledby="quote-withdrawal-title">
      <h3 className={s.agreeTitle} id="quote-withdrawal-title">
        {t("title")}
      </h3>
      {/* 접힌 카드 전용 안내(en) — 한국어 원문이 "View details" 안에 있다(리뷰 P2-6①). ko 는 null 이라 아무것도 내지 않는다. */}
      <OfficialKoreanNotice notice={ledgerUi(locale).officialNoticeCollapsed} />

      {/* 접혀 있어도 보이는 핵심 — 2단계 → 날짜 기준 → 범위 */}
      <div data-legal="cancellation">
        <p className={s.withdrawalSub}>{t("cancelTitle")}</p>
        {english ? (
          <>
            <ul className={`${s.tiers} ${s.tiersPlain}`}>
              {WITHDRAWAL.summaryEn.tiers.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className={s.cancelReference} data-legal="cancellation-reference-en">
              {WITHDRAWAL.summaryEn.referenceTime}
            </p>
            <p className={s.cancelScope} data-legal="cancellation-scope-en">
              {WITHDRAWAL.summaryEn.scope}
            </p>
          </>
        ) : (
          <KoreanCancellationTable lang={lang} />
        )}
      </div>
      {english ? (
        <p className={s.withdrawalKey} data-legal="withdrawal-summary">
          {WITHDRAWAL.summaryEn.restriction}
        </p>
      ) : (
        <p className={s.withdrawalKey} data-legal="withdrawal-summary" lang={lang}>
          {WITHDRAWAL.smsLine}
        </p>
      )}

      <MoreToggle testId="withdrawal-more" describedBy="quote-withdrawal-title">
        {CANCELLATION.basis === "deposit" ? (
          <p data-legal="cancellation-deposit" lang={lang}>
            {CANCELLATION.depositNote}
          </p>
        ) : null}
        <p data-legal="payment" lang={lang}>
          {PAYMENT.line}
        </p>
        <p data-legal="quote-basis" lang={lang}>
          {QUOTE_BASIS.line}
        </p>
        {/* P1-7 R2: 영문 화면은 번역본(noticeEn) 다음에 한국어 원문(lang="ko") — withdrawal-text.ts.
            P7-3 후속 2 · 리뷰: 영문 화면은 한국어 원문 바로 앞에 구속력 있는 한국어 한 벌(2단계 → 날짜 기준 → 범위, lang="ko")을 둔다 —
            원문의 "위 취소·환불 규정" 이 가리킬 표가 원문 바로 위에 있다. ko 는 한 벌이 접힌 자리에 이미 있어 되풀이하지 않는다. */}
        <WithdrawalRestrictionText
          notice={WITHDRAWAL.notice}
          noticeEn={WITHDRAWAL.noticeEn}
          locale={locale}
          className={s.withdrawalLaw}
          beforeOriginal={english ? <KoreanCancellationTable lang={lang} /> : undefined}
        />
      </MoreToggle>
    </aside>
  );
}

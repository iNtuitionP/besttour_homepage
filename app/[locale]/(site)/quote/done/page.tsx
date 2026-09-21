/**
 * /quote/done — 접수 완료 (P3-4). 서버 컴포넌트.
 * 접수번호는 URL 쿼리(?code=)로만 받는다 — DB 를 조회하지 않는다(조회는 P6-3a 예약확인: 코드 + 휴대폰 뒷 4자리).
 * 코드 형식(PUBLIC_CODE_PATTERN)이 아니면 표시하지 않는다(임의 문자열 반사 금지). 허니팟 가짜 성공(code 없음)도 같은 화면 — 코드 자리만 비운다.
 * verbatim "사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다." 는 원장 VERBATIM 에서만. 검색엔진 색인 제외.
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { localizeVerbatim } from "@/lib/i18n/ledger-ui";
import { COMPANY, VERBATIM } from "@/lib/legal/disclosures";
import { PUBLIC_CODE_PATTERN } from "@/lib/reservations/publicCode";

import s from "@/components/quote/quote.module.css";

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "quote.done" });
  return { title: t("meta"), robots: { index: false, follow: false } };
}

export default async function QuoteDonePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const raw = typeof sp.code === "string" ? sp.code : "";
  const code = PUBLIC_CODE_PATTERN.test(raw) ? raw : null;
  const t = await getTranslations("quote.done");

  return (
    <main className={s.main} data-testid="quote-done-page">
      <div className={s.wrap}>
        <section className={s.done} aria-labelledby="quote-done-title" data-testid="quote-done">
          <div className={s.doneBadge} aria-hidden="true">
            ✓
          </div>
          <h1 className={s.doneTitle} id="quote-done-title">
            {t("title")}
          </h1>

          {code ? (
            <>
              <p className={s.doneCodeLabel}>{t("codeLabel")}</p>
              <p className={s.doneCode} data-testid="quote-done-code">
                {code}
              </p>
              <p className={s.doneHint}>{t("codeHint")}</p>
            </>
          ) : (
            <p className={s.doneHint} data-testid="quote-done-nocode">
              {t("noCode")}
            </p>
          )}

          <p className={s.doneNote}>
            {t("body")} <span data-legal="booking-notice">{localizeVerbatim(locale, VERBATIM.bookingNotice)}</span>
          </p>
          <p className={s.doneSub}>{t("sub", { tel: COMPANY.tel })}</p>

          <div className={s.doneActions}>
            <Link href="/" className={`${s.btn} ${s.btnPrev}`}>
              {t("home")}
            </Link>
            <Link href="/quote" className={`${s.btn} ${s.btnSubmit}`}>
              {t("again")}
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

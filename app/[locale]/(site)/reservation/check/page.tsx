/**
 * /reservation/check — 예약확인 (P6-3a · 플랜 P6-3 매핑표 "예약확인"). 서버 컴포넌트, 조회 props 없음(토큰 없음) — 정적 렌더가 가능하고 결과는 서버액션에서만 온다.
 *
 * 여기서 하는 일: 원장 VERBATIM.bookingNotice·COMPANY.tel 을 읽어 클라이언트 폼(CheckForm)에 props 로 내린다 — 원장은 클라이언트 번들에 싣지 않는다.
 * 개인정보는 props 로 흐르지 않는다(P3-5 리뷰 N-2 — dev 에서 서버 컴포넌트 props 가 HTML 에 직렬화된다). 프리뷰도 mode 문자열 하나뿐.
 *
 * 개발 전용 분기(production 에서는 죽은 코드 — searchParams 자체를 읽지 않아 정적 유지):
 *   ?previewResult=ok|not_found|ratelimit(|1=ok)  서버액션 대신 mock 결과를 주입해 카드·오류 렌더를 실측한다(원격 DB 에 쓰지 않는다)
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CheckForm } from "@/components/reservation-check/CheckForm";
import { parsePreviewResult } from "@/components/reservation-check/preview-result";
import { COMPANY, VERBATIM } from "@/lib/legal/disclosures";

import s from "@/components/quote/quote.module.css";
import c from "@/components/reservation-check/check.module.css";

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "reservationCheck.meta" });
  return {
    title: t("title", { brand: COMPANY.brandName }),
    description: t("description"),
  };
}

export default async function ReservationCheckPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const dev: Record<string, string | string[] | undefined> = process.env.NODE_ENV !== "production" ? await searchParams : {};
  const previewResult = parsePreviewResult(dev.previewResult);

  const t = await getTranslations("reservationCheck");

  return (
    <main className={s.main} data-testid="reservation-check-page">
      <div className={s.wrap}>
        <div className={c.narrow}>
          <header className={s.pageHead}>
            <p className={s.eyebrow}>{t("eyebrow")}</p>
            <h1 className={s.title}>{t("title")}</h1>
            <p className={s.sub}>{t("sub")}</p>
          </header>

          <CheckForm bookingNotice={VERBATIM.bookingNotice} tel={COMPANY.tel} previewResult={previewResult} />
        </div>
      </div>
    </main>
  );
}

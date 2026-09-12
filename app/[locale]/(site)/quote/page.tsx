/**
 * /quote — 견적 신청 위저드 6단계 (P3-4 · 목업 wizard-b.html · ADR-6 · 플랜 §11 M2). 서버 컴포넌트.
 *
 * **force-dynamic** (컨트롤러 결정): 타임트랩 폼 토큰은 요청마다 새로 서명해야 한다. 정적/ISR 로 프리렌더되면 빌드 시각의 토큰 하나가
 * HTML 에 구워져 FORM_MAX_AGE_MS(1시간) 뒤 모든 실제 방문자가 token-expired → bot 이 된다. 상위 레이아웃의 generateStaticParams 보다
 * 이 export 가 이긴다(빌드 출력 `ƒ /[locale]/quote`).
 *
 * 여기서 하는 일: 폼 토큰(issueQuoteFormToken — guardSecret() 만, 없으면 null 로 fail-closed) · Turnstile 사이트키 · 차량 목록 ·
 * 원장 동의 문구(PRIVACY_NOTICE·LEGAL_LINKS) · 청약철회 고지 노드(<WithdrawalNotice/>) 를 클라이언트 위저드에 props 로 내린다.
 * 개인정보는 props 로 흐르지 않는다(P3-5 리뷰 N-2 — dev 에서 서버 컴포넌트 props 가 HTML 에 직렬화된다).
 *
 * 개발 전용 분기(production 에서는 죽은 코드 — 페이지는 어차피 동적이지만 searchParams 자체를 읽지 않는다):
 *   ?previewSubmit=ok|fieldErrors|infra(|1=ok)  서버액션 대신 mock 결과를 주입해 UI 반응을 실측한다(원격 DB 에 쓰지 않는다)
 *   ?previewNotReady=1                          시크릿·사이트키가 없는 환경의 fail-closed UI 를 실측한다
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { issueQuoteFormToken } from "@/components/quote/form-token";
import { parsePreviewSubmit } from "@/components/quote/preview-submit";
import { QuoteWizard } from "@/components/quote/QuoteWizard";
import { WithdrawalNotice } from "@/components/quote/WithdrawalNotice";
import { TURNSTILE_ACTION } from "@/lib/guard";
import { COMPANY, LEGAL_LINKS, PRIVACY_NOTICE } from "@/lib/legal/disclosures";
import { getVehicles } from "@/lib/queries/vehicles";

import s from "@/components/quote/quote.module.css";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "quote.meta" });
  return {
    title: t("title", { brand: COMPANY.brandName }),
    description: t("description"),
  };
}

export default async function QuotePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const dev: Record<string, string | string[] | undefined> = process.env.NODE_ENV !== "production" ? await searchParams : {};
  const previewSubmit = parsePreviewSubmit(dev.previewSubmit);
  const previewNotReady = dev.previewNotReady === "1";

  const [vehicles, t] = await Promise.all([getVehicles(), getTranslations("quote")]);
  const formToken = previewNotReady ? null : issueQuoteFormToken();
  const turnstileSiteKey = previewNotReady ? "" : (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "");

  return (
    <main className={s.main} data-testid="quote-page">
      <div className={s.wrap}>
        <header className={s.pageHead}>
          <p className={s.eyebrow}>{t("eyebrow")}</p>
          <h1 className={s.title}>{t("title")}</h1>
          <p className={s.sub}>{t("sub")}</p>
        </header>

        <QuoteWizard
          locale={locale}
          vehicles={vehicles.map((v) => ({ slug: v.slug, nameKo: v.nameKo, capacity: v.capacity }))}
          formToken={formToken}
          turnstileSiteKey={turnstileSiteKey}
          turnstileAction={TURNSTILE_ACTION}
          consent={{
            title: PRIVACY_NOTICE.title,
            purpose: PRIVACY_NOTICE.purpose,
            itemsLine: PRIVACY_NOTICE.itemsLine,
            retention: PRIVACY_NOTICE.retention,
            refusal: PRIVACY_NOTICE.refusal,
            consentLabel: PRIVACY_NOTICE.consentLabel,
            marketingConsentLabel: PRIVACY_NOTICE.marketingConsentLabel,
            publicFeedNotice: PRIVACY_NOTICE.publicFeedNotice,
            privacyHref: LEGAL_LINKS.privacy,
          }}
          withdrawalNotice={<WithdrawalNotice />}
          tel={COMPANY.tel}
          previewSubmit={previewSubmit}
        />
      </div>
    </main>
  );
}

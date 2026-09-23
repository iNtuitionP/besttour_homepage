/**
 * /fares — 차량운임료 (P6-3b · 무가격 전환의 가장 민감한 페이지). 서버 컴포넌트, SSG + ISR(revalidate 600).
 *
 * 메뉴명은 옛 사이트 그대로 "차량운임료"(기존 메뉴 유지)지만 내용은 요금 매트릭스가 아니다 — 세 블록뿐:
 *   ① 견적 산정 기준: 원장 QUOTE_BASIS.factors(칩) + VERBATIM.bookingNotice + PAYMENT.line(계약금·잔금은 확정 시 안내).
 *      금액 셀·km 단가 0. 옛 사이트 intro11 의 지역×차종 매트릭스(인벤토리 §4)는 어떤 형태로도 옮기지 않는다(스펙 §12).
 *   ② 대표 노선 예시: getShowcaseRoutes() → KrMap(홈과 같은 지도·카드). Top-5 고지(VERBATIM.showcaseNotice)는 KrMap 이 원장에서
 *      렌더한다 — 여기서 다시 렌더하지 않는다. 실값 미수령 노선은 라벨 숨김 폴백(P2-2 규약 그대로). 홈 RoutesSection 의 설명문
 *      ("더 저렴한 견적")은 비교 광고 표현이라 가져오지 않고 SectionHead 를 직접 조립한다(브리프 §/fares 마지막 줄).
 *   ③ 견적 신청 CTA: /quote(라벨은 홈 위젯 home.hero.widget.cta 재사용) + 예약·상담 전화 링크(P1-7 — lib/contact-phone, en 은 +82 표기).
 * 요청 시점 API 0 · 서비스 롤 0 · 가격 계산 0(check:pricing) · 이 파일과 ko.json pages.fares 에 금액 리터럴 0(tests/pages.test.ts).
 *
 * 로케일 (P2-6): 산정 기준 제목은 ledgerUi(locale).headings.quoteBasis(ko 는 QUOTE_BASIS.title 그대로), 산정 기준 칩과 대금 지급 줄은
 * 원장 한국어 그대로 — en 에서는 그 위에 컨트롤러 확정 안내, 한국어 블록에 lang="ko". verbatim 은 localizeVerbatim.
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SectionHead } from "@/components/home/SectionHead";
import { KrMap } from "@/components/KrMap/KrMap";
import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { PageHeader } from "@/components/pages/PageHeader";
import { Link } from "@/i18n/navigation";
import { consultPhone } from "@/lib/contact-phone";
import { koLang, ledgerUi, localizeVerbatim } from "@/lib/i18n/ledger-ui";
import { PAYMENT, QUOTE_BASIS, VERBATIM } from "@/lib/legal/disclosures";
import { getShowcaseRoutes } from "@/lib/queries";
import { pageAlternates } from "@/lib/site-url";

import h from "@/components/home/home.module.css";
import s from "@/components/home/Sections.module.css";
import p from "@/components/pages/pages.module.css";

/** ISR 주기(초) — 홈과 동일. admin 이 대표 노선을 바꾸면 이 안에 반영된다. */
export const revalidate = 600;

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.fares.meta" });
  return {
    title: t("title", { brand: ledgerUi(locale).brand }),
    description: t("description"),
    // 옛 요금표(`?bo_page=intro11`)의 301 목적지 — 정본은 쿼리 없는 `/fares`(en `/en/fares`).
    alternates: pageAlternates("/fares", locale),
  };
}

export default async function FaresPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [routes, t, tc, tRoutes, tWidget, tMenu] = await Promise.all([
    getShowcaseRoutes(),
    getTranslations("pages.fares"),
    getTranslations("pages.common"),
    getTranslations("home.routes"),
    getTranslations("home.hero.widget"),
    getTranslations("layout.menu"),
  ]);
  const ui = ledgerUi(locale);
  const lang = koLang(locale);
  const phone = consultPhone(locale);

  return (
    <main className={h.main} data-testid="fares-page">
      <PageHeader
        navLabel={tc("breadcrumb")}
        homeLabel={tc("home")}
        current={tMenu("fares")}
        eyebrow={t("eyebrow")}
        title={tMenu("fares")}
        desc={t("intro")}
      />

      {/* ① 산정 기준 — 항목·고지 전부 원장 */}
      <section id="basis" className={`${h.section} ${h.toneWhite}`} aria-labelledby="basis-h" data-section="basis">
        <div className={h.wrap}>
          <SectionHead id="basis-h" eyebrow={t("basis.eyebrow")} title={ui.headings.quoteBasis} desc={t("basis.desc")} />
          <OfficialKoreanNotice notice={ui.officialNotice} />
          <ul className={s.services} aria-label={ui.headings.quoteBasis} data-testid="basis-factors" lang={lang}>
            {QUOTE_BASIS.factors.map((factor) => (
              <li key={factor} className={s.serviceItem}>
                {factor}
              </li>
            ))}
          </ul>
          <div className={s.stepsNotes} data-testid="basis-notes">
            <p className={s.stepsNote}>{localizeVerbatim(locale, VERBATIM.bookingNotice)}</p>
            <p className={s.stepsMeta} lang={lang}>
              {PAYMENT.line}
            </p>
          </div>
        </div>
      </section>

      {/* ② 대표 노선 예시 — KrMap 이 지도·카드·verbatim 고지를 전부 갖고 있다 */}
      <section id="routes" className={`${h.section} ${h.toneLav}`} aria-labelledby="routes-h" data-section="routes">
        <div className={h.wrap}>
          <SectionHead id="routes-h" eyebrow={tRoutes("eyebrow")} title={t("routes.title")} desc={t("routes.desc")} />
          <KrMap routes={routes} id="fares-krmap" />
        </div>
      </section>

      {/* ③ 견적 신청 CTA */}
      <section id="cta" className={`${h.section} ${h.toneWhite}`} aria-labelledby="cta-h" data-section="cta">
        <div className={h.wrap}>
          <SectionHead id="cta-h" eyebrow={tMenu("quote")} title={t("cta.title")} desc={t("cta.desc")} />
          <p className={p.actions}>
            <Link className={`${h.btnGold} ${h.btnLg}`} href="/quote">
              {tWidget("cta")}
            </Link>
            <a
              className={`${h.btnGhost} ${h.btnLg}`}
              href={phone.href}
              aria-label={`${ui.labels.contact.consultTel} ${phone.display}`}
            >
              {t("cta.call")} {phone.display}
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}

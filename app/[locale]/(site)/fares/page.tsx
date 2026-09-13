/**
 * /fares — 차량운임료 (P6-3b · 무가격 전환의 가장 민감한 페이지). 서버 컴포넌트, SSG + ISR(revalidate 600).
 *
 * 메뉴명은 옛 사이트 그대로 "차량운임료"(기존 메뉴 유지)지만 내용은 요금 매트릭스가 아니다 — 세 블록뿐:
 *   ① 견적 산정 기준: 원장 QUOTE_BASIS.factors(칩) + VERBATIM.bookingNotice + PAYMENT.line(계약금·잔금은 확정 시 안내).
 *      금액 셀·km 단가 0. 옛 사이트 intro11 의 지역×차종 매트릭스(인벤토리 §4)는 어떤 형태로도 옮기지 않는다(스펙 §12).
 *   ② 대표 노선 예시: getShowcaseRoutes() → KrMap(홈과 같은 지도·카드). Top-5 고지(VERBATIM.showcaseNotice)는 KrMap 이 원장에서
 *      렌더한다 — 여기서 다시 렌더하지 않는다. 실값 미수령 노선은 라벨 숨김 폴백(P2-2 규약 그대로). 홈 RoutesSection 의 설명문
 *      ("더 저렴한 견적")은 비교 광고 표현이라 가져오지 않고 SectionHead 를 직접 조립한다(브리프 §/fares 마지막 줄).
 *   ③ 견적 신청 CTA: /quote(라벨은 홈 위젯 home.hero.widget.cta 재사용) + 원장 COMPANY.tel 전화 링크.
 * 요청 시점 API 0 · 서비스 롤 0 · 가격 계산 0(check:pricing) · 이 파일과 ko.json pages.fares 에 금액 리터럴 0(tests/pages.test.ts).
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SectionHead } from "@/components/home/SectionHead";
import { KrMap } from "@/components/KrMap/KrMap";
import { menuLabel } from "@/components/pages/menu-label";
import { PageHeader } from "@/components/pages/PageHeader";
import { Link } from "@/i18n/navigation";
import { COMPANY, LEGAL_LABELS, PAYMENT, QUOTE_BASIS, VERBATIM } from "@/lib/legal/disclosures";
import { getShowcaseRoutes } from "@/lib/queries";

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
    title: t("title", { brand: COMPANY.brandName }),
    description: t("description"),
  };
}

export default async function FaresPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [routes, t, tc, tRoutes, tWidget] = await Promise.all([
    getShowcaseRoutes(),
    getTranslations("pages.fares"),
    getTranslations("pages.common"),
    getTranslations("home.routes"),
    getTranslations("home.hero.widget"),
  ]);

  return (
    <main className={h.main} data-testid="fares-page">
      <PageHeader
        navLabel={tc("breadcrumb")}
        homeLabel={tc("home")}
        current={menuLabel("fares")}
        eyebrow={t("eyebrow")}
        title={menuLabel("fares")}
        desc={t("intro")}
      />

      {/* ① 산정 기준 — 항목·고지 전부 원장 */}
      <section id="basis" className={`${h.section} ${h.toneWhite}`} aria-labelledby="basis-h" data-section="basis">
        <div className={h.wrap}>
          <SectionHead id="basis-h" eyebrow={t("basis.eyebrow")} title={QUOTE_BASIS.title} desc={t("basis.desc")} />
          <ul className={s.services} aria-label={QUOTE_BASIS.title} data-testid="basis-factors">
            {QUOTE_BASIS.factors.map((factor) => (
              <li key={factor} className={s.serviceItem}>
                {factor}
              </li>
            ))}
          </ul>
          <div className={s.stepsNotes} data-testid="basis-notes">
            <p className={s.stepsNote}>{VERBATIM.bookingNotice}</p>
            <p className={s.stepsMeta}>{PAYMENT.line}</p>
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
          <SectionHead id="cta-h" eyebrow={menuLabel("quote")} title={t("cta.title")} desc={t("cta.desc")} />
          <p className={p.actions}>
            <Link className={`${h.btnGold} ${h.btnLg}`} href="/quote">
              {tWidget("cta")}
            </Link>
            <a
              className={`${h.btnGhost} ${h.btnLg}`}
              href={`tel:${COMPANY.tel}`}
              aria-label={`${LEGAL_LABELS.contact.tel} ${COMPANY.tel}`}
            >
              {t("cta.call")} {COMPANY.tel}
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}

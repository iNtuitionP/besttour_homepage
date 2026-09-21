/**
 * /fleet — 차량소개 · 보험내용 (P6-3). 서버 컴포넌트, SSG + ISR(revalidate 600).
 *
 * 차량 카드는 홈 FleetSection 그대로 — 정원(vehicles.capacity) · 한 줄 카피(home.fleet.lines) · "이 차량으로 견적" CTA
 * (/quote?vehicle=<slug> 프리필 — 위저드가 받는다: components/quote/prefill.ts PREFILL_PARAMS). 가격 없음.
 * 옛 사이트 차종 원문(인벤토리 §2 H4, intro3~9)은 옮기지 않는다 — 요금표 위주이고 16인승은 25인승 본문 복붙 오류다.
 * 보험 문구는 원장 INSURANCE(인벤토리 ★2 "기존 문구 그대로" — tests/pages.test.ts 가 인벤토리 파일을 읽어 대조) —
 * ko.json 에 복제하지 않는다(원장 단일 출처). 차량 대수·연식 주장 0.
 * 요청 시점 API(headers·cookies·searchParams) 사용 0 — 정적 렌더.
 *
 * 로케일 (P2-6): 보험 제목은 ledgerUi(locale).headings.insurance(ko 는 INSURANCE.title 그대로), 본문은 원장 한국어 그대로 —
 * en 에서는 본문 위에 컨트롤러 확정 안내, 본문에 lang="ko". 페이지 제목은 messages layout.menu(ko 는 옛 메뉴 텍스트).
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { FleetSection } from "@/components/home/FleetSection";
import { SectionHead } from "@/components/home/SectionHead";
import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { PageHeader } from "@/components/pages/PageHeader";
import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import { INSURANCE } from "@/lib/legal/disclosures";
import { getVehicles } from "@/lib/queries";
import { pageAlternates } from "@/lib/site-url";

import h from "@/components/home/home.module.css";
import p from "@/components/pages/pages.module.css";

/** ISR 주기(초) — 홈과 동일. admin 이 차량을 바꾸면 이 안에 반영된다. */
export const revalidate = 600;

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.fleet.meta" });
  return {
    title: t("title", { brand: ledgerUi(locale).brand }),
    description: t("description"),
    // 옛 차종 10 페이지(`?bo_page=intro1..10`)가 전부 여기로 301 된다 — 정본은 쿼리 없는 `/fleet`(en `/en/fleet`) 하나다.
    alternates: pageAlternates("/fleet", locale),
  };
}

export default async function FleetPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [vehicles, t, tc, tFleet, tMenu] = await Promise.all([
    getVehicles(),
    getTranslations("pages.fleet"),
    getTranslations("pages.common"),
    getTranslations("home.fleet"),
    getTranslations("layout.menu"),
  ]);
  const ui = ledgerUi(locale);

  return (
    <main className={h.main} data-testid="fleet-page">
      <PageHeader
        navLabel={tc("breadcrumb")}
        homeLabel={tc("home")}
        current={tMenu("fleet")}
        eyebrow={tFleet("eyebrow")}
        title={tMenu("fleet")}
      />

      {vehicles.length === 0 ? (
        // FleetSection 은 0대면 null 을 돌려준다(홈 규약) — 페이지는 비지 않아야 하므로 빈 상태 문구를 따로 둔다.
        <section className={`${h.section} ${h.toneLav}`} data-section="fleet-empty">
          <div className={h.wrap}>
            <p className={p.empty} role="status" data-testid="fleet-empty">
              {t("empty")}
            </p>
          </div>
        </section>
      ) : (
        <FleetSection vehicles={vehicles} />
      )}

      <section
        id="insurance"
        className={`${h.section} ${h.toneWhite}`}
        aria-labelledby="insurance-h"
        data-section="insurance"
      >
        <div className={h.wrap}>
          <SectionHead id="insurance-h" eyebrow={t("insurance.eyebrow")} title={ui.headings.insurance} split={false} />
          <div className={`${p.card} ${p.prose}`} data-testid="insurance-body">
            <OfficialKoreanNotice notice={ui.officialNotice} />
            <p lang={koLang(locale)}>{INSURANCE.body}</p>
          </div>
        </div>
      </section>
    </main>
  );
}

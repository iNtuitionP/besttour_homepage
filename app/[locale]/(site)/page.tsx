/**
 * 홈 — 섹션 조립 + 데이터 fetch 만 (P2-4 · ADR-8, 목업 variant-08 DOM 순서 그대로 9개 + 접수 현황(P3-5) + 팝업).
 *
 * 렌더 방식: 빌드 시 정적(SSG) + ISR(revalidate) — 요청 시점 API(headers·cookies·searchParams)를 쓰지 않는다.
 * 데이터는 lib/queries(anon + RLS)로 여기서 한 번에 받아 섹션에 props 로 내린다. 섹션 컴포넌트는 fetch 하지 않는다.
 * 예외 하나: 접수 현황은 lib/queries/recent.ts 가 **서비스 롤**로 읽어 마스킹한 것을 아래 getRecentFeedCached 가 60초 태그 캐시로 감싼다.
 *
 * 개발 전용 분기(production 빌드에서는 죽은 코드 — searchParams 를 읽지 않으므로 라우트가 동적으로 떨어지지 않는다):
 *   ?previewPopup=1  원격 popups 가 비어 있을 때 더미 팝업을 props 로 주입해 dismiss·ESC·재방문을 실측한다(원격에 행을 넣지 않는다)
 *   ?previewFeed=1   원격 reservations 가 비어 있을 때 더미 **원문 행** 3건을 실제 매퍼(mapRecentRows)에 통과시켜 접수 현황을 실측한다
 *                    (원격에 행을 넣지 않는다 — 고객 개인정보 테이블). DOM 텍스트에 원문 이름·전화가 0건이어야 한다
 *   ?boom=1          (site)/error.tsx 바운더리 훈련 — 옛 /dev/krmap?boom=1 을 대체한다(P2-4 에서 dev 라우트 삭제)
 */
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CompanyIntro } from "@/components/home/CompanyIntro";
import { FleetSection } from "@/components/home/FleetSection";
import { GallerySection } from "@/components/home/GallerySection";
import { Hero } from "@/components/home/Hero";
import { HomePopup } from "@/components/home/HomePopup";
import { HowItWorks } from "@/components/home/HowItWorks";
import { NoticeSection } from "@/components/home/NoticeSection";
import { PREVIEW_POPUP } from "@/components/home/popup-preview";
import { PREVIEW_RECENT_ROWS } from "@/components/home/recent-feed-preview";
import { RecentFeed } from "@/components/home/RecentFeed";
import { RoutesSection } from "@/components/home/RoutesSection";
import { ServiceStrip } from "@/components/home/ServiceStrip";
import { TrustBar } from "@/components/home/TrustBar";
import { ledgerUi } from "@/lib/i18n/ledger-ui";
import { getActivePopup, getGallery, getNotices, getShowcaseRoutes, getVehicles, QUERY_TAGS } from "@/lib/queries";
import { getRecentReservationsMasked } from "@/lib/queries/recent";
import { mapRecentRows } from "@/lib/recent-feed";
import { pageAlternates } from "@/lib/site-url";

import h from "@/components/home/home.module.css";

/** ISR 주기(초). admin 이 노선·차량·공지·팝업을 바꾸면 이 안에 반영된다. 팝업의 "오늘" 판정도 이 주기로 다시 계산된다. */
export const revalidate = 600;

/**
 * 접수 현황(P3-5) — 서비스 롤 읽기(lib/queries/recent.ts)를 60초 태그 캐시로 감싼다. 쿼리 계층은 캐시를 모른다(ADR-3).
 * 접수 서버액션(actions/reservation.ts, P3-3)이 성공 뒤 QUERY_TAGS.recent 를 무효화하므로 새 접수는 즉시, 그 외엔 60초
 * (페이지 자체의 ISR 600초 안에서). 서비스 롤 키가 없으면 여기서 throw 해 빌드가 죽는다(fail-loud, 의도) — DB 오류는 [] 로
 * 내려와 섹션이 빠질 뿐이다.
 */
const getRecentFeedCached = unstable_cache(() => getRecentReservationsMasked(), ["recent-feed"], {
  revalidate: 60,
  tags: [QUERY_TAGS.recent],
});

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home.meta" });
  return {
    title: t("title", { brand: ledgerUi(locale).brand }),
    description: t("description"),
    // 정본은 요청 로케일의 홈(ko `/` · en `/en`), 언어 대안은 ko·en·x-default — P2-6 (lib/site-url.ts pageAlternates).
    alternates: pageAlternates("/", locale),
  };
}

export default async function HomePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const dev: Record<string, string | string[] | undefined> =
    process.env.NODE_ENV !== "production" ? await searchParams : {};
  if (dev.boom === "1") {
    // 에러 바운더리 훈련용. 이 문장은 화면에 나오면 안 된다 — error.tsx 는 에러 원문을 렌더하지 않는다.
    throw new Error("home boom drill: internal detail that must not reach the screen");
  }

  const [routes, vehicles, gallery, notices, remotePopup, remoteRecent] = await Promise.all([
    getShowcaseRoutes(),
    getVehicles(),
    getGallery(),
    getNotices(5),
    getActivePopup(),
    getRecentFeedCached(),
  ]);
  const popup = dev.previewPopup === "1" ? PREVIEW_POPUP : remotePopup;
  // 프리뷰는 더미 원문 행을 실제 매퍼에 통과시킨다 — 차종 라벨도 실제 vehicles 에서 (프리뷰가 곧 마스킹 경로의 실측)
  const recent =
    dev.previewFeed === "1"
      ? mapRecentRows(PREVIEW_RECENT_ROWS, new Map(vehicles.map((v): [string, string] => [v.slug, v.nameKo])))
      : remoteRecent;
  // 접수 현황 항목의 차종 라벨은 vehicles.name_ko 다(마스킹 계약 — lib/recent-feed.ts). en 화면에서만 같은 차량의 name_en 으로
  // 바꿔 보인다. 항목 타입(고지 범위와 1:1)은 건드리지 않는다 — 표시 계층의 치환이다(P2-6).
  const vehicleLabels =
    locale === "ko" ? undefined : new Map(vehicles.map((v): [string, string] => [v.nameKo, v.nameEn]));

  return (
    <main className={h.main} data-testid="home">
      <Hero />
      <RoutesSection routes={routes} />
      <RecentFeed items={recent} vehicleLabels={vehicleLabels} />
      <TrustBar />
      <ServiceStrip />
      <HowItWorks />
      <FleetSection vehicles={vehicles} />
      <CompanyIntro />
      <GallerySection items={gallery} />
      <NoticeSection notices={notices} />
      <HomePopup popup={popup} />
    </main>
  );
}

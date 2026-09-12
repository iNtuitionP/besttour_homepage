/**
 * 홈 — 섹션 조립 + 데이터 fetch 만 (P2-4 · ADR-8, 목업 variant-08 DOM 순서 그대로 9개 + 팝업).
 *
 * 렌더 방식: 빌드 시 정적(SSG) + ISR(revalidate) — 요청 시점 API(headers·cookies·searchParams)를 쓰지 않는다.
 * 데이터는 lib/queries(anon + RLS)로 여기서 한 번에 받아 섹션에 props 로 내린다. 섹션 컴포넌트는 fetch 하지 않는다.
 *
 * 개발 전용 분기(production 빌드에서는 죽은 코드 — searchParams 를 읽지 않으므로 라우트가 동적으로 떨어지지 않는다):
 *   ?previewPopup=1  원격 popups 가 비어 있을 때 더미 팝업을 props 로 주입해 dismiss·ESC·재방문을 실측한다(원격에 행을 넣지 않는다)
 *   ?boom=1          (site)/error.tsx 바운더리 훈련 — 옛 /dev/krmap?boom=1 을 대체한다(P2-4 에서 dev 라우트 삭제)
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CompanyIntro } from "@/components/home/CompanyIntro";
import { FleetSection } from "@/components/home/FleetSection";
import { GallerySection } from "@/components/home/GallerySection";
import { Hero } from "@/components/home/Hero";
import { HomePopup } from "@/components/home/HomePopup";
import { HowItWorks } from "@/components/home/HowItWorks";
import { NoticeSection } from "@/components/home/NoticeSection";
import { PREVIEW_POPUP } from "@/components/home/popup-preview";
import { RoutesSection } from "@/components/home/RoutesSection";
import { ServiceStrip } from "@/components/home/ServiceStrip";
import { TrustBar } from "@/components/home/TrustBar";
import { COMPANY } from "@/lib/legal/disclosures";
import { getActivePopup, getGallery, getNotices, getShowcaseRoutes, getVehicles } from "@/lib/queries";

import h from "@/components/home/home.module.css";

/** ISR 주기(초). admin 이 노선·차량·공지·팝업을 바꾸면 이 안에 반영된다. 팝업의 "오늘" 판정도 이 주기로 다시 계산된다. */
export const revalidate = 600;

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home.meta" });
  return {
    title: t("title", { brand: COMPANY.brandName }),
    description: t("description"),
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

  const [routes, vehicles, gallery, notices, remotePopup] = await Promise.all([
    getShowcaseRoutes(),
    getVehicles(),
    getGallery(),
    getNotices(5),
    getActivePopup(),
  ]);
  const popup = dev.previewPopup === "1" ? PREVIEW_POPUP : remotePopup;

  return (
    <main className={h.main} data-testid="home">
      <Hero />
      <RoutesSection routes={routes} />
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

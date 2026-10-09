import { setRequestLocale } from "next-intl/server";

import FloatingContact from "@/components/layout/FloatingContact";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";

/**
 * 공개 셸 — 헤더·푸터·플로팅 문의 (P2-3).
 * /admin 과 법정 문서 (legal) 은 이 셸을 상속하지 않는다(ADR-1). 여기 둔 것을 위로 올리지 말 것.
 *
 * setRequestLocale 은 헤더·푸터가 getTranslations 를 쓰면서도 정적 렌더링을 유지하기 위해 필요하다
 * (페이지에서 한 번 호출해도 레이아웃이 먼저 렌더되므로 여기서도 호출한다).
 *
 * #site-content 는 헤더의 "본문 바로가기" 링크가 착지하는 지점이다.
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Header />
      <div id="site-content">{children}</div>
      <Footer />
      <FloatingContact />
    </>
  );
}

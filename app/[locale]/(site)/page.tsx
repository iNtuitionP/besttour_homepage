import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("common");

  // P2-1: 지도 히어로 / P2-2: Top-5 예시 견적(showcase_routes) 자리
  return <main data-testid="home">{t("siteName")}</main>;
}

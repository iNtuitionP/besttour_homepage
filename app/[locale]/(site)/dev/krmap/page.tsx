/**
 * 개발 전용 검증 라우트 — /dev/krmap (P2-2).
 *
 * KrMap 을 browse 로 실측할 자리가 아직 없어(홈 이식은 P2-4) 임시로 둔 페이지다.
 * ▶ P2-4 가 홈(app/[locale]/(site)/page.tsx)에 KrMap 을 넣으면 이 파일을 디렉터리째 삭제한다.
 *
 * - production 에서는 notFound() — 배포에 노출되지 않는다(tests/krmap.test.ts 가 가드 존재를 단언).
 * - `?empty=1` 이면 쿼리를 건너뛰고 빈 배열을 넘긴다 — 실패 경로(지도만 뜨고 카드 자리에 빈 상태 문구) 실측용.
 * - 그 외에는 getShowcaseRoutes() 결과를 그대로 <KrMap/> 에 내린다. 다른 요소 없음.
 */
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { KrMap } from "@/components/KrMap/KrMap";
import { getShowcaseRoutes } from "@/lib/queries";

export default async function DevKrMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { locale } = await params;
  setRequestLocale(locale);

  const { empty } = await searchParams;
  const routes = empty === "1" ? [] : await getShowcaseRoutes();

  return (
    <main data-testid="dev-krmap" style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 20px" }}>
      <KrMap routes={routes} />
    </main>
  );
}

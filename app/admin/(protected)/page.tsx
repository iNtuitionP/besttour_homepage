import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";

/**
 * /admin — 관리자 홈. P5-1 시점에는 게이트가 열렸는지 보여 주는 자리표시자다.
 * 예약 현황·확정·팝업·공지·노선·갤러리 탭은 P5-3~6·P6-2 가 이 아래에 붙인다.
 *
 * (protected) 그룹 안이라 이 화면이 렌더된다는 것 자체가 requireAdmin() 을 통과했다는 뜻이다.
 * 관리자 영역은 로케일 밖이므로 문구는 기본 로케일(ko) 카탈로그에서 직접 가져온다.
 */
export default async function AdminPage() {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.home" });
  return <main data-testid="admin">{t("title")}</main>;
}

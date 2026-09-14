import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { requireAdmin } from "@/lib/auth/requireAdmin";

/**
 * /admin — 관리자 홈. P5-1 시점에는 게이트가 열렸는지 보여 주는 자리표시자다.
 * 예약 현황·확정·팝업·공지·노선·갤러리 탭은 P5-3~6·P6-2 가 이 아래에 붙인다.
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서도 무조건 다시 부른다** (P5-3 리뷰 F2):
 * 이 화면은 레이아웃 하나에만 기대고 있었고, 그 레이아웃의 게이트가 조건부가 된 순간 /admin 이 파라미터 없이 열렸다.
 * 화면 하나하나가 스스로 잠긴다 — 호출은 싸고, 잠금은 겹칠수록 좋다.
 * 관리자 영역은 로케일 밖이므로 문구는 기본 로케일(ko) 카탈로그에서 직접 가져온다.
 */
export default async function AdminPage() {
  await requireAdmin();
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.home" });
  return <main data-testid="admin">{t("title")}</main>;
}

import { getTranslations } from "next-intl/server";

import { AdminTabs } from "@/components/admin/AdminTabs";
import { ADMIN_TABS } from "@/components/admin/tabs";
import { routing } from "@/i18n/routing";
import { requireAdmin } from "@/lib/auth/requireAdmin";

/**
 * 보호 구역 — 이 아래의 모든 라우트는 렌더 전에 requireAdmin() 을 통과한다 (P5-1).
 *
 * 라우트 그룹이라 URL 에는 나타나지 않는다: /admin 은 여전히 /admin 이다.
 * 로그인 화면·콜백은 이 그룹 밖(app/admin/login, app/admin/auth/callback)에 있어 게이트를 타지 않는다 —
 * 경로 예외를 코드로 파지 않고 구조로 나눈 이유는 app/admin/layout.tsx 주석 참조.
 *
 * 게이트를 통과하지 못하면 requireAdmin() 이 /admin/login 으로 redirect 한다(= throw). 아래 화면은 렌더되지 않는다.
 * 세션 정보를 children 에 props 로 내리지 않는다 — 필요한 화면이 자기 자리에서 다시 requireAdmin() 을 부른다
 * (호출이 싸고, 화면 하나하나가 스스로 잠기는 편이 안전하다). P5-3 의 예약 화면이 그 규약을 따른다.
 *
 * **이 호출에는 어떤 조건도 붙이지 않는다.** P5-3 독립 리뷰(F1·F2)에서 개발용 우회 스위치가 이 줄을 `if (…)` 로 감쌌고,
 * 그 분기가 **production 번들에 그대로 남아 있었다**(기본 인자로 `process.env` 를 받는 함수는 Next 의 상수 접기를 피해 간다).
 * 환경변수 두 개면 고객 이름·전화번호가 열리는 상태였다. 조건부 게이트는 게이트가 아니다 —
 * tests/admin-reservations.test.ts 가 (protected) 아래 **모든** 파일에서 `requireAdmin()` 호출이 무조건인지
 * 구조적으로 검사한다(파일 목록을 손으로 적지 않는다 — 그래야 새 화면이 빠져도 잡힌다).
 *
 * 탭 네비게이션(P5-3): 항목은 components/admin/tabs.ts 가 정의하고, 라벨만 여기서 기본 로케일 카탈로그로 풀어 내린다
 * (관리자 영역은 로케일 밖이라 NextIntlClientProvider 가 없다 — 클라이언트에서 useTranslations 를 쓸 수 없다).
 * 아직 만들지 않은 탭도 자리를 지킨다(aria-disabled) — 지우면 다음 태스크가 자리를 잊는다.
 */
export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.tabs" });

  const items = ADMIN_TABS.map((tab) => ({ ...tab, label: t(tab.key) }));

  return (
    <>
      <AdminTabs items={items} navLabel={t("navLabel")} comingSoonLabel={t("comingSoon")} />
      {children}
    </>
  );
}

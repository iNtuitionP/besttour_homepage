import { getTranslations } from "next-intl/server";

import { AdminTabs } from "@/components/admin/AdminTabs";
import { AdminToastProvider } from "@/components/admin/AdminToast";
import { ADMIN_HUBS, ADMIN_TABS, navBadge } from "@/components/admin/tabs";
import { routing } from "@/i18n/routing";
import { countNewReservations } from "@/lib/admin/reservations";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";

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
 * 메뉴(P5-3 탭 줄 → P5-20 사이드바·탭 바): 항목·묶음·허브는 components/admin/tabs.ts 가 정의하고, 라벨만 여기서 기본 로케일 카탈로그로
 * 풀어 내린다(관리자 영역은 로케일 밖이라 NextIntlClientProvider 가 없다 — 클라이언트에서 useTranslations 를 쓸 수 없다).
 * 아직 만들지 않은 항목도 자리를 지킨다(aria-disabled) — 지우면 다음 태스크가 자리를 잊는다.
 *
 * **새 접수 배지**(P5-20): 게이트를 통과한 **뒤에** `status='new'` 건수를 한 번 센다(lib/admin/reservations.ts countNewReservations —
 * 배지 정의는 그것 하나). 세는 데 실패하면 배지만 숨기고 서버 로그 한 줄을 남긴다(navBadgeUnknown) — 배지 때문에 관리자 화면 전체가
 * 닫히면 안 되고, 모르는 수를 0 이라고 그리지 않으며, 그렇다고 조용히 사라지게 두지도 않는다.
 * 레이아웃은 탭 사이 이동에서 다시 렌더되지 않는다(공유 레이아웃 — lib/auth/requireAdmin.ts 「한 요청에 한 번」). 그래서 배지가 새로 세어지는 때는
 * 전체 로드·새로고침 · router.refresh()(확정·취소·완료 뒤 처리 영역이 부른다) · 서버액션의 revalidatePath("/admin","layout") 뒤다.
 * 그 밖에 사장님이 탭만 오가는 동안 새로 들어온 접수는 배지에 늦게 반영될 수 있다 — 접수 목록 화면은 이동마다 새로 읽으므로 목록이 늘 정답이다
 * (판단 근거는 P5-20 보고서 ④).
 * P5-21(리뷰 P2-10 "두 숫자 금지"): 숫자를 그리는 화면(관리 홈 · 접수 목록)은 자기가 센 값을 메뉴에 보고하고(components/admin/NavBadgeReport.tsx),
 * 메뉴는 이 레이아웃 값과 보고 중 **더 새로 센 쪽**을 그린다 — 그래서 레이아웃은 센 시각(`badgeAt`)을 함께 넘긴다.
 * 같은 요청에서 센 두 값은 countNewReservations 의 요청 범위 memo 로 애초에 같다.
 *
 * 로그아웃(P5-11 · D5)도 셸에 있다. 라벨만 여기서 풀어 내리고, 실제 동작은 AdminTabs 안의 form 제출이
 * actions/admin/session.ts 로 POST 한다 — 그 액션이 자기 첫 문장에서 다시 게이트를 탄다. 이 레이아웃의
 * `await requireAdmin();` 은 그것과 무관하게 **무조건** 이다(위 문단).
 *
 * 결과 토스트 자리(P5-20 · components/admin/AdminToast.tsx)도 여기서 본문을 감싼다 — 탭 이동에도 남아, 삭제 뒤 목록으로 옮겨 가도 알림이 보인다.
 */

/** 배지 조회 실패 로그 — 예외의 종류만 싣는다(오류 문구에는 주소가 섞일 수 있다 — lib/auth/requireAdmin.ts 와 같은 규약). */
interface NavBadgeLogEntry extends StructuredLogEntry {
  name: string;
}

/**
 * 배지 조회가 실패했을 때(리뷰 P2-4): 화면에서는 "모름" 과 "0" 이 같다(둘 다 배지 숨김 — 모르는 수를 0 으로 그리지 않는다).
 * 그래서 서버 로그에 한 줄을 남긴다 — 운영에서 권한·RLS 가 깨져도 배지가 **조용히** 사라지지 않게.
 */
function navBadgeUnknown(err: unknown): null {
  const entry: NavBadgeLogEntry = { level: "error", event: "admin.nav_badge_count_failed", name: err instanceof Error ? err.name : typeof err };
  structuredLog(entry);
  return null;
}

export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const badgeAt = Date.now();
  const [t, session, newCount] = await Promise.all([
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.tabs" }),
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.session" }),
    countNewReservations().catch(navBadgeUnknown),
  ]);

  const items = ADMIN_TABS.map((tab) => ({ ...tab, label: t(tab.key) }));
  const hubs = ADMIN_HUBS.map((hub) => ({ ...hub, label: t(hub.key) }));
  const labels = {
    navLabel: t("navLabel"),
    comingSoon: t("comingSoon"),
    brand: t("brand"),
    account: t("account"),
    myAccount: t("myAccount"),
    siteLink: t("siteLink"),
    newWindow: t("newWindow"),
    skip: t("skip"),
    groups: { site: t("site"), records: t("records") },
  };
  const badge = navBadge(newCount, (n) => t("newCount", { n }));

  return (
    <AdminTabs items={items} hubs={hubs} labels={labels} signOutLabel={session("signOut")} badge={badge} badgeAt={badgeAt} publicHref="/">
      <AdminToastProvider>{children}</AdminToastProvider>
    </AdminTabs>
  );
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { requireAdmin } from "@/lib/auth/requireAdmin";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin — 관리 홈. 로그인하면 매번 도착하는 첫 화면이다(lib/auth/adminLogin.ts · 콜백).
 *
 * P5-20: 메뉴(사이드바 · 탭 바)에 '홈' 링크를 걸었다. 대시보드(할 일 카드 · 새 접수 미리보기 · 다가오는 운행 · 홈페이지 점검)는 **P5-21** 이다.
 * 그때까지 "관리자" 세 글자 대신 제목과 거짓 없는 안내 한 줄("관리 홈은 곧 채워져요"), 그리고 가장 자주 가는 곳(접수)으로 가는 링크를 둔다.
 * 숫자(새 접수 N건 등)는 여기서 세지 않는다 — 메뉴의 배지가 이미 같은 정의로 보여 주고, 홈 카드는 P5-21 이 같은 함수로 그린다.
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서도 무조건 다시 부른다** (P5-3 리뷰 F2):
 * 이 화면은 레이아웃 하나에만 기대고 있었고, 그 레이아웃의 게이트가 조건부가 된 순간 /admin 이 파라미터 없이 열렸다.
 * 화면 하나하나가 스스로 잠긴다 — 호출은 싸고, 잠금은 겹칠수록 좋다.
 * 관리자 영역은 로케일 밖이므로 문구는 기본 로케일(ko) 카탈로그에서 직접 가져온다.
 */
export default async function AdminPage() {
  await requireAdmin();
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.home" });
  return (
    <main className={q.main} data-testid="admin">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("title")}</h1>
          <p className={q.sub}>{t("sub")}</p>
        </header>
        <p className={a.homeActions}>
          <Link className={`${a.btnPrimary} ${a.btnLink}`} href="/admin/reservations">
            {t("reservationsLink")}
          </Link>
        </p>
      </div>
    </main>
  );
}

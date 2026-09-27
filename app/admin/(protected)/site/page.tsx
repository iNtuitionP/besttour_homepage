import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { galleryLine, noticesLine, popupsLine, routesLine, type HubLine } from "@/components/admin/hub";
import { hubItems } from "@/components/admin/tabs";
import { routing } from "@/i18n/routing";
import { galleryUsage } from "@/lib/admin/gallery";
import { listAdminNotices } from "@/lib/admin/notices";
import { listAdminPopups, popupState } from "@/lib/admin/popups";
import { listAdminRoutes } from "@/lib/admin/routes";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { toKstDateString } from "@/lib/kst";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/site — '홈페이지' 허브 (P5-20 · 휴대폰 탭 바의 '홈페이지' 가 여기로 온다 · 제안서 ⑥ 3: "더보기" 탭 대신 묶음 허브).
 *
 * 공지 · 팝업 · 갤러리 · 대표 노선 네 곳으로 가는 링크 목록이고, 항목마다 **지금 상태 한 줄**을 붙인다(components/admin/hub.ts).
 * PC 에서는 사이드바가 네 곳을 바로 보여 주므로 이 화면을 거칠 일이 없다 — 그래도 주소로 들어오면 같은 목록이 열린다.
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서 다시, 본문 첫 문장으로** requireAdmin() 을 부른다
 * (조건·try 금지 — scripts/check-admin-gate.mjs 규칙 2·4). 상태 조회는 그 **뒤에**, 넷이 서로 기다리지 않고 동시에 나간다(P5-18 규약).
 * 조회는 전부 각 목록 화면이 쓰는 함수 그대로다(세션 클라이언트 + 0009 RLS — 서비스 롤 금지 · 캐시하지 않는다).
 * 하나가 실패해도 화면은 열리고 그 줄만 "불러오지 못했어요" 다 — 모르는 것을 "없음" 이라 하지 않는다.
 * 이 폴더에는 loading.tsx 를 두지 않는다 — 탭 사이 이동의 로딩은 (protected)/loading.tsx 가 맡는다(게이트 규칙 7·8).
 */
export default async function AdminSiteHubPage() {
  await requireAdmin();

  const [t, tabs] = await Promise.all([
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.hub" }),
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.tabs" }),
  ]);
  const today = toKstDateString(new Date());
  const [notices, popups, usage, routes] = await Promise.allSettled([listAdminNotices(), listAdminPopups(), galleryUsage(), listAdminRoutes()]);

  const lines: Record<string, HubLine> = {
    notices: noticesLine(notices),
    popups: popupsLine(popups, (row) => popupState(row, today) === "live"),
    gallery: galleryLine(usage),
    routes: routesLine(routes),
  };
  const lineText = (key: string): string => {
    const line = lines[key];
    return line === undefined ? "" : t(line.key, line.values);
  };

  return (
    <main className={q.main} data-testid="admin-hub-site">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("site.title")}</h1>
          <p className={q.sub}>{t("site.sub")}</p>
        </header>
        <ul className={a.hubList} aria-label={t("site.listLabel")}>
          {hubItems("site").map((item) => (
            <li key={item.key}>
              {item.ready ? (
                <Link className={a.hubItem} href={item.href} data-hub-item={item.key}>
                  <span className={a.hubText}>
                    <span className={a.hubTitle}>{tabs(item.key)}</span>
                    <span className={a.hubStatus}>{lineText(item.key)}</span>
                  </span>
                  <svg className={a.hubChevron} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ) : (
                <span className={a.hubItem} aria-disabled="true" data-ready="false">
                  <span className={a.hubText}>
                    <span className={a.hubTitle}>{tabs(item.key)}</span>
                    <span className={a.hubStatus}>{tabs("comingSoon")}</span>
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { notificationsLine } from "@/components/admin/hub";
import { hubItems } from "@/components/admin/tabs";
import { routing } from "@/i18n/routing";
import { getNotificationSummary } from "@/lib/admin/notifications";
import { requireAdmin } from "@/lib/auth/requireAdmin";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/records — '기록' 허브 (P5-20 · 휴대폰 탭 바의 '기록' 이 여기로 온다 · 제안서 ⑥ 3).
 *
 * 발송 기록(발송 내역) · 통계 두 곳으로 가는 링크 목록과 항목마다 상태 한 줄(components/admin/hub.ts).
 *   - 발송 기록: 발송 내역 화면 맨 위 요약과 **같은 조회·같은 말**이다(getNotificationSummary — head 집계 셋, 개인정보 0).
 *     이상이 없으면 "이상 없음 …", 있으면 "보내지 못한 알림 N건 (전체 기간)" 처럼 기간과 함께. 조회가 실패하면 "불러오지 못했어요" — 이상 없음이라 하지 않는다.
 *   - 통계: **설명 한 줄만** 둔다. 통계의 숫자는 0022 의 집계 함수가 기간을 받아 계산하는 가장 무거운 조회라, 지나가는 허브에서 부르지 않는다.
 *
 * 첫 문장 게이트(조건·try 금지 — scripts/check-admin-gate.mjs) · 조회는 그 뒤. 이 폴더에는 loading.tsx 를 두지 않는다((protected)/loading.tsx 가 맡는다).
 */
export default async function AdminRecordsHubPage() {
  await requireAdmin();

  const [t, tabs, n] = await Promise.all([
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.hub" }),
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.tabs" }),
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.notifications.summary" }),
  ]);
  const [summary] = await Promise.allSettled([getNotificationSummary()]);
  const notify = notificationsLine(summary);

  const lineText = (key: string): string => {
    if (key === "stats") return t("stats");
    if (key !== "notifications") return "";
    if (notify.kind === "unknown") return t("unknown");
    if (notify.kind === "ok") return n("ok");
    return notify.parts.map((p) => n(p.key, { n: p.n })).join(" · ");
  };

  return (
    <main className={q.main} data-testid="admin-hub-records">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("records.title")}</h1>
          <p className={q.sub}>{t("records.sub")}</p>
        </header>
        <ul className={a.hubList} aria-label={t("records.listLabel")}>
          {hubItems("records").map((item) => (
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

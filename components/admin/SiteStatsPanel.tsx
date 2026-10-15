import { getTranslations } from "next-intl/server";

import { SiteStatsChart } from "@/components/admin/SiteStatsChart";
import { summarizeSiteStats, type SiteStats } from "@/lib/admin/siteStats";
import { getSiteStats } from "@/lib/admin/siteStatsQuery";
import { routing } from "@/i18n/routing";

import a from "@/components/admin/admin.module.css";

/**
 * /admin/stats 맨 위 — 방문자 통계 (OF2-C · 0027). 티스토리 통계 화면처럼: 위 카드(조회수: 오늘·어제·누적 | 방문자: 오늘·어제·누적), 아래 최근 30일 선 그래프.
 *
 * 설명은 한 줄뿐이다 — "숫자는 이 기능을 켠 날부터 센다"(ko.json admin.stats.siteStats.launchNote). 문구는 전부 ko.json 에서 온다.
 * 호출하는 화면(stats/page.tsx)이 먼저 requireAdmin() 을 부른다. 읽기는 관리자 세션의 admin_site_stats 하나(서비스 롤 아님 — lib/admin/siteStatsQuery.ts).
 * 가드가 막으면(명단 밖 세션) 아무것도 그리지 않는다. 조회가 실패하면(예: 0027 미적용) 이 구역만 한 줄로 알리고 나머지 통계 화면은 그대로 둔다.
 */
export async function SiteStatsPanel() {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.stats.siteStats" });

  let stats: SiteStats | null = null;
  let failed = false;
  try {
    stats = await getSiteStats();
  } catch (err) {
    failed = true;
    console.error(JSON.stringify({ event: "admin_site_stats_error", message: err instanceof Error ? err.message : String(err) }));
  }
  if (!failed && stats === null) return null;

  const num = (n: number): string => n.toLocaleString("ko-KR");

  return (
    <section className={a.section} aria-labelledby="stats-site" data-testid="admin-site-stats">
      <h2 className={a.sectionTitle} id="stats-site">
        {t("title")}
      </h2>
      <p className={a.statNote}>{t("launchNote")}</p>
      {stats === null ? (
        <p className={a.hint} data-testid="admin-site-stats-error">
          {t("error")}
        </p>
      ) : (
        <>
          <Cards stats={stats} t={t} num={num} />
          <h3 className={a.subTitle}>{t("chartTitle")}</h3>
          <SiteStatsChart
            days={stats.days}
            // 날짜·말풍선은 `{m}`·`{d}`·`{views}` 자리표시자가 든 **틀**이다 — 값은 클라이언트(차트)가 날짜마다 채운다. t("date") 로 부르면 next-intl 이
            // 값 없이 포맷하려다 FORMATTING_ERROR 를 낸다(브라우저 실측 2026-10-15) — 그래서 raw 로 틀 그대로 넘긴다.
            labels={{ chartLabel: t("chartLabel"), views: t("views"), visitors: t("visitors"), date: String(t.raw("date")), tip: String(t.raw("tip")) }}
          />
        </>
      )}
    </section>
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;

function Cards({ stats, t, num }: { stats: SiteStats; t: T; num: (n: number) => string }) {
  const s = summarizeSiteStats(stats);
  const groups = [
    { key: "views", label: t("views"), row: s.views },
    { key: "visitors", label: t("visitors"), row: s.visitors },
  ] as const;
  return (
    <div className={a.siteCards}>
      {groups.map((g) => (
        <div key={g.key} role="group" aria-label={g.label} data-testid={`site-stats-${g.key}`}>
          <h3 className={a.subTitle}>{g.label}</h3>
          <div className={a.siteCardRow}>
            {(["today", "yesterday", "total"] as const).map((k) => (
              <div key={k} className={a.statCard}>
                <p className={a.statLabel}>{t(k)}</p>
                <p className={a.statValue} data-testid={`site-stats-${g.key}-${k}`}>
                  {num(g.row[k])}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

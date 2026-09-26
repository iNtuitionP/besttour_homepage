import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PURPOSES, isLocationCode, locationLabelKo } from "@/lib/codes";
import { vercelAnalyticsUrl } from "@/lib/analytics/dashboard";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { ADMIN_NOTIFICATIONS_PATH } from "@/lib/admin/notifications";
import {
  STATS_PERIODS,
  barWidthPercent,
  getAdminStats,
  getNotifyCorrections,
  isNearPurgeBoundary,
  medianDuration,
  notifyAttention,
  parseStatsPeriod,
  statsRange,
  statsViewState,
  visibleMax,
  type AdminStats,
  type NotifyAttention,
  type StatsPeriod,
} from "@/lib/admin/stats";

/** 보정치가 없을 때(도달하지 않는 방어 경로) — 0022 값 그대로. */
const NO_CORRECTIONS = { sentUnconfirmed: 0, sentUnconfirmedStuck: 0, suppressedDuplicates: 0 };
import { toKstDateString } from "@/lib/kst";
import { getVehicles } from "@/lib/queries/vehicles";
import { routing } from "@/i18n/routing";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/stats — 홈페이지 견적 접수 통계 (P5-17, 읽기 전용).
 *
 * 사장님은 비전문가다. 그래서 숫자마다 **무엇을 센 것인지** 한 줄이 붙고, 화면은 다섯 덩어리로만 나뉜다:
 *   ① 한눈에 보기 ② 지금 확인할 것 ③ 추이 ④ 어떤 문의가 들어오나 ⑤ 얼마나 미리 문의하나 (+ 방문 통계 카드)
 *
 * **숫자는 0022 의 definer 함수 하나에서 온다** — 예외 하나: ② 의 발송 문제 칸은 격리 행·중복 억제 행을 lib/admin/stats.ts
 * `getNotifyCorrections`·`notifyAttention` 이 보정한다(P4-7 수정 라운드 3 — 뺄셈은 그 순수 함수 안에 있다). 이 파일은 계산하지 않는다 — 나눗셈은 막대 폭 하나뿐이고
 * 그 분모는 `Math.max(1, …)` 로 바닥을 친다. 확정률(%)도 DB 가 계산해서 준다(총건수 0 이면 null 이다).
 * **추정 매출을 만들지 않는다** — 가격을 곱하거나 더하는 코드는 이 화면에 없다(CLAUDE.md §3).
 *
 * 1~2건인 칸은 함수가 **DB 안에서** 가려서 준다(`count: null`). 이 화면은 그것을 "3건 미만" 으로 적고 "기타" 로 묶어 보여 준다.
 * **익명화가 아니다**: 가려진 값은 같은 화면의 다른 숫자와 맞물리면 되짚을 수 있다(known-defects **D13**).
 * 이 화면은 관리자 전용이고 관리자는 예약 현황에서 원본을 본다 — 가리는 목적은 **캡처가 밖으로 나갔을 때의 예의 수준**이다.
 * 그래서 화면에도 "이 화면을 외부에 공유하지 마시라" 는 한 줄을 둔다(`admin.stats.suppressedLimit`).
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서 다시, 무조건 requireAdmin() 을 부른다**
 * (P5-3 리뷰 F1·F2 — 화면 하나하나가 스스로 잠기는 편이 안전하다). 이 호출에는 어떤 분기도 붙이지 않는다.
 * 조회는 세션 클라이언트다(서비스 롤 금지 — ADR-2). 캐시하지 않는다(ADR-3).
 *
 * 차트 라이브러리를 쓰지 않는다: 막대는 CSS(components/admin/admin.module.css 「통계」 절)이고 색은 역할 토큰뿐이다.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminStatsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();

  const params = await searchParams;
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.stats" });
  // 여행 구분 라벨은 위저드가 쓰는 것을 **그대로** 재사용한다 — 같은 코드가 두 화면에서 다른 이름으로 불리면 안 된다.
  const purposeLabels = await getTranslations({ locale: routing.defaultLocale, namespace: "quote.steps.purpose.options" });

  const period = parseStatsPeriod(params.period);
  const range = statsRange(period, toKstDateString(new Date()));
  const stats = await getAdminStats(range);
  const analyticsHref = vercelAnalyticsUrl();
  // 차량 라벨은 `vehicles.name_ko`(DB 가 진실)에서 온다. anon 키 + RLS 로 활성 차량만 — 개인정보가 없다.
  const vehicleNames = new Map((await getVehicles()).map((v) => [v.slug, v.nameKo]));

  const href = (p: StatsPeriod): string => (p === STATS_PERIODS[0] ? "/admin/stats" : `/admin/stats?period=${p}`);
  const count = (n: number): string => t("unit", { n });
  // 상태 분기와 막대 폭은 lib/admin/stats.ts 의 검증된 순수 함수가 정한다 — 이 파일에는 나눗셈이 한 건도 없다.
  const view = statsViewState(stats);
  const purgeWarning = isNearPurgeBoundary(range, toKstDateString(new Date()));
  // ⑤ 발송 문제 보정(P4-7 수정 라운드 3) — 0022 가 격리 행을 "보내지 못한 건" 으로, 중복 억제 행을 "실패" 로 세는 것을 앱에서 바로잡는다.
  // 관리자 세션일 때만(stats 가 null 이면 부르지 않는다). 창은 0022 가 준 값 그대로다.
  const attention = stats === null ? null : notifyAttention(stats.notifications, await getNotifyCorrections(stats.notifications));

  return (
    <main className={q.main} data-testid="admin-stats">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("title")}</h1>
          <p className={q.sub}>{t("sub")}</p>
        </header>

        <nav className={a.filters} aria-label={t("periodLabel")}>
          <span className={a.filterLabel}>{t("periodLabel")}</span>
          {STATS_PERIODS.map((p) => (
            <Link key={p} className={a.filter} href={href(p)} aria-current={p === period ? "true" : undefined}>
              {t(`period.${p}`)}
            </Link>
          ))}
        </nav>
        <p className={a.hint}>{t("rangeNote", { from: range.from, to: range.to })}</p>
        <p className={a.hint}>{t("cohortNote")}</p>

        {view === "denied" || stats === null ? (
          <p className={a.empty} data-testid="admin-stats-denied">
            {t("denied")}
          </p>
        ) : (
          <>
            <Overview stats={stats} t={t} count={count} purgeWarning={purgeWarning} />
            <Attention stats={stats} notify={attention ?? notifyAttention(stats.notifications, NO_CORRECTIONS)} t={t} count={count} />

            {view === "empty" ? (
              <p className={a.empty} data-testid="admin-stats-empty">
                {t("empty")}
              </p>
            ) : (
              <>
                <Trend stats={stats} t={t} />

                <section className={a.section} aria-labelledby="stats-inquiry">
                  <h2 className={a.sectionTitle} id="stats-inquiry">
                    {t("inquiry.title")}
                  </h2>
                  <p className={a.hint}>{t("suppressedNote")}</p>
                  <p className={a.hint}>{t("suppressedLimit")}</p>
                  <p className={a.hint}>{t("axisTotalNote")}</p>

                  <div className={a.subBlock}>
                    <h3 className={a.subTitle}>{t("inquiry.purposes")}</h3>
                    <p className={a.statNote}>{t("inquiry.purposesNote")}</p>
                    <ul className={a.barList}>
                      {stats.purposes.map((row, i) => (
                        <Bar
                          key={`purpose-${row.code ?? "other"}-${i}`}
                          label={
                            row.other
                              ? t("other")
                              : (PURPOSES as readonly string[]).includes(row.code ?? "")
                                ? purposeLabels(row.code as (typeof PURPOSES)[number])
                                : (row.code ?? t("other"))
                          }
                          value={row.count}
                          max={visibleMax(stats.purposes)}
                          suppressed={row.suppressed}
                          suppressedLabel={t("suppressed")}
                          count={count}
                        />
                      ))}
                    </ul>
                  </div>

                  <div className={a.subBlock}>
                    <h3 className={a.subTitle}>{t("inquiry.vehicles")}</h3>
                    <p className={a.statNote}>{t("inquiry.vehiclesNote")}</p>
                    <ul className={a.barList}>
                      {stats.vehicles.map((row, i) => (
                        <Bar
                          key={`vehicle-${row.slug ?? "other"}-${i}`}
                          label={row.other || row.slug === null ? t("other") : (vehicleNames.get(row.slug) ?? row.slug)}
                          value={row.count}
                          max={visibleMax(stats.vehicles)}
                          suppressed={row.suppressed}
                          suppressedLabel={t("suppressed")}
                          count={count}
                          sub={row.buses === null ? undefined : t("inquiry.buses", { n: row.buses })}
                        />
                      ))}
                    </ul>
                  </div>

                  <div className={a.subBlock}>
                    <h3 className={a.subTitle}>{t("inquiry.segments")}</h3>
                    <p className={a.statNote}>{t("inquiry.segmentsNote")}</p>
                    <div className={a.tableWrap}>
                      <table className={`${a.table} ${a.tableNarrow}`}>
                        <caption>{t("inquiry.segments")}</caption>
                        <thead>
                          <tr>
                            <th className={a.th} scope="col">
                              {t("inquiry.rank")}
                            </th>
                            <th className={a.th} scope="col">
                              {t("inquiry.segmentColumn")}
                            </th>
                            <th className={a.th} scope="col">
                              {t("inquiry.countColumn")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.segments.map((row, i) => (
                            <tr key={`seg-${row.origin ?? "x"}-${row.destination ?? "x"}-${i}`}>
                              <td className={`${a.td} ${a.tdNowrap}`}>{row.other ? "—" : i + 1}</td>
                              <td className={a.td}>
                                {row.other
                                  ? t("other")
                                  : t("inquiry.segmentLabel", { origin: placeLabel(row.origin), destination: placeLabel(row.destination) })}
                                {row.showcase ? <span className={`${a.badge} ${a.segBadge}`}>{t("inquiry.showcase")}</span> : null}
                              </td>
                              <td className={`${a.td} ${a.tdNowrap} ${a.tdStrong}`}>
                                {row.count === null ? t("suppressed") : count(row.count)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

                <section className={a.section} aria-labelledby="stats-lead">
                  <h2 className={a.sectionTitle} id="stats-lead">
                    {t("lead.title")}
                  </h2>
                  <p className={a.statNote}>{t("lead.note")}</p>
                  <p className={a.hint}>{t("axisTotalNote")}</p>
                  <ul className={a.barList}>
                    {stats.lead_time.map((row, i) => (
                      <Bar
                        key={`lead-${row.bucket ?? "other"}-${i}`}
                        label={row.other || row.bucket === null ? t("other") : t(`lead.${row.bucket}`)}
                        value={row.count}
                        max={visibleMax(stats.lead_time)}
                        suppressed={row.suppressed}
                        suppressedLabel={t("suppressed")}
                        count={count}
                      />
                    ))}
                  </ul>
                </section>
              </>
            )}
          </>
        )}

        <section className={a.section} aria-labelledby="stats-visits">
          <h2 className={a.sectionTitle} id="stats-visits">
            {t("visits.title")}
          </h2>
          <p className={a.statNote}>{t("visits.note")}</p>
          {analyticsHref === null ? (
            <p className={a.hint}>{t("visits.unset")}</p>
          ) : (
            <a className={a.statLink} href={analyticsHref} target="_blank" rel="noreferrer noopener">
              {t("visits.link")}
            </a>
          )}
        </section>
      </div>
    </main>
  );
}

// =============================================================================
// 구역
// =============================================================================

type T = Awaited<ReturnType<typeof getTranslations>>;

function Overview({
  stats,
  t,
  count,
  purgeWarning,
}: {
  stats: AdminStats;
  t: T;
  count: (n: number) => string;
  /** 조회 시작일이 보유기간 끝에 가까운가 — 그러면 확정률이 실제보다 높게 보인다(lib/admin/stats.ts MAX_RANGE_DAYS). */
  purgeWarning: boolean;
}) {
  const { intake, confirmation, response_time: resp } = stats;
  return (
    <section className={a.section} aria-labelledby="stats-overview">
      <h2 className={a.sectionTitle} id="stats-overview">
        {t("overview.title")}
      </h2>
      <div className={a.statGrid}>
        <article className={a.statCard}>
          <p className={a.statLabel}>{t("overview.intake")}</p>
          <p className={a.statValue}>{count(intake.total)}</p>
          <p className={a.statDelta}>{deltaText(intake.delta, t)}</p>
          <p className={a.statNote}>{t("overview.intakeNote")}</p>
        </article>

        <article className={a.statCard}>
          <p className={a.statLabel}>{t("overview.confirmed")}</p>
          <p className={a.statValue} data-weak={confirmation.rate_pct === null ? "true" : undefined}>
            {confirmation.rate_pct === null
              ? count(0)
              : t("overview.confirmedValue", { total: confirmation.total, n: confirmation.confirmed, pct: confirmation.rate_pct })}
          </p>
          <p className={a.statNote}>{t("overview.confirmedNote", { n: confirmation.pending })}</p>
          {purgeWarning ? (
            <p className={a.statNote} data-testid="admin-stats-purge-warning">
              {t("overview.purgeWarning")}
            </p>
          ) : null}
        </article>

        <article className={a.statCard}>
          <p className={a.statLabel}>{t("overview.response")}</p>
          <p className={a.statValue} data-weak={resp.enough ? undefined : "true"}>
            {resp.enough && resp.median_minutes !== null ? durationText(resp.median_minutes, t) : t("overview.responseFew")}
          </p>
          <p className={a.statNote}>{resp.enough ? t("overview.responseNote") : t("overview.responseFewNote")}</p>
        </article>
      </div>
    </section>
  );
}

function Attention({ stats, notify, t, count }: { stats: AdminStats; notify: NotifyAttention; t: T; count: (n: number) => string }) {
  const { backlog, notifications } = stats;
  // 보정된 값(notify)으로 그린다 — 격리 행은 "보내지 못한 건" 이 아니라 "발송됨 · 기록 확인 필요" 다(P4-7 수정 라운드 3).
  const notifyOk = notify.ok;
  return (
    <section className={a.section} aria-labelledby="stats-attention">
      <h2 className={a.sectionTitle} id="stats-attention">
        {t("attention.title")}
      </h2>
      <p className={a.hint}>{t("attention.periodFree")}</p>
      <div className={a.statGrid} data-cols="2">
        <article className={a.statCard}>
          <p className={a.statLabel}>{t("attention.backlog")}</p>
          <p className={a.statValue}>{count(backlog.new_total)}</p>
          <p className={a.statDelta}>
            {backlog.over_72h > 0
              ? t("attention.backlogOver", { hours: backlog.hours, n: backlog.over_72h })
              : t("attention.backlogClear", { hours: backlog.hours })}
          </p>
          <p className={a.statNote}>{t("attention.backlogNote")}</p>
          <Link className={a.statLink} href="/admin/reservations?status=new">
            {t("attention.backlogLink")}
          </Link>
        </article>

        <article className={a.statCard}>
          <p className={a.statLabel}>{t("attention.notify")}</p>
          {notifyOk ? (
            <p className={a.statValue} data-weak="true">
              {t("attention.ok")}
            </p>
          ) : (
            <>
              {notify.failed > 0 ? (
                <p className={a.statValue} data-testid="admin-stats-notify-failed">
                  {t("attention.notifyFailed", { n: notify.failed })}
                </p>
              ) : null}
              {notify.stuck > 0 ? (
                <p className={a.statDelta} data-testid="admin-stats-notify-stuck">
                  {t("attention.notifyStuck", { hours: notifications.stuck_hours, n: notify.stuck })}
                </p>
              ) : null}
              {notify.sentUnconfirmed > 0 ? (
                <>
                  <p className={a.statDelta} data-testid="admin-stats-notify-sent-unconfirmed">
                    {t("attention.notifySentUnconfirmed", { n: notify.sentUnconfirmed })}
                  </p>
                  <p className={a.statNote}>{t("attention.notifySentUnconfirmedNote")}</p>
                </>
              ) : null}
            </>
          )}
          <p className={a.statNote}>{t("attention.notifyNote", { days: notifications.window_days })}</p>
          <Link className={a.statLink} href={ADMIN_NOTIFICATIONS_PATH}>
            {t("attention.notifyLink")}
          </Link>
        </article>
      </div>
    </section>
  );
}

function Trend({ stats, t }: { stats: AdminStats; t: T }) {
  const points = stats.trend;
  // 막대 높이의 분모 — 가려진 칸을 세지 않고 0 이 되지 않는다(lib/admin/stats.ts visibleMax).
  const peak = visibleMax(points.map((p) => ({ count: p.total })));
  const unitKey = stats.range.bucket === "day" ? "trend.unitDay" : stats.range.bucket === "week" ? "trend.unitWeek" : "trend.unitMonth";
  const hasUnsplit = points.some((p) => !p.split);
  const kinds = hasUnsplit ? (["waiting", "confirmed", "cancelled", "unsplit"] as const) : (["waiting", "confirmed", "cancelled"] as const);
  return (
    <section className={a.section} aria-labelledby="stats-trend">
      <h2 className={a.sectionTitle} id="stats-trend">
        {t("trend.title")}
      </h2>
      <p className={a.statNote}>
        {t("trend.note")} · {t(unitKey)}
      </p>
      <p className={a.hint}>{t("trend.unsplitNote")}</p>
      <div className={a.trendChart} role="list" aria-label={t("trend.title")}>
        {points.map((p) => {
          const label = t(p.split ? "trend.bucketLabel" : "trend.bucketLabelUnsplit", { bucket: p.bucket, n: p.total });
          return (
            <div key={p.bucket} className={a.trendCol} role="listitem" title={label} aria-label={label}>
              <span className={a.trendStack} style={{ height: `${barWidthPercent(p.total, peak)}%` }}>
                {p.split ? (
                  <>
                    <span className={a.trendSeg} data-kind="cancelled" style={{ flex: `${p.cancelled ?? 0} 1 0` }} />
                    <span className={a.trendSeg} data-kind="confirmed" style={{ flex: `${p.confirmed ?? 0} 1 0` }} />
                    <span className={a.trendSeg} data-kind="waiting" style={{ flex: `${p.waiting ?? 0} 1 0` }} />
                  </>
                ) : (
                  <span className={a.trendSeg} data-kind="unsplit" style={{ flex: "1 1 0" }} />
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p className={a.trendAxis}>
        <span>{points[0]?.bucket ?? ""}</span>
        <span>{points[points.length - 1]?.bucket ?? ""}</span>
      </p>
      {/* 범례에 기간 합계를 적지 않는다 — 쪼개지지 않은 버킷이 섞이면 합이 뜻을 잃고, 상태별 합계는 위 «한눈에 보기» 가 말한다. */}
      <ul className={a.legend}>
        {kinds.map((kind) => (
          <li key={kind} className={a.legendItem}>
            <span className={a.legendSwatch} data-kind={kind} aria-hidden="true" />
            {t(`trend.${kind}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}

// =============================================================================
// 조각
// =============================================================================

function Bar({
  label,
  value,
  max,
  suppressed,
  suppressedLabel,
  count,
  sub,
}: {
  label: string;
  value: number | null;
  max: number;
  suppressed: boolean;
  suppressedLabel: string;
  count: (n: number) => string;
  sub?: string;
}) {
  return (
    <li className={a.barRow} data-suppressed={suppressed ? "true" : undefined}>
      <span className={a.barLabel}>{label}</span>
      <span className={a.barTrack}>
        <span className={a.barFill} style={{ width: `${barWidthPercent(value, max)}%` }} />
      </span>
      <span className={a.barValue}>{value === null ? suppressedLabel : count(value)}</span>
      {sub === undefined ? null : <span className={a.barSub}>{sub}</span>}
    </li>
  );
}

function placeLabel(code: string | null): string {
  if (code === null) return "—";
  return isLocationCode(code) ? locationLabelKo(code) : code;
}

function deltaText(delta: number | null, t: T): string {
  if (delta === null) return t("overview.prevNone");
  if (delta > 0) return t("overview.prevUp", { n: delta });
  if (delta < 0) return t("overview.prevDown", { n: -delta });
  return t("overview.prevSame");
}

/** 시간 표기는 lib 의 `medianDuration` 이 계산한다 — 이 파일은 단위에 맞는 문구만 고른다. */
function durationText(minutes: number, t: T): string {
  const d = medianDuration(minutes);
  return t(d.unit === "hours" ? "overview.responseHours" : "overview.responseDays", { n: d.value });
}

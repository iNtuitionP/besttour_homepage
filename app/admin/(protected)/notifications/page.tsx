import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import {
  CHANNEL_FILTERS,
  DEFAULT_NOTIFICATION_PAGE_SIZE,
  PERIOD_FILTERS,
  STATUS_FILTERS,
  getNotificationSummary,
  listNotifications,
  parseChannelFilter,
  parseCursor,
  parseNotificationStatusFilter,
  parsePeriodFilter,
} from "@/lib/admin/notifications";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { ALL_TEMPLATE_KEYS } from "@/lib/notify/outbox";
import { kstWallClock } from "@/lib/reservation-check/view";

import a from "@/components/admin/admin.module.css";
import q from "@/components/quote/quote.module.css";

/**
 * /admin/notifications — 발송 내역 (P5-8, 읽기 전용).
 *
 * 아웃박스(0005)는 보낼 것과 보낸 결과를 빠짐없이 기록하는데, 그 기록을 **읽는 화면이 없었다.** 확정 문자가 실패해도
 * 사장님이 알 방법이 없는 상태였다 — 이 화면이 그 구멍을 막는다. 맨 위 요약이 실패 건수를 먼저 말하고, 아래 표가
 * 어느 예약의 어떤 문자였는지 보여 준다.
 *
 * **쓰기가 없다.** 0009 는 notifications_log 에 select 정책 하나만 줬고(상태 전이는 0005·0007 의 definer 함수 몫),
 * 무엇보다 제공자 어댑터(P4-2)가 아직 없어 "다시 보내기" 는 누를 곳이 없다. 그래서 이 파일에는 폼도 버튼도 액션도 없다.
 * 재발송은 P4-2 이후 별도 태스크다.
 *
 * (protected) 그룹 안이라 레이아웃이 이미 게이트를 걸었지만 **여기서 다시, 무조건 requireAdmin() 을 부른다** —
 * 화면 하나하나가 스스로 잠기는 편이 안전하다(P5-3 리뷰 F1·F2). 이 호출에는 어떤 분기도 붙이지 않는다.
 *
 * 읽기는 lib/admin/notifications.ts 의 세션 클라이언트 + 0009 RLS 다(서비스 롤 금지 — ADR-2). **캐시하지 않는다**(ADR-3).
 * 받는 번호는 그 모듈이 이미 가려서 준다 — 원문은 여기까지 오지 않는다(반환 타입에 필드 자체가 없다).
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * 라벨을 찾을 수 있는 키인가. **`ALL_TEMPLATE_KEYS`** 다 — 예약 통지 4종 + 발송 실패 알림 2종(P4-4).
 *
 * P4-4 가 실패 알림 키를 `TEMPLATE_KEYS` 에 섞지 않은 판단은 옳았지만(라벨 1:1 게이트를 깨지 않으려던 것),
 * 여기가 그 좁은 목록을 그대로 보는 바람에 실패 알림 행의 템플릿 칸이 `created.owner.failure.email` 처럼
 * **키 원문**으로 나왔다. 사장님께 가장 중요한 행이 가장 읽기 어려웠다.
 * 이제 아웃박스가 받아들이는 키 전부에 라벨이 있고(messages/ko.json admin.notifications.template),
 * tests/admin-notifications.test.ts 의 1:1 게이트가 **그 합집합**을 잠근다.
 * 그 밖의 값(옛 행·손으로 넣은 행)은 여전히 원문 그대로 보여 준다 — 없는 번역 키를 조회하면 화면이 죽는다.
 */
const isTemplateKey = (t: string): boolean => (ALL_TEMPLATE_KEYS as readonly string[]).includes(t);

export default async function AdminNotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();

  const params = await searchParams;
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.notifications" });
  const status = parseNotificationStatusFilter(params.status);
  const channel = parseChannelFilter(params.channel);
  const period = parsePeriodFilter(params.period);
  const cursor = parseCursor(params.cursor);

  const summary = await getNotificationSummary();
  const { items, hasMore, nextCursor } = await listNotifications({ status, channel, period, cursor });

  const href = (over: { status?: string; channel?: string; period?: string; cursor?: number }): string => {
    const next = { status, channel, period, cursor: 0, ...over };
    const qs = new URLSearchParams();
    if (next.status !== "all") qs.set("status", next.status);
    if (next.channel !== "all") qs.set("channel", next.channel);
    if (next.period !== "all") qs.set("period", next.period);
    if (next.cursor > 0) qs.set("cursor", String(next.cursor));
    const s = qs.toString();
    return s ? `/admin/notifications?${s}` : "/admin/notifications";
  };

  return (
    <main className={q.main} data-testid="admin-notifications">
      <div className={a.pageWrap}>
        <header className={q.pageHead}>
          <h1 className={q.title}>{t("title")}</h1>
          <p className={q.sub}>{t("sub")}</p>
        </header>

        <section className={a.summary} data-ok={summary.ok ? "true" : "false"} aria-label={t("summary.title")}>
          <h2 className={a.summaryTitle}>{t("summary.title")}</h2>
          {summary.ok ? (
            <p className={a.summaryOk}>{t("summary.ok")}</p>
          ) : (
            <>
              <ul className={a.summaryList}>
                {summary.failed > 0 ? <li className={a.summaryAlert}>{t("summary.failed", { n: summary.failed })}</li> : null}
                {summary.stuck > 0 ? <li className={a.summaryAlert}>{t("summary.stuck", { n: summary.stuck })}</li> : null}
                {summary.sentUnconfirmed > 0 ? (
                  <li className={a.summaryAlert} data-testid="admin-notifications-sent-unconfirmed">
                    {t("summary.sentUnconfirmed", { n: summary.sentUnconfirmed })}
                  </li>
                ) : null}
              </ul>
              {summary.failed > 0 || summary.stuck > 0 ? <p className={a.summaryNote}>{t("summary.note")}</p> : null}
              {summary.sentUnconfirmed > 0 ? <p className={a.summaryNote}>{t("summary.sentUnconfirmedNote")}</p> : null}
            </>
          )}
        </section>

        <nav className={a.filters} aria-label={t("filterStatusLabel")}>
          <span className={a.filterLabel}>{t("filterStatusLabel")}</span>
          {STATUS_FILTERS.map((f) => (
            <Link key={f} className={a.filter} href={href({ status: f })} aria-current={f === status ? "true" : undefined}>
              {t(`filterStatus.${f}`)}
            </Link>
          ))}
        </nav>

        <nav className={a.filters} aria-label={t("filterChannelLabel")}>
          <span className={a.filterLabel}>{t("filterChannelLabel")}</span>
          {CHANNEL_FILTERS.map((f) => (
            <Link key={f} className={a.filter} href={href({ channel: f })} aria-current={f === channel ? "true" : undefined}>
              {t(`filterChannel.${f}`)}
            </Link>
          ))}
        </nav>

        <nav className={a.filters} aria-label={t("filterPeriodLabel")}>
          <span className={a.filterLabel}>{t("filterPeriodLabel")}</span>
          {PERIOD_FILTERS.map((f) => (
            <Link key={f} className={a.filter} href={href({ period: f })} aria-current={f === period ? "true" : undefined}>
              {t(`filterPeriod.${f}`)}
            </Link>
          ))}
        </nav>

        <p className={a.hint}>{t("maskNote")}</p>

        {items.length === 0 ? (
          <p className={a.empty}>{t("empty")}</p>
        ) : (
          <div className={a.tableWrap}>
            <table className={a.table}>
              <caption>{t("listLabel")}</caption>
              <thead>
                <tr>
                  <th className={a.th} scope="col">{t("col.status")}</th>
                  <th className={a.th} scope="col">{t("col.channel")}</th>
                  <th className={a.th} scope="col">{t("col.template")}</th>
                  <th className={a.th} scope="col">{t("col.to")}</th>
                  <th className={a.th} scope="col">{t("col.code")}</th>
                  <th className={a.th} scope="col">{t("col.attempts")}</th>
                  <th className={a.th} scope="col">{t("col.nextAttemptAt")}</th>
                  <th className={a.th} scope="col">{t("col.lastError")}</th>
                  <th className={a.th} scope="col">{t("col.createdAt")}</th>
                  <th className={a.th} scope="col">{t("col.updatedAt")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td className={a.td}>
                      {row.recordState === null ? (
                        <span className={a.badge} data-status={row.status}>
                          {t(`status.${row.status}`)}
                        </span>
                      ) : (
                        // 격리 행(보냈지만 기록 못 함)·중복 억제 행은 "대기"·"실패" 배지가 아니다(P4-7 수정 라운드 3)
                        <span className={a.badge} data-status="sent" data-record={row.recordState}>
                          {t(`recordState.${row.recordState}`)}
                        </span>
                      )}
                    </td>
                    <td className={`${a.td} ${a.tdNowrap}`}>{t(`channel.${row.channel}`)}</td>
                    <td className={`${a.td} ${a.tdNowrap}`}>{isTemplateKey(row.template) ? t(`template.${row.template}`) : row.template}</td>
                    <td className={`${a.td} ${a.tdNowrap}`}>{row.toMasked}</td>
                    <td className={`${a.td} ${a.tdNowrap}`}>
                      {row.reservationId === null ? (
                        t("none")
                      ) : (
                        <Link className={a.rowLink} href={`/admin/reservations/${row.reservationId}`}>
                          {row.publicCode ?? t("none")}
                        </Link>
                      )}
                    </td>
                    <td className={`${a.td} ${a.tdNowrap}`}>{t("attemptsValue", { n: row.attempts })}</td>
                    <td className={`${a.td} ${a.tdNowrap}`}>{kstWallClock(row.nextAttemptAt)}</td>
                    <td className={a.td}>{row.lastError ?? t("none")}</td>
                    <td className={`${a.td} ${a.tdNowrap}`}>{kstWallClock(row.createdAt)}</td>
                    <td className={`${a.td} ${a.tdNowrap}`}>{kstWallClock(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cursor > 0 || hasMore ? (
          <nav className={a.pager} aria-label={t("pageLabel")}>
            {cursor > 0 ? (
              <Link className={a.pagerLink} href={href({ cursor: Math.max(0, cursor - DEFAULT_NOTIFICATION_PAGE_SIZE) })}>
                {t("prev")}
              </Link>
            ) : null}
            {hasMore && nextCursor !== null ? (
              <Link className={a.pagerLink} href={href({ cursor: nextCursor })}>
                {t("next")}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </main>
  );
}

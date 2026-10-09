import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { formatAdminDate } from "@/components/admin/admin-date";
import { getAdminDateLabels } from "@/components/admin/adminDateLabels";
import { keepLastWord, segments, splitSegments } from "@/components/admin/segments";
import { routing } from "@/i18n/routing";
import { notifyErrorKey, pendingSubState } from "@/lib/admin/notificationDisplay";
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
  type NotificationListRow,
} from "@/lib/admin/notifications";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { ALL_TEMPLATE_KEYS } from "@/lib/notify/outbox";

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
 *
 * P5-23 라운드 2(컨트롤러 A-1 · A-2 · A-3 · B-6 · B-7)
 *   - 마지막 오류: 발송기가 적은 **코드 원문은 보이는 글자로 그리지 않는다** — 짧은 한국어 라벨(admin.notifications.error.*)을 그리고
 *     원문은 title(툴팁)에만 둔다. 판정은 lib/admin/notificationDisplay.ts(모르는 코드는 '기타 오류').
 *   - '대기' 배지 아래 둘째 줄: 보내는 중 / 다시 보낼 예정 {시각} / 오래 멈춤 — 확인 필요. 격리·중복 행은 자기 배지(P4-7)만 단다.
 *   - 시각은 관리자 날짜 틀 하나(components/admin/admin-date.ts — "9월 29일 (화) 22:07").
 *   - 칸: 상태 · 알림(종류 · 문자 종류) · 받는 번호 · 접수번호 · 시도 · 오류 · 기록 시각(갱신은 둘째 줄). '다음 시도' 칸은 '다시 보낼 예정' 줄로 옮겼다 —
 *     격리 행의 먼 미래 다음 시도(격리 표식)는 어디에도 날짜로 나오지 않는다.
 *   - 1280px 이상은 표(옆으로 밀리지 않는다), 그보다 좁으면 행이 카드가 된다(같은 마크업 — 칸마다 작은 라벨이 보인다). 1024~1279px 은 사이드바가
 *     본문을 712px 로 줄여 7칸이 한 줄에 들어가지 않는다(실측) — 그래서 카드가 되는 경계가 1024 가 아니라 1280 이다.
 *   - 맨 위 요약: 이어 쓴 문장 대신 세 칸(작은 이름 · 큰 숫자 · 작은 기간).
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

/** 갱신 시각을 둘째 줄로 보일 만큼 기록 시각과 다른가(1분 이상 — 곧바로 보낸 행은 한 줄로 둔다). */
const UPDATED_LINE_MIN_MS = 60_000;

export default async function AdminNotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();

  const params = await searchParams;
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.notifications" });
  const dateLabels = await getAdminDateLabels();
  const status = parseNotificationStatusFilter(params.status);
  const channel = parseChannelFilter(params.channel);
  const period = parsePeriodFilter(params.period);
  const cursor = parseCursor(params.cursor);

  // 요약과 목록은 서로 기다릴 이유가 없어 동시에 읽는다(P5-18 — 게이트를 통과한 뒤에만 시작한다).
  const [summary, { items, hasMore, nextCursor }] = await Promise.all([
    getNotificationSummary(),
    listNotifications({ status, channel, period, cursor }),
  ]);

  const now = new Date();
  const when = (iso: string): string => formatAdminDate(iso, now, dateLabels, { time: true, keep: true }) ?? t("none");

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

  // 요약 세 칸 — 이름 · 숫자 · 작은 기간. '기록 확인 필요' 칸의 작은 줄은 "발송됨 · 전체 기간"(이름을 짧게 하고 '발송됨' 을 이리로 — 라운드 3)
  const summaryItems = [
    { key: "failed", n: summary.failed, period: [t("summary.periodAll")] },
    // 둘째 칸은 마지막 시도(updated_at)로 센다 — 작은 줄도 그대로 "마지막 시도 · 최근 24시간"(재검토 P2-A)
    { key: "stuck", n: summary.stuck, period: splitSegments(t("summary.grid.stuckNote", { hours: summary.windowHours })) },
    { key: "sentUnconfirmed", n: summary.sentUnconfirmed, period: splitSegments(t("summary.grid.sentUnconfirmedNote")) },
  ] as const;

  /** 상태 칸 — 배지 + ('대기'면) 둘째 줄. 격리·중복 행은 자기 배지만(P4-7 수정 라운드 3 — '대기'·'실패' 배지가 아니다). */
  const statusCell = (row: NotificationListRow) => {
    if (row.recordState !== null) {
      return (
        <span className={a.badge} data-status="sent" data-record={row.recordState}>
          {t(`recordState.${row.recordState}`)}
        </span>
      );
    }
    const sub = pendingSubState(row, now);
    return (
      <>
        <span className={a.badge} data-status={row.status}>
          {t(`status.${row.status}`)}
        </span>
        {sub !== null ? (
          <span className={a.subState} data-kind={sub.kind} data-testid="admin-notification-substate">
            {/* 둘째 줄은 요청의 한 순간(now)에 대어 가른다(리뷰 P1-1). "보낼 차례 · 다음 발송 때 나가요" 는 조각 줄 — 가운데점이 줄 머리·끝에 서지 않는다 */}
            {sub.kind === "retry" ? t("pending.retry", { time: when(sub.at) }) : segments(splitSegments(t(`pending.${sub.kind}`)))}
          </span>
        ) : null}
      </>
    );
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
          {summary.ok ? <p className={a.summaryOk}>{t("summary.ok")}</p> : null}
          <dl className={a.summaryGrid}>
            {summaryItems.map((item) => (
              <div
                key={item.key}
                className={a.summaryItem}
                data-alert={item.n > 0 ? "true" : undefined}
                data-kind={item.key}
                data-testid={item.key === "sentUnconfirmed" ? "admin-notifications-sent-unconfirmed" : undefined}
              >
                {/* 이름이 두 줄이 되면 마지막 낱말만 떨어지지 않게 · 작은 줄은 조각(구분점은 같은 줄 두 조각 사이에만 — 라운드 3) */}
                <dt className={a.summaryLabel}>{keepLastWord(t(`summary.grid.${item.key}`))}</dt>
                <dd className={a.summaryNum}>{t("summary.count", { n: item.n })}</dd>
                <dd className={a.summaryPeriod}>{segments(item.period)}</dd>
              </div>
            ))}
          </dl>
          {summary.failed > 0 || summary.stuck > 0 ? <p className={a.summaryNote}>{t("summary.note")}</p> : null}
          {summary.sentUnconfirmed > 0 ? <p className={a.summaryNote}>{t("summary.sentUnconfirmedNote")}</p> : null}
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
          <div className={a.empty}>
            <p>{t("empty")}</p>
            {status !== "all" || channel !== "all" || period !== "all" ? (
              <Link className={a.emptyAction} href="/admin/notifications">
                {t("clearFilter")}
              </Link>
            ) : null}
          </div>
        ) : (
          <div className={`${a.tableWrap} ${a.notifyWrap}`}>
            <table className={a.notifyTable} data-testid="admin-notifications-table">
              <caption className={a.srOnly}>{t("listLabel")}</caption>
              <thead>
                <tr>
                  <th className={a.th} scope="col">{t("col.status")}</th>
                  <th className={a.th} scope="col">{t("col.alert")}</th>
                  <th className={a.th} scope="col">{t("col.to")}</th>
                  <th className={a.th} scope="col">{t("col.code")}</th>
                  <th className={a.th} scope="col">{t("col.attempts")}</th>
                  <th className={a.th} scope="col">{t("col.lastError")}</th>
                  <th className={a.th} scope="col">{t("col.time")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const errorKey = notifyErrorKey(row.lastError);
                  const updatedApart = Math.abs(Date.parse(row.updatedAt) - Date.parse(row.createdAt)) >= UPDATED_LINE_MIN_MS;
                  return (
                    <tr key={row.id} data-row-status={row.status}>
                      <td className={a.td} data-cell="status">
                        {statusCell(row)}
                      </td>
                      <td className={`${a.td} ${a.tdStrong}`} data-cell="alert">
                        {segments([t(`channel.${row.channel}`), isTemplateKey(row.template) ? t(`template.${row.template}`) : row.template])}
                      </td>
                      <td className={`${a.td} ${a.tdNowrap}`}>
                        <span className={a.cellLabel}>{t("col.to")}</span>
                        <span className={a.cellValue}>{row.toMasked}</span>
                      </td>
                      <td className={`${a.td} ${a.tdNowrap}`}>
                        <span className={a.cellLabel}>{t("col.code")}</span>
                        <span className={a.cellValue}>
                          {row.reservationId === null ? (
                            t("none")
                          ) : (
                            <Link className={a.rowLink} href={`/admin/reservations/${row.reservationId}`}>
                              {row.publicCode ?? t("none")}
                            </Link>
                          )}
                        </span>
                      </td>
                      <td className={`${a.td} ${a.tdNowrap}`}>
                        <span className={a.cellLabel}>{t("col.attempts")}</span>
                        <span className={a.cellValue}>{t("attemptsValue", { n: row.attempts })}</span>
                      </td>
                      <td className={a.td} data-empty={errorKey === null ? "true" : undefined}>
                        <span className={a.cellLabel}>{t("col.lastError")}</span>
                        <span className={a.cellValue}>
                          {errorKey === null ? (
                            t("none")
                          ) : (
                            // 보이는 글자는 라벨, 코드 원문은 툴팁에만(A-1) — 사장님 화면에 영문 코드가 새지 않는다
                            <span className={a.errorLabel} title={row.lastError ?? undefined} data-error={errorKey}>
                              {t(`error.${errorKey}`)}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={`${a.td} ${a.tdNowrap}`}>
                        <span className={a.cellLabel}>{t("col.time")}</span>
                        <span className={a.cellValue}>
                          <span className={a.timeMain}>{when(row.createdAt)}</span>
                          {updatedApart ? <span className={a.timeSub}>{t("updatedLine", { time: when(row.updatedAt) })}</span> : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
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

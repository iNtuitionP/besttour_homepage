/**
 * 관리 홈 대시보드 — 순수 계산 (P5-21 · 시안 docs/handoff/2026-09-27-admin-ux #home · 제안서 ⑤-1 · ④ 원칙 1·2).
 *
 * React·Next·DB·env·한글 리터럴 없음 — tests/admin-dashboard.test.ts 가 그대로 부른다. 화면(app/admin/(protected)/page.tsx)은
 * 게이트 뒤에 조회를 **동시에**(Promise.allSettled) 보내고, 그 결과를 여기에 넘겨 무엇을 말할지 정한다.
 *
 * 규칙
 *   - 숫자는 전부 DB 가 지금 센 값이다(실증 문제 없음 — CLAUDE.md §3). 가격은 계산하지 않는다 — 대표 노선은 금액이 **비어 있는지만** 센다
 *     (components/admin/hub.ts routesLine 그대로).
 *   - 조회가 실패한 칸은 "모름" 이다 — "0건"·"이상 없음" 이라 하지 않는다(P5-20 허브와 같은 규칙). 서로 따로 센 두 수가 어긋나면
 *     (예: 간편 + 상세 ≠ 새 접수 — 두 집계 사이에 접수가 들어옴) 어긋난 줄을 보이지 않는다(지어내지 않는다).
 *   - 기간은 전부 KST 달력이다:
 *       이번 주 운행  확정 중 출발이 [오늘 00:00, 7일 뒤 00:00) — 오늘 새벽 출발도 들어간다(간편 접수는 출발 시각이 00:00 자리값이다).
 *                    시작은 접수 목록 확정 탭의 경계(reservation-list.ts kstTodayStart)와 **같은 값**이다 — 카드가 그 탭으로 보내고, 그 탭의
 *                    쪽 1 맨 앞이 곧 이 카드의 운행이다(P5-21 수정 라운드 · 리뷰 P1-1).
 *       답이 늦은 접수  새 접수 중 created_at < 지금 − 72시간 — 상태 배지(isOverdue)·0022 backlog 와 같은 쪽의 경계(딱 72시간은 아니다)
 *       이번 달      [이달 1일 00:00, 내일 00:00) — 통계 화면 '이번 달'(lib/admin/stats.ts statsRange thisMonth)과 같은 기간
 *       문자 발송    최근 7일(created_at) — 발송 기록 화면의 기간 필터 '7d' 와 같은 창(lib/admin/notifications.ts getHomeSendAlerts)
 */
import { addDaysToKey, kstDayDiff, kstDayStart, kstParts, kstTodayStart } from "./reservation-list";
import { BACKLOG_HOURS } from "./status-badge";

type Settled<T> = PromiseSettledResult<T>;

const HOUR_MS = 3_600_000;

/** 다가오는 운행을 보는 날 수(오늘 포함). */
export const UPCOMING_DAYS = 7;

/** 인스턴트 두 개(ISO · UTC) — `from` 포함 · `to` 제외. */
export interface InstantWindow {
  from: string;
  to: string;
}

function todayKey(now: Date): string {
  const p = kstParts(now);
  if (p === null) throw new Error("dashboard: invalid now");
  return p.dateKey;
}

/** 이번 주 운행 — KST 오늘 00:00(= 확정 탭의 경계 kstTodayStart) ~ 7일 뒤 00:00. */
export function upcomingWindow(now: Date): InstantWindow {
  const today = todayKey(now);
  return { from: kstTodayStart(now), to: kstDayStart(addDaysToKey(today, UPCOMING_DAYS)) };
}

/** 답이 늦은 접수의 기준 시각 — created_at 이 이것보다 **앞**이면 72시간이 넘었다. */
export function overdueCutoff(now: Date): string {
  return new Date(now.getTime() - BACKLOG_HOURS * HOUR_MS).toISOString();
}

/** 이번 달 — KST 이달 1일 00:00 ~ 내일 00:00(통계 화면 '이번 달' 과 같은 기간). */
export function monthWindow(now: Date): InstantWindow {
  const today = todayKey(now);
  return { from: kstDayStart(`${today.slice(0, 8)}01`), to: kstDayStart(addDaysToKey(today, 1)) };
}

// =============================================================================
// 한 줄 요약 · 카드 값
// =============================================================================

export type HomeLede = { kind: "unknown" } | { kind: "none" } | { kind: "waiting"; n: number } | { kind: "overdue"; n: number; m: number };

/** "새 접수 N건이 기다리고 있어요. 그중 M건은 72시간이 넘었어요." — M 을 모르거나 N 과 어긋나면 N 만 말한다. */
export function homeLede(total: Settled<number>, overdue: Settled<number>): HomeLede {
  if (total.status !== "fulfilled") return { kind: "unknown" };
  const n = total.value;
  if (n <= 0) return { kind: "none" };
  if (overdue.status === "fulfilled" && overdue.value > 0 && overdue.value <= n) return { kind: "overdue", n, m: overdue.value };
  return { kind: "waiting", n };
}

/** 간편 · 상세 나눔 — 둘을 따로 센 합이 새 접수 수와 같을 때만. */
export function newSplit(total: Settled<number>, split: Settled<{ quick: number; wizard: number }>): { quick: number; wizard: number } | null {
  if (total.status !== "fulfilled" || split.status !== "fulfilled") return null;
  return split.value.quick + split.value.wizard === total.value ? { quick: split.value.quick, wizard: split.value.wizard } : null;
}

/** 최근 7일 발송 경보 — lib/admin/notifications.ts getHomeSendAlerts 의 모양(이 순수 모듈은 서버 모듈을 가져오지 않는다). */
type SendAlertsLike = { customerFailed: number; ownerFailed: number };

export type SendCard = { kind: "unknown" } | { kind: "ok"; owner: number } | { kind: "problems"; customer: number; owner: number };

/**
 * 문자 발송 카드(P5-21 수정 라운드 · 컨트롤러 결정 P1-2) — **최근 7일 고객 문자 실패**로만 이상 없음 / 확인 필요를 정한다.
 * 사장님 쪽 알림 실패(접수 알림 문자·메일 · 발송 실패 알림 메일)는 같은 7일의 수를 작은 줄로만 따라 보인다 — 급함이 아니고 배너도 아니다.
 * 전에는 기간 없는 누적(발송 기록 요약)이라 한 번 뜨면 사라지지 않았다(리뷰 P1-2 — 확정 건은 파기까지 5년).
 */
export function sendCard(res: Settled<SendAlertsLike>): SendCard {
  if (res.status !== "fulfilled") return { kind: "unknown" };
  const { customerFailed, ownerFailed } = res.value;
  return customerFailed > 0 ? { kind: "problems", customer: customerFailed, owner: ownerFailed } : { kind: "ok", owner: ownerFailed };
}

/** 배너 — 최근 7일 고객 문자 실패 수. 없거나(사장님 쪽 실패만 있어도) 모르면 null(배너 없음). */
export function sendBanner(res: Settled<SendAlertsLike>): number | null {
  return res.status === "fulfilled" && res.value.customerFailed > 0 ? res.value.customerFailed : null;
}

// =============================================================================
// 다가오는 운행 — KST 날짜별 묶음
// =============================================================================

export interface TripDay<T> {
  dateKey: string;
  month: number;
  day: number;
  weekday: number;
  /** 오늘까지 남은 날(오늘 0). */
  diff: number;
  items: T[];
}

/** 출발 순으로 온 행을 KST 날짜별로 묶는다(날짜 순). 읽을 수 없는 출발 시각의 행은 넣지 않는다(자리를 지어내지 않는다). */
export function tripDays<T extends { depart_at: string }>(rows: readonly T[], now: Date): TripDay<T>[] {
  const byKey = new Map<string, TripDay<T>>();
  for (const row of rows) {
    const p = kstParts(row.depart_at);
    const diff = kstDayDiff(row.depart_at, now);
    if (p === null || diff === null) continue;
    const day = byKey.get(p.dateKey) ?? { dateKey: p.dateKey, month: p.month, day: p.day, weekday: p.weekday, diff, items: [] };
    day.items.push(row);
    byKey.set(p.dateKey, day);
  }
  return [...byKey.values()].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}

/** 카드의 날짜 나열 — 앞에서 `max` 날까지, 나머지는 날 수만. */
export function tripDatesLine<T>(days: readonly TripDay<T>[], max = 3): { shown: TripDay<T>[]; more: number } {
  return { shown: days.slice(0, max), more: days.length > max ? days.length - max : 0 };
}

/**
 * 관리자 상태 배지 — 순수 모델 (P5-20 · 시안 docs/handoff/2026-09-27-admin-ux ⑤-0 · 제안서 ④ 원칙 2).
 *
 * React·Next·DB·env 없음 — tests/admin-status-badge.test.ts 가 그대로 부른다. 그리는 쪽은 components/admin/StatusBadge.tsx.
 *
 * "상태는 해야 할 일로 읽힌다"
 *   - 처리가 필요한 상태가 **가장 강하고**(새 접수 = 골드 · N일째 대기 = 가장 짙은 보라), 끝난 상태가 **가장 약하다**(운행 완료 = 회색 실선 ·
 *     취소 = 회색 점선). 톤은 styles/semantic.css 의 `--status-*` 역할 토큰이다(브랜드 원시색만 — 새 색 없음).
 *   - **색만으로 구분하지 않는다**(WCAG 1.4.1) — 종류마다 글자와 **모양 표식**(점 · ! · ✓ · 없음 · × · 전화)과 선(실선·점선)이 다르다.
 *     한 줄에 함께 보일 수 있는 배지(예약 상태 다섯 + 간편 칩)는 표식·선의 짝이 서로 겹치지 않는다(테스트가 잠근다).
 *
 * N일째 대기 — `new` 이면서 접수 뒤 BACKLOG_HOURS(72시간)가 **넘은** 것. 0022 `admin_stats` 의 backlog(`created_at < now() - 72h`)와
 *   **같은 값·같은 쪽의 경계**다(딱 72시간은 아직 새 접수). 통계 카드의 "72시간이 지난 건 N건" 과 목록·상세의 배지가 어긋나지 않는다 —
 *   tests/admin-status-badge.test.ts 가 0022 의 `c_backlog_hours` 를 읽어 이 상수와 대조한다. 앱 쪽 다른 파일은 72 를 다시 적지 않는다.
 *   N 은 지난 날수(24시간 단위 내림)다 — 72시간이 막 넘으면 "3일째"(시안 예시 "3일째 대기 · 3일 전").
 *
 * 문구는 여기 없다(한글 리터럴 0): 라벨은 messages/ko.json `admin.reservations.status.*` · `admin.labels.quickBadge` 를
 * 서버 도우미(components/admin/statusBadgeLabels.ts)가 풀어 준다. `waiting` 은 `{days}` 자리가 빈 **틀**이다.
 */
import type { ReservationStatus } from "@/lib/reservation-check/view";

/** 72시간 — 0022 `c_backlog_hours` 와 같은 값(통계의 "답이 늦은 접수" 와 같은 기준). */
export const BACKLOG_HOURS = 72;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** 배지 종류 — 순서가 곧 설명 순서다. `overdue` 는 한 건이 아니라 묶음의 이름(통계·홈 카드 "답이 늦은 접수")이다. */
export const STATUS_BADGE_KINDS = ["new", "waiting", "confirmed", "done", "cancelled", "quick", "overdue"] as const;
export type StatusBadgeKind = (typeof STATUS_BADGE_KINDS)[number];

export type StatusBadgeModel = { kind: Exclude<StatusBadgeKind, "waiting"> } | { kind: "waiting"; days: number };

/** 톤 — `--status-*` 토큰 묶음 하나(quick 은 기존 --border-strong · --text-brand). */
export type BadgeTone = "attention" | "urgent" | "confirmed" | "closed" | "quick";
/** 모양 표식 — 글자 앞의 작은 그림. none 은 표식 없음(운행 완료: 실선 테두리만). */
export type BadgeMark = "dot" | "alert" | "check" | "none" | "x" | "phone";
/** 테두리 — 운행 완료(실선)와 취소(점선)는 같은 회색이라 선 모양으로도 가른다. 급함은 채운 면이라 선이 없다. */
export type BadgeLine = "solid" | "dashed" | "none";

export interface BadgeLook {
  tone: BadgeTone;
  mark: BadgeMark;
  line: BadgeLine;
}

export const BADGE_LOOK: Readonly<Record<StatusBadgeKind, BadgeLook>> = {
  new: { tone: "attention", mark: "dot", line: "solid" },
  waiting: { tone: "urgent", mark: "alert", line: "none" },
  confirmed: { tone: "confirmed", mark: "check", line: "solid" },
  done: { tone: "closed", mark: "none", line: "solid" },
  cancelled: { tone: "closed", mark: "x", line: "dashed" },
  quick: { tone: "quick", mark: "phone", line: "solid" },
  overdue: { tone: "urgent", mark: "alert", line: "none" },
};

/** 배지 글자 — 서버가 카탈로그에서 풀어 준다. `waiting` 은 `{days}` 자리가 빈 틀. */
export interface StatusBadgeLabels {
  new: string;
  waiting: string;
  confirmed: string;
  done: string;
  cancelled: string;
  quick: string;
  overdue: string;
}

/** 접수 뒤 지난 시간(ms). 읽을 수 없는 시각이면 NaN — 아래 판정은 NaN 을 "넘지 않음" 으로 읽는다(지어내지 않는다). */
function ageMs(createdAt: string, now: Date): number {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? now.getTime() - t : Number.NaN;
}

/** 72시간이 **넘었는가**(0022 의 `created_at < now() - 72h` 와 같은 쪽 — 딱 72시간은 아니다). 미래 시각·읽을 수 없는 시각은 false. */
export function isOverdue(createdAt: string, now: Date): boolean {
  return ageMs(createdAt, now) > BACKLOG_HOURS * HOUR_MS;
}

/** 지난 날수 — 24시간 단위 내림(72시간 막 넘음 = 3). */
export function waitingDays(createdAt: string, now: Date): number {
  const age = ageMs(createdAt, now);
  return Number.isFinite(age) && age > 0 ? Math.floor(age / DAY_MS) : 0;
}

/** 예약 한 건의 배지 — `new` 이고 72시간이 넘었으면 N일째 대기, 아니면 상태 그대로. */
export function reservationBadge(status: ReservationStatus, createdAt: string, now: Date): StatusBadgeModel {
  if (status === "new") return isOverdue(createdAt, now) ? { kind: "waiting", days: waitingDays(createdAt, now) } : { kind: "new" };
  return { kind: status };
}

/** 배지 글자 — N일째 대기는 틀의 `{days}` 를 채운다. */
export function badgeText(badge: StatusBadgeModel, labels: StatusBadgeLabels): string {
  if (badge.kind === "waiting") return String(labels.waiting).replace("{days}", String(badge.days));
  return labels[badge.kind];
}

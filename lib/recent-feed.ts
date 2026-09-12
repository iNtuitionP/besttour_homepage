/**
 * 홈 "접수 현황" 피드 — 마스킹 계약 (P3-5 · G4 · 원장 PRIVACY_NOTICE.publicFeedNotice "성명 일부·차종·운행일·접수 상태만").
 *
 * 순수 모듈 — Next·Supabase·env·server-only 없음. 여기 있는 것:
 *   - RECENT_SELECT_COLUMNS  서버가 reservations 에서 읽어도 되는 컬럼 화이트리스트. 전화·이메일·메시지·id·public_code 는
 *                            목록 자체에 없어 마스킹 전 단계의 메모리에도 올라오지 않는다.
 *   - RecentReservationRow   그 5컬럼만 가진 행 타입(키 = 화이트리스트, tests/recent-feed.test.ts §3 이 컴파일 타임에 대조).
 *   - RecentFeedItem         홈에 내려가는 항목. **원문 필드가 타입에 없다** — maskedName·vehicleLabel·departDateKst·status 뿐이라
 *                            phone·email·id·public_code 는 실수로도 못 내린다.
 *   - mapRecentRows          행 → 항목. 이름은 lib/mask.ts maskName 그대로(새 규칙 없음), 운행일은 lib/kst.ts 로 KST 달력 날짜 → "M/D".
 *                            공개 상태(new·confirmed)가 아니거나 라벨·날짜를 만들 수 없는 행은 **버린다**(fail-closed — slug·원문을 대신 보여 주지 않는다).
 *
 * 왜 lib/types.ts 가 아니라 여기인가: 이 타입은 lib/queries/recent.ts(서비스 롤 읽기)와 components/home(렌더·프리뷰)이 함께 쓴다.
 * 홈 섹션 컴포넌트는 lib/queries 를 import 하지 않는 규약(tests/home.test.ts §8)이라 타입을 쿼리 모듈에 둘 수 없고,
 * lib/types.ts 는 P3-4 가 동시에 수정 중이라 건드리지 않았다(P3-5 보고서 §판단). 나중에 lib/types.ts 로 옮겨도 소비자는 import 경로만 바뀐다.
 */
import { toKstDateString } from "./kst";
import { maskName } from "./mask";

export interface RecentReservationRow {
  name: string;
  vehicle_slug: string;
  /** timestamptz — PostgREST 가 ISO 문자열로 준다. */
  depart_at: string;
  status: string;
  /** 정렬용(최근순). 항목으로는 내려가지 않는다. */
  created_at: string;
}

/** reservations 에서 읽는 컬럼 전부. 이 배열이 곧 select 문자열이다(lib/queries/recent.ts RECENT_SELECT). */
export const RECENT_SELECT_COLUMNS = [
  "name",
  "vehicle_slug",
  "depart_at",
  "status",
  "created_at",
] as const satisfies readonly (keyof RecentReservationRow)[];
export type RecentSelectColumn = (typeof RECENT_SELECT_COLUMNS)[number];

/** 홈에 올리는 상태 — 취소·완료 건은 피드에 없다. 쿼리(.in)와 매퍼가 이중으로 거른다. */
export const RECENT_PUBLIC_STATUSES = ["new", "confirmed"] as const;
export type RecentPublicStatus = (typeof RECENT_PUBLIC_STATUSES)[number];

export interface RecentFeedItem {
  /** maskName(name) — 첫 글자 + '*' 1~2개. 예: "한**" */
  maskedName: string;
  /** vehicles.name_ko — slug 가 아니다. */
  vehicleLabel: string;
  /** 운행일, KST 달력 날짜 "M/D"(제로패딩 없음). 시각·출발지·도착지·인원은 내리지 않는다(원장 고지 범위 밖). */
  departDateKst: string;
  status: RecentPublicStatus;
}

function isPublicStatus(status: string): status is RecentPublicStatus {
  return (RECENT_PUBLIC_STATUSES as readonly string[]).includes(status);
}

/** UTC 인스턴트 → KST 달력 "M/D". 서버 TZ 와 무관(lib/kst.ts). 유효하지 않은 Date 는 toKstDateString 이 throw 한다. */
export function kstMonthDay(instant: Date): string {
  const [, month, day] = toKstDateString(instant).split("-");
  return `${Number(month)}/${Number(day)}`;
}

/** ko.json home.recentFeed 의 상태 라벨 키 — 컴포넌트는 이 키를 t() 에 넘길 뿐 상태 리터럴을 분기하지 않는다. */
export function recentStatusKey(status: RecentPublicStatus): "statusNew" | "statusConfirmed" {
  return status === "confirmed" ? "statusConfirmed" : "statusNew";
}

/**
 * 행 → 항목 (순수). 항목 객체는 여기서 **필드를 하나씩 골라 새로 만든다** — 행을 spread 하지 않으므로
 * 행에 어떤 컬럼이 더 실려 와도(select 가 뚫려도) 항목으로 옮겨지지 않는다(tests/recent-feed.test.ts §1 property test).
 * 입력 순서를 유지한다(정렬은 쿼리 몫).
 */
export function mapRecentRows(
  rows: readonly RecentReservationRow[],
  vehicleLabelBySlug: ReadonlyMap<string, string>,
): RecentFeedItem[] {
  const items: RecentFeedItem[] = [];
  for (const row of rows) {
    if (!isPublicStatus(row.status)) continue;
    const vehicleLabel = vehicleLabelBySlug.get(row.vehicle_slug);
    if (!vehicleLabel) continue;
    const instant = new Date(row.depart_at);
    if (Number.isNaN(instant.getTime())) continue;
    items.push({
      maskedName: maskName(row.name),
      vehicleLabel,
      departDateKst: kstMonthDay(instant),
      status: row.status,
    });
  }
  return items;
}

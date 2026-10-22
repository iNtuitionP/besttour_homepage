/**
 * 홈 팝업(popups, 0001) 읽기 — anon 키 + RLS, 서버 액션 아님(ADR-3).
 *
 * "오늘"은 KST 벽시계다(CLAUDE.md §3). `new Date()` 를 UTC 날짜로 잘라 비교하면 KST 00:00~08:59 에
 * 전날로 판정된다. 날짜 계산은 lib/kst.ts 의 toKstDateString 이, 노출 판정은 순수 함수 isActiveOn 이 한다.
 */
import { toKstDateString } from "../kst";
import { POPUP_HOME_LIMIT, sortHomePopups } from "../popup-display";
import { createAnonClient, type AnonClient } from "../supabase/anon";
import type { Popup } from "../types";

const SELECT = "id,title,body,image_path,starts_at,ends_at,active,created_at";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 기간이 겹치는 팝업의 후보 상한 — 이 안에서 정렬한 뒤 POPUP_HOME_LIMIT 개만 남긴다(상시 팝업이 상한에 잘리지 않게 넉넉히). */
const CANDIDATE_LIMIT = 50;

export interface PopupRow {
  id: number;
  title: string;
  body: string;
  image_path: string | null;
  starts_at: string;
  ends_at: string;
  active: boolean;
  created_at: string;
}

function toPopup(r: PopupRow): Popup {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    imagePath: r.image_path,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    active: r.active,
    createdAt: r.created_at,
  };
}

/**
 * 팝업이 KST 달력 날짜 `kstDate`("YYYY-MM-DD") 에 노출 중인가 — 순수 함수, TZ 무관.
 * 구간은 starts_at ≤ 오늘 ≤ ends_at (양 끝 포함, 0001 정책과 같다).
 * 세 값 모두 제로패딩 ISO 날짜여야 사전순 비교가 곧 날짜 비교이므로, 형식이 다르면 throw 한다.
 */
export function isActiveOn(popup: Pick<Popup, "active" | "startsAt" | "endsAt">, kstDate: string): boolean {
  const inputs: readonly (readonly [string, string])[] = [
    ["kstDate", kstDate],
    ["startsAt", popup.startsAt],
    ["endsAt", popup.endsAt],
  ];
  for (const [label, value] of inputs) {
    if (!ISO_DATE.test(value)) {
      throw new Error(`isActiveOn: ${label} 는 "YYYY-MM-DD" 여야 합니다 (받은 값: "${value}")`);
    }
  }
  return popup.active && popup.startsAt <= kstDate && kstDate <= popup.endsAt;
}

export interface GetActivePopupsOptions {
  /** 판정 기준 인스턴트. 기본 `new Date()`. 테스트·프리뷰에서 주입한다. */
  now?: Date;
  client?: AnonClient;
}

/**
 * 오늘(KST) 노출 중인 활성 팝업 전부 — 최대 POPUP_HOME_LIMIT(4)개 (OF3-R2 · 여러 팝업 동시).
 *
 * DB 필터(active ∧ starts_at ≤ 오늘 ≤ ends_at)로 후보를 좁히고, 최종 판정은 isActiveOn 이 한다(기준 하나).
 * 순서는 상시(종료일 9999-12-31) 맨 앞 → starts_at 최신 → id 최신(lib/popup-display.ts sortHomePopups). 이 순서로 앞 4개만 돌려준다.
 * 정렬은 코드에서 한다 — "상시 먼저" 는 DB 정렬 하나로 표현되지 않아, 상한을 DB 에서 먼저 자르면 상시 팝업이 잘릴 수 있다.
 * 그래서 DB 에서는 넉넉한 후보(CANDIDATE_LIMIT)만 가져오고 자르기는 정렬 뒤에 한다. 없으면 빈 배열.
 *
 * 알려진 정책 이슈: 0001 의 popups_select_active 는 `current_date`(DB 세션 TZ — Supabase 기본 UTC)로도
 * 거른다. 그래서 KST 00:00~08:59 에는 그날 시작하는 팝업이 정책에 가려 이 함수에도 오지 않는다
 * (반대로 끝난 다음 날 같은 시간대에 정책이 아직 보여주는 행은 여기서 isActiveOn 이 걸러낸다).
 * 키를 올려 우회하지 않는다 — 정책을 KST 기준으로 고치는 것이 맞다(P2-1 보고서).
 */
export async function getActivePopups(options: GetActivePopupsOptions = {}): Promise<Popup[]> {
  const today = toKstDateString(options.now ?? new Date());
  const db = options.client ?? createAnonClient();
  const { data, error } = await db
    .from("popups")
    .select(SELECT)
    .eq("active", true)
    .lte("starts_at", today)
    .gte("ends_at", today)
    .order("starts_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CANDIDATE_LIMIT)
    .overrideTypes<PopupRow[], { merge: false }>();

  if (error) throw new Error(`getActivePopups: ${error.message}`);
  return sortHomePopups(data.map(toPopup).filter((p) => isActiveOn(p, today))).slice(0, POPUP_HOME_LIMIT);
}

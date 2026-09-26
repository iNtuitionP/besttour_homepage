/**
 * P2-9 — RouteExplorer 상태 전이 (순수 함수). 테스트: tests/krmap-interactive.test.ts §5.
 *
 * - expanded: "노선 전체 보기" 토글 — aria-expanded 의 원천.
 * - active: 강조 중인 노선과 그 원천.
 *     hover  — 마우스가 지도 선 위(말풍선 O). 선을 벗어나면 해제.
 *     tap    — 선을 탭/클릭(말풍선 O). 다른 선 탭이면 바뀌고, 같은 선·바깥 탭·Esc 면 닫힘. 마우스 leave 로는 안 닫힘.
 *     card   — 카드 위 마우스(선 강조만, 말풍선 X — 같은 정보가 카드에 이미 보인다).
 */
export type ActiveSource = "hover" | "tap" | "card";

export interface ExplorerState {
  expanded: boolean;
  active: { id: number; source: ActiveSource } | null;
}

export type ExplorerAction =
  | { type: "toggle" }
  | { type: "lineEnter"; id: number }
  | { type: "lineLeave"; id: number }
  | { type: "lineTap"; id: number }
  | { type: "cardEnter"; id: number }
  | { type: "cardLeave"; id: number }
  | { type: "dismiss" };

export const INITIAL_EXPLORER_STATE: ExplorerState = { expanded: false, active: null };

export function explorerReducer(state: ExplorerState, action: ExplorerAction): ExplorerState {
  const active = state.active;
  switch (action.type) {
    case "toggle":
      return { ...state, expanded: !state.expanded };
    case "lineEnter":
      // 탭으로 고정한 말풍선은 지나가는 마우스가 빼앗지 않는다.
      if (active?.source === "tap") return state;
      return { ...state, active: { id: action.id, source: "hover" } };
    case "lineLeave":
      if (active?.source === "hover" && active.id === action.id) return { ...state, active: null };
      return state;
    case "lineTap":
      if (active?.source === "tap" && active.id === action.id) return { ...state, active: null };
      return { ...state, active: { id: action.id, source: "tap" } };
    case "cardEnter":
      if (active?.source === "tap") return state;
      return { ...state, active: { id: action.id, source: "card" } };
    case "cardLeave":
      if (active?.source === "card" && active.id === action.id) return { ...state, active: null };
      return state;
    case "dismiss":
      return active ? { ...state, active: null } : state;
  }
}

/** 말풍선을 띄우는 상태인가 — 지도 선에서 온 활성만. */
export function showsTip(state: ExplorerState): boolean {
  return state.active !== null && state.active.source !== "card";
}

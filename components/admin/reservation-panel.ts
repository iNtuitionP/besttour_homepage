/**
 * 접수 상세의 작은 채널 (P5-22) — 화면 곳곳에 떨어진 **진입 버튼**들이 처리 영역 **하나**에 시트를 열어 달라고 한다.
 *
 * 왜 필요한가
 *   시안 #detail 의 진입 버튼은 네 자리다: 데스크톱 오른쪽 처리 카드(확정 · 운행 완료 · 취소) · 휴대폰 아래 고정 행동 바(확정) · 휴대폰 위 제목줄의 ⋯(취소) ·
 *   휴대폰 맨 아래(취소 · 운행 완료). 그 사이사이에는 **서버가 그리는 개인정보**(연락 카드의 번호 · 행동 바의 `tel:` · 요청 사항)가 끼어 있다.
 *   P5-19 의 처리 영역(ReservationActions — 시트 · 메모 · 토스트 · 상태 기계의 주인)으로 이 자리들을 감싸면 그 개인정보가 클라이언트 부품의
 *   props(children)로 넘어간다 — 규약 위반이다("개인정보는 서버에서 그린다"). 그래서 진입 버튼은 각자 작은 클라이언트 섬(SheetTrigger)이고,
 *   이 채널로만 처리 영역과 이어진다. 채널에 실리는 것은 **uuid · 시트 종류 · 누른 버튼 요소 · 처리 중 여부**뿐이다(개인정보 0).
 *
 * 규약
 *   - 처리 영역이 `attach(id, open)` 로 붙는다(효과 안 — 브라우저에서만). 진입 버튼은 `requestSheet(id, kind, 누른 버튼)` 만 부른다 —
 *     서버액션·실행(commit)은 여기에 없다. 되돌릴 수 없는 동작을 부르는 길은 여전히 시트의 실행 버튼 하나다(P5-19).
 *   - 붙은 처리 영역이 없거나(수화 전 · 떠난 뒤) 처리 중이면 아무 일도 하지 않고 false 다.
 *   - 처리 중 여부는 처리 영역이 레이아웃 효과로 알린다(setPending) — 진입 버튼은 useSyncExternalStore 로 읽어 aria-disabled 로 막는다
 *     (P5-21 PendingButton — 포커스를 잃지 않는다). 서버 렌더에서는 늘 한가하다(IDLE_SNAPSHOT — 모듈 상태를 만지지 않는다).
 *   - 스냅숏은 값이 같으면 **같은 객체**다(useSyncExternalStore 규약 — 다르면 무한히 다시 그린다).
 *   - 떼면 처리 중도 풀린다(남은 진입 버튼이 막힌 채 남지 않게). 옛 떼기가 새로 붙은 처리 영역을 떼지 않는다(개발 모드의 효과 두 번).
 *     아무도 붙지 않고 듣지 않는 채널은 지운다(메모리에 쌓이지 않게).
 *   - 채널 표는 모듈 하나에 있지만 **서버에서는 건드리지 않는다**: 붙기·알리기·듣기는 효과와 누름 처리기에서만 불린다.
 *
 * React·Next·DOM·env·한글 없음 — tests/admin-detail-panel.test.ts 가 그대로 부른다.
 */
import type { SheetKind } from "./reservation-sheet";

/** 처리 영역이 받는 요청 — 시트 종류와 누른 버튼(닫힌 뒤 포커스를 돌려줄 자리). */
export type SheetOpener = (kind: SheetKind, opener: HTMLElement | null) => void;

export interface PanelSnapshot {
  /** 처리 중(서버액션 · 뒤이은 새로고침) — 진입 버튼이 aria-disabled 로 막힌다. */
  readonly pending: boolean;
}

/** 한가함 — 처음 · 서버 렌더 · 붙은 처리 영역이 없을 때. */
export const IDLE_SNAPSHOT: PanelSnapshot = Object.freeze({ pending: false });
const BUSY_SNAPSHOT: PanelSnapshot = Object.freeze({ pending: true });

/**
 * 처리 영역 표식 — 성공 뒤 포커스를 돌려줄 "처리" 자리(데스크톱 오른쪽 처리 카드 · 휴대폰 아래 행동 바). 둘 다 서버가 그리고 한 폭에서는 하나만 보인다.
 * 처리 영역(ReservationActions)이 이 표식을 가진 요소 중 **보이는 첫 것**에 포커스를 준다(firstVisible).
 */
export const PROCESS_REGION_ATTR = "data-process-region";

export interface PanelChannels {
  snapshot(id: string): PanelSnapshot;
  subscribe(id: string, listener: () => void): () => void;
  /** 처리 영역이 붙는다 — 떼는 함수를 돌려준다. */
  attach(id: string, open: SheetOpener): () => void;
  /** 처리 중 알림 — 처리 영역만 부른다. */
  setPending(id: string, pending: boolean): void;
  /** 진입 버튼 — 시트를 열어 달라고 한다. 붙은 처리 영역이 없거나 처리 중이면 false(아무 일도 없다). */
  requestSheet(id: string, kind: SheetKind, opener: HTMLElement | null): boolean;
  /** 살아 있는 채널 수(시험용 — 비면 지워졌는지 본다). */
  size(): number;
}

interface Channel {
  open: SheetOpener | null;
  snapshot: PanelSnapshot;
  listeners: Set<() => void>;
}

export function createPanelChannels(): PanelChannels {
  const channels = new Map<string, Channel>();

  const channelOf = (id: string): Channel => {
    let c = channels.get(id);
    if (c === undefined) {
      c = { open: null, snapshot: IDLE_SNAPSHOT, listeners: new Set() };
      channels.set(id, c);
    }
    return c;
  };
  /** 아무도 붙지 않고 · 듣지 않고 · 처리 중도 아니면 지운다(그 사이 새 채널이 생겼으면 건드리지 않는다). */
  const prune = (id: string, c: Channel) => {
    if (c.open === null && c.listeners.size === 0 && !c.snapshot.pending && channels.get(id) === c) channels.delete(id);
  };
  const emit = (c: Channel) => {
    for (const listener of [...c.listeners]) listener();
  };

  return {
    snapshot: (id) => channels.get(id)?.snapshot ?? IDLE_SNAPSHOT,
    subscribe(id, listener) {
      const c = channelOf(id);
      c.listeners.add(listener);
      return () => {
        c.listeners.delete(listener);
        prune(id, c);
      };
    },
    attach(id, open) {
      const c = channelOf(id);
      c.open = open;
      return () => {
        if (c.open !== open) return;
        c.open = null;
        if (c.snapshot.pending) {
          c.snapshot = IDLE_SNAPSHOT;
          emit(c);
        }
        prune(id, c);
      };
    },
    setPending(id, pending) {
      const c = channelOf(id);
      const next = pending ? BUSY_SNAPSHOT : IDLE_SNAPSHOT;
      if (c.snapshot !== next) {
        c.snapshot = next;
        emit(c);
      }
      prune(id, c);
    },
    requestSheet(id, kind, opener) {
      const c = channels.get(id);
      if (c === undefined || c.open === null || c.snapshot.pending) return false;
      c.open(kind, opener);
      return true;
    },
    size: () => channels.size,
  };
}

/** 화면이 쓰는 채널 표 하나 — 브라우저에서만 채워진다(위 규약). */
export const panelChannels: PanelChannels = createPanelChannels();

/** 보이는 첫 요소 — 처리 영역 표식을 가진 것 중 지금 그려진 것(데스크톱 카드 · 휴대폰 행동 바는 한 폭에서 하나만 보인다). */
export function firstVisible<T>(items: readonly T[], isVisible: (item: T) => boolean): T | null {
  return items.find(isVisible) ?? null;
}

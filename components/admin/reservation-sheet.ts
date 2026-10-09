/**
 * 예약 상세 처리 영역 — 확인 시트의 순수 상태·실행 계획·컨트롤러 (P5-19).
 *
 * React·DOM·env 없음. tests/admin-confirm-sheet.test.ts 가 **가짜 서버액션으로 컨트롤러를 실제로 불러** 본다
 * (vitest 는 node 환경이고 DOM 패키지를 들이지 않는다 — P2-9 KrMap explorer-state · P3-8 quick-quote 와 같은 나눔).
 * 컴포넌트(ReservationActions · AdminSheet)는 이 모듈의 상태를 그리고 버튼을 컨트롤러에 잇기만 한다.
 *
 * 지키는 것(브리프 P5-19)
 *   - **시트를 거치지 않고는 전이 액션이 불리지 않는다.** 확정·취소·완료 버튼은 `open` 만 부른다. 서버액션을 부르는 길은
 *     `commit` 하나이고, 그것은 시트가 열려 있을 때만 움직인다(열려 있지 않으면 아무것도 하지 않는다).
 *   - **고친 메모를 함께 넘긴다.** 확정·취소·완료는 메모 칸을 **고쳤을 때만**(서버에서 받은 값과 다를 때) 그 값을 넘긴다 —
 *     예전에는 넘기지 않아 확정 전에 쓴 메모가 사라졌다. 고치지 않았으면 null 을 넘겨 0010 의 coalesce 가 저장된 메모를 지키게 한다
 *     (리뷰 P2-3: 늘 칸 값을 넘기면 다른 화면이 그 사이 저장한 메모를 이 화면이 열릴 때의 옛 값으로 되돌린다).
 *     취소는 고른 사유를 한 줄 덧붙이되 기존 메모를 지우지 않는다. 길이는 서버와 같은 상한(lib/admin/memo.ts)으로 **먼저 막는다** —
 *     서버는 넘친 메모를 몰래 자르고, 잘리는 쪽이 바로 덧붙인 사유 줄이다.
 *   - **성공은 토스트, 실패는 시트 안 배너.** 실패하면 시트를 닫지 않는다. 이미 처리된 건은 배너 + 화면 새로고침(예전 동작 유지)이고,
 *     그 시트는 **잠긴다**(`sheetLocked`) — 사유 칩을 포함해 무엇을 눌러도 같은 판정을 다시 보내지 않는다(리뷰 P1-1). 잠금은 배너와
 *     따로 들어서 배너가 바뀌어도 풀리지 않고, 시트를 닫거나 새로 열 때만 풀린다.
 *     서버액션이 throw 해도(네트워크 끊김) 실패로 읽는다 — 전이가 오류 경계로 번지지 않게.
 *   - **응답이 오지 않아도 갇히지 않는다.** 처리 중 `SHEET_STUCK_MS` 가 지나면 [닫기]가 되살아난다(리뷰 P2-1). 닫은 뒤에 도착한 결과는
 *     연 순서(`sheetSeq`)로 가려 닫힌·다른 시트를 건드리지 않고 토스트·메모 칸 옆 배너로 간다.
 *   - **고객 이름은 props 로 받지 않는다.** 시트 제목의 이름은 서버가 이미 화면에 그린 요소(`CUSTOMER_NAME_ELEMENT_ID`)에서
 *     열리는 순간 읽어 이 상태에만 둔다(P3-5 리뷰 N-2 · 상세 페이지 헤더 규약 "클라이언트로는 uuid·상태·라벨·메모만").
 *     읽지 못하면 이름 없는 제목("이 접수를 확정할까요?")으로 떨어진다.
 */
import type { ReactNode } from "react";

import { ADMIN_MEMO_MAX_CHARS } from "@/lib/admin/memo";
import { FAILED_RESULT, type AdminActionCode, type AdminActionResult } from "@/lib/admin/result";

// =============================================================================
// 상수 · 타입
// =============================================================================

/** 확인 시트를 거치는 전이 — 셋 다 되돌릴 수 없다(0010 에 역전이가 없다). 메모 저장은 되돌릴 수 있어 시트가 없다. */
export const SHEET_KINDS = ["confirm", "cancel", "complete"] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];

/** 취소 사유(선택) — 순서가 곧 화면 순서다. 문구는 messages/ko.json `admin.detail.sheet.reason.*`. */
export const CANCEL_REASONS = ["schedule", "vehicle", "unreachable", "other"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** 서버가 그린 고객 이름 요소의 id — 상세 페이지가 이 id 를 이름 칸에 달고, 시트가 열릴 때 그 글자를 읽는다. */
export const CUSTOMER_NAME_ELEMENT_ID = "admin-customer-name";

/** 토스트 시간 — 3초, 링크가 붙으면 5초(토스 TDS Toast · 시안 ⑤-3). */
export const TOAST_MS = { plain: 3000, withLink: 5000 } as const;

/**
 * 처리 중 [닫기]를 되살리기까지의 시간(리뷰 P2-1) — **15초**.
 *   - 정상 응답은 1초 안팎이다(P5-19 실측: 누름 → 토스트 850 ms · requireAdmin + rpc 한 번). 휴대폰 망·함수 콜드 스타트를 넉넉히 더해도
 *     10초를 넘기지 않는 동안에는 닫기를 막아 둔다 — 결과(실패 배너)가 도착할 자리를 지키고, 기다리면 되는 사람을 헷갈리게 하지 않는다.
 *   - 서버가 느린 경우는 함수 한도(상세 페이지 `maxDuration = 60`)에서 오류로 끝나 시트 안 배너가 뜬다. 15초는 그보다 한참 짧다 —
 *     이 탈출구는 **응답이 영영 오지 않는** 경우(클라이언트 연결이 죽음)를 위한 것이고, 그때 1분을 갇혀 있게 하지 않는다.
 *   - 되살리는 것은 [닫기]·ESC·바깥 누르기뿐이다. 실행 버튼은 처리 중인 동안 계속 막혀 같은 판정을 두 번 보내지 않는다.
 * tests/admin-confirm-sheet.test.ts 가 10초 이상 · maxDuration 미만을 잠근다.
 */
export const SHEET_STUCK_MS = 15_000;

/** 시트를 닫을 수 있는가 — 처리 중이 아니거나, 처리 중이어도 SHEET_STUCK_MS 가 지났다(응답이 오지 않는다). */
export function sheetClosable(pending: boolean, slow: boolean): boolean {
  return !pending || slow;
}

/**
 * 실행 버튼의 **무장 지연**(P5-22 수정 라운드 · 리뷰 반려 P0-1) — 시트가 열린 뒤 이 시간 동안 실행 버튼은 누름을 받지 않는다.
 * 휴대폰 상세의 아래 행동 바 [확정하기]를 두 번 누르면(더블탭 · 더블클릭) 첫 누름이 연 확정 시트의 실행 버튼이 같은 자리에 떠서
 * 두 번째 누름이 확인 없이 확정 + 고객 문자가 됐다. 600ms 는 두 번 누름의 간격(더블탭 150~300ms · 느린 두 번째 누름)보다 길고,
 * 일부러 읽고 누르는 사람을 붙잡지는 않는다(시트를 읽는 데 그보다 오래 걸린다). 첫 포커스는 그대로 [닫기]다.
 * 배치로도 한 겹 더 막는다 — 1024px 미만에서는 [닫기]가 맨 아래라 두 번째 누름이 [닫기]에 떨어진다(admin.module.css 시트 절).
 * tests/admin-sheet-arming.test.ts 가 잠근다.
 */
export const SHEET_ARM_MS = 600;

/** 받아도 되는 누름인가 — 누름이 **시작된** 시각이 열린 뒤 SHEET_ARM_MS 가 지났다. 시각이 숫자가 아니면 받지 않는다(모르면 막는다). */
export function sheetArmed(openedAt: number, pressedAt: number): boolean {
  return Number.isFinite(openedAt) && Number.isFinite(pressedAt) && pressedAt - openedAt >= SHEET_ARM_MS;
}

/** event.timeStamp 를 믿어도 되는 폭 — 사건이 처리되기까지 이보다 오래 밀리지는 않는다. */
const EVENT_TIME_TOLERANCE_MS = 10_000;

/**
 * 사건 시각 — `event.timeStamp` 가 `performance.now()` 와 같은 시계(지금부터 최근 10초 안)면 그 값, 아니면 지금.
 * 요즘 브라우저의 timeStamp 는 performance.now() 와 같은 원점의 고해상도 시각이라 두 번째 누름이 **실제로** 언제였는지 알려 준다
 * (메인 스레드가 바빠 처리기가 늦게 돌아도). 옛 브라우저의 epoch 밀리초 같은 다른 시계면 지금으로 떨어진다 — 무장 판정이
 * "한참 뒤의 누름" 으로 속아 막을 것을 통과시키지 않게.
 */
export function eventTime(timeStamp: number, now: number): number {
  return Number.isFinite(timeStamp) && timeStamp <= now && now - timeStamp <= EVENT_TIME_TOLERANCE_MS ? timeStamp : now;
}

export interface ArmingGuard {
  /** 누름 시작 — 실행 버튼의 pointerdown · Enter/Space keydown(자동 반복 제외). 새 누름은 새 시각을 적는다. */
  press(at: number): void;
  /** click 에서 — 받아도 되는가. 누름 시작 기록이 없으면(보조기술·스크립트의 click) click 시각으로 본다. 판정 뒤 기록을 지운다. */
  allow(clickAt: number): boolean;
}

/**
 * 시트 하나의 무장 판정기(열린 시각 하나). 판정은 click 시각이 아니라 **누름이 시작된 시각**으로 한다 —
 * 무장 전에 손가락을 댄 채 무장 뒤에 떼는 누름(두 번째 탭을 길게 누름)도 막는다.
 */
export function armingGuard(openedAt: number): ArmingGuard {
  let pressedAt: number | null = null;
  return {
    press(at) {
      pressedAt = at;
    },
    allow(clickAt) {
      const at = pressedAt ?? clickAt;
      pressedAt = null;
      return sheetArmed(openedAt, at);
    },
  };
}

/** 성공 토스트가 되는 결과 코드. */
export type SuccessCode = Extract<AdminActionCode, "confirmed" | "cancelled" | "completed" | "memoUpdated">;

export type Banner =
  | { kind: "failed" }
  | { kind: "alreadyHandled" }
  | { kind: "memoTooLong"; count: number; max: number; withReason: boolean };

/**
 * 컴포넌트가 컨트롤러에 넘기는 서버액션 표. 네 이름은 actions/admin/reservation.ts 의 export 와 1:1 이다.
 * 확정·취소·완료의 메모 null = "메모를 바꾸지 않는다"(0010 coalesce). 메모 저장은 늘 문자열이다(빈 값 = 지운다).
 */
export type PanelActions = {
  [K in SheetKind]: (id: string, memo: string | null) => Promise<AdminActionResult>;
} & { memo: (id: string, memo: string) => Promise<AdminActionResult> };

/** 시트 하나의 문구. `title` 은 `{name}` 자리를 비워 둔 **틀**이다 — 화면이 서버가 그린 이름으로 채운다. */
export interface SheetCopy {
  title: string;
  titleNoName: string;
  body: ReactNode;
  submit: string;
}

export interface CancelReasonCopy {
  key: CancelReason;
  label: string;
  /** 메모에 덧붙는 한 줄("취소 사유: …") — 서버가 카탈로그로 조립해 내린다. */
  line: string;
}

/**
 * 간편 접수의 "전화로 확인할 것" 문구(P5-22 · 시안 #detail) — 체크는 **화면 안내용**이라 저장하지 않는다(1단계 · 3단계에서 실제 칸 저장).
 * `progress` 는 `{n}`·`{total}` 틀이다(화면이 채운다).
 */
export interface ChecklistLabels {
  title: string;
  progress: string;
  items: readonly string[];
  /** 저장되지 않는다는 한 줄(새로 열면 처음으로 돌아간다). */
  note: string;
  /** 확인한 것은 메모에 적어 두라는 한 줄. */
  memoHint: string;
}

/** 처리 영역 문구 — 서버(components/admin/reservationActionLabels.tsx)가 messages/ko.json `admin.detail.*` 에서 만들어 내린다. */
export interface ReservationActionLabels {
  /** 처리 영역의 이름 — 성공 뒤 포커스가 돌아올 때 읽힌다(P5-22 부터 처리 카드의 제목). */
  panel: string;
  confirm: string;
  confirmHint: string;
  complete: string;
  completeHint: string;
  cancel: string;
  cancelHint: string;
  /** 처리 카드 — 더 누를 것이 없는 접수(운행 완료 · 취소)의 한 줄(P5-22). */
  processDone: string;
  processCancelled: string;
  /** 휴대폰 위 제목줄 ⋯ 의 이름(누르면 취소 시트 — 시안 aria-label). */
  moreCancel: string;
  memoLabel: string;
  memoHint: string;
  memoSave: string;
  /** 메모 칸의 예시 자리글(시안). */
  memoPlaceholder: string;
  processing: string;
  checklist: ChecklistLabels;
  sheet: {
    close: string;
    /** 간편 접수의 요약 상자 한 줄. */
    quickNote: string;
    /** 처리 중 SHEET_STUCK_MS 가 지났을 때 시트 안 안내(닫아도 된다 · 결과가 오면 알린다). */
    slow: string;
    /** 확정 시트의 확인 경고 — `{total}`·`{n}` 틀(P5-22 · 간편 접수이고 체크가 다 채워지지 않았을 때만). */
    checkWarning: string;
    confirm: SheetCopy;
    cancel: SheetCopy & { reasonLegend: string; reasonHint: string; reasons: readonly CancelReasonCopy[] };
    complete: SheetCopy;
  };
  /** 성공 코드는 토스트, 실패·이미 처리됨은 배너 문구. */
  results: Record<AdminActionCode, string>;
  /** `{max}`·`{count}` 는 화면이 채운다. */
  memoTooLong: string;
  memoTooLongWithReason: string;
  /** 확정 토스트의 링크(발송 내역). 탭이 없으면 null. */
  toastLink: { label: string; href: string } | null;
}

/** 시트의 요약 상자 — 구간 · 날짜 · 인원. 운행 정보이지 고객 식별 정보가 아니다(이름·전화·메일은 없다). */
export interface ReservationSummary {
  parts: readonly string[];
  /** 간편 접수(0023 intake='quick') — "차량·시각은 통화로 정한 대로" 한 줄을 더한다. P5-22 부터 "전화로 확인할 것" 체크리스트도 이것으로 정한다. */
  quick: boolean;
}

// =============================================================================
// 전화로 확인할 것 (P5-22) — 체크 수 · 확정 시트의 확인 경고
// =============================================================================

/** 체크리스트의 지금 — 몇 개 중 몇 개를 확인했나. */
export interface ChecklistState {
  checked: number;
  total: number;
}

export function countChecked(checks: readonly boolean[]): number {
  return checks.filter(Boolean).length;
}

/**
 * 확정 시트의 확인 경고 — **확정 시트**이고, 체크리스트가 있고(간편 접수의 새 접수), 다 채우지 않았을 때만 그 상태를 돌려준다(아니면 null).
 * 막지 않는다 — 경고만 한다(통화로 이미 확인했을 수 있다 · 브리프 §B). 취소·완료 시트에는 없다.
 */
export function sheetCheckWarning(sheet: SheetKind, checklist: ChecklistState | null | undefined): ChecklistState | null {
  if (sheet !== "confirm" || checklist === null || checklist === undefined) return null;
  return checklist.total > 0 && checklist.checked < checklist.total ? checklist : null;
}

// =============================================================================
// 메모 — 취소 사유 덧붙이기 · 실행 계획(상한)
// =============================================================================

/** 기존 메모 끝에 사유 한 줄을 덧붙인다. 기존 메모는 지우지 않는다(끝 공백·빈 줄만 접는다 — 서버도 양끝을 자른다). */
export function composeCancelMemo(memo: string, reasonLine: string | null): string {
  if (reasonLine === null || reasonLine === "") return memo;
  const base = memo.replace(/\s+$/u, "");
  return base.trim() === "" ? reasonLine : `${base}\n${reasonLine}`;
}

export type CommitPlan =
  /** memo null = 메모를 보내지 않는다(확정·취소·완료 — 서버가 저장된 메모를 지킨다). stored = 성공하면 서버에 남을 값(null = 그대로 · 메모 저장은 지움). */
  | { kind: "call"; action: SheetKind | "memo"; memo: string | null; stored: string | null }
  | { kind: "blocked"; count: number; max: number; withReason: boolean };

export interface CommitInput {
  action: SheetKind | "memo";
  /** 메모 칸의 값. */
  memoText: string;
  /** 서버에 있는 메모(마지막으로 아는 값) — 칸이 이것과 다르면 사장님이 고친 것이다. */
  serverMemo: string;
  /** 취소 사유 한 줄(취소 시트에서 골랐을 때만). */
  reasonLine: string | null;
}

/**
 * 무엇을 서버액션에 넘길지 정한다.
 *   - 메모 저장: 칸 값을 늘 넘긴다(사장님이 누른 저장이다).
 *   - 확정·취소·완료: 칸을 **고쳤거나**(서버 값과 다르다) 취소 사유를 골랐을 때만 넘긴다. 아니면 memo = null —
 *     0010 은 `admin_memo = coalesce(p_memo, admin_memo)` 라, 넘기면 덮고 null 이면 지킨다(리뷰 P2-3).
 *     사유를 골랐으면 고치지 않았어도 넘긴다(지금 보이는 메모 + 사유 한 줄 — 서버에서 붙일 길이 없다).
 * 넘기는 메모는 서버처럼 양끝을 자른 길이로 재고, 상한을 넘으면 부르지 않고 막는다. 넘기지 않는 메모는 재지 않는다.
 */
export function planCommit(input: CommitInput, max: number = ADMIN_MEMO_MAX_CHARS): CommitPlan {
  const { action, memoText, serverMemo, reasonLine } = input;
  const withReason = action === "cancel" && reasonLine !== null && reasonLine !== "";
  const edited = memoText !== serverMemo;
  if (action !== "memo" && !edited && !withReason) return { kind: "call", action, memo: null, stored: null };
  const memo = withReason ? composeCancelMemo(memoText, reasonLine) : memoText;
  const trimmed = memo.trim();
  if (trimmed.length > max) return { kind: "blocked", count: trimmed.length, max, withReason };
  return { kind: "call", action, memo, stored: trimmed.length === 0 ? null : trimmed };
}

/** 메모 칸이 서버에 있는 값과 다르다 = 사장님이 고쳤고 아직 저장되지 않았다(고쳤다가 되돌리면 고치지 않은 것). */
export function memoEdited(state: Pick<PanelState, "memoText" | "serverMemo">): boolean {
  return state.memoText !== state.serverMemo;
}

// =============================================================================
// 상태 전이
// =============================================================================

export interface PanelState {
  sheet: SheetKind | null;
  /** 시트를 연 순서(열 때마다 1 씩 는다). 늦게 온 결과가 **자기를 연 시트**에만 닿게 가린다(리뷰 P2-1). */
  sheetSeq: number;
  /**
   * 지금 시트가 "이미 처리된 접수" 를 받아 잠겼다(리뷰 P1-1). 잠긴 시트는 실행 버튼·사유 라디오가 막히고 컨트롤러도 다시 보내지 않는다.
   * 배너와 따로 든다 — 배너가 바뀌어도 풀리지 않고, 시트를 닫거나 새로 열 때만 풀린다.
   */
  sheetLocked: boolean;
  /** 시트가 열릴 때 서버가 그린 요소에서 읽은 이름. 시트 제목에만 쓴다. */
  customerName: string;
  reason: CancelReason | null;
  sheetBanner: Banner | null;
  /** 메모 칸의 값. serverMemo 와 다르면 사장님이 고친 것이다(memoEdited). */
  memoText: string;
  /** 서버에 있는 메모(마지막으로 알고 있는 값). 확정·취소·완료는 칸이 이 값과 같으면 메모를 보내지 않는다. */
  serverMemo: string;
  /** 마지막으로 본 props(initialMemo) — props 가 바뀐 순간만 가려내려고 둔다. */
  propMemo: string;
  memoBanner: Banner | null;
  /**
   * 배너가 새로 선 횟수(메모 · 시트 따로) — 배너의 key 에 붙는다(AdminBanner `attempt`). 이 상태 기계는 저장을 시작할 때 배너를 비우지 않아서,
   * 같은 실패가 다시 오면 문구가 같아 React 가 같은 요소로 보고 다시 스크롤하지 않았다(재리뷰 P2-R1). 실패·막힘마다 하나씩 는다.
   */
  memoBannerSeq: number;
  sheetBannerSeq: number;
  toast: { id: number; code: SuccessCode } | null;
  toastSeq: number;
  /** 시트가 어떻게 닫혔나 — 포커스를 연 버튼(그냥 닫힘)으로 돌릴지 처리 영역(바뀜)으로 돌릴지. */
  lastClose: "dismissed" | "changed" | null;
}

export type PanelEvent =
  | { type: "open"; sheet: SheetKind; customerName: string }
  | { type: "close" }
  | { type: "pickReason"; reason: CancelReason }
  | { type: "editMemo"; text: string }
  | { type: "propMemo"; memo: string }
  | { type: "blocked"; source: "sheet" | "memo"; count: number; max: number; withReason: boolean }
  /** seq — 시트의 결과면 그 시트를 연 순서(PanelState.sheetSeq). 지금 열린 시트의 것이 아니면 시트를 건드리지 않는다. */
  | { type: "settled"; source: "sheet" | "memo"; seq?: number; action: SheetKind | "memo"; stored: string | null; result: AdminActionResult }
  | { type: "toastDone"; id: number };

export function initialPanelState(memo: string): PanelState {
  return {
    sheet: null,
    sheetSeq: 0,
    sheetLocked: false,
    customerName: "",
    reason: null,
    sheetBanner: null,
    memoText: memo,
    serverMemo: memo,
    propMemo: memo,
    memoBanner: null,
    memoBannerSeq: 0,
    sheetBannerSeq: 0,
    toast: null,
    toastSeq: 0,
    lastClose: null,
  };
}

const SUCCESS_CODES: ReadonlySet<AdminActionCode> = new Set<AdminActionCode>(["confirmed", "cancelled", "completed", "memoUpdated"]);
const isSuccessCode = (code: AdminActionCode): code is SuccessCode => SUCCESS_CODES.has(code);

export function panelReducer(state: PanelState, event: PanelEvent): PanelState {
  switch (event.type) {
    case "open":
      return {
        ...state,
        sheet: event.sheet,
        sheetSeq: state.sheetSeq + 1,
        sheetLocked: false,
        customerName: event.customerName,
        reason: null,
        sheetBanner: null,
        lastClose: null,
      };
    case "close":
      if (state.sheet === null) return state;
      return { ...state, sheet: null, sheetLocked: false, reason: null, sheetBanner: null, lastClose: "dismissed" };
    case "pickReason":
      // 잠긴 시트(이미 처리됨)에서는 사유를 바꾸지 않는다 — 배너도 그대로(리뷰 P1-1: 여기서 배너를 지우면 가드가 함께 풀렸다).
      if (state.sheet !== "cancel" || state.sheetLocked) return state;
      return { ...state, reason: event.reason, sheetBanner: null };
    case "editMemo":
      return { ...state, memoText: event.text, memoBanner: null };
    case "propMemo":
      if (event.memo === state.propMemo) return state;
      // 고치는 중이면(칸 ≠ 서버 값) 칸을 지키고, 아니면 새 서버 값을 따른다.
      return { ...state, propMemo: event.memo, serverMemo: event.memo, memoText: memoEdited(state) ? state.memoText : event.memo };
    case "blocked": {
      const banner: Banner = { kind: "memoTooLong", count: event.count, max: event.max, withReason: event.withReason };
      if (event.source === "sheet" && state.sheet !== null) {
        return state.sheetLocked ? state : { ...state, sheetBanner: banner, sheetBannerSeq: state.sheetBannerSeq + 1 };
      }
      return { ...state, memoBanner: banner, memoBannerSeq: state.memoBannerSeq + 1 };
    }
    case "settled": {
      const { result } = event;
      // 지금 열린 시트의 결과인가 — 닫은 뒤(또는 그 뒤 새로 연 시트 앞에) 늦게 온 결과는 시트를 건드리지 않는다(리뷰 P2-1).
      const current = event.source === "sheet" && state.sheet !== null && event.seq === state.sheetSeq;
      if (result.ok && result.changed && isSuccessCode(result.code)) {
        // 서버에 남은 값 — 빈 메모·보내지 않은 메모는 확정·취소·완료에서 "바꾸지 않음", 메모 저장의 빈 값은 "지움"이다(0010).
        const saved = event.stored ?? (event.action === "memo" ? "" : state.serverMemo);
        const toastSeq = state.toastSeq + 1;
        const next: PanelState = {
          ...state,
          memoText: saved,
          serverMemo: saved,
          memoBanner: null,
          toast: { id: toastSeq, code: result.code },
          toastSeq,
        };
        return current ? { ...next, sheet: null, sheetLocked: false, reason: null, sheetBanner: null, lastClose: "changed" } : next;
      }
      const banner: Banner = result.code === "alreadyHandled" ? { kind: "alreadyHandled" } : { kind: "failed" };
      if (!current) return { ...state, memoBanner: banner, memoBannerSeq: state.memoBannerSeq + 1 };
      return { ...state, sheetBanner: banner, sheetLocked: result.code === "alreadyHandled", sheetBannerSeq: state.sheetBannerSeq + 1 };
    }
    case "toastDone":
      return state.toast !== null && state.toast.id === event.id ? { ...state, toast: null } : state;
  }
}

// =============================================================================
// 컨트롤러 — 버튼이 부르는 것의 전부
// =============================================================================

export interface PanelDeps {
  id: string;
  actions: PanelActions;
  dispatch: (event: PanelEvent) => void;
  /** 전이가 바뀌었거나 이미 처리됐으면 화면을 새로 불러온다(서버가 최신 상태를 다시 그린다). */
  refresh: () => void;
  /** 서버가 그린 이름 요소의 글자. 컴포넌트는 DOM 에서, 테스트는 가짜로. */
  readCustomerName: () => string;
  /** 사유 → 메모에 덧붙일 한 줄. */
  reasonLine: (reason: CancelReason) => string;
}

export interface PanelController {
  open(sheet: SheetKind): void;
  close(): void;
  pickReason(reason: CancelReason): void;
  editMemo(text: string): void;
  /** 시트의 실행 버튼. 시트가 열려 있지 않으면 아무것도 하지 않는다. */
  commit(state: PanelState): Promise<void>;
  /** 메모 저장(되돌릴 수 있는 동작 — 시트 없음). 시트가 열려 있는 동안은 부르지 않는다. */
  saveMemo(state: PanelState): Promise<void>;
}

/** 서버액션의 응답을 믿지 않는다 — throw(네트워크)·모양이 다른 값은 실패로 읽는다. */
async function call(send: () => Promise<AdminActionResult>): Promise<AdminActionResult> {
  try {
    const result: unknown = await send();
    if (typeof result === "object" && result !== null && typeof (result as AdminActionResult).code === "string") {
      return result as AdminActionResult;
    }
    return FAILED_RESULT;
  } catch {
    return FAILED_RESULT;
  }
}

export function panelController(deps: PanelDeps): PanelController {
  /** noop(이미 처리됨)도 화면이 낡았다는 뜻이다 — 다시 읽어 온다(예전 동작). */
  const refreshAfter = (result: AdminActionResult) => {
    if (result.changed || result.code === "alreadyHandled") deps.refresh();
  };

  return {
    open: (sheet) => deps.dispatch({ type: "open", sheet, customerName: deps.readCustomerName() }),
    close: () => deps.dispatch({ type: "close" }),
    pickReason: (reason) => deps.dispatch({ type: "pickReason", reason }),
    editMemo: (text) => deps.dispatch({ type: "editMemo", text }),
    commit: async (state) => {
      const sheet = state.sheet;
      if (sheet === null) return;
      // 잠긴 시트(이미 처리된 건)에는 같은 판정을 다시 보내지 않는다 — 사유 칩·배너와 무관하게(리뷰 P1-1). 실행 버튼도 비활성이다.
      if (state.sheetLocked) return;
      const line = sheet === "cancel" && state.reason !== null ? deps.reasonLine(state.reason) : null;
      const plan = planCommit({ action: sheet, memoText: state.memoText, serverMemo: state.serverMemo, reasonLine: line });
      if (plan.kind === "blocked") {
        deps.dispatch({ type: "blocked", source: "sheet", count: plan.count, max: plan.max, withReason: plan.withReason });
        return;
      }
      const seq = state.sheetSeq;
      const result = await call(() => deps.actions[sheet](deps.id, plan.memo));
      deps.dispatch({ type: "settled", source: "sheet", seq, action: sheet, stored: plan.stored, result });
      refreshAfter(result);
    },
    saveMemo: async (state) => {
      if (state.sheet !== null) return;
      const plan = planCommit({ action: "memo", memoText: state.memoText, serverMemo: state.serverMemo, reasonLine: null });
      if (plan.kind === "blocked") {
        deps.dispatch({ type: "blocked", source: "memo", count: plan.count, max: plan.max, withReason: plan.withReason });
        return;
      }
      // 메모 저장은 늘 문자열을 보낸다(planCommit 이 memo 동작에 null 을 내지 않는다).
      const memo = plan.memo ?? "";
      const result = await call(() => deps.actions.memo(deps.id, memo));
      deps.dispatch({ type: "settled", source: "memo", action: "memo", stored: plan.stored, result });
      refreshAfter(result);
    },
  };
}

// =============================================================================
// 포커스 · 토스트 · 문구 조립
// =============================================================================

export interface FocusWrapOptions<T> {
  /** 시트 자체(tabindex=-1). 누를 것이 하나도 없으면 여기로. */
  container: T;
  /** 라디오면 그 묶음 이름, 아니면 null — 라디오 묶음은 Tab 한 칸이다. */
  radioGroup: (el: T) => string | null;
  isChecked: (el: T) => boolean;
}

/**
 * Tab 가둠 — 옮길 곳을 돌려준다. null 이면 브라우저에 맡긴다(시트 안 가운데 이동).
 * 마지막에서 Tab → 처음 · 처음에서 Shift+Tab → 마지막 · 포커스가 시트 밖(body)이나 시트 자체에 있으면 안으로 들인다.
 * 라디오 묶음으로 들어갈 때는 고른 것, 없으면 들어가는 방향의 끝(앞으로면 첫 것 · 뒤로면 마지막 것)으로 간다(브라우저와 같은 규칙).
 */
export function wrapFocus<T>(items: readonly T[], active: T | null, shift: boolean, opts: FocusWrapOptions<T>): T | null {
  if (items.length === 0) return opts.container;
  const first = items[0];
  const last = items[items.length - 1];
  const group = (el: T): T[] => {
    const name = opts.radioGroup(el);
    return name === null ? [el] : items.filter((x) => opts.radioGroup(x) === name);
  };
  const entry = (el: T, forward: boolean): T => {
    const members = group(el);
    return members.find((x) => opts.isChecked(x)) ?? (forward ? members[0] : members[members.length - 1]);
  };
  if (active === null || !items.includes(active)) return shift ? entry(last, false) : entry(first, true);
  if (shift && group(first).includes(active)) return entry(last, false);
  if (!shift && group(last).includes(active)) return entry(first, true);
  return null;
}

/**
 * 시트가 닫힌 뒤 포커스를 둘 곳 — 그냥 닫혔으면 연 버튼, 바뀌었거나(연 버튼이 곧 사라진다) 연 버튼을 쓸 수 없으면 처리 영역.
 * 연 버튼을 쓸 수 없는 경우: 화면에서 사라졌다(이미 처리됨 뒤 새로고침) · 처리 중이라 비활성이다(응답이 늦어 닫았을 때 — 리뷰 P2-1).
 */
export function focusReturn(lastClose: PanelState["lastClose"], openerAvailable: boolean): "opener" | "panel" {
  return lastClose === "changed" || !openerAvailable ? "panel" : "opener";
}

/**
 * 늦은 결과 뒤 포커스 구하기(P5-22 수정 라운드 · 리뷰 P2-3). 처리 중에 시트를 닫으면(15초 탈출) 포커스는 연 버튼(처리 중 aria-disabled —
 * 사라지지 않는다)으로 돌아간다. 그 뒤 늦게 온 결과(성공 · 이미 처리됨)의 새로고침이 그 버튼을 없애면 포커스가 <body> 로 빠진다 —
 * 그때 보이는 처리 영역으로 옮긴다("rescue"). 버튼이 아직 있으면(결과를 기다리는 중 · 늦은 실패) 기다리고("wait"),
 * 사장님이 이미 다른 곳에 포커스를 두었으면 건드리지 않고 기억을 놓는다("drop").
 * `held` 는 기억해 둔 연 버튼(없으면 null) — connected: 아직 DOM 에 있나 · focused: 포커스가 그 버튼에 있나. `focusLost` 는 포커스가 body(또는 없음).
 */
export function focusRescue(held: { connected: boolean; focused: boolean } | null, focusLost: boolean): "rescue" | "wait" | "drop" {
  if (held === null) return "drop";
  if (!held.connected) return focusLost ? "rescue" : "drop";
  return held.focused || focusLost ? "wait" : "drop";
}

export function toastDurationMs(hasLink: boolean): number {
  return hasLink ? TOAST_MS.withLink : TOAST_MS.plain;
}

/** 링크(발송 내역)는 확정 토스트에만 — 확정 안내 문자가 나갔는지 볼 곳이다. */
export function toastHasLink(code: SuccessCode): boolean {
  return code === "confirmed";
}

/** 서버가 그린 이름 글자 정리 — 줄바꿈·겹친 공백을 한 칸으로. */
export function cleanCustomerName(text: string | null | undefined): string {
  return typeof text === "string" ? text.replace(/\s+/gu, " ").trim() : "";
}

/** `{key}` 자리를 채운다. 모르는 자리는 그대로 둔다. */
export function fillTemplate(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole));
}

/** 시트 제목 — 이름을 읽었으면 틀에 채우고, 아니면 이름 없는 제목. */
export function sheetTitle(template: string, fallback: string, name: string): string {
  return name === "" || typeof template !== "string" ? fallback : fillTemplate(template, { name });
}

const formatCount = (n: number): string => n.toLocaleString("ko-KR");

/** 배너 문구 — 실패·이미 처리됨은 결과 문구 그대로, 상한 초과는 글자 수를 채운다. */
export function bannerMessage(banner: Banner, labels: Pick<ReservationActionLabels, "results" | "memoTooLong" | "memoTooLongWithReason">): string {
  switch (banner.kind) {
    case "failed":
      return labels.results.failed;
    case "alreadyHandled":
      return labels.results.alreadyHandled;
    case "memoTooLong":
      return fillTemplate(banner.withReason ? labels.memoTooLongWithReason : labels.memoTooLong, {
        max: formatCount(banner.max),
        count: formatCount(banner.count),
      });
  }
}

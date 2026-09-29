/**
 * P5-19 — 관리자 예약 상세: 확정·취소 확인 시트 · 메모 함께 저장 · 결과 알림 · 공지·팝업 격자 잘림.
 *
 * 무엇을 막는가(브리프 「왜」):
 *   1. 취소가 확인 없이 한 번에 실행되고 되돌릴 수 없었다 — 확정 버튼과 같은 크기로 16px 옆에 있었다.
 *   2. 확정 전에 쓴 메모가 유실됐다 — 확정·취소가 메모를 넘기지 않았다.
 *   3. 공지·팝업 관리가 375px 에서 오른쪽이 잘렸다 — 격자 항목의 min-width:auto 를 표 최소 폭이 밀었다.
 *
 * vitest 는 node 환경이다(DOM 패키지 없음 · 새 패키지 금지). 그래서 (P2-9 KrMap · P3-8 간편 견적과 같은 방식)
 *   (1) 상태 전이·실행 계획·포커스 가둠 계산은 순수 모듈(components/admin/reservation-sheet.ts)로 빼서 단위 테스트하고,
 *   (2) 버튼 → 서버액션 경로는 그 모듈의 컨트롤러(panelController)를 **가짜 액션으로 실제로 불러** 본다
 *       ("시트를 거치지 않고는 액션이 불리지 않는다" · "닫기 = 0회" · "메모 전달" · "실패 → 시트 유지"),
 *   (3) 컴포넌트는 renderToStaticMarkup 으로 첫 화면·시트 마크업을 검사하고,
 *   (4) 컴포넌트가 버튼을 컨트롤러에 **어떻게** 잇는지는 소스 정적 검사로 잠근다.
 * 실제 클릭·포커스 이동·inert·ESC·바깥 누르기는 브라우저 실측(보고서 ②·⑥)이 본다.
 *
 * tests/ 아래라 게이트 3종의 검사 대상이다 — 금지어·임시값 마커 리터럴을 그대로 쓰지 않는다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
// 클라이언트 컴포넌트가 쓰는 라우터 — 첫 화면 렌더에는 새로고침 함수 하나면 된다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
// 서버액션 모듈 — 'use server' 파일이 next/headers 를 끌어오지 않게 바꿔치기. 렌더 테스트는 부르지 않는다.
vi.mock("@/actions/admin/reservation", () => ({
  confirmReservation: vi.fn(),
  cancelReservation: vi.fn(),
  completeReservation: vi.fn(),
  saveReservationMemo: vi.fn(),
}));
// 라벨은 **진짜 카탈로그**에서 — 서버 도우미(getReservationActionLabels)를 그대로 부른다(tests/quick-display.test.ts 와 같은 mock).
vi.mock("next-intl/server", async () => {
  const { createTranslator: ct } = await import("next-intl");
  const { readFileSync: rf } = await import("node:fs");
  const p = await import("node:path");
  const messages = JSON.parse(rf(p.resolve(import.meta.dirname, "..", "messages", "ko.json"), "utf8"));
  return {
    getTranslations: vi.fn(async (opts?: { namespace?: string } | string) => {
      const namespace = typeof opts === "string" ? opts : opts?.namespace;
      return ct({ locale: "ko", messages, namespace: namespace as never });
    }),
  };
});

import { AdminSheet } from "@/components/admin/AdminSheet";
import { ReservationActions, ReservationSheet } from "@/components/admin/ReservationActions";
import { ReservationProcess } from "@/components/admin/ReservationProcess";
import s from "@/components/admin/admin.module.css";
import { getReservationActionLabels } from "@/components/admin/reservationActionLabels";
import {
  CANCEL_REASONS,
  CUSTOMER_NAME_ELEMENT_ID,
  SHEET_STUCK_MS,
  TOAST_MS,
  bannerMessage,
  cleanCustomerName,
  composeCancelMemo,
  fillTemplate,
  focusReturn,
  initialPanelState,
  memoEdited,
  panelController,
  panelReducer,
  planCommit,
  sheetClosable,
  sheetTitle,
  toastDurationMs,
  toastHasLink,
  wrapFocus,
  type PanelActions,
  type PanelState,
  type ReservationActionLabels,
  type ReservationSummary,
  type SheetKind,
} from "@/components/admin/reservation-sheet";
import { ADMIN_MEMO_MAX_CHARS, normalizeAdminMemo } from "@/lib/admin/memo";
import { ALREADY_HANDLED_RESULT, FAILED_RESULT, type AdminActionResult } from "@/lib/admin/result";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const ko = JSON.parse(read("messages/ko.json")) as { admin: { detail: Record<string, unknown> } };
const detail = ko.admin.detail as Record<string, unknown> & { sheet: Record<string, unknown>; result: Record<string, string> };

const ACTIONS_UI = "components/admin/ReservationActions.tsx";
const SHEET_UI = "components/admin/AdminSheet.tsx";
const SHEET_LOGIC = "components/admin/reservation-sheet.ts";
const LABELS_HELPER = "components/admin/reservationActionLabels.tsx";
const MEMO_LIB = "lib/admin/memo.ts";
const ACTION = "actions/admin/reservation.ts";
const ADMIN_CSS = "components/admin/admin.module.css";
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NAME = "예시고객가";
const done = (code: AdminActionResult["code"]): AdminActionResult => ({ ok: true, changed: true, code });

/** 가짜 액션 4종 + 리듀서를 그대로 도는 상태 — 컴포넌트가 하는 일을 DOM 없이 재현한다. */
function harness(opts: { initialMemo?: string; results?: Partial<Record<keyof PanelActions, AdminActionResult | Error>> } = {}) {
  // 확정·취소·완료는 메모를 보내지 않을 수 있다(null = 서버가 저장된 메모를 지킨다 — 0010 coalesce · P2-3)
  type ActionFn = (id: string, memo: string | null) => Promise<AdminActionResult>;
  const outcome =
    (key: keyof PanelActions, fallback: AdminActionResult): ActionFn =>
    async () => {
      const r = opts.results?.[key] ?? fallback;
      if (r instanceof Error) throw r;
      return r;
    };
  const actions = {
    confirm: vi.fn<ActionFn>(outcome("confirm", done("confirmed"))),
    cancel: vi.fn<ActionFn>(outcome("cancel", done("cancelled"))),
    complete: vi.fn<ActionFn>(outcome("complete", done("completed"))),
    memo: vi.fn<ActionFn>(outcome("memo", done("memoUpdated"))),
  } satisfies PanelActions;
  let state: PanelState = initialPanelState(opts.initialMemo ?? "");
  const refresh = vi.fn();
  const readCustomerName = vi.fn(() => NAME);
  const controller = panelController({
    id: ID,
    actions,
    dispatch: (event) => {
      state = panelReducer(state, event);
    },
    refresh,
    readCustomerName,
    reasonLine: (reason) => `REASON:${reason}`,
  });
  const calls = () => Object.values(actions).reduce((n, fn) => n + fn.mock.calls.length, 0);
  return {
    actions,
    refresh,
    readCustomerName,
    controller,
    calls,
    get state() {
      return state;
    },
  };
}

let labelsCache: ReservationActionLabels | null = null;
async function labels(): Promise<ReservationActionLabels> {
  labelsCache ??= await getReservationActionLabels();
  return labelsCache;
}

/** 요약 상자 — 페이지가 만든 조각 그대로(P5-22 수정 라운드: 날짜는 페이지와 같은 "10월 1일 (목)" 표기 · 간편은 날짜만 · 상세는 시각까지). */
const SUMMARY: ReservationSummary = { parts: ["인천공항 → 서울", "10월 1일 (목)", "30명"], quick: true };

async function renderPanel(status: "new" | "confirmed" | "done" | "cancelled", initialMemo = ""): Promise<string> {
  return renderToStaticMarkup(
    createElement(ReservationActions, { id: ID, status, initialMemo, summary: SUMMARY, labels: await labels() }),
  );
}

async function renderSheet(
  sheet: SheetKind,
  patch: Partial<PanelState> = {},
  extra: { pending?: boolean; slow?: boolean; summary?: ReservationSummary } = {},
): Promise<string> {
  const state: PanelState = { ...initialPanelState(""), sheet, customerName: NAME, ...patch };
  return renderToStaticMarkup(
    createElement(ReservationSheet, {
      sheet,
      state,
      labels: await labels(),
      summary: extra.summary ?? SUMMARY,
      pending: extra.pending ?? false,
      slow: extra.slow ?? false,
      onClose: () => {},
      onSubmit: () => {},
      onPickReason: () => {},
    }),
  );
}

/** planCommit 의 입력을 짧게 — 서버 메모(마지막으로 아는 값)와 사유를 고를 수 있다. */
const plan = (action: SheetKind | "memo", memoText: string, opts: { server?: string; reason?: string | null; max?: number } = {}) =>
  planCommit({ action, memoText, serverMemo: opts.server ?? "", reasonLine: opts.reason ?? null }, opts.max);

/** 태그를 지운 본문. */
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** data-testid 로 여는 태그 하나. */
function openTag(html: string, testid: string): string {
  const at = html.indexOf(`data-testid="${testid}"`);
  expect(at, `${testid} 가 없다`).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}
/** 속성 값 — HTML 속성 이름은 대소문자를 가리지 않는다(React 가 maxLength·tabIndex 를 어떻게 쓰든). */
const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? null;
/** 평평한 영역(`data-zone`) 하나의 안쪽 — 영역 안에는 div 가 없다(버튼·문단뿐). */
function zone(html: string, name: string): string {
  const m = new RegExp(`<div[^>]*data-zone="${name}"[^>]*>([\\s\\S]*?)</div>`).exec(html);
  expect(m, `data-zone="${name}" 영역이 없다`).not.toBeNull();
  return m![1];
}

// =============================================================================
// 1. 순수 — 메모 조립 · 실행 계획(상한) · 서버와 같은 정규화
// =============================================================================
describe("1. 메모 — 취소 사유 덧붙이기 · 상한은 서버를 따른다", () => {
  test("composeCancelMemo — 기존 메모를 지우지 않고 한 줄을 덧붙인다", () => {
    expect(composeCancelMemo("", null)).toBe("");
    expect(composeCancelMemo("통화함", null)).toBe("통화함");
    expect(composeCancelMemo("통화함", "취소 사유: 고객 일정 변경")).toBe("통화함\n취소 사유: 고객 일정 변경");
    // 끝 공백·빈 줄은 한 줄로 접고 붙인다(서버도 양끝을 자른다)
    expect(composeCancelMemo("첫 줄\n둘째 줄\n\n  ", "취소 사유: 기타")).toBe("첫 줄\n둘째 줄\n취소 사유: 기타");
    // 메모가 비었으면 사유 한 줄만
    expect(composeCancelMemo("   ", "취소 사유: 연락이 안 됨")).toBe("취소 사유: 연락이 안 됨");
    // 기존 메모는 언제나 앞에 그대로 남는다
    const before = "7시 강남역 · 45인승 1대";
    expect(composeCancelMemo(before, "취소 사유: 차량을 못 구함").startsWith(before)).toBe(true);
  });

  test("planCommit — 고친 메모는 확정·완료·메모 저장에 그대로, 취소는 사유를 덧붙여 넘긴다", () => {
    expect(plan("confirm", "통화: 7시 출발")).toEqual({ kind: "call", action: "confirm", memo: "통화: 7시 출발", stored: "통화: 7시 출발" });
    expect(plan("complete", "운행 끝")).toEqual({ kind: "call", action: "complete", memo: "운행 끝", stored: "운행 끝" });
    expect(plan("cancel", "기존", { reason: "취소 사유: 기타" })).toEqual({ kind: "call", action: "cancel", memo: "기존\n취소 사유: 기타", stored: "기존\n취소 사유: 기타" });
    // 칸을 비우고 확정 — 보낸 빈 값은 서버에서 null(= 메모를 바꾸지 않는다). 메모 저장의 빈 값은 "지운다"
    expect(plan("confirm", "   ", { server: "X" })).toEqual({ kind: "call", action: "confirm", memo: "   ", stored: null });
    expect(plan("memo", "", { server: "X" })).toEqual({ kind: "call", action: "memo", memo: "", stored: null });
    // 메모 저장은 고치지 않았어도 보낸다(사장님이 누른 저장이다) · 저장될 값은 서버처럼 양끝을 자른 값
    expect(plan("memo", "X", { server: "X" })).toEqual({ kind: "call", action: "memo", memo: "X", stored: "X" });
    expect(plan("memo", "  메모  ")).toMatchObject({ stored: "메모" });
  });

  test("planCommit — 상한을 넘으면 액션을 부르지 않고 막는다(길이는 서버처럼 자른 뒤에 잰다)", () => {
    expect(plan("memo", "a".repeat(10), { max: 10 })).toMatchObject({ kind: "call" });
    expect(plan("memo", `  ${"a".repeat(10)}  `, { max: 10 })).toMatchObject({ kind: "call" });
    expect(plan("memo", "a".repeat(11), { max: 10 })).toEqual({ kind: "blocked", count: 11, max: 10, withReason: false });
    // 취소 — 메모는 상한 안이어도 사유를 붙이면 넘을 수 있다
    expect(plan("cancel", "a".repeat(5), { reason: "b".repeat(10), max: 10 })).toEqual({ kind: "blocked", count: 16, max: 10, withReason: true });
    expect(plan("cancel", "a".repeat(5), { max: 10 })).toMatchObject({ kind: "call" });
    // 보내지 않는 메모는 재지 않는다(고치지 않은 확정 — 서버에 있는 값을 건드리지 않는다)
    expect(plan("confirm", "a".repeat(11), { server: "a".repeat(11), max: 10 })).toEqual({ kind: "call", action: "confirm", memo: null, stored: null });
  });

  test("상한은 서버액션이 자르는 값과 같다 — 한 곳(lib/admin/memo.ts)에서 온다", () => {
    expect(ADMIN_MEMO_MAX_CHARS).toBe(2000);
    expect(normalizeAdminMemo("x".repeat(2500))?.length).toBe(ADMIN_MEMO_MAX_CHARS);
    expect(normalizeAdminMemo("  메모  ")).toBe("메모");
    expect(normalizeAdminMemo("   ")).toBeNull();
    expect(normalizeAdminMemo(undefined)).toBeNull();
    // 기본 상한이 그 값이다
    expect(plan("memo", "x".repeat(ADMIN_MEMO_MAX_CHARS))).toMatchObject({ kind: "call" });
    expect(plan("memo", "x".repeat(ADMIN_MEMO_MAX_CHARS + 1))).toMatchObject({ kind: "blocked", max: ADMIN_MEMO_MAX_CHARS });

    const action = codeOf(ACTION);
    expect(action, "서버액션이 같은 정규화를 쓰지 않는다").toMatch(/import \{[^}]*\bnormalizeAdminMemo\b[^}]*\} from "@\/lib\/admin\/memo";/);
    expect(action, "서버액션에 상한이 따로 남아 있다(두 값이 갈라질 수 있다)").not.toMatch(/MEMO_MAX_CHARS\s*=/);
    expect(action).not.toMatch(/function normalizeMemo/);
    // 상한 모듈은 클라이언트도 읽는다 — 서버 전용 표시·env 가 없어야 한다
    const lib = codeOf(MEMO_LIB);
    expect(lib).not.toMatch(/server-only|process\.env|next\//);
  });
});

/**
 * 리뷰 P2-3 — 확정·취소·완료가 **고치지 않은** 메모 칸 값을 보내면, 다른 화면(PC)이 그 사이 저장한 메모를
 * 이 화면(휴대폰)이 열릴 때의 옛 값으로 되돌린다(0010 은 `admin_memo = coalesce(p_memo, admin_memo)` — 값을 보내면 덮는다).
 * 그래서 칸을 고쳤거나(서버에서 받은 값과 다르다) 취소 사유를 골랐을 때만 보낸다. 아니면 null — 서버가 저장된 메모를 지킨다.
 */
describe("1-b. 고치지 않은 메모는 보내지 않는다 (리뷰 P2-3)", () => {
  test.each(["confirm", "cancel", "complete"] as const)("%s — 칸이 서버 값 그대로면 메모 없이(null)", (kind) => {
    expect(plan(kind, "저장된 메모", { server: "저장된 메모" })).toEqual({ kind: "call", action: kind, memo: null, stored: null });
    // 비어 있는 채로 열린 칸도 같다
    expect(plan(kind, "", { server: "" })).toEqual({ kind: "call", action: kind, memo: null, stored: null });
  });

  test.each(["confirm", "cancel", "complete"] as const)("%s — 고쳤으면 칸 값을 보낸다", (kind) => {
    expect(plan(kind, "고친 메모", { server: "저장된 메모" })).toEqual({ kind: "call", action: kind, memo: "고친 메모", stored: "고친 메모" });
  });

  test("취소 — 사유를 골랐으면 고치지 않았어도 보낸다(지금 보이는 메모 + 사유 한 줄)", () => {
    expect(plan("cancel", "저장된 메모", { server: "저장된 메모", reason: "취소 사유: 기타" })).toEqual({
      kind: "call",
      action: "cancel",
      memo: "저장된 메모\n취소 사유: 기타",
      stored: "저장된 메모\n취소 사유: 기타",
    });
  });

  test("고쳤다가 되돌리면 고치지 않은 것이다 — memoEdited 는 서버 값과의 차이다", () => {
    let st = initialPanelState("저장된 메모");
    expect(memoEdited(st)).toBe(false);
    st = panelReducer(st, { type: "editMemo", text: "저장된 메모!" });
    expect(memoEdited(st)).toBe(true);
    st = panelReducer(st, { type: "editMemo", text: "저장된 메모" });
    expect(memoEdited(st)).toBe(false);
    expect(plan("confirm", st.memoText, { server: st.serverMemo })).toMatchObject({ memo: null });
  });
});

// =============================================================================
// 2. 순수 — 상태 전이 (panelReducer)
// =============================================================================
describe("2. 상태 전이 — 시트 · 배너 · 토스트 · 메모 동기화", () => {
  /** 시트 열기 — 연 순서(sheetSeq)가 하나 는다. */
  const openOn = (st: PanelState, sheet: SheetKind) => panelReducer(st, { type: "open", sheet, customerName: NAME });
  /** 지금 열린 시트의 결과. */
  const settleSheet = (st: PanelState, action: SheetKind, result: AdminActionResult, stored: string | null = null) =>
    panelReducer(st, { type: "settled", source: "sheet", seq: st.sheetSeq, action, stored, result });

  test("처음 — 시트 없음 · 잠금 없음 · 메모 칸 = 서버 메모", () => {
    const st = initialPanelState("기존 메모");
    expect(st).toMatchObject({ sheet: null, sheetSeq: 0, sheetLocked: false, memoText: "기존 메모", serverMemo: "기존 메모", toast: null, sheetBanner: null, memoBanner: null });
    expect(memoEdited(st)).toBe(false);
  });

  test("열기 → 닫기 — 사유·배너를 비우고 '그냥 닫힘' 으로 기록한다 · 열 때마다 연 순서가 는다", () => {
    let st = openOn(initialPanelState(""), "cancel");
    expect(st).toMatchObject({ sheet: "cancel", sheetSeq: 1, customerName: NAME, reason: null, sheetBanner: null });
    st = panelReducer(st, { type: "pickReason", reason: "vehicle" });
    expect(st.reason).toBe("vehicle");
    st = panelReducer(st, { type: "close" });
    expect(st).toMatchObject({ sheet: null, reason: null, sheetBanner: null, lastClose: "dismissed" });
    expect(openOn(st, "confirm").sheetSeq).toBe(2);
  });

  test("사유는 취소 시트에서만 고른다", () => {
    const st = panelReducer(openOn(initialPanelState(""), "confirm"), { type: "pickReason", reason: "other" });
    expect(st.reason).toBeNull();
  });

  test("성공 — 시트를 닫고 토스트 · 메모 칸은 서버에 저장된 값", () => {
    let st = openOn(initialPanelState("옛 메모"), "confirm");
    st = panelReducer(st, { type: "editMemo", text: "새 메모" });
    st = settleSheet(st, "confirm", done("confirmed"), "새 메모");
    expect(st).toMatchObject({ sheet: null, lastClose: "changed", memoText: "새 메모", serverMemo: "새 메모", sheetBanner: null, sheetLocked: false });
    expect(memoEdited(st)).toBe(false);
    expect(st.toast).toEqual({ id: 1, code: "confirmed" });
  });

  test("성공 · 빈 메모 — 확정은 서버 메모를 바꾸지 않으므로 칸도 서버 값으로, 메모 저장은 칸을 비운다", () => {
    let st = panelReducer(initialPanelState("서버 메모"), { type: "editMemo", text: "" });
    st = settleSheet(openOn(st, "confirm"), "confirm", done("confirmed"), null);
    expect(st.memoText).toBe("서버 메모");
    let m = panelReducer(initialPanelState("서버 메모"), { type: "editMemo", text: "" });
    m = panelReducer(m, { type: "settled", source: "memo", action: "memo", stored: null, result: done("memoUpdated") });
    expect(m).toMatchObject({ memoText: "", serverMemo: "", toast: { id: 1, code: "memoUpdated" } });
  });

  test("실패 — 시트를 닫지 않고 시트 안 배너 · 토스트 없음 · 잠그지 않는다(다시 누를 수 있다)", () => {
    const st = settleSheet(openOn(initialPanelState(""), "confirm"), "confirm", FAILED_RESULT);
    expect(st).toMatchObject({ sheet: "confirm", sheetBanner: { kind: "failed" }, toast: null, sheetLocked: false });
  });

  test("이미 처리됨 — 시트 안 배너 + 시트 잠금(새로고침은 컨트롤러 몫)", () => {
    const st = settleSheet(openOn(initialPanelState(""), "cancel"), "cancel", ALREADY_HANDLED_RESULT);
    expect(st).toMatchObject({ sheet: "cancel", sheetBanner: { kind: "alreadyHandled" }, sheetLocked: true, toast: null });
  });

  /** 리뷰 P1-1 — 사유 칩이 배너를 지우면 실행 버튼 비활성과 컨트롤러 가드가 함께 풀렸다. 잠금은 배너와 따로 든다. */
  test("🔴 이미 처리됨 뒤에는 사유 고르기·상한 안내가 잠금·배너를 풀지 못한다 · 새로 열 때만 풀린다", () => {
    let st = settleSheet(openOn(initialPanelState("기존 메모"), "cancel"), "cancel", ALREADY_HANDLED_RESULT);
    for (const reason of CANCEL_REASONS) {
      st = panelReducer(st, { type: "pickReason", reason });
      expect(st, reason).toMatchObject({ sheetBanner: { kind: "alreadyHandled" }, sheetLocked: true, reason: null });
    }
    st = panelReducer(st, { type: "blocked", source: "sheet", count: 9, max: 5, withReason: true });
    expect(st).toMatchObject({ sheetBanner: { kind: "alreadyHandled" }, sheetLocked: true });
    st = panelReducer(st, { type: "editMemo", text: "고침" });
    expect(st).toMatchObject({ sheetBanner: { kind: "alreadyHandled" }, sheetLocked: true });
    // 닫으면 풀리고(그 시트는 끝났다), 새로 연 시트는 잠겨 있지 않다
    st = panelReducer(st, { type: "close" });
    expect(st).toMatchObject({ sheet: null, sheetLocked: false, sheetBanner: null });
    expect(openOn(st, "cancel")).toMatchObject({ sheetLocked: false, sheetBanner: null });
  });

  test("메모 저장 실패 — 메모 칸 옆 배너", () => {
    const st = panelReducer(initialPanelState(""), { type: "settled", source: "memo", action: "memo", stored: "x", result: FAILED_RESULT });
    expect(st).toMatchObject({ memoBanner: { kind: "failed" }, toast: null, sheet: null });
  });

  test("상한 초과 — 시트 안(또는 메모 칸 옆) 배너에 글자 수", () => {
    const opened = openOn(initialPanelState(""), "cancel");
    expect(panelReducer(opened, { type: "blocked", source: "sheet", count: 2021, max: 2000, withReason: true }).sheetBanner).toEqual({
      kind: "memoTooLong",
      count: 2021,
      max: 2000,
      withReason: true,
    });
    expect(panelReducer(initialPanelState(""), { type: "blocked", source: "memo", count: 2001, max: 2000, withReason: false }).memoBanner).toMatchObject({
      kind: "memoTooLong",
    });
  });

  test("메모를 고치면 메모 배너가 걷힌다 · 잠기지 않은 시트에서 사유를 바꾸면 상한 배너가 걷힌다", () => {
    let st = panelReducer(initialPanelState(""), { type: "settled", source: "memo", action: "memo", stored: "x", result: FAILED_RESULT });
    st = panelReducer(st, { type: "editMemo", text: "고침" });
    expect(st).toMatchObject({ memoBanner: null, memoText: "고침" });
    expect(memoEdited(st)).toBe(true);
    let c = openOn(initialPanelState(""), "cancel");
    c = panelReducer(c, { type: "blocked", source: "sheet", count: 9, max: 5, withReason: true });
    c = panelReducer(c, { type: "pickReason", reason: "other" });
    expect(c.sheetBanner).toBeNull();
  });

  test("서버가 새 메모를 내려 주면(새로고침) — 고치는 중이 아니면 따르고, 고치는 중이면 지키지 않는다", () => {
    const fresh = panelReducer(initialPanelState("옛"), { type: "propMemo", memo: "다른 탭에서 쓴 메모" });
    expect(fresh).toMatchObject({ memoText: "다른 탭에서 쓴 메모", serverMemo: "다른 탭에서 쓴 메모", propMemo: "다른 탭에서 쓴 메모" });
    const editing = panelReducer(panelReducer(initialPanelState("옛"), { type: "editMemo", text: "쓰는 중" }), { type: "propMemo", memo: "새 값" });
    expect(editing).toMatchObject({ memoText: "쓰는 중", serverMemo: "새 값" });
  });

  test("토스트 — 번호가 늘고, 끝남 신호는 자기 번호만 지운다", () => {
    let st = panelReducer(initialPanelState(""), { type: "settled", source: "memo", action: "memo", stored: "a", result: done("memoUpdated") });
    st = panelReducer(st, { type: "settled", source: "memo", action: "memo", stored: "b", result: done("memoUpdated") });
    expect(st.toast).toEqual({ id: 2, code: "memoUpdated" });
    expect(panelReducer(st, { type: "toastDone", id: 1 }).toast).toEqual({ id: 2, code: "memoUpdated" });
    expect(panelReducer(st, { type: "toastDone", id: 2 }).toast).toBeNull();
  });
});

/**
 * 리뷰 P2-1 — 응답이 오지 않으면 처리 중에 [닫기]를 되살린다(SHEET_STUCK_MS). 그러면 사장님이 시트를 닫은 **뒤에** 결과가 도착할 수 있다.
 * 늦게 온 결과는 닫힌(또는 그 뒤 새로 연) 시트를 건드리지 않고 토스트·메모 칸 옆 배너로 간다 — 연 순서(seq)로 가린다.
 */
describe("2-b. 늦게 온 결과 — 닫힌 시트 · 다른 시트를 건드리지 않는다 (리뷰 P2-1)", () => {
  const openOn = (st: PanelState, sheet: SheetKind) => panelReducer(st, { type: "open", sheet, customerName: NAME });
  const late = (st: PanelState, seq: number, action: SheetKind, result: AdminActionResult, stored: string | null = null) =>
    panelReducer(st, { type: "settled", source: "sheet", seq, action, stored, result });

  test("닫은 뒤 온 성공 — 토스트 · 메모 동기화 · 시트는 닫힌 그대로(포커스를 다시 옮기지 않는다)", () => {
    const opened = openOn(initialPanelState(""), "confirm");
    const closed = panelReducer(opened, { type: "close" });
    const st = late(closed, opened.sheetSeq, "confirm", done("confirmed"), "통화함");
    expect(st).toMatchObject({ sheet: null, lastClose: "dismissed", toast: { code: "confirmed" }, memoText: "통화함", serverMemo: "통화함" });
  });

  test("닫은 뒤 온 실패·이미 처리됨 — 메모 칸 옆 배너 · 잠금 없음", () => {
    const opened = openOn(initialPanelState(""), "cancel");
    const closed = panelReducer(opened, { type: "close" });
    expect(late(closed, opened.sheetSeq, "cancel", FAILED_RESULT)).toMatchObject({ sheet: null, sheetBanner: null, memoBanner: { kind: "failed" }, sheetLocked: false });
    expect(late(closed, opened.sheetSeq, "cancel", ALREADY_HANDLED_RESULT)).toMatchObject({
      sheet: null,
      memoBanner: { kind: "alreadyHandled" },
      sheetLocked: false,
    });
  });

  test("다른 시트가 열린 뒤 온 옛 결과 — 새 시트를 닫거나 잠그거나 배너를 달지 않는다", () => {
    const first = openOn(initialPanelState(""), "confirm");
    const second = openOn(panelReducer(first, { type: "close" }), "cancel");
    expect(second.sheetSeq).toBe(first.sheetSeq + 1);
    const failed = late(second, first.sheetSeq, "confirm", FAILED_RESULT);
    expect(failed).toMatchObject({ sheet: "cancel", sheetBanner: null, sheetLocked: false, memoBanner: { kind: "failed" } });
    const handled = late(second, first.sheetSeq, "confirm", ALREADY_HANDLED_RESULT);
    expect(handled).toMatchObject({ sheet: "cancel", sheetBanner: null, sheetLocked: false });
    const ok = late(second, first.sheetSeq, "confirm", done("confirmed"));
    expect(ok).toMatchObject({ sheet: "cancel", toast: { code: "confirmed" } });
  });
});

// =============================================================================
// 3. 컨트롤러 — 버튼 → 서버액션 경로를 가짜 액션으로 실제로 부른다
// =============================================================================
describe("3. 시트를 거치지 않고는 액션이 불리지 않는다 (브리프 §테스트)", () => {
  test("확정·취소·완료 진입(열기)만으로는 액션 0회", () => {
    const h = harness();
    for (const kind of ["confirm", "cancel", "complete"] as const) {
      h.controller.open(kind);
      expect(h.state.sheet).toBe(kind);
      h.controller.close();
    }
    expect(h.calls()).toBe(0);
  });

  test("시트 없이 실행(commit)을 불러도 0회", async () => {
    const h = harness();
    await h.controller.commit(h.state);
    expect(h.calls()).toBe(0);
  });

  test("닫기 = 액션 0회 — 닫은 뒤 실행을 불러도 0회", async () => {
    const h = harness({ initialMemo: "메모" });
    h.controller.open("confirm");
    h.controller.close();
    await h.controller.commit(h.state);
    expect(h.calls()).toBe(0);
    expect(h.state).toMatchObject({ sheet: null, lastClose: "dismissed" });
  });

  test("열 때 서버가 이미 그린 이름을 읽는다 — 이름은 props 가 아니라 이 상태에만 있다", () => {
    const h = harness();
    h.controller.open("confirm");
    expect(h.readCustomerName).toHaveBeenCalledTimes(1);
    expect(h.state.customerName).toBe(NAME);
  });
});

describe("3-b. 실행 — 메모 전달 · 사유 · 상한 · 결과", () => {
  test("확정 — 메모 칸의 현재 값을 함께 넘긴다(1회) · 토스트 · 새로고침", async () => {
    const h = harness();
    h.controller.editMemo("통화: 7시 출발 · 45인승 1대");
    h.controller.open("confirm");
    await h.controller.commit(h.state);
    expect(h.actions.confirm).toHaveBeenCalledTimes(1);
    expect(h.actions.confirm).toHaveBeenCalledWith(ID, "통화: 7시 출발 · 45인승 1대");
    expect(h.calls()).toBe(1);
    expect(h.state).toMatchObject({ sheet: null, toast: { code: "confirmed" }, memoText: "통화: 7시 출발 · 45인승 1대" });
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  test("완료 — 고친 메모를 함께 넘긴다", async () => {
    const h = harness({ initialMemo: "배차 완료" });
    h.controller.editMemo("배차 완료 · 기사님 확인");
    h.controller.open("complete");
    await h.controller.commit(h.state);
    expect(h.actions.complete).toHaveBeenCalledWith(ID, "배차 완료 · 기사님 확인");
    expect(h.state.toast).toMatchObject({ code: "completed" });
  });

  /** 리뷰 P2-3 — 세 전이 모두: 칸을 고치지 않았으면 메모를 보내지 않는다(다른 화면이 저장한 메모를 옛 값으로 덮지 않게). */
  test.each(["confirm", "cancel", "complete"] as const)("%s — 칸을 고치지 않았으면 메모 없이(null) 부른다", async (kind) => {
    const h = harness({ initialMemo: "휴대폰이 열릴 때의 메모" });
    h.controller.open(kind);
    await h.controller.commit(h.state);
    expect(h.actions[kind]).toHaveBeenCalledTimes(1);
    expect(h.actions[kind]).toHaveBeenCalledWith(ID, null);
    // 칸은 서버가 지킨 값 그대로(새로고침이 다른 화면의 값을 가져오면 그것을 따른다)
    expect(h.state.memoText).toBe("휴대폰이 열릴 때의 메모");
  });

  test.each(["confirm", "cancel", "complete"] as const)("%s — 고쳤다가 되돌렸으면 고치지 않은 것(null)", async (kind) => {
    const h = harness({ initialMemo: "그대로" });
    h.controller.editMemo("그대로!");
    h.controller.editMemo("그대로");
    h.controller.open(kind);
    await h.controller.commit(h.state);
    expect(h.actions[kind]).toHaveBeenCalledWith(ID, null);
  });

  test.each(["confirm", "cancel", "complete"] as const)("%s — 고쳤으면 칸 값을 보낸다", async (kind) => {
    const h = harness({ initialMemo: "옛 메모" });
    h.controller.editMemo("고친 메모");
    h.controller.open(kind);
    await h.controller.commit(h.state);
    expect(h.actions[kind]).toHaveBeenCalledWith(ID, "고친 메모");
  });

  test("칸을 비우고 확정 — 빈 값을 보내지만 서버는 메모를 지우지 않는다(0010) · 칸도 저장된 메모로 돌아온다", async () => {
    const h = harness({ initialMemo: "저장된 메모" });
    h.controller.editMemo("");
    h.controller.open("confirm");
    await h.controller.commit(h.state);
    expect(h.actions.confirm).toHaveBeenCalledWith(ID, "");
    expect(h.state.memoText).toBe("저장된 메모");
  });

  test("취소 — 고른 사유를 한 줄 덧붙이되 기존 메모를 지우지 않는다", async () => {
    const h = harness({ initialMemo: "기존 메모" });
    h.controller.open("cancel");
    h.controller.pickReason("schedule");
    await h.controller.commit(h.state);
    expect(h.actions.cancel).toHaveBeenCalledWith(ID, "기존 메모\nREASON:schedule");
    // 칸도 서버에 남은 값으로 — 뒤이은 '메모 저장' 이 사유 줄을 지우지 않게
    expect(h.state.memoText).toBe("기존 메모\nREASON:schedule");
    expect(h.state.toast).toMatchObject({ code: "cancelled" });
  });

  test("취소 — 사유도 없고 칸도 고치지 않았으면 메모 없이(null) — 기존 메모는 서버가 지킨다", async () => {
    const h = harness({ initialMemo: "기존 메모" });
    h.controller.open("cancel");
    await h.controller.commit(h.state);
    expect(h.actions.cancel).toHaveBeenCalledWith(ID, null);
  });

  test("상한 초과 — 막고 안내한다(액션 0회 · 시트 유지)", async () => {
    const h = harness({ initialMemo: "x".repeat(ADMIN_MEMO_MAX_CHARS) });
    h.controller.open("cancel");
    h.controller.pickReason("vehicle");
    await h.controller.commit(h.state);
    expect(h.calls()).toBe(0);
    expect(h.state.sheet).toBe("cancel");
    expect(h.state.sheetBanner).toEqual({
      kind: "memoTooLong",
      count: ADMIN_MEMO_MAX_CHARS + 1 + "REASON:vehicle".length,
      max: ADMIN_MEMO_MAX_CHARS,
      withReason: true,
    });
  });

  test("실패 → 시트를 닫지 않고 배너 · 새로고침 없음", async () => {
    const h = harness({ results: { confirm: FAILED_RESULT } });
    h.controller.open("confirm");
    await h.controller.commit(h.state);
    expect(h.state).toMatchObject({ sheet: "confirm", sheetBanner: { kind: "failed" }, toast: null });
    expect(h.refresh).not.toHaveBeenCalled();
  });

  test("액션이 throw 해도(네트워크 끊김) 실패 배너 — 전이가 오류 경계로 번지지 않는다", async () => {
    const h = harness({ results: { cancel: new Error("fetch failed") } });
    h.controller.open("cancel");
    await expect(h.controller.commit(h.state)).resolves.toBeUndefined();
    expect(h.state).toMatchObject({ sheet: "cancel", sheetBanner: { kind: "failed" } });
  });

  test("이미 처리된 건 → 배너 + 새로고침(지금 동작 유지) · 그 뒤 실행은 0회", async () => {
    const h = harness({ results: { confirm: ALREADY_HANDLED_RESULT } });
    h.controller.open("confirm");
    await h.controller.commit(h.state);
    expect(h.state).toMatchObject({ sheet: "confirm", sheetBanner: { kind: "alreadyHandled" }, sheetLocked: true });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await h.controller.commit(h.state);
    expect(h.actions.confirm).toHaveBeenCalledTimes(1);
  });

  /**
   * 🔴 리뷰 P1-1 — 취소 시트에서 "이미 처리됨" 이 뜬 뒤 사유 칩을 누르면 배너가 지워지고 가드가 풀려 같은 취소가 한 번 더 나갔다
   * (리뷰 실측: cancel("기존 메모") → cancel("기존 메모\n취소 사유: vehicle")). 이제 무엇을 눌러도 호출은 1회뿐이다.
   */
  test("🔴 취소 → 이미 처리됨 → 사유 고르기 → 배너 유지 · 실행 버튼 비활성 · 사유 라디오 비활성 · 호출 1회", async () => {
    const h = harness({ initialMemo: "기존 메모", results: { cancel: ALREADY_HANDLED_RESULT } });
    h.controller.open("cancel");
    await h.controller.commit(h.state);
    expect(h.actions.cancel).toHaveBeenCalledTimes(1);
    h.controller.pickReason("vehicle");
    expect(h.state).toMatchObject({ sheet: "cancel", sheetBanner: { kind: "alreadyHandled" }, sheetLocked: true, reason: null });

    // 화면도 같은 판정을 그린다 — 실행 버튼 · 사유 라디오 모두 disabled
    const html = await renderSheet("cancel", h.state);
    expect(attr(openTag(html, "admin-sheet-submit"), "disabled")).toBe("");
    for (const reason of CANCEL_REASONS) expect(attr(openTag(html, `admin-cancel-reason-${reason}`), "disabled"), reason).toBe("");
    expect(text(elementOf(html, "admin-sheet-banner"))).toBe(detail.result.alreadyHandled);

    // 무엇을 눌러도 — 사유 전부 · 메모 · 메모 저장 · 실행 여러 번 — 다시 나가지 않는다
    for (const reason of CANCEL_REASONS) h.controller.pickReason(reason);
    h.controller.editMemo("다른 메모");
    await h.controller.saveMemo(h.state);
    await h.controller.commit(h.state);
    await h.controller.commit(h.state);
    expect(h.actions.cancel).toHaveBeenCalledTimes(1);
    expect(h.calls()).toBe(1);
    expect(h.state.sheetBanner).toEqual({ kind: "alreadyHandled" });
  });

  test("메모 저장 — 시트 없이 바로(되돌릴 수 있는 동작) · 토스트", async () => {
    const h = harness();
    h.controller.editMemo("  통화 내용  ");
    await h.controller.saveMemo(h.state);
    expect(h.actions.memo).toHaveBeenCalledWith(ID, "  통화 내용  ");
    expect(h.state).toMatchObject({ toast: { code: "memoUpdated" }, memoText: "통화 내용" });
    expect(memoEdited(h.state)).toBe(false);
  });

  test("메모 저장은 시트가 열려 있는 동안 부르지 않는다", async () => {
    const h = harness({ initialMemo: "x" });
    h.controller.open("confirm");
    await h.controller.saveMemo(h.state);
    expect(h.calls()).toBe(0);
  });

  test("메모 저장 실패 — 메모 칸 옆 배너", async () => {
    const h = harness({ results: { memo: FAILED_RESULT } });
    h.controller.editMemo("x");
    await h.controller.saveMemo(h.state);
    expect(h.state).toMatchObject({ memoBanner: { kind: "failed" }, toast: null });
  });
});

// =============================================================================
// 4. 순수 — 포커스 가둠 · 포커스 복귀 · 토스트 시간 · 제목·배너 문구
// =============================================================================
describe("4. 포커스 · 토스트 · 문구 조립", () => {
  type Fake = { id: string; radio?: string; checked?: boolean };
  const container: Fake = { id: "dialog" };
  const r1: Fake = { id: "r1", radio: "reason" };
  const r2: Fake = { id: "r2", radio: "reason" };
  const close: Fake = { id: "close" };
  const submit: Fake = { id: "submit" };
  const opts = { container, radioGroup: (el: Fake) => el.radio ?? null, isChecked: (el: Fake) => el.checked === true };

  test("Tab 가둠 — 마지막에서 Tab 은 처음으로, 처음에서 Shift+Tab 은 마지막으로, 가운데는 브라우저에 맡긴다", () => {
    expect(wrapFocus([close, submit], submit, false, opts)).toBe(close);
    expect(wrapFocus([close, submit], close, true, opts)).toBe(submit);
    expect(wrapFocus([close, submit], close, false, opts)).toBeNull();
    expect(wrapFocus([close, submit], submit, true, opts)).toBeNull();
  });

  test("라디오 묶음은 한 칸이다 — 고른 것이 있으면 그것으로, 없으면 묶음의 첫 것으로 들어간다", () => {
    const items = [r1, r2, close, submit];
    expect(wrapFocus(items, submit, false, opts)).toBe(r1);
    const checked = { ...r2, checked: true };
    expect(wrapFocus([r1, checked, close, submit], submit, false, opts)).toBe(checked);
    // 묶음 안 어느 라디오에서든 Shift+Tab 은 마지막으로
    expect(wrapFocus([r1, checked, close, submit], checked, true, opts)).toBe(submit);
  });

  test("포커스가 시트 밖(body)·시트 자체에 있으면 안으로 들인다 · 누를 것이 없으면 시트 자체", () => {
    expect(wrapFocus([close, submit], null, false, opts)).toBe(close);
    expect(wrapFocus([close, submit], null, true, opts)).toBe(submit);
    expect(wrapFocus([close, submit], container, true, opts)).toBe(submit);
    expect(wrapFocus([], close, false, opts)).toBe(container);
  });

  test("포커스 복귀 — 닫기면 연 버튼으로, 바뀌었거나 연 버튼을 쓸 수 없으면(사라짐·처리 중 비활성) 처리 영역으로", () => {
    expect(focusReturn("dismissed", true)).toBe("opener");
    expect(focusReturn("dismissed", false)).toBe("panel");
    expect(focusReturn("changed", true)).toBe("panel");
    expect(focusReturn(null, true)).toBe("opener");
  });

  /**
   * 리뷰 P2-1 — 처리 중에는 ESC·바깥·[닫기]가 모두 막히고 배경은 inert 다. 응답이 끝내 오지 않으면(클라이언트 연결이 죽음) 빠져나갈 길이 없었다.
   * N초가 지나면 [닫기](와 ESC·바깥)를 되살린다. 실행 버튼은 계속 막는다 — 같은 판정을 두 번 보내지 않는다.
   */
  test("처리 중 [닫기] — N초 전에는 막고 N초 뒤에는 되살린다 · 처리 중이 아니면 언제나 닫을 수 있다", () => {
    expect(sheetClosable(false, false)).toBe(true);
    expect(sheetClosable(true, false)).toBe(false);
    expect(sheetClosable(true, true)).toBe(true);
    expect(sheetClosable(false, true)).toBe(true);
  });

  test("N = SHEET_STUCK_MS — 정상 응답(실측 1초 안팎)보다 충분히 길고, 서버 함수 한도(maxDuration)보다 짧다", () => {
    const page = read("app/admin/(protected)/reservations/[id]/page.tsx");
    const maxDuration = Number(/^export const maxDuration = (\d+);$/m.exec(page)?.[1]);
    expect(maxDuration).toBeGreaterThan(0);
    expect(SHEET_STUCK_MS).toBe(15_000);
    expect(SHEET_STUCK_MS).toBeGreaterThanOrEqual(10_000);
    // 한도보다 길면 의미가 없다 — 서버가 느린 경우는 한도에서 오류(→ 시트 안 배너)로 먼저 끝난다. 이 탈출구는 응답이 영영 오지 않을 때를 위한 것이다
    expect(SHEET_STUCK_MS).toBeLessThan(maxDuration * 1000);
  });

  test("토스트 — 3초, 링크가 있으면 5초 · 링크는 확정 토스트에만(발송 내역)", () => {
    expect(TOAST_MS).toEqual({ plain: 3000, withLink: 5000 });
    expect(toastDurationMs(false)).toBe(3000);
    expect(toastDurationMs(true)).toBe(5000);
    expect(toastHasLink("confirmed")).toBe(true);
    for (const code of ["cancelled", "completed", "memoUpdated"] as const) expect(toastHasLink(code), code).toBe(false);
  });

  test("이름 — 서버가 그린 글자를 정리한다 · 없으면 이름 없는 제목", () => {
    expect(cleanCustomerName("  예시\n  고객가  ")).toBe("예시 고객가");
    expect(cleanCustomerName(null)).toBe("");
    expect(cleanCustomerName(undefined)).toBe("");
    expect(sheetTitle("{name} 님 접수를 확정할까요?", "이 접수를 확정할까요?", NAME)).toBe(`${NAME} 님 접수를 확정할까요?`);
    expect(sheetTitle("{name} 님 접수를 확정할까요?", "이 접수를 확정할까요?", "")).toBe("이 접수를 확정할까요?");
    expect(CUSTOMER_NAME_ELEMENT_ID).toBe("admin-customer-name");
  });

  test("fillTemplate — 아는 자리만 채운다", () => {
    expect(fillTemplate("{max}자를 넘어요(지금 {count}자)", { max: "2,000", count: "2,021" })).toBe("2,000자를 넘어요(지금 2,021자)");
    expect(fillTemplate("{name} · {other}", { name: "가" })).toBe("가 · {other}");
  });

  test("배너 문구 — 실패·이미 처리됨·상한(사유 포함 여부 · 천 단위 쉼표)", async () => {
    const l = await labels();
    expect(bannerMessage({ kind: "failed" }, l)).toBe(l.results.failed);
    expect(bannerMessage({ kind: "alreadyHandled" }, l)).toBe(l.results.alreadyHandled);
    expect(bannerMessage({ kind: "memoTooLong", count: 2021, max: 2000, withReason: true }, l)).toContain("2,021");
    expect(bannerMessage({ kind: "memoTooLong", count: 2021, max: 2000, withReason: true }, l)).toContain("2,000");
    expect(bannerMessage({ kind: "memoTooLong", count: 2021, max: 2000, withReason: true }, l)).not.toBe(
      bannerMessage({ kind: "memoTooLong", count: 2021, max: 2000, withReason: false }, l),
    );
  });
});

// =============================================================================
// 5. 카탈로그 — 시안·브리프 문구 그대로(해요체)
// =============================================================================
describe("5. messages/ko.json admin.detail — 브리프 문구", () => {
  const sheet = detail.sheet as Record<string, unknown> & { reason: Record<string, string> };

  test("확정 시트", () => {
    expect(sheet.confirmTitle).toBe("{name} 님 접수를 확정할까요?");
    expect(sheet.confirmTitleNoName).toBe("이 접수를 확정할까요?");
    expect(sheet.confirmBody).toBe("확정하면 고객에게 확정 안내 문자가 가요. 보낸 문자는 되돌릴 수 없어요.");
    expect(sheet.confirmSubmit).toBe("확정하고 문자 보내기");
    expect(sheet.close).toBe("닫기");
    expect(sheet.quickNote).toBe("간편 접수 — 차량·시각은 통화로 정한 대로");
  });

  test("취소 시트 — 문자가 가지 않는다는 안내 · 사유 4개 · 덧붙는 줄", () => {
    expect(sheet.cancelTitle).toBe("{name} 님 접수를 취소할까요?");
    expect(sheet.cancelTitleNoName).toBe("이 접수를 취소할까요?");
    expect(sheet.cancelBody).toBe("취소하면 되돌릴 수 없어요. <b>고객에게 문자가 가지 않으니</b> 전화로 알려 주세요.");
    expect(sheet.cancelSubmit).toBe("접수 취소하기");
    expect(sheet.reason).toEqual({ schedule: "고객 일정 변경", vehicle: "차량을 못 구함", unreachable: "연락이 안 됨", other: "기타" });
    expect(Object.keys(sheet.reason)).toEqual([...CANCEL_REASONS]);
    expect(sheet.reasonHint).toBe("고른 사유는 메모에 함께 남아요");
    expect(sheet.reasonLine).toBe("취소 사유: {reason}");
  });

  test("처리 영역 — 취소는 글자 버튼 + 안내 한 줄 · 확정 안내", () => {
    expect(detail.cancel).toBe("이 접수 취소하기");
    expect(detail.cancelHint).toBe("취소하면 고객에게 문자가 가지 않아요. 전화로 알려 주세요.");
    expect(detail.confirm).toBe("확정하기");
    expect(detail.confirmHint).toBe("확정하면 고객에게 확정 안내 문자가 가요.");
  });

  /**
   * 리뷰 P2-7 — 옛 안내 "누를 때 이 메모도 함께 저장돼요" 는 과했다: 고치지 않은 메모는 보내지 않고(P2-3),
   * 칸을 비우고 확정해도 서버는 메모를 지우지 않는다(0010 coalesce). 안내는 동작 그대로 — 고친 메모만 함께 저장되고, 다 지울 때는 '메모 저장'.
   */
  test("메모 안내 — 고친 메모만 함께 저장된다 · 다 지울 때는 '메모 저장'(동작과 같은 말)", () => {
    expect(detail.memoHint).toBe("고객에게는 보이지 않아요. 고친 메모는 확정·취소·운행 완료를 누를 때 함께 저장돼요. 다 지울 때는 '메모 저장'을 눌러 주세요.");
    expect(detail.memoSave).toBe("메모 저장");
  });

  test("응답이 늦을 때 — 닫아도 된다 · 결과가 오면 이 화면에 알린다(리뷰 P2-1)", () => {
    expect(sheet.slow).toBe("응답이 늦어지고 있어요. 닫아도 괜찮아요 — 결과가 오면 이 화면에 알려 드려요.");
  });

  test("결과 — 성공 토스트 3종 + 실패 배너(해요체)", () => {
    expect(detail.result.confirmed).toBe("확정했어요. 확정 안내 문자를 보내고 있어요.");
    expect(detail.result.cancelled).toBe("취소했어요. 고객에게 전화로 알려 주세요.");
    expect(detail.result.memoUpdated).toBe("메모를 저장했어요.");
    expect(detail.result.failed.startsWith("처리하지 못했어요. 잠시 뒤 다시 눌러 주세요")).toBe(true);
    // 합쇼체가 남아 있지 않다 — 이 태스크가 바꾼 문구 묶음 전체
    const touched = [detail.result, sheet, detail.cancel, detail.cancelHint, detail.confirmHint, detail.complete, detail.completeHint, detail.memoHint, sheet.slow];
    expect(JSON.stringify(touched)).not.toMatch(/습니다|십시오|하십시오/);
  });

  test("라벨 도우미 — 사유 줄은 카탈로그 문장으로 조립한다 · 링크는 발송 내역 탭", async () => {
    const l = await labels();
    expect(l.sheet.cancel.reasons.map((r) => r.key)).toEqual([...CANCEL_REASONS]);
    expect(l.sheet.cancel.reasons[0]).toEqual({ key: "schedule", label: "고객 일정 변경", line: "취소 사유: 고객 일정 변경" });
    expect(l.toastLink).toEqual({ label: detail.toastLink, href: "/admin/notifications" });
    // `{name}` 자리는 화면이 채운다(보간을 거치지 않은 원문)
    expect(l.sheet.confirm.title).toBe("{name} 님 접수를 확정할까요?");
    expect(l.memoTooLong).toContain("{count}");
  });
});

// =============================================================================
// 6. 마크업 — 처리 영역(첫 화면) · 시트
// =============================================================================
/**
 * P5-22 — 상세 재배치(시안 #detail 처리 카드)로 진입 버튼이 **처리 카드(components/admin/ReservationProcess.tsx)** 로 옮겨 갔다.
 * 확정·완료·취소 진입 버튼은 이제 처리 카드(데스크톱 오른쪽 열 · 휴대폰은 아래 행동 바와 맨 아래 칸)의 진입 버튼(SheetTrigger)이고,
 * 누르면 채널로 처리 영역(ReservationActions — 시트·메모·토스트의 주인)에 시트를 열어 달라고 한다. 메모는 시안대로 본문의 메모 카드다.
 * 이 절의 뜻은 그대로다: 취소 진입은 확정 버튼과 같은 줄·같은 크기가 아니다(구분선 아래 글자 버튼) · 안내 한 줄씩 · 끝난 접수에는 전이 버튼이 없다.
 * 옛 단언 "메모가 확정과 취소 사이" 는 시안의 새 배치(메모는 따로 카드)로 바뀌었다 — 둘 사이는 구분선이 가른다.
 */
describe("6. 처리 영역 — 취소 진입 버튼은 확정 버튼과 같은 줄·같은 크기가 아니다 (구조)", () => {
  const processCard = async (status: "new" | "confirmed" | "done" | "cancelled") =>
    renderToStaticMarkup(createElement(ReservationProcess, { id: ID, status, labels: await labels(), layout: "card" }));

  test("신규 — 확정(주 버튼 영역) · 구분선 · 취소(글자 버튼 영역) 순서 (P5-22: 메모는 본문의 메모 카드로 — 시안)", async () => {
    const html = await processCard("new");
    const primary = zone(html, "primary");
    const cancel = zone(html, "cancel");
    expect(primary).toContain('data-testid="admin-confirm"');
    expect(primary).not.toContain('data-testid="admin-cancel"');
    expect(cancel).toContain('data-testid="admin-cancel"');
    expect(cancel).not.toContain('data-testid="admin-confirm"');

    const iConfirm = html.indexOf('data-testid="admin-confirm"');
    const iRule = html.indexOf("<hr");
    const iCancel = html.indexOf('data-testid="admin-cancel"');
    expect(iConfirm).toBeGreaterThanOrEqual(0);
    expect(iRule, "구분선이 확정 뒤·취소 앞에 있다").toBeGreaterThan(iConfirm);
    expect(iCancel).toBeGreaterThan(iRule);
    // 메모는 처리 카드에 없다 — 처리 영역(ReservationActions)의 메모 카드
    expect(html).not.toContain('id="admin-memo"');
    expect(await renderPanel("new")).toContain('id="admin-memo"');

    // 모양 — 확정은 주 버튼, 취소는 글자 버튼(같은 클래스가 아니다)
    const confirmTag = openTag(html, "admin-confirm");
    const cancelTag = openTag(html, "admin-cancel");
    expect(attr(confirmTag, "data-variant")).toBe("primary");
    expect(attr(cancelTag, "data-variant")).toBe("text");
    expect(attr(confirmTag, "class")).toBe(s.btnPrimary);
    expect(attr(cancelTag, "class")).toBe(s.btnText);
    // 안내 한 줄
    const l = await labels();
    expect(text(cancel)).toContain(l.cancelHint);
    expect(text(primary)).toContain(l.confirmHint);
  });

  test("신규 — 시트는 닫혀 있고, 결과 알림 자리(role=status)는 처음부터 있다(비어 있음) · 메모 상한", async () => {
    const html = await renderPanel("new", "기존 메모");
    expect(html).not.toMatch(/role="(alert)?dialog"/);
    const region = openTag(html, "admin-toast-region");
    expect(attr(region, "role")).toBe("status");
    expect(attr(region, "aria-live")).toBe("polite");
    expect(html).not.toContain('data-testid="admin-toast"');
    // 메모 칸은 서버 상한에서 멈춘다(넘친 붙여넣기는 칸에서 잘려 보인다 — 서버가 몰래 자르지 않게)
    expect(attr(openTag(html, "admin-memo"), "maxLength")).toBe(String(ADMIN_MEMO_MAX_CHARS));
    expect(html).toContain("기존 메모");
    // 처리 영역은 포커스를 받을 수 있는 이름 붙은 묶음이다(성공 뒤 포커스가 돌아올 자리) — P5-22 부터 처리 카드가 그 자리다(이름은 제목 '처리')
    const card = await processCard("new");
    const panel = openTag(card, "admin-reservation-actions");
    expect(attr(panel, "tabindex")).toBe("-1");
    expect(attr(panel, "role")).toBe("group");
    const titleId = attr(panel, "aria-labelledby");
    expect(text(new RegExp(`<h2[^>]*id="${titleId}"[^>]*>([\\s\\S]*?)</h2>`).exec(card)![1])).toBe((await labels()).panel);
  });

  test("확정 — 운행 완료(주 버튼) + 취소(글자 버튼) · 확정 버튼 없음", async () => {
    const html = await processCard("confirmed");
    expect(zone(html, "primary")).toContain('data-testid="admin-complete"');
    expect(zone(html, "cancel")).toContain('data-testid="admin-cancel"');
    expect(html).not.toContain('data-testid="admin-confirm"');
    expect(attr(openTag(html, "admin-complete"), "class")).toBe(s.btnPrimary);
  });

  test("완료·취소 — 전이 버튼 없음(메모만)", async () => {
    for (const status of ["done", "cancelled"] as const) {
      const card = await processCard(status);
      const html = await renderPanel(status);
      for (const id of ["admin-confirm", "admin-complete", "admin-cancel"]) {
        expect(card, `${status}:${id}`).not.toContain(`data-testid="${id}"`);
        expect(html, `${status}:${id}`).not.toContain(`data-testid="${id}"`);
      }
      expect(card, status).not.toContain("<hr");
      expect(html, status).toContain('data-testid="admin-memo-save"');
    }
  });
});

describe("6-b. 확인 시트 마크업", () => {
  test("확정 — alertdialog · aria-modal · 제목(이름) · 요약(간편 접수 한 줄) · 본문 · [닫기][확정하고 문자 보내기]", async () => {
    const html = await renderSheet("confirm");
    const dialog = openTag(html, "admin-sheet-confirm");
    expect(attr(dialog, "role")).toBe("alertdialog");
    expect(attr(dialog, "aria-modal")).toBe("true");
    const titleId = attr(dialog, "aria-labelledby");
    const descId = attr(dialog, "aria-describedby");
    expect(titleId).toBeTruthy();
    expect(html).toContain(`<h2 id="${titleId}"`);
    expect(text(new RegExp(`<h2 id="${titleId}"[^>]*>([\\s\\S]*?)</h2>`).exec(html)![1])).toBe(`${NAME} 님 접수를 확정할까요?`);
    expect(text(new RegExp(`id="${descId}"[^>]*>([\\s\\S]*?)</p>`).exec(html)![1])).toBe(detail.sheet.confirmBody);

    const summary = text(zoneOf(html, "admin-sheet-summary"));
    expect(summary).toContain("인천공항 → 서울 · 10월 1일 (목) · 30명");
    expect(summary).toContain(detail.sheet.quickNote as string);

    // 버튼 순서(DOM) — 닫기(보조)가 먼저 · 결과 동사(주 버튼)가 뒤. 데스크톱은 왼쪽 닫기 · 오른쪽 결과 동사, 휴대폰은 CSS 로
    // 결과 동사가 위 · 닫기가 맨 아래(P5-22 수정 라운드 · 리뷰 반려 P0-1 — tests/admin-sheet-arming.test.ts §4)
    const iClose = html.indexOf('data-testid="admin-sheet-close"');
    const iSubmit = html.indexOf('data-testid="admin-sheet-submit"');
    expect(iClose).toBeGreaterThan(0);
    expect(iSubmit).toBeGreaterThan(iClose);
    expect(text(elementOf(html, "admin-sheet-close"))).toBe("닫기");
    expect(text(elementOf(html, "admin-sheet-submit"))).toBe("확정하고 문자 보내기");
    expect(attr(openTag(html, "admin-sheet-submit"), "data-variant")).toBe("primary");
    expect(attr(openTag(html, "admin-sheet-submit"), "class")).toBe(s.btnPrimary);
    expect(html).not.toContain('role="alert"');
  });

  test("확정 — 이름을 읽지 못하면 이름 없는 제목 · 상세 접수면 간편 한 줄 없음", async () => {
    const html = await renderSheet("confirm", { customerName: "" }, { summary: { parts: ["서울 → 부산", "10월 1일 (목) 08:30"], quick: false } });
    expect(text(html)).toContain("이 접수를 확정할까요?");
    expect(text(html)).not.toContain(detail.sheet.quickNote as string);
    expect(text(zoneOf(html, "admin-sheet-summary"))).toBe("서울 → 부산 · 10월 1일 (목) 08:30");
  });

  test("취소 — 짙은 면 [접수 취소하기] · 문자가 가지 않는다(굵게) · 사유 라디오 4개(기본 해제) · 요약 없음", async () => {
    const html = await renderSheet("cancel");
    expect(text(html)).toContain(`${NAME} 님 접수를 취소할까요?`);
    expect(html).toContain("<b>고객에게 문자가 가지 않으니</b>");
    const submit = openTag(html, "admin-sheet-submit");
    expect(attr(submit, "data-variant")).toBe("destructive");
    expect(attr(submit, "class")).toBe(s.btnDestructive);
    expect(text(elementOf(html, "admin-sheet-submit"))).toBe("접수 취소하기");

    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(4);
    expect(new Set(radios.map((r) => attr(r, "name"))).size, "한 묶음(같은 name)").toBe(1);
    expect(radios.map((r) => attr(r, "value"))).toEqual([...CANCEL_REASONS]);
    expect(radios.some((r) => / checked=""/.test(r)), "사유는 기본으로 고르지 않는다").toBe(false);
    for (const label of ["고객 일정 변경", "차량을 못 구함", "연락이 안 됨", "기타"]) expect(text(html)).toContain(label);
    expect(html).toMatch(/<fieldset[\s\S]*<legend[\s\S]*<\/fieldset>/);
    expect(text(html)).toContain("고른 사유는 메모에 함께 남아요");
    expect(html).not.toContain('data-testid="admin-sheet-summary"');
  });

  test("취소 — 고른 사유는 checked 로 그려진다", async () => {
    const html = await renderSheet("cancel", { reason: "vehicle" });
    const checked = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]).filter((r) => / checked=""/.test(r));
    expect(checked.map((r) => attr(r, "value"))).toEqual(["vehicle"]);
  });

  test("운행 완료 — 요약 · [완료로 바꾸기](주 버튼) · 간편 한 줄은 없다", async () => {
    const html = await renderSheet("complete");
    expect(text(html)).toContain(`${NAME} 님 운행을 완료로 바꿀까요?`);
    expect(text(elementOf(html, "admin-sheet-submit"))).toBe(detail.sheet.completeSubmit);
    expect(attr(openTag(html, "admin-sheet-submit"), "data-variant")).toBe("primary");
    expect(text(zoneOf(html, "admin-sheet-summary"))).toBe("인천공항 → 서울 · 10월 1일 (목) · 30명");
  });

  test("실패 배너 — role=alert · 시트 안 · 실행 버튼은 다시 누를 수 있다", async () => {
    const html = await renderSheet("confirm", { sheetBanner: { kind: "failed" } });
    const banner = elementOf(html, "admin-sheet-banner");
    expect(attr(openTag(html, "admin-sheet-banner"), "role")).toBe("alert");
    expect(text(banner)).toBe(detail.result.failed);
    expect(html.indexOf('data-testid="admin-sheet-banner"')).toBeGreaterThan(html.indexOf('data-testid="admin-sheet-confirm"'));
    expect(attr(openTag(html, "admin-sheet-submit"), "disabled")).toBeNull();
  });

  test("이미 처리됨(잠김) — 배너 + 실행 버튼 비활성(같은 판정을 다시 보내지 않는다)", async () => {
    const html = await renderSheet("confirm", { sheetBanner: { kind: "alreadyHandled" }, sheetLocked: true });
    expect(text(elementOf(html, "admin-sheet-banner"))).toBe(detail.result.alreadyHandled);
    expect(attr(openTag(html, "admin-sheet-submit"), "disabled")).toBe("");
  });

  test("🔴 이미 처리됨(잠김) · 취소 시트 — 사유 라디오 4개도 비활성(리뷰 P1-1)", async () => {
    const html = await renderSheet("cancel", { sheetBanner: { kind: "alreadyHandled" }, sheetLocked: true });
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(4);
    for (const r of radios) expect(attr(r, "disabled"), attr(r, "value") ?? "").toBe("");
    expect(attr(openTag(html, "admin-sheet-submit"), "disabled")).toBe("");
    // 잠기지 않은 취소 시트의 라디오는 누를 수 있다
    const open = await renderSheet("cancel");
    for (const r of [...open.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0])) expect(attr(r, "disabled")).toBeNull();
  });

  test("상한 초과 배너 — 글자 수를 채워 보인다", async () => {
    const html = await renderSheet("cancel", { sheetBanner: { kind: "memoTooLong", count: 2021, max: 2000, withReason: true } });
    const msg = text(elementOf(html, "admin-sheet-banner"));
    expect(msg).toContain("2,000");
    expect(msg).toContain("2,021");
    expect(msg).not.toMatch(/\{(max|count)\}/);
  });

  test("처리 중 — 두 버튼 모두 비활성(두 번 누름 방지) · 처리 중 문구 · 늦음 안내 자리는 비어 있다", async () => {
    const html = await renderSheet("confirm", {}, { pending: true });
    expect(attr(openTag(html, "admin-sheet-submit"), "disabled")).toBe("");
    expect(attr(openTag(html, "admin-sheet-close"), "disabled")).toBe("");
    expect(text(elementOf(html, "admin-sheet-submit"))).toBe((await labels()).processing);
    const slowTag = openTag(html, "admin-sheet-slow");
    expect(attr(slowTag, "role")).toBe("status");
    expect(text(elementOf(html, "admin-sheet-slow"))).toBe("");
  });

  test("처리 중 N초가 지남(리뷰 P2-1) — [닫기]만 되살아나고 실행은 계속 막힌다 · 늦음 안내가 보인다", async () => {
    const html = await renderSheet("confirm", {}, { pending: true, slow: true });
    expect(attr(openTag(html, "admin-sheet-close"), "disabled")).toBeNull();
    expect(attr(openTag(html, "admin-sheet-submit"), "disabled")).toBe("");
    expect(text(elementOf(html, "admin-sheet-slow"))).toBe(detail.sheet.slow);
    // 처리 중이 끝나면(결과 도착) 늦음 안내도 사라진다
    const settled = await renderSheet("confirm", {}, { pending: false, slow: true });
    expect(text(elementOf(settled, "admin-sheet-slow"))).toBe("");
  });

  test("AdminSheet 단독 — 앞·설명·뒤 슬롯 순서와 설명 id 연결", () => {
    const html = renderToStaticMarkup(
      createElement(AdminSheet, {
        name: "probe",
        title: "T",
        before: createElement("p", { "data-testid": "slot-before" }, "B"),
        description: "D",
        after: createElement("p", { "data-testid": "slot-after" }, "A"),
        banner: null,
        closeLabel: "C",
        submitLabel: "S",
        processingLabel: "P",
        submitVariant: "primary",
        pending: false,
        slow: false,
        slowNote: "L",
        submitDisabled: false,
        onClose: () => {},
        onSubmit: () => {},
      }),
    );
    const iB = html.indexOf("slot-before");
    const iA = html.indexOf("slot-after");
    const descId = attr(openTag(html, "admin-sheet-probe"), "aria-describedby");
    const iD = html.indexOf(`id="${descId}"`);
    expect(iB).toBeGreaterThan(0);
    expect(iD).toBeGreaterThan(iB);
    expect(iA).toBeGreaterThan(iD);
    expect(attr(openTag(html, "admin-sheet-probe"), "tabindex")).toBe("-1");
  });
});

/** data-testid 요소 하나의 안쪽(같은 태그의 첫 닫는 태그까지 — 안에 같은 태그가 없는 요소 전용). */
function elementOf(html: string, testid: string): string {
  const tag = openTag(html, testid);
  const name = /^<([a-z0-9]+)/.exec(tag)![1];
  const start = html.indexOf(tag) + tag.length;
  return html.slice(start, html.indexOf(`</${name}>`, start));
}
const zoneOf = elementOf;

// =============================================================================
// 7. 정적 — 버튼이 컨트롤러에 어떻게 이어지는가 · 모달 접근성 배선 · 규약
// =============================================================================
describe("7. 정적 — 진입 버튼은 시트를 열 뿐이다 · 서버액션은 시트의 실행에서만", () => {
  const ui = codeOf(ACTIONS_UI);

  test("'use client' · 서버액션을 직접 부르지 않는다 — 네 이름은 import 와 액션 표에만 있다", () => {
    expect(read(ACTIONS_UI).split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    for (const name of ["confirmReservation", "cancelReservation", "completeReservation", "saveReservationMemo"]) {
      expect(ui, `${name}( 를 컴포넌트가 직접 부른다`).not.toMatch(new RegExp(`\\b${name}\\s*\\(`));
      expect(ui.match(new RegExp(`\\b${name}\\b`, "g"))?.length, `${name} — import 1 + 액션 표 1`).toBe(2);
    }
    expect(ui).toMatch(/panelController\(\{/);
  });

  /**
   * P5-22 — 진입 버튼은 처리 카드(ReservationProcess)·행동 바·위 제목줄의 SheetTrigger 로 옮겼다. 뜻은 그대로다: 누르면 **시트를 열기만** 한다.
   * 길: SheetTrigger 의 onClick → 채널(requestSheet) → 처리 영역의 채널 처리기 → openSheet(연 버튼 기억 + controller.open). 실행(commit)은 시트의 실행 버튼뿐.
   */
  test("진입 버튼(확정·완료·취소)은 시트를 열기만 한다", () => {
    const expected: Record<string, string> = { "admin-confirm": "confirm", "admin-complete": "complete", "admin-cancel": "cancel" };
    const process = codeOf("components/admin/ReservationProcess.tsx");
    for (const [testid, kind] of Object.entries(expected)) {
      const el = new RegExp(`<SheetTrigger\\b[^>]*testId="${testid}"[^>]*/>`).exec(process)?.[0] ?? "";
      expect(el, `${testid} 진입 버튼이 처리 카드에 없다`).not.toBe("");
      expect(el, testid).toMatch(new RegExp(`kind="${kind}"`));
    }
    const trigger = codeOf("components/admin/SheetTrigger.tsx");
    const onClick = /onClick=\{([^}]*)\}/.exec(trigger)?.[1] ?? "";
    expect(onClick).toMatch(/panelChannels\.requestSheet\(/);
    expect(onClick, "진입 버튼이 실행까지 한다").not.toMatch(/commit|saveMemo|Reservation|startTransition/);
    const handler = /channelOpen\.current = \(kind: SheetKind, opener: HTMLElement \| null\) => \{([\s\S]*?)\n {4}\};/.exec(ui)?.[1] ?? "";
    expect(handler).toMatch(/openSheet\(kind, opener\);/);
    expect(handler, "채널 처리기가 실행까지 한다").not.toMatch(/commit|saveMemo|Reservation\(|startTransition/);
    expect(ui).toMatch(/const openSheet = \(sheet: SheetKind, opener: HTMLElement\) => \{\s*openerRef\.current = opener;\s*controller\.open\(sheet\);\s*\};/);
    // 처리 영역 자신에는 진입 버튼이 없다(연결은 채널 하나)
    for (const testid of Object.keys(expected)) expect(ui).not.toContain(`data-testid="${testid}"`);
  });

  test("시트의 실행 버튼만 전이를 부른다 — 처리 중 표시 안에서(두 번 누름 방지)", () => {
    expect(ui).toMatch(/const submit = \(\) => startTransition\(\(\) => controller\.commit\(state\)\);/);
    expect(ui).toMatch(/const saveMemo = \(\) => startTransition\(\(\) => controller\.saveMemo\(state\)\);/);
    expect(ui).toMatch(/onSubmit=\{submit\}/);
    expect(ui).toMatch(/onClose=\{controller\.close\}/);
    // 기존 규약 유지 — 존재하는 전이만 · 처리 중 비활성 · role=status
    expect(ui).toMatch(/status === "new"/);
    expect(ui).toMatch(/status === "confirmed"/);
    expect(ui).toMatch(/disabled=\{pending\}/);
    // 결과 알림 자리(role=status) — P5-20 에서 토스트 부품을 관리자 전체로 넓혀(AdminToast.tsx) 그 부품이 자리를 그린다.
    expect(ui).toMatch(/<AdminToastRegion\b/);
    expect(codeOf("components/admin/AdminToast.tsx")).toMatch(/role="status"/);
  });

  test("시트 — 열면 닫기에 포커스 · 배경 inert(간편 견적 모달과 같은 함수) · 스크롤 잠금 · ESC · Tab 가둠 · 바깥 누르기", () => {
    const sheet = codeOf(SHEET_UI);
    expect(read(SHEET_UI).split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    expect(sheet).toMatch(/import \{ inertBackground \} from "@\/components\/quote\/quick-quote";/);
    expect(sheet).toMatch(/inertBackground\(backdrop, document\.body\)/);
    expect(sheet).toMatch(/closeRef\.current\?\.focus\(\)/);
    expect(sheet).toMatch(/body\.style\.overflow = "hidden"/);
    expect(sheet).toMatch(/e\.key === "Escape"/);
    expect(sheet).toMatch(/wrapFocus\(/);
    expect(sheet).toMatch(/document\.addEventListener\("keydown"/);
    expect(sheet).toMatch(/document\.removeEventListener\("keydown"/);
    expect(sheet).toMatch(/downOnBackdrop/);
    // 처리 중에는 닫히지 않는다(ESC·바깥·[닫기]) — 결과(실패 배너)가 도착할 자리를 지킨다.
    // 리뷰 P2-1: 단 N초(SHEET_STUCK_MS)가 지나도록 응답이 없으면 셋 다 되살린다 — 한 판정(sheetClosable)이 셋을 함께 다룬다.
    expect(sheet).toMatch(/const closable = sheetClosable\(pending, slow\);/);
    expect(sheet).toMatch(/if \(closable\) onClose\(\);/);
    expect(sheet).toMatch(/if \(fromBackdrop && closable\) onClose\(\);/);
    expect(sheet).toMatch(/className=\{s\.btnSecondary\} disabled=\{!closable\} onClick=\{onClose\}/);
    // 실행 버튼은 늦어져도 처리 중이면 막힌다 — 같은 판정을 두 번 보내지 않는다
    expect(sheet).toMatch(/disabled=\{pending \|\| submitDisabled\}/);
    // 닫기 버튼이 실행 버튼보다 먼저 — DOM 순서(첫 포커스 · Tab). 모양은 데스크톱 왼쪽, 휴대폰 맨 아래(P5-22 수정 라운드 P0-1)
    expect(sheet.indexOf('data-testid="admin-sheet-close"')).toBeLessThan(sheet.indexOf('data-testid="admin-sheet-submit"'));
  });

  test("늦음 타이머 — 처리 중이 시작되면 SHEET_STUCK_MS 뒤 slow, 처리 중이 끝나면 해제 (리뷰 P2-1)", () => {
    expect(ui).toMatch(/window\.setTimeout\(\(\) => setSlow\(true\), SHEET_STUCK_MS\)/);
    expect(ui).toMatch(/\}, \[pending\]\);/);
    expect(ui).toMatch(/slow=\{slow\}/);
  });

  test("잠긴 시트(이미 처리됨) — 실행 버튼과 사유 라디오를 막는 판정은 배너가 아니라 잠금이다 (리뷰 P1-1)", () => {
    expect(ui).toMatch(/submitDisabled=\{state\.sheetLocked\}/);
    expect(ui).toMatch(/disabled=\{pending \|\| state\.sheetLocked\}/);
    expect(ui, "배너 모양으로 버튼을 막으면 배너가 지워질 때 함께 풀린다").not.toMatch(/sheetBanner\?\.kind === "alreadyHandled"/);
    expect(codeOf(SHEET_LOGIC)).toMatch(/if \(state\.sheetLocked\) return;/);
  });

  test("포커스 복귀 — 닫히면 연 버튼으로, 바뀌었거나 연 버튼을 쓸 수 없으면(사라짐·처리 중 비활성) 처리 영역으로", () => {
    expect(ui).toMatch(/focusReturn\(state\.lastClose, opener !== null && opener\.isConnected && !opener\.matches\(":disabled"\)\)/);
    expect(ui).toMatch(/panelRef\.current\?\.focus\(\)/);
    expect(ui).toMatch(/opener\.focus\(\)/);
  });

  test("이름은 props 가 아니라 서버가 그린 요소에서 읽는다", () => {
    expect(ui).toMatch(/document\.getElementById\(CUSTOMER_NAME_ELEMENT_ID\)/);
    const props = /export function ReservationActions\(\{([^}]*)\}/.exec(ui)?.[1] ?? "";
    expect(props.split(",").map((p) => p.trim()).filter(Boolean).sort()).toEqual(["id", "initialMemo", "labels", "status", "summary"]);
    for (const pii of ["name", "phone", "email", "message", "customerName"]) {
      expect(new RegExp(`\\b${pii}\\??:`).test(/export interface ReservationActionsProps \{([\s\S]*?)\n\}/.exec(ui)?.[1] ?? ""), pii).toBe(false);
    }
  });

  test("한글 리터럴 0 · env 0 — 새 클라이언트 파일과 순수 모듈 (문구는 admin.* 카탈로그에서만)", () => {
    for (const rel of [ACTIONS_UI, SHEET_UI, SHEET_LOGIC, MEMO_LIB]) {
      const offenders = codeOf(rel)
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => HANGUL.test(l));
      expect(offenders, rel).toEqual([]);
      expect(codeOf(rel), rel).not.toMatch(/process\.env/);
    }
    // 라벨 도우미(서버)도 문구는 카탈로그 키로만 부른다
    expect(codeOf(LABELS_HELPER).split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });
});

// =============================================================================
// 8. CSS — 되돌릴 수 없는 버튼 면 · 글자 버튼 · 공지·팝업 격자(1-0)
// =============================================================================
/** 주석을 걷은 CSS 의 `선택자 { 본문 }` 쌍(가장 안쪽 블록). at-rule 안의 규칙도 그대로 나온다. */
function cssRules(css: string): { selector: string; body: string; media: string | null }[] {
  const out: { selector: string; body: string; media: string | null }[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const mediaRe = /@media([^{]+)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
  const medias: { start: number; end: number; query: string }[] = [];
  for (const m of stripped.matchAll(mediaRe)) medias.push({ start: m.index!, end: m.index! + m[0].length, query: m[1].trim() });
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith("@")) continue;
    const at = m.index!;
    const media = medias.find((x) => at > x.start && at < x.end)?.query ?? null;
    out.push({ selector: selector.replace(/^@media[^{]*/, "").trim(), body: m[2], media });
  }
  return out;
}
const decl = (body: string, prop: string): string | null => new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim() ?? null;

describe("8. CSS — 역할 토큰 · 글자 버튼 · 목록이 화면을 밀지 않는다", () => {
  const rules = cssRules(read(ADMIN_CSS));
  const rule = (selector: string, media: string | null = null) => rules.filter((r) => r.selector === selector && r.media === media);

  test("되돌릴 수 없는 버튼은 역할 토큰(--action-destructive-*)만 쓴다 · 긍정 버튼과 다른 면", () => {
    const d = rule(".btnDestructive");
    expect(d.length).toBeGreaterThan(0);
    const body = d.map((r) => r.body).join(";");
    expect(decl(body, "background")).toBe("var(--action-destructive-bg)");
    expect(decl(body, "color")).toBe("var(--action-destructive-fg)");
    expect(rules.some((r) => r.selector.includes(".btnDestructive:hover") && decl(r.body, "background") === "var(--action-destructive-bg-hover)")).toBe(true);
  });

  test("취소 진입은 글자 버튼 — 채운 면·테두리가 없다(주 버튼과 같은 크기의 면이 아니다)", () => {
    const body = rule(".btnText").map((r) => r.body).join(";");
    expect(body.length).toBeGreaterThan(0);
    expect(decl(body, "background")).toMatch(/^(none|transparent)$/);
    expect(decl(body, "border")).toMatch(/^(0|none)$/);
    const primary = rules.filter((r) => r.selector.split(",").map((x) => x.trim()).includes(".btnPrimary") && r.media === null).map((r) => r.body).join(";");
    expect(primary).toMatch(/background:\s*var\(--action-primary-bg\)/);
  });

  /**
   * P5-19(②-13) — 공지·팝업 목록 표의 최소 폭(.tablePopups 30rem)이 화면을 밀어 오른쪽 버튼이 `overflow-x:hidden` 에 **가려졌다.**
   * 그때는 두 칸 격자(.popupGrid)의 항목 최소 폭을 0 으로 막았다. P5-23 라운드 2(컨트롤러 B-5)에서 격자를 걷고 목록을 모든 폭에서 한 칸으로 두었으므로,
   * 같은 뜻(목록이 화면을 밀지 않는다 · 버튼이 늘 보인다)을 새 형태로 잠근다: 1024px 미만에서는 행이 카드가 되어 **표 최소 폭 자체가 없다.**
   */
  test("🔴 공지·팝업 목록이 화면을 밀지 않는다 — 1024px 미만은 카드(표 최소 폭 0 · 머리글 숨김) · 두 칸 격자 없음", () => {
    const NARROW = "(max-width: 1023.98px)";
    const at = (selector: string) =>
      rules
        .filter((r) => r.media === NARROW && r.selector.split(",").map((s) => s.trim()).includes(selector))
        .map((r) => r.body)
        .join(";");
    expect(decl(at(".contentTable"), "min-width"), "좁은 폭에서 표 최소 폭이 남아 있다").toBe("0");
    expect(decl(at(".contentTable"), "display")).toBe("block");
    expect(decl(at(".contentTable thead"), "display")).toBe("none");
    expect(decl(at(".contentWrap"), "overflow")).toBe("visible");
    // 버튼 칸은 카드의 한 줄 전체 — 보인다
    expect(decl(at('.contentTable td[data-cell="actions"]'), "flex")).toBe("1 1 100%");
    expect(rules.filter((r) => r.selector.includes(".popupGrid")), "두 칸 격자가 돌아왔다").toEqual([]);
  });

  test("늦음 안내 자리 — 늘 있지만(role=status) 비어 있으면 자리를 차지하지 않는다", () => {
    expect(rule(".sheetSlow").length).toBeGreaterThan(0);
    const empty = rule(".sheetSlow:empty").map((r) => r.body).join(";");
    expect(decl(empty, "margin")).toBe("0");
    expect(decl(rule(".sheetSlow").map((r) => r.body).join(";"), "color")).toBe("var(--text-secondary)");
  });

  test("시트·토스트는 역할 토큰으로 — 딤은 overlay, 토스트는 어두운 면", () => {
    const backdrop = rule(".sheetBackdrop").map((r) => r.body).join(";");
    expect(decl(backdrop, "background")).toBe("var(--overlay-medium)");
    expect(decl(backdrop, "position")).toBe("fixed");
    const toast = rule(".toast").map((r) => r.body).join(";");
    expect(decl(toast, "background")).toBe("var(--bg-inverse)");
    expect(decl(toast, "color")).toBe("var(--text-on-inverse)");
    const region = rule(".toastRegion").map((r) => r.body).join(";");
    expect(decl(region, "position")).toBe("fixed");
    expect(decl(region, "pointer-events")).toBe("none");
  });
});

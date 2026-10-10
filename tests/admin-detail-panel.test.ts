/**
 * P5-22 — 접수 상세 재배치: 처리 부품들(브리프 P5-22 §B · §C · 시안 docs/handoff/2026-09-27-admin-ux #detail · 제안서 ⑤-3).
 *
 * 이 파일이 잠그는 것 (화면 전체의 배치·개인정보 경계는 tests/admin-detail.test.ts)
 *   1. 순수 — 들어온 탭으로 돌아가는 주소(B-2 · `?from=` · `&page=` — 상태·쪽만) · 제목 틀("{name} 님") 나누기 · 상세 번호 표기 ·
 *      `sms:` · 접수 시각("오늘 09:35" · 날짜 · 해가 다르면 연도) · 운행 날짜 조각(해가 다르면 연도)
 *   2. 채널(components/admin/reservation-panel.ts) — 떨어진 진입 버튼(데스크톱 처리 카드 · 휴대폰 행동 바 · 위 제목줄 ⋯ · 맨 아래 취소)이
 *      처리 영역(ReservationActions) **하나**에 시트를 열어 달라고 한다. 붙은 처리 영역이 없거나 처리 중이면 아무 일도 없다.
 *   3. 진입 버튼(SheetTrigger) — 시트를 **열기만** 한다(서버액션 0) · 처리 중에는 disabled 대신 aria-disabled(P5-21 PendingButton)
 *   4. 처리 카드(ReservationProcess) — 확정(주 버튼) · 안내 · 구분선 · 취소(글자 버튼) · 안내 / 확정 상태면 운행 완료. 메모는 따로(시안).
 *      휴대폰 맨 아래 칸 — 취소(와 확정 상태면 운행 완료)만. 확정은 아래 고정 행동 바가 맡는다.
 *   5. 처리 영역(ReservationActions) — 메모 카드 · 메모 저장은 PendingButton · 진입 버튼은 여기 없다(채널로 연다).
 *      간편 접수의 "전화로 확인할 것" 점검표 카드(P5-22)는 **없다** — 사장님 요청 11(2026-10-10 · 결정 13: 카드와 확정 경고만 지우고
 *      운행 카드의 미정 칸 "전화로 확인" 은 남긴다). 체크 칸 · 진행 표시 · 옛 점검표 문구 · 카탈로그 키가 다시 들어오지 않게 잠근다.
 *   6. 확정 시트 — 점검표 확인 경고가 **없다**(요청 11) · 설명(aria-describedby)은 본문 하나 · 간편 접수 요약 한 줄(quickNote)은 남는다
 *
 * vitest 는 node 환경이다(DOM 패키지 없음 · 새 패키지 금지) — 컴포넌트는 renderToStaticMarkup 으로 첫 화면을, 배선은 소스 정적 검사로,
 * 채널은 순수 모듈을 그대로 불러 본다(P5-19 tests/admin-confirm-sheet.test.ts 와 같은 나눔). 실제 클릭·포커스는 브라우저 실측(보고서 ⑤).
 * tests/ 아래라 게이트 3종의 검사 대상이다 — 금지어·임시값 마커 리터럴을 쓰지 않는다. 이름·번호는 전부 가짜다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/actions/admin/reservation", () => ({
  confirmReservation: vi.fn(),
  cancelReservation: vi.fn(),
  completeReservation: vi.fn(),
  saveReservationMemo: vi.fn(),
}));
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

import { ReservationActions, ReservationSheet } from "@/components/admin/ReservationActions";
import { ReservationProcess } from "@/components/admin/ReservationProcess";
import { SheetTrigger } from "@/components/admin/SheetTrigger";
import s from "@/components/admin/admin.module.css";
import {
  dayParts,
  receivedAt,
  smsHref,
  splitNameTemplate,
} from "@/components/admin/reservation-detail";
// T2-4(2026-10-10 · 결정 12): 상세의 번호 표기 함수는 사장님 접수 알림 문자와 함께 쓰려고 lib 로 옮겼다(옛 이름 detailPhoneText). 단언은 그대로다.
import { domesticPhoneText as detailPhoneText } from "@/lib/phone-format";
import { MAX_LIST_PAGES, backToListHref, detailHref, listHref } from "@/components/admin/reservation-list";
import { IDLE_SNAPSHOT, PROCESS_REGION_ATTR, createPanelChannels, firstVisible } from "@/components/admin/reservation-panel";
import { getReservationActionLabels } from "@/components/admin/reservationActionLabels";
import * as sheetModule from "@/components/admin/reservation-sheet";
import {
  focusRescue,
  initialPanelState,
  type PanelState,
  type ReservationActionLabels,
  type ReservationSummary,
  type SheetKind,
} from "@/components/admin/reservation-sheet";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, Record<string, unknown>> };
const detail = ko.admin.detail as Record<string, unknown> & Record<string, string>;
const obj = (k: string) => detail[k] as unknown as Record<string, unknown>;
/** 정규식에 넣을 글자(useId 값 등)를 문자 그대로 읽게 한다. */
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ACTIONS_UI = "components/admin/ReservationActions.tsx";
const TRIGGER = "components/admin/SheetTrigger.tsx";
const PROCESS = "components/admin/ReservationProcess.tsx";
const CHANNEL = "components/admin/reservation-panel.ts";
const DETAIL_MODEL = "components/admin/reservation-detail.ts";
const SHEET_UI = "components/admin/AdminSheet.tsx";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
/** 기준 시각 — 2026-09-28(월) 10:00 KST. */
const NOW = new Date("2026-09-28T01:00:00.000Z");

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? null;
function openTag(html: string, testid: string): string {
  const at = html.indexOf(`data-testid="${testid}"`);
  expect(at, `${testid} 가 없다`).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}
/** 평평한 영역(`data-zone`) 하나의 안쪽 — 영역 안에는 div 가 없다(버튼·문단뿐). */
function zone(html: string, name: string): string {
  const m = new RegExp(`<div[^>]*data-zone="${name}"[^>]*>([\\s\\S]*?)</div>`).exec(html);
  expect(m, `data-zone="${name}" 영역이 없다`).not.toBeNull();
  return m![1];
}

let labelsCache: ReservationActionLabels | null = null;
async function labels(): Promise<ReservationActionLabels> {
  labelsCache ??= await getReservationActionLabels();
  return labelsCache;
}
/** 요약 상자 조각 — 페이지와 같은 날짜 표기(P5-22 수정 라운드 · 컨트롤러 결정). */
const QUICK: ReservationSummary = { parts: ["인천공항 → 서울", "10월 1일 (목)", "30명"], quick: true };
const WIZARD: ReservationSummary = { parts: ["서울 → 부산", "10월 1일 (목) 08:30"], quick: false };

/**
 * 사장님 요청 11 로 지운 점검표 카드 · 확정 경고의 옛 문구(P5-22 카탈로그 원문). 카탈로그 키가 없어졌으니 리터럴로 든다 —
 * 처리 영역·확정 시트 어디에도 다시 나오면 안 된다. 운행 카드의 미정 칸 "전화로 확인"(trip.undecided)은 남는 문구라 여기 없다
 * ("전화로 확인할 것" 은 그것을 포함하지만 그 반대는 아니다).
 */
const REMOVED_CHECKLIST_COPY = [
  "전화로 확인할 것",
  "차량 종류와 대수",
  "출발 시각과 타는 곳",
  "왕복인지 편도인지",
  "여행 목적 (예: 워크숍 · 가족 여행)",
  "체크는 저장되지 않아요",
  "확인한 내용은 아래 메모에 적어 두세요",
  "통화로 확인하셨나요",
] as const;

// =============================================================================
// 1. 순수 — 돌아가는 주소 · 제목 틀 · 번호 · 시각
// =============================================================================
describe("1. 순수 — 들어온 탭으로 돌아가기(B-2) · 제목 틀 · 번호 · 시각", () => {
  test("🔴 상세 주소 — uuid 경로 + 들어온 탭·쪽만(기본 탭 첫 쪽이면 쿼리 없음) · 다른 값은 싣지 않는다", () => {
    expect(detailHref(ID)).toBe(`/admin/reservations/${ID}`);
    expect(detailHref(ID, null)).toBe(`/admin/reservations/${ID}`);
    expect(detailHref(ID, { tab: "new", page: 1 })).toBe(`/admin/reservations/${ID}`);
    expect(detailHref(ID, { tab: "confirmed", page: 1 })).toBe(`/admin/reservations/${ID}?from=confirmed`);
    expect(detailHref(ID, { tab: "all", page: 3 })).toBe(`/admin/reservations/${ID}?from=all&page=3`);
    expect(detailHref(ID, { tab: "new", page: 2 })).toBe(`/admin/reservations/${ID}?page=2`);
  });

  test("🔴 '← 접수 목록' — 주소의 from·page 를 관대하게 읽어 **그 탭·그 쪽**으로(모르는 값은 기본 탭 첫 쪽 · 상한은 목록과 같다)", () => {
    expect(backToListHref(undefined)).toBe("/admin/reservations");
    expect(backToListHref({})).toBe("/admin/reservations");
    expect(backToListHref({ from: "confirmed" })).toBe("/admin/reservations?status=confirmed");
    expect(backToListHref({ from: "done", page: "2" })).toBe("/admin/reservations?status=done&page=2");
    expect(backToListHref({ page: "4" })).toBe("/admin/reservations?page=4");
    // 쓰레기값 — 기본 탭 · 첫 쪽(주소창 오타로 500 이 되지 않는다)
    expect(backToListHref({ from: "<script>", page: "-1" })).toBe("/admin/reservations");
    expect(backToListHref({ from: ["confirmed", "done"], page: ["2"] })).toBe("/admin/reservations");
    expect(backToListHref({ from: "all", page: "999" })).toBe(listHref("all", MAX_LIST_PAGES));
    // 되돌아가는 주소는 목록 주소 규칙 그대로(상태·쪽만) — 다른 키를 되울리지 않는다
    expect(backToListHref({ from: "cancelled", name: "예시", phone: "01000000000" } as Record<string, string>)).toBe("/admin/reservations?status=cancelled");
  });

  test("제목 틀 '{name} 님' 을 나눈다 — 이름은 페이지가 id 요소 안에 따로 그린다(시트가 그 글자를 읽는다)", () => {
    expect(splitNameTemplate("{name} 님")).toEqual({ before: "", after: " 님" });
    expect(splitNameTemplate("고객 {name} 님")).toEqual({ before: "고객 ", after: " 님" });
    // 틀이 아니면 이름만(지어내지 않는다)
    expect(splitNameTemplate("님")).toEqual({ before: "", after: "" });
    expect(splitNameTemplate({})).toEqual({ before: "", after: "" });
    expect(splitNameTemplate(undefined)).toEqual({ before: "", after: "" });
  });

  test("상세 번호 — 국내 휴대전화는 국내 표기(가리지 않음 · 상세는 전화를 거는 화면) · 그 밖은 저장값 그대로 · sms: 는 숫자와 + 만", () => {
    expect(detailPhoneText("+821012345678")).toBe("010-1234-5678");
    expect(detailPhoneText("+82101234567")).toBe("010-123-4567");
    expect(detailPhoneText("+15551234567")).toBe("+15551234567");
    expect(detailPhoneText("+8221234567")).toBe("+8221234567");
    expect(detailPhoneText("  +821055512345 ")).toBe("010-5551-2345");
    expect(smsHref("+821012345678")).toBe("sms:+821012345678");
    expect(smsHref("+1 555-123-4567")).toBe("sms:+15551234567");
    expect(smsHref("abc")).toBeNull();
    expect(smsHref("")).toBeNull();
  });

  test("접수 시각 — KST 오늘이면 시각만 · 올해면 월·일 · 해가 다르면 연도까지 · 읽을 수 없으면 null", () => {
    expect(receivedAt("2026-09-28T00:35:00.000Z", NOW)).toEqual({ kind: "today", hour: "09", minute: "35" });
    // UTC 로는 어제지만 KST 로는 오늘 00:10
    expect(receivedAt("2026-09-27T15:10:00.000Z", NOW)).toEqual({ kind: "today", hour: "00", minute: "10" });
    expect(receivedAt("2026-09-27T14:59:00.000Z", NOW)).toEqual({ kind: "date", month: 9, day: 27, hour: "23", minute: "59" });
    expect(receivedAt("2025-12-31T03:00:00.000Z", NOW)).toEqual({ kind: "year", year: 2025, month: 12, day: 31, hour: "12", minute: "00" });
    expect(receivedAt("nope", NOW)).toBeNull();
  });

  test("운행 날짜 조각 — KST 달력 · 요일 · 해가 다르면 연도를 붙인다", () => {
    expect(dayParts("2026-10-09T15:00:00.000Z", NOW)).toEqual({ year: 2026, month: 10, day: 10, weekday: 6, hour: "00", minute: "00", withYear: false });
    expect(dayParts("2027-01-02T01:30:00.000Z", NOW)).toMatchObject({ year: 2027, month: 1, day: 2, withYear: true, hour: "10", minute: "30" });
    expect(dayParts("x", NOW)).toBeNull();
  });

  test("순수 모듈 — React·Next·DB·env·한글 0", () => {
    for (const rel of [DETAIL_MODEL, CHANNEL]) {
      const src = codeOf(rel);
      expect(src, rel).not.toMatch(/from\s+"(next|react)[/"]|@\/lib\/supabase|server-only|process\.env/);
      expect(src.split("\n").filter((l) => HANGUL.test(l)), rel).toEqual([]);
    }
  });
});

// =============================================================================
// 2. 채널 — 떨어진 진입 버튼 → 처리 영역 하나
// =============================================================================
describe("2. 채널 — 진입 버튼은 처리 영역에 시트를 '열어 달라고'만 한다", () => {
  const el = (name: string) => ({ name }) as unknown as HTMLElement;

  test("🔴 붙은 처리 영역이 있으면 연다(종류 · 누른 버튼을 넘긴다) · 없으면 아무 일도 없다(false)", () => {
    const ch = createPanelChannels();
    expect(ch.requestSheet(ID, "confirm", el("bar"))).toBe(false);
    const open = vi.fn();
    const detach = ch.attach(ID, open);
    expect(ch.requestSheet(ID, "confirm", el("bar"))).toBe(true);
    expect(open).toHaveBeenCalledWith("confirm", el("bar"));
    // 다른 접수의 채널에는 닿지 않는다
    expect(ch.requestSheet("8c9e6679-7425-40de-944b-e07fc1f90ae8", "cancel", el("x"))).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    detach();
    expect(ch.requestSheet(ID, "cancel", el("more"))).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  test("🔴 처리 중에는 열지 않는다 · 구독자에게 알린다 · 같은 값이면 같은 스냅숏(useSyncExternalStore 규약)", () => {
    const ch = createPanelChannels();
    const open = vi.fn();
    ch.attach(ID, open);
    const heard = vi.fn();
    const off = ch.subscribe(ID, heard);
    expect(ch.snapshot(ID)).toBe(IDLE_SNAPSHOT);
    ch.setPending(ID, true);
    expect(heard).toHaveBeenCalledTimes(1);
    const busy = ch.snapshot(ID);
    expect(busy.pending).toBe(true);
    ch.setPending(ID, true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(ch.snapshot(ID)).toBe(busy);
    expect(ch.requestSheet(ID, "confirm", el("x"))).toBe(false);
    expect(open).not.toHaveBeenCalled();
    ch.setPending(ID, false);
    expect(ch.snapshot(ID)).toBe(IDLE_SNAPSHOT);
    expect(heard).toHaveBeenCalledTimes(2);
    off();
  });

  test("떼면 처리 중도 풀리고(남은 진입 버튼이 막힌 채 남지 않는다) · 옛 떼기가 새로 붙은 처리 영역을 떼지 않는다 · 비면 지운다", () => {
    const ch = createPanelChannels();
    const heard = vi.fn();
    const off = ch.subscribe(ID, heard);
    const first = vi.fn();
    const detachFirst = ch.attach(ID, first);
    ch.setPending(ID, true);
    detachFirst();
    expect(ch.snapshot(ID).pending).toBe(false);
    const second = vi.fn();
    const detachSecond = ch.attach(ID, second);
    detachFirst(); // 두 번 불려도(개발 모드 StrictMode 의 효과 두 번) 새것을 떼지 않는다
    expect(ch.requestSheet(ID, "cancel", el("x"))).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    detachSecond();
    off();
    expect(ch.size()).toBe(0);
  });

  test("처리 영역 찾기 — 보이는 첫 것(데스크톱 처리 카드 · 휴대폰 행동 바 중 지금 그려진 것)", () => {
    expect(PROCESS_REGION_ATTR).toBe("data-process-region");
    expect(firstVisible(["a", "b", "c"], (x) => x !== "a")).toBe("b");
    expect(firstVisible(["a"], () => false)).toBeNull();
  });
});

// =============================================================================
// 3. 진입 버튼 — 열기만 한다
// =============================================================================
describe("3. 진입 버튼(SheetTrigger) — 시트를 열기만 · 처리 중 포커스를 잃지 않는다", () => {
  test("마크업 — 주 버튼 · 글자 버튼(× 표시) · 아이콘 버튼(⋯ + 스크린리더 이름) · 처음에는 막혀 있지 않다", () => {
    const primary = renderToStaticMarkup(createElement(SheetTrigger, { id: ID, kind: "confirm", label: "확정하기", variant: "primary", testId: "t-confirm" }));
    const tag = openTag(primary, "t-confirm");
    expect(tag.startsWith("<button")).toBe(true);
    expect(attr(tag, "type")).toBe("button");
    expect(attr(tag, "class")).toBe(s.btnPrimary);
    expect(attr(tag, "data-variant")).toBe("primary");
    expect(attr(tag, "data-sheet")).toBe("confirm");
    expect(attr(tag, "disabled")).toBeNull();
    expect(attr(tag, "aria-disabled")).toBeNull();
    expect(text(primary)).toBe("확정하기");

    const cancel = renderToStaticMarkup(createElement(SheetTrigger, { id: ID, kind: "cancel", label: "이 접수 취소하기", variant: "text", testId: "t-cancel" }));
    expect(attr(openTag(cancel, "t-cancel"), "class")).toBe(s.btnText);
    expect(attr(openTag(cancel, "t-cancel"), "data-variant")).toBe("text");
    expect(cancel).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(text(cancel)).toBe("이 접수 취소하기");

    const more = renderToStaticMarkup(createElement(SheetTrigger, { id: ID, kind: "cancel", label: "더보기 — 접수 취소", variant: "icon", testId: "t-more" }));
    expect(attr(openTag(more, "t-more"), "class")).toBe(s.detailIconBtn);
    expect(more).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(more).toContain(`<span class="${s.srOnly}">더보기 — 접수 취소</span>`);
  });

  test("🔴 정적 — 'use client' · 누르면 채널에 '열어 달라'만(서버액션·실행·전이 0) · 처리 중은 PendingButton(aria-disabled) · 서버 스냅숏은 한가함 · 한글 0", () => {
    const src = codeOf(TRIGGER);
    expect(read(TRIGGER).split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    const onClick = /onClick=\{([^}]*)\}/.exec(src)?.[1] ?? "";
    expect(onClick).toMatch(/panelChannels\.requestSheet\(id, kind, /);
    expect(onClick).not.toMatch(/commit|saveMemo|Reservation|startTransition/);
    expect(src).not.toMatch(/@\/actions\//);
    expect(src).toMatch(/<PendingButton\b/);
    expect(src).toMatch(/useSyncExternalStore\(/);
    expect(src).toMatch(/\(\) => IDLE_SNAPSHOT/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    expect(src).not.toMatch(/process\.env/);
  });
});

// =============================================================================
// 4. 처리 카드 — 확정 · 구분선 · 취소 (메모는 따로)
// =============================================================================
describe("4. 처리 카드(ReservationProcess) — 데스크톱 오른쪽 · 휴대폰 맨 아래", () => {
  const card = async (status: "new" | "confirmed" | "done" | "cancelled") =>
    renderToStaticMarkup(createElement(ReservationProcess, { id: ID, status, labels: await labels(), layout: "card" }));
  const mobile = async (status: "new" | "confirmed" | "done" | "cancelled") =>
    renderToStaticMarkup(createElement(ReservationProcess, { id: ID, status, labels: await labels(), layout: "mobile" }));

  test("🔴 새 접수 — 확정(주 버튼) + '확정하면…' → 구분선 → 이 접수 취소하기(글자 버튼) + 안내 · 메모는 이 카드에 없다(시안: 메모는 본문 카드)", async () => {
    const html = await card("new");
    const l = await labels();
    const primary = zone(html, "primary");
    const cancel = zone(html, "cancel");
    expect(primary).toContain('data-testid="admin-confirm"');
    expect(text(primary)).toContain(l.confirmHint);
    expect(cancel).toContain('data-testid="admin-cancel"');
    expect(text(cancel)).toContain(l.cancelHint);
    const iConfirm = html.indexOf('data-testid="admin-confirm"');
    const iRule = html.indexOf("<hr");
    const iCancel = html.indexOf('data-testid="admin-cancel"');
    expect(iRule).toBeGreaterThan(iConfirm);
    expect(iCancel).toBeGreaterThan(iRule);
    expect(attr(openTag(html, "admin-confirm"), "data-variant")).toBe("primary");
    expect(attr(openTag(html, "admin-confirm"), "data-sheet")).toBe("confirm");
    expect(attr(openTag(html, "admin-cancel"), "data-variant")).toBe("text");
    expect(attr(openTag(html, "admin-cancel"), "data-sheet")).toBe("cancel");
    expect(html).not.toContain('id="admin-memo"');
    expect(html).not.toContain("admin-complete");
  });

  test("🔴 처리 영역 — 이름 붙은 묶음(제목 '처리' 로) · 포커스를 받을 수 있다(성공 뒤 포커스 자리) · 처리 영역 표식", async () => {
    const html = await card("new");
    const l = await labels();
    const region = openTag(html, "admin-reservation-actions");
    expect(attr(region, "role")).toBe("group");
    expect(attr(region, "tabindex")).toBe("-1");
    expect(attr(region, PROCESS_REGION_ATTR)).toBe("");
    const titleId = attr(region, "aria-labelledby");
    expect(titleId).toBeTruthy();
    expect(text(new RegExp(`<h2[^>]*id="${titleId}"[^>]*>([\\s\\S]*?)</h2>`).exec(html)![1])).toBe(l.panel);
  });

  test("확정 — 운행 완료(주 버튼) + 안내 → 구분선 → 취소 · 확정 버튼 없음", async () => {
    const html = await card("confirmed");
    const l = await labels();
    expect(zone(html, "primary")).toContain('data-testid="admin-complete"');
    expect(text(zone(html, "primary"))).toContain(l.completeHint);
    expect(attr(openTag(html, "admin-complete"), "data-sheet")).toBe("complete");
    expect(zone(html, "cancel")).toContain('data-testid="admin-cancel"');
    expect(html).not.toContain('data-testid="admin-confirm"');
  });

  test("운행 완료·취소 — 누를 것이 없다 · 더 처리할 일이 없다는 한 줄(처리 영역은 그대로 — 포커스 자리)", async () => {
    const l = await labels();
    for (const [status, line] of [
      ["done", l.processDone],
      ["cancelled", l.processCancelled],
    ] as const) {
      const html = await card(status);
      for (const id of ["admin-confirm", "admin-complete", "admin-cancel"]) expect(html, `${status}:${id}`).not.toContain(`data-testid="${id}"`);
      expect(html).not.toContain("<hr");
      expect(text(html)).toContain(line);
      expect(html).toContain('data-testid="admin-reservation-actions"');
    }
  });

  test("🔴 휴대폰 맨 아래 — 새 접수는 취소 글자 버튼만(확정은 아래 고정 행동 바) · 확정이면 운행 완료 + 취소 · 끝난 접수는 그리지 않는다", async () => {
    const neu = await mobile("new");
    expect(neu).toContain('data-testid="admin-cancel-mobile"');
    expect(neu).not.toContain("admin-confirm");
    expect(attr(openTag(neu, "admin-cancel-mobile"), "data-variant")).toBe("text");
    expect(attr(openTag(neu, "admin-cancel-mobile"), "data-sheet")).toBe("cancel");
    expect(neu).not.toContain(PROCESS_REGION_ATTR);
    const conf = await mobile("confirmed");
    const iComplete = conf.indexOf('data-testid="admin-complete-mobile"');
    const iCancel = conf.indexOf('data-testid="admin-cancel-mobile"');
    expect(iComplete).toBeGreaterThanOrEqual(0);
    expect(iCancel).toBeGreaterThan(iComplete);
    // 시트 종류까지(리뷰 P2-6) — 운행 완료 진입은 완료 시트, 취소 진입은 취소 시트를 연다
    expect(attr(openTag(conf, "admin-complete-mobile"), "data-sheet")).toBe("complete");
    expect(attr(openTag(conf, "admin-complete-mobile"), "data-variant")).toBe("primary");
    expect(attr(openTag(conf, "admin-cancel-mobile"), "data-sheet")).toBe("cancel");
    expect(conf).toContain("<hr");
    for (const status of ["done", "cancelled"] as const) expect(await mobile(status), status).toBe("");
  });

  test("정적 — 서버 부품(훅·'use client' 없음) · 받는 것은 uuid·상태·라벨·모양뿐(개인정보 0) · 한글 0", () => {
    const src = codeOf(PROCESS);
    expect(read(PROCESS).split("\n")[0]).not.toMatch(/use client/);
    expect(src).not.toMatch(/\buse(State|Effect|LayoutEffect|Ref|Memo|Callback|Transition|SyncExternalStore)\(/);
    const props = /export function ReservationProcess\(\{([^}]*)\}/.exec(src)?.[1] ?? "";
    expect(props.split(",").map((p) => p.trim()).filter(Boolean).sort()).toEqual(["id", "labels", "layout", "status"]);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });
});

// =============================================================================
// 5. 처리 영역 — 체크리스트 · 메모 카드
// =============================================================================
describe("5. 처리 영역(ReservationActions) — 메모 카드 · 진입 버튼은 여기 없다 · '전화로 확인할 것' 점검표 카드도 없다(요청 11)", () => {
  const render = async (status: "new" | "confirmed" | "done" | "cancelled", summary: ReservationSummary = QUICK, memo = "") =>
    renderToStaticMarkup(createElement(ReservationActions, { id: ID, status, initialMemo: memo, summary, labels: await labels() }));

  /**
   * 사장님 요청 11(2026-10-10) — P5-22 의 점검표 카드는 간편 접수의 새 접수에서만 보였다. 그 경우를 포함해 **어느 상태·접수 방식에서도**
   * 체크 칸 · 진행 표시 · 옛 점검표 문구가 없어야 한다. 메모 카드가 처리 영역의 첫 카드다(점검표가 그 앞에 서던 자리).
   */
  test("🔴 요청 11 — 간편 접수 · 새 접수에도(옛 카드가 보이던 유일한 경우) 점검표가 없다: 체크 칸 0 · 진행 표시 0 · 옛 문구 0 · 메모 카드가 첫 카드", async () => {
    const cases = [
      ["new", QUICK],
      ["new", WIZARD],
      ["confirmed", QUICK],
      ["done", QUICK],
      ["cancelled", QUICK],
    ] as const;
    for (const [status, summary] of cases) {
      const html = await render(status, summary);
      const where = `${status}/${summary.quick ? "quick" : "wizard"}`;
      expect(html.match(/<input[^>]*type="checkbox"/g) ?? [], `${where}: 체크 칸`).toEqual([]);
      for (const id of ["admin-checklist", "admin-check-progress", "admin-check-0"]) {
        expect(html, `${where}: ${id}`).not.toContain(`data-testid="${id}"`);
      }
      const t = text(html);
      for (const line of REMOVED_CHECKLIST_COPY) expect(t, `${where}: ${line}`).not.toContain(line);
      // 처리 영역이 그리는 첫 카드는 메모 카드다
      expect(html.indexOf("<section"), where).toBe(html.indexOf(openTag(html, "admin-memo-card")));
    }
  });

  test("🔴 카탈로그 · 라벨 — admin.detail.checklist · sheet.checkWarning 이 없다(죽은 문구를 남기지 않는다) · 남기는 것: 미정 칸 '전화로 확인' · 확정 시트 요약의 간편 접수 한 줄(결정 13)", async () => {
    expect(Object.keys(detail)).not.toContain("checklist");
    expect(Object.keys(obj("sheet"))).not.toContain("checkWarning");
    const l = await labels();
    expect(Object.keys(l)).not.toContain("checklist");
    expect(Object.keys(l.sheet)).not.toContain("checkWarning");
    // 결정 13 — 지우는 것은 카드와 확정 경고뿐이다
    expect((obj("trip") as Record<string, string>).undecided).toBe("전화로 확인");
    expect(l.sheet.quickNote).toBe("간편 접수 — 차량·시각은 통화로 정한 대로");
  });

  test("🔴 정적 — 처리 영역·라벨 조립에 점검표의 흔적이 없다(체크 상태 · checkbox · 체크 수 판정 · checklist 라벨)", () => {
    const ui = codeOf(ACTIONS_UI);
    expect(ui).not.toMatch(/checklist|checkbox|countChecked|sheetCheckWarning|checkWarning/i);
    expect(ui).not.toMatch(/useState<boolean\[\]>/);
    expect(codeOf("components/admin/reservationActionLabels.tsx")).not.toMatch(/checklist|checkWarning/i);
    expect(codeOf("components/admin/reservation-sheet.ts")).not.toMatch(/checklist|checkWarning|countChecked/i);
  });

  test("🔴 메모 카드 — 제목(관리자 메모 = 칸 이름) · P5-19 안내 · 상한 · 예시 자리글 · [메모 저장]은 PendingButton(처리 중 aria-disabled)", async () => {
    const html = await render("new", QUICK, "기존 메모");
    const l = await labels();
    const card = openTag(html, "admin-memo-card");
    expect(attr(card, "tabindex")).toBe("-1");
    expect(html).toMatch(/<h2[^>]*>\s*<label[^>]*for="admin-memo"[^>]*>/);
    expect(text(html)).toContain(l.memoHint);
    const ta = openTag(html, "admin-memo");
    expect(attr(ta, "maxLength")).toBe("2000");
    expect(attr(ta, "placeholder")).toBe(l.memoPlaceholder);
    expect(html).toContain("기존 메모");
    const save = openTag(html, "admin-memo-save");
    expect(save.startsWith("<button")).toBe(true);
    expect(attr(save, "disabled")).toBeNull();
    expect(codeOf(ACTIONS_UI)).toMatch(/<PendingButton[^>]*pending=\{pending\}[^>]*onClick=\{saveMemo\}[^>]*testId="admin-memo-save"/);
  });

  test("🔴 진입 버튼(확정·완료·취소)은 처리 영역에 없다 — 처리 카드·행동 바·⋯ 가 채널로 연다", async () => {
    for (const status of ["new", "confirmed"] as const) {
      const html = await render(status);
      for (const id of ["admin-confirm", "admin-complete", "admin-cancel"]) expect(html, `${status}:${id}`).not.toContain(`data-testid="${id}"`);
    }
  });

  test("🔴 정적 — 채널에 붙는다(효과) · 처리 중을 알린다(레이아웃 효과) · 채널 요청은 허용된 전이·처리 중 아님·시트 닫힘일 때만 openSheet", () => {
    const ui = codeOf(ACTIONS_UI);
    expect(ui).toMatch(/panelChannels\.attach\(id, /);
    expect(ui).toMatch(/useLayoutEffect\(\(\) => \{\s*panelChannels\.setPending\(id, pending\);\s*\}, \[id, pending\]\);/);
    const handler = /channelOpen\.current = \(kind: SheetKind, opener: HTMLElement \| null\) => \{([\s\S]*?)\n {4}\};/.exec(ui)?.[1] ?? "";
    expect(handler.length, "채널 요청 처리기가 없다").toBeGreaterThan(0);
    expect(handler).toMatch(/if \(pending \|\| state\.sheet !== null \|\| opener === null \|\| !canOpen\(kind\)\) return;/);
    expect(handler).toMatch(/openSheet\(kind, opener\);/);
    expect(handler).not.toMatch(/commit|saveMemo|Reservation\(|startTransition/);
    // 허용된 전이 = 존재하는 전이뿐(P5-19 규약 그대로)
    expect(ui).toMatch(/const canConfirm = status === "new";/);
    expect(ui).toMatch(/const canCancel = status === "new" \|\| status === "confirmed";/);
    expect(ui).toMatch(/const canComplete = status === "confirmed";/);
    // 성공 뒤 포커스 — 보이는 처리 영역(데스크톱 카드 · 휴대폰 행동 바), 없으면 메모 카드
    expect(ui).toMatch(/firstVisible\(/);
    expect(ui).toMatch(/PROCESS_REGION_ATTR/);
    expect(ui).toMatch(/panelRef\.current\?\.focus\(\)/);
  });

  /**
   * 수정 라운드(리뷰 P2-3) — 15초 탈출(처리 중 [닫기])로 포커스를 연 버튼(aria-disabled)에 돌려놓았는데, 늦게 온 결과(성공 · 이미 처리됨)의
   * 새로고침이 그 버튼을 없애면 포커스가 <body> 로 빠졌다(리뷰 실측 D: 늦은 성공 · 늦은 이미 처리됨 → "BODY"). 보이는 처리 영역으로 옮긴다.
   * 버튼이 남으면(늦은 실패) 그대로 · 사장님이 이미 다른 곳을 누르고 있으면 건드리지 않는다.
   */
  test("🔴 늦은 결과 뒤 포커스 구하기 — 판정(순수): 연 버튼이 사라지고 포커스가 빠졌으면 구한다 · 버튼이 남았으면 기다린다 · 다른 곳에 있으면 놓는다", () => {
    expect(focusRescue(null, true)).toBe("drop");
    // 늦은 성공·이미 처리됨 — 새로고침이 버튼을 없앴고 포커스가 body 로
    expect(focusRescue({ connected: false, focused: false }, true)).toBe("rescue");
    // 버튼이 없어졌지만 사장님이 다른 곳에 포커스를 두었다 — 건드리지 않고 놓는다
    expect(focusRescue({ connected: false, focused: false }, false)).toBe("drop");
    // 버튼이 아직 있다(결과를 기다리는 중 · 늦은 실패) — 버튼에 있거나 빠져 있어도 기다린다
    expect(focusRescue({ connected: true, focused: true }, false)).toBe("wait");
    expect(focusRescue({ connected: true, focused: false }, true)).toBe("wait");
    // 버튼은 있는데 포커스가 다른 곳(사장님이 옮김) — 놓는다
    expect(focusRescue({ connected: true, focused: false }, false)).toBe("drop");
  });

  test("🔴 정적 — 처리 중에 닫아 연 버튼으로 돌려놓았으면 기억한다 · 매 렌더 뒤 판정해 구할 때는 보이는 처리 영역으로(없으면 메모 카드) · 새 시트를 열면 잊는다", () => {
    const ui = codeOf(ACTIONS_UI);
    // 처리 중 여부 — 레이아웃 효과로 ref 에(닫힘 효과가 읽는다)
    expect(ui).toMatch(/useLayoutEffect\(\(\) => \{\s*pendingRef\.current = pending;\s*\}, \[pending\]\);/);
    // 닫힘 효과 — 연 버튼으로 돌려놓을 때 처리 중이었으면 기억
    expect(ui).toMatch(/opener\.focus\(\);\s*heldOpenerRef\.current = pendingRef\.current \? opener : null;/);
    // 구하기 효과(의존성 없음 — 새로고침으로 다시 그려질 때마다)
    const effect = /useEffect\(\(\) => \{\s*const held = heldOpenerRef\.current;([\s\S]*?)\n {2}\}\);/.exec(ui)?.[1] ?? "";
    expect(effect.length, "구하기 효과가 없다").toBeGreaterThan(0);
    expect(effect).toMatch(/focusRescue\(\{ connected: held\.isConnected, focused: active === held \}, active === null \|\| active === document\.body\)/);
    expect(effect).toMatch(/if \(decision === "wait"\) return;\s*heldOpenerRef\.current = null;\s*if \(decision === "rescue"\) \(visibleProcessRegion\(\) \?\? panelRef\.current\)\?\.focus\(\);/);
    // 새 시트가 열리면 옛 기억은 버린다(닫힘 효과의 열림 가지)
    expect(ui).toMatch(/if \(state\.sheet !== null\) \{\s*wasOpenRef\.current = true;\s*heldOpenerRef\.current = null;\s*return;\s*\}/);
  });
});

// =============================================================================
// 6. 확정 시트의 확인 경고
// =============================================================================
describe("6. 확정 시트 — 점검표 확인 경고가 없다(요청 11) · 설명은 본문 하나 · 간편 접수 요약 한 줄은 남는다", () => {
  async function renderSheet(sheet: SheetKind, summary: ReservationSummary = QUICK, patch: Partial<PanelState> = {}) {
    const state: PanelState = { ...initialPanelState(""), sheet, customerName: "예시고객가", ...patch };
    return renderToStaticMarkup(
      createElement(ReservationSheet, {
        sheet,
        state,
        labels: await labels(),
        summary,
        pending: false,
        slow: false,
        onClose: () => {},
        onSubmit: () => {},
        onPickReason: () => {},
      }),
    );
  }
  const sheetKo = () => obj("sheet") as Record<string, string>;

  /** 대화상자의 설명 id 들과, 그 id 가 가리키는 요소의 글자. */
  function descriptions(html: string, name: SheetKind): { ids: string[]; texts: string[] } {
    const dialog = openTag(html, `admin-sheet-${name}`);
    const ids = (attr(dialog, "aria-describedby") ?? "").split(" ").filter(Boolean);
    const texts = ids.map((id) => {
      const m = new RegExp(`<(\\w+)[^>]*\\sid="${esc(id)}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
      expect(m, `설명 id ${id} 의 요소가 없다`).not.toBeNull();
      return text(m![2]);
    });
    return { ids, texts };
  }

  test("🔴 간편 접수 확정 시트(옛 경고가 뜨던 자리) — 경고 상자 0 · 옛 경고 문구 0 · 설명은 확정 본문 하나 · 요약 바로 뒤가 본문 · 요약에 간편 접수 한 줄 · 실행 버튼은 막히지 않는다", async () => {
    const html = await renderSheet("confirm");
    expect(html).not.toContain("admin-sheet-check-warning");
    const t = text(html);
    for (const line of REMOVED_CHECKLIST_COPY) expect(t, line).not.toContain(line);
    const { ids, texts } = descriptions(html, "confirm");
    expect(ids).toHaveLength(1);
    expect(texts).toEqual([sheetKo().confirmBody]);
    // 요약 상자가 닫히자마자 본문 — 그 사이에 끼는 상자가 없다
    const summaryOpen = openTag(html, "admin-sheet-summary");
    const afterSummary = html.slice(html.indexOf(summaryOpen));
    expect(afterSummary).toMatch(new RegExp(`^<p[^>]*>[\\s\\S]*?</p><p id="${esc(ids[0])}"`));
    expect(text(/<p[^>]*data-testid="admin-sheet-summary"[^>]*>([\s\S]*?)<\/p>/.exec(html)![1])).toContain(sheetKo().quickNote);
    expect(attr(openTag(html, "admin-sheet-submit"), "disabled")).toBeNull();
  });

  test("상세 접수 확정 · 취소 · 완료 시트 — 경고 없음 · 설명은 본문 하나(P5-19 그대로)", async () => {
    for (const [name, summary, body] of [
      ["confirm", WIZARD, sheetKo().confirmBody],
      ["cancel", QUICK, null],
      ["complete", QUICK, sheetKo().completeBody],
    ] as const) {
      const html = await renderSheet(name, summary);
      expect(html, name).not.toContain("admin-sheet-check-warning");
      const { ids, texts } = descriptions(html, name);
      expect(ids, name).toHaveLength(1);
      if (body !== null) expect(texts, name).toEqual([body]);
    }
  });

  test("🔴 정적 — ReservationSheet 는 점검표를 받지 않고 추가 설명 id 를 넘기지 않는다 · 시트 모듈은 체크 판정을 내보내지 않는다 · 경고·점검표 CSS 는 지웠다 · AdminSheet 의 추가 설명 규약은 그대로", () => {
    const ui = codeOf(ACTIONS_UI);
    const props = /export function ReservationSheet\(\{([^}]*)\}/.exec(ui)?.[1] ?? "";
    expect(props.split(",").map((p) => p.trim()).filter(Boolean).sort()).toEqual([
      "labels",
      "onClose",
      "onPickReason",
      "onSubmit",
      "pending",
      "sheet",
      "slow",
      "state",
      "summary",
    ]);
    expect(ui).not.toMatch(/describedBy=/);
    const exported = Object.keys(sheetModule);
    for (const name of ["sheetCheckWarning", "countChecked"]) expect(exported, name).not.toContain(name);
    const css = read("components/admin/admin.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const cls of ["sheetWarn", "sheetWarnIcon", "callChecklist", "callCheck", "callCheckInput", "callCheckText", "cardAside"]) {
      expect(css, cls).not.toMatch(new RegExp(`\\.${cls}(?![\\w-])`));
    }
    // AdminSheet 의 추가 설명 id 는 범용 규약으로 남는다(지금 쓰는 곳은 없다 — 쓰지 않으면 설명은 본문 하나)
    expect(codeOf(SHEET_UI)).toMatch(/aria-describedby=\{describedBy \? `\$\{describedBy\} \$\{descId\}` : descId\}/);
  });
});

// =============================================================================
// 7. 한글 리터럴 0 — 새·바뀐 클라이언트 파일
// =============================================================================
describe("7. 클라이언트 파일 — 한글 리터럴 0 · env 0", () => {
  test("ReservationActions · SheetTrigger · AdminSheet · 채널 — 문구는 admin.detail 카탈로그에서만", () => {
    for (const rel of [ACTIONS_UI, TRIGGER, SHEET_UI, CHANNEL]) {
      const offenders = codeOf(rel)
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => HANGUL.test(l));
      expect(offenders, rel).toEqual([]);
      expect(codeOf(rel), rel).not.toMatch(/process\.env/);
    }
  });
});

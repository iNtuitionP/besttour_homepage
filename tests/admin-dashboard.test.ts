/**
 * P5-21 — 관리 홈 대시보드 `/admin` (브리프 P5-21 §A · B-2 · C · 시안 docs/handoff/2026-09-27-admin-ux #home · 제안서 ⑤-1 · ⑦ 1-1).
 *
 * 이 파일이 잠그는 것
 *   1. 카드 4장의 값 정의 — 새 접수 = 배지와 **같은 함수**(countNewReservations) · 답이 늦은 접수 = 새 접수 중 72시간이 **넘은** 것
 *      (배지·0022 와 같은 경계) · 문자 발송 = **최근 7일 고객 문자 실패**(getHomeSendAlerts — 수정 라운드 · 컨트롤러 결정 P1-2) ·
 *      이번 주 운행 = 확정 중 출발이 KST 오늘 00:00 ~ 7일 뒤 00:00(오늘 새벽 출발도 들어간다 · 날짜 줄은 창 안의 모든 운행에서 — 리뷰 P2-2)
 *   2. 실패 — 조회 하나가 실패하면 그 카드(줄)만 "지금은 불러오지 못했어요" — 모르는 것을 "0건"·"이상 없음" 이라 하지 않는다
 *   3. 배너 — 최근 7일 고객 문자 실패가 있을 때만 하나(role=alert · 기간을 문장에 적는다 · 발송 기록 링크). 사장님 쪽 알림 실패·8일 이상 된
 *      실패·모름은 배너가 아니다(사장님 쪽은 카드의 작은 줄로만)
 *   4. 새 접수 미리보기(목록과 같은 행 · 오래 기다린 순 · 최대 5) · 다가오는 운행(날짜별 · 간편은 "시각 미정"·"차량 미정") ·
 *      홈페이지 점검(허브와 같은 조회·같은 말 · 금액은 **있는지만** 센다) · 이번 달 접수·확정(통계 화면과 같은 기간 정의)
 *   5. 게이트 — 첫 문장 `await requireAdmin()` · 조회는 전부 그 뒤에 동시에(admin-speed 4-b 와 같은 문)
 *   6. 두 숫자 금지(리뷰 P2-10) — 메뉴 배지를 이 화면의 조회 결과로 맞춘다(클라이언트 상태 · 더 새 쪽이 이긴다)
 *   7. 셸 — 휴대폰 위 제목줄 고정(관리자 셸에만 overflow-x: clip · 공개 사이트 전역 규칙은 그대로) · 메뉴 이름 "발송 기록"
 *
 * 화면은 서버 컴포넌트를 그대로 그리고, 조회 함수만 가짜로 바꾼다. 시각은 Date 만 고정한다(타이머는 진짜).
 * tests/ 아래라 게이트 3종의 검사 대상이다 — 금지어·임시값 마커 리터럴을 쓰지 않는다. 이름·번호는 전부 가짜다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })) }));
vi.mock("@/lib/supabase/ssr", () => ({ createSsrClient: vi.fn() }));
vi.mock("@/lib/auth/requireAdmin", () => ({ requireAdmin: vi.fn(async () => ({ userId: "test", email: "e" })) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => "/admin" }));
vi.mock("@/lib/queries", () => ({
  getVehicles: vi.fn(async () => [{ id: 1, slug: "bus28", nameKo: "28인승 우등", nameEn: "28", capacity: 28, sort: 1, active: true }]),
}));
vi.mock("@/lib/admin/reservations", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/admin/reservations")>();
  return {
    ...mod,
    listReservations: vi.fn(),
    countNewReservations: vi.fn(),
    countNewByIntake: vi.fn(),
    countOverdueNew: vi.fn(),
    countConfirmedDeparting: vi.fn(),
    listConfirmedDeparting: vi.fn(),
    listConfirmedDepartDates: vi.fn(),
    countCreatedBetween: vi.fn(),
  };
});
vi.mock("@/lib/admin/notifications", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/admin/notifications")>();
  return { ...mod, getNotificationSummary: vi.fn(), getHomeSendAlerts: vi.fn() };
});
vi.mock("@/lib/admin/popups", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/admin/popups")>();
  return { ...mod, listAdminPopups: vi.fn() };
});
vi.mock("@/lib/admin/notices", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/admin/notices")>();
  return { ...mod, listAdminNotices: vi.fn() };
});
vi.mock("@/lib/admin/routes", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/admin/routes")>();
  return { ...mod, listAdminRoutes: vi.fn() };
});
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

import AdminHomePage from "@/app/admin/(protected)/page";
import { homeLede, monthWindow, newSplit, overdueCutoff, sendBanner, sendCard, tripDays, tripDatesLine, upcomingWindow } from "@/components/admin/dashboard";
import { NavBadgeReport } from "@/components/admin/NavBadgeReport";
import { BACKLOG_HOURS, isOverdue } from "@/components/admin/status-badge";
import { navBadge, pickNavBadge } from "@/components/admin/tabs";
import { listAdminNotices } from "@/lib/admin/notices";
import { SUMMARY_WINDOW_HOURS, getHomeSendAlerts } from "@/lib/admin/notifications";
import { listAdminPopups } from "@/lib/admin/popups";
import {
  countConfirmedDeparting,
  countCreatedBetween,
  countNewByIntake,
  countNewReservations,
  countOverdueNew,
  listConfirmedDepartDates,
  listConfirmedDeparting,
  listReservations,
  type ReservationListRow,
} from "@/lib/admin/reservations";
import { ALL_TEMPLATE_KEYS } from "@/lib/notify/outbox";
import { listAdminRoutes } from "@/lib/admin/routes";
import { statsRange } from "@/lib/admin/stats";
import { toKstDateString } from "@/lib/kst";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, Record<string, unknown>> };
const home = ko.admin.home as Record<string, unknown> & Record<string, string>;
const homeObj = (k: string) => home[k] as unknown as Record<string, string>;
const hub = ko.admin.hub as Record<string, Record<string, string> & string>;
const notifyKo = ko.admin.notifications as Record<string, Record<string, string>>;
const dates = ko.admin.dates as Record<string, unknown>;
const res = ko.admin.reservations as Record<string, unknown> & Record<string, string>;
const fill = (tpl: string, v: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k]));
const weekday = (i: number) => (dates.weekdays as string[])[i];

const HOME = "app/admin/(protected)/page.tsx";
const DASH = "components/admin/dashboard.ts";
const REPORT = "components/admin/NavBadgeReport.tsx";

const HOUR = 3_600_000;
/** 기준 시각 — 2026-09-28(월) 10:00 KST. */
const NOW = new Date("2026-09-28T01:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const fulfilled = <T,>(value: T): PromiseSettledResult<T> => ({ status: "fulfilled", value });
const rejected = <T,>(): PromiseSettledResult<T> => ({ status: "rejected", reason: new Error("x") });

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? null;
const links = (h: string) =>
  [...h.matchAll(/<a\s[^>]*>[\s\S]*?<\/a>/g)].map((m) => ({ tag: /^<a\s[^>]*>/.exec(m[0])![0], href: (attr(m[0], "href") ?? "").replace(/&amp;/g, "&"), text: text(m[0]) }));
/** 할 일 카드 — data-card 로 찾는다(카드 전체가 링크). */
function card(html: string, key: string) {
  const m = new RegExp(`<a[^>]*data-card="${key}"[^>]*>[\\s\\S]*?</a>`).exec(html);
  expect(m, `카드 ${key} 가 없다`).not.toBeNull();
  return { tag: /^<a[^>]*>/.exec(m![0])![0], text: text(m![0]), html: m![0] };
}
function checkRow(html: string, key: string) {
  const m = new RegExp(`<li[^>]*data-check="${key}"[^>]*>[\\s\\S]*?</li>`).exec(html);
  expect(m, `점검 줄 ${key} 가 없다`).not.toBeNull();
  return { tag: /^<li[^>]*>/.exec(m![0])![0], text: text(m![0]), links: links(m![0]) };
}

// =============================================================================
// 1. 순수 — 값 정의
// =============================================================================
describe("1. 순수 — 기간 · 경계", () => {
  test("🔴 이번 주 운행 창 = KST 오늘 00:00 ~ 7일 뒤 00:00 (UTC 날짜가 전날인 새벽에도 KST 날짜로)", () => {
    expect(upcomingWindow(NOW)).toEqual({ from: "2026-09-27T15:00:00.000Z", to: "2026-10-04T15:00:00.000Z" });
    // KST 09-28 00:30 = UTC 09-27 15:30 — UTC 로 자르면 하루 밀린다
    expect(upcomingWindow(new Date("2026-09-27T15:30:00.000Z"))).toEqual({ from: "2026-09-27T15:00:00.000Z", to: "2026-10-04T15:00:00.000Z" });
    // 달이 바뀌어도
    expect(upcomingWindow(new Date("2026-09-30T20:00:00.000Z")).to).toBe("2026-10-07T15:00:00.000Z");
  });

  test("🔴 답이 늦은 접수 = created_at < 지금 − 72시간 — 배지의 isOverdue 와 같은 쪽의 경계(딱 72시간은 아니다)", () => {
    const cutoff = overdueCutoff(NOW);
    expect(cutoff).toBe(new Date(NOW.getTime() - BACKLOG_HOURS * HOUR).toISOString());
    const at = Date.parse(cutoff);
    for (const [created, over] of [
      [new Date(at).toISOString(), false],
      [new Date(at - 1).toISOString(), true],
      [new Date(at + 1).toISOString(), false],
    ] as const) {
      expect(isOverdue(created, NOW), created).toBe(over);
      expect(created < cutoff, created).toBe(over);
    }
  });

  test("🔴 이번 달 = 통계 화면 '이번 달' 과 같은 기간(statsRange thisMonth → KST 자정~자정)", () => {
    for (const now of [NOW, new Date("2026-09-30T15:30:00.000Z"), new Date("2027-01-01T00:10:00.000Z")]) {
      const r = statsRange("thisMonth", toKstDateString(now));
      const next = new Date(Date.UTC(Number(r.to.slice(0, 4)), Number(r.to.slice(5, 7)) - 1, Number(r.to.slice(8, 10)) + 1)).toISOString().slice(0, 10);
      expect(monthWindow(now)).toEqual({ from: new Date(`${r.from}T00:00:00+09:00`).toISOString(), to: new Date(`${next}T00:00:00+09:00`).toISOString() });
    }
  });
});

describe("1-b. 순수 — 한 줄 요약 · 카드 값", () => {
  test("한 줄 요약 — 모름 · 없음 · N건 · N건 중 M건 72시간 넘음 (M 을 모르면 N 만 말한다 · 어긋난 수는 말하지 않는다)", () => {
    expect(homeLede(rejected(), fulfilled(0))).toEqual({ kind: "unknown" });
    expect(homeLede(fulfilled(0), fulfilled(0))).toEqual({ kind: "none" });
    expect(homeLede(fulfilled(4), fulfilled(0))).toEqual({ kind: "waiting", n: 4 });
    expect(homeLede(fulfilled(4), fulfilled(1))).toEqual({ kind: "overdue", n: 4, m: 1 });
    expect(homeLede(fulfilled(4), rejected())).toEqual({ kind: "waiting", n: 4 });
    expect(homeLede(fulfilled(2), fulfilled(3))).toEqual({ kind: "waiting", n: 2 });
  });

  test("간편·상세 나눔 — 둘의 합이 새 접수 수와 같을 때만(따로 센 수가 어긋나면 보이지 않는다)", () => {
    expect(newSplit(fulfilled(4), fulfilled({ quick: 2, wizard: 2 }))).toEqual({ quick: 2, wizard: 2 });
    expect(newSplit(fulfilled(4), fulfilled({ quick: 2, wizard: 3 }))).toBeNull();
    expect(newSplit(rejected(), fulfilled({ quick: 2, wizard: 2 }))).toBeNull();
    expect(newSplit(fulfilled(4), rejected())).toBeNull();
  });

  const A = (customerFailed: number, ownerFailed: number, customerWaiting = 0) => fulfilled({ customerFailed, ownerFailed, customerWaiting, windowDays: 7 });

  test("🔴 문자 발송 카드(컨트롤러 결정 P1-2) — 모름 · 이상 없음 · 확인 필요는 **최근 7일 고객 문자 실패**로만 정한다 · 사장님 쪽 실패는 작은 줄(수)로만 따라간다", () => {
    expect(sendCard(rejected())).toEqual({ kind: "unknown" });
    expect(sendCard(A(0, 0))).toEqual({ kind: "ok", owner: 0 });
    expect(sendCard(A(0, 3))).toEqual({ kind: "ok", owner: 3 });
    expect(sendCard(A(2, 0))).toEqual({ kind: "problems", customer: 2, waiting: 0, owner: 0 });
    expect(sendCard(A(2, 1))).toEqual({ kind: "problems", customer: 2, waiting: 0, owner: 1 });
  });

  /**
   * P5-22(P5-21 재검토 신규 P2-1) — 발송기가 아직 꺼져 있으면(운영 문자 설정 전) 고객 문자가 전부 대기로 쌓이는데, 카드는 실패만 세어
   * "✓ 이상 없음" 이었다 — "고객에게 문자가 가고 있다" 로 읽혔다. 관리자 코드는 env 를 읽지 않고 **데이터로** 판단한다:
   * 최근 7일 고객 문자 중 한 번도 시도되지 않고 10분 넘게 대기 중인 건수(getHomeSendAlerts customerWaiting). 0 보다 크면 "대기 중 n건".
   * 실패가 아니라 배너는 띄우지 않는다. 실패가 있으면 실패가 먼저(급함)이고 대기는 작은 줄.
   */
  test("🔴 대기 — 실패가 없고 오래 대기 중인 고객 문자가 있으면 '대기 중'(이상 없음이 아니다) · 실패가 있으면 실패가 먼저 · 배너는 실패만", () => {
    expect(sendCard(A(0, 0, 3))).toEqual({ kind: "waiting", waiting: 3, cause: "neverTried", owner: 0 });
    expect(sendCard(A(0, 2, 1))).toEqual({ kind: "waiting", waiting: 1, cause: "neverTried", owner: 2 });
    expect(sendCard(A(1, 0, 4))).toEqual({ kind: "problems", customer: 1, waiting: 4, owner: 0 });
    expect(sendBanner(A(0, 0, 9))).toBeNull();
    expect(sendBanner(A(1, 0, 9))).toBe(1);
  });

  /**
   * P5-23 리뷰 P1-1 — 재시도를 기다리다 **보낼 때가 지난** 고객 문자(한 번 이상 시도 · 다음 시도 시각 또는 lease 끝이 10분 넘게 지남)도 대기 중이다.
   * 크론이 하루 1회라 그런 문자는 다음 접수·확정이나 다음 날 08:00 까지 나가지 않는다 — 그동안 카드가 "이상 없음" 이면 안 된다.
   * 발송 기록의 둘째 줄은 그 행을 "보낼 차례" · "오래 멈춤" 으로 말한다(같은 규칙). 이유가 달라 덧말도 다르다:
   * 한 번도 시도 못 한 것이 있으면 "문자 발송이 아직 켜지지 않았을 수 있어요"(발송이 꺼져 있다는 신호가 먼저) · 시도는 했으면 다음 발송 때 다시 보낸다.
   */
  test("🔴 대기 — 보낼 때가 지난 재시도(overdue)도 센다 · 수 = 한 번도 못 보낸 것 + 지난 재시도 · 덧말은 원인에 따라", () => {
    const B = (customerFailed: number, customerWaiting: number | null, customerOverdue: number | null) =>
      fulfilled({ customerFailed, ownerFailed: 0, customerWaiting, customerOverdue, windowDays: 7 });
    expect(sendCard(B(0, 0, 2))).toEqual({ kind: "waiting", waiting: 2, cause: "overdue", owner: 0 });
    expect(sendCard(B(0, 1, 2))).toEqual({ kind: "waiting", waiting: 3, cause: "neverTried", owner: 0 });
    expect(sendCard(B(0, 0, 0))).toEqual({ kind: "ok", owner: 0 });
    // 실패가 있으면 실패가 먼저 — 작은 줄의 대기 수는 둘의 합
    expect(sendCard(B(1, 4, 2))).toEqual({ kind: "problems", customer: 1, waiting: 6, owner: 0 });
    // 하나라도 모르면 합도 모른다 — 실패가 없으면 카드는 모름(이상 없음이 아니다)
    expect(sendCard(B(0, 0, null))).toEqual({ kind: "unknown" });
    expect(sendCard(B(0, null, 0))).toEqual({ kind: "unknown" });
    expect(sendCard(B(2, 1, null))).toEqual({ kind: "problems", customer: 2, waiting: null, owner: 0 });
    // 배너는 여전히 실패만
    expect(sendBanner(B(0, 3, 5))).toBeNull();
  });

  test("🔴 배너는 최근 7일 고객 문자 실패만 — 사장님 쪽 실패만 있거나 모르면 배너가 아니다", () => {
    expect(sendBanner(A(2, 1))).toBe(2);
    expect(sendBanner(A(0, 5))).toBeNull();
    expect(sendBanner(A(0, 0))).toBeNull();
    expect(sendBanner(rejected())).toBeNull();
  });

  /**
   * P5-22 수정 라운드(리뷰 P2-2) — 세 집계는 서로를 끌어내리지 않는다. 대기·사장님 집계를 모르면(null) 그 칸만 모름이고,
   * 고객 문자 실패 수(배너 · 확인 필요)는 그대로 산다. 대기 수를 모르면 '이상 없음' 이라 하지 않는다 — 발송기가 꺼져 문자가 쌓이는 중일 수 있다.
   */
  test("🔴 모르는 부가 집계(리뷰 P2-2) — 대기 수를 모르면 이상 없음이 아니라 모름 · 실패가 있으면 실패·배너는 그대로 · 사장님 수를 모르면 null", () => {
    const P = (customerFailed: number, ownerFailed: number | null, customerWaiting: number | null) =>
      fulfilled({ customerFailed, ownerFailed, customerWaiting, windowDays: 7 });
    expect(sendCard(P(0, 0, null))).toEqual({ kind: "unknown" });
    expect(sendCard(P(0, 3, null))).toEqual({ kind: "unknown" });
    expect(sendCard(P(2, null, null))).toEqual({ kind: "problems", customer: 2, waiting: null, owner: null });
    expect(sendCard(P(0, null, 3))).toEqual({ kind: "waiting", waiting: 3, cause: "neverTried", owner: null });
    expect(sendCard(P(0, null, 0))).toEqual({ kind: "ok", owner: null });
    expect(sendBanner(P(2, null, null))).toBe(2);
    expect(sendBanner(P(0, null, null))).toBeNull();
  });

  test("다가오는 운행 — KST 날짜별 묶음(날짜 순) · 오늘까지 남은 날 · 카드에는 날짜 셋까지 + 나머지 날 수", () => {
    const rows = [
      { id: "a", depart_at: "2026-09-30T05:30:00.000Z" },
      { id: "b", depart_at: "2026-09-30T20:00:00.000Z" }, // KST 10/1 05:00
      { id: "c", depart_at: "2026-10-01T22:30:00.000Z" }, // KST 10/2 07:30
      { id: "d", depart_at: "2026-10-03T15:00:00.000Z" }, // KST 10/4 00:00
    ];
    const days = tripDays(rows, NOW);
    expect(days.map((d) => [d.dateKey, d.month, d.day, d.weekday, d.diff, d.items.map((r) => r.id)])).toEqual([
      ["2026-09-30", 9, 30, 3, 2, ["a"]],
      ["2026-10-01", 10, 1, 4, 3, ["b"]],
      ["2026-10-02", 10, 2, 5, 4, ["c"]],
      ["2026-10-04", 10, 4, 0, 6, ["d"]],
    ]);
    const line = tripDatesLine(days, 3);
    expect(line.shown.map((d) => d.dateKey)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(line.more).toBe(1);
    expect(tripDatesLine(days.slice(0, 2), 3).more).toBe(0);
  });

  test("순수 모듈 — React·Next·DB·한글 0 · 가격 계산 0", () => {
    const src = codeOf(DASH);
    expect(src).not.toMatch(/from\s+"(next|react)[/"]|@\/lib\/supabase|server-only/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    const forbidden = new RegExp(["est" + "_price", "price" + "_state", "route" + "_prices", "estim" + "ate\\(", "PRICE" + "_DISPLAY_MODE", "price_from\\s*[*/+-]"].join("|"));
    for (const rel of [DASH, HOME]) expect(read(rel), rel).not.toMatch(forbidden);
    // 72 는 상태 배지 모델의 상수 하나(BACKLOG_HOURS) — 새 파일이 다시 적지 않는다
    for (const rel of [DASH, HOME, "components/admin/reservation-list.ts", "components/admin/reservationRow.tsx", "app/admin/(protected)/reservations/page.tsx"]) {
      expect(codeOf(rel), rel).not.toMatch(/\b72\b/);
    }
  });
});

// =============================================================================
// 2. 조회 — 새 집계 함수(head · 세션 + RLS)
// =============================================================================
function recorder(result: { data?: unknown; count?: number | null; error: { code?: string; message: string } | null }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lt", "not", "or", "in", "order", "limit", "range", "overrideTypes"]) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    };
  }
  chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, count: result.count ?? null, error: result.error }).then(ok, bad);
  return {
    calls,
    client: {
      from: (table: string) => {
        calls.push({ method: "from", args: [table] });
        return chain;
      },
    },
  };
}
const of = (calls: { method: string; args: unknown[] }[], m: string) => calls.filter((c) => c.method === m).map((c) => c.args);

/**
 * 조회마다 다른 결과 — from() 을 부른 순서대로 하나씩 돌려준다(getHomeSendAlerts 는 고객 실패 · 사장님 실패 · 대기 순으로 만든다).
 * "throw" 는 네트워크가 끊긴 것처럼 거부한다(supabase-js 는 HTTP 오류를 error 로 돌려주지만 fetch 자체가 죽으면 거부한다).
 */
function perQuery(results: ReadonlyArray<{ count?: number | null; error?: { code?: string; message: string } | null } | "throw">) {
  let next = 0;
  return {
    client: {
      from: () => {
        const r = results[next++];
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "gte", "lt", "or", "in"]) chain[m] = () => chain;
        chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
          (r === "throw" ? Promise.reject(new TypeError("fetch failed")) : Promise.resolve({ data: null, count: r?.count ?? null, error: r?.error ?? null })).then(ok, bad);
        return chain;
      },
    },
  };
}

describe("2. 조회 함수 — head 집계 · 개인정보 0 · 0 으로 갈음하지 않음", () => {
  // 실제 함수(모의가 아닌 것)를 부른다
  const real = async () => vi.importActual<typeof import("@/lib/admin/reservations")>("@/lib/admin/reservations");

  test("간편·상세 새 접수 — status=new 에 intake 를 하나씩", async () => {
    const lib = await real();
    const { client, calls } = recorder({ count: 2, error: null });
    expect(await lib.countNewByIntake(client as never)).toEqual({ quick: 2, wizard: 2 });
    expect(of(calls, "eq")).toEqual([
      ["status", "new"],
      ["intake", "quick"],
      ["status", "new"],
      ["intake", "wizard"],
    ]);
    for (const s of of(calls, "select")) expect(s[1]).toEqual({ count: "exact", head: true });
  });

  test("🔴 답이 늦은 접수 — status=new · created_at < cutoff (lt — 딱 72시간은 세지 않는다)", async () => {
    const lib = await real();
    const { client, calls } = recorder({ count: 1, error: null });
    const cutoff = overdueCutoff(NOW);
    expect(await lib.countOverdueNew(cutoff, client as never)).toBe(1);
    expect(of(calls, "eq")).toEqual([["status", "new"]]);
    expect(of(calls, "lt")).toEqual([["created_at", cutoff]]);
    expect(of(calls, "select")[0][1]).toEqual({ count: "exact", head: true });
  });

  test("🔴 이번 주 운행 — status=confirmed · depart_at ∈ [from, to) · 목록은 출발 순(id 로 동률) · 한도", async () => {
    const lib = await real();
    const w = upcomingWindow(NOW);
    const c = recorder({ count: 2, error: null });
    expect(await lib.countConfirmedDeparting(w, c.client as never)).toBe(2);
    expect(of(c.calls, "eq")).toEqual([["status", "confirmed"]]);
    expect(of(c.calls, "gte")).toEqual([["depart_at", w.from]]);
    expect(of(c.calls, "lt")).toEqual([["depart_at", w.to]]);
    const l = recorder({ data: [], error: null });
    await lib.listConfirmedDeparting(w, 20, l.client as never);
    expect(of(l.calls, "order")).toEqual([
      ["depart_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(of(l.calls, "limit")).toEqual([[20]]);
    expect(String(of(l.calls, "select")[0][0])).not.toMatch(/email|message|admin_memo/);
  });

  test("이번 달 접수·확정 — created_at ∈ [from, to) · 확정 = confirmed_at 이 있는 것(통계 화면의 '한 번이라도 확정'과 같은 정의)", async () => {
    const lib = await real();
    const w = monthWindow(NOW);
    const { client, calls } = recorder({ count: 3, error: null });
    expect(await lib.countCreatedBetween(w, client as never)).toEqual({ total: 3, confirmed: 3 });
    expect(of(calls, "gte")).toEqual([
      ["created_at", w.from],
      ["created_at", w.from],
    ]);
    expect(of(calls, "lt")).toEqual([
      ["created_at", w.to],
      ["created_at", w.to],
    ]);
    expect(of(calls, "not")).toEqual([["confirmed_at", "is", null]]);
  });

  test("🔴 오류·빈 count 는 던진다(0 으로 갈음하지 않는다)", async () => {
    const lib = await real();
    const bad = () => recorder({ count: null, error: { code: "42501", message: "denied" } }).client as never;
    const empty = () => recorder({ count: null, error: null }).client as never;
    await expect(lib.countOverdueNew(overdueCutoff(NOW), bad())).rejects.toThrow(/42501/);
    await expect(lib.countOverdueNew(overdueCutoff(NOW), empty())).rejects.toThrow();
    await expect(lib.countNewByIntake(empty())).rejects.toThrow();
    await expect(lib.countConfirmedDeparting(upcomingWindow(NOW), empty())).rejects.toThrow();
    await expect(lib.countCreatedBetween(monthWindow(NOW), empty())).rejects.toThrow();
  });

  test("🔴 이번 주 운행 날짜 줄(리뷰 P2-2) — 창 안의 **모든** 확정 출발 시각만 읽는다(depart_at 한 칸 · 이름·번호 0) · 출발 순 · 상한 넘으면 모자란다고 알린다", async () => {
    const lib = await real();
    const w = upcomingWindow(NOW);
    const departs = ["2026-09-28T01:00:00.000Z", "2026-10-02T01:00:00.000Z"];
    const r = recorder({ data: departs.map((depart_at) => ({ depart_at })), error: null });
    expect(await lib.listConfirmedDepartDates(w, r.client as never)).toEqual({ departAts: departs, capped: false });
    expect(of(r.calls, "select")).toEqual([["depart_at"]]);
    expect(of(r.calls, "eq")).toEqual([["status", "confirmed"]]);
    expect(of(r.calls, "gte")).toEqual([["depart_at", w.from]]);
    expect(of(r.calls, "lt")).toEqual([["depart_at", w.to]]);
    expect(of(r.calls, "order")).toEqual([["depart_at", { ascending: true }]]);
    // 상한 + 1 건을 읽어 넘치면 capped — 화면은 그때 날짜 줄을 그리지 않는다(모자란 날 수를 지어내지 않는다)
    const cap = lib.TRIP_DATES_CAP;
    expect(of(r.calls, "limit")).toEqual([[cap + 1]]);
    // P5-22(P5-21 재검토 신규 P2-2) — 읽는 수(상한 + 1)는 PostgREST 의 한 번 응답 상한(max_rows)보다 **작아야** 넘침을 알아챈다.
    // 전에는 1001 을 읽었는데 max_rows = 1000 에 잘려 1001번째가 오지 않았다 — capped 가 한 번도 켜질 수 없었다.
    // 호스팅 기본값도 1000 이다(supabase/config.toml 주석) — 로컬 설정 파일에서 읽어 대조한다.
    const maxRows = Number(/^max_rows\s*=\s*(\d+)\s*$/m.exec(read("supabase/config.toml"))?.[1]);
    expect(maxRows).toBe(1000);
    expect(cap + 1).toBeLessThan(maxRows);
    expect(cap).toBe(998);
    const full = recorder({ data: Array.from({ length: cap + 1 }, () => ({ depart_at: departs[0] })), error: null });
    const got = await lib.listConfirmedDepartDates(w, full.client as never);
    expect(got.capped).toBe(true);
    expect(got.departAts).toHaveLength(cap);
    await expect(lib.listConfirmedDepartDates(w, recorder({ data: null, error: { code: "42501", message: "denied" } }).client as never)).rejects.toThrow(/42501/);
  });

  test("🔴 최근 7일 발송 경보(컨트롤러 결정 P1-2) — 실패(중복 억제 제외) · created_at ≥ 지금 − 7일 · 받는 사람은 **아웃박스 문안 키에서** 가른다(고객 문자 / 사장님 알림) · head 집계 둘", async () => {
    const lib = await vi.importActual<typeof import("@/lib/admin/notifications")>("@/lib/admin/notifications");
    // 받는 사람은 문안 키(`${event}.${audience}.${channel}` · 실패 알림 `${event}.owner.failure.email`)의 둘째 칸 — 목록을 새로 적지 않는다
    expect([...lib.CUSTOMER_MESSAGE_TEMPLATE_KEYS].sort()).toEqual(["confirmed.customer.sms", "created.customer.sms"]);
    expect([...lib.OWNER_TEMPLATE_KEYS].sort()).toEqual(["confirmed.owner.failure.email", "created.owner.email", "created.owner.failure.email", "created.owner.sms"]);
    for (const k of ALL_TEMPLATE_KEYS) {
      const inCustomer = (lib.CUSTOMER_MESSAGE_TEMPLATE_KEYS as readonly string[]).includes(k);
      const inOwner = (lib.OWNER_TEMPLATE_KEYS as readonly string[]).includes(k);
      expect(inCustomer !== inOwner, k).toBe(true);
    }
    expect(lib.templateAudience("created.customer.sms")).toBe("customer");
    expect(lib.templateAudience("confirmed.owner.failure.email")).toBe("owner");
    expect(lib.templateAudience("weird")).toBeNull();
    // 파일에 문안 키를 손으로 적지 않는다(아웃박스가 정한 것을 가져다 가른다)
    expect(codeOf("lib/admin/notifications.ts")).not.toMatch(/"(created|confirmed)\.(customer|owner)\./);
    // 기간 — 발송 기록 화면의 기간 필터 '7d' 와 같은 창(카드·배너가 그 목록으로 이어진다)
    expect(lib.HOME_ALERT_WINDOW_DAYS).toBe(7);
    expect(lib.PERIOD_HOURS["7d"]).toBe(lib.HOME_ALERT_WINDOW_DAYS * 24);

    const r = recorder({ count: 2, error: null });
    expect(await lib.getHomeSendAlerts({ now: NOW }, r.client as never)).toEqual({ customerFailed: 2, ownerFailed: 2, customerWaiting: 2, customerOverdue: 2, windowDays: 7 });
    const since = new Date(NOW.getTime() - 7 * 24 * HOUR).toISOString();
    // P5-22 — 셋째 집계: 오래 대기 중인 고객 문자(한 번도 시도되지 않았고 만든 지 HOME_WAITING_MINUTES 넘음)
    const waitingBefore = new Date(NOW.getTime() - lib.HOME_WAITING_MINUTES * 60_000).toISOString();
    // P5-23 리뷰 P1-1 — 넷째 집계: 보낼 때가 지난 재시도(1 ≤ 시도 < MAX · 다음 시도 시각(또는 lease 끝)이 HOME_WAITING_MINUTES 넘게 지남 · 격리 행 제외)
    expect(of(r.calls, "from")).toEqual([["notifications_log"], ["notifications_log"], ["notifications_log"], ["notifications_log"]]);
    for (const s of of(r.calls, "select")) expect(s[1]).toEqual({ count: "exact", head: true });
    expect(of(r.calls, "eq")).toEqual([
      ["status", "failed"],
      ["status", "failed"],
      ["status", "pending"],
      ["attempts", 0],
      ["status", "pending"],
    ]);
    expect(of(r.calls, "or")).toEqual([
      ["last_error.is.null,last_error.neq.duplicate_sent"],
      ["last_error.is.null,last_error.neq.duplicate_sent"],
      ["last_error.is.null,last_error.not.like.sent_unmarked:*"],
    ]);
    expect(of(r.calls, "gte")).toEqual([
      ["created_at", since],
      ["created_at", since],
      ["created_at", since],
      ["attempts", 1],
      ["created_at", since],
    ]);
    expect(of(r.calls, "lt")).toEqual([
      ["created_at", waitingBefore],
      ["attempts", 5],
      ["next_attempt_at", waitingBefore],
    ]);
    expect(of(r.calls, "in")).toEqual([
      ["template", [...lib.CUSTOMER_MESSAGE_TEMPLATE_KEYS]],
      ["template", [...lib.OWNER_TEMPLATE_KEYS]],
      ["template", [...lib.CUSTOMER_MESSAGE_TEMPLATE_KEYS]],
      ["template", [...lib.CUSTOMER_MESSAGE_TEMPLATE_KEYS]],
    ]);
    // 기준 시간 — 즉시 발송이 켜져 있으면 접수·확정 응답 뒤 몇 초 안에 첫 시도가 끝난다(마감 40초). 10분은 그보다 넉넉히 길다.
    const { INLINE_DEADLINE_MS } = await import("@/lib/notify/inline");
    expect(lib.HOME_WAITING_MINUTES).toBe(10);
    expect(lib.HOME_WAITING_MINUTES * 60_000).toBeGreaterThan(INLINE_DEADLINE_MS * 10);
    // 모름은 0 이 아니다
    await expect(lib.getHomeSendAlerts({ now: NOW }, recorder({ count: null, error: null }).client as never)).rejects.toThrow();
    await expect(lib.getHomeSendAlerts({ now: NOW }, recorder({ count: null, error: { code: "42501", message: "d" } }).client as never)).rejects.toThrow(/42501/);
  });

  test("🔴 셋은 서로를 끌어내리지 않는다(리뷰 P2-2 · allSettled) — 대기·사장님 집계가 실패해도 고객 실패 수(배너)는 남는다(그 칸만 null) · 고객 실패 수를 모르면 던진다", async () => {
    const lib = await vi.importActual<typeof import("@/lib/admin/notifications")>("@/lib/admin/notifications");
    const run = (results: Parameters<typeof perQuery>[0]) => lib.getHomeSendAlerts({ now: NOW }, perQuery(results).client as never);
    // 대기 집계만 오류(응답의 error) · 거부(fetch 가 죽음) · count 없음 — 대기만 모름
    for (const bad of [{ count: null, error: { code: "57014", message: "canceling statement" } }, "throw" as const, { count: null }]) {
      expect(await run([{ count: 2 }, { count: 1 }, bad, { count: 3 }]), JSON.stringify(bad)).toEqual({
        customerFailed: 2,
        ownerFailed: 1,
        customerWaiting: null,
        customerOverdue: 3,
        windowDays: 7,
      });
      // 지난 재시도 집계만 실패 — 그 칸만 모름(리뷰 P1-1 — 넷째 집계도 나머지를 끌어내리지 않는다)
      expect(await run([{ count: 2 }, { count: 1 }, { count: 3 }, bad]), JSON.stringify(bad)).toEqual({
        customerFailed: 2,
        ownerFailed: 1,
        customerWaiting: 3,
        customerOverdue: null,
        windowDays: 7,
      });
    }
    // 사장님 집계만 실패 — 사장님 수만 모름
    expect(await run([{ count: 0 }, "throw", { count: 4 }, { count: 0 }])).toEqual({ customerFailed: 0, ownerFailed: null, customerWaiting: 4, customerOverdue: 0, windowDays: 7 });
    // 고객 실패 수를 모르면 던진다 — 카드는 "불러오지 못했어요" · 배너 없음(예전과 같다: 배너의 근거가 이 수다)
    await expect(run(["throw", { count: 1 }, { count: 1 }, { count: 1 }])).rejects.toThrow();
    await expect(run([{ count: null, error: { code: "42501", message: "denied" } }, { count: 1 }, { count: 1 }, { count: 1 }])).rejects.toThrow(/42501/);
    // 코드 — 넷을 allSettled 로 기다린다(하나의 거부가 나머지를 버리지 않는다)
    expect(codeOf("lib/admin/notifications.ts")).toMatch(/await Promise\.allSettled\(\[customerQuery, ownerQuery, waitingQuery, overdueQuery\]\)/);
  });

  test("🔴 새 접수 건수는 요청 범위 memo(React cache) — 레이아웃(배지)과 홈·목록이 한 요청 안에서 같은 값을 받는다", () => {
    const src = codeOf("lib/admin/reservations.ts");
    expect(src).toMatch(/import \{ cache \} from "react";/);
    expect(src).toMatch(/export const countNewReservations = cache\(/);
    expect(src).not.toMatch(/unstable_cache/);
  });
});

// =============================================================================
// 3. 화면 — /admin
// =============================================================================
const PREVIEW: ReservationListRow[] = [
  {
    id: "d1d1d1d1-7425-40de-944b-e07fc1f90ae1",
    public_code: "OD1",
    status: "new",
    intake: "wizard",
    name: "예시고객라",
    phone: "+821000000004",
    vehicle_slug: "bus28",
    origin_code: "DJN",
    destination_code: "JJU",
    trip_type: "oneway",
    depart_at: "2026-10-05T00:00:00.000Z",
    return_at: null,
    bus_count: 1,
    passengers: 20,
    created_at: ago(80 * HOUR),
    confirmed_at: null,
  },
  {
    id: "d2d2d2d2-7425-40de-944b-e07fc1f90ae2",
    public_code: "QK1",
    status: "new",
    intake: "quick",
    name: "예시고객가",
    phone: "+821000000001",
    vehicle_slug: null,
    origin_code: "SEL",
    destination_code: "GNG",
    trip_type: null,
    depart_at: "2026-10-09T15:00:00.000Z",
    return_at: null,
    bus_count: null,
    passengers: 28,
    created_at: ago(25 * 60_000),
    confirmed_at: null,
  },
];
const TRIPS: ReservationListRow[] = [
  { ...PREVIEW[0], id: "e1e1e1e1-7425-40de-944b-e07fc1f90ae1", status: "confirmed", name: "예시고객마", origin_code: "ICN", destination_code: "SEL", depart_at: "2026-09-30T05:30:00.000Z", passengers: 22, confirmed_at: ago(HOUR) },
  { ...PREVIEW[1], id: "e2e2e2e2-7425-40de-944b-e07fc1f90ae2", status: "confirmed", name: "예시고객아", depart_at: "2026-10-01T15:00:00.000Z", passengers: 33, confirmed_at: ago(HOUR) },
];
const NOTICE = (id: number, active: boolean, published_at: string) => ({ id, title: `n${id}`, body: "b", category: "info", published_at, active });
const POPUP = (id: number, active: boolean) => ({ id, title: `p${id}`, body: "b", image_path: null, starts_at: "2000-01-01", ends_at: "2999-12-31", active, created_at: "2026-09-01T00:00:00.000Z" });
const ROUTE = (id: number, active: boolean, price_from: number | null) => ({ id, origin_code: "ICN", destination_code: "SEL", price_from, highlight: false, sort: id, active });

interface Setup {
  newCount?: number | "fail";
  split?: { quick: number; wizard: number } | "fail";
  overdue?: number | "fail";
  alerts?: { customerFailed: number; ownerFailed: number | null; customerWaiting?: number | null; customerOverdue?: number | null } | "fail";
  tripCount?: number | "fail";
  trips?: ReservationListRow[] | "fail";
  tripDates?: { departAts: string[]; capped: boolean } | "fail";
  preview?: ReservationListRow[] | "fail";
  popups?: unknown[] | "fail";
  notices?: unknown[] | "fail";
  routes?: unknown[] | "fail";
  month?: { total: number; confirmed: number } | "fail";
}

function arrange(s: Setup) {
  const val = <T,>(v: T | "fail" | undefined, dflt: T) => (v === "fail" ? Promise.reject(new Error("boom")) : Promise.resolve(v ?? dflt));
  vi.mocked(countNewReservations).mockImplementation(() => val(s.newCount, 2));
  vi.mocked(countNewByIntake).mockImplementation(() => val(s.split, { quick: 1, wizard: 1 }));
  vi.mocked(countOverdueNew).mockImplementation(() => val(s.overdue, 1));
  vi.mocked(getHomeSendAlerts).mockImplementation(() =>
    s.alerts === "fail" ? Promise.reject(new Error("down")) : Promise.resolve({ customerWaiting: 0, customerOverdue: 0, ...(s.alerts ?? { customerFailed: 0, ownerFailed: 0 }), windowDays: 7 }),
  );
  vi.mocked(countConfirmedDeparting).mockImplementation(() => val(s.tripCount, 2));
  vi.mocked(listConfirmedDeparting).mockImplementation(() => val(s.trips, TRIPS));
  vi.mocked(listConfirmedDepartDates).mockImplementation(() =>
    val(s.tripDates, { departAts: (s.trips === "fail" || s.trips === undefined ? TRIPS : s.trips).map((r) => r.depart_at), capped: false }),
  );
  vi.mocked(listReservations).mockImplementation(() =>
    s.preview === "fail" ? Promise.reject(new Error("x")) : Promise.resolve({ items: s.preview ?? PREVIEW, hasMore: false, nextCursor: null }),
  );
  vi.mocked(listAdminPopups).mockImplementation(() => val(s.popups, [POPUP(1, false)]) as never);
  vi.mocked(listAdminNotices).mockImplementation(() => val(s.notices, [NOTICE(1, true, "2026-09-25")]) as never);
  vi.mocked(listAdminRoutes).mockImplementation(() => val(s.routes, [ROUTE(1, true, 400000), ROUTE(2, true, null), ROUTE(3, false, null)]) as never);
  vi.mocked(countCreatedBetween).mockImplementation(() => val(s.month, { total: 8, confirmed: 3 }));
}

async function renderHome(s: Setup = {}) {
  arrange(s);
  const tree = (await AdminHomePage()) as ReactElement;
  return { tree, html: renderToStaticMarkup(tree) };
}

interface Found {
  type: unknown;
  props: Record<string, unknown>;
}
function collect(node: unknown, out: Found[] = []): Found[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const c of node) collect(c, out);
    return out;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.props) {
    out.push({ type: el.type, props: el.props });
    collect(el.props.children, out);
  }
  return out;
}

describe("3. 화면 — 머리 · 한 줄 요약 · 카드 4장", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  test("🔴 날짜(KST) · 제목 · 한 줄 요약('새 접수 N건… 그중 M건은 72시간이 넘었어요.') · 넓은 화면 주 버튼 '새 접수 확인하기'", async () => {
    const { html } = await renderHome({ newCount: 4, overdue: 1, split: { quick: 2, wizard: 2 } });
    const t = text(html);
    expect(t).toContain(fill(dates.full as string, { month: 9, day: 28, weekday: weekday(1) }));
    expect(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]).toBe(home.title);
    expect(home.title).toBe("오늘 확인할 일");
    expect(t).toContain(fill(homeObj("lede").overdue, { n: 4, m: 1 }));
    expect(links(html)).toContainEqual(expect.objectContaining({ href: "/admin/reservations", text: home.reservationsLink }));
    expect(home.reservationsLink).toBe("새 접수 확인하기");
  });

  test("🔴 0건이면 거짓 없는 문장 — 문자 알림을 약속하지 않는다(사장님 알림 번호가 아직 없다)", async () => {
    const { html } = await renderHome({ newCount: 0, overdue: 0, split: { quick: 0, wizard: 0 } });
    expect(text(html)).toContain(homeObj("lede").none);
    expect(homeObj("lede").none).not.toMatch(/문자/);
  });

  test("🔴 카드 4장 — 전체가 링크 · 값은 DB 가 센 수 · 새 접수(간편·상세) · 답이 늦은 접수 · 문자 발송(최근 7일 고객 문자) · 이번 주 운행(날짜 나열)", async () => {
    const { html } = await renderHome({ newCount: 4, split: { quick: 2, wizard: 2 }, overdue: 1, tripCount: 2 });
    const cards = [...html.matchAll(/<a[^>]*data-card="(\w+)"/g)].map((m) => m[1]);
    expect(cards).toEqual(["new", "overdue", "notify", "trips"]);
    const c = homeObj("card");
    const n = card(html, "new");
    expect(n.text).toContain(c.new);
    expect(n.text).toContain(fill(home.count, { n: 4 }));
    expect(n.text).toContain(fill(c.newSplit, { quick: 2, wizard: 2 }));
    expect(attr(n.tag, "href")).toBe("/admin/reservations");
    expect(attr(n.tag, "data-tone")).toBe("attention");
    const o = card(html, "overdue");
    expect(o.text).toContain(fill(home.count, { n: 1 }));
    expect(o.text).toContain(c.overdueSub);
    expect(attr(o.tag, "data-tone")).toBe("urgent");
    const s = card(html, "notify");
    expect(s.text).toContain(c.notify);
    expect(c.notify).toBe("문자 발송");
    expect(s.text).toContain(c.notifyOk);
    // 기간과 무엇을 셌는지를 카드에 적는다 — "최근 7일 고객 문자 실패 0건"(시안 문구 + 고객)
    expect(s.text).toContain(fill(c.notifyOkSub, { days: 7 }));
    expect(fill(c.notifyOkSub, { days: 7 })).toBe("최근 7일 고객 문자 실패 0건");
    // 누르면 같은 창의 실패 목록(발송 기록 · 상태 = 실패 · 기간 = 7일)
    expect(attr(s.tag, "href")?.replace(/&amp;/g, "&")).toBe("/admin/notifications?status=failed&period=7d");
    expect(attr(s.tag, "data-tone")).toBe("ok");
    const tr = card(html, "trips");
    expect(tr.text).toContain(fill(home.count, { n: 2 }));
    expect(tr.text).toContain(fill(dates.short as string, { month: 9, day: 30, weekday: weekday(3) }));
    expect(tr.text).toContain(fill(dates.short as string, { month: 10, day: 2, weekday: weekday(5) }));
    expect(attr(tr.tag, "href")).toBe("/admin/reservations?status=confirmed");
  });

  test("🔴 조회 하나가 실패하면 그 카드만 '지금은 불러오지 못했어요' — '0건'·'이상 없음' 이라 하지 않고 나머지는 그대로", async () => {
    const { html } = await renderHome({ overdue: "fail", alerts: "fail", tripCount: "fail", newCount: 3, split: { quick: 1, wizard: 2 } });
    const u = home.unknown;
    for (const k of ["overdue", "notify", "trips"]) {
      expect(card(html, k).text, k).toContain(u);
      expect(card(html, k).text, k).not.toMatch(new RegExp(`\\b0${fill(home.count, { n: "" })}`));
    }
    expect(card(html, "notify").text).not.toContain(homeObj("card").notifyOk);
    expect(card(html, "new").text).toContain(fill(home.count, { n: 3 }));
    // M 을 모르면 요약은 N 만 말한다
    expect(text(html)).toContain(fill(homeObj("lede").waiting, { n: 3 }));
  });

  test("새 접수 수를 모르면 — 요약도 카드도 모름 · 배지 보고 없음(모르는 수로 배지를 덮지 않는다)", async () => {
    const { html, tree } = await renderHome({ newCount: "fail" });
    expect(text(html)).toContain(homeObj("lede").unknown);
    expect(card(html, "new").text).toContain(home.unknown);
    expect(collect(tree).filter((n) => n.type === NavBadgeReport)).toEqual([]);
  });

  test("간편·상세 합이 어긋나면 나눔 줄을 숨긴다", async () => {
    const { html } = await renderHome({ newCount: 4, split: { quick: 1, wizard: 1 } });
    expect(card(html, "new").text).not.toContain(fill(homeObj("card").newSplit, { quick: 1, wizard: 1 }));
  });
});

describe("3-b. 화면 — 배너 · 미리보기 · 다가오는 운행 · 점검 · 이번 달", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  test("🔴 최근 7일 고객 문자 실패가 있으면 카드 줄 **위에** 배너 하나(role=alert) — 기간을 문장에 적고 고객에게 전화로 알리라고 한다 + [발송 기록 보기](같은 창의 실패 목록)", async () => {
    const { html } = await renderHome({ alerts: { customerFailed: 2, ownerFailed: 1 } });
    const alerts = [...html.matchAll(/<p[^>]*role="alert"[^>]*>([\s\S]*?)<\/p>/g)];
    expect(alerts).toHaveLength(1);
    const bannerText = text(alerts[0][1]);
    expect(bannerText).toContain(fill(home.banner, { days: 7, n: 2 }));
    expect(home.banner).toBe("최근 {days}일 동안 고객에게 보내지 못한 문자가 {n}건 있어요 — 고객에게 전화로 직접 알려 주세요.");
    expect(links(alerts[0][0])).toEqual([expect.objectContaining({ href: "/admin/notifications?status=failed&period=7d", text: home.bannerLink })]);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('data-card="new"'));
    const c = homeObj("card");
    const s = card(html, "notify");
    expect(attr(s.tag, "data-tone")).toBe("urgent");
    expect(s.text).toContain(c.notifyProblem);
    expect(s.text).toContain(fill(c.notifyProblemSub, { days: 7, n: 2 }));
    // 사장님 쪽 실패는 같은 카드의 작은 줄로만
    expect(s.text).toContain(fill(c.notifyOwner, { n: 1 }));
  });

  test("🔴 배너 없음 — 사장님 쪽 알림 실패만(작은 줄로만 · 배너 아님) · 실패 없음 · 모름", async () => {
    for (const alerts of [undefined, { customerFailed: 0, ownerFailed: 3 }, "fail" as const]) {
      const { html } = await renderHome({ alerts });
      expect(html, JSON.stringify(alerts)).not.toMatch(/role="alert"/);
    }
    const c = homeObj("card");
    const ownerOnly = card((await renderHome({ alerts: { customerFailed: 0, ownerFailed: 3 } })).html, "notify");
    expect(attr(ownerOnly.tag, "data-tone")).toBe("ok");
    expect(ownerOnly.text).toContain(c.notifyOk);
    expect(ownerOnly.text).toContain(fill(c.notifyOwner, { n: 3 }));
    expect(fill(c.notifyOwner, { n: 3 })).toBe("사장님 알림 실패 3건 — 발송 기록에서 확인");
    const none = card((await renderHome({ alerts: { customerFailed: 0, ownerFailed: 0 } })).html, "notify");
    expect(none.text).not.toContain(fill(c.notifyOwner, { n: 0 }).slice(0, 6));
  });

  test("🔴 대기 중(P5-22 · 재검토 신규 P2-1) — 실패는 없지만 오래 대기 중인 고객 문자가 있으면 '대기 중 n건 · 문자 발송이 아직 켜지지 않았을 수 있어요'(이상 없음이 아니다 · 배너 없음 · 새 접수 톤)", async () => {
    const c = homeObj("card");
    const { html } = await renderHome({ alerts: { customerFailed: 0, ownerFailed: 0, customerWaiting: 3 } });
    expect(html).not.toMatch(/role="alert"/);
    const s = card(html, "notify");
    expect(attr(s.tag, "data-tone")).toBe("attention");
    expect(s.text).toContain(fill(c.notifyWaiting, { n: 3 }));
    expect(fill(c.notifyWaiting, { n: 3 })).toBe("대기 중 3건");
    expect(s.text).toContain(c.notifyWaitingSub);
    expect(c.notifyWaitingSub).toBe("문자 발송이 아직 켜지지 않았을 수 있어요");
    expect(s.text).not.toContain(c.notifyOk);
    // 실패가 함께 있으면 실패가 먼저(급함 · 배너) · 대기는 작은 줄
    const both = await renderHome({ alerts: { customerFailed: 1, ownerFailed: 0, customerWaiting: 2 } });
    const b = card(both.html, "notify");
    expect(attr(b.tag, "data-tone")).toBe("urgent");
    expect(b.text).toContain(c.notifyProblem);
    expect(b.text).toContain(fill(c.notifyWaitingMinor, { n: 2 }));
    expect([...both.html.matchAll(/role="alert"/g)]).toHaveLength(1);
    // 대기도 실패도 없으면 예전처럼 이상 없음(대기 줄 없음)
    const ok = card((await renderHome({ alerts: { customerFailed: 0, ownerFailed: 0, customerWaiting: 0 } })).html, "notify");
    expect(ok.text).toContain(c.notifyOk);
    expect(ok.text).not.toContain("대기 중");
    expect(fill(c.notifyWaitingMinor, { n: 2 })).toBe("고객 문자 대기 중 2건");
  });

  test("🔴 대기 중 — 보낼 때가 지난 재시도만 있으면(리뷰 P1-1) '대기 중 n건 · 보내지 못한 문자는 다음 발송 때 다시 보내요'(발송이 꺼졌다는 덧말이 아니다) · 섞이면 합 · 작은 줄도 합", async () => {
    const c = homeObj("card");
    const only = card((await renderHome({ alerts: { customerFailed: 0, ownerFailed: 0, customerWaiting: 0, customerOverdue: 2 } })).html, "notify");
    expect(attr(only.tag, "data-tone")).toBe("attention");
    expect(only.text).toContain(fill(c.notifyWaiting, { n: 2 }));
    expect(only.text).toContain(c.notifyOverdueSub);
    expect(c.notifyOverdueSub).toBe("보내지 못한 문자는 다음 발송 때 다시 보내요");
    expect(only.text, "시도는 했다 — '발송이 꺼졌을 수 있다' 가 아니다").not.toContain(c.notifyWaitingSub);
    expect(only.text).not.toContain(c.notifyOk);
    // 한 번도 못 보낸 것이 섞이면 수는 합 · 덧말은 발송이 꺼졌다는 쪽(더 근본적인 원인)
    const mixed = card((await renderHome({ alerts: { customerFailed: 0, ownerFailed: 0, customerWaiting: 1, customerOverdue: 2 } })).html, "notify");
    expect(mixed.text).toContain(fill(c.notifyWaiting, { n: 3 }));
    expect(mixed.text).toContain(c.notifyWaitingSub);
    expect(mixed.text).not.toContain(c.notifyOverdueSub);
    // 실패가 함께면 실패가 먼저 — 작은 줄의 대기 수는 합
    const withFail = card((await renderHome({ alerts: { customerFailed: 1, ownerFailed: 0, customerWaiting: 1, customerOverdue: 2 } })).html, "notify");
    expect(withFail.text).toContain(fill(c.notifyWaitingMinor, { n: 3 }));
  });

  test("🔴 카드가 이어지는 목록 = 카드가 말한 것(리뷰 P2-1) — 대기 중은 '대기 · 최근 7일' · 확인 필요·이상 없음·모름은 '실패 · 최근 7일' · 배너는 늘 '실패 · 최근 7일'", async () => {
    const lib = await vi.importActual<typeof import("@/lib/admin/notifications")>("@/lib/admin/notifications");
    expect(lib.HOME_WAITING_LIST_HREF).toBe("/admin/notifications?status=pending&period=7d");
    expect(lib.HOME_ALERT_LIST_HREF).toBe("/admin/notifications?status=failed&period=7d");
    // 발송 기록 화면이 그 주소를 그대로 받는다(모르는 값이면 '전체' 로 떨어져 카드와 다른 목록이 나온다)
    expect(lib.parseNotificationStatusFilter("pending")).toBe("pending");
    const href = (html: string) => (attr(card(html, "notify").tag, "href") ?? "").replace(/&amp;/g, "&");
    expect(href((await renderHome({ alerts: { customerFailed: 0, ownerFailed: 0, customerWaiting: 3 } })).html)).toBe(lib.HOME_WAITING_LIST_HREF);
    for (const alerts of [{ customerFailed: 0, ownerFailed: 0, customerWaiting: 0 }, { customerFailed: 0, ownerFailed: 2, customerWaiting: 0 }, "fail" as const]) {
      expect(href((await renderHome({ alerts })).html), JSON.stringify(alerts)).toBe(lib.HOME_ALERT_LIST_HREF);
    }
    // 실패와 대기가 함께면 카드는 실패(급함)를 말하므로 실패 목록 · 배너도 실패 목록
    const both = await renderHome({ alerts: { customerFailed: 1, ownerFailed: 0, customerWaiting: 2 } });
    expect(href(both.html)).toBe(lib.HOME_ALERT_LIST_HREF);
    const banner = [...both.html.matchAll(/<p[^>]*role="alert"[^>]*>[\s\S]*?<\/p>/g)];
    expect(banner).toHaveLength(1);
    expect(links(banner[0][0]).map((l) => l.href)).toEqual([lib.HOME_ALERT_LIST_HREF]);
  });

  test("🔴 부가 집계가 실패해도(리뷰 P2-2) — 고객 문자 실패 배너·확인 필요는 그대로 · 사장님 수를 모르면 그렇다고 작은 줄 · 대기 수를 모르면 '이상 없음' 이라 하지 않는다", async () => {
    const c = homeObj("card");
    const bad = await renderHome({ alerts: { customerFailed: 2, ownerFailed: null, customerWaiting: null } });
    expect([...bad.html.matchAll(/role="alert"/g)]).toHaveLength(1);
    const s = card(bad.html, "notify");
    expect(attr(s.tag, "data-tone")).toBe("urgent");
    expect(s.text).toContain(fill(c.notifyProblemSub, { days: 7, n: 2 }));
    expect(s.text).toContain(c.notifyOwnerUnknown);
    expect(c.notifyOwnerUnknown).toBe("사장님 알림 실패 수는 지금 불러오지 못했어요");
    expect(s.text).not.toContain("대기 중");
    // 실패 0 · 대기 수 모름 → 모름(이상 없음이 아니다 — 문자가 쌓이는 중일 수 있다) · 배너 없음
    const unknownWaiting = await renderHome({ alerts: { customerFailed: 0, ownerFailed: 0, customerWaiting: null } });
    const u = card(unknownWaiting.html, "notify");
    expect(u.text).toContain(home.unknown);
    expect(u.text).not.toContain(c.notifyOk);
    expect(unknownWaiting.html).not.toMatch(/role="alert"/);
  });

  test("매뉴얼 관리 홈 절이 '대기 중' 을 설명한다(브리프: 매뉴얼 관리 홈 절을 고친다) — 화면 문구 그대로 · 기준 시간 = HOME_WAITING_MINUTES", async () => {
    const lib = await vi.importActual<typeof import("@/lib/admin/notifications")>("@/lib/admin/notifications");
    const c = homeObj("card");
    const manual = read("docs/ops/admin-manual.md");
    const start = manual.indexOf("### 첫 화면 — 관리 홈");
    const end = manual.indexOf("### 나오실 때 — 로그아웃");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const section = manual.slice(start, end);
    expect(section).toContain(fill(c.notifyWaiting, { n: "N" }));
    expect(section).toContain(c.notifyWaitingSub);
    expect(section).toContain(fill(c.notifyWaitingMinor, { n: "N" }));
    expect(section).toContain(`${lib.HOME_WAITING_MINUTES}분`);
    // 수정 라운드 — 대기 중 카드는 '대기 · 최근 7일' 로 이어진다(리뷰 P2-1) · 사장님 수를 모르면 그 문구(리뷰 P2-2)
    expect(section).toContain("대기 · 최근 7일");
    expect(section).toContain(c.notifyOwnerUnknown);
    // 실패가 아니다 — 배너(맨 위 안내 줄)는 뜨지 않는다고 적는다
    expect(section).toMatch(/실패는 아닙니다/);
    // 리뷰 P1-1 — 보낼 때가 지난 재시도도 센다: 그 덧말을 화면 문구 그대로 적고, "곧 발송이나 실패로 바뀐다"(하루 1회 크론에서는 거짓)를 더는 쓰지 않는다
    expect(section).toContain(c.notifyOverdueSub);
    expect(section).not.toMatch(/여기서 세지 않습니다/);
  });

  test("🔴 '문자' 라는 말은 센 것과 맞는다(리뷰 P2-1) — 홈은 고객 문자(SMS·알림톡 문안)만 세고, 발송 기록 요약은 모든 알림을 기간과 함께 말한다", () => {
    // 홈 카드·배너 = 고객 문자 → "문자" / 발송 기록 요약 = 메일 행까지 → "알림" + 기간
    const summary = notifyKo.summary as Record<string, string>;
    for (const k of ["failed", "stuck", "sentUnconfirmed", "ok"]) expect(summary[k], k).not.toMatch(/문자/);
    expect(summary.failed).toContain("(전체 기간)");
    // 재검토 P2-A — 창은 마지막 시도(updated_at)
    expect(summary.stuck).toContain(`(최근 ${SUMMARY_WINDOW_HOURS}시간 안에 마지막 시도)`);
    expect(summary.sentUnconfirmed).toContain("(전체 기간)");
    expect(summary.note).toContain("고객에게 가는 문자라면");
  });

  test("🔴 새 접수 미리보기 — 목록과 같은 행(한 벌의 마크업) · 오래 기다린 순으로 최대 5건 · 행마다 전화 버튼 · [전체 보기]", async () => {
    const { html } = await renderHome({});
    expect(vi.mocked(listReservations)).toHaveBeenCalledWith({ status: "new", limit: 5 });
    const rows = [...html.matchAll(/<li[^>]*data-row-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)];
    expect(rows.map((m) => m[1])).toEqual(PREVIEW.map((r) => r.id));
    for (const m of rows) {
      const ls = links(m[0]);
      expect(ls[0].href).toBe(`/admin/reservations/${m[1]}`);
      expect(ls[1].href).toMatch(/^tel:\+82/);
    }
    expect(text(rows[0][0])).toContain("010-****-0004");
    expect(text(rows[1][0])).toContain(res.quickChip);
    expect(links(html)).toContainEqual(expect.objectContaining({ href: "/admin/reservations", text: homeObj("queue").all }));
  });

  test("미리보기가 비었거나 못 읽으면 — 거짓 없는 한 줄(없음 / 불러오지 못함)", async () => {
    expect(text((await renderHome({ preview: [], newCount: 0 })).html)).toContain(homeObj("queue").none);
    expect(text((await renderHome({ preview: "fail" })).html)).toContain(home.unknown);
  });

  test("🔴 다가오는 운행 — 7일 창으로 읽는다 · 날짜별 묶음(N일 뒤) · 시각 · 구간 · 고객 이름 · 차량·인원 · 확정 배지 · 간편은 '시각 미정'·'차량 미정'", async () => {
    const { html } = await renderHome({});
    const w = upcomingWindow(NOW);
    expect(vi.mocked(listConfirmedDeparting)).toHaveBeenCalledWith(w, expect.any(Number));
    expect(vi.mocked(countConfirmedDeparting)).toHaveBeenCalledWith(w);
    const section = /<section[^>]*data-testid="admin-home-trips"[^>]*>([\s\S]*?)<\/section>/.exec(html);
    expect(section).not.toBeNull();
    const heads = [...section![1].matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => text(m[1]));
    expect(heads).toEqual([
      `${fill(dates.day as string, { month: 9, day: 30, weekday: weekday(3) })} ${fill((res.relative as unknown as Record<string, string>).after, { n: 2 })}`,
      `${fill(dates.day as string, { month: 10, day: 2, weekday: weekday(5) })} ${fill((res.relative as unknown as Record<string, string>).after, { n: 4 })}`,
    ]);
    const t = text(section![1]);
    expect(t).toContain(fill(dates.time as string, { hour: "14", minute: "30" }));
    expect(t).toContain("예시고객마");
    expect(t).toContain(fill(res.busValue, { vehicle: "28인승 우등", buses: 1 }));
    expect(t).toContain(fill(res.paxValue, { n: 22 }));
    expect(t).toContain(res.timeUndecided);
    expect(t).toContain(res.vehicleUndecided);
    expect([...section![1].matchAll(/data-kind="confirmed"/g)]).toHaveLength(2);
    expect(links(section![1]).map((l) => l.href)).toEqual(TRIPS.map((r) => `/admin/reservations/${r.id}`));
  });

  test("🔴 이번 주 운행 카드의 날짜 줄은 창 안의 **모든** 운행에서(리뷰 P2-2 실측: 25건 = 오늘 22 · 5일 뒤 3 → 전에는 '9/28(월)' 만)", async () => {
    const todayAt = (i: number) => new Date(Date.parse("2026-09-28T00:00:00.000Z") + i * 60_000).toISOString(); // 9/28 09:00 KST + i분
    const later = "2026-10-03T00:00:00.000Z"; // 10/3(토) 09:00
    const departAts = [...Array.from({ length: 22 }, (_, i) => todayAt(i)), later, later, later];
    const panelRows = departAts.slice(0, 20).map((d, i) => ({ ...TRIPS[0], id: `f${String(i).padStart(7, "0")}-7425-40de-944b-e07fc1f90ae1`, depart_at: d }));
    const { html } = await renderHome({ tripCount: 25, trips: panelRows, tripDates: { departAts, capped: false } });
    expect(vi.mocked(listConfirmedDepartDates)).toHaveBeenCalledWith(upcomingWindow(NOW));
    const tr = card(html, "trips");
    expect(tr.text).toContain(fill(home.count, { n: 25 }));
    expect(tr.text).toContain(fill(dates.short as string, { month: 9, day: 28, weekday: weekday(1) }));
    expect(tr.text).toContain(fill(dates.short as string, { month: 10, day: 3, weekday: weekday(6) }));
    // 패널은 앞의 20건만 — 그 안내는 그대로 참이다
    expect(text(html)).toContain(fill(homeObj("trips").more, { n: 25, shown: 20 }));
    // 상한을 넘겨 모자라면 날짜 줄을 그리지 않는다(모자란 날 수를 지어내지 않는다) · 날짜 조회만 실패해도 수는 그대로
    for (const tripDates of [{ departAts: departAts.slice(0, 3), capped: true }, "fail" as const]) {
      const c = card((await renderHome({ tripCount: 25, trips: panelRows, tripDates })).html, "trips");
      expect(c.text, JSON.stringify(tripDates).slice(0, 40)).toContain(fill(home.count, { n: 25 }));
      expect(c.text).not.toContain(fill(dates.short as string, { month: 9, day: 28, weekday: weekday(1) }));
    }
  });

  test("🔴 다가오는 운행의 여러 날 운행(리뷰 P2-3) — '10/4(일)~10/5(월)' 과 '1박 2일' · 당일 운행은 그대로", async () => {
    const multi = { ...TRIPS[0], id: "e3e3e3e3-7425-40de-944b-e07fc1f90ae3", trip_type: "round", depart_at: "2026-10-03T22:30:00.000Z", return_at: "2026-10-05T11:00:00.000Z" }; // 10/4 07:30 → 10/5 20:00
    const { html } = await renderHome({ trips: [TRIPS[0], multi], tripCount: 2 });
    const section = /<section[^>]*data-testid="admin-home-trips"[^>]*>([\s\S]*?)<\/section>/.exec(html)![1];
    const rows = [...section.matchAll(/<li[^>]*data-trip-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)];
    const m = rows.find((r) => r[1] === multi.id)!;
    const d = (month: number, day: number, w: number) => fill(dates.short as string, { month, day, weekday: weekday(w) });
    expect(text(m[2])).toContain(fill(dates.range as string, { from: d(10, 4, 0), to: d(10, 5, 1) }));
    expect(text(m[2])).toContain(fill(res.stay, { nights: 1, days: 2 }));
    const one = rows.find((r) => r[1] === TRIPS[0].id)!;
    expect(text(one[2])).not.toContain("~");
    expect(text(one[2])).not.toMatch(/\d박/);
  });

  test("다가오는 운행이 없으면 거짓 없는 한 줄 · 못 읽으면 모름", async () => {
    expect(text((await renderHome({ trips: [], tripCount: 0 })).html)).toContain(homeObj("trips").none);
    const failed = await renderHome({ trips: "fail" });
    expect(/<section[^>]*data-testid="admin-home-trips"[^>]*>([\s\S]*?)<\/section>/.exec(failed.html)![1]).toContain(home.unknown);
  });

  test("🔴 홈페이지 점검 — 허브와 같은 조회·같은 말 · [만들기]/[공지 쓰기]/[노선 확인하기] · 금액은 **비어 있는지만** 센다(가격 계산 0)", async () => {
    const { html } = await renderHome({});
    const p = checkRow(html, "popups");
    expect(p.text).toContain(hub.popups.noneLive);
    expect(p.links).toEqual([expect.objectContaining({ href: "/admin/popups#popup-title", text: homeObj("check").popupsMake })]);
    const n = checkRow(html, "notices");
    // 마지막 게시일은 관리자 날짜 틀(P5-23 라운드 2 A-3 — 원형 "2026-09-25" 대신 "9월 25일 (금)" · 기준 시각이 2026년이라 연도 없음).
    // 줄은 조각 줄이다(라운드 3) — 문장의 " · " 는 조각 사이 CSS 장식이 되어 DOM 글자로는 빈칸 하나다.
    const asSegments = (s: string) => s.split(" · ").join(" ");
    expect(n.text).toContain(asSegments(fill(hub.notices.live, { n: 1, date: "9월 25일 (금)" })));
    expect(n.text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(n.text, "구분점은 DOM 글자가 아니다").not.toContain(" · ");
    expect(n.links).toEqual([expect.objectContaining({ href: "/admin/notices#notice-title", text: homeObj("check").noticesWrite })]);
    const r = checkRow(html, "routes");
    expect(r.text).toContain(asSegments(fill(hub.routes.noPrice, { total: 3, live: 2, n: 1 })));
    expect(attr(r.tag, "data-warn")).toBe("true");
    expect(r.links).toEqual([expect.objectContaining({ href: "/admin/routes", text: homeObj("check").routesCheck })]);
  });

  test("점검 — 노출 중 팝업이 있으면 [팝업 보기] · 금액이 다 있으면 경고 아님 · 못 읽은 줄은 '불러오지 못했어요'", async () => {
    const { html } = await renderHome({ popups: [POPUP(1, true)], routes: [ROUTE(1, true, 400000)], notices: "fail" });
    expect(checkRow(html, "popups").text).toContain(fill(hub.popups.live, { n: 1 }));
    expect(checkRow(html, "popups").links[0].text).toBe(homeObj("check").popupsView);
    expect(attr(checkRow(html, "routes").tag, "data-warn")).toBeNull();
    expect(checkRow(html, "notices").text).toContain(hub.unknown);
  });

  test("🔴 이번 달 접수·확정 한 줄 → 통계 링크 · 통계와 같은 기간으로 센다 · 무거운 0022 집계를 부르지 않는다", async () => {
    const { html } = await renderHome({ month: { total: 8, confirmed: 3 } });
    const m = homeObj("month");
    expect(links(html)).toContainEqual(expect.objectContaining({ href: "/admin/stats", text: `${fill(m.line, { intake: 8, confirmed: 3 })} ${m.link}` }));
    expect(vi.mocked(countCreatedBetween)).toHaveBeenCalledWith(monthWindow(NOW));
    expect(codeOf(HOME)).not.toMatch(/getAdminStats|admin_stats/);
    expect(text((await renderHome({ month: "fail" })).html)).toContain(m.unknown);
  });
});

// =============================================================================
// 4. 게이트 — 첫 문장 · 조회는 그 뒤에 동시에
// =============================================================================
describe("4. 게이트 · 동시 조회", () => {
  test("정적 — 첫 문장 게이트 한 줄 · 조회는 Promise.allSettled 한 번 · 한글 리터럴 0 · 자기 loading 없음", () => {
    const src = codeOf(HOME);
    expect(src).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
    expect(src.split("\n").filter((l) => /\brequireAdmin\s*\(/.test(l)).map((l) => l.trim())).toEqual(["await requireAdmin();"]);
    expect(src).toMatch(/Promise\.allSettled\(/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });

  test("🔴 조회는 게이트가 끝난 뒤에 시작하고, 서로 기다리지 않는다(문 하나에 전부 도착해야 열린다)", async () => {
    vi.resetModules();
    const names = [
      "countNewReservations",
      "countNewByIntake",
      "countOverdueNew",
      "getHomeSendAlerts",
      "countConfirmedDeparting",
      "listConfirmedDeparting",
      "listConfirmedDepartDates",
      "listReservations",
      "listAdminPopups",
      "listAdminNotices",
      "listAdminRoutes",
      "countCreatedBetween",
      "getVehicles",
    ];
    let gateDone = false;
    const beforeGate: string[] = [];
    let arrived = 0;
    let release!: () => void;
    const opened = new Promise<void>((r) => {
      release = r;
    });
    const wait = <T,>(name: string, v: T) => async () => {
      if (!gateDone) beforeGate.push(name);
      arrived += 1;
      if (arrived >= names.length) release();
      await Promise.race([opened, new Promise((_, rej) => setTimeout(() => rej(new Error(`${name}: 직렬로 줄 서 있다`)), 3000))]);
      return v;
    };
    vi.doMock("@/lib/auth/requireAdmin", () => ({
      requireAdmin: async () => {
        await new Promise((r) => setTimeout(r, 5));
        gateDone = true;
        return { userId: "u", email: "e" };
      },
    }));
    vi.doMock("@/lib/admin/reservations", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/reservations")),
      countNewReservations: wait("countNewReservations", 0),
      countNewByIntake: wait("countNewByIntake", { quick: 0, wizard: 0 }),
      countOverdueNew: wait("countOverdueNew", 0),
      countConfirmedDeparting: wait("countConfirmedDeparting", 0),
      listConfirmedDeparting: wait("listConfirmedDeparting", []),
      listConfirmedDepartDates: wait("listConfirmedDepartDates", { departAts: [], capped: false }),
      listReservations: wait("listReservations", { items: [], hasMore: false, nextCursor: null }),
      countCreatedBetween: wait("countCreatedBetween", { total: 0, confirmed: 0 }),
    }));
    vi.doMock("@/lib/admin/notifications", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/notifications")),
      getHomeSendAlerts: wait("getHomeSendAlerts", { customerFailed: 0, ownerFailed: 0, windowDays: 7 }),
    }));
    vi.doMock("@/lib/admin/popups", async () => ({ ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/popups")), listAdminPopups: wait("listAdminPopups", []) }));
    vi.doMock("@/lib/admin/notices", async () => ({ ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/notices")), listAdminNotices: wait("listAdminNotices", []) }));
    vi.doMock("@/lib/admin/routes", async () => ({ ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/routes")), listAdminRoutes: wait("listAdminRoutes", []) }));
    vi.doMock("@/lib/queries", () => ({ getVehicles: wait("getVehicles", []) }));
    try {
      const page = (await import("@/app/admin/(protected)/page")) as { default: () => Promise<ReactElement> };
      renderToStaticMarkup(await page.default());
      expect(beforeGate, "조회가 게이트보다 먼저 시작했다").toEqual([]);
      expect(arrived).toBe(names.length);
    } finally {
      for (const m of ["@/lib/auth/requireAdmin", "@/lib/admin/reservations", "@/lib/admin/notifications", "@/lib/admin/popups", "@/lib/admin/notices", "@/lib/admin/routes", "@/lib/queries"]) vi.doUnmock(m);
      vi.resetModules();
    }
  });
});

// =============================================================================
// 5. 두 숫자 금지 (리뷰 P2-10) — 배지를 화면의 조회 결과로 맞춘다
// =============================================================================
describe("5. 두 숫자 금지 — 메뉴 배지 = 화면이 센 수", () => {
  const b = (n: number) => navBadge(n, (k) => `L${k}`);

  test("🔴 pickNavBadge — 더 새로 센 쪽이 이긴다(같은 때면 화면 쪽) · 화면이 0 이라 하면 배지를 숨긴다 · 보고가 없으면 레이아웃 값", () => {
    expect(pickNavBadge({ badge: b(3), at: 100 }, null)).toEqual(b(3));
    expect(pickNavBadge({ badge: b(3), at: 100 }, { badge: b(4), at: 200 })).toEqual(b(4));
    expect(pickNavBadge({ badge: b(3), at: 100 }, { badge: b(4), at: 100 })).toEqual(b(4));
    expect(pickNavBadge({ badge: b(3), at: 300 }, { badge: b(4), at: 200 })).toEqual(b(3));
    expect(pickNavBadge({ badge: b(3), at: 100 }, { badge: null, at: 200 })).toBeNull();
    expect(pickNavBadge({ badge: null, at: 100 }, { badge: b(2), at: 200 })).toEqual(b(2));
  });

  test("🔴 홈은 자기 새 접수 수를 배지 보고자에 넘긴다 — 카드와 같은 값 · 같은 문장(새 접수 N건)", async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      const { tree } = await renderHome({ newCount: 4 });
      const reports = collect(tree).filter((n) => n.type === NavBadgeReport);
      expect(reports).toHaveLength(1);
      expect(reports[0].props.badge).toEqual({ visible: "4", label: "새 접수 4건" });
      expect(reports[0].props.at).toBe(NOW.getTime());
      const zero = await renderHome({ newCount: 0 });
      expect(collect(zero.tree).find((n) => n.type === NavBadgeReport)?.props.badge).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("보고자 — 'use client' · 레이아웃 효과로 그리기 전에 맞춘다 · 아무것도 그리지 않는다 · 한글 0", () => {
    const src = codeOf(REPORT);
    expect(src.split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    expect(src).toMatch(/createContext/);
    expect(src).toMatch(/useLayoutEffect\(/);
    expect(src).toMatch(/return null;/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    expect(renderToStaticMarkup(createElement(NavBadgeReport, { badge: { visible: "1", label: "L" }, at: 1 }))).toBe("");
  });

  test("🔴 메뉴(AdminTabs)는 배지를 pickNavBadge 한 값으로 두 자리(사이드바·탭 바) 모두 그리고, 보고를 받는 자리(context)를 연다 · 레이아웃은 센 시각을 넘긴다", () => {
    const tabs = codeOf("components/admin/AdminTabs.tsx");
    expect(tabs).toMatch(/pickNavBadge\(/);
    expect(tabs).toMatch(/<NavBadgeReportContext\.Provider value=\{setReported\}>/);
    expect((tabs.match(/<Count badge=\{shownBadge\}/g) ?? []).length).toBe(2);
    expect(tabs).not.toMatch(/<Count badge=\{badge\}/);
    const layout = codeOf("app/admin/(protected)/layout.tsx");
    expect(layout).toMatch(/badgeAt=\{badgeAt\}/);
    expect(layout).toMatch(/const badgeAt = Date\.now\(\);/);
  });
});

// =============================================================================
// 6. 셸 — 휴대폰 위 제목줄 고정 · 공개 사이트 전역 규칙은 그대로 · 메뉴 이름 '발송 기록'
// =============================================================================
/** 주석을 걷은 CSS 의 `선택자 { 본문 }` 쌍 — tests/admin-nav.test.ts 와 같은 방식. */
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

describe("6. 셸 — 위 제목줄 고정 · 공개 사이트 무영향", () => {
  const rules = cssRules(read("components/admin/admin.module.css"));
  const DESKTOP = "(min-width: 1024px)";
  const body = (selector: string, media: string | null = null) =>
    rules
      .filter((r) => r.media === media && r.selector.split(",").map((x) => x.replace(/\s+/g, " ").trim()).includes(selector))
      .map((r) => r.body)
      .join(";");

  // P5-21 은 전역 clip 을 보류했다(붙은 공개 헤더가 ≥960px 지도 윗부분을 가리는 회귀 — P5-21 보고서 ④). P7-4(브리프 §1)가 그 두 결정을
  // 내렸다: 헤더는 붙이고, 지도 sticky top 을 헤더 높이 변수 + 틈으로 내린다(tests/uiux-polish.test.ts §1 이 지도·앵커·토큰을 잠근다).
  // 그래서 전역도 clip 이다 — 앞줄 hidden 은 clip 을 모르는 브라우저용 폴백. 관리자 셸의 clip(아래)은 그대로 둔다(같은 값 · 무해).
  test("🔴 공개 사이트 전역 규칙 — app/globals.css 의 html,body overflow-x: clip(P7-4 · hidden 은 앞줄 폴백뿐) · 관리자 셸 규칙과 같은 값", () => {
    const g = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(g).toMatch(/html,\s*\nbody\s*\{\s*max-width:\s*100vw;\s*overflow-x:\s*hidden;\s*overflow-x:\s*clip;\s*\}/);
  });

  test("🔴 관리자 셸에만 — body 가 스크롤 상자가 되지 않게 overflow-x: clip(:has(.shell) · 로그인·공개 화면 무영향) → 위 제목줄 sticky", () => {
    expect(decl(body(":global(body):has(.shell)"), "overflow-x")).toBe("clip");
    expect(decl(body(".topbar"), "position")).toBe("sticky");
    expect(decl(body(".topbar"), "top")).toBe("0");
    const z = Number(decl(body(".topbar"), "z-index"));
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(Number(decl(body(".tabbar"), "z-index")));
  });

  test("🔴 포커스가 고정된 위 제목줄 밑에 숨지 않는다 — 위 scroll-padding = 제목줄 높이(border-box) + 틈 · 1024px 이상은 되돌린다", () => {
    const h = Number(/^(\d+)px$/.exec(decl(body(".topbar"), "min-height") ?? "")?.[1]);
    expect(h).toBe(56);
    const pad = decl(body(":global(html):has(.shell)"), "scroll-padding-top");
    expect(pad).not.toBeNull();
    expect(pad).toContain(`${h}px`);
    expect(pad).toMatch(/var\(--space-[\w-]+\)/);
    expect(decl(body(":global(html):has(.shell)", DESKTOP), "scroll-padding-top")).toBe("auto");
  });

  test("🔴 메뉴 이름 '문자 기록' → '발송 기록'(그 화면에 메일 행도 있다) — 메뉴 · 화면 제목 · 토스트 링크 · 통계 링크 · 매뉴얼", () => {
    const a = ko.admin as Record<string, Record<string, unknown>>;
    expect((a.tabs as Record<string, string>).notifications).toBe("발송 기록");
    expect((a.notifications as Record<string, string>).title).toBe("발송 기록");
    expect((a.detail as Record<string, string>).toastLink).toBe("발송 기록 보기");
    expect(((a.stats as Record<string, Record<string, string>>).attention).notifyLink).toBe("발송 기록 보기");
    expect(home.bannerLink).toBe("발송 기록 보기");
    const leaves = JSON.stringify(ko.admin);
    expect(leaves).not.toContain("문자 기록");
    const manual = read("docs/ops/admin-manual.md");
    expect(manual).toContain("발송 기록");
    expect(manual).not.toContain("문자 기록");
  });
});

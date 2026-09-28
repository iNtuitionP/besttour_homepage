/**
 * P5-21 — 접수 목록 `/admin/reservations` (브리프 P5-21 §B · 시안 docs/handoff/2026-09-27-admin-ux #list · 제안서 ⑤-2 · ⑦ 1-4).
 *
 * 이 파일이 잠그는 것
 *   1. 모델(components/admin/reservation-list.ts — 순수) — 기본 탭 = 새 접수 · 탭·쪽 파서(관대) · 주소는 상태·쪽만(개인정보 0) ·
 *      72시간 묶음(0022·배지와 같은 경계) · 확정의 지난 운행 묶음(KST 날짜) · 경과("25분 전") · KST 날짜 조각 · 번호 가운데 가림(국내·해외)
 *   2. 조회(lib/admin/reservations.ts) — 탭별 정렬(새 접수 = 오래 기다린 것부터 · 확정 = 출발이 가까운 것부터 · 나머지 = 최근 것부터) ·
 *      "20건 더 보기"는 쪽 수 × 20 을 한 번에 읽는다 · 탭 건수는 head 집계 넷(새 접수는 배지와 **같은 함수**) · 오류는 0 으로 갈음하지 않는다
 *   3. 화면 — 탭 + 건수(새 접수 골드 알약 · 나머지 옅은 알약 · 전체 = 넷의 합) · 행은 한 벌의 마크업(행 전체가 상세 링크 · 전화 버튼은 별개) ·
 *      간편 접수 칩 "간편" + "시각 미정" · "차량 미정"(리뷰 P2-7) · 빈 상태 두 종류 · 옛 68rem 표 없음 · 메뉴 배지와 같은 숫자(리뷰 P2-10)
 *   4. 처리 중 포커스(P5-20 ⑧-1) — "20건 더 보기"는 공용 부품(PendingButton: disabled 대신 aria-disabled + 누름 무시)
 *   5. 수정 라운드(P5-21 리뷰) — 확정 탭은 다가오는 운행만 쪽으로 넘기고 지난 확정은 위에 따로 짧게(P1-1) · 여러 날 운행 표시(P2-3) ·
 *      현재 탭을 탭 줄 안에 보이게(P2-5) · 출발 칸 두 줄(P2-6) · 숫자 없는 번호엔 전화 링크 없음(P2-9) · 행 함수는 서버 전용(P2-12) ·
 *      aria-current="page" 는 사이드바 하나(P2-14)
 *
 * 화면은 서버 컴포넌트를 그대로 그리고(renderToStaticMarkup), 조회 함수만 가짜로 바꾼다. 문구는 진짜 messages/ko.json 이다.
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => "/admin/reservations" }));
vi.mock("@/lib/queries", () => ({
  getVehicles: vi.fn(async () => [{ id: 1, slug: "bus45", nameKo: "45인승", nameEn: "45-seat", capacity: 45, sort: 1, active: true }]),
}));
vi.mock("@/lib/admin/reservations", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/admin/reservations")>();
  return { ...mod, listReservations: vi.fn(), countReservationsByStatus: vi.fn(), listConfirmedPast: vi.fn() };
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

import AdminReservationsPage from "@/app/admin/(protected)/reservations/page";
import { upcomingWindow } from "@/components/admin/dashboard";
import { PendingButton, ignoreWhilePending } from "@/components/admin/PendingButton";
import {
  DEFAULT_LIST_TAB,
  LIST_PAGE_SIZE,
  LIST_TABS,
  MAX_LIST_PAGES,
  PAST_CONFIRMED_SHOWN,
  elapsedSince,
  firstRowIndexOfPage,
  groupListRows,
  kstDayDiff,
  kstParts,
  kstTodayStart,
  listHref,
  listLimit,
  listPhoneText,
  parseListPage,
  parseListTab,
  stayNights,
  telHref,
} from "@/components/admin/reservation-list";
import { BACKLOG_HOURS } from "@/components/admin/status-badge";
import { TabIntoView } from "@/components/admin/TabIntoView";
import {
  LIST_ORDER,
  MAX_ADMIN_PAGE_SIZE,
  RESERVATION_LIST_SELECT,
  countReservationsByStatus,
  listConfirmedPast,
  listReservations,
  type ReservationListRow,
} from "@/lib/admin/reservations";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, Record<string, unknown>>; reservationCheck: Record<string, Record<string, string>> };
const res = ko.admin.reservations as Record<string, unknown> & Record<string, string>;
const resObj = (k: string) => res[k] as unknown as Record<string, string>;
const dates = ko.admin.dates as Record<string, unknown>;
const tabsKo = ko.admin.tabs as Record<string, string>;
const fill = (tpl: string, v: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k]));

const LIST_PAGE = "app/admin/(protected)/reservations/page.tsx";
const MODEL = "components/admin/reservation-list.ts";
const ROW = "components/admin/reservationRow.tsx";
const LOAD_MORE = "components/admin/LoadMore.tsx";
const PENDING = "components/admin/PendingButton.tsx";

const HOUR = 3_600_000;
const MIN = 60_000;
/** 기준 시각 — 2026-09-28(월) 10:00 KST. */
const NOW = new Date("2026-09-28T01:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? null;
const links = (h: string) =>
  [...h.matchAll(/<a\s[^>]*>[\s\S]*?<\/a>/g)].map((m) => ({ tag: /^<a\s[^>]*>/.exec(m[0])![0], href: (attr(m[0], "href") ?? "").replace(/&amp;/g, "&"), text: text(m[0]) }));
/** 행(li) 전체 — 시작 태그의 data-row 로 찾는다. */
const rowsOf = (h: string) => [...h.matchAll(/<li[^>]*data-row-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({ id: m[1], html: m[0] }));
const badgeKinds = (h: string) => [...h.matchAll(/<span[^>]*data-testid="admin-status-badge"[^>]*>/g)].map((m) => attr(m[0], "data-kind"));

const ROW_BASE: ReservationListRow = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  public_code: "QK2345AB",
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
  created_at: ago(25 * MIN),
  confirmed_at: null,
};
const row = (over: Partial<ReservationListRow>): ReservationListRow => ({ ...ROW_BASE, ...over });
const WIZARD = row({
  id: "8c9e6679-7425-40de-944b-e07fc1f90ae8",
  public_code: "WZ2345AB",
  intake: "wizard",
  name: "예시고객나",
  phone: "+821000000002",
  vehicle_slug: "bus45",
  trip_type: "round",
  depart_at: "2026-10-16T22:00:00.000Z", // 10/17(토) 07:00 KST
  return_at: "2026-10-17T10:00:00.000Z",
  bus_count: 2,
  passengers: 80,
  created_at: ago(2 * HOUR),
});
const OVERDUE = row({ id: "9c9e6679-7425-40de-944b-e07fc1f90ae9", public_code: "OD2345AB", name: "예시고객라", phone: "+821000000004", created_at: ago(80 * HOUR) });

// =============================================================================
// 1. 모델 — 탭 · 쪽 · 주소
// =============================================================================
describe("1. 모델 — 탭 · 쪽 · 주소", () => {
  test("탭은 다섯 — 새 접수 · 확정 · 운행 완료 · 취소 · 전체 (시안 순서) · 기본 탭은 새 접수", () => {
    expect([...LIST_TABS]).toEqual(["new", "confirmed", "done", "cancelled", "all"]);
    expect(DEFAULT_LIST_TAB).toBe("new");
    expect(LIST_PAGE_SIZE).toBe(20);
  });

  test("🔴 탭 파서는 관대하다 — 쿼리가 없거나 모르는 값이면 기본 탭(새 접수) · 'all' 은 명시해야 전체", () => {
    expect(parseListTab(undefined)).toBe("new");
    expect(parseListTab("bogus")).toBe("new");
    expect(parseListTab("NEW")).toBe("new");
    expect(parseListTab(["confirmed", "done"])).toBe("new");
    for (const t of LIST_TABS) expect(parseListTab(t)).toBe(t);
  });

  test("쪽 파서 — 1 이상의 정수 · 상한(MAX_LIST_PAGES)에서 멈춘다 · 쓰레기값은 1", () => {
    expect(parseListPage(undefined)).toBe(1);
    expect(parseListPage("2")).toBe(2);
    for (const bad of ["0", "-1", "1.5", "abc", "", "1e3x"]) expect(parseListPage(bad), bad).toBe(1);
    expect(parseListPage(String(MAX_LIST_PAGES + 5))).toBe(MAX_LIST_PAGES);
    expect(listLimit(1)).toBe(20);
    expect(listLimit(3)).toBe(60);
    // 쪽 수 × 20 은 조회 상한 안이다(listReservations 가 거부하지 않는다)
    expect(listLimit(MAX_LIST_PAGES)).toBeLessThanOrEqual(MAX_ADMIN_PAGE_SIZE);
    expect(firstRowIndexOfPage(1)).toBe(0);
    expect(firstRowIndexOfPage(2)).toBe(20);
  });

  test("🔴 주소에는 상태·쪽만 — 기본 탭 첫 쪽은 쿼리 없음 · 개인정보·uuid 가 들어갈 자리가 없다", () => {
    expect(listHref("new")).toBe("/admin/reservations");
    expect(listHref("new", 1)).toBe("/admin/reservations");
    expect(listHref("new", 2)).toBe("/admin/reservations?page=2");
    expect(listHref("confirmed")).toBe("/admin/reservations?status=confirmed");
    expect(listHref("all", 3)).toBe("/admin/reservations?status=all&page=3");
    for (const t of LIST_TABS) {
      for (const p of [1, 2, MAX_LIST_PAGES]) {
        const u = new URL(listHref(t, p), "http://x");
        expect(u.pathname).toBe("/admin/reservations");
        for (const k of u.searchParams.keys()) expect(["status", "page"]).toContain(k);
      }
    }
  });
});

// =============================================================================
// 2. 조회 — 탭별 정렬 · 쪽 수만큼 한 번에 · 탭 건수
// =============================================================================
function fakeClient(result: { data?: unknown; error: { code?: string; message: string } | null; count?: number | null }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lt", "not", "order", "range", "limit", "overrideTypes"]) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    };
  }
  chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: result.data ?? null, error: result.error, count: result.count ?? null }).then(ok, bad);
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

describe("2. 조회 — 탭별 정렬", () => {
  test("🔴 정렬 정의 — 새 접수 = 오래 기다린 것부터 · 확정 = 출발이 가까운 것부터 · 운행 완료·취소·전체 = 최근 것부터 (동률은 id)", () => {
    expect(LIST_ORDER.new).toEqual([
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ]);
    expect(LIST_ORDER.confirmed).toEqual([
      { column: "depart_at", ascending: true },
      { column: "id", ascending: true },
    ]);
    for (const s of ["done", "cancelled", "all"] as const) {
      expect(LIST_ORDER[s], s).toEqual([
        { column: "created_at", ascending: false },
        { column: "id", ascending: false },
      ]);
    }
  });

  test.each([
    ["new", [["created_at", { ascending: true }], ["id", { ascending: true }]]],
    ["confirmed", [["depart_at", { ascending: true }], ["id", { ascending: true }]]],
    ["done", [["created_at", { ascending: false }], ["id", { ascending: false }]]],
    ["all", [["created_at", { ascending: false }], ["id", { ascending: false }]]],
  ] as const)("listReservations(%s) 가 그 정렬로 읽는다", async (status, orders) => {
    const real = await vi.importActual<typeof import("@/lib/admin/reservations")>("@/lib/admin/reservations");
    const { client, calls } = fakeClient({ data: [], error: null });
    await real.listReservations({ status, limit: 40 }, client as never);
    expect(calls.filter((c) => c.method === "order").map((c) => c.args)).toEqual(orders);
    // limit + 1 건 — hasMore 판정(count 쿼리 없음)
    expect(calls.find((c) => c.method === "range")?.args).toEqual([0, 40]);
  });

  test("🔴 확정 탭 목록은 다가오는 운행만(리뷰 P1-1) — departFrom 을 주면 depart_at ≥ 그 시각 · 출발 순 · 확정이 아닌 상태나 날짜가 아닌 값은 DB 를 부르지 않고 던진다", async () => {
    const real = await vi.importActual<typeof import("@/lib/admin/reservations")>("@/lib/admin/reservations");
    const cutoff = kstTodayStart(NOW);
    const { client, calls } = fakeClient({ data: [], error: null });
    await real.listReservations({ status: "confirmed", limit: 20, departFrom: cutoff }, client as never);
    expect(calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["status", "confirmed"]]);
    expect(calls.filter((c) => c.method === "gte").map((c) => c.args)).toEqual([["depart_at", cutoff]]);
    expect(calls.filter((c) => c.method === "order").map((c) => c.args)).toEqual([
      ["depart_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    for (const bad of [
      { status: "new" as const, limit: 20, departFrom: cutoff },
      { status: "all" as const, limit: 20, departFrom: cutoff },
      { status: "confirmed" as const, limit: 20, departFrom: "yesterday" },
    ]) {
      const f = fakeClient({ data: [], error: null });
      await expect(real.listReservations(bad, f.client as never), JSON.stringify(bad)).rejects.toThrow();
      expect(f.calls, JSON.stringify(bad)).toEqual([]);
    }
  });

  test("🔴 지난 확정(리뷰 P1-1) — depart_at < 경계 · 최근 것부터(depart_at desc · id desc) · limit 건 + 전체 건수(count exact — 한 번의 요청) · 목록 화이트리스트", async () => {
    const real = await vi.importActual<typeof import("@/lib/admin/reservations")>("@/lib/admin/reservations");
    const cutoff = kstTodayStart(NOW);
    const { client, calls } = fakeClient({ data: [WIZARD], error: null, count: 26 });
    const got = await real.listConfirmedPast(cutoff, PAST_CONFIRMED_SHOWN, client as never);
    expect(got).toEqual({ items: [WIZARD], total: 26 });
    expect(calls.filter((c) => c.method === "from").map((c) => c.args)).toEqual([["reservations"]]);
    expect(calls.filter((c) => c.method === "select").map((c) => c.args)).toEqual([[RESERVATION_LIST_SELECT, { count: "exact" }]]);
    expect(calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["status", "confirmed"]]);
    expect(calls.filter((c) => c.method === "lt").map((c) => c.args)).toEqual([["depart_at", cutoff]]);
    expect(calls.filter((c) => c.method === "order").map((c) => c.args)).toEqual([
      ["depart_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(calls.filter((c) => c.method === "limit").map((c) => c.args)).toEqual([[PAST_CONFIRMED_SHOWN]]);
    expect(PAST_CONFIRMED_SHOWN).toBe(5);
    // 모름은 0 이 아니다 — 오류·빈 count 는 던진다
    await expect(real.listConfirmedPast(cutoff, 5, fakeClient({ data: [], error: { code: "42501", message: "denied" } }).client as never)).rejects.toThrow(/42501/);
    await expect(real.listConfirmedPast(cutoff, 5, fakeClient({ data: [], error: null, count: null }).client as never)).rejects.toThrow();
    for (const [before, limit] of [
      ["x", 5],
      [cutoff, 0],
      [cutoff, MAX_ADMIN_PAGE_SIZE + 1],
    ] as const) {
      const f = fakeClient({ data: [], error: null, count: 0 });
      await expect(real.listConfirmedPast(before, limit, f.client as never)).rejects.toThrow();
      expect(f.calls).toEqual([]);
    }
  });
});

describe("2-b. 조회 — 탭 건수(head 집계 넷)", () => {
  function countingClient(counts: Record<string, number | null>, error: { code: string; message: string } | null = null) {
    const calls: { status: string | null; head: boolean }[] = [];
    return {
      calls,
      client: {
        from: () => {
          let status: string | null = null;
          let head = false;
          const chain: Record<string, unknown> = {
            select: (_c: string, o?: { head?: boolean }) => {
              head = Boolean(o?.head);
              return chain;
            },
            eq: (col: string, v: string) => {
              if (col === "status") status = v;
              return chain;
            },
            then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
              calls.push({ status, head });
              return Promise.resolve({ count: error ? null : (counts[status ?? ""] ?? null), error }).then(ok, bad);
            },
          };
          return chain;
        },
      },
    };
  }

  // 화면 테스트용으로 목록·건수 함수를 모의로 바꿔 두었으므로 여기서는 실제 구현을 부른다
  const real = () => vi.importActual<typeof import("@/lib/admin/reservations")>("@/lib/admin/reservations");

  test("🔴 상태 넷을 head 집계로 센다(행은 오지 않는다) · 새 접수는 배지와 같은 countNewReservations 경로", async () => {
    const { client, calls } = countingClient({ new: 4, confirmed: 2, done: 1, cancelled: 1 });
    const got = await (await real()).countReservationsByStatus(client as never);
    expect(got).toEqual({ new: 4, confirmed: 2, done: 1, cancelled: 1 });
    expect(calls.map((c) => c.status).sort()).toEqual(["cancelled", "confirmed", "done", "new"]);
    expect(calls.every((c) => c.head)).toBe(true);
    // 정적 — 새 접수 건수는 countNewReservations 를 부른다(정의를 두 벌 두지 않는다)
    expect(codeOf("lib/admin/reservations.ts")).toMatch(/countReservationsByStatus[\s\S]*countNewReservations\(/);
  });

  test("🔴 오류·빈 count 는 0 으로 갈음하지 않는다 — 던진다(화면은 그 알약만 숨긴다)", async () => {
    const lib = await real();
    await expect(lib.countReservationsByStatus(countingClient({}, { code: "42501", message: "denied" }).client as never)).rejects.toThrow();
    await expect(lib.countReservationsByStatus(countingClient({ new: 1, confirmed: null, done: 0, cancelled: 0 }).client as never)).rejects.toThrow();
  });
});

// =============================================================================
// 3. 모델 — 묶음 · 경과 · 날짜 · 번호 가림
// =============================================================================
describe("3. 모델 — 72시간 묶음 · 확정 탭 경계", () => {
  test("🔴 새 접수 — 72시간이 **넘은** 것은 '답이 늦은 접수' 묶음(맨 위) · 딱 72시간은 아직 아니다(0022·배지와 같은 경계)", () => {
    const exact = row({ id: "a1", created_at: ago(BACKLOG_HOURS * HOUR) });
    const over = row({ id: "a2", created_at: ago(BACKLOG_HOURS * HOUR + 1) });
    const fresh = row({ id: "a3", created_at: ago(HOUR) });
    const groups = groupListRows("new", [over, exact, fresh], NOW);
    expect(groups.map((g) => g.kind)).toEqual(["overdue", "waiting"]);
    expect(groups[0].items.map((i) => i.row.id)).toEqual(["a2"]);
    expect(groups[1].items.map((i) => [i.row.id, i.index])).toEqual([
      ["a1", 1],
      ["a3", 2],
    ]);
    expect(groupListRows("new", [exact, fresh], NOW).map((g) => g.kind)).toEqual(["plain"]);
    expect(groupListRows("new", [over], NOW).map((g) => g.kind)).toEqual(["overdue"]);
    expect(groupListRows("new", [], NOW)).toEqual([]);
  });

  test("🔴 확정 — 목록에는 다가오는 운행만 오므로 묶지 않는다(지난 확정은 위에 따로 — 리뷰 P1-1) · 경계 = KST 오늘 00:00 = 관리 홈 '이번 주 운행' 창의 시작", () => {
    const today = row({ id: "t", status: "confirmed", depart_at: "2026-09-27T23:00:00.000Z" }); // 9/28 08:00 KST — 지금(10:00)보다 앞이지만 오늘
    const later = row({ id: "l", status: "confirmed", depart_at: "2026-09-30T05:30:00.000Z" });
    expect(groupListRows("confirmed", [today, later], NOW).map((g) => [g.kind, g.items.map((i) => i.row.id)])).toEqual([["plain", ["t", "l"]]]);
    // 경계 — KST 달력의 오늘 00:00(UTC 날짜가 전날인 새벽에도)
    expect(kstTodayStart(NOW)).toBe("2026-09-27T15:00:00.000Z");
    expect(kstTodayStart(new Date("2026-09-27T15:00:00.000Z"))).toBe("2026-09-27T15:00:00.000Z");
    expect(kstTodayStart(new Date("2026-09-27T14:59:59.999Z"))).toBe("2026-09-26T15:00:00.000Z");
    // 오늘 출발(시각이 지났어도)은 다가오는 쪽이다 — 경계보다 뒤
    expect(today.depart_at >= kstTodayStart(NOW)).toBe(true);
    // 관리 홈 '이번 주 운행'(→ 확정 탭 링크)과 같은 경계 — 카드의 운행은 늘 이 탭의 쪽 1 맨 앞에 있다
    for (const now of [NOW, new Date("2026-09-27T15:30:00.000Z"), new Date("2026-12-31T14:59:00.000Z"), new Date("2026-12-31T15:00:00.000Z")]) {
      expect(upcomingWindow(now).from, now.toISOString()).toBe(kstTodayStart(now));
    }
  });

  test("운행 완료 · 취소 · 전체 — 묶지 않는다", () => {
    for (const t of ["done", "cancelled", "all"] as const) expect(groupListRows(t, [OVERDUE, WIZARD], NOW).map((g) => g.kind), t).toEqual(["plain"]);
  });
});

describe("3-b. 모델 — 경과 · KST 날짜", () => {
  test("경과 — 1분 안 '방금' · 분 · 시간 · 날(24시간 내림 — 배지의 N일째와 같은 계산) · 미래 시각은 방금 · 읽을 수 없으면 null", () => {
    expect(elapsedSince(ago(30_000), NOW)).toEqual({ unit: "justNow" });
    expect(elapsedSince(ago(59_999), NOW)).toEqual({ unit: "justNow" });
    expect(elapsedSince(ago(MIN), NOW)).toEqual({ unit: "minutes", n: 1 });
    expect(elapsedSince(ago(25 * MIN), NOW)).toEqual({ unit: "minutes", n: 25 });
    expect(elapsedSince(ago(HOUR - 1), NOW)).toEqual({ unit: "minutes", n: 59 });
    expect(elapsedSince(ago(HOUR), NOW)).toEqual({ unit: "hours", n: 1 });
    expect(elapsedSince(ago(24 * HOUR - 1), NOW)).toEqual({ unit: "hours", n: 23 });
    expect(elapsedSince(ago(24 * HOUR), NOW)).toEqual({ unit: "days", n: 1 });
    expect(elapsedSince(ago(72 * HOUR + 1), NOW)).toEqual({ unit: "days", n: 3 });
    expect(elapsedSince(new Date(NOW.getTime() + 5 * MIN).toISOString(), NOW)).toEqual({ unit: "justNow" });
    expect(elapsedSince("garbage", NOW)).toBeNull();
  });

  test("🔴 KST 날짜 조각 — UTC 날짜가 전날이어도 KST 날짜 · 요일(0=일) · 시각은 두 자리", () => {
    expect(kstParts("2026-09-27T15:00:00.000Z")).toEqual({ dateKey: "2026-09-28", year: 2026, month: 9, day: 28, weekday: 1, hour: "00", minute: "00" });
    expect(kstParts("2026-10-04T15:30:00.000Z")).toEqual({ dateKey: "2026-10-05", year: 2026, month: 10, day: 5, weekday: 1, hour: "00", minute: "30" });
    expect(kstParts(new Date("2026-10-16T22:00:00.000Z"))?.hour).toBe("07");
    expect(kstParts("nope")).toBeNull();
  });

  test("출발까지 남은 날(KST 달력) — 오늘 0 · 내일 1 · 어제 -1 (지금 시각과 무관)", () => {
    expect(kstDayDiff("2026-09-27T23:00:00.000Z", NOW)).toBe(0);
    expect(kstDayDiff("2026-09-28T15:00:00.000Z", NOW)).toBe(1);
    expect(kstDayDiff("2026-09-26T23:00:00.000Z", NOW)).toBe(-1);
    expect(kstDayDiff("bad", NOW)).toBeNull();
  });

  test("🔴 여러 날 운행(리뷰 P2-3) — 돌아오는 날(return_at)의 KST 달력으로 N박 · 같은 날·없음·앞선 값·읽을 수 없는 값은 null(지어내지 않는다)", () => {
    // 상세 접수: 10/17(토) 07:00 → 10/18(일) 19:00 KST = 1박
    expect(stayNights("2026-10-16T22:00:00.000Z", "2026-10-18T10:00:00.000Z")).toBe(1);
    // 간편 접수: 날짜만(00:00 자리값) — 10/10 → 10/12 = 2박
    expect(stayNights("2026-10-09T15:00:00.000Z", "2026-10-11T15:00:00.000Z")).toBe(2);
    // KST 자정을 넘는 경계 — UTC 날짜로 세면 틀린다(10/10 23:30 → 10/11 00:30 KST 는 1박)
    expect(stayNights("2026-10-10T14:30:00.000Z", "2026-10-10T15:30:00.000Z")).toBe(1);
    // 당일 왕복 · 돌아오는 날 없음 · 거꾸로 · 쓰레기
    expect(stayNights("2026-10-16T22:00:00.000Z", "2026-10-17T10:00:00.000Z")).toBeNull();
    expect(stayNights("2026-10-16T22:00:00.000Z", null)).toBeNull();
    expect(stayNights("2026-10-16T22:00:00.000Z", "2026-10-14T10:00:00.000Z")).toBeNull();
    expect(stayNights("bad", "2026-10-18T10:00:00.000Z")).toBeNull();
  });
});

describe("3-c. 모델 — 번호 가운데 가림(목록 표시) · 전화 버튼은 전체 번호", () => {
  test("🔴 국내 휴대전화(+82 01x) — 010-****-0004 (가운데 넷)", () => {
    expect(listPhoneText("+821000000004")).toBe("010-****-0004");
    expect(listPhoneText("+82 10 1234 5678")).toBe("010-****-5678");
  });

  test("🔴 해외 번호 · +82 유선 — '+' 와 끝 네 자리만(국가번호·길이는 가린다)", () => {
    expect(listPhoneText("+15551234567")).toBe("+****-4567");
    expect(listPhoneText("+447911123456")).toBe("+****-3456");
    expect(listPhoneText("+8221234567")).toBe("+****-4567");
  });

  test("국내 표기로 저장된 옛 값은 국내 규칙 · 모르는 모양은 아무 숫자도 내보내지 않는다(***)", () => {
    expect(listPhoneText("010-0000-0007")).toBe("010-****-0007");
    for (const bad of ["", "abc", "12345", "+1"]) expect(listPhoneText(bad), bad).toBe("***");
  });

  test("전화 버튼의 tel: 은 전체 번호(숫자와 + 만)", () => {
    expect(telHref("+821000000004")).toBe("tel:+821000000004");
    expect(telHref("010-0000-0007")).toBe("tel:01000000007");
    expect(telHref("+1 555 123 4567")).toBe("tel:+15551234567");
  });

  test("🔴 숫자가 하나도 없으면 전화 링크를 만들지 않는다(리뷰 P2-9 — 'tel:' 만 남은 링크는 누르면 아무 데도 안 간다)", () => {
    for (const bad of ["", "   ", "abc", "+", "-- --", "+-"]) expect(telHref(bad), JSON.stringify(bad)).toBeNull();
    expect(telHref(null as unknown as string)).toBeNull();
  });
});

// =============================================================================
// 4. 화면 — /admin/reservations
// =============================================================================
async function renderTree(
  params: Record<string, string>,
  opts: { items?: ReservationListRow[]; hasMore?: boolean; counts?: Record<string, number> | "fail"; past?: { items: ReservationListRow[]; total: number } | "fail" } = {},
) {
  vi.mocked(listReservations).mockResolvedValue({ items: opts.items ?? [], hasMore: opts.hasMore ?? false, nextCursor: null });
  if (opts.counts === "fail") vi.mocked(countReservationsByStatus).mockRejectedValue(new Error("count failed"));
  else vi.mocked(countReservationsByStatus).mockResolvedValue((opts.counts ?? { new: 4, confirmed: 2, done: 1, cancelled: 1 }) as never);
  if (opts.past === "fail") vi.mocked(listConfirmedPast).mockRejectedValue(new Error("past failed"));
  else vi.mocked(listConfirmedPast).mockResolvedValue(opts.past ?? { items: [], total: 0 });
  const tree = (await AdminReservationsPage({ searchParams: Promise.resolve(params) })) as ReactElement;
  return { tree, html: renderToStaticMarkup(tree) };
}
async function render(...args: Parameters<typeof renderTree>) {
  return (await renderTree(...args)).html;
}
/** 서버 트리에서 특정 부품을 찾는다(클라이언트 부품의 props 확인용). */
function collect(node: unknown, out: { type: unknown; props: Record<string, unknown> }[] = []) {
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
/** 확정 행 — 상세 접수(시각·차량이 있다). */
const confirmedRow = (id: string, depart_at: string, over: Partial<ReservationListRow> = {}) =>
  row({ id, status: "confirmed", intake: "wizard", vehicle_slug: "bus45", bus_count: 1, trip_type: "oneway", depart_at, confirmed_at: ago(HOUR), ...over });
const uuidN = (n: number, lead = "c") => `${lead.repeat(8)}-7425-40de-944b-${String(n).padStart(12, "0")}`;

describe("4. 화면 — 기본 탭 · 탭 건수", () => {
  // 화면은 요청의 시각 하나(new Date())로 경과·72시간을 잰다 — Date 만 기준 시각에 고정한다(타이머는 진짜)
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  test("🔴 쿼리 없는 /admin/reservations 는 새 접수 탭 — 새 접수를 쪽 1(20건)만큼 읽는다", async () => {
    await render({});
    expect(vi.mocked(listReservations)).toHaveBeenCalledWith({ status: "new", limit: 20 });
    await render({ status: "all", page: "2" });
    expect(vi.mocked(listReservations)).toHaveBeenLastCalledWith({ status: "all", limit: 40 });
  });

  test("🔴 탭 다섯 + 건수 — 새 접수는 골드 알약(배지와 같은 수) · 나머지는 옅은 알약 · 전체 = 넷의 합 · 현재 탭 aria-current='true'(리뷰 P2-14 — 'page' 는 사이드바 하나)", async () => {
    const html = await render({});
    const tabs = links(html).filter((l) => attr(l.tag, "data-tab") !== null);
    expect(tabs.map((l) => attr(l.tag, "data-tab"))).toEqual(["new", "confirmed", "done", "cancelled", "all"]);
    expect(tabs.map((l) => l.href)).toEqual(["/admin/reservations", "/admin/reservations?status=confirmed", "/admin/reservations?status=done", "/admin/reservations?status=cancelled", "/admin/reservations?status=all"]);
    expect(tabs.filter((l) => attr(l.tag, "aria-current") === "true").map((l) => attr(l.tag, "data-tab"))).toEqual(["new"]);
    // 이 화면은 aria-current="page" 를 그리지 않는다 — 한 문서에 하나(레이아웃의 사이드바 '접수')
    expect(html).not.toMatch(/aria-current="page"/);
    expect(codeOf("components/admin/admin.module.css")).toMatch(/\.statusTab\[aria-current="true"\]/);
    expect(codeOf("components/admin/admin.module.css")).not.toMatch(/\.statusTab\[aria-current="page"\]/);
    const pills = [...html.matchAll(/<span[^>]*data-testid="admin-tab-count"[^>]*>([^<]*)<\/span>/g)].map((m) => [attr(m[0], "data-tone"), m[1]]);
    expect(pills).toEqual([
      ["attention", "4"],
      ["plain", "2"],
      ["plain", "1"],
      ["plain", "1"],
      ["plain", "8"],
    ]);
    // 스크린리더 — "새 접수 4건"(보이는 숫자는 aria-hidden)
    expect(text(tabs[0].text)).toContain(fill(res.tabCount, { n: 4 }));
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*data-testid="admin-tab-count"/);
  });

  test("🔴 휴대폰에서 현재 탭을 탭 줄 안에 보이게(리뷰 P2-5) — TabIntoView 가 탭 줄(id)에서 aria-current='true' 탭을 inline: 'nearest' 로 민다 · 아무것도 그리지 않는다", async () => {
    const { tree, html } = await renderTree({ status: "all" }, { items: [WIZARD] });
    const nav = /<nav[^>]*aria-label="[^"]*"[^>]*>/.exec(html.slice(html.indexOf("<nav")))?.[0] ?? "";
    const navId = attr(nav, "id");
    expect(navId).toBeTruthy();
    const found = collect(tree).filter((n) => n.type === TabIntoView);
    expect(found).toHaveLength(1);
    expect(found[0].props).toEqual({ navId, current: "all" });
    const src = codeOf("components/admin/TabIntoView.tsx");
    expect(src.split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    expect(src).toMatch(/\[aria-current="true"\]/);
    expect(src).toMatch(/scrollIntoView\(\{\s*inline:\s*"nearest",\s*block:\s*"nearest"\s*\}\)/);
    expect(src).toMatch(/useEffect\(/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    expect(renderToStaticMarkup(createElement(TabIntoView, { navId: "x", current: "all" }))).toBe("");
  });

  test("건수를 못 세면 알약만 숨긴다 — 0 이라고 그리지 않고, 목록은 그대로 열린다", async () => {
    const html = await render({}, { items: [WIZARD], counts: "fail" });
    expect(html).not.toMatch(/data-testid="admin-tab-count"/);
    expect(rowsOf(html)).toHaveLength(1);
  });

  test("🔴 두 숫자 금지(리뷰 P2-10) — 새 접수 건수를 메뉴 배지 보고자(NavBadgeReport)에 같은 값으로 넘긴다 · 못 세면 넘기지 않는다", () => {
    const src = codeOf(LIST_PAGE);
    expect(src).toMatch(/<NavBadgeReport\b/);
    expect(src).toMatch(/navBadge\(/);
    expect(src).toMatch(/countReservationsByStatus\(\)/);
  });
});

describe("4-b. 화면 — 행 한 벌 · 간편 접수 · 가린 번호 · 전화 버튼", () => {
  // 화면은 요청의 시각 하나(new Date())로 경과·72시간을 잰다 — Date 만 기준 시각에 고정한다(타이머는 진짜)
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  test("🔴 행 = li 하나 — 행 전체가 상세 링크(uuid) · 전화 버튼은 별개의 tel: 링크(전체 번호 · 이름이 든 접근 이름)", async () => {
    const html = await render({}, { items: [WIZARD] });
    const [r] = rowsOf(html);
    expect(r.id).toBe(WIZARD.id);
    const ls = links(r.html);
    expect(ls).toHaveLength(2);
    expect(ls[0].href).toBe(`/admin/reservations/${WIZARD.id}`);
    expect(attr(ls[0].tag, "data-row-index")).toBe("0");
    expect(ls[1].href).toBe("tel:+821000000002");
    expect(attr(ls[1].tag, "aria-label")).toBe(fill(res.callAria, { name: WIZARD.name }));
    // 상세 링크의 주소에는 uuid 뿐 — 이름·번호가 없다
    expect(ls[0].href).not.toMatch(/0000000002|예시/);
  });

  test("🔴 B-2(P5-22 · 리뷰 P2-13) — 행 링크는 들어온 탭·쪽을 싣는다(상태·쪽만 · 기본 탭 첫 쪽은 쿼리 없음) — 상세의 '← 접수 목록' 이 그리로 돌아간다", async () => {
    const conf = confirmedRow(uuidN(5), "2026-09-30T05:30:00.000Z");
    const html = await render({ status: "confirmed", page: "2" }, { items: [conf] });
    const [r] = rowsOf(html);
    expect(links(r.html)[0].href).toBe(`/admin/reservations/${conf.id}?from=confirmed&page=2`);
    const plain = rowsOf(await render({}, { items: [WIZARD] }))[0];
    expect(links(plain.html)[0].href).toBe(`/admin/reservations/${WIZARD.id}`);
    const all = rowsOf(await render({ status: "all" }, { items: [WIZARD] }))[0];
    expect(links(all.html)[0].href).toBe(`/admin/reservations/${WIZARD.id}?from=all`);
    // 지난 확정 칸의 행도 같은 탭에서 들어간다
    const past = confirmedRow(uuidN(6, "d"), "2026-09-26T23:00:00.000Z");
    const withPast = await render({ status: "confirmed" }, { items: [conf], past: { items: [past], total: 1 } });
    const pastRow = rowsOf(withPast).find((x) => x.id === past.id)!;
    expect(links(pastRow.html)[0].href).toBe(`/admin/reservations/${past.id}?from=confirmed`);
    // 주소에는 이름·번호가 없다 — 경로는 uuid, 쿼리 키는 from·page 뿐
    for (const h of [links(r.html)[0].href, links(all.html)[0].href]) {
      const u = new URL(h, "http://x.test");
      expect(u.pathname).toMatch(/^\/admin\/reservations\/[0-9a-f-]{36}$/);
      expect([...u.searchParams.keys()].every((k) => k === "from" || k === "page"), h).toBe(true);
      expect(h).not.toMatch(/예시|821000000001/);
    }
  });

  test("🔴 목록의 번호는 가운데를 가린다 — 전체 번호는 tel: 안에만", async () => {
    const html = await render({}, { items: [WIZARD] });
    const t = text(html);
    expect(t).toContain("010-****-0002");
    expect(t).not.toContain("0000000002");
    expect(t).not.toContain("010-0000-0002");
  });

  test("상세 접수 행 — 상태 · 이름 · 구간(운행 구분) · 날짜와 시각 · 차량 대수 · 인원 · 접수 경과", async () => {
    const html = await render({}, { items: [WIZARD] });
    const t = text(rowsOf(html)[0].html);
    expect(t).toContain(WIZARD.name);
    expect(t).toContain(fill(res.routeValue, { origin: "서울", destination: "강릉" }));
    expect(t).toContain(ko.reservationCheck.tripType.round);
    expect(t).toContain(fill(dates.short as string, { month: 10, day: 17, weekday: (dates.weekdays as string[])[6] }));
    expect(t).toContain(fill(dates.time as string, { hour: "07", minute: "00" }));
    expect(t).toContain(fill(res.busValue, { vehicle: "45인승", buses: 2 }));
    expect(t).toContain(fill(res.paxValue, { n: 80 }));
    expect(t).toContain(fill(resObj("elapsed").hours, { n: 2 }));
    expect(badgeKinds(rowsOf(html)[0].html)).toEqual(["new"]);
  });

  test("🔴 간편 접수 행(리뷰 P2-7) — '간편' 칩 + 날짜만 · '시각 미정' · '차량 미정' · 인원(손님이 고르지 않은 값을 지어내지 않는다)", async () => {
    const html = await render({}, { items: [ROW_BASE] });
    const r = rowsOf(html)[0].html;
    expect(badgeKinds(r)).toEqual(["new", "quick"]);
    const t = text(r);
    expect(t).toContain(res.quickChip);
    expect(res.quickChip).toBe("간편");
    expect(t).toContain(res.timeUndecided);
    expect(t).toContain(res.vehicleUndecided);
    expect(res.timeUndecided).toBe("시각 미정");
    expect(res.vehicleUndecided).toBe("차량 미정");
    expect(t).toContain(fill(res.paxValue, { n: 28 }));
    expect(t).not.toMatch(/00:00/);
  });

  test("🔴 새 접수 탭 — 72시간 넘은 건은 '답이 늦은 접수 · 72시간 넘음' 묶음으로 맨 위 · N일째 대기 배지 · 행 왼쪽 띠(data-urgent)", async () => {
    const html = await render({}, { items: [OVERDUE, WIZARD, ROW_BASE] });
    const heads = [...html.matchAll(/<h2[^>]*data-group="(\w+)"[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => [m[1], text(m[2])]);
    expect(heads).toEqual([
      ["overdue", resObj("group").overdue],
      ["waiting", resObj("group").waiting],
    ]);
    expect(resObj("group").overdue).toBe("답이 늦은 접수 · 72시간 넘음");
    const rs = rowsOf(html);
    expect(rs.map((r) => r.id)).toEqual([OVERDUE.id, WIZARD.id, ROW_BASE.id]);
    expect(attr(rs[0].html, "data-urgent")).toBe("true");
    expect(attr(rs[1].html, "data-urgent")).toBeNull();
    expect(badgeKinds(rs[0].html)[0]).toBe("waiting");
    expect(text(rs[0].html)).toContain("3일째 대기");
    expect(text(rs[0].html)).toContain(fill(resObj("elapsed").days, { n: 3 }));
  });

  test("🔴 확정 탭(리뷰 P1-1) — 쪽으로 넘기는 목록은 다가오는 운행만(출발 ≥ KST 오늘 00:00 · 출발이 가까운 순) · 지난 확정은 그 위에 따로 짧게(건수 · 최근 것부터 · 운행 완료 안내) · 안내 문구는 사실", async () => {
    const today = confirmedRow(uuidN(1), "2026-09-27T23:00:00.000Z"); // 9/28 08:00 — 오늘(시각은 지났다)
    const soon = confirmedRow(uuidN(2), "2026-09-30T05:30:00.000Z"); // 9/30 14:30
    const p1 = confirmedRow(uuidN(3, "d"), "2026-09-26T23:00:00.000Z"); // 9/27 — 1일 지남(가장 최근)
    const p2 = confirmedRow(uuidN(4, "d"), "2026-09-24T23:00:00.000Z"); // 9/25 — 3일 지남
    const html = await render({ status: "confirmed" }, { items: [today, soon], past: { items: [p1, p2], total: 2 } });
    const cutoff = kstTodayStart(NOW);
    expect(vi.mocked(listReservations)).toHaveBeenCalledWith({ status: "confirmed", limit: 20, departFrom: cutoff });
    expect(vi.mocked(listConfirmedPast)).toHaveBeenCalledWith(cutoff, PAST_CONFIRMED_SHOWN);
    // 안내 — 쪽으로 넘기는 목록이 무엇인지 사실대로
    expect(text(html)).toContain(resObj("hint").confirmed);
    expect(resObj("hint").confirmed).toBe("다가오는 운행을 출발이 가까운 순서로 보여 드려요.");
    // 지난 확정 칸 — 목록 위 · 건수 · 운행 완료 안내 · 최근 것부터 · 쪽 번호(data-row-index)가 없다(더 보기 포커스와 무관)
    const past = /<section[^>]*data-testid="admin-list-past"[^>]*>([\s\S]*?)<\/section>/.exec(html);
    expect(past, "지난 확정 칸").not.toBeNull();
    const pastKo = resObj("past");
    expect(text(past![1])).toContain(fill(pastKo.title, { n: 2 }));
    expect(text(past![1])).toContain(pastKo.hint);
    expect(pastKo.hint).toBe("운행이 끝났으면 상세에서 운행 완료로 바꿔 주세요.");
    expect(text(past![1])).not.toContain(fill(pastKo.recent, { n: PAST_CONFIRMED_SHOWN }));
    const pastRows = rowsOf(past![0]);
    expect(pastRows.map((r) => r.id)).toEqual([p1.id, p2.id]);
    for (const r of pastRows) expect(r.html).not.toMatch(/data-row-index=/);
    expect(text(pastRows[0].html)).toContain(fill(resObj("relative").before, { n: 1 }));
    // 다가오는 운행 — 지난 칸 아래 · 제목 · 쪽 번호 0 부터 · 오늘 · N일 뒤
    const rest = html.slice(html.indexOf("</section>", html.indexOf('data-testid="admin-list-past"')));
    expect(rest).toMatch(/<h2[^>]*data-group="upcoming"[^>]*>/);
    const upRows = rowsOf(rest);
    expect(upRows.map((r) => r.id)).toEqual([today.id, soon.id]);
    expect(upRows.map((r) => attr(/<a[^>]*>/.exec(r.html)![0], "data-row-index"))).toEqual(["0", "1"]);
    expect(text(upRows[0].html)).toContain(resObj("relative").today);
    expect(text(upRows[1].html)).toContain(fill(resObj("relative").after, { n: 2 }));
  });

  test("🔴 지난 확정이 20건을 넘어도 쪽 1 에 다가오는 운행이 보인다(리뷰 P1-1 실측: 지난 26 + 다가오는 5 → 전에는 쪽 1 = 지난 20건)", async () => {
    const upcoming = Array.from({ length: 5 }, (_, i) => confirmedRow(uuidN(10 + i), new Date(Date.parse("2026-09-29T00:00:00.000Z") + i * 86_400_000).toISOString()));
    const past = Array.from({ length: PAST_CONFIRMED_SHOWN }, (_, i) => confirmedRow(uuidN(40 + i, "d"), new Date(Date.parse("2026-09-26T23:00:00.000Z") - i * 86_400_000).toISOString()));
    const html = await render({ status: "confirmed" }, { items: upcoming, past: { items: past, total: 26 }, counts: { new: 0, confirmed: 31, done: 0, cancelled: 0 } });
    // 쪽 번호가 붙은 행(= 쪽으로 넘기는 목록) = 다가오는 운행 5건
    const indexed = [...html.matchAll(/<li[^>]*data-row-id="([^"]+)"[^>]*>\s*<a[^>]*data-row-index="(\d+)"/g)].map((m) => [m[1], m[2]]);
    expect(indexed).toEqual(upcoming.map((r, i) => [r.id, String(i)]));
    // 지난 확정은 최근 5건 + 전체 26건 + '가장 최근 5건만'
    const pastSec = /<section[^>]*data-testid="admin-list-past"[^>]*>([\s\S]*?)<\/section>/.exec(html)![1];
    expect(text(pastSec)).toContain(fill(resObj("past").title, { n: 26 }));
    expect(text(pastSec)).toContain(fill(resObj("past").recent, { n: PAST_CONFIRMED_SHOWN }));
    expect(rowsOf(pastSec)).toHaveLength(PAST_CONFIRMED_SHOWN);
    // 알약(전체 확정 31) = 지난 26 + 다가오는 5
    const pills = [...html.matchAll(/<a[^>]*data-tab="confirmed"[^>]*>[\s\S]*?data-testid="admin-tab-count"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(pills).toEqual(["31"]);
  });

  test("확정 탭 — 다가오는 운행이 없고 지난 확정만 있으면: 지난 칸 + '다가오는 확정 운행이 없어요.' (걸러 본 빈 상태 문장이 아니다)", async () => {
    const p1 = confirmedRow(uuidN(3, "d"), "2026-09-26T23:00:00.000Z");
    const html = await render({ status: "confirmed" }, { items: [], past: { items: [p1], total: 1 } });
    expect(html).toMatch(/data-testid="admin-list-past"/);
    expect(text(html)).toContain(res.upcomingEmpty);
    expect(res.upcomingEmpty).toBe("다가오는 확정 운행이 없어요.");
    expect(text(html)).not.toContain(res.empty);
    // 번호 가림 안내는 행이 있으면 보인다
    expect(text(html)).toContain(res.privacyNote);
  });

  test("확정 탭 — 둘 다 없으면 걸러 본 빈 상태 · 지난 확정을 못 읽으면 그 칸만 '불러오지 못했어요'(0건이라 하지 않는다 · 목록은 그대로)", async () => {
    const empty = await render({ status: "confirmed" }, { items: [], past: { items: [], total: 0 } });
    expect(text(empty)).toContain(res.empty);
    expect(empty).not.toMatch(/data-testid="admin-list-past"/);
    const soon = confirmedRow(uuidN(2), "2026-09-30T05:30:00.000Z");
    const failed = await render({ status: "confirmed" }, { items: [soon], past: "fail" });
    const sec = /<section[^>]*data-testid="admin-list-past"[^>]*>([\s\S]*?)<\/section>/.exec(failed);
    expect(sec).not.toBeNull();
    expect(text(sec![1])).toContain(resObj("past").unknown);
    expect(text(sec![1])).not.toMatch(/0건/);
    expect(rowsOf(failed).map((r) => r.id)).toEqual([soon.id]);
  });

  test("다른 탭은 지난 확정을 읽지 않는다 · 확정 탭만 경계를 준다", async () => {
    const cases: Record<string, string>[] = [{}, { status: "done" }, { status: "cancelled" }, { status: "all" }];
    for (const s of cases) {
      vi.mocked(listConfirmedPast).mockClear();
      await render(s, { items: [WIZARD] });
      expect(vi.mocked(listConfirmedPast), JSON.stringify(s)).not.toHaveBeenCalled();
      expect(vi.mocked(listReservations).mock.lastCall?.[0], JSON.stringify(s)).not.toHaveProperty("departFrom");
    }
  });

  test("🔴 여러 날 운행(리뷰 P2-3) — 날짜 칸에 '10/17(토)~10/18(일)' · 구간 옆에 '1박 2일'(돌아오는 날에서 센다) · 당일 왕복은 그대로", async () => {
    const multi = row({ ...WIZARD, id: uuidN(7, "e"), return_at: "2026-10-18T10:00:00.000Z" }); // 10/17(토) 07:00 → 10/18(일) 19:00
    const html = await render({}, { items: [multi, WIZARD] });
    const [m, same] = rowsOf(html);
    const d = (month: number, day: number, w: number) => fill(dates.short as string, { month, day, weekday: (dates.weekdays as string[])[w] });
    expect(text(m.html)).toContain(fill(dates.range as string, { from: d(10, 17, 6), to: d(10, 18, 0) }));
    expect(text(m.html)).toContain(fill(res.stay, { nights: 1, days: 2 }));
    expect(res.stay).toBe("{nights}박 {days}일");
    expect(text(m.html)).toContain(ko.reservationCheck.tripType.round);
    // 당일 왕복(10/17 07:00 → 19:00) — 범위·박수를 지어내지 않는다
    expect(text(same.html)).not.toContain("~");
    expect(text(same.html)).not.toMatch(/\d박/);
  });

  test("🔴 출발 칸(넓은 목록)의 두 줄 — 날짜 / '시각 · 남은 날' 한 덩어리(가운데점이 줄 맨 앞에 혼자 서지 않는다 · 리뷰 P2-6)", async () => {
    const soon = confirmedRow(uuidN(2), "2026-09-30T05:30:00.000Z"); // 9/30(수) 14:30 · 2일 뒤
    const html = await render({ status: "confirmed" }, { items: [soon] });
    const r = rowsOf(html)[0].html;
    const date = fill(dates.short as string, { month: 9, day: 30, weekday: (dates.weekdays as string[])[3] });
    const time = fill(dates.time as string, { hour: "14", minute: "30" });
    const rel = fill(resObj("relative").after, { n: 2 });
    // <b>날짜</b> 다음 칸 하나 안에 시각과 '· 남은 날'이 함께 — 가운데점 앞은 줄바꿈 없는 공백(U+00A0)
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(r).toMatch(new RegExp(`<b[^>]*>${esc(date)}</b> <span[^>]*><span[^>]*>${esc(time)}</span><span[^>]*> · ${esc(rel)}</span></span>`));
  });

  test("🔴 숫자가 없는 번호면 전화 버튼을 그리지 않는다(리뷰 P2-9) · 행 링크는 그대로", async () => {
    const html = await render({}, { items: [row({ ...ROW_BASE, id: uuidN(8, "f"), phone: "abc" })] });
    const [r] = rowsOf(html);
    expect(links(r.html).map((l) => l.href)).toEqual([`/admin/reservations/${uuidN(8, "f")}`]);
    expect(r.html).not.toMatch(/href="tel:/);
  });

  test("안내 한 줄 — 새 접수 = 오래 기다린 것부터 · 운행 완료·취소·전체 = 최근 것부터", async () => {
    expect(text(await render({}, { items: [WIZARD] }))).toContain(resObj("hint").new);
    for (const s of ["done", "cancelled", "all"]) expect(text(await render({ status: s }, { items: [WIZARD] })), s).toContain(resObj("hint").recent);
  });
});

describe("4-c. 화면 — 20건 더 보기 · 빈 상태 · 옛 표 없음", () => {
  // 화면은 요청의 시각 하나(new Date())로 경과·72시간을 잰다 — Date 만 기준 시각에 고정한다(타이머는 진짜)
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  test("🔴 더 있으면 '20건 더 보기'(다음 쪽 주소 — 상태·쪽만) · 없으면 버튼 없음 · 번호 가림 안내", async () => {
    const more = await render({ status: "all" }, { items: [WIZARD], hasMore: true });
    const btn = /<button[^>]*data-testid="admin-list-more"[^>]*>([\s\S]*?)<\/button>/.exec(more);
    expect(btn, "더 보기 버튼").not.toBeNull();
    expect(text(btn![1])).toBe(fill(res.more, { n: LIST_PAGE_SIZE }));
    expect(attr(btn![0], "data-next")?.replace(/&amp;/g, "&")).toBe("/admin/reservations?status=all&page=2");
    expect(text(more)).toContain(res.privacyNote);
    const none = await render({ status: "all" }, { items: [WIZARD], hasMore: false });
    expect(none).not.toMatch(/data-testid="admin-list-more"/);
  });

  test("쪽 상한에 닿으면 버튼 대신 거짓 없는 안내(한 번에 N건까지)", async () => {
    const html = await render({ page: String(MAX_LIST_PAGES) }, { items: [WIZARD], hasMore: true });
    expect(html).not.toMatch(/data-testid="admin-list-more"/);
    expect(text(html)).toContain(fill(res.limitNote, { n: LIST_PAGE_SIZE * MAX_LIST_PAGES }));
  });

  test("🔴 빈 상태 ① 데이터 없음 — 새 접수 탭: '새 접수가 없어요…' + [전체 보기] · 전체 탭: '아직 들어온 접수가 없어요.'", async () => {
    const newEmpty = await render({});
    expect(text(newEmpty)).toContain(res.emptyNew);
    expect(links(newEmpty)).toContainEqual(expect.objectContaining({ href: "/admin/reservations?status=all", text: res.clearFilter }));
    const allEmpty = await render({ status: "all" });
    expect(text(allEmpty)).toContain(res.emptyAll);
    expect(text(allEmpty)).not.toContain(res.empty);
  });

  test("🔴 빈 상태 ② 걸러 본 결과 없음 — '이 상태의 접수가 없어요.' + [전체 보기] · 뒤쪽 쪽 번호로 들어와도 같은 문장(목록은 늘 첫 줄부터)", async () => {
    const cases: Record<string, string>[] = [{ status: "cancelled" }, { status: "done", page: "3" }];
    for (const params of cases) {
      const html = await render(params);
      expect(text(html)).toContain(res.empty);
      expect(links(html)).toContainEqual(expect.objectContaining({ href: "/admin/reservations?status=all", text: res.clearFilter }));
    }
  });

  test("거짓 없는 빈 문장 — 문자 알림을 약속하지 않는다(사장님 알림 번호가 아직 없다 — 매뉴얼 '지금 아직 안 되는 것')", () => {
    expect(res.emptyNew).not.toMatch(/문자/);
    expect(read("docs/ops/admin-manual.md")).toMatch(/사장님 접수 알림\*\* \| 받으실 번호가 없어/);
  });

  test("🔴 옛 68rem 표 없음 — 목록 화면이 <table>·.table·가로 스크롤 상자(tableWrap)를 쓰지 않는다", async () => {
    const html = await render({}, { items: [WIZARD, ROW_BASE] });
    expect(html).not.toMatch(/<table/);
    const src = codeOf(LIST_PAGE);
    expect(src).not.toMatch(/a\.table\b|a\.tableWrap\b|<table/);
  });

  test("넓은 화면 표 모양 7칸의 머리 줄 — 상태 · 고객 · 운행 구간 · 출발 · 차량·인원 · 접수 · 전화 (읽기 순서는 행이 말하므로 머리 줄은 aria-hidden)", async () => {
    const html = await render({}, { items: [WIZARD] });
    const head = /<div[^>]*data-testid="admin-list-head"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    expect(head).not.toBeNull();
    expect(attr(head![0], "aria-hidden")).toBe("true");
    const col = resObj("col");
    expect([...head![1].matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1])).toEqual([col.status, col.customer, col.route, col.depart, col.vehicle, col.received, col.call]);
  });

  test("🔴 상태 탭 줄(가로 스크롤 상자)이 곧 위치 기준(position: relative) — 탭 안의 srOnly(absolute)가 상자를 빠져나가 문서 폭을 늘리지 않는다", () => {
    // 375px 실측(P5-21 ⑤): 기준이 없으면 srOnly 의 기준이 첫 컨테이닝 블록(문서)이 되어 스크롤 상자의 잘림도, 셸의 clip 도 받지 않았다
    // — 문서 scrollWidth 428px(뷰포트 375). 사람이 밀어서는 안 움직였지만(html overflow-x: hidden) 프로그램 스크롤로 53px 이 밀렸다.
    const css = codeOf("components/admin/admin.module.css");
    const rule = /(?:^|\n)\.statusTabs\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/(?:^|;|\s)overflow-x:\s*auto;/);
    expect(rule![1]).toMatch(/(?:^|;|\s)position:\s*relative;/);
  });
});

// =============================================================================
// 5. 처리 중 포커스 — 공용 부품 PendingButton (P5-20 수정 라운드 ⑧-1)
// =============================================================================
describe("5. 처리 중 포커스 — PendingButton", () => {
  test("🔴 처리 중에도 disabled 가 아니다 — aria-disabled + data-pending (포커스가 body 로 떨어지지 않는다)", () => {
    const el = PendingButton({ pending: true, onClick: () => {}, className: "c", children: "x" }) as ReactElement<Record<string, unknown>>;
    expect(el.type).toBe("button");
    expect(el.props.disabled).toBeUndefined();
    expect(el.props["aria-disabled"]).toBe(true);
    expect(el.props["data-pending"]).toBe("true");
    const idle = PendingButton({ pending: false, onClick: () => {}, className: "c", children: "x" }) as ReactElement<Record<string, unknown>>;
    expect(idle.props["aria-disabled"]).toBeUndefined();
    expect(idle.props.type).toBe("button");
  });

  test("🔴 처리 중 누름(Enter·Space·클릭)은 무시 — 두 번 보내지 않는다 · 끝나면 다시 받는다", () => {
    const handler = vi.fn();
    const prevent = vi.fn();
    ignoreWhilePending(true, { preventDefault: prevent }, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(prevent).toHaveBeenCalledTimes(1);
    ignoreWhilePending(false, { preventDefault: prevent }, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    const el = PendingButton({ pending: true, onClick: handler, className: "c", children: "x" }) as ReactElement<{ onClick: (e: unknown) => void }>;
    el.props.onClick({ preventDefault: prevent });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("부품 — 'use client' · 훅 없음(함수로 부를 수 있다) · 한글 리터럴 0 · CSS 는 aria-disabled 를 disabled 와 같은 모양으로", () => {
    const src = codeOf(PENDING);
    expect(src.split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    expect(src).not.toMatch(/\buse(State|Effect|LayoutEffect|Ref|Memo|Callback|Transition)\(/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    const css = codeOf("components/admin/admin.module.css");
    for (const b of ["btnPrimary", "btnSecondary", "btnDestructive"]) expect(css, b).toMatch(new RegExp(`\\.${b}\\[aria-disabled="true"\\]`));
  });

  test("🔴 '20건 더 보기'는 PendingButton · 목록 주소만 바꾼다(replace · 스크롤 유지) · 끝나면 새로 붙은 첫 행으로 포커스", () => {
    const src = codeOf(LOAD_MORE);
    expect(src.split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    expect(src).toMatch(/<PendingButton\b/);
    expect(src).not.toMatch(/disabled=\{/);
    expect(src).toMatch(/router\.replace\([^)]*\{\s*scroll:\s*false\s*\}\)/);
    expect(src).toMatch(/firstRowIndexOfPage\(/);
    expect(src).toMatch(/data-row-index/);
    expect(src).toMatch(/\.focus\(/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });

  test("노출 전환 버튼 셋(공지·팝업·노선)도 같은 부품 — 처리 중 disabled 로 포커스를 잃지 않는다", () => {
    for (const rel of ["components/admin/NoticeToggle.tsx", "components/admin/PopupToggle.tsx", "components/admin/RouteToggle.tsx"]) {
      const src = codeOf(rel);
      expect(src, rel).toMatch(/<PendingButton\b/);
      expect(src, rel).not.toMatch(/disabled=\{pending\}/);
    }
  });
});

// =============================================================================
// 6. 정적 규약
// =============================================================================
describe("6. 정적 규약", () => {
  test("목록 화면 — 첫 문장 게이트 · 한글 리터럴 0 · 쪽 파라미터는 page(옛 cursor 없음)", () => {
    const src = codeOf(LIST_PAGE);
    expect(src).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    expect(src).not.toMatch(/params\.cursor/);
    expect(src).toMatch(/parseListTab\(params\.status\)/);
    expect(src).toMatch(/parseListPage\(params\.page\)/);
  });

  test("🔴 개인정보는 서버가 그린다 — 행은 컴포넌트 props 가 아니라 함수 호출(reservationRow(…))로 그린다(dev 가 서버 컴포넌트 props 를 HTML 에 싣는다)", () => {
    for (const rel of [LIST_PAGE, "app/admin/(protected)/page.tsx"]) {
      const src = codeOf(rel);
      expect(src, rel).toMatch(/reservationRow\(/);
      expect(src, rel).not.toMatch(/<ReservationRow\b/);
    }
    const rowSrc = codeOf(ROW);
    expect(rowSrc).not.toMatch(/^\s*["']use client["']/m);
    expect(rowSrc).not.toMatch(/\buse(State|Effect|Context|Ref)\b/);
    expect(rowSrc).toMatch(/export function reservationRow\(/);
    // 리뷰 P2-12 — 서버 전용 표시: 클라이언트 부품이 행 함수를 가져오는 순간 빌드가 막힌다(이름·전화가 클라이언트 번들로 가는 길을 닫는다)
    expect(rowSrc).toMatch(/^import "server-only";$/m);
  });

  test("새 파일 — 한글 리터럴 0 · env 0 · 순수 모델은 React·Next·DB 를 모른다", () => {
    for (const rel of [MODEL, ROW, LOAD_MORE, PENDING, "components/admin/reservationRowLabels.ts", "components/admin/TabIntoView.tsx"]) {
      const src = codeOf(rel);
      expect(src.split("\n").filter((l) => HANGUL.test(l)), rel).toEqual([]);
      expect(src, rel).not.toMatch(/process\.env/);
    }
    expect(codeOf(MODEL)).not.toMatch(/from\s+"(next|react)[/"]|@\/lib\/supabase|server-only/);
  });

  test("카탈로그 — 목록 문구(해요체) · 탭 이름은 배지·필터와 같은 말", () => {
    expect((res.filter as unknown as Record<string, string>).new).toBe((res.status as unknown as Record<string, string>).new);
    expect(fill(tabsKo.newCount, { n: 4 })).toBe("새 접수 4건");
    for (const k of ["more", "moreLoading", "privacyNote", "emptyNew", "limitNote", "callAria", "upcomingEmpty", "stay"]) expect(res[k], k).toBeTruthy();
    expect(res.more).toBe("{n}건 더 보기");
    // 지난 확정 칸 — 제목에 건수 · 운행 완료 안내 · 일부만 보일 때의 안내 · 모름
    const past = resObj("past");
    for (const k of ["title", "hint", "recent", "unknown"]) expect(past[k], k).toBeTruthy();
    expect(past.title).toContain("{n}");
    expect(past.recent).toContain("{n}");
    // 쓰지 않게 된 묶음 이름(지난 확정은 따로 칸이다)은 남기지 않는다
    expect(resObj("group").past).toBeUndefined();
    expect(dates.range).toBe("{from}~{to}");
  });
});

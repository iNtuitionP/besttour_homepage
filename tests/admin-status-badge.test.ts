/**
 * P5-20 — 관리자 상태 배지 체계 (브리프 P5-20 §A · 시안 ⑤-0 · 제안서 ④ 원칙 2).
 *
 * "상태는 해야 할 일로 읽힌다": 처리가 필요한 상태가 가장 강하고(새 접수 = 골드 · N일째 대기 = 가장 짙은 보라),
 * 끝난 상태가 가장 약하다(운행 완료 = 회색 실선 · 취소 = 회색 점선). **색만으로 구분하지 않는다** — 글자 + 모양(점·!·✓·실선·점선·전화).
 * 72시간은 0022 `admin_stats` 의 backlog 와 **같은 값**을 상수 하나로 쓴다(통계 카드와 목록 표시가 어긋나지 않게).
 * 채운 보라(`--action-primary-bg`)는 버튼 전용 — 현재 탭·선택된 필터·노출 중 배지에서 걷어낸다.
 *
 * 이 파일이 잠그는 것
 *   1. 순수 모델(components/admin/status-badge.ts) — 상태 → 배지 · 72시간 경계 · N일째 · 0022 와 같은 72
 *   2. 모양 — 종류마다 글자와 모양 표식이 모두 다르다(색 단독 의존 금지 · WCAG 1.4.1)
 *   3. 컴포넌트(StatusBadge) — 카탈로그 글자 · 표식은 aria-hidden · 서버 컴포넌트(훅·'use client' 없음)
 *   4. 교체한 곳 — 예약 목록·상세·통계가 이 컴포넌트를 쓰고 옛 배지(data-status={상태})를 그리지 않는다
 *   5. CSS — 배지 톤은 --status-* 역할 토큰 · 채운 보라는 버튼(과 통계 막대)에만
 * tests/ 아래라 게이트 3종의 검사 대상이다 — 금지어·임시값 마커 리터럴을 쓰지 않는다.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { stripComments } from "./helpers/strip-comments";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock("@/lib/auth/requireAdmin", () => ({ requireAdmin: vi.fn(async () => ({ userId: "test", email: "e" })) }));
vi.mock("@/components/admin/ReservationActions", () => ({ ReservationActions: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/queries", () => ({
  getVehicles: vi.fn(async () => [{ id: 1, slug: "bus45", nameKo: "45인승 우등", nameEn: "45-seat", capacity: 45, sort: 1, active: true }]),
}));
vi.mock("@/lib/admin/reservations", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/admin/reservations")>();
  return { ...mod, getReservation: vi.fn(), listReservations: vi.fn(), countReservationsByStatus: vi.fn(async () => ({ new: 2, confirmed: 1, done: 0, cancelled: 0 })) };
});
// P5-21 — 목록의 '20건 더 보기'(클라이언트)가 라우터를 쓴다. 이 파일은 마크업만 본다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => "/admin/reservations" }));
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

import AdminReservationDetailPage from "@/app/admin/(protected)/reservations/[id]/page";
import AdminReservationsPage from "@/app/admin/(protected)/reservations/page";
import { StatusBadge } from "@/components/admin/StatusBadge";
import {
  BACKLOG_HOURS,
  BADGE_LOOK,
  STATUS_BADGE_KINDS,
  badgeText,
  isOverdue,
  reservationBadge,
  waitingDays,
  type StatusBadgeModel,
} from "@/components/admin/status-badge";
import { getStatusBadgeLabels } from "@/components/admin/statusBadgeLabels";
import { getReservation, listReservations, type ReservationDetailRow } from "@/lib/admin/reservations";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, Record<string, unknown>> };
const statusKo = (ko.admin.reservations as Record<string, Record<string, string>>).status;
const quickKo = (ko.admin.labels as Record<string, string>).quickBadge;

const HOUR = 3_600_000;
const NOW = new Date("2026-09-28T03:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const MODEL = "components/admin/status-badge.ts";
const UI = "components/admin/StatusBadge.tsx";
const LABELS = "components/admin/statusBadgeLabels.ts";
const CSS = "components/admin/admin.module.css";
const LIST_PAGE = "app/admin/(protected)/reservations/page.tsx";
const DETAIL_PAGE = "app/admin/(protected)/reservations/[id]/page.tsx";
const STATS_PAGE = "app/admin/(protected)/stats/page.tsx";

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? null;
const badgeTags = (html: string) => [...html.matchAll(/<span[^>]*data-testid="admin-status-badge"[^>]*>/g)].map((m) => m[0]);

// =============================================================================
// 1. 순수 모델 — 상태 → 배지 · 72시간 경계
// =============================================================================
describe("1. 모델 — reservationBadge · 72시간", () => {
  test("상태별 배지 — new(72시간 안) · confirmed · done · cancelled", () => {
    expect(reservationBadge("new", ago(HOUR), NOW)).toEqual({ kind: "new" });
    expect(reservationBadge("confirmed", ago(200 * HOUR), NOW)).toEqual({ kind: "confirmed" });
    expect(reservationBadge("done", ago(900 * HOUR), NOW)).toEqual({ kind: "done" });
    expect(reservationBadge("cancelled", ago(900 * HOUR), NOW)).toEqual({ kind: "cancelled" });
  });

  test("72시간 경계 — 딱 72시간은 아직 새 접수, 넘으면 N일째 대기(0022 의 `created_at < now() - 72h` 와 같은 쪽)", () => {
    expect(reservationBadge("new", ago(72 * HOUR), NOW)).toEqual({ kind: "new" });
    expect(isOverdue(ago(72 * HOUR), NOW)).toBe(false);
    expect(reservationBadge("new", ago(72 * HOUR + 1), NOW)).toEqual({ kind: "waiting", days: 3 });
    expect(isOverdue(ago(72 * HOUR + 1), NOW)).toBe(true);
    expect(reservationBadge("new", ago(96 * HOUR - 1), NOW)).toEqual({ kind: "waiting", days: 3 });
    expect(reservationBadge("new", ago(96 * HOUR), NOW)).toEqual({ kind: "waiting", days: 4 });
    expect(waitingDays(ago(10 * 24 * HOUR + 5), NOW)).toBe(10);
  });

  test("확정·완료·취소는 오래돼도 '대기' 가 아니다 — 대기는 new 에만", () => {
    for (const s of ["confirmed", "done", "cancelled"] as const) expect(reservationBadge(s, ago(500 * HOUR), NOW).kind, s).toBe(s);
  });

  test("시계가 어긋난 미래 접수·읽을 수 없는 시각은 '새 접수' — 지어내지 않는다", () => {
    expect(reservationBadge("new", new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toEqual({ kind: "new" });
    expect(reservationBadge("new", "not-a-date", NOW)).toEqual({ kind: "new" });
    expect(isOverdue("not-a-date", NOW)).toBe(false);
  });

  /**
   * 🔴 리뷰 P2-2: 0022 만 읽으면 **대체된 정의**를 보게 된다 — 0023 이 `create or replace function admin_stats` 로 다시 만들었다.
   * 그래서 admin_stats 를 정의하는 마이그레이션을 **전부** 찾아(파일 이름을 적지 않는다) 각자의 상수를 대조하고,
   * 지금 살아 있는 정의(= 번호가 가장 큰 파일)에 상수가 **반드시 있어야** 한다.
   */
  test("🔴 72 는 admin_stats 를 정의하는 마이그레이션 전부(마지막 = 살아 있는 정의 포함)의 backlog 와 같은 값이다 — 상수 하나", () => {
    expect(BACKLOG_HOURS).toBe(72);
    const DEFINES = /create\s+(or\s+replace\s+)?function\s+(public\.)?admin_stats\s*\(/i;
    const CONST = /c_backlog_hours\s+constant\s+int\s*:=\s*(\d+)\s*;/g;
    const defining = readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => `supabase/migrations/${f}`)
      .filter((rel) => DEFINES.test(stripComments(read(rel), rel)));
    expect(defining.length, "admin_stats 를 정의하는 마이그레이션을 찾지 못했다").toBeGreaterThan(0);
    const last = defining[defining.length - 1];
    for (const rel of defining) {
      const values = [...stripComments(read(rel), rel).matchAll(CONST)].map((m) => Number(m[1]));
      if (rel === last) expect(values.length, `${rel}(살아 있는 정의)에 c_backlog_hours 가 없다`).toBeGreaterThan(0);
      for (const v of values) expect(v, rel).toBe(BACKLOG_HOURS);
    }
    // 앱 쪽에 72 를 다시 적은 곳이 없다 — 모델의 상수 하나
    for (const rel of [UI, LIST_PAGE, DETAIL_PAGE, STATS_PAGE]) expect(codeOf(rel), rel).not.toMatch(/\b72\b/);
  });

  test("순수 모듈 — React·Next·DB 없음 · 한글 리터럴 0", () => {
    const src = codeOf(MODEL);
    expect(src).not.toMatch(/from\s+"(next|react|@\/lib\/supabase)/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });
});

// =============================================================================
// 2. 모양 — 색만으로 구분하지 않는다
// =============================================================================
describe("2. 모양 — 글자 + 표식", () => {
  test("종류 7가지와 톤 — 새 접수(골드) · N일째 대기(급함) · 확정 · 운행 완료 · 취소 · 간편 칩 · 답이 늦은 접수(급함)", () => {
    expect([...STATUS_BADGE_KINDS]).toEqual(["new", "waiting", "confirmed", "done", "cancelled", "quick", "overdue"]);
    expect(BADGE_LOOK).toEqual({
      new: { tone: "attention", mark: "dot", line: "solid" },
      waiting: { tone: "urgent", mark: "alert", line: "none" },
      confirmed: { tone: "confirmed", mark: "check", line: "solid" },
      done: { tone: "closed", mark: "none", line: "solid" },
      cancelled: { tone: "closed", mark: "x", line: "dashed" },
      quick: { tone: "quick", mark: "phone", line: "solid" },
      overdue: { tone: "urgent", mark: "alert", line: "none" },
    });
  });

  test("🔴 한 줄에 함께 보일 수 있는 배지(예약 상태 5 + 간편 칩)는 표식(모양·선)이 서로 다르다 — 색을 빼도 구분된다", () => {
    const kinds = ["new", "waiting", "confirmed", "done", "cancelled", "quick"] as const;
    const shapes = kinds.map((k) => `${BADGE_LOOK[k].mark}/${BADGE_LOOK[k].line}`);
    expect(new Set(shapes).size).toBe(kinds.length);
  });

  test("글자도 서로 다르다 — 카탈로그 라벨(admin.reservations.status · admin.labels.quickBadge)", async () => {
    const labels = await getStatusBadgeLabels();
    const texts = STATUS_BADGE_KINDS.map((k) => badgeText(k === "waiting" ? { kind: "waiting", days: 3 } : ({ kind: k } as StatusBadgeModel), labels));
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts).toEqual([statusKo.new, "3일째 대기", statusKo.confirmed, statusKo.done, statusKo.cancelled, quickKo, statusKo.overdue]);
    expect(statusKo.new).toBe("새 접수");
    expect(statusKo.done).toBe("운행 완료");
    expect(statusKo.waiting).toBe("{days}일째 대기");
  });
});

// =============================================================================
// 3. 컴포넌트 — StatusBadge
// =============================================================================
describe("3. StatusBadge 마크업", () => {
  const render = async (badge: StatusBadgeModel) => renderToStaticMarkup(createElement(StatusBadge, { badge, labels: await getStatusBadgeLabels() }));

  test.each([
    [{ kind: "new" } as StatusBadgeModel, "새 접수", "attention", "dot"],
    [{ kind: "waiting", days: 5 } as StatusBadgeModel, "5일째 대기", "urgent", "alert"],
    [{ kind: "confirmed" } as StatusBadgeModel, "확정", "confirmed", "check"],
    [{ kind: "done" } as StatusBadgeModel, "운행 완료", "closed", "none"],
    [{ kind: "cancelled" } as StatusBadgeModel, "취소", "closed", "x"],
    [{ kind: "quick" } as StatusBadgeModel, "간편 접수", "quick", "phone"],
    [{ kind: "overdue" } as StatusBadgeModel, "답이 늦은 접수", "urgent", "alert"],
  ])("%o → '%s' · 톤 %s · 표식 %s", async (badge, label, tone, mark) => {
    const html = await render(badge);
    const [tag] = badgeTags(html);
    expect(tag).toBeDefined();
    expect(text(html)).toBe(label);
    expect(attr(tag, "data-kind")).toBe(badge.kind);
    expect(attr(tag, "data-tone")).toBe(tone);
    expect(attr(tag, "data-mark")).toBe(mark);
    // 표식은 장식 — 읽을 것은 글자 하나
    if (mark === "dot") expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*><\/span>/);
    else if (mark === "none") expect(html).not.toMatch(/<svg/);
    else expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  test("취소는 점선(data-line=dashed) · 운행 완료는 실선 — 같은 회색이어도 모양이 다르다", async () => {
    expect(attr(badgeTags(await render({ kind: "cancelled" }))[0], "data-line")).toBe("dashed");
    expect(attr(badgeTags(await render({ kind: "done" }))[0], "data-line")).toBe("solid");
  });

  test("서버 컴포넌트 — 'use client'·훅·async 없음(서버 페이지가 그대로 그린다) · 한글 리터럴 0 · 라벨은 카탈로그 도우미에서", () => {
    const src = codeOf(UI);
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    expect(src).not.toMatch(/\buse(State|Effect|Reducer|Context|Ref)\b/);
    expect(src).not.toMatch(/export (default )?async function/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    const labels = codeOf(LABELS);
    expect(labels).toMatch(/namespace:\s*"admin\.reservations\.status"/);
    expect(labels.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });
});

// =============================================================================
// 4. 교체한 곳 — 예약 목록 · 상세 · 통계
// =============================================================================
const BASE: ReservationDetailRow = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  public_code: "QK2345AB",
  status: "new",
  intake: "quick",
  name: "예시고객가",
  phone: "+821000000001",
  vehicle_slug: null,
  origin_code: "ICN",
  destination_code: "SEL",
  trip_type: null,
  depart_at: "2026-10-09T15:00:00.000Z",
  return_at: null,
  bus_count: null,
  passengers: 30,
  created_at: new Date(Date.now() - 80 * HOUR).toISOString(),
  confirmed_at: null,
  email: null,
  purpose_code: null,
  waypoint_codes: [],
  contact_method: null,
  payment_method: null,
  parking_included: null,
  vat_included: null,
  message: null,
  admin_memo: null,
  privacy_consent_at: "2026-09-27T03:04:00.000Z",
  marketing_consent_at: null,
  retention_until: "2027-09-27T03:04:00.000Z",
  withdrawal_consent_at: "2026-09-27T03:04:00.000Z",
  withdrawal_consent_legacy: false,
};

describe("4. 교체한 곳", () => {
  test("예약 목록 — 행마다 StatusBadge(72시간 넘은 새 접수 = N일째 대기) 뒤에 간편 칩 · 옛 배지 없음 (P5-21 카드 행)", async () => {
    vi.mocked(listReservations).mockResolvedValue({
      items: [BASE, { ...BASE, id: "8c9e6679-7425-40de-944b-e07fc1f90ae8", public_code: "WZ2345AB", intake: "wizard", created_at: new Date(Date.now() - HOUR).toISOString() }],
      hasMore: false,
      nextCursor: null,
    });
    const html = renderToStaticMarkup((await AdminReservationsPage({ searchParams: Promise.resolve({}) })) as ReactElement);
    const kinds = badgeTags(html).map((t) => attr(t, "data-kind"));
    expect(kinds).toEqual(["waiting", "quick", "new"]);
    expect(text(html)).toContain("3일째 대기");
    expect(html).not.toMatch(/data-status="(new|confirmed|done|cancelled)"/);
    // 확정 탭의 행은 확정 배지
    vi.mocked(listReservations).mockResolvedValue({
      items: [{ ...BASE, id: "9c9e6679-7425-40de-944b-e07fc1f90ae9", public_code: "CF2345AB", intake: "wizard", status: "confirmed" }],
      hasMore: false,
      nextCursor: null,
    });
    const confirmed = renderToStaticMarkup((await AdminReservationsPage({ searchParams: Promise.resolve({ status: "confirmed" }) })) as ReactElement);
    expect(badgeTags(confirmed).map((t) => attr(t, "data-kind"))).toEqual(["confirmed"]);
  });

  /**
   * 🔴 P5-20 브라우저 실측: 사이드바(248px)가 본문 폭을 줄여 옛 접수 표(1212px)가 1280~1599px 에서 스크롤 상자 안으로 밀렸고,
   * 맨 끝의 상태 칸이 첫 화면에서 사라졌다. P5-21 은 표를 카드 행으로 바꿨다 — 상태 배지가 **행의 첫 칸**이라 어떤 폭에서도 먼저 보인다
   * (≥1024px 표 모양 7칸도 첫 칸이 상태다 · 가로 스크롤 상자 없음).
   */
  test("🔴 예약 목록 — 상태 배지는 행(상세 링크)의 첫 칸이다 · 옛 가로 스크롤 표(tableWrap)는 없다", async () => {
    vi.mocked(listReservations).mockResolvedValue({ items: [BASE], hasMore: false, nextCursor: null });
    const html = renderToStaticMarkup((await AdminReservationsPage({ searchParams: Promise.resolve({}) })) as ReactElement);
    const link = /<a[^>]*data-row-index="0"[^>]*>([\s\S]*?)<\/a>/.exec(html);
    expect(link).not.toBeNull();
    const firstCell = /^<span[^>]*>([\s\S]*?)<\/span><\/span>/.exec(link![1]);
    expect(firstCell, "행의 첫 칸").not.toBeNull();
    expect(badgeTags(firstCell![0]).map((t) => attr(t, "data-kind"))).toEqual(["waiting", "quick"]);
    expect(html).not.toMatch(/<table/);
  });

  test("예약 상세 — 머리 배지가 StatusBadge(오래된 새 접수 = N일째 대기) · 접수 방법 줄의 간편 칩", async () => {
    vi.mocked(getReservation).mockResolvedValue(BASE);
    const html = renderToStaticMarkup((await AdminReservationDetailPage({ params: Promise.resolve({ id: BASE.id }) })) as ReactElement);
    const kinds = badgeTags(html).map((t) => attr(t, "data-kind"));
    expect(kinds).toContain("waiting");
    expect(kinds).toContain("quick");
    expect(html).not.toMatch(/data-status="(new|confirmed|done|cancelled)"/);
  });

  test("정적 — 세 화면이 StatusBadge 를 쓰고 옛 배지 모양(`data-status={r.status}`·`data-intake`)이 없다 (목록은 P5-21 부터 행 함수가 그린다)", () => {
    const ROW = "components/admin/reservationRow.tsx";
    for (const rel of [DETAIL_PAGE, STATS_PAGE, ROW]) expect(codeOf(rel), rel).toMatch(/<StatusBadge\b/);
    expect(codeOf(LIST_PAGE)).toMatch(/reservationRow\(/);
    for (const rel of [LIST_PAGE, DETAIL_PAGE, STATS_PAGE, ROW]) {
      const src = codeOf(rel);
      expect(src, rel).not.toMatch(/data-status=\{(r|row)\.status\}/);
      expect(src, rel).not.toMatch(/data-intake=/);
    }
    // 통계 — 새 접수(건수의 이름)와 답이 늦은 접수(72시간 넘음)를 같은 배지로 그린다
    const stats = codeOf(STATS_PAGE);
    expect(stats).toMatch(/kind:\s*"new"/);
    expect(stats).toMatch(/kind:\s*"overdue"/);
  });
});

// =============================================================================
// 5. CSS — 톤은 --status-* · 채운 보라는 버튼 전용
// =============================================================================
/** 주석을 걷은 CSS 의 `선택자 { 본문 }` 쌍(가장 안쪽 블록) — tests/admin-confirm-sheet.test.ts 와 같은 방식. */
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

describe("5. CSS", () => {
  const rules = cssRules(read(CSS));
  /** 선택자 목록의 줄바꿈·공백은 뜻이 없다 — `a,\nb` 와 `a, b` 를 같게 본다. */
  const norm = (s: string) => s.replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
  const body = (selector: string) => rules.filter((r) => norm(r.selector) === norm(selector)).map((r) => r.body).join(";");

  test("배지 톤은 상태 역할 토큰만 — 새 접수(골드 면·짙은 글자·gold-deep 테두리) · 급함 · 확정 · 끝남(회색 실선/점선) · 간편(보라 테두리)", () => {
    const attention = body('.statusBadge[data-tone="attention"]');
    expect(decl(attention, "background")).toBe("var(--status-attention-bg)");
    expect(decl(attention, "color")).toBe("var(--status-attention-fg)");
    expect(decl(attention, "border-color")).toBe("var(--status-attention-border)");
    const urgent = body('.statusBadge[data-tone="urgent"]');
    expect(decl(urgent, "background")).toBe("var(--status-urgent-bg)");
    expect(decl(urgent, "color")).toBe("var(--status-urgent-fg)");
    const confirmed = body('.statusBadge[data-tone="confirmed"]');
    expect(decl(confirmed, "background")).toBe("var(--status-confirmed-bg)");
    expect(decl(confirmed, "color")).toBe("var(--status-confirmed-fg)");
    expect(decl(confirmed, "border-color")).toBe("var(--status-confirmed-border)");
    const closed = body('.statusBadge[data-tone="closed"]');
    expect(decl(closed, "color")).toBe("var(--status-closed-fg)");
    expect(decl(closed, "border-color")).toBe("var(--status-closed-border)");
    expect(decl(body('.statusBadge[data-line="dashed"]'), "border-style")).toBe("dashed");
    const quick = body('.statusBadge[data-tone="quick"]');
    expect(decl(quick, "border-color")).toBe("var(--border-strong)");
    expect(decl(quick, "color")).toBe("var(--text-brand)");
  });

  /**
   * 🔴 채운 보라는 **버튼 전용**(시안 ⑤-0 · 제안서 ②-9: 지금은 현재 탭·선택된 필터·확정 배지·노출 중 배지·주 버튼 5곳에서 서로 다른 뜻).
   *
   * 리뷰 P2-1: 예전 검사는 `var(--action-primary-bg)` 라는 **글자**만 찾아서, 같은 색으로 풀리는 다른 이름(--border-strong ·
   * --text-brand …)으로 칠하면 초록이었다(실제로 통계의 '나누지 않은 날' 조각·견본이 그랬다). 그래서 **토큰을 원시색까지 풀어서**
   * 면(background·background-color·background-image)의 색을 본다. 주 버튼의 세 색(기본 · 호버 · 누름)이 "채운 보라" 다.
   *
   * 허용은 셋뿐이다.
   *   · 버튼 — 관리자 버튼 클래스 `.btn…`(주 버튼 · P5-19 의 짙은 최종 버튼 — 그 호버가 누름 색과 같은 brand-900 으로 풀린다) ·
   *     `.submit`(로그인) 과 그 상태(:hover 등)
   *   · 선 — `::before`/`::after` 의 폭이나 높이가 4px 이하인 것(현재 표시의 띠 — 면이 아니라 선이다. 시안 그대로)
   *   · 자료 표시 — 아래 목록(사유와 함께). 누를 수 없고, 상태·선택 표시가 아니며, 14px 막대라 버튼과 헷갈리지 않는다.
   */
  const DATA_VIZ = new Map<string, string>([
    [".barFill", "통계 가로 막대(여행 구분·차량·미리 문의) — 누를 수 없는 자료 표시. 값의 크기를 길이로 말하는 한 가지 색"],
    ['.trendSeg[data-kind="confirmed"]', "통계 추이의 '확정 · 운행 완료' 조각 — 자료 표시. 범례가 이름을 말한다"],
    ['.legendSwatch[data-kind="confirmed"]', "위 조각의 범례 견본 — 조각과 같은 색이어야 범례가 된다"],
  ]);
  const BUTTON = /^\.(btn[A-Z]\w*|submit)(:[\w-]+(\([^)]*\))?)*$/;

  /** 원시 토큰(tokens.css) + 의미 토큰(semantic.css) — 이름 → 선언값. 의미 토큰이 원시 토큰을 가리킨다. */
  const TOKENS = new Map<string, string>();
  for (const rel of ["styles/tokens.css", "styles/semantic.css"]) {
    for (const m of read(rel).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) if (!TOKENS.has(m[1])) TOKENS.set(m[1], m[2].trim());
  }
  /** 값 안의 모든 색을 원시 HEX(대문자)로 — var() 를 끝까지 따라간다. */
  const colorsOf = (value: string, depth = 0): string[] => {
    if (depth > 12) throw new Error(`토큰 순환: ${value}`);
    const out: string[] = [];
    for (const m of value.matchAll(/var\((--[\w-]+)\)/g)) {
      const v = TOKENS.get(m[1]);
      if (v !== undefined) out.push(...colorsOf(v, depth + 1));
    }
    for (const m of value.replace(/var\([^)]*\)/g, "").matchAll(/#[0-9a-fA-F]{3,8}\b/g)) out.push(m[0].toUpperCase());
    return out;
  };
  const PRIMARY_FILL = new Set(["--action-primary-bg", "--action-primary-bg-hover", "--action-primary-bg-active"].flatMap((t) => colorsOf(`var(${t})`)));
  const FILL_PROPS = ["background", "background-color", "background-image"];
  const fillsOf = (ruleBody: string) => FILL_PROPS.flatMap((p) => colorsOf(decl(ruleBody, p) ?? ""));
  /** 관리자 화면이 싣는 CSS 모듈 전부 — 목록을 적지 않고 폴더에서 찾는다. */
  const ADMIN_CSS = [
    ...readdirSync(path.join(ROOT, "components/admin"))
      .filter((f) => f.endsWith(".module.css"))
      .map((f) => `components/admin/${f}`),
    ...readdirSync(path.join(ROOT, "app/admin/login"))
      .filter((f) => f.endsWith(".module.css"))
      .map((f) => `app/admin/login/${f}`),
  ];

  test("토큰 풀이가 살아 있다 — 주 버튼 색(기본·호버·누름) 3개 · 관리자 CSS 모듈을 폴더에서 찾는다", () => {
    expect(PRIMARY_FILL.size).toBe(3);
    for (const c of PRIMARY_FILL) expect(c).toMatch(/^#[0-9A-F]{6}$/);
    expect(ADMIN_CSS).toContain(CSS);
    expect(ADMIN_CSS.length).toBeGreaterThanOrEqual(3);
  });

  test("🔴 채운 보라(주 버튼 색으로 **풀리는** 면)는 버튼 · 4px 이하 선 · 사유가 적힌 자료 표시에만 — 이름이 아니라 색으로 판정", () => {
    const offenders: string[] = [];
    for (const rel of ADMIN_CSS) {
      for (const r of cssRules(read(rel))) {
        if (!fillsOf(r.body).some((c) => PRIMARY_FILL.has(c))) continue;
        for (const sel of r.selector.split(",").map((x) => x.trim())) {
          if (BUTTON.test(sel) || DATA_VIZ.has(sel)) continue;
          const isLine = /::(before|after)$/.test(sel) && ["width", "height"].some((p) => Number(/^(\d+(?:\.\d+)?)px$/.exec(decl(r.body, p) ?? "")?.[1] ?? Infinity) <= 4);
          if (isLine) continue;
          offenders.push(`${rel} — ${sel} (${FILL_PROPS.map((p) => decl(r.body, p)).filter(Boolean).join(" · ")})`);
        }
      }
    }
    expect(offenders, "채운 보라가 버튼 밖에 쓰였다").toEqual([]);
    // 예외 목록에 죽은 항목이 없다 — 목록의 선택자는 지금도 주 버튼 색으로 풀린다
    for (const sel of DATA_VIZ.keys()) {
      const hit = rules.filter((r) => r.selector.split(",").map((x) => x.trim()).includes(sel));
      expect(hit.some((r) => fillsOf(r.body).some((c) => PRIMARY_FILL.has(c))), sel).toBe(true);
    }
  });

  /**
   * 🔴 리뷰 P2-1: 추이 그래프의 '확정' 조각과 '나누지 않은 날'(3건 미만이라 상태를 나누지 않은 칸) 조각이 **같은 색**이었다.
   * 범례 견본도 같아서 색으로는 둘을 가를 수 없었다. 나누지 않은 날은 **회색 빗금**(색이 다르고 + 무늬라는 색 밖의 단서)으로 그리고,
   * 범례 견본은 **같은 규칙**을 써서 어긋날 수 없게 한다.
   */
  test("🔴 '나누지 않은 날' 조각·견본 — 확정 색이 아니고 빗금 무늬가 있으며 조각과 견본이 한 규칙이다", () => {
    const unsplit = rules.filter((r) => {
      const sels = r.selector.split(",").map((x) => x.trim());
      return sels.includes('.trendSeg[data-kind="unsplit"]') || sels.includes('.legendSwatch[data-kind="unsplit"]');
    });
    expect(unsplit).toHaveLength(1);
    const sels = unsplit[0].selector.split(",").map((x) => x.trim());
    expect(sels).toEqual(expect.arrayContaining(['.trendSeg[data-kind="unsplit"]', '.legendSwatch[data-kind="unsplit"]']));
    const confirmed = new Set(fillsOf(body('.trendSeg[data-kind="confirmed"]')));
    expect(confirmed.size).toBeGreaterThan(0);
    const colors = fillsOf(unsplit[0].body);
    expect(colors.length).toBeGreaterThan(0);
    for (const c of colors) expect(confirmed.has(c), c).toBe(false);
    expect(FILL_PROPS.map((p) => decl(unsplit[0].body, p) ?? "").join(" ")).toMatch(/repeating-linear-gradient\(/);
  });

  test("현재 표시·선택 표시는 옅은 면 + 띠/테두리 — 사이드바 현재 · 탭 바 현재 · 선택된 필터 · 노출 중 배지", () => {
    const side = rules.filter((r) => r.selector.startsWith(".sideItem[aria-current]") && !r.selector.includes("::"));
    expect(side.length).toBeGreaterThan(0);
    expect(decl(side.map((r) => r.body).join(";"), "background")).toBe("var(--bg-subtle)");
    const stripe = body(".sideItem[aria-current]::before");
    expect(decl(stripe, "width")).toBe("4px");
    expect(decl(stripe, "background")).toBe("var(--border-strong)");
    expect(decl(body(".tabItem[aria-current]::before"), "height")).toBe("3px");
    const filter = body('.filter[aria-current="true"], .filter[aria-current="page"]');
    expect(decl(filter, "background")).toBe("var(--bg-subtle)");
    expect(decl(filter, "border-color")).toBe("var(--border-strong)");
    const live = body('.badge[data-state="live"]');
    expect(decl(live, "background")).toBe("var(--status-confirmed-bg)");
    expect(decl(live, "color")).toBe("var(--status-confirmed-fg)");
  });

  test("발송 실패 배지는 '급함' 톤(조치 필수 — 시안 ⑤-0) · 옛 예약 상태 배지 규칙(.badge[data-status=new|confirmed|done|cancelled])은 지웠다", () => {
    const failed = body('.badge[data-status="failed"]');
    expect(decl(failed, "background")).toBe("var(--status-urgent-bg)");
    expect(decl(failed, "color")).toBe("var(--status-urgent-fg)");
    for (const s of ["new", "confirmed", "done", "cancelled"]) expect(rules.some((r) => r.selector === `.badge[data-status="${s}"]`), s).toBe(false);
  });
});

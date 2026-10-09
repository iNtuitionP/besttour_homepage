/**
 * P5-22 — 접수 상세 재배치 `/admin/reservations/[id]` (브리프 P5-22 §A · §B · B-2 · 시안 docs/handoff/2026-09-27-admin-ux #detail · 제안서 ⑤-3 · ⑦ 1-2).
 *
 * 이 파일이 잠그는 것 (처리 부품 하나하나는 tests/admin-detail-panel.test.ts)
 *   1. 머리 — 배지 줄(상태 + 간편 칩 "간편 접수 · 전화 확인 필요") · 제목 = "{이름} 님"(이름은 `#admin-customer-name` 안에만 — P5-19 시트가 읽는다) ·
 *      한 줄 메타 "{접수 시각} 접수 ({경과}) · {홈 간편 견적 / 상세 접수} · 접수번호 {코드}"
 *   2. 배치 — DOM 순서가 연락·처리 → 본문(운행 · 전화로 확인할 것 · 요청 사항 · 메모 · 접수 기록 · 휴대폰 맨 아래 취소).
 *      ≥1024px 는 본문 2/3 + 오른쪽 1/3 고정 열(sticky) · <1024px 는 한 열 + 아래 고정 행동 바 [전화] [확정하기](확정 뒤 [전화] [문자 보내기]) ·
 *      이 화면에서는 아래 탭 바와 셸의 위 제목줄을 숨기고, 위 제목줄 자리에 ← · 접수 상세 · ⋯(취소 시트)
 *   3. 운행 카드 — 가는 날 · 오는 날 · 기간(여러 날만 — P5-21 목록 규칙) · 인원 · 출발 시각 · 차량 · 왕복·편도 · 여행 구분 — 간편 접수의 미정 칸은 "전화로 확인"
 *   4. 접수 기록 `<details>` — 라벨은 기존 admin.detail.field.*(원장 라벨 무변경) · 청약철회 제한 동의 규칙(P1-7) 그대로
 *   5. 개인정보 경계 — 이름·번호·메일·요청 사항은 서버가 그린다. 클라이언트 섬(처리 영역 · 진입 버튼)의 props 에 0 (P5-19 페이지 테스트 방식)
 *   6. B-2 — "← 접수 목록" 은 들어온 탭·쪽으로(`?from=` · `&page=` — 상태·쪽만)
 *   7. CSS — 탭 바 숨김은 상세만 · 스크롤 여백은 행동 바 높이 · 행동 바 48px · 오른쪽 열 sticky
 *
 * 서버 컴포넌트를 직접 호출해 렌더 결과를 본다(인증 우회 없음: requireAdmin 은 이 테스트 프로세스 안에서만 통과로 바꾼다 — 게이트는
 * scripts/check-admin-gate.mjs 가 잠근다). 클라이언트 섬은 **받은 props 만 기록**하는 가짜로 바꾼다 — 경계를 넘는 값이 관심사다.
 * tests/ 아래라 게이트 3종의 검사 대상이다 — 금지어·임시값 마커 리터럴을 쓰지 않는다. 이름·번호는 전부 가짜다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock("@/lib/auth/requireAdmin", () => ({ requireAdmin: vi.fn(async () => ({ userId: "test" })) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => createElement("a", { href, ...rest }, children),
}));
const captured = vi.hoisted(() => ({ actions: [] as Record<string, unknown>[], triggers: [] as Record<string, unknown>[] }));
// 클라이언트 섬 — 받은 props 만 기록하고, 자리를 알 수 있게 표식 하나만 그린다
vi.mock("@/components/admin/ReservationActions", async () => {
  const { createElement: ce } = await import("react");
  return {
    ReservationActions: (props: Record<string, unknown>) => {
      captured.actions.push(props);
      return ce("div", { "data-testid": "owner-island" });
    },
  };
});
vi.mock("@/components/admin/SheetTrigger", async () => {
  const { createElement: ce } = await import("react");
  return {
    SheetTrigger: (props: Record<string, unknown>) => {
      captured.triggers.push(props);
      return ce("button", { type: "button", "data-testid": props.testId, "data-sheet": props.kind, "data-variant": props.variant }, props.label as string);
    },
  };
});
vi.mock("@/lib/queries", () => ({
  getVehicles: vi.fn(async () => [{ id: 1, slug: "bus45", nameKo: "45인승 우등", nameEn: "45-seat", capacity: 45, sort: 1, active: true }]),
}));
vi.mock("@/lib/admin/reservations", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/admin/reservations")>();
  return { ...mod, getReservation: vi.fn(), listReservations: vi.fn() };
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

import AdminReservationDetailPage from "@/app/admin/(protected)/reservations/[id]/page";
import { CUSTOMER_NAME_ELEMENT_ID } from "@/components/admin/reservation-sheet";
import { PROCESS_REGION_ATTR } from "@/components/admin/reservation-panel";
import { getReservation, type ReservationDetailRow } from "@/lib/admin/reservations";
import { locationLabelKo } from "@/lib/codes";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

const DETAIL_PAGE = "app/admin/(protected)/reservations/[id]/page.tsx";
const LIST_PAGE = "app/admin/(protected)/reservations/page.tsx";
const ADMIN_CSS = "components/admin/admin.module.css";

const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, Record<string, unknown>>; reservationCheck: Record<string, Record<string, string>> };
const detail = ko.admin.detail as Record<string, unknown> & Record<string, string>;
const dobj = (k: string) => detail[k] as unknown as Record<string, string>;
const field = dobj("field");
const res = ko.admin.reservations as Record<string, unknown> & Record<string, string>;
const dates = ko.admin.dates as Record<string, unknown>;
const weekday = (i: number) => (dates.weekdays as string[])[i];
const fill = (tpl: string, v: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k]));

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? null;
function openTag(html: string, testid: string): string {
  const at = html.indexOf(`data-testid="${testid}"`);
  expect(at, `${testid} 가 없다`).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}
const at = (html: string, testid: string) => html.indexOf(`data-testid="${testid}"`);
/** data-testid 요소 하나의 안쪽(같은 태그의 짝이 맞는 닫는 태그까지). */
function elementOf(html: string, testid: string): string {
  const tag = openTag(html, testid);
  const name = /^<([a-z0-9]+)/.exec(tag)![1];
  let depth = 0;
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, "g");
  re.lastIndex = html.indexOf(tag);
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(html.indexOf(tag) + tag.length, m.index);
  }
  throw new Error(`${testid} 가 닫히지 않는다`);
}
/** 정의 목록(dl)의 dt → dd 글자 — 같은 줄의 짝. */
function kv(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) out[text(m[1])] = text(m[2]);
  return out;
}

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
/** 기준 시각 — 2026-09-28(월) 10:00 KST. */
const NOW = new Date("2026-09-28T01:00:00.000Z");
const PII = {
  name: "김서연",
  phone: "+821055512345",
  email: "seoyeon@example.test",
  message: "성수기라 급합니다 010-9999-8888",
};
const QUICK_ROW: ReservationDetailRow = {
  id: ID,
  public_code: "QK2345AB",
  status: "new",
  intake: "quick",
  name: PII.name,
  phone: PII.phone,
  vehicle_slug: null,
  origin_code: "ICN",
  destination_code: "SEL",
  trip_type: null,
  depart_at: "2026-09-30T15:00:00.000Z", // KST 10/1(목) 00:00 — 자리값
  return_at: "2026-10-02T15:00:00.000Z", // KST 10/3(토)
  bus_count: null,
  passengers: 30,
  created_at: "2026-09-28T00:35:00.000Z", // KST 오늘 09:35 — 25분 전
  confirmed_at: null,
  email: PII.email,
  purpose_code: null,
  waypoint_codes: [],
  contact_method: null,
  payment_method: null,
  parking_included: null,
  vat_included: null,
  message: null,
  admin_memo: "통화함 — 7시 출발",
  privacy_consent_at: "2026-09-28T00:35:00.000Z",
  marketing_consent_at: null,
  retention_until: "2027-09-28T00:35:00.000Z",
  withdrawal_consent_at: "2026-09-28T00:35:00.000Z",
  withdrawal_consent_legacy: false,
};
const WIZARD_ROW: ReservationDetailRow = {
  ...QUICK_ROW,
  public_code: "WZ2345AB",
  intake: "wizard",
  vehicle_slug: "bus45",
  origin_code: "SEL",
  destination_code: "BSN",
  trip_type: "round",
  depart_at: "2026-09-30T23:30:00.000Z", // KST 10/1(목) 08:30
  return_at: "2026-10-02T09:00:00.000Z", // KST 10/2(금) 18:00
  bus_count: 2,
  passengers: 40,
  created_at: "2026-09-25T00:00:00.000Z", // KST 9/25 09:00 — 73시간 전(72시간 넘음 → 3일째 대기 · 3일 전)
  purpose_code: "family",
  waypoint_codes: ["DGU"],
  contact_method: "mobile",
  payment_method: "card",
  parking_included: true,
  vat_included: false,
  message: PII.message,
};

async function renderTree(row: ReservationDetailRow | null, search?: Record<string, string | string[]>) {
  vi.mocked(getReservation).mockResolvedValue(row);
  const tree = (await AdminReservationDetailPage({
    params: Promise.resolve({ id: row?.id ?? ID }),
    ...(search === undefined ? {} : { searchParams: Promise.resolve(search) }),
  })) as ReactElement;
  return { tree, html: renderToStaticMarkup(tree) };
}
const render = async (row: ReservationDetailRow | null, search?: Record<string, string | string[]>) => (await renderTree(row, search)).html;

/** React 요소(취소 본문의 <b>)를 포함한 props 를 글자로 — 경계를 넘는 모든 문자열이 여기에 나온다. */
const dump = (v: unknown) => JSON.stringify(v, (_k, val: unknown) => (typeof val === "symbol" ? String(val) : val));

beforeEach(() => {
  captured.actions.length = 0;
  captured.triggers.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

// =============================================================================
// 1. 머리
// =============================================================================
describe("1. 머리 — 배지 줄 · '{이름} 님' · 한 줄 메타", () => {
  test("🔴 제목 = '{이름} 님' — 이름은 `#admin-customer-name` 하나 안에만(P5-19 시트가 이 글자를 읽는다 — 연결을 깨지 않는다)", async () => {
    const html = await render(QUICK_ROW);
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    expect(h1).not.toBeNull();
    expect(text(h1![1])).toBe(fill(detail.titleName, { name: PII.name }));
    expect(detail.titleName).toBe("{name} 님");
    const hits = [...html.matchAll(new RegExp(`id="${CUSTOMER_NAME_ELEMENT_ID}"`, "g"))];
    expect(hits).toHaveLength(1);
    expect(new RegExp(`id="${CUSTOMER_NAME_ELEMENT_ID}"[^>]*>([^<]*)<`).exec(html)?.[1]).toBe(PII.name);
    // 그 요소는 제목 안에 있다
    expect(h1![1]).toContain(`id="${CUSTOMER_NAME_ELEMENT_ID}"`);
    // 옛 제목 "접수 상세 · 코드" 는 없다(제목은 사장님이 기억하는 이름)
    expect(text(h1![1])).not.toContain(QUICK_ROW.public_code);
  });

  test("🔴 배지 줄 — 상태 배지 + 간편이면 '간편 접수 · 전화 확인 필요' 칩(P5-20 배지 부품) · 72시간 넘은 새 접수는 N일째 대기", async () => {
    const html = await render(QUICK_ROW);
    const kinds = [...html.matchAll(/<span[^>]*data-testid="admin-status-badge"[^>]*>/g)].map((m) => attr(m[0], "data-kind"));
    expect(kinds).toEqual(["new", "quick"]);
    const row = text(elementOf(html, "admin-detail-badges"));
    expect(row).toContain((ko.admin.reservations.status as unknown as Record<string, string>).new);
    expect(row).toContain(dobj("value").intakeQuick);
    expect(dobj("value").intakeQuick).toBe("간편 접수 · 전화 확인 필요");
    const wiz = await render(WIZARD_ROW);
    expect([...wiz.matchAll(/<span[^>]*data-testid="admin-status-badge"[^>]*>/g)].map((m) => attr(m[0], "data-kind"))).toEqual(["waiting"]);
  });

  /**
   * P5-23 라운드 3 — 메타 줄은 조각 줄이다(components/admin/segments.tsx): 조각 셋이 차례로 서고, 조각 사이 가운데점은 CSS(`.seg::before`)가
   * 그리는 장식이라 DOM 글자에 없다(읽히지 않는다 · 줄 머리에서는 잘린다). 그래서 글자로는 조각이 빈칸 하나로 이어지고, 조각 수는 셋이다.
   */
  test("🔴 한 줄 메타 — '{접수 시각} 접수 ({경과})' / '홈 간편 견적' / '접수번호 {코드}' 세 조각 (오늘이면 시각만 · 상세 접수는 날짜)", async () => {
    const meta = dobj("meta");
    // vitest 의 CSS 모듈 이름은 `_seg_<해시>` 모양이다
    const segsOf = (h: string) => (h.match(/class="_seg_[0-9a-f]+"/g) ?? []).length;
    const quickHtml = elementOf(await render(QUICK_ROW), "admin-detail-meta");
    const quick = text(quickHtml);
    const when = fill(meta.today, { time: fill(dates.time as string, { hour: "09", minute: "35" }) });
    const ago = fill((res.elapsed as unknown as Record<string, string>).minutes, { n: 25 });
    expect(quick).toBe(`${fill(meta.received, { when, ago })} ${meta.intakeQuick} ${fill(meta.code, { code: "QK2345AB" })}`);
    expect(quick).toBe("오늘 09:35 접수 (25분 전) 홈 간편 견적 접수번호 QK2345AB");
    expect(quick, "가운데점은 DOM 글자가 아니다(CSS 장식)").not.toContain("·");
    expect(segsOf(quickHtml)).toBe(3);
    const wizard = text(elementOf(await render(WIZARD_ROW), "admin-detail-meta"));
    // 상세 접수는 기존 문구 그대로("상세 접수" — admin.detail.value.intakeWizard)
    expect(wizard).toBe(`${fill(meta.received, { when: fill(meta.date, { month: 9, day: 25, time: "09:00" }), ago: fill((res.elapsed as unknown as Record<string, string>).days, { n: 3 }) })} ${dobj("value").intakeWizard} ${fill(meta.code, { code: "WZ2345AB" })}`);
    expect(wizard).toBe("9월 25일 09:00 접수 (3일 전) 상세 접수 접수번호 WZ2345AB");
    // 해가 다르면 연도까지
    const old = text(elementOf(await render({ ...WIZARD_ROW, created_at: "2025-12-31T03:00:00.000Z" }), "admin-detail-meta"));
    expect(old.startsWith(fill(meta.year, { year: 2025, month: 12, day: 31, time: "12:00" }))).toBe(true);
  });
});

// =============================================================================
// 2. 배치 — 연락·처리가 본문보다 앞 · 휴대폰 행동 바 · 위 제목줄
// =============================================================================
describe("2. 배치 — DOM 순서 · 연락 카드 · 처리 카드 · 행동 바 · 위 제목줄", () => {
  test("🔴 연락·처리가 본문(운행 · 메모 · 접수 기록)보다 앞 — 휴대폰 한 열에서는 연락이 맨 위 · 넓은 화면에서는 오른쪽 열", async () => {
    const html = await render(QUICK_ROW);
    const order = ["admin-detail-meta", "admin-contact", "admin-reservation-actions", "admin-trip", "owner-island", "admin-records", "admin-mobile-process", "admin-actionbar"];
    const idx = order.map((id) => at(html, id));
    for (const [i, id] of order.entries()) expect(idx[i], `${id} 가 없다`).toBeGreaterThanOrEqual(0);
    expect([...idx].sort((a, b) => a - b), order.join(" < ")).toEqual(idx);
    // 오른쪽 열(연락 · 처리)과 본문 열
    const side = elementOf(html, "admin-detail-side");
    expect(side).toContain('data-testid="admin-contact"');
    expect(side).toContain('data-testid="admin-reservation-actions"');
    const main = elementOf(html, "admin-detail-main");
    for (const id of ["admin-trip", "owner-island", "admin-records", "admin-mobile-process"]) expect(main, id).toContain(`data-testid="${id}"`);
  });

  test("🔴 연락 카드 — 큰 번호(국내 표기) · [전화 걸기] tel: · [문자 보내기] sms:(전체 번호 — 서버가 그린다) · 메일 주소", async () => {
    const html = await render(QUICK_ROW);
    const card = elementOf(html, "admin-contact");
    const contact = dobj("contact");
    expect(text(card)).toContain("010-5551-2345");
    const call = openTag(card, "admin-call");
    const sms = openTag(card, "admin-sms");
    expect(attr(call, "href")).toBe("tel:+821055512345");
    expect(attr(sms, "href")).toBe("sms:+821055512345");
    expect(text(elementOf(card, "admin-call"))).toBe(contact.call);
    expect(text(elementOf(card, "admin-sms"))).toBe(contact.sms);
    expect(text(card)).toContain(PII.email);
    expect(text(card)).toContain(field.email);
  });

  test("🔴 처리 카드(데스크톱) — 확정 진입 버튼 · 취소 글자 버튼 · 처리 영역 표식(성공 뒤 포커스 자리)", async () => {
    const html = await render(QUICK_ROW);
    const region = openTag(html, "admin-reservation-actions");
    expect(attr(region, PROCESS_REGION_ATTR)).toBe("");
    expect(attr(openTag(html, "admin-confirm"), "data-sheet")).toBe("confirm");
    expect(attr(openTag(html, "admin-cancel"), "data-sheet")).toBe("cancel");
  });

  test("🔴 휴대폰 아래 고정 행동 바 — 새 접수: [전화] + [확정하기](시트를 여는 진입 버튼 — 클라이언트 섬은 이것 하나) · 이름 붙은 묶음 · 처리 영역", async () => {
    const html = await render(QUICK_ROW);
    const bar = openTag(html, "admin-actionbar");
    expect(attr(bar, "role")).toBe("group");
    expect(attr(bar, "aria-label")).toBe(dobj("bar").label);
    expect(attr(bar, "tabindex")).toBe("-1");
    expect(attr(bar, PROCESS_REGION_ATTR)).toBe("");
    const inside = elementOf(html, "admin-actionbar");
    const telLinks = [...inside.matchAll(/<a[^>]*href="(tel:[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    expect(telLinks.map((m) => m[1])).toEqual(["tel:+821055512345"]);
    expect(text(telLinks[0][2])).toBe(dobj("bar").call);
    expect(attr(openTag(inside, "admin-bar-confirm"), "data-sheet")).toBe("confirm");
    expect(inside).not.toMatch(/href="sms:/);
    const barTriggers = captured.triggers.filter((p) => p.testId === "admin-bar-confirm");
    expect(barTriggers).toHaveLength(1);
    expect(barTriggers[0].variant).toBe("primary");
  });

  test("🔴 확정된 건의 행동 바 — [전화] [문자 보내기](확정 진입 버튼 없음)", async () => {
    const html = await render({ ...QUICK_ROW, status: "confirmed", confirmed_at: "2026-09-28T00:50:00.000Z" });
    const inside = elementOf(html, "admin-actionbar");
    expect([...inside.matchAll(/href="((?:tel|sms):[^"]+)"/g)].map((m) => m[1])).toEqual(["tel:+821055512345", "sms:+821055512345"]);
    expect(inside).not.toContain("admin-bar-confirm");
    expect(text(inside)).toContain(dobj("bar").sms);
  });

  test("🔴 휴대폰 위 제목줄 — ← (들어온 목록으로 · 이름 있음) · '접수 상세' · ⋯(취소 시트 — 취소할 수 있을 때만)", async () => {
    const html = await render(QUICK_ROW);
    const top = elementOf(html, "admin-detail-topbar");
    const back = openTag(top, "admin-detail-back-mobile");
    expect(attr(back, "href")).toBe("/admin/reservations");
    expect(attr(back, "aria-label")).toBe(detail.backAria);
    expect(text(top)).toContain(detail.title);
    expect(attr(openTag(top, "admin-more-cancel"), "data-sheet")).toBe("cancel");
    const more = captured.triggers.find((p) => p.testId === "admin-more-cancel")!;
    expect(more.variant).toBe("icon");
    expect(more.label).toBe(dobj("process").moreCancel);
    for (const status of ["done", "cancelled"] as const) {
      const done = await render({ ...QUICK_ROW, status });
      expect(elementOf(done, "admin-detail-topbar"), status).not.toContain("admin-more-cancel");
    }
  });

  test("휴대폰 맨 아래 — 취소 글자 버튼(확정 버튼과 멀리 · 접수 기록 다음) · 확정이면 운행 완료가 완료 시트를 연다(리뷰 P2-6)", async () => {
    const html = await render(QUICK_ROW);
    const zone = elementOf(html, "admin-mobile-process");
    expect(attr(openTag(zone, "admin-cancel-mobile"), "data-sheet")).toBe("cancel");
    expect(at(html, "admin-mobile-process")).toBeGreaterThan(at(html, "admin-records"));
    const confirmed = elementOf(await render({ ...WIZARD_ROW, status: "confirmed" as const }), "admin-mobile-process");
    expect(attr(openTag(confirmed, "admin-complete-mobile"), "data-sheet")).toBe("complete");
    expect(attr(openTag(confirmed, "admin-cancel-mobile"), "data-sheet")).toBe("cancel");
  });

  test("찾을 수 없는 접수 — 처리 영역·진입 버튼을 그리지 않고, 목록으로 돌아가는 링크만", async () => {
    const html = await render(null, { from: "done" });
    expect(captured.actions).toEqual([]);
    expect(captured.triggers).toEqual([]);
    expect(text(html)).toContain(detail.notFound);
    expect(html).toContain('href="/admin/reservations?status=done"');
  });
});

// =============================================================================
// 3. 운행 카드
// =============================================================================
describe("3. 운행 카드 — 큰 구간 · 가는 날 · 오는 날 · 기간 · 인원 · 출발 시각 · 차량 · 왕복·편도", () => {
  const trip = () => dobj("trip");

  test("🔴 간편 접수 — 날짜만(00:00 은 자리값) · 기간은 P5-21 목록 규칙(여러 날만) · 미정 칸은 '전화로 확인'(전화 표시 · 네 칸)", async () => {
    const html = await render(QUICK_ROW);
    const card = elementOf(html, "admin-trip");
    expect(text(/<p[^>]*data-testid="admin-trip-route"[^>]*>([\s\S]*?)<\/p>/.exec(card)![1])).toBe(`${locationLabelKo("ICN")} → ${locationLabelKo("SEL")}`);
    const rows = kv(card);
    const t = trip();
    expect(rows[t.go]).toBe(fill(dates.day as string, { month: 10, day: 1, weekday: weekday(4) }));
    expect(rows[t.back]).toBe(fill(dates.day as string, { month: 10, day: 3, weekday: weekday(6) }));
    expect(rows[t.stay]).toBe(fill(res.stay, { nights: 2, days: 3 }));
    expect(rows[t.pax]).toBe("30명");
    for (const k of [t.time, field.vehicle, t.tripType, field.purpose]) expect(rows[k], k).toBe(t.undecided);
    expect(t.undecided).toBe("전화로 확인");
    const undecided = [...card.matchAll(/<dd[^>]*data-undecided="true"[^>]*>([\s\S]*?)<\/dd>/g)];
    expect(undecided).toHaveLength(4);
    for (const u of undecided) expect(u[1]).toMatch(/<svg[^>]*aria-hidden="true"/);
    // 시각을 지어내지 않는다
    expect(text(card)).not.toMatch(/00:00/);
    expect(openTag(card, "admin-depart")).toMatch(/<dd/);
  });

  test("🔴 상세 접수 — 출발 시각 · 차량(이름 + 대수) · 왕복 · 여행 구분 · 오는 날은 시각까지 · 1박 2일 · 경유지 · 접수 조건 · 요청 사항은 메모 위에 따로", async () => {
    const html = await render(WIZARD_ROW);
    const rows = kv(elementOf(html, "admin-trip"));
    const t = trip();
    expect(rows[t.go]).toBe(fill(dates.day as string, { month: 10, day: 1, weekday: weekday(4) }));
    expect(rows[t.back]).toBe(`${fill(dates.day as string, { month: 10, day: 2, weekday: weekday(5) })} 18:00`);
    expect(rows[t.stay]).toBe(fill(res.stay, { nights: 1, days: 2 }));
    expect(rows[t.time]).toBe("08:30");
    expect(rows[field.vehicle]).toBe("45인승 우등 2대");
    expect(rows[t.tripType]).toBe(ko.reservationCheck.tripType.round);
    expect(rows[field.purpose]).toBe((ko.admin.labels as Record<string, Record<string, string>>).purpose.family);
    expect(rows[field.waypoints]).toBe(locationLabelKo("DGU"));
    expect(Object.values(rows)).not.toContain(t.undecided);
    // 옛 위저드의 조건 네 칸 — 따로 작은 카드
    const opts = kv(elementOf(html, "admin-options"));
    expect(opts[field.contactMethod]).toBe((ko.admin.labels as Record<string, Record<string, string>>).contact.mobile);
    expect(opts[field.paymentMethod]).toBe((ko.admin.labels as Record<string, Record<string, string>>).payment.card);
    expect(opts[field.parking]).toBe(dobj("value").included);
    expect(opts[field.vat]).toBe(dobj("value").excluded);
    // 요청 사항 — 서버가 그리는 따로 카드 · 메모(처리 영역)보다 위
    const req = elementOf(html, "admin-request");
    expect(text(req)).toContain(PII.message);
    expect(text(req)).toContain(field.message);
    expect(at(html, "admin-request")).toBeLessThan(at(html, "owner-island"));
  });

  test("당일 운행 · 돌아오는 날 없음 — 기간 줄이 없다(지어내지 않는다) · 상세 접수의 편도는 오는 날 '—'", async () => {
    const same = kv(elementOf(await render({ ...QUICK_ROW, return_at: null }), "admin-trip"));
    expect(same[trip().stay]).toBeUndefined();
    // 간편 접수의 도착일이 출발일과 같으면 저장값은 null — 오는 날 = 가는 날
    expect(same[trip().back]).toBe(same[trip().go]);
    const oneway = kv(elementOf(await render({ ...WIZARD_ROW, trip_type: "oneway", return_at: null }), "admin-trip"));
    expect(oneway[trip().stay]).toBeUndefined();
    expect(oneway[trip().back]).toBe(dobj("value").none);
    // 간편 접수에는 접수 조건 카드도 요청 사항 카드도 없다
    const html = await render(QUICK_ROW);
    expect(html).not.toContain('data-testid="admin-options"');
    expect(html).not.toContain('data-testid="admin-request"');
  });
});

// =============================================================================
// 4. 접수 기록 — 접힘 · 원장 라벨
// =============================================================================
describe("4. 접수 기록 (동의 · 보관) — <details> 접힘 · 라벨은 기존 admin.detail.field.*", () => {
  // P5-23 라운드 2(컨트롤러 A-3) — 값은 KST 시각 그대로이되 원형("2026-09-28 09:35") 대신 관리자 날짜 틀("9월 28일 (월) 09:35" · 올해가 아니면 연도까지)
  test("🔴 접힌 채로 시작 · 요약 문구(시안) · 동의·파기 라벨 = 원장 라벨 그대로 · 값은 KST 시각(관리자 날짜 틀)", async () => {
    const html = await render(QUICK_ROW);
    const tag = openTag(html, "admin-records");
    expect(tag.startsWith("<details")).toBe(true);
    expect(attr(tag, "open")).toBeNull();
    expect(text(/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(elementOf(html, "admin-records"))![1])).toBe(detail.records);
    expect(detail.records).toBe("접수 기록 (동의 · 보관)");
    const rows = kv(elementOf(html, "admin-records"));
    expect(field.privacyConsentAt).toBe("개인정보 동의");
    expect(field.withdrawalConsentAt).toBe("청약철회 제한 동의");
    expect(field.marketingConsentAt).toBe("광고성 정보 수신 동의");
    expect(field.retentionUntil).toBe("파기 예정");
    expect(rows[field.privacyConsentAt]).toBe("9월 28일 (월) 09:35");
    expect(rows[field.withdrawalConsentAt]).toBe("9월 28일 (월) 09:35");
    expect(rows[field.marketingConsentAt]).toBe(dobj("value").notConsented);
    expect(rows[field.retentionUntil]).toBe("2027년 9월 28일 (화) 09:35");
    expect(rows[field.createdAt]).toBe("9월 28일 (월) 09:35");
    // 원형 날짜(YYYY-MM-DD)는 접수 기록 어디에도 없다
    expect(text(elementOf(html, "admin-records"))).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(rows[field.confirmedAt]).toBe(dobj("value").none);
    expect(openTag(html, "admin-withdrawal-consent")).toMatch(/<dd/);
  });

  test("동의 기록 도입 전 접수 — '기록 없음(동의 기록 도입 전 접수)'(P1-7 그대로 · 날짜를 박지 않는다)", async () => {
    const rows = kv(elementOf(await render({ ...QUICK_ROW, withdrawal_consent_at: null, withdrawal_consent_legacy: true }), "admin-records"));
    expect(rows[field.withdrawalConsentAt]).toBe(dobj("value").noWithdrawalRecord);
  });

  /**
   * 수정 라운드(컨트롤러 결정) — 새 배치가 그리지 않게 된 옛 칸 라벨을 카탈로그에서 지웠다(값을 잠그던 테스트도 함께 — admin-copy-tone 의
   * "동의 · 보유" 절 제목). 대신 **그려지는 것**을 잠근다: 접수 기록의 원장 라벨(동의·보관)은 그대로이고 실제 화면에 있다.
   */
  test("카탈로그 정리 — 그리지 않는 옛 칸 라벨은 없다 · 원장 라벨(동의·보관)은 그대로 화면에 그려진다", async () => {
    for (const k of ["code", "status", "name", "phone", "route", "tripType", "departAt", "returnAt", "busCount", "passengers", "memo", "intake", "departDate", "returnDate"]) {
      expect(field, `admin.detail.field.${k}`).not.toHaveProperty(k);
    }
    expect(detail, "admin.detail.sectionConsent").not.toHaveProperty("sectionConsent");
    expect(dobj("value"), "admin.detail.value.consented").not.toHaveProperty("consented");
    expect(ko.admin.labels, "admin.labels.undecided").not.toHaveProperty("undecided");
    const records = text(elementOf(await render(QUICK_ROW), "admin-records"));
    for (const k of ["createdAt", "confirmedAt", "privacyConsentAt", "withdrawalConsentAt", "marketingConsentAt", "retentionUntil"]) {
      expect(records, k).toContain(field[k]);
    }
  });
});

// =============================================================================
// 5. 개인정보 경계 — 클라이언트 섬 props 0
// =============================================================================
describe("5. 개인정보 — 이름·번호·메일·요청 사항은 서버가 그린다 · 클라이언트 섬 props 에 0", () => {
  test("🔴 처리 영역은 P5-19 그대로 uuid·상태·메모·운행 요약·라벨 · 진입 버튼은 uuid·종류·문구·모양·testid — 개인정보·접수번호 0", async () => {
    for (const row of [QUICK_ROW, WIZARD_ROW, { ...WIZARD_ROW, status: "confirmed" as const }]) {
      captured.actions.length = 0;
      captured.triggers.length = 0;
      await render(row);
      expect(captured.actions).toHaveLength(1);
      expect(Object.keys(captured.actions[0]).sort()).toEqual(["id", "initialMemo", "labels", "status", "summary"]);
      expect(captured.triggers.length).toBeGreaterThanOrEqual(3);
      for (const t of captured.triggers) expect(Object.keys(t).sort()).toEqual(["id", "kind", "label", "testId", "variant"]);
      const all = dump({ actions: captured.actions, triggers: captured.triggers });
      for (const [key, value] of Object.entries(PII)) expect(all, `props 에 ${key} 원문`).not.toContain(value);
      for (const frag of ["55512345", "5551-2345", "9999-8888", "seoyeon", row.public_code]) expect(all, frag).not.toContain(frag);
    }
  });

  test("정적 — 페이지는 클라이언트 섬에 row.name·phone·email·message·public_code 를 넘기지 않는다 · 행을 받는 서버 부품이 없다(개발 모드가 props 를 HTML 에 싣는다)", () => {
    const src = codeOf(DETAIL_PAGE);
    for (const tag of src.match(/<(ReservationActions|SheetTrigger|ReservationProcess)\b[\s\S]*?\/>/g) ?? []) {
      for (const f of ["name", "phone", "email", "message", "public_code"]) expect(tag, `${f}`).not.toMatch(new RegExp(`row\\.${f}\\b`));
    }
    // 이름 칸 — 제목 안의 span 하나(P5-19 시트가 읽는 id)
    expect(src).toMatch(/<span id=\{CUSTOMER_NAME_ELEMENT_ID\}>\s*\{row\.name\}\s*<\/span>/);
    // 이 파일 안에서 컴포넌트로 쓰는 것은 import 한 부품뿐 — 행을 props 로 받는 지역 부품이 없다
    const local = [...src.matchAll(/^function ([A-Z]\w*)\(/gm)].map((m) => m[1]);
    expect(local).toEqual([]);
  });

  test("정적 — 처리 영역은 접수마다 새로 만든다(key = uuid) — 체크리스트 체크·메모 편집이 다른 접수로 넘어가지 않는다(개인정보 아님 · uuid 만)", () => {
    const tag = /<ReservationActions\b[\s\S]*?\/>/.exec(codeOf(DETAIL_PAGE))?.[0] ?? "";
    expect(tag).toMatch(/\bkey=\{row\.id\}/);
  });
});

// =============================================================================
// 6. B-2 — 들어온 탭·쪽으로 돌아간다
// =============================================================================
describe("6. B-2 — '← 접수 목록' 은 들어온 탭(상태·쪽)으로", () => {
  test("🔴 `?from=confirmed&page=2` 로 들어오면 데스크톱 링크와 휴대폰 ← 가 둘 다 확정 탭 2쪽으로 · 쿼리 없으면 기본(새 접수) 탭", async () => {
    const html = await render(QUICK_ROW, { from: "confirmed", page: "2" });
    const want = "/admin/reservations?status=confirmed&amp;page=2";
    expect(attr(openTag(html, "admin-detail-back"), "href")).toBe(want);
    expect(attr(openTag(html, "admin-detail-back-mobile"), "href")).toBe(want);
    expect(text(elementOf(html, "admin-detail-back"))).toBe(detail.back);
    const plain = await render(QUICK_ROW);
    expect(attr(openTag(plain, "admin-detail-back"), "href")).toBe("/admin/reservations");
    // 쓰레기값은 기본 탭으로(되울리지 않는다)
    const junk = await render(QUICK_ROW, { from: "<b>x</b>", page: "abc" });
    expect(attr(openTag(junk, "admin-detail-back"), "href")).toBe("/admin/reservations");
  });
});

// =============================================================================
// 7. CSS — 탭 바 숨김(상세만) · 스크롤 여백 = 행동 바 · 48px · 오른쪽 열 sticky
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
    const pos = m.index!;
    const media = medias.find((x) => pos > x.start && pos < x.end)?.query ?? null;
    out.push({ selector: selector.replace(/^@media[^{]*/, "").trim(), body: m[2], media });
  }
  return out;
}
const decl = (body: string, prop: string): string | null => new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim() ?? null;
const DESKTOP = "(min-width: 1024px)";

describe("7. CSS — 탭 바는 상세에서만 숨긴다 · 행동 바 · 스크롤 여백 · 오른쪽 열", () => {
  const rules = cssRules(read(ADMIN_CSS));
  const has = (sel: string, media: string | null = null) => rules.filter((r) => r.media === media && r.selector.split(",").map((x) => x.trim()).includes(sel));
  const body = (sel: string, media: string | null = null) => has(sel, media).map((r) => r.body).join(";");

  test("🔴 상세 화면만 — 셸의 아래 탭 바 · 탭 바 여백 · 위 제목줄을 숨긴다(표식 .detailPage 를 가진 셸만) · 목록 화면에는 표식이 없다", () => {
    for (const sel of [".shell:has(.detailPage) .tabbar", ".shell:has(.detailPage) .tabbarSpacer", ".shell:has(.detailPage) .topbar"]) {
      expect(decl(body(sel), "display"), sel).toBe("none");
    }
    expect(codeOf(DETAIL_PAGE)).toMatch(/className=\{a\.detailPage\}/);
    expect(codeOf(LIST_PAGE)).not.toMatch(/detailPage/);
    expect(codeOf("app/admin/(protected)/page.tsx")).not.toMatch(/detailPage/);
  });

  test("🔴 행동 바 — 화면 아래 고정(탭 바와 같은 층) · 버튼 48px · 넓은 화면에서는 숨김 · 본문 끝 여백 = 스크롤 여백(포커스·배너가 바 뒤로 숨지 않게 — P5-20 P1-1 기준)", () => {
    const bar = body(".actionBar");
    expect(decl(bar, "position")).toBe("fixed");
    expect(decl(bar, "bottom")).toBe("0");
    expect(decl(bar, "z-index")).toBe("30");
    expect(decl(bar, "padding")).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(decl(body(".actionBar > *"), "min-height")).toBe("48px");
    expect(decl(body(".actionBar", DESKTOP), "display")).toBe("none");
    const pad = decl(body(":global(html):has(.detailPage)"), "scroll-padding-bottom");
    expect(pad).toBe("calc(48px + 1px + 3 * var(--space-stack-xs) + env(safe-area-inset-bottom))");
    expect(decl(body(".actionBarSpacer"), "height")).toBe(pad);
    // 넓은 화면에는 행동 바가 없다 — 아래 여백은 행동 바 높이가 아니라 틈 하나(수정 라운드 · 아래 sticky 테스트)
    expect(decl(body(":global(html):has(.detailPage)", DESKTOP), "scroll-padding-bottom")).not.toBe(pad);
    // 위 제목줄(상세)도 붙어 있다 — 위 여백은 셸과 같은 높이
    expect(decl(body(":global(html):has(.detailPage)"), "scroll-padding-top")).toBe("calc(56px + var(--space-stack-xs))");
    expect(decl(body(".detailTop"), "position")).toBe("sticky");
    expect(decl(body(".detailTop"), "top")).toBe("0");
    expect(decl(body(".detailTop"), "min-height")).toBe("56px");
    expect(decl(body(".detailTop", DESKTOP), "display")).toBe("none");
  });

  test("🔴 넓은 화면(≥1024px) — 본문 2/3 + 오른쪽 1/3 열(DOM 은 먼저지만 오른쪽 칸) · 좁은 화면은 한 열 · 칸 최소 폭 0", () => {
    expect(decl(body(".detailCols"), "grid-template-columns")).toBe("minmax(0, 1fr)");
    const cols = decl(body(".detailCols", DESKTOP), "grid-template-columns") ?? "";
    expect(cols).toMatch(/^minmax\(0, 2fr\) minmax\([\d.]+rem, 1fr\)$/);
    const side = body(".detailSide", DESKTOP);
    expect(decl(side, "grid-column")).toBe("2");
    expect(decl(side, "grid-row")).toBe("1");
    expect(decl(body(".detailMain", DESKTOP), "grid-column")).toBe("1");
    // 처리 카드는 넓은 화면에서만 · 휴대폰 맨 아래 칸은 좁은 화면에서만
    expect(decl(body(".processCard"), "display")).toBe("none");
    expect(decl(body(".processCard", DESKTOP), "display")).toBe("block");
    expect(decl(body(".mobileProcess", DESKTOP), "display")).toBe("none");
    expect(decl(body(".detailBackDesktop"), "display")).toBe("none");
  });

  /**
   * 수정 라운드(리뷰 P2-4) — 오른쪽 열(연락 · 처리 카드 · 492~608px)이 화면보다 높으면 sticky 가 문서 스크롤을 따라 붙어, 아래쪽 버튼
   * ([이 접수 취소하기])에 키보드 포커스가 가도 화면 밖에 걸렸다(1024×520 · 1280×560 · 1024×640 실측). 열이 화면에 다 들어가는 높이에서만
   * 붙인다 — 가장 높은 열 608px + 위 틈 24px + 초점 테두리·여유 = 720px. 그보다 낮으면 보통 흐름(static)이라 포커스가 문서 스크롤로 보인다.
   */
  test("🔴 오른쪽 열 sticky 는 높이가 넉넉할 때만(≥720px — 열 전체가 화면에 들어간다) · 낮은 넓은 화면은 보통 흐름", () => {
    const TALL = "(min-width: 1024px) and (min-height: 720px)";
    const sticky = body(".detailSide", TALL);
    expect(decl(sticky, "position")).toBe("sticky");
    expect(decl(sticky, "top")).toBe("var(--space-stack-md)");
    // 넓기만 한 화면(높이 조건 없음)에서는 sticky 가 아니다 — 1024×520 · 1280×560 · 1024×640 에서 포커스가 화면 밖에 걸리지 않게
    expect(decl(body(".detailSide", DESKTOP), "position")).toBeNull();
    expect(decl(body(".detailSide"), "position")).toBeNull();
    // 포커스로 스크롤될 때 화면 가장자리에 딱 붙지 않게(초점 테두리까지 보이게) 넓은 화면에서도 위아래 여백 — 낮은 화면 실측에서
    // 보통 흐름의 [이 접수 취소하기]가 516–560(화면 560)처럼 가장자리에 붙었다
    expect(decl(body(":global(html):has(.detailPage)", DESKTOP), "scroll-padding-top")).toBe("var(--space-stack-md)");
    expect(decl(body(":global(html):has(.detailPage)", DESKTOP), "scroll-padding-bottom")).toBe("var(--space-stack-md)");
  });

  test("연락 카드의 전화·문자 — 48px 누를 자리 · 자리가 있으면 두 칸, 좁으면 한 줄씩(1024px 오른쪽 열 280px 에서 '문자 보내기' 가 두 줄로 꺾였다 — 실측)", () => {
    // 칸 최소 폭(8rem)이 '문자 보내기'(아이콘 + 틈 + 글자 + 안쪽 여백 ≈ 123px)보다 넓다 — 두 칸이 안 들어가면 auto-fit 이 한 칸으로 내린다
    expect(decl(body(".contactBtns"), "grid-template-columns")).toBe("repeat(auto-fit, minmax(min(100%, 8rem), 1fr))");
    expect(decl(body(".contactBtns > *"), "min-height")).toBe("48px");
  });
});

// =============================================================================
// 8. 게이트 · 문구 규약
// =============================================================================
describe("8. 게이트 · 규약", () => {
  test("정적 — 첫 문장 await requireAdmin() · 한글 리터럴 0 · env 0 · 가격 0", () => {
    const src = codeOf(DETAIL_PAGE);
    const body = /export default async function AdminReservationDetailPage\([^)]*\)[^{]*\{\s*([^\n]+)/.exec(src)?.[1] ?? "";
    expect(body.trim()).toBe("await requireAdmin();");
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    expect(src).not.toMatch(/process\.env/);
    const forbidden = new RegExp(["est" + "_price", "price" + "_state", "route" + "_prices", "estim" + "ate\\(", "PRICE" + "_DISPLAY_MODE"].join("|"));
    expect(read(DETAIL_PAGE)).not.toMatch(forbidden);
  });

  test("새 문구 — 해요체 · '문자 기록' 없음(2단계 카드는 만들지 않는다)", () => {
    const touched = JSON.stringify({ meta: detail.meta, contact: detail.contact, bar: detail.bar, trip: detail.trip, checklist: detail.checklist, process: detail.process });
    expect(touched).not.toMatch(/습니다|십시오/);
    expect(JSON.stringify(ko.admin)).not.toContain("문자 기록");
  });

  test("매뉴얼 동조화 — 상세 화면 절이 새 배치의 화면 문구를 그대로 인용한다(카탈로그에서 읽는다 · 문서가 조용히 낡지 않게)", () => {
    const manual = read("docs/ops/admin-manual.md");
    const start = manual.indexOf("### 상세 화면");
    const end = manual.indexOf("### 확정 · 취소 · 완료");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const section = manual.slice(start, end);
    const contact = detail.contact as unknown as Record<string, string>;
    const bar = detail.bar as unknown as Record<string, string>;
    const trip = detail.trip as unknown as Record<string, string>;
    const checklist = detail.checklist as unknown as { title: string; items: string[]; note: string; memoHint: string; progress: string };
    const value = detail.value as unknown as Record<string, string>;
    const sheet = detail.sheet as unknown as Record<string, string>;
    for (const quote of [
      contact.title,
      contact.call,
      contact.sms,
      bar.call,
      String(detail.confirm),
      String(detail.title),
      trip.undecided,
      String(detail.records),
      value.intakeQuick,
      checklist.title,
      ...checklist.items,
      checklist.note,
      checklist.memoHint,
      String(detail.memoPlaceholder),
      checklist.progress.replace("{n}", "0").replace("{total}", String(checklist.items.length)),
      sheet.checkWarning.replace("{total}", String(checklist.items.length)).replace("{n}", "n"),
    ]) {
      expect(section, `매뉴얼 상세 화면 절에 없다: ${quote}`).toContain(quote);
    }
    // 체크는 저장되지 않는다 · 경고는 막지 않는다 — 두 사실을 문서가 말한다
    expect(section).toMatch(/체크는 저장되지 않습니다/);
    expect(section).toMatch(/막는 것은 아닙니다/);
    // 로그아웃 절 — 휴대폰 상세에서는 맨 위 줄이 바뀐다(로그아웃이 없다)는 것을 적는다
    const logout = manual.slice(manual.indexOf("### 나오실 때 — 로그아웃"), manual.indexOf("### 🔒 열쇠를 남에게 주지 마세요"));
    expect(logout).toContain(String(detail.title));
  });
});

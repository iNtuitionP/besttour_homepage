/**
 * P5-19 — 예약 상세 페이지 ↔ 처리 영역(클라이언트) 경계: 개인정보를 새 props 경로로 늘리지 않는다.
 *
 * 확인 시트 제목에 고객 이름이 들어간다("{이름} 님 접수를 확정할까요?"). 그 이름을 처리 영역 props 로 내리면
 * 서버 컴포넌트 → 클라이언트 경계로 개인정보가 새 길을 얻는다(P3-5 리뷰 N-2 — 이 페이지의 헤더 규약:
 * "클라이언트로는 uuid·상태·라벨·메모만"). 그래서 이름은 **서버가 이미 그린 한 곳**(`id=admin-customer-name`)에만 있고,
 * 시트는 열리는 순간 그 글자를 읽는다(components/admin/reservation-sheet.ts CUSTOMER_NAME_ELEMENT_ID).
 *
 * 서버 컴포넌트를 직접 호출해 렌더 결과와 **처리 영역이 받은 props** 를 본다(tests/quick-display.test.ts 와 같은 방식 —
 * 인증 우회 없음: requireAdmin 은 이 테스트 프로세스 안에서만 통과로 바꾼다. 게이트 자체는 check-admin-gate 가 잠근다).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock("@/lib/auth/requireAdmin", () => ({ requireAdmin: vi.fn(async () => ({ userId: "test" })) }));
const captured = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
// 처리 영역(클라이언트)은 **받은 props 만** 기록한다 — 경계를 넘는 값이 무엇인지가 이 파일의 관심사다.
vi.mock("@/components/admin/ReservationActions", () => ({
  ReservationActions: (props: Record<string, unknown>) => {
    captured.props.push(props);
    return null;
  },
}));
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
import { CUSTOMER_NAME_ELEMENT_ID, type ReservationActionLabels, type ReservationSummary } from "@/components/admin/reservation-sheet";
import { getReservation, type ReservationDetailRow } from "@/lib/admin/reservations";
import { locationLabelKo } from "@/lib/codes";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const DETAIL_PAGE = "app/admin/(protected)/reservations/[id]/page.tsx";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PII = {
  name: "김서연",
  phone: "+821055512345",
  email: "seoyeon@example.test",
  message: "성수기라 급합니다 010-9999-8888",
};
const ROW: ReservationDetailRow = {
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
  depart_at: "2026-09-30T15:00:00.000Z", // KST 2026-10-01 00:00 (자리값)
  return_at: "2026-10-02T15:00:00.000Z",
  bus_count: null,
  passengers: 30,
  created_at: "2026-09-27T03:04:00.000Z",
  confirmed_at: null,
  email: PII.email,
  purpose_code: null,
  waypoint_codes: [],
  contact_method: null,
  payment_method: null,
  parking_included: null,
  vat_included: null,
  message: PII.message,
  admin_memo: "통화함 — 7시 출발",
  privacy_consent_at: "2026-09-27T03:04:00.000Z",
  marketing_consent_at: null,
  retention_until: "2027-09-27T03:04:00.000Z",
  withdrawal_consent_at: "2026-09-27T03:04:00.000Z",
  withdrawal_consent_legacy: false,
};

async function render(row: ReservationDetailRow): Promise<{ html: string; props: Record<string, unknown> }> {
  vi.mocked(getReservation).mockResolvedValue(row);
  const html = renderToStaticMarkup((await AdminReservationDetailPage({ params: Promise.resolve({ id: row.id }) })) as ReactElement);
  const props = captured.props.at(-1);
  expect(props, "처리 영역이 렌더되지 않았다").toBeDefined();
  return { html, props: props! };
}

/** React 요소(취소 본문의 <b>)를 포함한 props 를 글자로 — 경계를 넘는 모든 문자열이 여기에 나온다. */
const dump = (v: unknown) => JSON.stringify(v, (_k, val: unknown) => (typeof val === "symbol" ? String(val) : val));

beforeEach(() => {
  captured.props.length = 0;
});

describe("1. 처리 영역 props — 개인정보 원문 0 (이름·전화·메일·요청 사항)", () => {
  test("받는 것은 uuid · 상태 · 메모 · 운행 요약 · 라벨뿐이다", async () => {
    const { props } = await render(ROW);
    expect(Object.keys(props).sort()).toEqual(["id", "initialMemo", "labels", "status", "summary"]);
    expect(props.id).toBe(ID);
    expect(props.status).toBe("new");
    expect(props.initialMemo).toBe("통화함 — 7시 출발");
    const text = dump(props);
    for (const [key, value] of Object.entries(PII)) expect(text, `props 에 ${key} 원문`).not.toContain(value);
    // 전화 조각(뒷자리)도 없다
    expect(text).not.toContain("55512345");
    expect(text).not.toContain("9999-8888");
    // 접수번호도 필요 없다 — 화면이 이미 보고 있다
    expect(text).not.toContain(ROW.public_code);
  });

  test("제목 틀은 이름 자리({name})가 빈 **틀** 이다 — 값이 아니다", async () => {
    const { props } = await render(ROW);
    const labels = props.labels as ReservationActionLabels;
    expect(labels.sheet.confirm.title).toBe("{name} 님 접수를 확정할까요?");
    expect(labels.sheet.cancel.title).toBe("{name} 님 접수를 취소할까요?");
    expect(labels.sheet.complete.title).toContain("{name}");
    // 메뉴 이름과 같은 말(P5-21 부터 '발송 기록' — 그 화면에 메일 행도 있다 · 컨트롤러 결정). 가는 곳은 그대로 발송 내역 화면.
    expect(labels.toastLink).toEqual({ label: "발송 기록 보기", href: "/admin/notifications" });
  });

  test("찾을 수 없는 예약이면 처리 영역을 그리지 않는다", async () => {
    vi.mocked(getReservation).mockResolvedValue(null);
    renderToStaticMarkup((await AdminReservationDetailPage({ params: Promise.resolve({ id: ID }) })) as ReactElement);
    expect(captured.props).toEqual([]);
  });
});

describe("2. 이름은 서버가 그린 한 곳에만 있다 — 시트는 그 글자를 읽는다", () => {
  test(`id="${CUSTOMER_NAME_ELEMENT_ID}" 요소가 하나이고 그 안이 고객 이름이다`, async () => {
    const { html } = await render(ROW);
    const hits = [...html.matchAll(new RegExp(`id="${CUSTOMER_NAME_ELEMENT_ID}"`, "g"))];
    expect(hits).toHaveLength(1);
    const inner = new RegExp(`id="${CUSTOMER_NAME_ELEMENT_ID}"[^>]*>([^<]*)<`).exec(html)?.[1];
    expect(inner).toBe(PII.name);
  });

  test("정적 — 이름 칸에 그 id 를 단 것은 페이지이고, 처리 영역에 row.name 을 넘기지 않는다", () => {
    const src = stripComments(readFileSync(path.join(ROOT, DETAIL_PAGE), "utf-8").replace(/\r\n/g, "\n"), "detail-page.tsx");
    expect(src).toMatch(/<dd className=\{a\.dd\} id=\{CUSTOMER_NAME_ELEMENT_ID\}>\s*\{row\.name\}\s*<\/dd>/);
    const block = /<ReservationActions[\s\S]*?\/>/.exec(src)?.[0] ?? "";
    expect(block.length).toBeGreaterThan(0);
    for (const field of ["name", "phone", "email", "message", "public_code"]) {
      expect(block, `처리 영역에 row.${field} 를 넘긴다`).not.toMatch(new RegExp(`row\\.${field}\\b`));
    }
  });
});

describe("3. 운행 요약 — 구간 · 날짜 · 인원 (시트의 요약 상자)", () => {
  const route = `${locationLabelKo("ICN")} → ${locationLabelKo("SEL")}`;

  test("간편 접수 — 날짜만(00:00 자리값을 시각으로 보이지 않는다) · 간편 표시", async () => {
    const { props } = await render(ROW);
    expect(props.summary).toEqual<ReservationSummary>({ parts: [route, "2026-10-01", "30명"], quick: true });
  });

  test("상세 접수 — 벽시계 일시 · 간편 아님 · 인원이 없으면 뺀다", async () => {
    const { props } = await render({ ...ROW, intake: "wizard", vehicle_slug: "bus45", trip_type: "round", bus_count: 1, depart_at: "2026-09-30T23:30:00.000Z", passengers: null });
    expect(props.summary).toEqual<ReservationSummary>({ parts: [route, "2026-10-01 08:30"], quick: false });
  });
});

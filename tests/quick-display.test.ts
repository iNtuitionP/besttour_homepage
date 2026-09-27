/**
 * P3-8 — 간편 접수(0023 intake='quick') 행이 **표시면마다** 날짜만·"미정" 으로 보이는가 (브리프 §E).
 *
 * 관리자 화면은 실제 관리자 세션이 있어야 열린다(인증 우회 금지). 로컬 관리자 로그인으로 브라우저 실측을 하는 대신
 * **서버 컴포넌트를 직접 호출해 렌더 결과**를 본다(tests/admin-stats.test.ts 가 쓰는 방식) — 이 파일의 mock 은 테스트 프로세스 안에서만 산다:
 *   · requireAdmin → 통과(게이트 자체는 tests/admin-gate.test.ts · scripts/check-admin-gate.mjs 가 잠근다)
 *   · getReservation·listReservations → 픽스처 행(개인정보 모양의 가짜 값) · getVehicles → 시드 라벨
 *   · next-intl/server getTranslations → 같은 카탈로그(messages/ko.json)의 createTranslator
 *   · ReservationActions(클라이언트 버튼) → 빈 자리(라우터 컨텍스트가 없다 — 처리 버튼은 tests/admin-reservations.test.ts 가 본다)
 * 공개 표면(예약확인 카드·접수 현황·통지 문안)은 각각 tests/reservation-check.test.ts · recent-feed.test.ts · notify-templates.test.ts 가 본다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock("@/lib/auth/requireAdmin", () => ({ requireAdmin: vi.fn(async () => ({ userId: "test" })) }));
vi.mock("@/components/admin/ReservationActions", () => ({ ReservationActions: () => null }));
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
import AdminReservationsPage from "@/app/admin/(protected)/reservations/page";
import { getReservation, listReservations, type ReservationDetailRow } from "@/lib/admin/reservations";
import { kstDate, tripDateText } from "@/lib/reservation-check/view";

const ROOT = path.resolve(import.meta.dirname, "..");
const ko = JSON.parse(readFileSync(path.join(ROOT, "messages", "ko.json"), "utf8")) as Record<string, unknown>;
const t = createTranslator({ locale: "ko", messages: ko as never });
const UNDECIDED = t("admin.labels.undecided" as never);
const QUICK_BADGE = t("admin.labels.quickBadge" as never);

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const BASE: ReservationDetailRow = {
  id: ID,
  public_code: "QK2345AB",
  status: "new",
  intake: "quick",
  name: "김서연",
  phone: "+821055512345",
  vehicle_slug: null,
  origin_code: "ICN",
  destination_code: "SEL",
  trip_type: null,
  depart_at: "2026-09-30T15:00:00.000Z", // KST 2026-10-01 00:00 (자리값)
  return_at: "2026-10-02T15:00:00.000Z", // KST 2026-10-03 00:00
  bus_count: null,
  passengers: 30,
  created_at: "2026-09-27T03:04:00.000Z",
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

const html = async (node: Promise<ReactElement>) => renderToStaticMarkup(await node);
/** 태그를 지운 본문 — 문장 단위로 찾는다. */
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("1. 운행일 표시 — 간편 접수는 날짜만", () => {
  test("tripDateText — quick 은 KST 날짜(시각 0), wizard 는 벽시계 일시", () => {
    expect(tripDateText("2026-09-30T15:00:00.000Z", "quick")).toBe("2026-10-01");
    expect(tripDateText("2026-09-30T23:30:00.000Z", "wizard")).toBe("2026-10-01 08:30");
    expect(tripDateText("2026-09-30T23:30:00.000Z", undefined)).toBe("2026-10-01 08:30");
    expect(kstDate("2026-09-30T14:59:59.000Z")).toBe("2026-09-30");
  });
});

describe("2. 관리자 상세 — 간편 접수 배지 · 날짜만 · 미정(전화 확인)", () => {
  test("간편 행", async () => {
    vi.mocked(getReservation).mockResolvedValue(BASE);
    const out = await html(AdminReservationDetailPage({ params: Promise.resolve({ id: ID }) }));
    const body = text(out);
    expect(out).toContain('data-testid="admin-intake"');
    expect(body).toContain(QUICK_BADGE);
    // 접수 방법 줄이 "전화로 확인해야 하는 접수" 임을 말한다(P5-20 문구 사전: "간편 접수 · 전화 확인 필요")
    expect(body).toContain(t("admin.detail.value.intakeQuick" as never));
    expect(out).toMatch(/data-testid="admin-depart">2026-10-01</);
    expect(body).toContain("2026-10-03");
    // 시각 없음 — 운행일 자리에 00:00 이 나오지 않는다(접수·동의 시각 줄은 일시가 맞다)
    expect(body).not.toContain("2026-10-01 00:00");
    expect(body).not.toContain("2026-10-03 00:00");
    // 여행 구분·차량·운행 구분·대수 → 미정(전화 확인). 네 번 이상 나온다.
    expect(body.split(UNDECIDED).length - 1).toBeGreaterThanOrEqual(4);
    // 지어낸 값이 없다
    expect(body).not.toContain("45인승 우등");
    expect(body).not.toMatch(/\d+대/);
    // 라벨도 "일시" 가 아니라 "일"
    expect(body).toContain(t("admin.detail.field.departDate" as never));
  });

  test("위저드 행은 옛 표시 그대로 — 일시·차량·대수", async () => {
    vi.mocked(getReservation).mockResolvedValue({
      ...BASE,
      intake: "wizard",
      vehicle_slug: "bus45",
      purpose_code: "family",
      trip_type: "round",
      bus_count: 2,
      depart_at: "2026-09-30T23:30:00.000Z",
      return_at: "2026-10-01T09:00:00.000Z",
    });
    const body = text(await html(AdminReservationDetailPage({ params: Promise.resolve({ id: ID }) })));
    expect(body).toContain("2026-10-01 08:30");
    expect(body).toContain("45인승 우등");
    expect(body).toContain("2대");
    expect(body).not.toContain(QUICK_BADGE);
    expect(body).not.toContain(UNDECIDED);
  });
});

describe("3. 관리자 목록 — 간편 접수 배지 · 날짜만 · 차량 미정 · 인원만", () => {
  test("간편 행 한 줄 + 위저드 행 한 줄 — null 에 깨지지 않는다", async () => {
    vi.mocked(listReservations).mockResolvedValue({
      items: [
        BASE,
        { ...BASE, id: "8c9e6679-7425-40de-944b-e07fc1f90ae8", public_code: "WZ2345AB", intake: "wizard", vehicle_slug: "bus45", trip_type: "oneway", bus_count: 1, depart_at: "2026-09-30T23:30:00.000Z", return_at: null },
      ],
      hasMore: false,
      nextCursor: null,
    });
    const out = await html(AdminReservationsPage({ searchParams: Promise.resolve({}) }));
    const rows = out.split("<tr>").slice(2); // 머리 행 다음부터
    expect(rows).toHaveLength(2);
    const [quick, wizard] = rows.map(text);
    expect(quick).toContain("QK2345AB");
    expect(quick).toContain(QUICK_BADGE);
    expect(quick).toContain("2026-10-01");
    expect(quick).not.toMatch(/2026-10-01 \d{2}:\d{2}/);
    expect(quick).toContain(UNDECIDED);
    expect(quick).toContain("30명");
    expect(quick).not.toMatch(/\d+대/);
    expect(wizard).toContain("2026-10-01 08:30");
    expect(wizard).toContain("45인승 우등");
    expect(wizard).toContain("1대 · 30명");
    expect(wizard).not.toContain(QUICK_BADGE);
  });
});

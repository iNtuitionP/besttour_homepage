/**
 * P5-21 수정 라운드(독립 리뷰 P1-1 · 컨트롤러 결정 P1-2) — 실DB 실증 (로컬 스택 + REQUIRE_DB_TESTS=1 일 때만. 원격에는 어떤 쓰기도 하지 않는다).
 *
 *   1. 확정 탭 — 운행일이 지난 확정이 20건을 넘어도(26건) 쪽 1(20건)에는 다가오는 운행이 보인다.
 *      진짜 조회 함수(listReservations · listConfirmedPast)를 서비스 롤 클라이언트로 부른다 — 정렬·경계(≥ KST 오늘 00:00)·건수는 PostgREST 가 정한다.
 *      전에는 확정 = 출발 순 한 쿼리라 지난 확정 26건이 쪽 1 을 다 차지했다(리뷰 실측: 쪽 1 = 지난 20건 · 다가오는 0건).
 *   2. 관리 홈 발송 경보 — 최근 7일 **고객 문자** 실패만 배너를 띄운다. 8일 전 실패 · 사장님 쪽 알림 실패 · 중복 억제 행은 배너의 수를 바꾸지 않는다.
 *      표 전체를 세는 집계라 남의 행이 섞일 수 있다 — 그래서 절대값이 아니라 **넣기 전과의 차이**로 단언하고, 통지 잠금 안에서 돈다.
 *
 * 넣은 행은 전부 afterAll 에서 지운다(접수 코드·last_error 에 실행 표식). 통지 행은 전부 status='failed' 라 발송기가 집지 않는다(claim 은 pending 만).
 * 주의: tests/ 아래라 세 게이트의 검사 대상이다 — 임시값 마커·금지어 리터럴을 두지 않는다. 이름·번호는 가짜다.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { withNotificationsLock } from "./helpers/db-lock";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

vi.mock("server-only", () => ({}));
// lib/admin/* 는 세션 클라이언트를 만들려고 next/headers 를 import 한다 — 여기서는 서비스 롤 클라이언트를 직접 넘기므로 부르지 않는다.
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })) }));

import { sendBanner } from "@/components/admin/dashboard";
import { PAST_CONFIRMED_SHOWN, kstTodayStart } from "@/components/admin/reservation-list";
import { getHomeSendAlerts, type HomeSendAlerts } from "@/lib/admin/notifications";
import { listConfirmedPast, listReservations } from "@/lib/admin/reservations";
import { createServiceClient } from "@/lib/supabase/server";

const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[admin-home-list.db] DB 실증 블록 skip — ${gate.reason}`);
}

const RUN = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
const DAY_MS = 86_400_000;

const restHeaders = () => ({
  apikey: env.serviceRoleKey,
  Authorization: `Bearer ${env.serviceRoleKey}`,
  "Content-Type": "application/json",
});

async function rest<T>(method: string, pathAndQuery: string, body?: unknown, prefer?: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${env.restRoot}${pathAndQuery}`, {
    method,
    headers: prefer ? { ...restHeaders(), Prefer: prefer } : restHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

describe.skipIf(!gate.allowed || !env.hasServiceRole)("DB — 확정 탭: 지난 확정 26건 + 다가오는 5건 → 쪽 1 은 다가오는 운행 (로컬 스택)", () => {
  const cutoff = kstTodayStart(new Date());
  const cutoffMs = Date.parse(cutoff);
  /** 가장 최근의 지난 확정 = 경계 1ms 앞 · 나머지는 하루씩 앞으로 */
  const pastDeparts = Array.from({ length: 26 }, (_, i) => new Date(cutoffMs - 1 - i * DAY_MS).toISOString());
  /** 다가오는 확정 — 경계 **그 순간**(오늘 00:00 · 포함) + 1초씩 */
  const upcomingDeparts = Array.from({ length: 5 }, (_, i) => new Date(cutoffMs + i * 1000).toISOString());
  const ids: { past: string[]; upcoming: string[] } = { past: [], upcoming: [] };

  function confirmedRow(code: string, n: number, departAt: string) {
    const created = new Date(Date.now() - 60_000);
    const consent = new Date(created.getTime() - 60_000).toISOString();
    return {
      public_code: code,
      status: "confirmed",
      intake: "wizard",
      name: `목록실증${n}`,
      phone: `+8210000009${String(n).padStart(2, "0")}`,
      vehicle_slug: "bus45",
      purpose_code: "family",
      trip_type: "oneway",
      bus_count: 1,
      passengers: 20,
      origin_code: "SEL",
      destination_code: "BSN",
      waypoint_codes: [],
      depart_at: departAt,
      return_at: null,
      nights: 0,
      locale: "ko",
      created_at: created.toISOString(),
      confirmed_at: created.toISOString(),
      privacy_consent_at: consent,
      privacy_policy_version: "2026-09-11",
      marketing_consent_at: null,
      retention_until: new Date(created.getTime() + 365 * DAY_MS).toISOString(),
      withdrawal_consent_at: consent,
    };
  }

  beforeAll(async () => {
    const rows = [
      ...pastDeparts.map((d, i) => confirmedRow(`L${RUN}P${String(i).padStart(2, "0")}`, i, d)),
      ...upcomingDeparts.map((d, i) => confirmedRow(`L${RUN}U${String(i).padStart(2, "0")}`, 50 + i, d)),
    ];
    const ins = await rest<{ id: string; public_code: string }[]>("POST", "/reservations?select=id,public_code", rows, "return=representation");
    expect(ins.status, JSON.stringify(ins.body).slice(0, 300)).toBe(201);
    const byCode = new Map(ins.body.map((r) => [r.public_code, r.id]));
    ids.past = pastDeparts.map((_, i) => byCode.get(`L${RUN}P${String(i).padStart(2, "0")}`)!);
    ids.upcoming = upcomingDeparts.map((_, i) => byCode.get(`L${RUN}U${String(i).padStart(2, "0")}`)!);
  });

  afterAll(async () => {
    const all = [...ids.past, ...ids.upcoming].filter(Boolean);
    if (all.length > 0) await rest("DELETE", `/reservations?id=in.(${all.join(",")})`);
    const left = await rest<unknown[]>("GET", `/reservations?select=id&public_code=like.L${RUN}*`);
    expect(left.body).toEqual([]);
  });

  test("🔴 쪽 1(20건)에는 다가오는 운행만 — 경계 순간(오늘 00:00) 출발 포함 · 출발이 가까운 순 · 지난 확정 26건은 한 건도 없다", async () => {
    const svc = createServiceClient();
    const page1 = await listReservations({ status: "confirmed", limit: 20, departFrom: cutoff }, svc as never);
    const t = page1.items.map((r) => Date.parse(r.depart_at));
    expect(t.every((x) => x >= cutoffMs), "쪽 1 에 경계 앞(지난) 출발이 있다").toBe(true);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    const pastSet = new Set(ids.past);
    expect(page1.items.filter((r) => pastSet.has(r.id))).toEqual([]);
    const mine = page1.items.filter((r) => ids.upcoming.includes(r.id)).map((r) => r.id);
    expect(mine).toEqual(ids.upcoming);
  });

  test("🔴 지난 확정은 따로 — 최근 것부터 5건(경계 1ms 앞이 맨 위) · 전체 건수는 26 이상 · 전부 경계 앞", async () => {
    const svc = createServiceClient();
    const past = await listConfirmedPast(cutoff, PAST_CONFIRMED_SHOWN, svc as never);
    expect(past.items).toHaveLength(PAST_CONFIRMED_SHOWN);
    expect(past.total).toBeGreaterThanOrEqual(26);
    const t = past.items.map((r) => Date.parse(r.depart_at));
    expect(t.every((x) => x < cutoffMs)).toBe(true);
    expect([...t].sort((a, b) => b - a)).toEqual(t);
    expect(past.items[0].id).toBe(ids.past[0]);
  });
});

describe.skipIf(!gate.allowed || !env.hasServiceRole)("DB — 관리 홈 발송 경보: 최근 7일 고객 문자 실패만 배너 (로컬 스택)", () => {
  // 발송 요약·경보는 표 전체를 센다 — 다른 파일의 통지 행 단언과 겹치지 않게 통지 잠금 안에서만 돈다(tests/helpers/db-lock.ts)
  withNotificationsLock();

  const MARK = `p521fix-${RUN}`;
  const inserted: number[] = [];
  const now = new Date();
  const fulfilled = (value: HomeSendAlerts): PromiseSettledResult<HomeSendAlerts> => ({ status: "fulfilled", value });

  async function failedRow(template: string, channel: "sms" | "email", event: "created" | "confirmed", ageMs: number, lastError = MARK) {
    const res = await rest<{ id: number }[]>(
      "POST",
      "/notifications_log",
      [
        {
          reservation_id: null,
          event,
          channel,
          to_phone: channel === "email" ? "owner@example.test" : "+821000000977",
          template,
          status: "failed",
          attempts: 5,
          last_error: lastError,
          created_at: new Date(now.getTime() - ageMs).toISOString(),
        },
      ],
      "return=representation",
    );
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(201);
    inserted.push(res.body[0].id);
  }

  afterAll(async () => {
    if (inserted.length > 0) await rest("DELETE", `/notifications_log?id=in.(${inserted.join(",")})`);
    const left = await rest<unknown[]>("GET", `/notifications_log?select=id&id=in.(${inserted.join(",") || "0"})`);
    expect(left.body).toEqual([]);
  });

  test("🔴 8일 전 고객 문자 실패 · 사장님 알림 실패 · 중복 억제 행은 배너를 바꾸지 않고, 최근 7일 고객 문자 실패는 바꾼다", async () => {
    const svc = createServiceClient();
    const base = await getHomeSendAlerts({ now }, svc as never);
    expect(base.windowDays).toBe(7);

    // ① 8일 전의 고객 문자 실패 — 창 밖
    await failedRow("confirmed.customer.sms", "sms", "confirmed", 8 * DAY_MS);
    const a1 = await getHomeSendAlerts({ now }, svc as never);
    expect(a1).toEqual(base);

    // ② 사장님 알림 실패(어제) — 사장님 줄만 하나 늘고 고객 수·배너는 그대로
    await failedRow("created.owner.email", "email", "created", DAY_MS);
    const a2 = await getHomeSendAlerts({ now }, svc as never);
    expect(a2.customerFailed).toBe(base.customerFailed);
    expect(a2.ownerFailed).toBe(base.ownerFailed + 1);
    expect(sendBanner(fulfilled(a2))).toBe(sendBanner(fulfilled(base)));
    if (base.customerFailed === 0) expect(sendBanner(fulfilled(a2))).toBeNull();

    // ③ 중복 억제 행(같은 문자가 이미 나감 — 손님은 받았다) — 실패로 세지 않는다
    await failedRow("created.customer.sms", "sms", "created", DAY_MS, "duplicate_sent");
    const a3 = await getHomeSendAlerts({ now }, svc as never);
    expect(a3.customerFailed).toBe(base.customerFailed);

    // ④ 최근 7일의 고객 문자 실패 — 배너가 뜬다(수 = 하나 더)
    await failedRow("created.customer.sms", "sms", "created", DAY_MS);
    const a4 = await getHomeSendAlerts({ now }, svc as never);
    expect(a4.customerFailed).toBe(base.customerFailed + 1);
    expect(a4.ownerFailed).toBe(base.ownerFailed + 1);
    expect(sendBanner(fulfilled(a4))).toBe(base.customerFailed + 1);
  });
});

/**
 * P5-8 — 관리자 발송 내역 화면 (읽기 전용).
 *
 * 왜 이 화면이 있는가: 문자가 실패하면 `notifications_log` 에 `failed` 로 남고 회수기(0007)가 lease 만료 행을 정리한다.
 * 그런데 **사장님이 그것을 볼 방법이 없었다.** 손님에게 확정 문자가 가지 않았는데 아무도 모르는 상태가 지금 구조상 가능하다.
 * 이 화면이 그 구멍을 막는다 — 그래서 이 테스트가 가장 신경 쓰는 것은 "실패가 화면에 드러나는가" 와 "드러내면서 개인정보를
 * 늘어놓지 않는가" 두 가지다.
 *
 * 이 태스크가 지키는 것:
 *   1. **읽기 전용.** 0009 는 notifications_log 에 `select` 만 줬다(정책 하나, `for select to authenticated using (is_admin())`).
 *      재발송 버튼은 만들지 않는다 — 정책·함수(마이그레이션)가 필요하고 무엇보다 P4-2 발송기가 아직 없다. §6 이 쓰기 경로 0 을 잠근다.
 *   2. **수신번호는 마스킹.** 원문 번호는 이 모듈 **밖으로 나가지 않는다** — 반환 타입에 원문 필드가 없다(§3).
 *   3. **서비스 롤 0 · unstable_cache 0** (ADR-2·ADR-3). 세션 클라이언트 + RLS 로만 읽는다.
 *   4. **게이트는 첫 문장.** 액션이 없으므로 게이트는 페이지의 `requireAdmin()` 하나다(§1).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import { withNotificationsLock } from "./helpers/db-lock";
import { expectTablePrivilegeDenied } from "./helpers/expect-denied";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));
vi.mock("@/lib/supabase/ssr", () => ({ createSsrClient: vi.fn() }));

import { ALL_TEMPLATE_KEYS, FAILURE_TEMPLATE_KEYS, MAX_ATTEMPTS, TEMPLATE_KEYS } from "@/lib/notify/outbox";
import {
  ADMIN_NOTIFICATIONS_PATH,
  CHANNEL_FILTERS,
  DEFAULT_NOTIFICATION_PAGE_SIZE,
  MAX_NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_LIST_COLUMNS,
  NOTIFICATION_LIST_SELECT,
  NOTIFICATION_STATUSES,
  NOTIFICATIONS_TABLE,
  PERIOD_FILTERS,
  PERIOD_HOURS,
  RESERVATION_CODE_SELECT,
  STATUS_FILTERS,
  SUMMARY_WINDOW_HOURS,
  getNotificationSummary,
  listNotifications,
  notificationRecordState,
  parseChannelFilter,
  parseNotificationStatusFilter,
  parsePeriodFilter,
  type AdminNotificationsClient,
} from "@/lib/admin/notifications";

import { stripComments } from "./helpers/strip-comments";

// =============================================================================
// 공통 헬퍼
// =============================================================================
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf-8");
const exists = (rel: string): boolean => existsSync(path.join(ROOT, rel));
const HANGUL = /[가-힣]/;

/**
 * 금지어 (CLAUDE.md §3 · soul §10.2). scripts/check-legal-disclosures.sh 는 tests/ 도 검사하므로 낱말을 글자 그대로
 * 적으면 이 파일이 게이트를 빨갛게 만든다 — 쪼개 이어 붙인다(tests/admin-reservations.test.ts 의 가격 심볼과 같은 수법).
 */
const FORBIDDEN_WORDS = new RegExp(
  ["면" + "허", "전세버스" + "하나", "나가는 " + "버스", "태우고 " + "나가", "공" + "차", "회" + "송"].join("|"),
);

/** 주석을 걷어낸 코드. 제거기는 저장소에 하나뿐이다(`tests/helpers/strip-comments.ts` · P6-7/P6-8 · D7). */
const codeOf = (rel: string) => stripComments(read(rel), rel);

const LIB = "lib/admin/notifications.ts";
const PAGE = "app/admin/(protected)/notifications/page.tsx";
const TABS_DEF = "components/admin/tabs.ts";
const ADMIN_CSS = "components/admin/admin.module.css";

interface StubResult {
  data?: unknown;
  count?: number | null;
  error?: unknown;
}
interface Call {
  table: string;
  method: string;
  args: unknown[];
}

/**
 * 표 이름별로 결과를 돌려주는 가짜 PostgREST 체인. 한 표를 여러 번 부르면 배열의 앞에서부터 하나씩 쓴다
 * (요약은 notifications_log 를 두 번 센다). 호출된 메서드와 인자는 전부 기록해 화이트리스트·필터를 단언한다.
 */
function dbStub(byTable: Record<string, StubResult | StubResult[]>): {
  client: AdminNotificationsClient;
  from: ReturnType<typeof vi.fn>;
  calls: Call[];
} {
  const calls: Call[] = [];
  const queues: Record<string, StubResult[]> = {};
  for (const [table, value] of Object.entries(byTable)) queues[table] = Array.isArray(value) ? [...value] : [value];

  const from = vi.fn((table: string) => {
    const result = queues[table]?.shift() ?? { data: [], count: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "order", "eq", "gte", "lte", "in", "or", "like", "range", "limit", "maybeSingle", "overrideTypes"]) {
      chain[m] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return chain;
      });
    }
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, count: null, error: null, ...result }).then(resolve, reject);
    return chain;
  });
  return { client: { from } as unknown as AdminNotificationsClient, from, calls };
}

const argsOf = (calls: Call[], table: string, method: string): unknown[][] =>
  calls.filter((c) => c.table === table && c.method === method).map((c) => c.args);

const CUSTOMER_PHONE = "+821020488585";
const OWNER_EMAIL = "bestour2013@naver.com";
const RESERVATION_ID = "3f2b9c14-5f0a-4a2e-9c1b-8d7e6f5a4b3c";

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: 41,
  reservation_id: RESERVATION_ID,
  event: "created",
  channel: "sms",
  template: "created.customer.sms",
  status: "failed",
  attempts: 5,
  last_error: "provider_4xx:1041",
  next_attempt_at: "2026-09-15T02:05:00.000Z",
  created_at: "2026-09-15T01:00:00.000Z",
  updated_at: "2026-09-15T02:00:00.000Z",
  to_phone: CUSTOMER_PHONE,
  ...over,
});

const NOW = new Date("2026-09-15T03:00:00.000Z");

// =============================================================================
// 1. 게이트 — 액션이 없으므로 게이트는 페이지의 requireAdmin() 하나다
// =============================================================================
describe("1. 인가 게이트", () => {
  test("페이지가 있다", () => {
    expect(exists(PAGE)).toBe(true);
    expect(exists(LIB)).toBe(true);
  });

  test("기본 export 의 **첫 문장**이 무조건적인 await requireAdmin() 이다", () => {
    const src = codeOf(PAGE);
    // 매개변수의 `{ searchParams }` 도 중괄호라 "첫 `{`" 로 찾으면 안 된다 — 매치 끝(= 본문 여는 중괄호)부터 읽는다.
    const m = /export\s+default\s+async\s+function\s+\w+\s*\([\s\S]*?\)\s*\{/.exec(src);
    expect(m, "기본 export 를 찾지 못했다").not.toBeNull();
    const body = src.slice((m as RegExpExecArray).index + (m as RegExpExecArray)[0].length);
    const first = body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    expect(first).toBe("await requireAdmin();");
  });

  test("게이트에 조건이 붙지 않았다 — if·try·삼항 어디에도 감싸이지 않는다", () => {
    for (const rel of [PAGE, LIB]) {
      for (const line of codeOf(rel).split("\n")) {
        if (!/\brequireAdmin\s*\(/.test(line)) continue;
        expect(line.trim(), `${rel}: ${line.trim()}`).toMatch(/^(?:const\s+\w+\s*=\s*)?await\s+requireAdmin\(\)\s*;$/);
      }
    }
  });

  test("정본 게이트 모듈에서만 가져온다 — 같은 이름의 다른 모듈이 아니다", () => {
    expect(codeOf(PAGE)).toMatch(/import\s*\{\s*requireAdmin\s*\}\s*from\s*"@\/lib\/auth\/requireAdmin"/);
  });

  test("개발용 우회 심볼 0 — 주석에도 남기지 않는다", () => {
    for (const rel of [PAGE, LIB]) expect(read(rel), rel).not.toMatch(/preview/i);
  });
});

// =============================================================================
// 2. select 화이트리스트
// =============================================================================
describe("2. select 화이트리스트", () => {
  test("목록 컬럼은 손으로 고른 것뿐 — `*` 도, 임베드도 없다", () => {
    expect(NOTIFICATION_LIST_SELECT).toBe(NOTIFICATION_LIST_COLUMNS.join(","));
    expect(NOTIFICATION_LIST_SELECT).not.toContain("*");
    expect(NOTIFICATION_LIST_SELECT).not.toContain("(");
    expect([...NOTIFICATION_LIST_COLUMNS]).toEqual([
      "id",
      "reservation_id",
      "event",
      "channel",
      "template",
      "status",
      "attempts",
      "last_error",
      "next_attempt_at",
      "created_at",
      "updated_at",
      "to_phone",
    ]);
  });

  test("본문·제공자 응답 컬럼은 읽지 않는다 — 화면에 그리지 않는 것은 메모리에도 올리지 않는다", () => {
    for (const forbidden of ["provider_message_id", "error"]) {
      expect(NOTIFICATION_LIST_COLUMNS as readonly string[], forbidden).not.toContain(forbidden);
    }
  });

  test("접수번호는 reservations 에서 두 컬럼만 따로 읽는다", () => {
    expect(RESERVATION_CODE_SELECT).toBe("id,public_code");
  });

  test("실제 쿼리가 그 문자열 그대로를 쓴다", async () => {
    const stub = dbStub({
      [NOTIFICATIONS_TABLE]: { data: [dbRow()], error: null },
      reservations: { data: [{ id: RESERVATION_ID, public_code: "BT12ABCD" }], error: null },
    });
    await listNotifications({}, stub.client);
    expect(argsOf(stub.calls, NOTIFICATIONS_TABLE, "select")[0]).toEqual([NOTIFICATION_LIST_SELECT]);
    expect(argsOf(stub.calls, "reservations", "select")[0]).toEqual([RESERVATION_CODE_SELECT]);
  });
});

// =============================================================================
// 3. 수신번호 마스킹 — 원문은 모듈 밖으로 나가지 않는다
// =============================================================================
describe("3. 수신처 마스킹", () => {
  test("국내 휴대전화(E.164 저장형) — 가운데 네 자리를 가린다. 원문·숫자열이 결과 어디에도 없다", async () => {
    const stub = dbStub({
      [NOTIFICATIONS_TABLE]: { data: [dbRow()], error: null },
      reservations: { data: [{ id: RESERVATION_ID, public_code: "BT12ABCD" }], error: null },
    });
    const page = await listNotifications({}, stub.client);
    expect(page.items[0].toMasked).toBe("010-****-8585");

    const serialized = JSON.stringify(page);
    expect(serialized, "원문 번호가 결과에 남았다").not.toContain(CUSTOMER_PHONE);
    expect(serialized, "하이픈 없는 숫자열이 결과에 남았다").not.toContain("1020488585");
    expect(serialized).not.toContain("to_phone");
    expect(serialized).not.toContain("2048");
  });

  test("메일 폴백 — 로컬 파트를 통째로 가리고 도메인만 남긴다", async () => {
    const stub = dbStub({
      [NOTIFICATIONS_TABLE]: { data: [dbRow({ channel: "email", template: "created.owner.email", to_phone: OWNER_EMAIL })], error: null },
      reservations: { data: [], error: null },
    });
    const page = await listNotifications({}, stub.client);
    expect(page.items[0].toMasked).toBe("***@naver.com");
    expect(JSON.stringify(page)).not.toContain("bestour2013");
  });

  test("형식을 모르는 값은 통째로 가린다 (fail-closed) — 짐작해서 일부를 내보내지 않는다", async () => {
    // "010-2047-8585"(국내 표기 원문)도 여기 들어 있다: 저장값은 언제나 E.164 이므로 국내 표기가 왔다는 것은 출처를
    // 모른다는 뜻이다. 예약확인 화면(P6-3a 리뷰 M-1)과 **같은 함수·같은 판정**이다 — lib/mask.ts maskStoredPhone.
    for (const raw of ["+15551234567", "0212345678", "010-2047-8585", "01020478585", "+82212345678", "", "  ", "not-a-number", "no-at-sign"]) {
      const stub = dbStub({
        [NOTIFICATIONS_TABLE]: { data: [dbRow({ to_phone: raw })], error: null },
        reservations: { data: [], error: null },
      });
      const page = await listNotifications({}, stub.client);
      expect(page.items[0].toMasked, raw).toBe("***");
      if (raw.trim().length >= 4) expect(JSON.stringify(page), raw).not.toContain(raw);
    }
  });

  test("마스킹 구현은 lib/mask.ts 하나뿐이다 — 두 화면이 같은 함수를 부른다 (사본 금지)", () => {
    const admin = codeOf(LIB);
    const check = codeOf("lib/reservation-check/view.ts");
    for (const [rel, src] of [
      [LIB, admin],
      ["lib/reservation-check/view.ts", check],
    ] as const) {
      expect(src, `${rel} 가 lib/mask.ts 를 쓰지 않는다`).toMatch(/maskStoredPhone/);
      // 판정을 다시 구현한 흔적(국내 휴대전화 정규식·폴백 리터럴)이 남아 있으면 사본이 다시 생긴 것이다.
      expect(src, `${rel} 에 마스킹 판정 사본이 있다`).not.toMatch(/\^01\\d\{8,9\}\$/);
      expect(src, `${rel} 에 마스킹 판정 사본이 있다`).not.toMatch(/startsWith\("\+82"\)/);
    }
    expect(admin).toMatch(/from "\.\.\/mask"/);
    expect(check).toMatch(/from "\.\.\/mask"/);
  });

  test("같은 입력에 두 화면이 같은 값을 낸다 (드리프트 회귀)", async () => {
    const { maskStoredPhone } = await import("@/lib/mask");
    const { maskRecipient } = await import("@/lib/admin/notifications");
    for (const raw of ["+821020488585", "+82 10 1234 5678", "+15551234567", "010-2047-8585", "+82212345678", ""]) {
      expect(maskRecipient("sms", raw), raw).toBe(maskStoredPhone(raw));
    }
  });

  test("반환 타입에 원문 수신처 키가 없다 (컴파일 잠금)", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: { data: [dbRow()], error: null }, reservations: { data: [], error: null } });
    const page = await listNotifications({}, stub.client);
    type Row = (typeof page.items)[number];
    type RawKey = Extract<keyof Row, "to" | "to_phone" | "toPhone" | "phone" | "name" | "email">;
    const noRaw: RawKey extends never ? true : never = true;
    expect(noRaw).toBe(true);
    expect(Object.keys(page.items[0]).sort()).toEqual(
      [
        "attempts",
        "channel",
        "createdAt",
        "event",
        "id",
        "lastError",
        "nextAttemptAt",
        "publicCode",
        // P4-7 수정 라운드 3 — 기록 상태 표식(고정 낱말 또는 null, 개인정보 아님)
        "recordState",
        "reservationId",
        "status",
        "template",
        "toMasked",
        "updatedAt",
      ].sort(),
    );
  });
});

// =============================================================================
// 4. 필터 · 페이지네이션
// =============================================================================
describe("4. 필터 · 페이지네이션", () => {
  test("필터 목록 — 상태 3종 · 채널 3종 · 기간 4종, 각각 all 을 앞에 둔다", () => {
    expect([...NOTIFICATION_STATUSES]).toEqual(["pending", "sent", "failed"]);
    expect([...NOTIFICATION_CHANNELS]).toEqual(["sms", "alimtalk", "email"]);
    expect([...STATUS_FILTERS]).toEqual(["all", "pending", "sent", "failed"]);
    expect([...CHANNEL_FILTERS]).toEqual(["all", "sms", "alimtalk", "email"]);
    expect([...PERIOD_FILTERS]).toEqual(["all", "24h", "7d", "30d"]);
    expect(PERIOD_HOURS).toEqual({ all: null, "24h": 24, "7d": 24 * 7, "30d": 24 * 30 });
  });

  test("파서는 관대하다 — 주소창 오타에 500 을 내지 않고 전체로 떨어진다", () => {
    for (const bad of ["", "nope", "SENT", " sent", undefined, 3, ["sent"]]) {
      expect(parseNotificationStatusFilter(bad)).toBe("all");
      expect(parseChannelFilter(bad)).toBe("all");
      expect(parsePeriodFilter(bad)).toBe("all");
    }
    expect(parseNotificationStatusFilter("failed")).toBe("failed");
    expect(parseChannelFilter("alimtalk")).toBe("alimtalk");
    expect(parsePeriodFilter("7d")).toBe("7d");
  });

  test("쿼리 함수는 엄격하다 — 목록 밖의 값이면 DB 를 부르지 않고 throw", async () => {
    const stub = dbStub({});
    await expect(listNotifications({ status: "nope" as never }, stub.client)).rejects.toThrow();
    await expect(listNotifications({ channel: "kakao" as never }, stub.client)).rejects.toThrow();
    await expect(listNotifications({ period: "1y" as never }, stub.client)).rejects.toThrow();
    await expect(listNotifications({ cursor: -1 }, stub.client)).rejects.toThrow();
    await expect(listNotifications({ cursor: 1.5 }, stub.client)).rejects.toThrow();
    await expect(listNotifications({ limit: 0 }, stub.client)).rejects.toThrow();
    await expect(listNotifications({ limit: MAX_NOTIFICATION_PAGE_SIZE + 1 }, stub.client)).rejects.toThrow();
    expect(stub.from).not.toHaveBeenCalled();
  });

  test("필터가 걸리면 그만큼만 조건이 붙는다 — 전체면 조건 0", async () => {
    const none = dbStub({ [NOTIFICATIONS_TABLE]: { data: [], error: null } });
    await listNotifications({ now: NOW }, none.client);
    expect(argsOf(none.calls, NOTIFICATIONS_TABLE, "eq")).toEqual([]);
    expect(argsOf(none.calls, NOTIFICATIONS_TABLE, "gte")).toEqual([]);

    const all = dbStub({ [NOTIFICATIONS_TABLE]: { data: [], error: null } });
    await listNotifications({ status: "failed", channel: "sms", period: "24h", now: NOW }, all.client);
    expect(argsOf(all.calls, NOTIFICATIONS_TABLE, "eq")).toEqual([
      ["status", "failed"],
      ["channel", "sms"],
    ]);
    expect(argsOf(all.calls, NOTIFICATIONS_TABLE, "gte")).toEqual([["created_at", "2026-09-14T03:00:00.000Z"]]);
  });

  test("최신순 — created_at desc, 동률은 id desc", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: { data: [], error: null } });
    await listNotifications({}, stub.client);
    expect(argsOf(stub.calls, NOTIFICATIONS_TABLE, "order")).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  test("limit + 1 로 읽어 hasMore 를 판정한다 (count 쿼리 없음)", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => dbRow({ id: 100 + i }));
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: { data: rows, error: null }, reservations: { data: [], error: null } });
    const page = await listNotifications({ limit: 3 }, stub.client);
    expect(argsOf(stub.calls, NOTIFICATIONS_TABLE, "range")).toEqual([[0, 3]]);
    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(3);
  });

  test("경계 — 정확히 limit 건이면 다음 페이지가 없다", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => dbRow({ id: 200 + i }));
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: { data: rows, error: null }, reservations: { data: [], error: null } });
    const page = await listNotifications({ limit: 3 }, stub.client);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  test("cursor 가 있으면 그 자리부터 — range 는 양끝 포함이다", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: { data: [], error: null } });
    await listNotifications({ cursor: 40, limit: DEFAULT_NOTIFICATION_PAGE_SIZE }, stub.client);
    expect(argsOf(stub.calls, NOTIFICATIONS_TABLE, "range")).toEqual([[40, 40 + DEFAULT_NOTIFICATION_PAGE_SIZE]]);
  });

  test("범위를 넘긴 cursor(PGRST103)는 오류가 아니라 빈 페이지다", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } } });
    const page = await listNotifications({ cursor: 9999 }, stub.client);
    expect(page).toEqual({ items: [], hasMore: false, nextCursor: null });
  });

  test("그 밖의 DB 오류는 삼키지 않는다 — 빈 목록으로 위장하면 '실패 0건' 이 거짓말이 된다", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: { data: null, error: { code: "42501", message: "permission denied" } } });
    await expect(listNotifications({}, stub.client)).rejects.toThrow(/42501/);
  });

  test("접수번호를 못 찾아도 행을 감추지 않는다 — 예약이 파기된 통지도 목록에 남는다", async () => {
    const stub = dbStub({
      [NOTIFICATIONS_TABLE]: { data: [dbRow(), dbRow({ id: 42, reservation_id: null })], error: null },
      reservations: { data: [], error: null },
    });
    const page = await listNotifications({}, stub.client);
    expect(page.items.map((r) => r.publicCode)).toEqual([null, null]);
    expect(page.items).toHaveLength(2);
  });

  test("reservation_id 가 전부 null 이면 reservations 를 아예 조회하지 않는다", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: { data: [dbRow({ reservation_id: null })], error: null } });
    await listNotifications({}, stub.client);
    expect(stub.calls.some((c) => c.table === "reservations")).toBe(false);
  });

  test("접수번호 조회는 중복 없는 id 목록으로 한 번만 한다", async () => {
    const stub = dbStub({
      [NOTIFICATIONS_TABLE]: { data: [dbRow(), dbRow({ id: 42, template: "created.owner.sms" })], error: null },
      reservations: { data: [{ id: RESERVATION_ID, public_code: "BT12ABCD" }], error: null },
    });
    const page = await listNotifications({}, stub.client);
    expect(argsOf(stub.calls, "reservations", "in")).toEqual([["id", [RESERVATION_ID]]]);
    expect(page.items.map((r) => r.publicCode)).toEqual(["BT12ABCD", "BT12ABCD"]);
  });
});

// =============================================================================
// 5. 요약 집계
// =============================================================================
describe("5. 요약 집계", () => {
  const ZERO3 = [{ count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null }];

  test("실패 · 더 시도되지 않는 pending · 발송됨(기록 확인 필요) 세 가지다", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: [{ count: 2, error: null }, { count: 1, error: null }, { count: 0, error: null }] });
    const summary = await getNotificationSummary({ now: NOW }, stub.client);
    expect(summary).toEqual({ failed: 2, stuck: 1, sentUnconfirmed: 0, windowHours: SUMMARY_WINDOW_HOURS, ok: false });
  });

  test("셋 다 0 이면 ok — 화면은 '이상 없음' 을 그린다", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: ZERO3 });
    expect((await getNotificationSummary({ now: NOW }, stub.client)).ok).toBe(true);
  });

  // P4-7 수정 라운드 3 · 리뷰 P1-B·P2-8
  test("격리 행(보냈지만 기록 못 함)은 '발송됨 · 기록 확인 필요' 로 **따로** 센다 — 이상 없음으로 숨기지 않는다", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: [{ count: 0, error: null }, { count: 0, error: null }, { count: 3, error: null }] });
    const summary = await getNotificationSummary({ now: NOW }, stub.client);
    expect(summary).toMatchObject({ failed: 0, stuck: 0, sentUnconfirmed: 3, ok: false });
  });

  test("집계 조건 — failed 는 전체 기간(중복 억제 duplicate_sent 제외) · stuck 은 pending + attempts >= MAX + 최근 24시간(격리 행 제외) · 격리 행은 따로", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: ZERO3 });
    await getNotificationSummary({ now: NOW }, stub.client);
    expect(SUMMARY_WINDOW_HOURS).toBe(24);
    expect(argsOf(stub.calls, NOTIFICATIONS_TABLE, "eq")).toEqual([["status", "failed"], ["status", "pending"], ["status", "pending"]]);
    expect(argsOf(stub.calls, NOTIFICATIONS_TABLE, "gte")).toEqual([
      ["attempts", MAX_ATTEMPTS],
      ["created_at", "2026-09-14T03:00:00.000Z"],
    ]);
    expect(argsOf(stub.calls, NOTIFICATIONS_TABLE, "or")).toEqual([
      ["last_error.is.null,last_error.neq.duplicate_sent"],
      ["last_error.is.null,last_error.not.like.sent_unmarked:*"],
    ]);
    expect(argsOf(stub.calls, NOTIFICATIONS_TABLE, "like")).toEqual([["last_error", "sent_unmarked:%"]]);
  });

  test("행 표식 — 격리 행은 sentUnconfirmed, 중복 억제 행은 duplicateSuppressed, 나머지는 null (화면 배지가 '실패'·'대기' 로 오해하지 않게)", () => {
    expect(notificationRecordState("pending", "sent_unmarked:pm-1")).toBe("sentUnconfirmed");
    expect(notificationRecordState("failed", "duplicate_sent")).toBe("duplicateSuppressed");
    expect(notificationRecordState("pending", "provider_500")).toBeNull();
    expect(notificationRecordState("failed", "provider_403")).toBeNull();
    expect(notificationRecordState("sent", null)).toBeNull();
    // 표식은 상태와 짝일 때만 — 모양만 같은 다른 상태의 문구는 표식이 아니다
    expect(notificationRecordState("failed", "sent_unmarked:pm-1")).toBeNull();
  });

  test("행을 읽지 않고 센다 — head 집계라 개인정보가 응답에 실리지 않는다", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: ZERO3 });
    await getNotificationSummary({ now: NOW }, stub.client);
    for (const args of argsOf(stub.calls, NOTIFICATIONS_TABLE, "select")) {
      expect(args[1]).toEqual({ count: "exact", head: true });
      expect(args[0]).toBe("id");
    }
  });

  test("count 가 null 이면 0 이 아니라 throw — 모르는 것을 '이상 없음' 으로 보고하지 않는다", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: [{ count: null, error: null }, { count: 0, error: null }] });
    await expect(getNotificationSummary({ now: NOW }, stub.client)).rejects.toThrow();
  });

  test("집계 오류도 삼키지 않는다", async () => {
    const stub = dbStub({ [NOTIFICATIONS_TABLE]: [{ count: null, error: { code: "42501", message: "permission denied" } }] });
    await expect(getNotificationSummary({ now: NOW }, stub.client)).rejects.toThrow(/42501/);
  });
});

// =============================================================================
// 6. 읽기 전용 — 쓰기 경로 0 · 재발송 버튼 0
// =============================================================================
describe("6. 읽기 전용", () => {
  test("insert · update · delete · upsert · rpc 가 한 군데도 없다", () => {
    for (const rel of [LIB, PAGE]) {
      const src = codeOf(rel);
      expect(src, rel).not.toMatch(/\.(insert|update|delete|upsert|rpc)\s*\(/);
    }
  });

  test("서버액션도, 폼도, 버튼도 없다 — 재발송은 P4-2 이후 별도 태스크다", () => {
    const src = codeOf(PAGE);
    expect(src).not.toMatch(/"use server"|'use server'/);
    expect(src).not.toMatch(/<form|<button|formAction/);
    expect(exists("actions/admin/notification.ts"), "액션 파일을 만들지 않았다").toBe(false);
    expect(exists("actions/admin/notifications.ts"), "액션 파일을 만들지 않았다").toBe(false);
  });

  test("마이그레이션을 새로 만들지 않았다 — 0009 의 select 정책으로 충분하다", () => {
    const dir = path.join(ROOT, "supabase", "migrations");
    const files = readFileSync(path.join(ROOT, "supabase", "migrations", "0009_admin_rls.sql"), "utf-8");
    expect(files).toMatch(/notifications_log_admin_select[\s\S]*for select/);
    expect(files).not.toMatch(/notifications_log_admin_(insert|update|delete|all)/);
    expect(existsSync(path.join(dir, "0011_notifications_admin.sql"))).toBe(false);
  });
});

// =============================================================================
// 7. 정적 규약 — 서비스 롤 · 캐시 · 한글 리터럴
// =============================================================================
describe("7. 정적 규약", () => {
  test("서비스 롤 심볼 0 (ADR-2)", () => {
    for (const rel of [LIB, PAGE]) {
      expect(read(rel), rel).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE_KEY|supabase\/server/);
    }
  });

  test("읽기는 세션 클라이언트 하나로만 — createSsrClient · server-only", () => {
    const src = codeOf(LIB);
    expect(src).toMatch(/createSsrClient/);
    expect(src).toMatch(/^import "server-only";$/m);
  });

  test("unstable_cache 0 (ADR-3) — 개인정보가 실린 응답을 태그 캐시에 올리지 않는다", () => {
    for (const rel of [LIB, PAGE]) expect(codeOf(rel), rel).not.toMatch(/unstable_cache/);
  });

  test("페이지에 한글 리터럴 0 — 문구는 messages/ko.json admin.notifications.* 에서만 온다", () => {
    const offenders = codeOf(PAGE)
      .split("\n")
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => HANGUL.test(l));
    expect(offenders).toEqual([]);
  });

  test("가격·금액 0 (CLAUDE.md §3)", () => {
    const forbidden = new RegExp(["est" + "_price", "price" + "_state", "route" + "_prices", "estim" + "ate\\(", "PRICE" + "_DISPLAY_MODE"].join("|"));
    for (const rel of [LIB, PAGE, ADMIN_CSS]) expect(read(rel), rel).not.toMatch(forbidden);
  });

  test("BM 금지어·타사 상호 0", () => {
    for (const rel of [LIB, PAGE]) {
      expect(codeOf(rel), rel).not.toMatch(FORBIDDEN_WORDS);
    }
  });

  /**
   * **라벨 1:1 게이트** (P6-9 에서 확장).
   *
   * 무엇을 잠그는가: 화면이 `t(\`template.${row.template}\`)` 로 라벨을 찾는 키 집합과 카탈로그가 **정확히 같다.**
   *   · 라벨 없는 키가 있으면 → 번역 조회가 없는 키를 찾는다(그래서 P5-8 이 애초에 이 게이트를 세웠다).
   *   · 카탈로그에만 있는 라벨이 있으면 → 아무도 안 쓰는 한글이 남아 조용히 낡는다.
   *
   * **왜 `TEMPLATE_KEYS`(4) 가 아니라 `ALL_TEMPLATE_KEYS`(6) 인가.** P4-4 가 실패 알림 키를 따로 둔 판단은 옳았다 —
   * 그때 이 게이트를 깨지 않으려던 것이 이유였다. 대가로 화면의 `isTemplateKey` 가 좁은 목록을 보는 바람에
   * 실패 알림 행이 키 원문(`created.owner.failure.email`)으로 나왔다. 고칠 곳은 게이트가 아니라 **판정 집합**이다:
   * 화면이 라벨을 찾는 집합이 곧 카탈로그가 덮어야 할 집합이므로, 둘 다 `ALL_TEMPLATE_KEYS` 로 맞춘다.
   *
   * **두 집합을 따로 잠그지 않는 이유**: 따로 잠그면 "어느 목록에 있든 라벨이 있어야 한다"가 아니라
   * "이 목록에는 이 라벨"이 되어, 키가 한쪽 목록에서 다른 쪽으로 옮겨갈 때 **라벨이 멀쩡한데도** 깨진다.
   * 지켜야 할 것은 소속이 아니라 **덮임(coverage)** 이다. 다만 두 집합이 실제로 섞여 들어갔는지는
   * 아래에서 각각 확인한다 — 합집합이 빈 목록으로 접히는 사고(양쪽이 동시에 비는)를 막는다.
   */
  test("템플릿 키 라벨은 outbox.ts 의 키 집합(ALL_TEMPLATE_KEYS)과 1:1 이다", () => {
    const ko = JSON.parse(read("messages/ko.json")) as { admin: { notifications: { template: Record<string, unknown> } } };
    const flatten = (o: Record<string, unknown>, prefix = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "object" && v !== null ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    const labels = flatten(ko.admin.notifications.template);
    expect(labels.sort()).toEqual([...ALL_TEMPLATE_KEYS].sort());
    // 합집합이 한쪽만으로 접히지 않았다 — 예약 통지 4종·실패 알림 2종이 **둘 다** 덮여 있다.
    for (const key of TEMPLATE_KEYS) expect(labels, key).toContain(key);
    for (const key of FAILURE_TEMPLATE_KEYS) expect(labels, key).toContain(key);
    expect(labels).toHaveLength(TEMPLATE_KEYS.length + FAILURE_TEMPLATE_KEYS.length);
  });

  /**
   * 게이트와 화면이 **같은 집합**을 봐야 1:1 이 의미가 있다. 카탈로그를 여섯으로 늘려도 화면이 넷만 보면
   * 실패 알림은 그대로 키 원문으로 나온다(고치기 전의 상태가 정확히 그것이었다).
   */
  test("화면의 라벨 판정이 ALL_TEMPLATE_KEYS 다 — 좁은 목록으로 되돌아가지 않았다", () => {
    const src = codeOf(PAGE);
    expect(src).toMatch(/ALL_TEMPLATE_KEYS as readonly string\[\]/);
    // `\b` 는 밑줄을 단어 문자로 보므로 `ALL_TEMPLATE_KEYS` 안의 `TEMPLATE_KEYS` 에는 걸리지 않는다 — 좁은 목록만 잡힌다.
    expect(src, "좁은 목록(TEMPLATE_KEYS)을 다시 쓰고 있다").not.toMatch(/\bTEMPLATE_KEYS\b/);
  });

  /**
   * 카탈로그에 키가 있다는 것과 **번역기가 그 경로를 찾아 준다**는 것은 다르다. 화면은 중첩 카탈로그를
   * `t(\`template.${row.template}\`)` 라는 **점 경로 한 줄**로 판다 — `created.owner` 처럼 문자열 자식(`sms`·`email`)과
   * 객체 자식(`failure`)이 **섞인 마디**를 그 조회가 통과하는지는 실제 번역기로 확인해야 안다.
   * 여기서 깨지면 화면에는 다시 키 원문이 뜬다(이 태스크가 고친 증상 그대로다).
   */
  test("실제 번역기가 여섯 키를 전부 사람이 읽는 라벨로 풀어 준다 (문자열·객체가 섞인 마디 포함)", async () => {
    const { createTranslator } = await import("next-intl");
    const { loadMessages } = await import("@/i18n/messages");
    // createTranslator 의 타입은 카탈로그 리터럴에서 키를 유도한다(IntlMessages 선언이 없는 이 저장소에서는 never 로 좁혀진다).
    // 여기서 확인하려는 것은 타입이 아니라 **런타임 조회**이므로 호출 모양만 명시하고 넘어간다.
    const createT = createTranslator as unknown as (opts: {
      locale: string;
      messages: Record<string, unknown>;
      namespace: string;
    }) => (key: string) => string;
    const t = createT({ locale: "ko", messages: loadMessages("ko"), namespace: "admin.notifications" });
    for (const key of ALL_TEMPLATE_KEYS) {
      const label = t(`template.${key}`);
      expect(typeof label, key).toBe("string");
      expect(label, `${key} 가 라벨로 풀리지 않았다`).not.toContain(key);
      expect(HANGUL.test(label), `${key} → ${label}`).toBe(true);
    }
  });

  test("라벨이 사람이 읽는 문장이다 — 키 원문을 그대로 라벨로 넣지 않았다", () => {
    const ko = JSON.parse(read("messages/ko.json")) as { admin: { notifications: { template: Record<string, unknown> } } };
    const values = (o: Record<string, unknown>): string[] =>
      Object.values(o).flatMap((v) => (typeof v === "object" && v !== null ? values(v as Record<string, unknown>) : [String(v)]));
    for (const label of values(ko.admin.notifications.template)) {
      expect(HANGUL.test(label), label).toBe(true);
      expect(label, label).not.toMatch(/\.(sms|email)\b/);
    }
  });
});

// =============================================================================
// 8. 탭 · 문구 카탈로그
// =============================================================================
describe("8. 탭 · 문구", () => {
  test("탭 — 발송 내역이 여섯 번째로 붙고 여섯 탭 전부 ready 다", async () => {
    const { ADMIN_TABS, ADMIN_TAB_KEYS } = await import("@/components/admin/tabs");
    expect([...ADMIN_TAB_KEYS]).toEqual(["reservations", "popups", "notices", "gallery", "routes", "notifications", "stats"]);
    expect(ADMIN_TABS.filter((t) => t.ready).map((t) => t.href)).toEqual([
      "/admin/reservations",
      "/admin/popups",
      "/admin/notices",
      "/admin/gallery",
      "/admin/routes",
      ADMIN_NOTIFICATIONS_PATH,
      "/admin/stats",
    ]);
    expect(ADMIN_TABS.find((t) => t.key === "notifications")?.href).toBe(ADMIN_NOTIFICATIONS_PATH);
    expect(read(TABS_DEF)).toContain(ADMIN_NOTIFICATIONS_PATH);
  });

  test("경로 상수가 실제 라우트와 같다", () => {
    expect(ADMIN_NOTIFICATIONS_PATH).toBe("/admin/notifications");
    expect(exists(`app/admin/(protected)${ADMIN_NOTIFICATIONS_PATH.replace("/admin", "")}/page.tsx`)).toBe(true);
  });

  test("messages/ko.json — admin.notifications 가 생겼고 admin.tabs 에 라벨이 있다", () => {
    const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, Record<string, unknown>> };
    expect(ko.admin.tabs.notifications).toBeTruthy();
    const n = ko.admin.notifications;
    for (const k of ["title", "sub", "listLabel", "empty", "prev", "next", "pageLabel", "maskNote"]) {
      expect(n[k], k).toBeTruthy();
    }
    const col = n.col as Record<string, unknown>;
    for (const k of ["status", "channel", "template", "to", "code", "attempts", "nextAttemptAt", "lastError", "createdAt", "updatedAt"]) {
      expect(col[k], `col.${k}`).toBeTruthy();
    }
    const summary = n.summary as Record<string, unknown>;
    for (const k of ["title", "failed", "stuck", "ok", "note"]) expect(summary[k], `summary.${k}`).toBeTruthy();
    for (const s of NOTIFICATION_STATUSES) expect((n.status as Record<string, unknown>)[s], s).toBeTruthy();
    for (const c of NOTIFICATION_CHANNELS) expect((n.channel as Record<string, unknown>)[c], c).toBeTruthy();
    for (const f of PERIOD_FILTERS) expect((n.filterPeriod as Record<string, unknown>)[f], f).toBeTruthy();
  });

  test("en 카탈로그는 관리자 문구를 갖지 않는다 (관리자 영역은 로케일 밖)", () => {
    const en = JSON.parse(read("messages/en.json")) as Record<string, unknown>;
    const admin = en.admin as Record<string, unknown> | undefined;
    if (admin) expect(admin.notifications).toBeUndefined();
  });
});

// =============================================================================
// 9. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 에서만 (원격에는 어떤 쓰기도 하지 않는다)
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();
if (!gate.allowed) {
  console.warn(`[admin-notifications.test] DB 실증 블록 skip — ${gate.reason}`);
}

test("DB 쓰기 가드 — 원격 URL 이면 REQUIRE_DB_TESTS=1 을 강제해도 닫힌다", () => {
  const forced = dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, REQUIRE_DB_TESTS: "1" });
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|kong)(:|\/|$)/i.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
    expect(forced.allowed).toBe(false);
    expect(gate.allowed).toBe(false);
  } else {
    expect(forced.allowed).toBe(true);
  }
});

describe.skipIf(!gate.allowed || !env.hasServiceRole)(
  "9. DB — notifications_log RLS 실증 (로컬 스택 + REQUIRE_DB_TESTS=1)",
  { timeout: 60_000 },
  () => {
    // 이 블록은 pending 통지 1건을 만들어 몇 개 테스트 동안 들고 있는다. 그 행은 0005 claim 의 사정권 안이라
    // outbox.test.ts 의 claim 단언과 겹치면 서로를 깨뜨린다 — 같은 잠금으로 줄 세운다 (tests/helpers/db-lock.ts).
    withNotificationsLock();

    const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
    const serviceHeaders = {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      "Content-Type": "application/json",
    };
    const RUN = Math.random().toString(36).slice(2, 10);
    const PASSWORD = `p58-${RUN}-${Math.random().toString(36).slice(2)}`;
    const emailFor = (who: string) => `p58-${RUN}-${who}@example.test`;

    interface Res {
      status: number;
      body: unknown;
    }
    async function call(method: string, url: string, hdrs: Record<string, string>, json?: unknown, prefer?: string): Promise<Res> {
      const res = await fetch(url, {
        method,
        headers: prefer ? { ...hdrs, Prefer: prefer } : hdrs,
        body: json === undefined ? undefined : JSON.stringify(json),
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // JSON 이 아니면 문자열 그대로
      }
      return { status: res.status, body };
    }

    const rest = (method: string, pathAndQuery: string, json?: unknown, prefer?: string) =>
      call(method, `${env.restRoot}${pathAndQuery}`, serviceHeaders, json, prefer);

    const asUser = (token: string, method: string, pathAndQuery: string, json?: unknown, prefer?: string) =>
      call(
        method,
        `${env.restRoot}${pathAndQuery}`,
        { apikey: env.anonKey as string, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        json,
        prefer,
      );

    async function createUser(email: string): Promise<string> {
      const r = await call("POST", `${baseUrl()}/auth/v1/admin/users`, serviceHeaders, { email, password: PASSWORD, email_confirm: true });
      expect(r.status, `사용자 생성 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300);
      return (r.body as { id: string }).id;
    }

    async function signIn(email: string): Promise<string> {
      const r = await call(
        "POST",
        `${baseUrl()}/auth/v1/token?grant_type=password`,
        { apikey: env.anonKey as string, "Content-Type": "application/json" },
        { email, password: PASSWORD },
      );
      expect(r.status, `로그인 실패: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
      return (r.body as { access_token: string }).access_token;
    }

    let adminId = "";
    let plainId = "";
    let adminToken = "";
    let plainToken = "";
    let logId = 0;

    test("준비 — 관리자 1명 · 일반 로그인 1명 · pending 통지 1건", async () => {
      adminId = await createUser(emailFor("admin"));
      plainId = await createUser(emailFor("plain"));
      adminToken = await signIn(emailFor("admin"));
      plainToken = await signIn(emailFor("plain"));
      const add = await rest("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "P5-8 test" });
      expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);

      const ins = await rest(
        "POST",
        "/notifications_log",
        { reservation_id: null, event: "created", channel: "sms", to_phone: `+8210${RUN.replace(/\D/g, "0").padEnd(8, "0").slice(0, 8)}`, template: "created.customer.sms", status: "pending" },
        "return=representation",
      );
      expect(ins.status, JSON.stringify(ins.body).slice(0, 300)).toBe(201);
      logId = (ins.body as { id: number }[])[0].id;
    });

    test("관리자 세션 — select 가 통한다 (0009 notifications_log_admin_select)", async () => {
      const r = await asUser(adminToken, "GET", `/notifications_log?select=${NOTIFICATION_LIST_SELECT}&id=eq.${logId}`);
      expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
      expect((r.body as unknown[]).length, "관리자가 자기 아웃박스를 못 본다").toBe(1);
    });

    test("명단에 없는 로그인 세션 — 0행", async () => {
      const r = await asUser(plainToken, "GET", `/notifications_log?select=id&id=eq.${logId}`);
      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);
    });

    test("관리자도 쓸 수는 없다 — insert·update·delete 전부 거부(정책은 select 뿐)", async () => {
      // P6-13 실측: 둘 다 403 · 42501 · "permission denied for table notifications_log" — 0012 가 GRANT 층에서 닫았다.
      // (0012 이전에는 PATCH 가 204 = 0행 "성공" 이었다 — 거부가 아니라 성공이었다.)
      const up = await asUser(adminToken, "PATCH", `/notifications_log?id=eq.${logId}`, { status: "sent" });
      expectTablePrivilegeDenied(up, "notifications_log", "관리자가 status 를 고칠 수 있으면 '보내지 않은 것을 보냈다' 고 적을 수 있다 — PATCH");
      const del = await asUser(adminToken, "DELETE", `/notifications_log?id=eq.${logId}`);
      expectTablePrivilegeDenied(del, "notifications_log", "관리자 세션의 notifications_log DELETE");
      const still = await rest("GET", `/notifications_log?select=status&id=eq.${logId}`);
      expect((still.body as { status: string }[])[0].status).toBe("pending");
    });

    test("정리 — 만든 것을 전부 지운다", async () => {
      await rest("DELETE", `/notifications_log?id=eq.${logId}`);
      await rest("DELETE", `/admin_users?user_id=eq.${adminId}`);
      for (const id of [adminId, plainId]) {
        if (id) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${id}`, serviceHeaders);
      }
      const left = await rest("GET", `/notifications_log?select=id&id=eq.${logId}`);
      expect(left.body).toEqual([]);
    });
  },
);

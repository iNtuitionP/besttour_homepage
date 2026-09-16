/**
 * P3-5 — 홈 "접수 현황" 마스킹 피드 계약 테스트. 이 태스크의 전부는 **누출 0 증명**이다.
 *
 * vitest 는 node 환경이다 — DOM 렌더 패키지·fast-check 를 설치하지 않는다(브리프: 새 패키지 금지). 그래서
 *   (1) property test 는 시드 고정 PRNG(mulberry32)로 100 케이스를 손으로 생성한다(실패 시 같은 입력으로 재현된다),
 *   (2) DB 는 호출 기록을 남기는 가짜 클라이언트로 대체한다(원격 reservations 에는 어떤 요청도 보내지 않는다),
 *   (3) 컴포넌트·페이지 배선은 소스 정적 검사로 잠그고, 실제 렌더는 browse 로 실측해 보고서에 남긴다.
 *
 * 주의: tests/ 아래라 세 게이트(check-no-pricing · check-legal-disclosures · check-temp-values)의 검사 대상이다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, expectTypeOf, test, vi } from "vitest";

import { PREVIEW_RAW_MARKERS, PREVIEW_RECENT_ROWS } from "@/components/home/recent-feed-preview";
import { maskName } from "@/lib/mask";
import {
  kstMonthDay,
  mapRecentRows,
  RECENT_PUBLIC_STATUSES,
  RECENT_SELECT_COLUMNS,
  recentStatusKey,
  type RecentFeedItem,
  type RecentReservationRow,
  type RecentSelectColumn,
} from "@/lib/recent-feed";

// server-only 는 vitest(node) 에서 import 즉시 throw 한다 — 빈 모듈로 바꿔치기(guard.test.ts·purge.test.ts 선례).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", () => ({ structuredLog: vi.fn() }));

import { structuredLog } from "@/lib/log";
import {
  DEFAULT_RECENT_LIMIT,
  getRecentReservationsMasked,
  RECENT_SELECT,
  RECENT_WINDOW_DAYS,
  recentWindowStart,
  type ServiceClient,
} from "@/lib/queries/recent";

import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const toPosix = (p: string) => p.split(path.sep).join("/");
const logMock = vi.mocked(structuredLog);

const RECENT_QUERY = "lib/queries/recent.ts";
const RECENT_PURE = "lib/recent-feed.ts";
const COMPONENT = "components/home/RecentFeed.tsx";
const COMPONENT_CSS = "components/home/RecentFeed.module.css";
const PREVIEW = "components/home/recent-feed-preview.ts";
const PAGE = "app/[locale]/(site)/page.tsx";
const QUERIES_TEST = "tests/queries.test.ts";

/** 주석을 걷어낸 코드. 제거기는 저장소에 하나뿐이다(`tests/helpers/strip-comments.ts` · P6-7/P6-8 · D7). */
const codeOf = (rel: string) => stripComments(read(rel), rel);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// =============================================================================
// 가짜 Supabase 클라이언트 — 체인 호출을 기록하고, 테이블별로 준비된 응답을 돌려준다
// =============================================================================
interface RecordedQuery {
  table: string;
  select: string | null;
  calls: { op: string; args: unknown[] }[];
}
type TableResponse = { data?: unknown; error?: { code?: string; message: string } | null } | (() => Promise<never>);

function fakeClient(responses: Record<string, TableResponse>, recorded: RecordedQuery[] = []) {
  const client = {
    from(table: string) {
      const rec: RecordedQuery = { table, select: null, calls: [] };
      recorded.push(rec);
      const resp = responses[table];
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "eq", "neq", "in", "is", "not", "gte", "lte", "order", "limit", "range", "overrideTypes"]) {
        builder[op] = (...args: unknown[]) => {
          if (op === "select") rec.select = String(args[0]);
          else rec.calls.push({ op, args });
          return builder;
        };
      }
      builder.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => {
            if (typeof resp === "function") return resp();
            if (!resp) throw new Error(`fakeClient: ${table} 응답이 준비되지 않았다`);
            return { data: resp.data ?? [], error: resp.error ?? null };
          })
          .then(onFulfilled, onRejected);
      return builder;
    },
  };
  return { client: client as unknown as ServiceClient, recorded };
}

const VEHICLE_ROWS = [
  { slug: "bus45", name_ko: "45인승 관광버스" },
  { slug: "bus35", name_ko: "35인승 관광버스" },
  { slug: "limo28", name_ko: "28인승 우등리무진" },
  { slug: "bus25", name_ko: "25인승 관광버스" },
  { slug: "bus16", name_ko: "16인승 관광버스" },
];
const LABELS = new Map(VEHICLE_ROWS.map((v): [string, string] => [v.slug, v.name_ko]));

// =============================================================================
// 시드 고정 PRNG + 케이스 생성기 (fast-check 대체)
// =============================================================================
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 출력에 정당하게 등장할 수 있는 글자(차종 라벨·상태값·JSON 키)와 겹치지 않는 음절 풀.
 * 겹치면 "이름 뒷부분이 출력에 없다" 검사가 라벨 글자와 우연히 충돌해 오탐이 난다 — 충돌 자체를 생성 단계에서 제거한다.
 */
const OUTPUT_CHARS = new Set(
  [...VEHICLE_ROWS.map((v) => v.name_ko), ...RECENT_PUBLIC_STATUSES, "maskedName", "vehicleLabel", "departDateKst", "status"].join(""),
);
const HANGUL_CANDIDATES =
  "가나다라마바사아자차카타파하개내대래매배새애재채캐태패해거너더러머버서어저처커터퍼허게네데레메베세에제체케테페헤고노도로모보소오조초코토포호구누두루무부수우주추쿠투푸후그느드르므브스으즈츠크트프흐기니디리미비시이지치키티피히김박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예";
const HANGUL_POOL = [...new Set(HANGUL_CANDIDATES)].filter((ch) => !OUTPUT_CHARS.has(ch));
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

interface Case {
  index: number;
  row: RecentReservationRow & { id: string; public_code: string; phone: string; email: string; message: string };
}

function makeCases(count: number, seed: number): Case[] {
  const rnd = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const digits = (n: number) => Array.from({ length: n }, () => String(int(0, 9))).join("");
  const hangul = (n: number) => Array.from({ length: n }, () => pick(HANGUL_POOL)).join("");
  const upper = (n: number) => Array.from({ length: n }, () => pick([...UPPER])).join("");

  return Array.from({ length: count }, (_, index) => {
    // 이름: 1~30자 · 한글 / 영문(대문자) / 공백 섞임 — 세 형태를 돌려가며 만든다
    const kind = index % 4;
    const len = kind === 0 ? int(1, 3) : int(2, 30);
    let name: string;
    if (kind === 0 || kind === 1) name = hangul(len);
    else if (kind === 2) name = upper(len);
    else {
      const left = int(1, Math.max(1, Math.floor(len / 2)));
      name = `${hangul(left)} ${upper(Math.max(1, len - left - 1))}`.slice(0, 30);
    }
    const phone = index % 3 === 0 ? `+82 10 ${digits(4)} ${digits(4)}` : `010-${digits(4)}-${digits(4)}`;
    const email = `U${index}X${upper(6)}@example.com`;
    const message = hangul(int(10, 40));
    const status = pick(["new", "new", "confirmed", "cancelled", "done"] as const);
    const depart = new Date(Date.UTC(2026, int(0, 23), int(1, 28), int(0, 23), int(0, 59)));
    return {
      index,
      row: {
        id: `${digits(8)}-${digits(4)}-4${digits(3)}-a${digits(3)}-${digits(12)}`,
        public_code: `BT-${upper(6)}`,
        name,
        phone,
        email,
        message,
        vehicle_slug: pick(VEHICLE_ROWS).slug,
        depart_at: depart.toISOString(),
        status,
        created_at: new Date(depart.getTime() - int(1, 30) * 86_400_000).toISOString(),
      },
    };
  });
}

const CASE_COUNT = 100;
const SEED = 20260913;
const CASES = makeCases(CASE_COUNT, SEED);

/** 원문 조각이 출력 JSON 에 있으면 실패 — 어떤 조각이 어디서 샜는지 메시지에 남긴다 */
function expectAbsent(json: string, fragment: string, label: string) {
  expect(json.includes(fragment), `${label} 누출: "${fragment}"`).toBe(false);
}

function assertNoLeak(json: string, c: Case) {
  const { name, phone, email, message, id, public_code } = c.row;
  // 이름: 2자 이상이면 원문 전체가 없어야 한다. 1자 이름은 maskName 규칙("한*")상 첫 글자가 곧 이름이라 규칙 일치로만 검사한다.
  if (name.length >= 2) expectAbsent(json, name, `#${c.index} 이름`);
  const tail = name.slice(1);
  if (tail.trim().length >= 2) expectAbsent(json, tail, `#${c.index} 이름 뒷부분`);
  // 전화: 4자리 이상 연속 숫자열 전부
  for (const run of phone.match(/\d{4,}/g) ?? []) expectAbsent(json, run, `#${c.index} 전화`);
  // 이메일: @ 와 로컬파트
  expectAbsent(json, "@", `#${c.index} 이메일 @`);
  expectAbsent(json, email.split("@")[0], `#${c.index} 이메일 로컬파트`);
  // 메시지: 전체와 모든 4글자 창
  expectAbsent(json, message, `#${c.index} 메시지`);
  for (let i = 0; i + 4 <= message.length; i++) expectAbsent(json, message.slice(i, i + 4), `#${c.index} 메시지 조각`);
  // 식별자
  expectAbsent(json, id, `#${c.index} id`);
  expectAbsent(json, public_code, `#${c.index} public_code`);
}

// =============================================================================
// 1. property test — 100 케이스 · 원문 이름·전화·이메일·메시지·식별자 누출 0
// =============================================================================
describe("1. 누출 0 property test (100 케이스, seed 고정)", () => {
  beforeEach(() => logMock.mockClear());

  test("생성기 전제: 케이스 100개, 이름 1~30자, 한글 풀은 출력 글자와 겹치지 않는다", () => {
    expect(CASES).toHaveLength(CASE_COUNT);
    expect(HANGUL_POOL.length).toBeGreaterThan(100);
    for (const ch of HANGUL_POOL) expect(OUTPUT_CHARS.has(ch)).toBe(false);
    for (const c of CASES) {
      expect(c.row.name.length).toBeGreaterThanOrEqual(1);
      expect(c.row.name.length).toBeLessThanOrEqual(30);
    }
    const kinds = new Set(CASES.map((c) => (/^[A-Z]+$/.test(c.row.name) ? "latin" : /\s/.test(c.row.name) ? "mixed" : "hangul")));
    expect([...kinds].sort()).toEqual(["hangul", "latin", "mixed"]);
    expect(CASES.some((c) => c.row.name.length === 1)).toBe(true);
    expect(CASES.some((c) => c.row.name.length === 30)).toBe(true);
    expect(CASES.filter((c) => c.row.status === "cancelled" || c.row.status === "done").length).toBeGreaterThan(5);
  });

  test.each(CASES.map((c): [number, Case] => [c.index, c]))("케이스 #%i — 결과 JSON 에 원문 조각 0, 마스킹 규칙만 통과", async (_i, c) => {
    const { client } = fakeClient({ reservations: { data: [c.row] }, vehicles: { data: VEHICLE_ROWS } });
    const items = await getRecentReservationsMasked(8, client);
    const json = JSON.stringify(items);
    assertNoLeak(json, c);
    expect(/\d{4,}/.test(json), "4자리 이상 숫자열").toBe(false);

    const isPublic = (RECENT_PUBLIC_STATUSES as readonly string[]).includes(c.row.status);
    if (!isPublic) {
      expect(items).toEqual([]);
      return;
    }
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(Object.keys(item).sort()).toEqual(["departDateKst", "maskedName", "status", "vehicleLabel"]);
    expect(item.maskedName).toBe(maskName(c.row.name));
    expect(item.maskedName).toMatch(/^[\s\S]\*{1,2}$/);
    expect(item.vehicleLabel).toBe(LABELS.get(c.row.vehicle_slug));
    expect(item.departDateKst).toBe(kstMonthDay(new Date(c.row.depart_at)));
    expect(item.status).toBe(c.row.status);
  });

  test("100행을 한 번에 넣어도 전체 JSON 에 어떤 케이스의 원문 조각도 없다 (항목 사이 경계 포함)", async () => {
    const { client } = fakeClient({ reservations: { data: CASES.map((c) => c.row) }, vehicles: { data: VEHICLE_ROWS } });
    const items = await getRecentReservationsMasked(100, client);
    const json = JSON.stringify(items);
    for (const c of CASES) assertNoLeak(json, c);
    expect(items.length).toBe(CASES.filter((c) => (RECENT_PUBLIC_STATUSES as readonly string[]).includes(c.row.status)).length);
    for (const it of items) expect(Object.keys(it).sort()).toEqual(["departDateKst", "maskedName", "status", "vehicleLabel"]);
  });

  test("순수 매퍼도 같은 성질 — 행에 phone·email·message·id 가 있어도 항목으로 옮기지 않는다", () => {
    const json = JSON.stringify(mapRecentRows(CASES.map((c) => c.row), LABELS));
    for (const c of CASES) assertNoLeak(json, c);
  });
});

// =============================================================================
// 2. select 컬럼 화이트리스트 — 전화·이메일·메시지는 메모리에도 올리지 않는다
// =============================================================================
describe("2. select 화이트리스트", () => {
  beforeEach(() => logMock.mockClear());

  test("RECENT_SELECT_COLUMNS 는 정확히 5컬럼이고 RECENT_SELECT 는 그 join 이다", () => {
    expect([...RECENT_SELECT_COLUMNS].sort()).toEqual(["created_at", "depart_at", "name", "status", "vehicle_slug"]);
    expect(RECENT_SELECT.split(",").sort()).toEqual([...RECENT_SELECT_COLUMNS].sort());
    for (const banned of ["*", "phone", "email", "message", "id", "public_code", "(", " "]) {
      expect(RECENT_SELECT.includes(banned), banned).toBe(false);
    }
  });

  test("가짜 클라이언트가 받은 reservations select 문자열이 화이트리스트와 정확히 같다 (순서 무관, 그 외 0)", async () => {
    const { client, recorded } = fakeClient({ reservations: { data: [] }, vehicles: { data: VEHICLE_ROWS } });
    await getRecentReservationsMasked(8, client);
    const res = recorded.find((r) => r.table === "reservations");
    expect(res).toBeDefined();
    expect(res!.select!.split(",").map((s) => s.trim()).sort()).toEqual([...RECENT_SELECT_COLUMNS].sort());
  });

  test("status in (new, confirmed) · created_at 내림차순 · limit 이 쿼리에 명시된다 (매퍼 필터와 이중 방어)", async () => {
    const { client, recorded } = fakeClient({ reservations: { data: [] }, vehicles: { data: VEHICLE_ROWS } });
    await getRecentReservationsMasked(5, client);
    const res = recorded.find((r) => r.table === "reservations")!;
    expect(res.calls).toContainEqual({ op: "in", args: ["status", ["new", "confirmed"]] });
    expect(res.calls).toContainEqual({ op: "order", args: ["created_at", { ascending: false }] });
    expect(res.calls).toContainEqual({ op: "limit", args: [5] });
  });

  test("서비스 롤이 닿는 테이블은 reservations · vehicles 둘뿐이고, vehicles 는 slug,name_ko 만 읽는다", async () => {
    const { client, recorded } = fakeClient({ reservations: { data: [] }, vehicles: { data: VEHICLE_ROWS } });
    await getRecentReservationsMasked(8, client);
    expect(recorded.map((r) => r.table).sort()).toEqual(["reservations", "vehicles"]);
    const veh = recorded.find((r) => r.table === "vehicles")!;
    expect(veh.select!.split(",").map((s) => s.trim()).sort()).toEqual(["name_ko", "slug"]);
  });

  test("기본 limit 은 8 이고, 양의 정수가 아니면 클라이언트를 건드리기 전에 throw", async () => {
    expect(DEFAULT_RECENT_LIMIT).toBe(8);
    const { client, recorded } = fakeClient({ reservations: { data: [] }, vehicles: { data: VEHICLE_ROWS } });
    await expect(getRecentReservationsMasked(0, client)).rejects.toThrow();
    await expect(getRecentReservationsMasked(-1, client)).rejects.toThrow();
    await expect(getRecentReservationsMasked(2.5, client)).rejects.toThrow();
    expect(recorded).toEqual([]);
  });
});

// =============================================================================
// 3. 타입 레벨 — 원문 필드가 타입에 없다 (컴파일 타임, tsc 가 잠근다)
// =============================================================================
describe("3. RecentFeedItem 타입에 원문 키가 없다", () => {
  test("keyof RecentFeedItem 은 네 키뿐이고 금지 키와 교집합이 공집합이다", () => {
    expectTypeOf<keyof RecentFeedItem>().toEqualTypeOf<"maskedName" | "vehicleLabel" | "departDateKst" | "status">();
    expectTypeOf<
      Extract<keyof RecentFeedItem, "phone" | "email" | "id" | "publicCode" | "public_code" | "name" | "message" | "createdAt">
    >().toEqualTypeOf<never>();
    expectTypeOf<RecentFeedItem["status"]>().toEqualTypeOf<"new" | "confirmed">();
  });

  test("RecentReservationRow 의 키 = 화이트리스트 (빠진 컬럼도, 남는 컬럼도 없다)", () => {
    expectTypeOf<Exclude<keyof RecentReservationRow, RecentSelectColumn>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<RecentSelectColumn, keyof RecentReservationRow>>().toEqualTypeOf<never>();
  });

  test("런타임에도 항목 키는 네 개뿐이다", () => {
    const [item] = mapRecentRows(
      [{ name: "홍길동", vehicle_slug: "bus45", depart_at: "2026-09-19T23:00:00Z", status: "new", created_at: "2026-09-01T00:00:00Z" }],
      LABELS,
    );
    expect(Object.keys(item).sort()).toEqual(["departDateKst", "maskedName", "status", "vehicleLabel"]);
  });
});

// =============================================================================
// 4·8. 컴포넌트 — 0건이면 null · 카운트 렌더 0 · 서버 컴포넌트 · 원장 고지 · 카피는 ko.json 키만
// =============================================================================
describe("4·8. components/home/RecentFeed.tsx 정적 검사", () => {
  const src = read(COMPONENT);
  const code = codeOf(COMPONENT);
  const ko = JSON.parse(read("messages/ko.json")) as { home: { recentFeed: Record<string, string> } };
  const HANGUL = /[가-힣]/;

  test("빈 배열이면 null 을 반환한다 (섹션 부재가 정답)", () => {
    expect(code).toMatch(/length\s*===\s*0\)\s*return\s+null/);
  });

  test("카운트 렌더 0 — '건' 글자·length 보간·개수 계산이 없다", () => {
    expect(code.includes("건")).toBe(false); // 건
    expect(/length\s*\}/.test(code)).toBe(false);
    expect(/\{\s*items\.length/.test(code)).toBe(false);
    expect(/count/i.test(code)).toBe(false);
  });

  test("서버 컴포넌트 — 'use client' 없음, lib/queries·supabase 직접 조회 없음", () => {
    expect(/['"]use client['"]/.test(src)).toBe(false);
    expect(/@\/lib\/queries|@\/lib\/supabase|createServiceClient|createAnonClient/.test(code)).toBe(false);
  });

  test("법정 고지는 원장 PRIVACY_NOTICE.publicFeedNotice 를 import 해서 렌더한다 (리터럴 0)", () => {
    expect(src).toMatch(/import\s*\{[^}]*PRIVACY_NOTICE[^}]*\}\s*from\s*["']@\/lib\/legal\/disclosures["']/);
    expect(code).toMatch(/PRIVACY_NOTICE\.publicFeedNotice/);
    expect(code.includes("마스킹하여")).toBe(false); // 마스킹하여
  });

  test("한글 리터럴 0건 — 문구는 ko.json home.recentFeed 와 원장에서만 온다", () => {
    const hits = code.split("\n").filter((l) => HANGUL.test(l));
    expect(hits).toEqual([]);
  });

  test("home.recentFeed 네임스페이스만 쓰고, 부르는 키가 전부 ko.json 에 있다", () => {
    expect(code).toMatch(/getTranslations\(\s*["']home\.recentFeed["']\s*\)/);
    const keys = new Set(Object.keys(ko.home.recentFeed));
    expect([...keys].sort()).toEqual(["eyebrow", "itemLabel", "listLabel", "statusConfirmed", "statusNew", "title"]);
    const used = [...code.matchAll(/\bt(?:\.rich)?\(\s*["']([A-Za-z]+)["']/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const k of used) expect(keys.has(k), `ko.json 에 없는 키 ${k}`).toBe(true);
    // 상태 라벨은 순수 함수 recentStatusKey 가 고른 키를 t() 에 넘긴다 — 컴포넌트 안에 status 분기 리터럴이 없다
    expect(code).toMatch(/recentStatusKey\(/);
  });

  test("data-section=\"recent\" · aria-labelledby · 목업 §02 위치용 id", () => {
    expect(code).toContain('data-section="recent"');
    expect(code).toMatch(/aria-labelledby=/);
  });

  test("표시 항목은 maskedName·vehicleLabel·departDateKst·status 만 — 시각·출발지·도착지·인원 필드를 읽지 않는다", () => {
    for (const forbidden of ["origin", "destination", "passengers", "busCount", "departAt", "phone", "email", "name}", ".name"]) {
      expect(code.includes(forbidden), forbidden).toBe(false);
    }
  });

  test("CSS Module 이 있고 무한 롤링 애니메이션(@keyframes) 없이 정적 목록이다", () => {
    const css = read(COMPONENT_CSS);
    expect(css.length).toBeGreaterThan(0);
    expect(/@keyframes/.test(css)).toBe(false);
  });
});

// =============================================================================
// 5. 상태 필터 — cancelled · done 제외 (쿼리 + 매퍼 이중)
// =============================================================================
describe("5. status 필터", () => {
  const base = { vehicle_slug: "bus45", depart_at: "2026-09-19T23:00:00Z", created_at: "2026-09-01T00:00:00Z" };

  test("매퍼: cancelled·done·미지 상태는 버리고 new·confirmed 만 남긴다 (순서 유지)", () => {
    const rows: RecentReservationRow[] = [
      { ...base, name: "가나다", status: "new" },
      { ...base, name: "라마바", status: "cancelled" },
      { ...base, name: "사아자", status: "confirmed" },
      { ...base, name: "차카타", status: "done" },
      { ...base, name: "파하거", status: "weird" },
    ];
    const items = mapRecentRows(rows, LABELS);
    expect(items.map((i) => [i.maskedName, i.status])).toEqual([
      ["가**", "new"],
      ["사**", "confirmed"],
    ]);
  });

  test("함수: 가짜 DB 가 cancelled·done 행을 돌려줘도 결과에 없고, 걸러진 행 수를 warn 로그 한 줄로 남긴다(개인정보 없이)", async () => {
    logMock.mockClear();
    const { client } = fakeClient({
      reservations: {
        data: [
          { ...base, name: "가나다", status: "new" },
          { ...base, name: "라마바", status: "cancelled" },
          { ...base, name: "차카타", status: "done" },
        ],
      },
      vehicles: { data: VEHICLE_ROWS },
    });
    const items = await getRecentReservationsMasked(8, client);
    expect(items.map((i) => i.status)).toEqual(["new"]);
    expect(logMock).toHaveBeenCalledTimes(1);
    const entry = logMock.mock.calls[0][0] as { level: string; event: string };
    expect(entry.level).toBe("warn");
    expect(entry.event).toBe("recent_feed.rows_skipped");
    const logged = JSON.stringify(logMock.mock.calls);
    for (const name of ["가나다", "라마바", "차카타"]) expect(logged.includes(name)).toBe(false);
  });

  test("매퍼: 라벨이 없는 차량 slug · 파싱 불가 운행일은 fail-closed 로 버린다 (slug 를 대신 보여 주지 않는다)", () => {
    const items = mapRecentRows(
      [
        { ...base, name: "가나다", status: "new", vehicle_slug: "ghost99" },
        { ...base, name: "라마바", status: "new", depart_at: "not-a-date" },
        { ...base, name: "사아자", status: "new" },
      ],
      LABELS,
    );
    expect(items).toHaveLength(1);
    expect(items[0].maskedName).toBe("사**");
    expect(JSON.stringify(items).includes("ghost99")).toBe(false);
  });

  test("recentStatusKey — ko.json 키 이름으로 매핑", () => {
    expect(recentStatusKey("new")).toBe("statusNew");
    expect(recentStatusKey("confirmed")).toBe("statusConfirmed");
  });
});

// =============================================================================
// 6. 날짜 KST — TZ=UTC / Asia/Seoul 양쪽에서 같은 답
// =============================================================================
describe.each([["UTC"], ["Asia/Seoul"], ["America/Los_Angeles"]])("6. KST 운행일 (process.env.TZ=%s)", (tz) => {
  let originalTz: string | undefined;
  beforeEach(() => {
    originalTz = process.env.TZ;
    process.env.TZ = tz;
  });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  test("depart_at=2026-09-19T23:00:00Z → 9/20 (UTC 날짜라면 9/19)", async () => {
    const { client } = fakeClient({
      reservations: {
        data: [{ name: "가나다", vehicle_slug: "bus45", depart_at: "2026-09-19T23:00:00Z", status: "new", created_at: "2026-09-01T00:00:00Z" }],
      },
      vehicles: { data: VEHICLE_ROWS },
    });
    const [item] = await getRecentReservationsMasked(8, client);
    expect(item.departDateKst).toBe("9/20");
    expect(new Date("2026-09-19T23:00:00Z").toISOString().slice(0, 10)).toBe("2026-09-19");
  });

  test("kstMonthDay — 연말 경계·제로패딩 제거·같은 날 14:59Z", () => {
    expect(kstMonthDay(new Date("2026-12-31T15:00:00Z"))).toBe("1/1");
    expect(kstMonthDay(new Date("2026-12-31T14:59:00Z"))).toBe("12/31");
    expect(kstMonthDay(new Date("2026-09-19T14:59:00Z"))).toBe("9/19");
    expect(kstMonthDay(new Date("2026-03-01T00:00:00+09:00"))).toBe("3/1");
  });
});

// =============================================================================
// 7. 실패 정책 — env 누락은 throw(fail-loud), DB 오류는 로그 한 줄 + [] (fail-soft)
// =============================================================================
describe("7. 실패 정책", () => {
  const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
  const SERVICE_KEY = "SUPABASE_SERVICE_ROLE_KEY";
  let savedUrl: string | undefined;
  let savedKey: string | undefined;
  beforeEach(() => {
    logMock.mockClear();
    savedUrl = process.env[URL_KEY];
    savedKey = process.env[SERVICE_KEY];
  });
  afterEach(() => {
    if (savedUrl === undefined) delete process.env[URL_KEY];
    else process.env[URL_KEY] = savedUrl;
    if (savedKey === undefined) delete process.env[SERVICE_KEY];
    else process.env[SERVICE_KEY] = savedKey;
  });

  test("서비스 롤 키가 없으면 그대로 throw — 조용히 [] 로 삼키지 않는다 (홈 빌드가 죽는 것이 맞다)", async () => {
    process.env[URL_KEY] = "https://example.supabase.co";
    delete process.env[SERVICE_KEY];
    await expect(getRecentReservationsMasked()).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(logMock).not.toHaveBeenCalled();
  });

  test("reservations 쿼리 error → structuredLog(error, recent_feed.query_failed) 1회 + [] (메시지 원문은 로그에 싣지 않는다)", async () => {
    const { client } = fakeClient({
      reservations: { error: { code: "42501", message: "permission denied for table reservations (secret-detail)" } },
      vehicles: { data: VEHICLE_ROWS },
    });
    await expect(getRecentReservationsMasked(8, client)).resolves.toEqual([]);
    expect(logMock).toHaveBeenCalledTimes(1);
    const entry = logMock.mock.calls[0][0] as { level: string; event: string; table?: string; code?: string | null };
    expect(entry).toMatchObject({ level: "error", event: "recent_feed.query_failed", table: "reservations", code: "42501" });
    expect(JSON.stringify(entry).includes("secret-detail")).toBe(false);
  });

  test("vehicles 쿼리 error → 라벨을 만들 수 없으므로 [] + 로그 (slug 를 대신 노출하지 않는다)", async () => {
    const { client } = fakeClient({
      reservations: { data: [{ name: "가나다", vehicle_slug: "bus45", depart_at: "2026-09-19T23:00:00Z", status: "new", created_at: "2026-09-01T00:00:00Z" }] },
      vehicles: { error: { code: "PGRST000", message: "boom" } },
    });
    await expect(getRecentReservationsMasked(8, client)).resolves.toEqual([]);
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock.mock.calls[0][0]).toMatchObject({ level: "error", event: "recent_feed.query_failed", table: "vehicles" });
  });

  test("네트워크 예외(await 가 reject) → [] + 로그, throw 하지 않는다", async () => {
    const { client } = fakeClient({
      reservations: () => Promise.reject(new TypeError("fetch failed")),
      vehicles: { data: VEHICLE_ROWS },
    });
    await expect(getRecentReservationsMasked(8, client)).resolves.toEqual([]);
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock.mock.calls[0][0]).toMatchObject({ level: "error", event: "recent_feed.query_failed" });
  });

  test("정상 경로에서는 로그 0", async () => {
    const { client } = fakeClient({
      reservations: { data: [{ name: "가나다", vehicle_slug: "bus45", depart_at: "2026-09-19T23:00:00Z", status: "confirmed", created_at: "2026-09-01T00:00:00Z" }] },
      vehicles: { data: VEHICLE_ROWS },
    });
    const items = await getRecentReservationsMasked(8, client);
    expect(items).toEqual([{ maskedName: "가**", vehicleLabel: "45인승 관광버스", departDateKst: "9/20", status: "confirmed" }]);
    expect(logMock).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 9. lib/queries 계층 — recent.ts 만 서비스 롤 예외(사유 등록), 그 외 파일은 여전히 0건
// =============================================================================
describe("9. tests/queries.test.ts 예외 등록 + 그 외 파일 서비스 롤 0건", () => {
  const SERVICE_ROLE = /createServiceClient|service_role|SUPABASE_SERVICE_ROLE_KEY|supabase\/server['"]/;
  const queriesTest = read(QUERIES_TEST);

  test("queries.test.ts 에 SERVICE_ROLE_EXCEPTIONS 가 있고 recent.ts 가 20자 이상의 사유와 함께 등록돼 있다", () => {
    expect(queriesTest).toMatch(/SERVICE_ROLE_EXCEPTIONS/);
    expect(queriesTest).toMatch(/file:\s*"lib\/queries\/recent\.ts",\s*\n\s*why:\s*"[^"]{20,}"/);
  });

  test("예외는 정확히 1건(recent.ts)이다", () => {
    const files = [...queriesTest.matchAll(/file:\s*"(lib\/queries\/[^"]+)"/g)].map((m) => m[1]);
    expect(files).toEqual(["lib/queries/recent.ts"]);
  });

  test("lib/queries/** 에서 recent.ts 를 뺀 모든 파일 + lib/supabase/anon.ts 는 서비스 롤 심볼 0건", () => {
    const files = [...walk(path.join(ROOT, "lib", "queries")), path.join(ROOT, "lib", "supabase", "anon.ts")]
      .map((p) => toPosix(path.relative(ROOT, p)))
      .filter((f) => f !== RECENT_QUERY);
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) expect(SERVICE_ROLE.test(read(f)), f).toBe(false);
  });

  test("recent.ts 는 서비스 롤을 쓰지만 서버 액션·Next 캐시·Next import·index.ts re-export 는 아니다", () => {
    const src = read(RECENT_QUERY);
    expect(SERVICE_ROLE.test(src)).toBe(true);
    expect(/['"]use server['"]/.test(src)).toBe(false);
    expect(/from\s+['"]next(\/|['"])/.test(src)).toBe(false);
    expect(/next\/cache|revalidateTag\s*\(/.test(src)).toBe(false);
    expect(/recent/.test(read("lib/queries/index.ts"))).toBe(false);
    // 상단 주석에 예외와 이유가 있다
    expect(src.slice(0, 1500)).toMatch(/RLS/);
    expect(src.slice(0, 1500)).toMatch(/서비스 롤/); // 서비스 롤
  });

  test("순수 모듈 lib/recent-feed.ts — Next·Supabase·env·server-only 없음, maskName 은 lib/mask 에서 가져온다", () => {
    const src = read(RECENT_PURE);
    expect(/from\s+['"]next(\/|['"])|supabase|process\.env|["']server-only["']/.test(src)).toBe(false);
    expect(src).toMatch(/from\s+["']\.\/mask["']/);
    expect(src).toMatch(/from\s+["']\.\/kst["']/);
    expect(/function\s+maskName|const\s+maskName/.test(src)).toBe(false);
  });
});

// =============================================================================
// 10. 페이지 배선 — routes 아래·trust 위, 60초 태그 캐시, 프리뷰 분기는 개발 전용
// =============================================================================
describe("10. app/[locale]/(site)/page.tsx 배선", () => {
  const page = codeOf(PAGE);

  test("<RecentFeed> 가 <RoutesSection> 뒤, <TrustBar> 앞에 있다 (목업 §02 위치)", () => {
    const routes = page.search(/<RoutesSection[\s/>]/);
    const recent = page.search(/<RecentFeed[\s/>]/);
    const trust = page.search(/<TrustBar[\s/>]/);
    expect(routes).toBeGreaterThan(-1);
    expect(recent).toBeGreaterThan(routes);
    expect(trust).toBeGreaterThan(recent);
  });

  test("호출부가 60초 · QUERY_TAGS.recent 태그 캐시로 감싼다 (쿼리 계층은 캐시를 모른다)", () => {
    expect(page).toMatch(/unstable_cache\(/);
    expect(page).toMatch(/\["recent-feed"\]/);
    expect(page).toMatch(/revalidate:\s*60\b/);
    expect(page).toMatch(/tags:\s*\[QUERY_TAGS\.recent\]/);
    expect(page).toMatch(/getRecentReservationsMasked\(/);
    expect(page).toMatch(/from\s+["']@\/lib\/queries\/recent["']/);
  });

  test("?previewFeed=1 분기는 개발 전용 dev 객체에서만 읽고, 더미 원문 행을 실제 매퍼로 통과시킨다", () => {
    expect(page).toMatch(/dev\.previewFeed\s*===\s*"1"/);
    expect(page).toMatch(/PREVIEW_RECENT_ROWS/);
    expect(page).toMatch(/mapRecentRows\(/);
    const guard = page.indexOf('process.env.NODE_ENV !== "production"');
    expect(guard).toBeGreaterThan(-1);
    expect(page.indexOf("previewFeed")).toBeGreaterThan(guard);
  });

  test("components/home/** 는 getRecentReservationsMasked 를 부르지 않는다", () => {
    for (const p of walk(path.join(ROOT, "components", "home"))) {
      expect(/getRecentReservationsMasked|unstable_cache/.test(read(toPosix(path.relative(ROOT, p)))), p).toBe(false);
    }
  });
});

// =============================================================================
// 11. 프리뷰 더미 — 원문 행 3건이 매퍼를 지나면 원문 이름·전화·이메일이 0건
// =============================================================================
describe("11. recent-feed-preview.ts", () => {
  test("원문 행 3건 · 전부 공개 상태 · 마커(원문 이름·전화 숫자열·이메일)가 매핑 결과 JSON 에 없다", () => {
    expect(PREVIEW_RECENT_ROWS).toHaveLength(3);
    for (const r of PREVIEW_RECENT_ROWS) expect(RECENT_PUBLIC_STATUSES).toContain(r.status);
    const items = mapRecentRows(PREVIEW_RECENT_ROWS, LABELS);
    expect(items).toHaveLength(3);
    const json = JSON.stringify(items);
    expect(PREVIEW_RAW_MARKERS.length).toBeGreaterThanOrEqual(9);
    for (const m of PREVIEW_RAW_MARKERS) expect(json.includes(m), m).toBe(false);
    for (const r of PREVIEW_RECENT_ROWS) {
      expect(PREVIEW_RAW_MARKERS).toContain(r.name);
      for (const run of r.phone.match(/\d{4,}/g) ?? []) expect(PREVIEW_RAW_MARKERS).toContain(run);
      expect(PREVIEW_RAW_MARKERS).toContain(r.email.split("@")[0]);
    }
  });

  test("프리뷰 파일은 lib/queries 를 import 하지 않고(순수 모듈만), 운영 카피(ko.json)에 올라가지 않는다", () => {
    const src = read(PREVIEW);
    expect(/@\/lib\/queries|@\/lib\/supabase/.test(src)).toBe(false);
    const ko = read("messages/ko.json");
    for (const r of PREVIEW_RECENT_ROWS) expect(ko.includes(r.name)).toBe(false);
  });
});

// =============================================================================
// 12. 기간 조건 — 카피가 "최근"이라고 말하는 범위를 쿼리가 실제로 건다 (P6-6 감사 R-1)
// =============================================================================
describe("12. '최근' 기간 창 — 경계 · 카피 대조 · 0건 숨김", () => {
  const base = { vehicle_slug: "bus45", depart_at: "2026-09-19T23:00:00Z" };
  const NOW = new Date("2026-09-16T00:00:00.000Z");
  const DAY_MS = 86_400_000;

  /**
   * gte("created_at", …) 를 **실제로 적용하는** 가짜 클라이언트.
   * 위쪽 fakeClient 는 호출만 기록하고 필터링하지 않으므로, 경계 검사에는 쓸 수 없다.
   */
  function windowClient(rows: RecentReservationRow[]) {
    const seen: { gte?: string } = {};
    const client = {
      from(table: string) {
        const builder: Record<string, unknown> = {};
        let data: unknown = table === "vehicles" ? VEHICLE_ROWS : rows;
        for (const op of ["select", "in", "order", "limit", "overrideTypes"]) builder[op] = () => builder;
        builder.gte = (col: string, value: string) => {
          if (table === "reservations" && col === "created_at") {
            seen.gte = value;
            data = rows.filter((r) => r.created_at >= value);
          }
          return builder;
        };
        builder.then = (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data, error: null }).then(onFulfilled);
        return builder;
      },
    };
    return { client: client as unknown as ServiceClient, seen };
  }

  test("창 시작 시각은 now - RECENT_WINDOW_DAYS 일이다 (상수가 실제로 쓰인다)", () => {
    expect(RECENT_WINDOW_DAYS).toBeGreaterThan(0);
    expect(recentWindowStart(NOW)).toBe(new Date(NOW.getTime() - RECENT_WINDOW_DAYS * DAY_MS).toISOString());
  });

  test("경계 — 창 안(1초 안쪽) 1건은 남고, 창 밖(1초 바깥) 1건은 빠진다", async () => {
    const edge = new Date(NOW.getTime() - RECENT_WINDOW_DAYS * DAY_MS);
    const rows: RecentReservationRow[] = [
      { ...base, name: "안쪽사람", status: "new", created_at: new Date(edge.getTime() + 1000).toISOString() },
      { ...base, name: "바깥사람", status: "new", created_at: new Date(edge.getTime() - 1000).toISOString() },
    ];
    const { client, seen } = windowClient(rows);
    const items = await getRecentReservationsMasked(8, client, NOW);
    expect(seen.gte, "쿼리에 기간 조건이 걸리지 않았다").toBe(edge.toISOString());
    expect(items.map((i) => i.maskedName)).toEqual(["안**"]);
  });

  test("창 밖 접수만 있으면 0건 — 홈은 섹션을 통째로 숨긴다 (마케팅 섹션에만 허용되는 빈 값 숨김)", async () => {
    const old = new Date(NOW.getTime() - (RECENT_WINDOW_DAYS + 90) * DAY_MS).toISOString();
    const { client } = windowClient([{ ...base, name: "오래된사람", status: "new", created_at: old }]);
    await expect(getRecentReservationsMasked(8, client, NOW)).resolves.toEqual([]);
    // 숨김 자체는 §4·8 이 단언한다(`length === 0 → return null`). 여기서는 **그 숨김이 어디까지 허용되는지**를 못 박는다.
    expect(read(COMPONENT)).toMatch(/length\s*===\s*0\)\s*return\s+null/);
  });

  test("이 '빈 값 숨김' 선례는 법정 고지에 인용할 수 없다 — 고지는 빈 값이어도 렌더된다", () => {
    // P6-6 브리프 §(1-A) 2번: 마케팅 섹션의 숨김과 법정 고지의 숨김은 다른 규칙이다.
    // 같은 컴포넌트 안에서 고지(PRIVACY_NOTICE.publicFeedNotice)는 조건 없이 렌더된다 — 숨김 분기 밖에 있다.
    const code = codeOf(COMPONENT);
    const afterGuard = code.slice(code.indexOf("return null"));
    expect(afterGuard).toMatch(/PRIVACY_NOTICE\.publicFeedNotice/);
    expect(/publicFeedNotice[^\n]*&&/.test(code), "고지에 조건부 렌더가 붙었다").toBe(false);
  });

  test("카피가 시간 주장을 하지 않는다 — '방금'·'실시간' 0건, '최근' 은 있다", () => {
    const feed = JSON.stringify(
      (JSON.parse(read("messages/ko.json")) as { home: { recentFeed: unknown } }).home.recentFeed,
    );
    expect(feed.includes("방금"), "기간 조건이 30일인데 카피가 '방금'이라고 말한다").toBe(false);
    expect(feed.includes("실시간"), "기간 조건이 30일인데 카피가 '실시간'이라고 말한다").toBe(false);
    expect(feed.includes("최근")).toBe(true);
  });

  test("화이트리스트·마스킹·반환 타입은 넓어지지 않았다 (기간 조건만 더했다)", () => {
    expect(RECENT_SELECT.split(",").sort()).toEqual([...RECENT_SELECT_COLUMNS].sort());
    expect(RECENT_SELECT.includes("phone")).toBe(false);
    expect(RECENT_SELECT.includes("email")).toBe(false);
    expect(RECENT_SELECT.includes("message")).toBe(false);
    expect(RECENT_SELECT.includes("public_code")).toBe(false);
  });
});

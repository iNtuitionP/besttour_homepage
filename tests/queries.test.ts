import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PLACES, SHOWCASE_ROUTE_SEED, type PlaceCode } from "@/lib/codes";
import { parseKst, toKstDateString } from "@/lib/kst";
import { PLACE_POINTS } from "@/lib/map-coords";
import {
  QUERY_TAGS,
  getActivePopup,
  getNotices,
  getPlaces,
  getShowcaseRoutes,
  getVehicles,
  isActiveOn,
  mapShowcaseRouteRows,
} from "@/lib/queries";
import { loadDotEnvLocal } from "./helpers/load-env-local";

loadDotEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const QUERIES_DIR = path.join(ROOT, "lib", "queries");
// 쿼리 계층이 쓰는 anon 클라이언트 모듈도 같은 규칙을 받는다 — 여기서 서비스 롤로 새면 계층 전체가 뚫린다.
const ANON_CLIENT_FILE = path.join(ROOT, "lib", "supabase", "anon.ts");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const scannedFiles = [...walk(QUERIES_DIR), ANON_CLIENT_FILE];
const sources = scannedFiles.map((p) => ({ file: path.relative(ROOT, p), text: readFileSync(p, "utf-8") }));
const placeByCode = new Map(PLACES.map((p) => [p.code as string, p]));

// =============================================================================
// 1. 정적 검사 — 서버 액션 아님, 서비스 롤 없음, 캐시 모름, 가격 연산 없음 (ADR-3, 브리프 원칙 1·2·5)
// =============================================================================
describe("lib/queries 정적 검사", () => {
  test("브리프가 요구한 모듈 6개 + P2-4 gallery.ts 가 있다", () => {
    const names = walk(QUERIES_DIR).map((p) => path.basename(p));
    for (const f of ["showcase.ts", "places.ts", "vehicles.ts", "notices.ts", "popups.ts", "gallery.ts", "index.ts"]) {
      expect(names, `${f} 없음`).toContain(f);
    }
  });

  test.each([
    ["서버 액션 지시어", /['"]use server['"]/],
    ["서비스 롤 클라이언트 팩토리", /createServiceClient/],
    ["서비스 롤 심볼", /service_role|SUPABASE_SERVICE_ROLE_KEY/],
    ["서비스 롤 모듈 import", /supabase\/server['"]/],
    ["Next 캐시 API", /next\/cache|unstable_cache|revalidateTag\s*\(|['"]use cache['"]/],
    ["Next 프레임워크 import (순수 함수 유지)", /from\s+['"]next(\/|['"])/],
  ])("금지 심볼 0건 — %s", (_label, pattern) => {
    for (const { file, text } of sources) {
      expect(pattern.test(text), `${file} 에 ${pattern} 검출`).toBe(false);
    }
  });

  test.each([
    ["price_from 산술", /price_from\s*[*/+%-]/],
    ["priceFrom 산술", /priceFrom\s*[*/+%-]/],
    ["만원 환산 상수", /[*/]\s*1[_,]?0{3,}\b/],
    ["toLocaleString", /toLocaleString/],
    ["Intl.NumberFormat", /Intl\.NumberFormat/],
    ["반올림 계열", /Math\.(round|floor|ceil|trunc)\s*\(/],
    ["만원 표기", /만원|만 원/],
  ])("가격 연산·포맷 흔적 0건 — %s", (_label, pattern) => {
    for (const { file, text } of sources) {
      expect(pattern.test(text), `${file} 에 ${pattern} 검출`).toBe(false);
    }
  });

  test("QUERY_TAGS — 6개 태그(P2-4 gallery 추가), 값 고유", () => {
    expect(Object.keys(QUERY_TAGS).sort()).toEqual(["gallery", "notices", "places", "popups", "showcase", "vehicles"]);
    const values = Object.values(QUERY_TAGS);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v).toMatch(/^[a-z]+$/);
  });
});

// =============================================================================
// 2. KST 경계 — 순수 함수. TZ=UTC / Asia/Seoul 양쪽에서 같은 답 (CLAUDE.md §3, 브리프 원칙 4)
// =============================================================================
const POPUP_ENDS_0911 = { active: true, startsAt: "2026-09-01", endsAt: "2026-09-11" };
const POPUP_STARTS_0912 = { active: true, startsAt: "2026-09-12", endsAt: "2026-09-30" };
const POPUP_ONE_DAY = { active: true, startsAt: "2026-09-11", endsAt: "2026-09-11" };

describe.each([["UTC"], ["Asia/Seoul"]])("KST 경계 (process.env.TZ=%s)", (tz) => {
  let originalTz: string | undefined;
  beforeEach(() => {
    originalTz = process.env.TZ;
    process.env.TZ = tz;
  });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  test("toKstDateString: 23:59 → 같은 날, 00:00 → 다음 날", () => {
    expect(toKstDateString(parseKst("2026-09-11T23:59"))).toBe("2026-09-11");
    expect(toKstDateString(parseKst("2026-09-12T00:00"))).toBe("2026-09-12");
    expect(toKstDateString(parseKst("2026-09-12T08:59"))).toBe("2026-09-12");
    expect(toKstDateString(parseKst("2026-09-12T09:00"))).toBe("2026-09-12");
  });

  test("대조: 같은 인스턴트를 UTC 날짜로 읽으면 KST 00:00~08:59 는 전날이 된다 — 그래서 UTC 비교 금지", () => {
    expect(parseKst("2026-09-12T00:00").toISOString().slice(0, 10)).toBe("2026-09-11");
    expect(parseKst("2026-09-12T08:59").toISOString().slice(0, 10)).toBe("2026-09-11");
  });

  test("ends_at=09-11: KST 09-11T23:59 노출, 09-12T00:00 종료", () => {
    expect(isActiveOn(POPUP_ENDS_0911, toKstDateString(parseKst("2026-09-11T23:59")))).toBe(true);
    expect(isActiveOn(POPUP_ENDS_0911, toKstDateString(parseKst("2026-09-12T00:00")))).toBe(false);
  });

  test("starts_at=09-12: KST 09-11T23:59 미노출, 09-12T00:00 시작", () => {
    expect(isActiveOn(POPUP_STARTS_0912, toKstDateString(parseKst("2026-09-11T23:59")))).toBe(false);
    expect(isActiveOn(POPUP_STARTS_0912, toKstDateString(parseKst("2026-09-12T00:00")))).toBe(true);
  });

  test("하루짜리(starts=ends=09-11) 는 그날 하루만", () => {
    expect(isActiveOn(POPUP_ONE_DAY, "2026-09-10")).toBe(false);
    expect(isActiveOn(POPUP_ONE_DAY, "2026-09-11")).toBe(true);
    expect(isActiveOn(POPUP_ONE_DAY, "2026-09-12")).toBe(false);
  });

  test("active=false 면 기간 안이라도 미노출", () => {
    expect(isActiveOn({ ...POPUP_ONE_DAY, active: false }, "2026-09-11")).toBe(false);
  });

  test("연·월 경계도 문자열 비교로 안전하다 (제로패딩 고정)", () => {
    const p = { active: true, startsAt: "2026-12-31", endsAt: "2027-01-01" };
    expect(isActiveOn(p, toKstDateString(parseKst("2026-12-30T23:59")))).toBe(false);
    expect(isActiveOn(p, toKstDateString(parseKst("2026-12-31T00:00")))).toBe(true);
    expect(isActiveOn(p, toKstDateString(parseKst("2027-01-01T23:59")))).toBe(true);
    expect(isActiveOn(p, toKstDateString(parseKst("2027-01-02T00:00")))).toBe(false);
  });

  test("YYYY-MM-DD 가 아닌 날짜 문자열은 throw (사전순 비교 오작동 방지)", () => {
    expect(() => isActiveOn(POPUP_ONE_DAY, "2026-9-11")).toThrow();
    expect(() => isActiveOn(POPUP_ONE_DAY, "2026-09-11T00:00")).toThrow();
    expect(() => isActiveOn({ active: true, startsAt: "2026/09/01", endsAt: "2026-09-30" }, "2026-09-11")).toThrow();
  });
});

// =============================================================================
// 3. 순수 매퍼 — DB 행 → 뷰. 필드를 조용히 버리지 않는다 (브리프 원칙 6).
// =============================================================================
describe("mapShowcaseRouteRows", () => {
  const pin = (code: string) => ({
    code,
    name_ko: `${code}-ko`,
    name_en: `${code}-en`,
    kind: code === "ICN" ? ("airport" as const) : ("city" as const),
    svg_x: 1.5,
    svg_y: 2.5,
  });
  const row = {
    id: 6,
    origin_code: "ICN",
    destination_code: "SEL",
    price_from: 400000,
    highlight: true,
    sort: 1,
    active: true,
    origin: pin("ICN"),
    destination: pin("SEL"),
  };

  test("모든 컬럼이 camelCase 필드로 옮겨지고 price_from 은 그대로다", () => {
    const [v] = mapShowcaseRouteRows([row]);
    expect(v).toEqual({
      id: 6,
      originCode: "ICN",
      destinationCode: "SEL",
      priceFrom: 400000,
      highlight: true,
      sort: 1,
      active: true,
      origin: { code: "ICN", nameKo: "ICN-ko", nameEn: "ICN-en", kind: "airport", svgX: 1.5, svgY: 2.5 },
      destination: { code: "SEL", nameKo: "SEL-ko", nameEn: "SEL-en", kind: "city", svgX: 1.5, svgY: 2.5 },
    });
  });

  test("price_from NULL 은 null 로 통과 (라벨 숨김 폴백은 컴포넌트 몫)", () => {
    const [v] = mapShowcaseRouteRows([{ ...row, price_from: null, sort: null }]);
    expect(v.priceFrom).toBeNull();
    expect(v.sort).toBeNull();
  });

  test("끝점 place 가 RLS 로 가려져 null 이면 그 노선은 제외하고 경고한다 (양 끝이 공개여야 공개 노선)", () => {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
    try {
      const out = mapShowcaseRouteRows([row, { ...row, id: 7, destination_code: "XXX", destination: null }]);
      expect(out.map((v) => v.id)).toEqual([6]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/7/);
      expect(warnings[0]).toMatch(/XXX/);
    } finally {
      console.warn = orig;
    }
  });
});

// =============================================================================
// 4. DB 읽기 — anon 키 + RLS 만으로 (원격 라이브 DB · 읽기 전용 · 어떤 쓰기도 하지 않는다)
//    dbSmokeEnv() 를 확장하지 않는다 — anon 키만 직접 읽고, 블록 동안 서비스 롤 키를 env 에서 제거해
//    "쿼리 계층이 서비스 롤 없이 동작한다"를 실행으로 증명한다.
// =============================================================================
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasAnon = Boolean(supabaseUrl && anonKey);
const requireDb = process.env.REQUIRE_DB_TESTS === "1";

if (requireDb && !hasAnon) {
  describe("DB 읽기 — REQUIRE_DB_TESTS guard", () => {
    test("REQUIRE_DB_TESTS=1 인데 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 없음", () => {
      throw new Error(
        "REQUIRE_DB_TESTS=1 이지만 anon 접속 정보가 비어 있다. DB 읽기 테스트가 조용히 skip 되는 것을 막는 가드다 — " +
          "CI 라면 supabase status -o env 주입 단계를 확인할 것.",
      );
    });
  });
}

describe.skipIf(!hasAnon)("DB 읽기 — anon 키 + RLS (원격, 읽기 전용)", () => {
  const SERVICE_KEY_NAME = "SUPABASE_SERVICE_ROLE_KEY";
  let savedServiceKey: string | undefined;
  const anonHeaders = { apikey: anonKey as string, Authorization: `Bearer ${anonKey}` };

  beforeAll(() => {
    savedServiceKey = process.env[SERVICE_KEY_NAME];
    delete process.env[SERVICE_KEY_NAME];
  });
  afterAll(() => {
    if (savedServiceKey !== undefined) process.env[SERVICE_KEY_NAME] = savedServiceKey;
  });

  test("전제: 블록 동안 서비스 롤 키는 env 에 없다", () => {
    expect(process.env[SERVICE_KEY_NAME]).toBeUndefined();
  });

  test("getShowcaseRoutes: 16행, sort 오름차순, 첫 행 ICN→SEL 400000 highlight, 양 끝 place 조인", async () => {
    const routes = await getShowcaseRoutes();
    expect(routes).toHaveLength(16);
    expect(routes.map((r) => r.sort)).toEqual(routes.map((_, i) => i + 1));

    expect(routes[0]).toMatchObject({
      originCode: "ICN",
      destinationCode: "SEL",
      priceFrom: 400000,
      highlight: true,
      sort: 1,
      active: true,
    });

    // 스펙 §13.2 리터럴과 전량 일치 — price_from 은 원 단위 정수 그대로.
    expect(
      routes.map(({ originCode, destinationCode, priceFrom, highlight, sort }) => ({
        originCode,
        destinationCode,
        priceFrom,
        highlight,
        sort,
      })),
    ).toEqual([...SHOWCASE_ROUTE_SEED]);

    for (const r of routes) {
      expect(typeof r.id).toBe("number");
      expect(Number.isInteger(r.priceFrom)).toBe(true);
      expect(r.origin.code).toBe(r.originCode);
      expect(r.destination.code).toBe(r.destinationCode);
      for (const end of [r.origin, r.destination]) {
        const catalog = placeByCode.get(end.code);
        expect(catalog, `${end.code} 가 PLACES 에 없다`).toBeDefined();
        expect(end.nameKo).toBe(catalog?.nameKo);
        expect(end.nameEn).toBe(catalog?.nameEn);
        expect(end.kind).toBe(catalog?.kind);
        expect(end.svgX).toBe(PLACE_POINTS[end.code as PlaceCode].x);
        expect(end.svgY).toBe(PLACE_POINTS[end.code as PlaceCode].y);
      }
    }
  });

  test("getPlaces: 17행, sort 순, PLACES·PLACE_POINTS 와 일치", async () => {
    const places = await getPlaces();
    expect(places).toHaveLength(17);
    expect(
      places.map(({ code, nameKo, nameEn, kind, regionCode, lat, lng, sort }) => ({
        code,
        nameKo,
        nameEn,
        kind,
        regionCode,
        lat,
        lng,
        sort,
      })),
    ).toEqual(
      PLACES.map(({ code, nameKo, nameEn, kind, regionCode, lat, lng, sort }) => ({
        code,
        nameKo,
        nameEn,
        kind,
        regionCode,
        lat,
        lng,
        sort,
      })),
    );
    for (const p of places) {
      expect(p.active).toBe(true);
      expect(p.svgX).toBe(PLACE_POINTS[p.code as PlaceCode].x);
      expect(p.svgY).toBe(PLACE_POINTS[p.code as PlaceCode].y);
    }
  });

  test("getVehicles: 5행, sort 순 (0001 시드)", async () => {
    const vehicles = await getVehicles();
    expect(vehicles).toHaveLength(5);
    expect(vehicles.map((v) => v.slug)).toEqual(["bus45", "bus35", "limo28", "bus25", "bus16"]);
    expect(vehicles.map((v) => v.capacity)).toEqual([45, 35, 28, 25, 16]);
    expect(vehicles.map((v) => v.sort)).toEqual([1, 2, 3, 4, 5]);
    for (const v of vehicles) {
      expect(typeof v.id).toBe("number");
      expect(v.nameKo.length).toBeGreaterThan(0);
      expect(v.nameEn.length).toBeGreaterThan(0);
      expect(v.active).toBe(true);
    }
  });

  test("getNotices: 배열, published_at 내림차순, limit 준수", async () => {
    const all = await getNotices();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeLessThanOrEqual(10);
    for (const n of all) {
      expect(Object.keys(n).sort()).toEqual(["active", "body", "category", "id", "publishedAt", "title"]);
      expect(n.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(n.active).toBe(true);
    }
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].publishedAt >= all[i].publishedAt).toBe(true);
    }
    const one = await getNotices(1);
    expect(one.length).toBeLessThanOrEqual(1);
  });

  test("getNotices: limit 이 양의 정수가 아니면 조회 전에 throw", async () => {
    await expect(getNotices(0)).rejects.toThrow();
    await expect(getNotices(-1)).rejects.toThrow();
    await expect(getNotices(1.5)).rejects.toThrow();
  });

  test("getActivePopup: popups 에 (RLS 로 보이는) 행이 없으면 null, 있으면 KST 오늘 기준 노출 중인 것", async () => {
    // 브리프: 별도 anon 클라이언트(순수 fetch)로 같은 테이블을 읽어 대조한다.
    const res = await fetch(`${supabaseUrl}/rest/v1/popups?select=id,starts_at,ends_at,active`, {
      headers: anonHeaders,
    });
    expect(res.ok).toBe(true);
    const visible = (await res.json()) as { id: number; starts_at: string; ends_at: string; active: boolean }[];

    const popup = await getActivePopup();
    if (visible.length === 0) {
      expect(popup).toBeNull();
      return;
    }
    const today = toKstDateString(new Date());
    const candidates = visible.filter((p) =>
      isActiveOn({ active: p.active, startsAt: p.starts_at, endsAt: p.ends_at }, today),
    );
    if (candidates.length === 0) {
      expect(popup).toBeNull();
      return;
    }
    expect(popup).not.toBeNull();
    expect(isActiveOn(popup!, today)).toBe(true);
    expect(candidates.map((c) => c.id)).toContain(popup!.id);
  });

  test("getActivePopup: 주입한 now(2000-01-01) 기준으로는 항상 null", async () => {
    expect(await getActivePopup({ now: new Date("2000-01-01T00:00:00Z") })).toBeNull();
  });
});

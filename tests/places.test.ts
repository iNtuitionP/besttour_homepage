import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { PLACES, REGIONS, SHOWCASE_ROUTE_SEED, type PlaceCode } from "@/lib/codes";
import {
  LATLNG_TO_SVG,
  PLACE_POINTS,
  PROJECTION_ANCHORS,
  REGION_POINTS,
  projectLatLng,
} from "@/lib/map-coords";
import { withShowcaseRoutesLock } from "./helpers/db-lock";
import { dbSmokeEnv } from "./helpers/load-env-local";

const VIEWBOX_W = 524;
const VIEWBOX_H = 560;
const SUPABASE_DIR = path.resolve(import.meta.dirname, "..", "supabase");
const UP_SQL_PATH = path.join(SUPABASE_DIR, "migrations", "0002_places.sql");
// 롤백은 migrations/ 밖에 둔다 — Supabase CLI 는 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 를
// 전부 마이그레이션으로 집어 `0002_places.down.sql` 도 적용해 버린다(CLI 2.117.0 확인).
const DOWN_SQL_PATH = path.join(SUPABASE_DIR, "rollbacks", "0002_places.down.sql");
const MIGRATIONS_DIR = path.join(SUPABASE_DIR, "migrations");

// =============================================================================
// 픽스처 — 스펙 §13.2 (docs/superpowers/specs/2026-08-07-bestour-redesign-uiux-design.md:164-165)
// "인천공항→서울 40만 / 서울→부산 120만 / 서울→대구 100만 / 서울→통영 130만 / 서울→포항 120만 /
//  서울→전주 80만 / 서울→광주 100만 / 서울→여수 120만 / 서울→해남 120만 / 서울→대전 70만 /
//  서울→세종 70만 / 서울→속초 80만 / 서울→강릉 80만 / 서울→태백 90만 / 서울→홍천 70만 / 서울→원주 70만"
// 강조(highlight)는 인천공항→서울 하나뿐. 순서 = sort 1..16.
// 값은 리터럴이다 — 어떤 계산·변환도 하지 않는다.
// =============================================================================
const SPEC_13_2 = [
  // [출발 코드, 출발 한글, 도착 코드, 도착 한글, price_from(원), highlight]
  ["ICN", "인천공항", "SEL", "서울", 400000, true],
  ["SEL", "서울", "BSN", "부산", 1200000, false],
  ["SEL", "서울", "DGU", "대구", 1000000, false],
  ["SEL", "서울", "TYG", "통영", 1300000, false],
  ["SEL", "서울", "PHG", "포항", 1200000, false],
  ["SEL", "서울", "JJU", "전주", 800000, false],
  ["SEL", "서울", "GWJ", "광주", 1000000, false],
  ["SEL", "서울", "YSU", "여수", 1200000, false],
  ["SEL", "서울", "HNM", "해남", 1200000, false],
  ["SEL", "서울", "DJN", "대전", 700000, false],
  ["SEL", "서울", "SJG", "세종", 700000, false],
  ["SEL", "서울", "SCH", "속초", 800000, false],
  ["SEL", "서울", "GNG", "강릉", 800000, false],
  ["SEL", "서울", "TBK", "태백", 900000, false],
  ["SEL", "서울", "HCN", "홍천", 700000, false],
  ["SEL", "서울", "WJU", "원주", 700000, false],
] as const;

/** 기존 REGIONS 코드 중 도시(점)로 확정되어 places 에 그대로 재사용하는 6개. */
const REUSED_REGION_CODES = ["ICN", "SEL", "BSN", "DGU", "GWJ", "DJN"] as const;

const placeByCode = new Map(PLACES.map((p) => [p.code as string, p]));
const readSql = (p: string) => readFileSync(p, "utf-8");

/** `insert into <table> (...) values` 부터 다음 `;` 까지의 블록만 잘라낸다. */
function insertBlock(sql: string, table: string): string {
  const re = new RegExp(`insert\\s+into\\s+${table}\\s*\\([^)]*\\)\\s*values([\\s\\S]*?);`, "i");
  const m = sql.match(re);
  if (!m) throw new Error(`insert into ${table} 블록을 찾지 못했다`);
  return m[1];
}

// -----------------------------------------------------------------------------
// 1. PLACES 카탈로그 무결성
// -----------------------------------------------------------------------------
describe("PLACES 카탈로그", () => {
  test("16개 도착지 + 출발지 ICN·SEL 이 전부 존재한다 (SEL 중복 제외 17개)", () => {
    const expected = new Set<string>();
    for (const [o, , d] of SPEC_13_2) {
      expected.add(o);
      expected.add(d);
    }
    expect(expected.size).toBe(17);
    for (const code of expected) {
      expect(placeByCode.has(code), `${code} 가 PLACES 에 없다`).toBe(true);
    }
    expect(PLACES).toHaveLength(17);
  });

  test("코드 중복 0", () => {
    const codes = PLACES.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("코드 형식: 3글자 대문자", () => {
    for (const p of PLACES) expect(p.code).toMatch(/^[A-Z]{3}$/);
  });

  test("새 코드는 기존 REGIONS 17개와 충돌 0 — 재사용은 도시 확정 6개만", () => {
    const regionSet = new Set<string>(REGIONS);
    for (const p of PLACES) {
      if (regionSet.has(p.code)) {
        expect(REUSED_REGION_CODES, `${p.code} 는 재사용 허용 목록 밖의 시도 코드`).toContain(p.code);
      }
    }
    for (const code of REUSED_REGION_CODES) expect(placeByCode.has(code)).toBe(true);
  });

  test("한글명이 스펙 §13.2 표기와 일치한다", () => {
    const nameByCode = new Map<string, string>();
    for (const [o, oKo, d, dKo] of SPEC_13_2) {
      nameByCode.set(o, oKo);
      nameByCode.set(d, dKo);
    }
    for (const [code, nameKo] of nameByCode) {
      expect(placeByCode.get(code)?.nameKo, code).toBe(nameKo);
    }
  });

  test("kind: ICN 만 airport, 나머지는 city", () => {
    for (const p of PLACES) {
      expect(p.kind).toBe(p.code === "ICN" ? "airport" : "city");
    }
  });

  test("region_code 는 REGIONS 코드이며, 광역시·공항은 자기 시도에 귀속", () => {
    const regionSet = new Set<string>(REGIONS);
    for (const p of PLACES) {
      expect(regionSet, `${p.code}.regionCode=${p.regionCode}`).toContain(p.regionCode);
    }
    expect(placeByCode.get("ICN")?.regionCode).toBe("INC");
    for (const code of ["SEL", "BSN", "DGU", "GWJ", "DJN"]) {
      expect(placeByCode.get(code)?.regionCode).toBe(code);
    }
    for (const code of ["SCH", "GNG", "TBK", "HCN", "WJU"]) {
      expect(placeByCode.get(code)?.regionCode, code).toBe("GW");
    }
    expect(placeByCode.get("JJU")?.regionCode).toBe("JB");
    expect(placeByCode.get("YSU")?.regionCode).toBe("JN");
    expect(placeByCode.get("HNM")?.regionCode).toBe("JN");
    expect(placeByCode.get("TYG")?.regionCode).toBe("GN");
    expect(placeByCode.get("PHG")?.regionCode).toBe("GB");
  });

  test("영문명이 비어 있지 않고 ASCII 다", () => {
    for (const p of PLACES) {
      expect(p.nameEn.length).toBeGreaterThan(0);
      expect(p.nameEn).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  test("sort 는 1..17 연속이며 ICN=1, SEL=2, 이후 스펙 도착지 순서", () => {
    expect(PLACES.map((p) => p.sort)).toEqual(PLACES.map((_, i) => i + 1));
    expect(PLACES[0].code).toBe("ICN");
    expect(PLACES[1].code).toBe("SEL");
    const destOrder = SPEC_13_2.map(([, , d]) => d).filter((d) => d !== "SEL");
    expect(PLACES.slice(2).map((p) => p.code)).toEqual(destOrder);
  });

  test("위경도가 한반도 남부 범위 안이다 (lat 33~39, lng 124~132)", () => {
    for (const p of PLACES) {
      expect(p.lat, p.code).toBeGreaterThan(33);
      expect(p.lat, p.code).toBeLessThan(39);
      expect(p.lng, p.code).toBeGreaterThan(124);
      expect(p.lng, p.code).toBeLessThan(132);
    }
  });
});

// -----------------------------------------------------------------------------
// 2. 스펙 §13.2 픽스처 전량 비교 (행 수만 세지 않는다)
// -----------------------------------------------------------------------------
describe("SHOWCASE_ROUTE_SEED — 스펙 §13.2 와 1:1", () => {
  test("16쌍의 (출발, 도착, price_from, highlight, sort) 가 순서까지 정확히 일치한다", () => {
    const expected = SPEC_13_2.map(([o, , d, , priceFrom, highlight], i) => ({
      originCode: o,
      destinationCode: d,
      priceFrom,
      highlight,
      sort: i + 1,
    }));
    expect([...SHOWCASE_ROUTE_SEED]).toEqual(expected);
  });

  test("highlight 는 인천공항→서울 하나뿐", () => {
    const hl = SHOWCASE_ROUTE_SEED.filter((r) => r.highlight);
    expect(hl).toHaveLength(1);
    expect(hl[0].originCode).toBe("ICN");
    expect(hl[0].destinationCode).toBe("SEL");
  });

  test("모든 출발·도착 코드가 PLACES 에 있고 (출발,도착) 쌍이 유일하다", () => {
    const pairs = new Set<string>();
    for (const r of SHOWCASE_ROUTE_SEED) {
      expect(placeByCode.has(r.originCode)).toBe(true);
      expect(placeByCode.has(r.destinationCode)).toBe(true);
      pairs.add(`${r.originCode}>${r.destinationCode}`);
    }
    expect(pairs.size).toBe(16);
  });
});

// -----------------------------------------------------------------------------
// 3. 0002_places.sql 텍스트 — TS 카탈로그와 한 소스인지 정규식으로 파싱해 대조
// -----------------------------------------------------------------------------
describe("supabase/migrations/0002_places.sql", () => {
  test("파일이 존재한다", () => {
    expect(existsSync(UP_SQL_PATH)).toBe(true);
  });

  test("places 테이블 생성 + 익명 CHECK 동적 drop(pg_constraint) + FK 전환 + RLS 정책", () => {
    const sql = readSql(UP_SQL_PATH);
    expect(sql).toMatch(/create table if not exists places\s*\(/i);
    expect(sql).toMatch(/kind\s+text\s+not null\s+check\s*\(kind in \('airport',\s*'city'\)\)/i);
    expect(sql).toMatch(/pg_constraint/);
    expect(sql).toMatch(/contype\s*=\s*'c'/);
    const fkMatches = sql.match(/references\s+places\s*\(code\)/gi) ?? [];
    expect(fkMatches).toHaveLength(2);
    expect(sql).toMatch(/foreign key \(origin_code\)/i);
    expect(sql).toMatch(/foreign key \(destination_code\)/i);
    expect(sql).toMatch(/alter table places enable row level security/i);
    expect(sql).toMatch(/create policy places_select_active on places\s+for select using \(active\)/i);
  });

  test("업 스크립트는 어떤 테이블도 drop 하지 않고, reservations 를 건드리지 않는다", () => {
    const sql = readSql(UP_SQL_PATH);
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/alter\s+table\s+reservations/i);
    expect(sql).not.toMatch(/alter\s+table\s+showcase_routes\s+drop\s+column/i);
  });

  test("0001 자리표시자 5행을 (출발,도착) 쌍으로 지정해 삭제한다 (전체 삭제 아님)", () => {
    const sql = readSql(UP_SQL_PATH);
    const del = sql.match(/delete\s+from\s+showcase_routes([\s\S]*?);/i);
    expect(del).not.toBeNull();
    const body = del![1];
    expect(body).toMatch(/where/i);
    for (const pair of ["('ICN', 'SEL')", "('SEL', 'BSN')", "('SEL', 'GW')", "('SEL', 'DJN')", "('SEL', 'JB')"]) {
      expect(body).toContain(pair);
    }
  });

  test("places insert 17행이 PLACES × PLACE_POINTS 와 필드 단위로 일치한다", () => {
    const block = insertBlock(readSql(UP_SQL_PATH), "places");
    const rowRe =
      /\(\s*'([A-Z]{3})',\s*'([^']*)',\s*'([^']*)',\s*'(airport|city)',\s*'([A-Z]{2,3})',\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(\d+)\s*\)/g;
    const rows = [...block.matchAll(rowRe)].map((m) => ({
      code: m[1],
      nameKo: m[2],
      nameEn: m[3],
      kind: m[4],
      regionCode: m[5],
      lat: Number(m[6]),
      lng: Number(m[7]),
      svgX: Number(m[8]),
      svgY: Number(m[9]),
      sort: Number(m[10]),
    }));
    const expected = PLACES.map((p) => ({
      code: p.code,
      nameKo: p.nameKo,
      nameEn: p.nameEn,
      kind: p.kind,
      regionCode: p.regionCode,
      lat: p.lat,
      lng: p.lng,
      svgX: PLACE_POINTS[p.code].x,
      svgY: PLACE_POINTS[p.code].y,
      sort: p.sort,
    }));
    expect(rows).toHaveLength(17);
    expect(rows).toEqual(expected);
  });

  test("showcase_routes insert 16행이 스펙 §13.2 픽스처와 값·순서까지 일치한다", () => {
    const block = insertBlock(readSql(UP_SQL_PATH), "showcase_routes");
    const rowRe = /\(\s*'([A-Z]{3})',\s*'([A-Z]{3})',\s*(\d+),\s*(true|false),\s*(\d+)\s*\)/g;
    const rows = [...block.matchAll(rowRe)].map((m) => ({
      originCode: m[1],
      destinationCode: m[2],
      priceFrom: Number(m[3]),
      highlight: m[4] === "true",
      sort: Number(m[5]),
    }));
    const expected = SPEC_13_2.map(([o, , d, , priceFrom, highlight], i) => ({
      originCode: o,
      destinationCode: d,
      priceFrom,
      highlight,
      sort: i + 1,
    }));
    expect(rows).toHaveLength(16);
    expect(rows).toEqual(expected);
    // price_from 은 NULL 없이 16개 전부 리터럴 — 폴백(라벨 숨김) 대상이 아니다.
    expect(block).not.toMatch(/\bnull\b/i);
  });
});

// -----------------------------------------------------------------------------
// 4. 좌표 — 아핀 투영, 앵커 잔차, 지리 상식
// -----------------------------------------------------------------------------
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 3×3 정규방정식 풀이(가우스 소거) — 테스트 안에서만 쓰는 검산용. */
function solveLeastSquares(
  rows: [number, number, number][],
  target: number[],
): [number, number, number] {
  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atb = [0, 0, 0];
  rows.forEach((r, k) => {
    for (let i = 0; i < 3; i++) {
      atb[i] += r[i] * target[k];
      for (let j = 0; j < 3; j++) ata[i][j] += r[i] * r[j];
    }
  });
  const m = ata.map((row, i) => [...row, atb[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

describe("projectLatLng — 위경도 → SVG 아핀 투영", () => {
  test("앵커는 브리프 지정 7개(SEL·BSN·DGU·GWJ·DJN·ICN·GW→강릉시청)이며 place 가 PLACES 에 존재한다", () => {
    expect(PROJECTION_ANCHORS.map((a) => a.region).sort()).toEqual(
      ["SEL", "BSN", "DGU", "GWJ", "DJN", "ICN", "GW"].sort(),
    );
    for (const a of PROJECTION_ANCHORS) expect(placeByCode.has(a.place)).toBe(true);
    expect(PROJECTION_ANCHORS.find((a) => a.region === "GW")?.place).toBe("GNG");
  });

  test("하드코딩된 6계수가 앵커 7점 최소제곱 해와 일치한다 (계수 임의 조정 방지)", () => {
    const rows = PROJECTION_ANCHORS.map((a) => {
      const p = placeByCode.get(a.place)!;
      return [p.lng, p.lat, 1] as [number, number, number];
    });
    const [a, b, c] = solveLeastSquares(
      rows,
      PROJECTION_ANCHORS.map((k) => REGION_POINTS[k.region].x),
    );
    const [d, e, f] = solveLeastSquares(
      rows,
      PROJECTION_ANCHORS.map((k) => REGION_POINTS[k.region].y),
    );
    expect(LATLNG_TO_SVG.a).toBeCloseTo(a, 4);
    expect(LATLNG_TO_SVG.b).toBeCloseTo(b, 4);
    expect(LATLNG_TO_SVG.c).toBeCloseTo(c, 2);
    expect(LATLNG_TO_SVG.d).toBeCloseTo(d, 4);
    expect(LATLNG_TO_SVG.e).toBeCloseTo(e, 4);
    expect(LATLNG_TO_SVG.f).toBeCloseTo(f, 2);
  });

  test("앵커 7개 각각의 잔차 < 3px (실측 REGION_POINTS 대비)", () => {
    for (const a of PROJECTION_ANCHORS) {
      const p = placeByCode.get(a.place)!;
      const proj = projectLatLng(p.lat, p.lng);
      const measured = REGION_POINTS[a.region];
      expect(Math.abs(proj.x - measured.x), `${a.region} x`).toBeLessThan(3);
      expect(Math.abs(proj.y - measured.y), `${a.region} y`).toBeLessThan(3);
    }
  });

  test("경도 증가 → x 증가, 위도 증가 → y 감소 (뒤집힘 없음)", () => {
    const p0 = projectLatLng(36, 127);
    expect(projectLatLng(36, 128).x).toBeGreaterThan(p0.x);
    expect(projectLatLng(37, 127).y).toBeLessThan(p0.y);
  });
});

describe("PLACE_POINTS — 17개 장소 SVG 좌표", () => {
  test("PLACES 17개 전부에 대해 정의되어 있다", () => {
    expect(Object.keys(PLACE_POINTS).sort()).toEqual(PLACES.map((p) => p.code).sort());
  });

  test("모든 좌표가 viewBox(0..524, 0..560) 안이다", () => {
    for (const p of PLACES) {
      const pt = PLACE_POINTS[p.code];
      expect(pt.x, p.code).toBeGreaterThanOrEqual(0);
      expect(pt.x, p.code).toBeLessThanOrEqual(VIEWBOX_W);
      expect(pt.y, p.code).toBeGreaterThanOrEqual(0);
      expect(pt.y, p.code).toBeLessThanOrEqual(VIEWBOX_H);
    }
  });

  test("재사용 6개(ICN·SEL·BSN·DGU·GWJ·DJN)는 기존 REGION_POINTS 값을 그대로 쓴다", () => {
    for (const code of REUSED_REGION_CODES) {
      expect(PLACE_POINTS[code]).toEqual(REGION_POINTS[code]);
    }
  });

  test("새 도시 11개의 좌표는 projectLatLng 계산값(소수 1자리)과 정확히 같다 — 손으로 찍지 않았다", () => {
    const reused = new Set<string>(REUSED_REGION_CODES);
    let checked = 0;
    for (const p of PLACES) {
      if (reused.has(p.code)) continue;
      const proj = projectLatLng(p.lat, p.lng);
      expect(PLACE_POINTS[p.code].x, `${p.code} x`).toBe(round1(proj.x));
      expect(PLACE_POINTS[p.code].y, `${p.code} y`).toBe(round1(proj.y));
      checked++;
    }
    expect(checked).toBe(11);
  });

  test("강릉(GNG)은 기존 GW 핀(354.0, 88.8)과 1px 이내로 겹친다 — 레저 기록의 GW=강릉 확인", () => {
    expect(dist(PLACE_POINTS.GNG, REGION_POINTS.GW)).toBeLessThan(1);
  });

  test("지리 상식: 속초 y < 강릉 y < 태백 y (북→남)", () => {
    expect(PLACE_POINTS.SCH.y).toBeLessThan(PLACE_POINTS.GNG.y);
    expect(PLACE_POINTS.GNG.y).toBeLessThan(PLACE_POINTS.TBK.y);
  });

  test("지리 상식: 부산이 서울보다 오른쪽·아래", () => {
    expect(PLACE_POINTS.BSN.x).toBeGreaterThan(PLACE_POINTS.SEL.x);
    expect(PLACE_POINTS.BSN.y).toBeGreaterThan(PLACE_POINTS.SEL.y);
  });

  test("지리 상식: 세종·대전 거리 < 20px", () => {
    expect(dist(PLACE_POINTS.SJG, PLACE_POINTS.DJN)).toBeLessThan(20);
  });

  test("지리 상식: 홍천은 강릉보다 서쪽, 원주는 홍천보다 남쪽, 해남은 여수보다 남서쪽, 포항은 대구보다 동쪽, 통영은 대구보다 남쪽", () => {
    expect(PLACE_POINTS.HCN.x).toBeLessThan(PLACE_POINTS.GNG.x);
    expect(PLACE_POINTS.WJU.y).toBeGreaterThan(PLACE_POINTS.HCN.y);
    expect(PLACE_POINTS.HNM.x).toBeLessThan(PLACE_POINTS.YSU.x);
    expect(PLACE_POINTS.HNM.y).toBeGreaterThan(PLACE_POINTS.YSU.y);
    expect(PLACE_POINTS.PHG.x).toBeGreaterThan(PLACE_POINTS.DGU.x);
    expect(PLACE_POINTS.TYG.y).toBeGreaterThan(PLACE_POINTS.DGU.y);
  });
});

// -----------------------------------------------------------------------------
// 5. 롤백 스크립트
// -----------------------------------------------------------------------------
describe("supabase/rollbacks/0002_places.down.sql", () => {
  test("migrations/ 안에는 CLI 패턴(<숫자>_<이름>.sql)에 걸리는 롤백 파일이 없다", () => {
    const stray = readdirSync(MIGRATIONS_DIR).filter(
      (f) => /^[0-9]+_.*\.sql$/.test(f) && /\.down\.sql$|rollback/i.test(f),
    );
    expect(stray).toEqual([]);
  });

  test("존재하고, 16행 삭제 → FK 제거 → CHECK(17코드) 복원 → 5행 복원 → places drop 순서다", () => {
    expect(existsSync(DOWN_SQL_PATH)).toBe(true);
    const sql = readSql(DOWN_SQL_PATH);

    const iDelete = sql.search(/delete\s+from\s+showcase_routes/i);
    const iDropFk = sql.search(/drop\s+constraint\s+if\s+exists\s+showcase_routes_origin_code_fkey/i);
    const iCheckO = sql.search(/add\s+constraint\s+showcase_routes_origin_code_check/i);
    const iCheckD = sql.search(/add\s+constraint\s+showcase_routes_destination_code_check/i);
    const iRestore = sql.search(/insert\s+into\s+showcase_routes/i);
    const iDropTbl = sql.search(/drop\s+table\s+if\s+exists\s+places/i);
    for (const i of [iDelete, iDropFk, iCheckO, iCheckD, iRestore, iDropTbl]) {
      expect(i).toBeGreaterThan(-1);
    }
    expect(iDelete).toBeLessThan(iDropFk);
    expect(iDropFk).toBeLessThan(iCheckO);
    expect(iCheckO).toBeLessThan(iCheckD);
    expect(iCheckD).toBeLessThan(iRestore);
    expect(iRestore).toBeLessThan(iDropTbl);

    // CHECK 복원 목록 = 0001 의 17개 시도 코드 그대로
    const compact = sql.replace(/\s+/g, "");
    const checkList = REGIONS.map((c) => `'${c}'`).join(",");
    expect(compact).toContain(`check(origin_codein(${checkList}))`);
    expect(compact).toContain(`check(destination_codein(${checkList}))`);

    // 16쌍 전부 삭제 대상에 명시
    for (const [o, , d] of SPEC_13_2) expect(sql).toContain(`('${o}', '${d}')`);

    // 0001 자리표시자 5행 복원 (price_from NULL)
    for (const row of [
      "('ICN', 'SEL', null, true, 1)",
      "('SEL', 'BSN', null, false, 2)",
      "('SEL', 'GW', null, false, 3)",
      "('SEL', 'DJN', null, false, 4)",
      "('SEL', 'JB', null, false, 5)",
    ]) {
      expect(sql).toContain(row);
    }
  });
});

// =============================================================================
// 6. DB 스모크 — 0002 적용 후 상태. 접속 정보가 있으면 반드시 실행한다.
//    (schema.test.ts 의 옛 "5행·price NULL" 단언은 0002 로 무효가 되어 이쪽으로 이관)
// =============================================================================
const env = dbSmokeEnv();
const headers = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` };

// 0002 적용 여부를 suite 정의 전에 확인한다(vitest 는 테스트 파일 최상위 await 를 지원).
// - CI(REQUIRE_DB_TESTS=1): 미적용이면 아래 beforeAll 이 원인을 명시하고 실패한다 — skip 으로 숨기지 않는다.
// - 로컬(.env.local = 원격 라이브 DB): 컨트롤러가 0002 를 push 하기 전까지는 경고만 내고 skip 한다.
//   schema.test.ts 와 같은 정책이다. 원격에 0002 가 들어가는 순간 같은 명령이 실증이 된다.
const requireDb = process.env.REQUIRE_DB_TESTS === "1";
const applied0002 = env.hasServiceRole
  ? await fetch(`${env.restRoot}/places?select=code&limit=1`, { headers }).then((r) => r.ok, () => false)
  : false;
if (env.hasServiceRole && !applied0002 && !requireDb) {
  console.warn(
    `[places.test] 0002_places.sql 미적용 DB(${process.env.NEXT_PUBLIC_SUPABASE_URL}) — DB 스모크를 skip 한다. ` +
      "컨트롤러가 supabase db push 로 적용하면 실행된다. CI 는 REQUIRE_DB_TESTS=1 로 skip 을 막는다.",
  );
}

describe.skipIf(!env.hasServiceRole || (!applied0002 && !requireDb))(
  "DB smoke — places / showcase_routes (0002 적용 후)",
  () => {
  // 아래 16행 대조는 표 전체를 본다 — 시드 행을 잠시 바꾸는 블록(admin-routes · write-privileges §5)과 겹치면
  // 되돌리기 전 값(WJU price_from=null 등)을 읽는다(P6-12 전량 실행에서 관측 · P6-13 재현). 같은 잠금으로 줄 세운다.
  withShowcaseRoutesLock();

  // 전제조건: 0002 가 적용돼 places 테이블이 있어야 한다. 없으면(PostgREST 404) 아래 세
  // 테스트가 알아보기 어려운 diff 로 실패하는 대신, 여기서 원인을 명시하고 실패한다.
  // (위 skipIf 때문에 여기 도달하는 미적용 상황은 REQUIRE_DB_TESTS=1 뿐이다.)
  beforeAll(async () => {
    const res = await fetch(`${env.restRoot}/places?select=code&limit=1`, { headers });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      throw new Error(
        `0002_places.sql 이 이 DB(${process.env.NEXT_PUBLIC_SUPABASE_URL})에 적용되지 않은 것으로 보인다 — ` +
          `places 조회 HTTP ${res.status}: ${body}. 원격이면 컨트롤러가 supabase db push 로 적용한 뒤 재실행, ` +
          "CI(db-test)라면 supabase db reset 단계를 확인할 것.",
      );
    }
  });

  test("places 17행, 코드·kind·region_code·좌표가 PLACES 와 일치", async () => {
    const res = await fetch(
      `${env.restRoot}/places?select=code,name_ko,name_en,kind,region_code,lat,lng,svg_x,svg_y,sort,active&order=sort.asc`,
      { headers },
    );
    expect(res.ok).toBe(true);
    const rows = (await res.json()) as {
      code: PlaceCode;
      name_ko: string;
      name_en: string;
      kind: string;
      region_code: string;
      lat: number;
      lng: number;
      svg_x: number;
      svg_y: number;
      sort: number;
      active: boolean;
    }[];
    expect(
      rows.map((r) => ({
        code: r.code,
        nameKo: r.name_ko,
        nameEn: r.name_en,
        kind: r.kind,
        regionCode: r.region_code,
        lat: r.lat,
        lng: r.lng,
        sort: r.sort,
      })),
    ).toEqual(
      PLACES.map((p) => ({
        code: p.code,
        nameKo: p.nameKo,
        nameEn: p.nameEn,
        kind: p.kind,
        regionCode: p.regionCode,
        lat: p.lat,
        lng: p.lng,
        sort: p.sort,
      })),
    );
    for (const r of rows) {
      expect(r.active).toBe(true);
      expect(r.svg_x).toBe(PLACE_POINTS[r.code].x);
      expect(r.svg_y).toBe(PLACE_POINTS[r.code].y);
    }
  });

  test("showcase_routes 16행이 스펙 §13.2 픽스처와 일치 (자리표시자 5행 소멸)", async () => {
    const res = await fetch(
      `${env.restRoot}/showcase_routes?select=origin_code,destination_code,price_from,highlight,sort,active&order=sort.asc`,
      { headers },
    );
    expect(res.ok).toBe(true);
    const rows = (await res.json()) as {
      origin_code: string;
      destination_code: string;
      price_from: number | null;
      highlight: boolean;
      sort: number;
      active: boolean;
    }[];
    expect(
      rows.map((r) => ({
        originCode: r.origin_code,
        destinationCode: r.destination_code,
        priceFrom: r.price_from,
        highlight: r.highlight,
        sort: r.sort,
      })),
    ).toEqual([...SHOWCASE_ROUTE_SEED]);
    for (const r of rows) expect(r.active).toBe(true);
  });

  test.skipIf(!env.anonKey)("RLS: anon 키로 places 활성 행 17개를 읽을 수 있다", async () => {
    const anon = env.anonKey as string;
    const res = await fetch(`${env.restRoot}/places?select=code`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    expect(res.ok).toBe(true);
    const rows = (await res.json()) as unknown[];
    expect(rows).toHaveLength(17);
  });
});

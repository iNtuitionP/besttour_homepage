/**
 * OF3-G — 견적 출발지·도착지: 시·도 → 시·군·구 두 단 선택.
 *
 * 잠그는 것
 *   1. 데이터(lib/codes-sigungu.ts) — 행안부 법정동코드 시군구 5자리 · 일반구·세종 제외 · 중복 0 · 출처·기준일·행 수 주석
 *   2. 호환 — 옛 코드(시도·대표 노선 도시 16개) 전부 계속 유효, 대표 도시를 고르면 옛 코드로 저장
 *   3. 검증 — isLocationCode · zod(접수 스키마)가 새 코드를 받고 모르는 코드는 거부
 *   4. 표시 — locationLabel "경기 수원시" · en 은 시·도까지(공식 영문 표기 자료가 없다)
 *   5. 두 단 선택 — 순수 함수(splitLocation · sigunguOptions · pickedCode)와 렌더(ko·en)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { LocationSelect } from "@/components/home/LocationSelect";
import {
  LEGACY_CITY_BY_SIGUNGU,
  LOCATION_CODES,
  LOCATION_TOP_LEVEL,
  PLACES,
  REGIONS,
  REGION_LABELS_KO,
  SHOWCASE_ROUTE_SEED,
  isLocationCode,
  locationLabel,
  locationLabelEn,
  locationLabelKo,
  locationRegion,
  pickedCode,
  sigunguOptions,
  splitLocation,
} from "@/lib/codes";
import { SIGUNGU } from "@/lib/codes-sigungu";
import { QuickReservationShape } from "@/lib/types";

const HANGUL = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("1. 데이터 — lib/codes-sigungu.ts", () => {
  test("행 수 229 · 코드 5자리 숫자 · 중복 0 · 코드순 정렬", () => {
    expect(SIGUNGU).toHaveLength(229);
    const codes = SIGUNGU.map((r) => r[0]);
    expect(new Set(codes).size).toBe(229);
    for (const c of codes) expect(c, c).toMatch(/^\d{5}$/);
    expect(codes).toEqual([...codes].sort());
  });

  test("모든 행에 시·도 코드(REGIONS) · 한글 이름이 있다 · 같은 시·도 안에서 이름 중복 0", () => {
    const seen = new Set<string>();
    for (const [code, region, ko] of SIGUNGU) {
      expect(REGIONS as readonly string[], code).toContain(region);
      expect(region, code).not.toBe("ICN"); // 공항은 하위 없음
      expect(ko.trim(), code).not.toBe("");
      expect(ko, code).toMatch(HANGUL);
      expect(ko, `${code} — 시·도 이름이 섞이면 안 된다`).not.toMatch(/(특별|광역|자치)|도$/);
      const key = `${region}|${ko}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  test("일반구(41111 장안구 · 43111 상당구 …)와 세종(36110)은 들어 있지 않다 — 시 단위(41110 수원시)만", () => {
    const codes = new Set(SIGUNGU.map((r) => r[0]));
    for (const gu of ["41111", "41113", "41115", "41117", "43111", "44131", "47111", "48121", "52111"]) expect(codes.has(gu), gu).toBe(false);
    for (const si of ["41110", "43110", "44130", "47110", "48120", "52110"]) expect(codes.has(si), si).toBe(true);
    expect(codes.has("36110")).toBe(false);
    // 일반구 이름("…시 …구")이 이름 칸에 섞이지 않는다
    for (const [code, , ko] of SIGUNGU) expect(ko, code).not.toMatch(/\s/);
  });

  test("시·도별 개수 — 서울 25 · 부산 16 · 대구 9 · 경기 31 · 강원 18 · 제주 2", () => {
    const count = (r: string) => SIGUNGU.filter((x) => x[1] === r).length;
    expect(count("SEL")).toBe(25);
    expect(count("BSN")).toBe(16);
    expect(count("DGU")).toBe(9);
    expect(count("GG")).toBe(31);
    expect(count("GW")).toBe(18);
    expect(count("JJ")).toBe(2);
    // 2026 년 통합된 광주·전남 — 법정동코드는 한 시·도(12) 아래지만 화면은 기존 광주·전남 두 곳으로 가른다
    expect(count("GWJ")).toBe(5);
    expect(count("JN")).toBe(22);
  });

  test("출처 URL · 기준일 · 행 수가 파일 머리 주석에 있다(창작 금지 규약)", () => {
    const src = read("lib/codes-sigungu.ts");
    expect(src).toContain("https://www.code.go.kr");
    expect(src).toMatch(/2026-10-22/);
    expect(src).toMatch(/20,?560/); // 받은 법정동코드 전체 행 수
    expect(src).toContain("229");
    // 영문 표기 미확보 — 임시값이 아니라 "영문은 시·도까지만" 이 확정 동작이다(컨트롤러 결정 2026-10-22). 결정 문장이 남아 있어야 한다.
    expect(src).toContain("영문 화면은 시·도까지만 보인다");
  });
});

describe("2. 호환 — 옛 코드는 계속 유효, 대표 도시는 옛 코드로 저장", () => {
  test("LOCATION_CODES(28)는 그대로 · 전부 isLocationCode", () => {
    expect(LOCATION_CODES).toHaveLength(28);
    for (const c of LOCATION_CODES) expect(isLocationCode(c), c).toBe(true);
  });

  test("대표 노선 도시 10개 매핑 — 옛 코드·시·도·이름이 시군구 표와 맞는다", () => {
    const cityCodes = PLACES.filter((p) => p.kind === "city" && !(REGIONS as readonly string[]).includes(p.code) && p.code !== "SJG").map((p) => p.code);
    expect(cityCodes.sort()).toEqual(["GNG", "HCN", "HNM", "JJU", "PHG", "SCH", "TBK", "TYG", "WJU", "YSU"]);
    expect(Object.values(LEGACY_CITY_BY_SIGUNGU).sort()).toEqual(cityCodes);
    const rowOf = new Map(SIGUNGU.map((r) => [r[0], r]));
    for (const [code, legacy] of Object.entries(LEGACY_CITY_BY_SIGUNGU)) {
      const row = rowOf.get(code);
      expect(row, code).toBeDefined();
      const place = PLACES.find((p) => p.code === legacy)!;
      expect(row![1], `${legacy} 의 시·도`).toBe(place.regionCode);
      expect(row![2], `${legacy} 의 이름`).toBe(`${place.nameKo}${row![2].slice(-1)}`); // 통영 → 통영시 · 해남 → 해남군
      expect(/[시군]$/.test(row![2]), legacy).toBe(true);
    }
  });

  test("대표 노선 16쌍의 도착지는 두 단 선택에서 같은 코드로 다시 고를 수 있다", () => {
    for (const seed of SHOWCASE_ROUTE_SEED) {
      for (const code of [seed.originCode, seed.destinationCode]) {
        const { region, sigungu } = splitLocation(code);
        expect(LOCATION_TOP_LEVEL as readonly string[], code).toContain(region);
        expect(pickedCode(region, sigungu), code).toBe(code);
        if (sigungu !== "") expect(sigunguOptions(region, "ko").map((o) => o.value), code).toContain(code);
      }
    }
  });
});

describe("3. 검증 — 서버가 새 코드를 받는다", () => {
  test("isLocationCode — 시군구 229개 전부 true · 모르는 코드·번역 문자열·공백은 false", () => {
    for (const [code] of SIGUNGU) expect(isLocationCode(code), code).toBe(true);
    for (const bad of ["99999", "11111", "36110", "1111", "111100", " 41110", "41110 ", "수원시", "경기 수원시", "sel", "", "41110x", "00000"]) {
      expect(isLocationCode(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  test("접수 스키마(zod) — 시군구 코드를 출발·도착으로 받는다, 모르는 코드는 거부", () => {
    const shape = QuickReservationShape.shape;
    expect(shape.originCode.safeParse("41110").success).toBe(true);
    expect(shape.destinationCode.safeParse("11680").success).toBe(true);
    expect(shape.originCode.safeParse("TYG").success).toBe(true);
    expect(shape.originCode.safeParse("ICN").success).toBe(true);
    expect(shape.originCode.safeParse("99999").success).toBe(false);
    expect(shape.destinationCode.safeParse("수원시").success).toBe(false);
    expect(shape.destinationCode.safeParse("").success).toBe(false);
  });
});

describe("4. 표시 — locationLabel", () => {
  test("ko — 시·도 + 시·군·구 ('경기 수원시' · '서울 강남구' · '광주 동구' · '전남 목포시')", () => {
    expect(locationLabelKo("41110")).toBe("경기 수원시");
    expect(locationLabelKo("11680")).toBe("서울 강남구");
    expect(locationLabelKo("12210")).toBe("광주 동구");
    expect(locationLabelKo("12110")).toBe("전남 목포시");
    expect(locationLabel("26350", "ko")).toBe("부산 해운대구");
  });

  test("옛 코드의 표시는 그대로(통영 · 서울 · 경기)", () => {
    expect(locationLabelKo("TYG")).toBe("통영");
    expect(locationLabelKo("SEL")).toBe("서울");
    expect(locationLabelKo("GG")).toBe("경기");
  });

  test("en — 공식 영문 표기 자료가 없어 시·도까지만(한글 0)", () => {
    expect(locationLabelEn("41110")).toBe("Gyeonggi");
    expect(locationLabel("11680", "en")).toBe("Seoul");
    for (const [code] of SIGUNGU) expect(locationLabel(code as never, "en"), code).not.toMatch(HANGUL);
  });

  test("모든 시군구 라벨은 비어 있지 않고 짧다(문자 길이) — 가장 긴 것 ≤ 12자", () => {
    let longest = "";
    for (const [code] of SIGUNGU) {
      const label = locationLabelKo(code as never);
      expect(label.trim(), code).not.toBe("");
      if (label.length > longest.length) longest = label;
    }
    expect(longest.length, longest).toBeLessThanOrEqual(12);
  });

  test("locationRegion — 시군구는 소속 시·도(RegionCode)", () => {
    expect(locationRegion("41110" as never)).toBe("GG");
    expect(locationRegion("12130" as never)).toBe("JN");
    expect(locationRegion("12330" as never)).toBe("GWJ");
    for (const [code] of SIGUNGU) expect(REGIONS as readonly string[]).toContain(locationRegion(code as never));
  });
});

describe("5. 두 단 선택 — 순수 함수", () => {
  test("LOCATION_TOP_LEVEL — 인천공항 + 시·도 17곳(세종 포함), 라벨이 모두 있다", () => {
    expect(LOCATION_TOP_LEVEL).toHaveLength(18);
    expect(LOCATION_TOP_LEVEL[0]).toBe("ICN");
    expect(LOCATION_TOP_LEVEL).toContain("SJG");
    expect(new Set(LOCATION_TOP_LEVEL).size).toBe(18);
    for (const code of LOCATION_TOP_LEVEL) {
      expect(isLocationCode(code), code).toBe(true);
      expect(locationLabel(code, "ko").trim(), code).not.toBe("");
      expect(locationLabel(code, "en"), code).not.toMatch(HANGUL);
    }
    for (const r of REGIONS) expect(LOCATION_TOP_LEVEL as readonly string[]).toContain(r);
  });

  test("splitLocation — 시군구 · 대표 도시 · 시도 · 세종 · 공항", () => {
    expect(splitLocation("41110")).toEqual({ region: "GG", sigungu: "41110" });
    expect(splitLocation("TYG")).toEqual({ region: "GN", sigungu: "TYG" });
    expect(splitLocation("YSU")).toEqual({ region: "JN", sigungu: "YSU" });
    expect(splitLocation("SEL")).toEqual({ region: "SEL", sigungu: "" });
    expect(splitLocation("GG")).toEqual({ region: "GG", sigungu: "" });
    expect(splitLocation("SJG")).toEqual({ region: "SJG", sigungu: "" });
    expect(splitLocation("ICN")).toEqual({ region: "ICN", sigungu: "" });
    expect(splitLocation("12210")).toEqual({ region: "GWJ", sigungu: "12210" });
  });

  test("sigunguOptions(ko) — 도→시·군 · 특별·광역시→자치구·군 · 세종·공항은 없음 · 대표 도시는 옛 코드 값", () => {
    expect(sigunguOptions("SEL", "ko")).toHaveLength(25);
    expect(sigunguOptions("GG", "ko")).toHaveLength(31);
    expect(sigunguOptions("SJG", "ko")).toEqual([]);
    expect(sigunguOptions("ICN", "ko")).toEqual([]);
    const gn = sigunguOptions("GN", "ko");
    expect(gn).toContainEqual({ value: "TYG", label: "통영시" });
    expect(gn).toContainEqual({ value: "48120", label: "창원시" });
    expect(gn.map((o) => o.value)).not.toContain("48220");
    expect(gn).toHaveLength(18);
    // 값은 전부 유효한 코드이고 소속 시·도로 되돌아온다
    for (const region of LOCATION_TOP_LEVEL) {
      for (const o of sigunguOptions(region, "ko")) {
        expect(isLocationCode(o.value), o.value).toBe(true);
        expect(splitLocation(o.value).region, o.value).toBe(region);
        expect(o.label.trim()).not.toBe("");
      }
    }
    // 시군구 229개가 한 번씩 모두 어느 시·도 아래에 나온다(옛 코드로 바뀐 10개 포함)
    const all = LOCATION_TOP_LEVEL.flatMap((r) => sigunguOptions(r, "ko").map((o) => o.value));
    expect(all).toHaveLength(229);
    expect(new Set(all).size).toBe(229);
  });

  test("sigunguOptions(en) — 영문 표기가 없으므로 비어 있다(시·도까지만)", () => {
    for (const region of LOCATION_TOP_LEVEL) expect(sigunguOptions(region, "en"), region).toEqual([]);
  });

  test("pickedCode — 시군구를 골랐으면 그 코드, '전체'(빈 값)면 시·도 코드", () => {
    expect(pickedCode("GG", "41110")).toBe("41110");
    expect(pickedCode("GG", "")).toBe("GG");
    expect(pickedCode("GN", "TYG")).toBe("TYG");
    expect(pickedCode("SJG", "")).toBe("SJG");
  });
});

describe("6. 두 단 선택 — 렌더", () => {
  const regionsOf = (locale: string) => [
    { label: locale === "en" ? "Airport" : "공항", options: [{ value: "ICN", label: locationLabel("ICN", locale) }] },
    { label: locale === "en" ? "Regions" : "시도", options: LOCATION_TOP_LEVEL.filter((c) => c !== "ICN").map((c) => ({ value: c, label: locationLabel(c, locale) })) },
  ];
  const render = (locale: string, value: string) =>
    renderToStaticMarkup(
      createElement(LocationSelect, {
        id: "q-originCode",
        fieldLabel: locale === "en" ? "From" : "출발지",
        value,
        onChange: () => {},
        groups: regionsOf(locale),
        locale,
        labels: { sigungu: locale === "en" ? "City / county / district" : "시·군·구", all: locale === "en" ? "All" : "전체" },
        testId: "quote-origin",
      } as never),
    );
  const selects = (html: string) => [...html.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/g)];

  test("ko · 시도 코드(GG) — 시·도 select 가 먼저, 시·군·구 select 가 '전체' + 31곳 · 전체가 선택됨", () => {
    const html = render("ko", "GG");
    const s = selects(html);
    expect(s).toHaveLength(2);
    expect(html).toMatch(/<select[^>]*id="q-originCode"[^>]*data-testid="quote-origin"|<select[^>]*data-testid="quote-origin"[^>]*id="q-originCode"/);
    expect(html).toMatch(/<option value="GG" selected="">/);
    expect(html).toMatch(/data-testid="quote-origin-sigungu"/);
    expect(s[1][1].match(/<option /g)).toHaveLength(32);
    expect(s[1][1]).toMatch(/<option value="" selected="">전체<\/option>/);
    expect(s[1][1]).toContain(">수원시<");
  });

  test("ko · 시군구 코드(41110) — 시·도 칸은 경기, 시·군·구 칸은 수원시가 선택된다", () => {
    const html = render("ko", "41110");
    expect(html).toMatch(/<option value="GG" selected="">/);
    expect(html).toMatch(/<option value="41110" selected="">수원시<\/option>/);
  });

  test("ko · 대표 도시 옛 코드(TYG) — 경남 · 통영시가 선택된다", () => {
    const html = render("ko", "TYG");
    expect(html).toMatch(/<option value="GN" selected="">/);
    expect(html).toMatch(/<option value="TYG" selected="">통영시<\/option>/);
  });

  test("ko · 세종(SJG) · 인천공항(ICN) — 시·군·구 칸이 없다", () => {
    for (const code of ["SJG", "ICN"]) {
      const html = render("ko", code);
      expect(selects(html), code).toHaveLength(1);
      expect(html).not.toContain("quote-origin-sigungu");
    }
  });

  test("en — 시·군·구 칸이 없고(시·도까지만) 한글이 한 글자도 없다", () => {
    for (const code of ["GG", "41110", "TYG", "SEL", "ICN"]) {
      const html = render("en", code);
      expect(selects(html), code).toHaveLength(1);
      expect(html, code).not.toMatch(HANGUL);
      expect(html).not.toContain("quote-origin-sigungu");
    }
    // 시군구 코드는 en 에서도 소속 시·도로 선택돼 보인다
    expect(render("en", "41110")).toMatch(/<option value="GG" selected="">Gyeonggi<\/option>/);
  });

  test("지역 목록 라벨은 시·도 라벨표와 같다(REGION_LABELS_KO)", () => {
    const html = render("ko", "SEL");
    for (const r of REGIONS) expect(html).toContain(`>${REGION_LABELS_KO[r]}<`);
    expect(html).toContain(">세종<");
  });
});

describe("7. 정적 잠금", () => {
  test("Hero 는 두 단 선택용 시·도 묶음을 만들고, 위젯은 LocationSelect 를 쓴다", () => {
    expect(read("components/home/Hero.tsx")).toMatch(/LOCATION_TOP_LEVEL/);
    const w = read("components/home/QuoteWidget.tsx");
    expect(w).toMatch(/<LocationSelect/);
    expect(w).toContain('testId="quote-origin"');
    expect(w).toContain('testId="quote-dest"');
  });

  test("데이터 파일은 데이터 전용 — import · 함수 선언 0", () => {
    const src = read("lib/codes-sigungu.ts");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\bfunction\b|=>/);
  });
});

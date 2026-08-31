import { describe, expect, test } from "vitest";
import { REGIONS } from "@/lib/codes";
import {
  REGION_POINTS,
  REGION_LABEL_ANCHOR,
  routePath,
  routeGeometry,
} from "@/lib/map-coords";

const VIEWBOX_W = 524;
const VIEWBOX_H = 560;

// 앵커 6개 실측값 (mockups/variant-08-map-hero.html, viewBox 0 0 524 560)
const MEASURED_ANCHORS: Record<string, { x: number; y: number }> = {
  SEL: { x: 196.4, y: 107.9 },
  ICN: { x: 151.8, y: 118.9 },
  BSN: { x: 370.6, y: 354.5 },
  GW: { x: 354.0, y: 88.8 },
  DJN: { x: 230.1, y: 233.6 },
  JB: { x: 210.5, y: 287.9 },
};

describe("REGION_POINTS", () => {
  test("REGIONS 17개를 빠짐없이 포함한다", () => {
    for (const code of REGIONS) {
      expect(REGION_POINTS[code]).toBeDefined();
    }
    expect(Object.keys(REGION_POINTS).sort()).toEqual([...REGIONS].sort());
  });

  test("모든 좌표가 viewBox 범위 내에 있다 (0..524, 0..560)", () => {
    for (const code of REGIONS) {
      const p = REGION_POINTS[code];
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(VIEWBOX_W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(VIEWBOX_H);
    }
  });

  test("앵커 6개는 실측값과 정확히 일치한다", () => {
    for (const [code, expected] of Object.entries(MEASURED_ANCHORS)) {
      const p = REGION_POINTS[code as keyof typeof REGION_POINTS];
      expect(p.x).toBe(expected.x);
      expect(p.y).toBe(expected.y);
    }
  });

  test("지리 상식: 서울이 부산보다 위쪽(y가 작음)", () => {
    expect(REGION_POINTS.SEL.y).toBeLessThan(REGION_POINTS.BSN.y);
  });

  test("지리 상식: 제주가 최남단(부산보다 y가 큼)", () => {
    expect(REGION_POINTS.JJ.y).toBeGreaterThan(REGION_POINTS.BSN.y);
  });

  test("지리 상식: 부산이 서울보다 동쪽(x가 큼)", () => {
    expect(REGION_POINTS.BSN.x).toBeGreaterThan(REGION_POINTS.SEL.x);
  });
});

describe("REGION_LABEL_ANCHOR", () => {
  test("REGIONS 17개 전부에 대해 정의되어 있다", () => {
    for (const code of REGIONS) {
      expect(["start", "middle", "end"]).toContain(REGION_LABEL_ANCHOR[code]);
    }
  });
});

describe("routePath", () => {
  test("M으로 시작하고 Q를 포함하며 NaN이 없다", () => {
    const d = routePath("ICN", "SEL");
    expect(d.startsWith("M")).toBe(true);
    expect(d).toContain("Q");
    expect(d).not.toContain("NaN");
  });

  test("동일 지역이어도 NaN 없이 유효한 path를 반환한다", () => {
    const d = routePath("SEL", "SEL");
    expect(d).not.toContain("NaN");
    expect(d.startsWith("M")).toBe(true);
  });

  test("curvature가 클수록 제어점이 직선에서 더 멀어진다 (곡률 반영)", () => {
    const small = routePath("ICN", "BSN", 0.1);
    const large = routePath("ICN", "BSN", 0.4);
    expect(small).not.toBe(large);
  });
});

describe("routeGeometry", () => {
  test("빈 배열이면 pins 0, paths 0", () => {
    const g = routeGeometry([]);
    expect(g.pins).toHaveLength(0);
    expect(g.paths).toHaveLength(0);
  });

  test("노선 3개(공유 지역 포함)면 pins는 중복 제거되어 4개, paths는 3개", () => {
    const g = routeGeometry([
      { originCode: "ICN", destinationCode: "SEL" },
      { originCode: "SEL", destinationCode: "BSN" },
      { originCode: "SEL", destinationCode: "GW" },
    ]);
    expect(g.pins).toHaveLength(4);
    expect(g.pins.map((p) => p.code).sort()).toEqual(
      ["ICN", "SEL", "BSN", "GW"].sort(),
    );
    expect(g.paths).toHaveLength(3);
    for (const path of g.paths) {
      expect(path.d.startsWith("M")).toBe(true);
      expect(path.d).not.toContain("NaN");
    }
  });
});

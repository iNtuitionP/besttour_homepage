import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 디자인 토큰 계약 테스트 (P0-3)
 *
 * 브랜드 실측 3색(docs/brand/README.md, 2026-09-06 가이드 스와치 픽셀 측정)이
 * 원시 토큰에 정확히 살아 있고, 의미 토큰이 WCAG 2.x AA 를 만족하는지 기계적으로 검증한다.
 *
 * 대비비는 이 파일 안에서 WCAG 2.x 상대휘도 공식으로 직접 계산한다.
 * 외부 표를 인용하거나 눈으로 판정하지 않는다.
 */

// ── 측정치 (재계산 금지, 그대로 사용) ──────────────────────────────
const MAIN = "#6F1C7C"; // PANTONE 2614 C
const SUB = "#C8A359"; // PANTONE 461 C — 텍스트 금지
const POINT = "#7B7A7A"; // PANTONE COOL GRAY 9 C — 본문 텍스트 금지 (4.28:1)

const WHITE = "#FFFFFF";

const ROOT = path.resolve(import.meta.dirname, "..");
const tokensCss = readFileSync(path.join(ROOT, "styles/tokens.css"), "utf8");
const semanticCss = readFileSync(path.join(ROOT, "styles/semantic.css"), "utf8");

// ── CSS 파싱 (정규식 — 새 패키지 설치 금지) ────────────────────────
/** 주석을 제거한 뒤 `--name: value;` 선언을 전부 뽑는다. */
function parseCustomProps(css: string): Map<string, string> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map<string, string>();
  const re = /(--[A-Za-z0-9-]+)\s*:\s*([^;}]+)[;}]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

const tokens = parseCustomProps(tokensCss);
const semantic = parseCustomProps(semanticCss);

/** var(--x) 를 tokens/semantic 양쪽에서 끝까지 풀어 최종 리터럴을 만든다. */
function resolve(value: string, depth = 0): string {
  if (depth > 12) throw new Error(`var() 순환 참조: ${value}`);
  const m = /^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,[^)]*)?\)$/.exec(value.trim());
  if (!m) return value.trim();
  const next = tokens.get(m[1]) ?? semantic.get(m[1]);
  if (next === undefined) throw new Error(`정의되지 않은 토큰: ${m[1]}`);
  return resolve(next, depth + 1);
}

function resolved(name: string): string {
  const raw = semantic.get(name) ?? tokens.get(name);
  if (raw === undefined) throw new Error(`토큰 없음: ${name}`);
  return resolve(raw);
}

// ── WCAG 2.x 상대휘도 · 대비비 ────────────────────────────────────
function toRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`hex 아님: ${hex}`);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG 2.x 상대휘도: L = 0.2126R + 0.7152G + 0.0722B (선형화 후) */
function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x 대비비: (L1 + 0.05) / (L2 + 0.05) */
function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 텍스트 역할 토큰인가 — 이름 규약으로 판정 */
function isTextRole(name: string): boolean {
  return /^--text-/.test(name) || /-fg$/.test(name) || /-text$/.test(name);
}

// ── 대비비 계산기 자체의 자기검증 ─────────────────────────────────
describe("대비비 계산기 (WCAG 2.x)", () => {
  it("흑백 대비는 21:1", () => {
    expect(round2(contrast("#000000", WHITE))).toBe(21);
  });

  it("동일색 대비는 1:1", () => {
    expect(round2(contrast(MAIN, MAIN))).toBe(1);
  });

  it("측정 문서에 적힌 SUB·POINT 대비값을 재현한다", () => {
    // docs/brand/README.md 의 2.38 / 4.28 과 일치해야 공식이 옳다는 증거가 된다.
    expect(round2(contrast(SUB, WHITE))).toBe(2.38);
    expect(round2(contrast(POINT, WHITE))).toBe(4.28);
  });
});

// ── 1~2. 측정치 보존 ──────────────────────────────────────────────
describe("브랜드 실측 3색이 원시 토큰에 그대로 있다", () => {
  it("--brand-* 스케일에 #6F1C7C 가 정확히 존재한다", () => {
    const brandScale = [...tokens.entries()].filter(([k]) => /^--brand-\d+$/.test(k));
    expect(brandScale.length).toBeGreaterThanOrEqual(5);
    const hexes = brandScale.map(([, v]) => v.toUpperCase());
    expect(hexes).toContain(MAIN);
  });

  it("--gold 가 정확히 #C8A359 다", () => {
    expect(resolved("--gold").toUpperCase()).toBe(SUB);
  });

  it("--gray 가 정확히 #7B7A7A 다", () => {
    expect(resolved("--gray").toUpperCase()).toBe(POINT);
  });

  it("퍼플 스케일이 요구 단계를 갖춘다 (어두운 면 · 기준색 · 밝은 틴트 2 · 페이지 배경)", () => {
    for (const step of ["--brand-950", "--brand-700", "--brand-200", "--brand-100", "--brand-50"]) {
      expect(tokens.has(step), `${step} 누락`).toBe(true);
    }
    // 밝은 → 어두운 순으로 휘도가 단조 감소해야 스케일이라 부를 수 있다
    const ordered = ["--brand-50", "--brand-100", "--brand-200", "--brand-300", "--brand-500", "--brand-600", "--brand-700", "--brand-800", "--brand-900", "--brand-950"]
      .filter((k) => tokens.has(k))
      .map((k) => relativeLuminance(resolved(k)));
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i], `스케일 ${i} 단계가 단조 감소하지 않음`).toBeLessThan(ordered[i - 1]);
    }
  });
});

// ── 3~5. 대비 게이트 ──────────────────────────────────────────────
describe("WCAG AA 대비 게이트", () => {
  it("--text-primary 는 --bg-page 위에서 ≥ 4.5:1", () => {
    const r = contrast(resolved("--text-primary"), resolved("--bg-page"));
    expect(round2(r)).toBeGreaterThanOrEqual(4.5);
  });

  it("--text-secondary 는 --bg-page 위에서 ≥ 4.5:1", () => {
    const r = contrast(resolved("--text-secondary"), resolved("--bg-page"));
    expect(round2(r)).toBeGreaterThanOrEqual(4.5);
  });

  it("--gray-text 는 흰 배경에서 ≥ 4.5:1 (POINT 4.28:1 의 대체재)", () => {
    const r = contrast(resolved("--gray-text"), WHITE);
    expect(round2(r)).toBeGreaterThanOrEqual(4.5);
  });

  it("--gray-text 는 --gray(#7B7A7A) 보다 실제로 어둡다", () => {
    expect(relativeLuminance(resolved("--gray-text"))).toBeLessThan(relativeLuminance(POINT));
  });

  it("--border-subtle 은 --bg-page 위에서 ≥ 3:1 (UI 요소 기준)", () => {
    const r = contrast(resolved("--border-subtle"), resolved("--bg-page"));
    expect(round2(r)).toBeGreaterThanOrEqual(3);
  });

  it("--action-primary-fg 는 --action-primary-bg 위에서 ≥ 4.5:1", () => {
    const r = contrast(resolved("--action-primary-fg"), resolved("--action-primary-bg"));
    expect(round2(r)).toBeGreaterThanOrEqual(4.5);
  });

  it("어두운 면 위 텍스트 2종이 --bg-inverse 위에서 ≥ 4.5:1", () => {
    const bg = resolved("--bg-inverse");
    expect(round2(contrast(resolved("--text-on-inverse"), bg))).toBeGreaterThanOrEqual(4.5);
    expect(round2(contrast(resolved("--text-secondary-on-inverse"), bg))).toBeGreaterThanOrEqual(4.5);
  });
});

// ── 6~7. 금지색이 텍스트 역할에 새지 않는다 ────────────────────────
describe("텍스트 역할 토큰에 AA 미달색이 쓰이지 않는다", () => {
  const textRoles = [...semantic.keys()].filter(isTextRole);

  it("텍스트 역할 토큰이 실제로 존재한다 (빈 배열 통과 방지)", () => {
    expect(textRoles.length).toBeGreaterThanOrEqual(3);
  });

  it("#7B7A7A(POINT) 가 어떤 텍스트 역할 토큰에도 쓰이지 않는다", () => {
    for (const name of textRoles) {
      expect(resolved(name).toUpperCase(), `${name} 가 POINT 그레이를 텍스트로 쓴다`).not.toBe(POINT);
    }
  });

  it("#C8A359(SUB 골드) 가 어떤 텍스트 역할 토큰에도 쓰이지 않는다", () => {
    for (const name of textRoles) {
      expect(resolved(name).toUpperCase(), `${name} 가 골드를 텍스트로 쓴다`).not.toBe(SUB);
    }
  });

  /**
   * 전경/배경 짝은 이름 규칙으로 추측하지 않고 명시한다.
   * (`--action-secondary-fg` 를 기본 버튼 배경에 대고 재는 식의 엉뚱한 판정을 막는다.)
   */
  const FG_BG_PAIRS: Array<[fg: string, bg: string]> = [
    ["--text-primary", "--bg-page"],
    ["--text-primary", "--bg-surface"],
    ["--text-primary", "--bg-subtle"],
    ["--text-secondary", "--bg-page"],
    ["--text-secondary", "--bg-surface"],
    ["--text-muted", "--bg-page"],
    ["--text-link", "--bg-page"],
    ["--text-brand", "--bg-page"],
    ["--text-on-inverse", "--bg-inverse"],
    ["--text-secondary-on-inverse", "--bg-inverse"],
    ["--action-primary-fg", "--action-primary-bg"],
    ["--action-primary-fg", "--action-primary-bg-hover"],
    ["--action-primary-fg", "--action-primary-bg-active"],
    ["--action-secondary-fg", "--action-secondary-bg"],
    ["--action-secondary-fg", "--action-secondary-bg-hover"],
    ["--action-disabled-fg", "--action-disabled-bg"],
    ["--channel-kakao-fg", "--channel-kakao-bg"],
  ];

  /**
   * 외부 채널 브랜드 버튼 — 로고타입 예외.
   * 네이버 톡톡 공식 버튼은 #03C75A 바탕에 흰 로고다. 우리가 색을 바꾸면 브랜드 가이드 위반이고,
   * 바꾸지 않으면 흰 글자 대비가 AA 에 미달한다. WCAG 2.x 1.4.3 은 **로고·브랜드명**을 대비
   * 요구에서 제외하므로 버튼 위에는 로고만 두고, 사람이 읽어야 할 라벨은 버튼 **바깥**에
   * --text-secondary 로 둔다. 값이 조용히 흘러가지 않도록 실측치를 여기에 못 박는다.
   */
  const LOGOTYPE_EXCEPTIONS: Array<[fg: string, bg: string, ratio: number]> = [
    ["--channel-naver-fg", "--channel-naver-bg", 2.25],
  ];

  it("로고타입 예외 짝의 대비값이 기록된 실측치에서 벗어나지 않는다", () => {
    for (const [fg, bg, expectedRatio] of LOGOTYPE_EXCEPTIONS) {
      expect(round2(contrast(resolved(fg), resolved(bg))), `${fg} on ${bg}`).toBe(expectedRatio);
    }
  });

  it("명시된 전경/배경 짝이 전부 AA 4.5:1 이상이다", () => {
    for (const [fg, bg] of FG_BG_PAIRS) {
      const r = round2(contrast(resolved(fg), resolved(bg)));
      expect(r, `${fg} on ${bg} = ${r}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("모든 텍스트 역할 토큰이 최소 한 번은 대비 검증표에 등장한다 (검증 누락 방지)", () => {
    const covered = new Set([
      ...FG_BG_PAIRS.map(([fg]) => fg),
      ...LOGOTYPE_EXCEPTIONS.map(([fg]) => fg),
    ]);
    const uncovered = textRoles.filter((n) => !covered.has(n));
    expect(uncovered, `대비 검증되지 않은 텍스트 토큰: ${uncovered.join(", ")}`).toEqual([]);
  });
});

// ── 8. 참조 무결성 ────────────────────────────────────────────────
describe("2층 구조 무결성", () => {
  it("semantic.css 의 모든 var(--x) 참조가 tokens.css 에 존재한다", () => {
    const stripped = semanticCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const refs = [...stripped.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    const missing = [...new Set(refs)].filter((r) => !tokens.has(r));
    expect(missing, `tokens.css 에 없는 참조: ${missing.join(", ")}`).toEqual([]);
  });

  it("semantic.css 의 모든 선언은 원시 토큰 참조다 (하드코딩 리터럴 금지)", () => {
    for (const [name, value] of semantic) {
      expect(/^var\(\s*--[A-Za-z0-9-]+\s*\)$/.test(value), `${name} = ${value} — 리터럴 하드코딩`).toBe(true);
    }
  });

  it("모든 토큰 참조가 순환 없이 리터럴까지 풀린다", () => {
    for (const name of [...tokens.keys(), ...semantic.keys()]) {
      expect(() => resolved(name)).not.toThrow();
    }
  });

  it("app/layout.tsx 가 tokens → semantic → globals 순으로 import 한다", () => {
    const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
    const order = ["styles/tokens.css", "styles/semantic.css", "./globals.css"].map((s) =>
      layout.indexOf(s),
    );
    expect(order.every((i) => i >= 0), "import 누락").toBe(true);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });
});

// ── 보고서용 실측표 출력 ──────────────────────────────────────────
describe("실측 대비표", () => {
  it("각 텍스트/보더 역할 토큰의 실제 대비값을 출력한다", () => {
    const pageBg = resolved("--bg-page");
    const inverseBg = resolved("--bg-inverse");
    const rows: Array<{ token: string; value: string; against: string; ratio: string; gate: string }> = [
      ["--text-primary", pageBg, "--bg-page", "4.5"],
      ["--text-secondary", pageBg, "--bg-page", "4.5"],
      ["--text-muted", pageBg, "--bg-page", "4.5"],
      ["--text-link", pageBg, "--bg-page", "4.5"],
      ["--text-brand", pageBg, "--bg-page", "4.5"],
      ["--gray-text", WHITE, "#FFFFFF", "4.5"],
      ["--gray", WHITE, "#FFFFFF", "(참고)"],
      ["--gold", WHITE, "#FFFFFF", "(참고)"],
      ["--gold", inverseBg, "--bg-inverse", "(참고)"],
      ["--gold-deep", WHITE, "#FFFFFF", "(참고)"],
      ["--text-on-inverse", inverseBg, "--bg-inverse", "4.5"],
      ["--text-secondary-on-inverse", inverseBg, "--bg-inverse", "4.5"],
      ["--action-primary-fg", resolved("--action-primary-bg"), "--action-primary-bg", "4.5"],
      ["--action-secondary-fg", resolved("--action-secondary-bg"), "--action-secondary-bg", "4.5"],
      ["--action-disabled-fg", resolved("--action-disabled-bg"), "--action-disabled-bg", "4.5"],
      ["--channel-kakao-fg", resolved("--channel-kakao-bg"), "--channel-kakao-bg", "4.5"],
      ["--channel-naver-fg", resolved("--channel-naver-bg"), "--channel-naver-bg", "(로고 예외)"],
      ["--border-subtle", pageBg, "--bg-page", "3.0"],
      ["--border-decorative", pageBg, "--bg-page", "(장식)"],
      ["--focus-ring", pageBg, "--bg-page", "3.0"],
    ].map(([token, bg, label, gate]) => ({
      token,
      value: resolved(token).toUpperCase(),
      against: label,
      ratio: contrast(resolved(token), bg).toFixed(2) + ":1",
      gate,
    }));
    // eslint-disable-next-line no-console
    console.table(rows);
    expect(rows.length).toBeGreaterThan(0);
  });
});

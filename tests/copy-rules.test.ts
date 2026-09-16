/**
 * P6-6 — 카피 규칙 전역 게이트. **통합 목록(tests/helpers/forbidden-copy.ts)이 실제로 전 표면에 걸리는지** 를 잠근다.
 *
 * 왜 새 파일인가: 기존 세 목록은 각자의 테스트 파일 안에서 자기 네임스페이스만 봤다(home.* / pages.* / pages.fares).
 * 그래서 **새 네임스페이스는 자동으로 무검사**가 됐다 — `quote.*`·`reservation.*`·`reservationCheck.*`·`admin.*` 이 그 결과다.
 * 여기서는 범위를 파일이 아니라 **카탈로그 전체 · 컴포넌트 전체 · app/[locale] 전체**로 잡는다.
 * tests/home.test.ts·tests/pages.test.ts 는 기존 단언 구조를 유지한 채 같은 목록을 import 해서 쓴다(중복 정의 0 — §6 이 단언).
 *
 * 주의: tests/ 아래라 게이트(check-legal-disclosures)의 (c) 금지어 검사 대상이다.
 * 금지어 리터럴은 tests/helpers/forbidden-copy.ts 가 코드포인트로 조립해 준다 — 여기에 직접 적지 않는다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { INSURANCE } from "@/lib/legal/disclosures";
import {
  COMPARATIVE_CLAIMS,
  COMPARATIVE_CLAIMS_EN,
  CONTACT_LITERALS,
  COPY_ALLOWLIST,
  FORBIDDEN_WORDS,
  UNPROVEN_CLAIMS,
  type CopyRule,
} from "./helpers/forbidden-copy";
import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const toPosix = (p: string) => p.split(path.sep).join("/");

const MESSAGES_KO = "messages/ko.json";
const MESSAGES_EN = "messages/en.json";

function walk(absDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(absDir)) {
    const p = path.join(absDir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** JSON 트리의 모든 문자열 잎을 점 경로와 함께. 배열은 `key[i]` 로 — chips·items 같은 배열도 검사 대상이다. */
function leaves(node: unknown, prefix = ""): Array<{ path: string; value: string }> {
  if (typeof node === "string") return [{ path: prefix, value: node }];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${prefix}[${i}]`));
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      leaves(v, prefix === "" ? k : `${prefix}.${k}`),
    );
  }
  return [];
}

/** 점 경로에서 최상위 네임스페이스만 (`home.hero.slides.airport.heading` → `home`). */
const namespaceOf = (p: string) => p.split(/[.[]/)[0];

/** 허용 목록 매칭 — (잎 경로, 규칙 라벨) 쌍이 정확히 일치할 때만 통과시킨다. */
function isAllowed(leafPath: string, label: string): boolean {
  return COPY_ALLOWLIST.some((e) => e.path === leafPath && e.label === label);
}

const koText = read(MESSAGES_KO);
const ko = JSON.parse(koText) as Record<string, unknown>;
const en = JSON.parse(read(MESSAGES_EN)) as Record<string, unknown>;
const koLeaves = leaves(ko);
const enLeaves = leaves(en);

const CODE_DIRS = ["components", "app/[locale]"];
const codeSources = CODE_DIRS.flatMap((dir) =>
  walk(path.join(ROOT, dir))
    .map((p) => toPosix(path.relative(ROOT, p)))
    .filter((f) => /\.(tsx?|css)$/.test(f))
    .map((file) => ({ file, code: stripComments(read(file), file) })),
);

/** 세 목록을 한 번에 — 한글 표면(ko.json · 코드)에 거는 규칙 전부. */
const KO_RULES: readonly CopyRule[] = [...UNPROVEN_CLAIMS, ...COMPARATIVE_CLAIMS];

// =============================================================================
// 1. 빈 배열 통과 방지 — 목록이 비면 아래 모든 검사가 전면 green 이 된다
// =============================================================================
describe("1. 통합 목록 자체 — 비어 있지 않다 · 허용 항목마다 사유가 있다", () => {
  test("세 상수 + 부속 목록이 실질적인 하한을 넘는다", () => {
    expect(FORBIDDEN_WORDS.length, "FORBIDDEN_WORDS").toBeGreaterThanOrEqual(6);
    expect(UNPROVEN_CLAIMS.length, "UNPROVEN_CLAIMS").toBeGreaterThanOrEqual(20);
    expect(COMPARATIVE_CLAIMS.length, "COMPARATIVE_CLAIMS").toBeGreaterThanOrEqual(6);
    expect(COMPARATIVE_CLAIMS_EN.length, "COMPARATIVE_CLAIMS_EN").toBeGreaterThanOrEqual(5);
    expect(CONTACT_LITERALS.length, "CONTACT_LITERALS").toBeGreaterThanOrEqual(6);
  });

  test("검사 대상 자체가 실재한다 (빈 대상 통과 방지)", () => {
    expect(koLeaves.length, "ko.json 잎").toBeGreaterThan(400);
    expect(Object.keys(ko).length, "ko.json 네임스페이스").toBeGreaterThanOrEqual(9);
    expect(codeSources.length, "components/** + app/[locale]/** 소스").toBeGreaterThan(50);
  });

  test("정규식에 g 플래그가 없다 (lastIndex 잔류로 두 번째 검사가 빗나가는 것을 막는다)", () => {
    for (const [label, re] of [...UNPROVEN_CLAIMS, ...COMPARATIVE_CLAIMS, ...COMPARATIVE_CLAIMS_EN]) {
      expect(re.global, label).toBe(false);
    }
  });

  test("허용 목록 — 항목마다 경로·라벨·사유가 있고, 라벨은 실재하는 규칙이다", () => {
    const known = new Set([...UNPROVEN_CLAIMS, ...COMPARATIVE_CLAIMS, ...COMPARATIVE_CLAIMS_EN].map(([l]) => l));
    for (const e of COPY_ALLOWLIST) {
      expect(e.path.length, `허용 항목 경로`).toBeGreaterThan(0);
      expect(e.reason.trim().length, `허용 항목 ${e.path} 사유 누락`).toBeGreaterThan(10);
      expect(known.has(e.label), `허용 항목 ${e.path} 의 라벨 "${e.label}" 이 목록에 없다`).toBe(true);
    }
  });

  test("허용 목록 매칭은 경로·라벨이 둘 다 같을 때만 통과시킨다", () => {
    // 매커니즘 자체의 자가 검사 — 허용 목록이 0건이어도 규칙이 살아 있는지 확인한다.
    const probe = [{ path: "a.b", label: "저렴", reason: "테스트 전용" }];
    const match = (p: string, l: string) => probe.some((e) => e.path === p && e.label === l);
    expect(match("a.b", "저렴")).toBe(true);
    expect(match("a.c", "저렴")).toBe(false);
    expect(match("a.b", "최다")).toBe(false);
    expect(isAllowed("a.b", "저렴"), "실제 허용 목록은 지금 0건이어야 한다").toBe(false);
  });
});

// =============================================================================
// 2. messages/ko.json — **전 네임스페이스** (기존 목록은 home.*·pages.* 만 봤다)
// =============================================================================
describe("2. ko.json 전 네임스페이스 — 금지어 · 실증 불가 · 비교 광고 0건", () => {
  test("검사 범위에 quote·reservation·reservationCheck·admin 이 들어 있다 (사각지대 재발 방지)", () => {
    const scanned = new Set(koLeaves.map((l) => namespaceOf(l.path)));
    for (const ns of ["common", "layout", "errors", "home", "reservation", "quote", "reservationCheck", "pages", "admin"]) {
      expect(scanned.has(ns), `${ns} 가 검사되지 않는다`).toBe(true);
    }
    // 새 최상위 네임스페이스가 생겨도 자동으로 검사 대상이 된다 — 이 단언이 그것을 증명한다.
    expect(scanned.size).toBe(Object.keys(ko).length);
  });

  test("금지어 0건", () => {
    const hits = koLeaves.flatMap((l) => FORBIDDEN_WORDS.filter((w) => l.value.includes(w)).map((w) => `${l.path} :: ${w}`));
    expect(hits, hits.join("\n")).toEqual([]);
  });

  test.for(KO_RULES.map((r) => [r[0], r[1]] as const))("실증 불가·비교 광고 0건 — %s", ([label, re]) => {
    const hits = koLeaves
      .filter((l) => re.test(l.value) && !isAllowed(l.path, label))
      .map((l) => `${l.path} :: ${l.value}`);
    expect(hits, `${label}\n${hits.join("\n")}`).toEqual([]);
  });
});

// =============================================================================
// 3. messages/en.json — 지금까지 검사 0. 영문 카피를 지어내지 않고 **검사만** 먼저 건다
// =============================================================================
describe("3. en.json — 영문 비교 광고 검사 + ko 와의 키 관계", () => {
  test("en.json 은 비어 있거나(현재 TEMP 정책) ko 와 키 집합이 정확히 같다", () => {
    // i18n/messages.ts 는 최상위 키 기준 shallow 병합이다 — 부분 네임스페이스를 넣으면 그 안의 빠진 키가
    // ko 로 폴백되지 않고 사라진다. 그래서 en.json 은 `{}` 이거나 ko 와 완전히 같은 키 집합이어야 한다.
    if (enLeaves.length === 0) {
      expect(en).toEqual({});
      return;
    }
    expect(new Set(enLeaves.map((l) => l.path))).toEqual(new Set(koLeaves.map((l) => l.path)));
  });

  test.for(COMPARATIVE_CLAIMS_EN.map((r) => [r[0], r[1]] as const))("영문 비교·최상급 0건 — %s", ([label, re]) => {
    const hits = enLeaves.filter((l) => re.test(l.value) && !isAllowed(l.path, label)).map((l) => `${l.path} :: ${l.value}`);
    expect(hits, `${label}\n${hits.join("\n")}`).toEqual([]);
  });

  test("한글 목록도 en.json 에 그대로 건다 (ko 문구를 복사해 넣는 경로를 막는다)", () => {
    for (const l of enLeaves) {
      for (const w of FORBIDDEN_WORDS) expect(l.value.includes(w), `${l.path} :: ${w}`).toBe(false);
      for (const [label, re] of KO_RULES) {
        if (isAllowed(l.path, label)) continue;
        expect(re.test(l.value), `${l.path} :: ${label}`).toBe(false);
      }
    }
  });
});

// =============================================================================
// 4. messages/** — 연락처·등록번호 리터럴 0건 (원장 lib/legal/disclosures.ts 가 단일 출처)
// =============================================================================
describe("4. messages/** — 원장 값의 리터럴 복제 0건", () => {
  test.for(CONTACT_LITERALS.map((r) => [r[0], r[1]] as const))("%s 리터럴이 카탈로그에 없다", ([label, literal]) => {
    expect(literal.trim().length, `${label} 이 원장에서 비어 있다 — 검사가 무의미해진다`).toBeGreaterThan(0);
    const hits = [...koLeaves, ...enLeaves].filter((l) => l.value.includes(literal)).map((l) => `${l.path} :: ${l.value}`);
    expect(hits, `${label}\n${hits.join("\n")}`).toEqual([]);
  });

  test("대신 보간 자리(`{tel}`)를 쓴다 — 원장이 바뀌면 카탈로그가 따라온다", () => {
    const withTel = koLeaves.filter((l) => l.value.includes("{tel}"));
    expect(withTel.length, "{tel} 보간을 쓰는 문구가 하나도 없다").toBeGreaterThanOrEqual(6);
  });
});

// =============================================================================
// 5. components/** + app/[locale]/** — 코드에 직접 박힌 카피
// =============================================================================
describe("5. 코드 표면 — components/** · app/[locale]/**", () => {
  test("금지어 0건 (주석 제외)", () => {
    const hits = codeSources.flatMap(({ file, code }) =>
      FORBIDDEN_WORDS.filter((w) => code.includes(w)).map((w) => `${file} :: ${w}`),
    );
    expect(hits, hits.join("\n")).toEqual([]);
  });

  test.for(KO_RULES.map((r) => [r[0], r[1]] as const))("실증 불가·비교 광고 0건 — %s", ([label, re]) => {
    const hits = codeSources.filter(({ code }) => re.test(code)).map(({ file }) => `${file} :: ${label}`);
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

// =============================================================================
// 6. 목록 중복 정의 0 — home.test.ts·pages.test.ts 는 자기 목록을 더는 정의하지 않는다
// =============================================================================
describe("6. 단일 원장 — 목록을 두 번 정의하지 않는다", () => {
  test.for([["tests/home.test.ts"], ["tests/pages.test.ts"]])("%s — 자기 목록 정의 0 · 통합 모듈 import", ([rel]) => {
    const src = read(rel);
    expect(/const\s+(FORBIDDEN|UNPROVEN|PRICE_TABLE)\s*[:=]/.test(src), `${rel} 에 목록이 다시 정의돼 있다`).toBe(false);
    expect(src).toMatch(/from\s+["']\.\/helpers\/forbidden-copy["']/);
  });
});

// =============================================================================
// 7. 남아 있어야 할 것 — 빼기만 했는지의 반대편 단언
// =============================================================================
describe("7. 사업 설명은 남는다 (실증 대상이 아니다)", () => {
  test('확정 표기 "공항 픽업·샌딩 (송영 전문)" 이 홈·위저드에 그대로 있다 — CLAUDE.md §3', () => {
    const MARK = "공항 픽업·샌딩 (송영 전문)";
    const hits = koLeaves.filter((l) => l.value.includes(MARK)).map((l) => namespaceOf(l.path));
    expect(hits.length, "확정 표기가 사라졌다").toBeGreaterThanOrEqual(4);
    expect(new Set(hits)).toContain("home");
    expect(new Set(hits)).toContain("quote");
  });

  test("홈의 보험 문구는 원장 INSURANCE 가 보증하는 범위 안이다 (가입 사실 + 서류 열람)", () => {
    const home = koLeaves.filter((l) => namespaceOf(l.path) === "home");
    const insuranceLeaves = home.filter((l) => l.value.includes("보험"));
    expect(insuranceLeaves.length, "홈에서 보험 문구가 통째로 사라졌다").toBeGreaterThanOrEqual(2);
    // 원장 INSURANCE.body 가 실제로 말하는 것: (1) 보험에 가입되어 있다 (2) 원하면 보험 서류를 받아 볼 수 있다.
    expect(INSURANCE.body).toContain("보험 서류");
    expect(home.some((l) => l.value.includes("보험 서류")), "원장이 보증하는 '보험 서류' 안내가 홈에 없다").toBe(true);
  });
});

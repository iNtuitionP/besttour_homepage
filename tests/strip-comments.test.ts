/**
 * 주석 제거기 회귀 픽스처 (P6-7 · known-defects D7).
 *
 * **근거: P6-6 독립 리뷰 M-1.** 리뷰어가 배포되는 소스 `app/[locale]/(site)/fares/page.tsx` 의
 * `desc={t("intro")}` 를 `desc={t("intro") + <글로브 패턴 문자열> + <비교 광고 문장>}` 으로 바꿔 심고
 * `vitest 219 passed` · `셸 게이트 exit 0` 으로 **두 게이트를 모두 통과시켰다.**
 * 옛 제거기가 문자열 속 별표 두 개를 블록 주석 시작으로 읽어 그 뒤 첫 닫는 짝(대개 JSDoc 닫는 줄)까지를
 * 스캔에서 통째로 지웠기 때문이다. 원인은 문장이 아니라 제거기였다.
 *
 * 그래서 여기서 잠그는 것은 두 가지다:
 *   (1) 파서 기반 제거기가 **그 조합을 더는 지우지 않는다** (§1~§5)
 *   (2) 두 게이트가 **제자리 정규식으로 되돌아가지 않는다** (§6)
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { StripCommentsError, stripComments } from "./helpers/strip-comments";

const TESTS_DIR = path.resolve(import.meta.dirname);
const ROOT = path.resolve(TESTS_DIR, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

/** 옛 제거기의 블록 주석 정규식. 리터럴로 적으면 §6 의 제자리 정의 탐지가 이 파일을 잡으므로 문자열에서 만든다. */
const LEGACY_BLOCK_RE = new RegExp("\\/\\*[\\s\\S]*?\\*\\/", "g");
const legacyStrip = (src: string) => src.replace(LEGACY_BLOCK_RE, "");

/** 심어 본 비교 광고 문장 — 리뷰 M-1 이 쓴 것과 같은 문장. */
const PLANTED = "인천공항 노선은 더 저렴합니다";
/** 가짜 주석 시작을 만드는 글로브 패턴 문자열. 별표 두 개를 소스에 그대로 두는 것이 핵심이다. */
const GLOB = "components/" + "**";

const lines = (s: string) => s.split("\n").length;
const newlines = (s: string) => (s.match(/\n/g) ?? []).length;

// =============================================================================
// 1. 뚫린 조합 재현 — 옛 제거기는 지웠고, 파서는 남긴다
// =============================================================================
describe("1. P6-6 리뷰 M-1 이 뚫은 조합", () => {
  const BREACH = [
    `const glob = "${GLOB}";`,
    `const desc = t("intro") + "${PLANTED}";`,
    "/** 이 JSDoc 의 닫는 짝이 옛 제거기의 가짜 주석을 끝냈다 — 위 두 줄이 통째로 사라졌다 */",
    "export const page = { glob, desc };",
  ].join("\n");

  test("옛 정규식 제거기는 심어 둔 문장을 지웠다 (이 테스트가 증거다)", () => {
    const legacy = legacyStrip(BREACH);
    expect(legacy.includes(PLANTED), "옛 제거기가 문장을 남겼다면 M-1 재현이 틀린 것이다").toBe(false);
    expect(legacy.includes(GLOB)).toBe(false);
  });

  test("파서 기반 제거기는 문장도 글로브 문자열도 남긴다 — 게이트가 다시 본다", () => {
    const stripped = stripComments(BREACH, "fixture.ts");
    expect(stripped).toContain(PLANTED);
    expect(stripped).toContain(GLOB);
  });

  test("같은 파일의 진짜 JSDoc 은 지워진다 (덜 지우는 쪽으로 도망가지 않았다)", () => {
    const stripped = stripComments(BREACH, "fixture.ts");
    expect(stripped).not.toContain("가짜 주석을 끝냈다");
  });

  test(".tsx 에서도 같다 — JSX 주석이 닫는 짝을 제공하던 실제 형태", () => {
    const tsx = [
      "export default function Page() {",
      "  return (",
      "    <main>",
      `      <Header desc={t("intro") + "${GLOB}" + "${PLANTED}"} />`,
      "      {/* ① 산정 기준 — 이 JSX 주석이 가짜 주석의 닫는 짝이었다 */}",
      "      <section />",
      "    </main>",
      "  );",
      "}",
    ].join("\n");
    expect(legacyStrip(tsx).includes(PLANTED), "옛 제거기 재현").toBe(false);
    const stripped = stripComments(tsx, "page.tsx");
    expect(stripped).toContain(PLANTED);
    expect(stripped).not.toContain("산정 기준");
  });
});

// =============================================================================
// 2. 경계 사례 — 정규식이 번번이 틀리던 자리
// =============================================================================
describe("2. 문자열·템플릿·정규식 리터럴 안의 주석 모양은 코드다", () => {
  test.for([
    ['문자열 속 블록 주석 시작', `const a = "/* 주석이 아니다";`, "/* 주석이 아니다"],
    ['문자열 속 닫는 짝', `const a = "*/ 이것도 아니다";`, "*/ 이것도 아니다"],
    ["템플릿 리터럴 속 주석 모양", "const a = `/* 안쪽 */ 바깥`;", "/* 안쪽 */"],
    ["중첩 템플릿 리터럴", "const a = `${`${`/* 삼중 */`}`}`;", "/* 삼중 */"],
    ["정규식 리터럴 속 블록 주석 시작", String.raw`const re = /\/\*/;`, String.raw`/\/\*/`],
    ["정규식 리터럴 속 줄 주석", String.raw`const re = /\/\/ 아님/;`, "아님"],
    ["문자열 속 URL (// 가 주석이 아니다)", `const u = "https://bestour.example/a";`, "https://bestour.example/a"],
    ["이스케이프된 따옴표", String.raw`const a = "\" /* 아직 문자열 안이다 */ \"";`, "아직 문자열 안이다"],
    ["문자열 속 백슬래시 종결", String.raw`const a = "\\"; const b = "/* 코드다 */";`, "/* 코드다 */"],
  ] as const)("%s", ([, src, keep]) => {
    expect(stripComments(src, "fixture.ts")).toContain(keep);
  });

  test("JSX 텍스트 안의 주석 모양은 화면에 보이는 글자다", () => {
    const tsx = "export const A = () => <p>계약서 /* 별표 */ 조항</p>;";
    expect(stripComments(tsx, "a.tsx")).toContain("/* 별표 */");
  });

  test("CSS: 문자열 속 주석 모양은 남고 진짜 주석은 지워진다", () => {
    const css = ['.a::after { content: "/* 값이다 */"; }', "/* 진짜 주석 */", ".b { color: red; }"].join("\n");
    const stripped = stripComments(css, "x.module.css");
    expect(stripped).toContain('"/* 값이다 */"');
    expect(stripped).not.toContain("진짜 주석");
    expect(stripped).toContain(".b { color: red; }");
  });
});

// =============================================================================
// 3. 진짜 주석은 정말 지워진다 — 반대편 단언
// =============================================================================
describe("3. 진짜 주석 제거", () => {
  test.for([
    ["줄 주석", "const a = 1; // 지워질 말\n", "지워질 말"],
    ["줄 끝 주석(코드 뒤 같은 줄)", "const a = 1; // 꼬리 주석\nconst b = 2;\n", "꼬리 주석"],
    ["블록 주석", "/* 지워질 말 */\nconst a = 1;\n", "지워질 말"],
    ["JSDoc", "/**\n * 지워질 말\n */\nconst a = 1;\n", "지워질 말"],
    ["중첩처럼 보이는 블록 주석", "/* 바깥 /* 안쪽 */\nconst a = 1;\n", "안쪽"],
    ["코드 사이 블록 주석", "const a = /* 지워질 말 */ 1;\n", "지워질 말"],
    ["JSX 주석", "export const A = () => <p>{/* 지워질 말 */}본문</p>;\n", "지워질 말"],
  ] as const)("%s", ([, src, gone]) => {
    const stripped = stripComments(src, src.includes("<p>") ? "a.tsx" : "a.ts");
    expect(stripped).not.toContain(gone);
  });

  test("주석만 지우고 코드는 한 글자도 잃지 않는다", () => {
    const src = "const keep = 1; // 주석\n/* 주석 */\nconst also = 2;\n";
    const stripped = stripComments(src, "a.ts");
    expect(stripped).toContain("const keep = 1;");
    expect(stripped).toContain("const also = 2;");
  });
});

// =============================================================================
// 4. 줄 번호 보존 — 게이트는 파일:줄을 보고한다
// =============================================================================
describe("4. 줄 번호 보존", () => {
  const MULTI = [
    "const a = 1;",
    "/**",
    " * 여러 줄 주석",
    " * 두 번째 줄",
    " */",
    "const marker = 2;",
    "// 꼬리",
    "const b = 3;",
  ].join("\n");

  test("개행 수가 같다", () => {
    const stripped = stripComments(MULTI, "a.ts");
    expect(newlines(stripped)).toBe(newlines(MULTI));
    expect(lines(stripped)).toBe(lines(MULTI));
  });

  test("표식의 줄 번호가 그대로다", () => {
    const before = MULTI.split("\n").findIndex((l) => l.includes("const marker"));
    const after = stripComments(MULTI, "a.ts").split("\n").findIndex((l) => l.includes("const marker"));
    expect(after).toBe(before);
    expect(after).toBe(5);
  });

  test("CRLF 도 줄 수가 보존된다", () => {
    const crlf = MULTI.replace(/\n/g, "\r\n");
    const stripped = stripComments(crlf, "a.ts");
    expect(newlines(stripped)).toBe(newlines(crlf));
    expect(stripped.split("\r\n").length).toBe(crlf.split("\r\n").length);
  });

  test("저장소의 실제 파일에서도 줄 수가 보존된다", () => {
    for (const rel of ["tests/copy-rules.test.ts", "tests/db-test-preconditions.test.ts", "tests/helpers/strip-comments.ts"]) {
      const src = read(rel);
      expect(lines(stripComments(src, rel)), rel).toBe(lines(src));
    }
  });
});

// =============================================================================
// 5. 파싱 실패는 **throw** 한다 — 조용한 폴백이 이 결함의 본체였다
// =============================================================================
describe("5. 실패는 조용하지 않다", () => {
  test.for([
    ["닫히지 않은 문자열", `const a = "열린 채 끝난다`, "a.ts"],
    ["깨진 구문", "function f( {", "a.ts"],
    ["닫히지 않은 블록 주석", "const a = 1;\n/* 끝나지 않는다", "a.ts"],
    [".ts 인데 JSX (문법 선택이 확장자와 어긋난 경우)", "export const A = () => <p>x</p>;", "a.ts"],
    ["닫히지 않은 CSS 주석", ".a { color: red; }\n/* 끝나지 않는다", "a.css"],
    ["주석 문법을 모르는 확장자", "{}", "a.json"],
  ] as const)("%s → throw", ([, src, name]) => {
    expect(() => stripComments(src, name)).toThrow(StripCommentsError);
  });

  test("throw 한 메시지에 파일 이름이 들어 있다 (게이트가 어디인지 찍는다)", () => {
    expect(() => stripComments("function f( {", "tests/broken.ts")).toThrow(/tests\/broken\.ts/);
  });

  test("정상 입력은 throw 하지 않는다 — .tsx 의 JSX · .ts 의 제네릭 화살표", () => {
    expect(() => stripComments("export const A = () => <p>x</p>;", "a.tsx")).not.toThrow();
    expect(() => stripComments("const id = <T,>(x: T) => x;", "a.ts")).not.toThrow();
  });
});

// =============================================================================
// 6. 제자리 정의 금지 — 두 게이트는 이 헬퍼만 쓴다
// =============================================================================
/**
 * 통지·갤러리 잠금을 `helpers/db-lock` 에서만 가져오게 잠근 것과 같은 방식이다.
 * (그 두 잠금의 이름을 여기 적지 않는 이유: db-test-preconditions 의 "제자리 정의 금지" 단언은
 *  주석을 걷어내지 않은 **원문**에서 이름을 찾는다 — 설명하려고 적으면 이 파일이 잠금 사용자로 오인된다.)
 *
 * 탐지 정규식은 **자기 자신을 잡지 않도록** 소스에 그대로 나타나지 않는 형태로 적었다
 * (예: `replace\(` 는 `replace(` 를 매치하지만 이 파일에는 `replace(` 로 적혀 있지 않다).
 */
const IN_PLACE_BLOCK = /replace\(\s*\/\\\/\\\*\[\\s\\S\]/;
const IN_PLACE_LINE = /\\\/\\\/(\.\*\$|\[\^\\n\]\*)/;
const IN_PLACE_SCANNER = /line\[i \+ 1\] === "\//;
/** TS/JS 주석 제거기인가 — 블록 주석 정규식 **그리고** 줄 주석 처리. SQL(`--`)·CSS 전용은 문법이 달라 제외한다. */
const definesInPlaceStripper = (src: string) =>
  IN_PLACE_BLOCK.test(src) && (IN_PLACE_LINE.test(src) || IN_PLACE_SCANNER.test(src));

/** 이 헬퍼로 옮겨야 할 게이트 두 개. 여기에 제자리 제거기가 다시 생기면 실패한다. */
const GATE_FILES = ["copy-rules.test.ts", "db-test-preconditions.test.ts"];

/**
 * **줄어들기만 하는 재고 목록** (2026-09-16 실측 20개).
 *
 * P6-7 의 범위는 두 게이트다. 나머지 파일들의 제자리 제거기는 같은 결함을 갖고 있지만
 * "이 소스에 이 문자열이 있다/없다" 를 보는 자기 완결적 단언이라 게이트의 눈은 아니다 —
 * 옮기는 것은 별도 태스크다. 그래도 **새로 늘어나는 것은 여기서 막는다**:
 * 아래 목록은 부분집합 규칙이라 지우는 것은 자유롭고 **더하는 것은 실패**한다.
 * 새 테스트 파일은 `./helpers/strip-comments` 의 `stripComments` 를 쓸 것.
 */
const LEGACY_IN_PLACE = [
  "admin-auth.test.ts",
  "admin-gallery.test.ts",
  "admin-notices.test.ts",
  "admin-notifications.test.ts",
  "admin-popups.test.ts",
  "admin-reservations.test.ts",
  "admin-routes.test.ts",
  "canonical.test.ts",
  "gallery-albums-public.test.ts",
  "home.test.ts",
  "layout.test.ts",
  "legal-pages.test.ts",
  "notify-mail.test.ts",
  "notify-templates.test.ts",
  "notify-vars.test.ts",
  "pages.test.ts",
  "quote-wizard.test.ts",
  "recent-feed.test.ts",
  "reservation-check.test.ts",
  "review-fix.test.ts",
];

describe("6. 제거기는 하나뿐이다", () => {
  const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith(".ts"));
  const detected = files.filter((f) => definesInPlaceStripper(readFileSync(path.join(TESTS_DIR, f), "utf-8")));

  test.for(GATE_FILES.map((f) => [f] as const))("%s — 제자리 정의 0 · 헬퍼 import", ([rel]) => {
    const src = readFileSync(path.join(TESTS_DIR, rel), "utf-8");
    expect(definesInPlaceStripper(src), `${rel} 에 제자리 주석 제거기가 다시 생겼다`).toBe(false);
    expect(src).toMatch(/import\s*\{[^}]*stripComments[^}]*\}\s*from\s*["']\.\/helpers\/strip-comments["']/);
  });

  test("제자리 제거기는 늘지 않는다 — 재고 목록의 부분집합이어야 한다", () => {
    const added = detected.filter((f) => !LEGACY_IN_PLACE.includes(f));
    expect(
      added,
      "새 파일이 제자리 주석 제거기를 정의했다. tests/helpers/strip-comments.ts 의 stripComments() 를 쓸 것 — " +
        "정규식 제거기는 문자열 속 별표 두 개를 블록 주석 시작으로 읽어 파일 뒤쪽을 통째로 건너뛴다(known-defects D7).",
    ).toEqual([]);
  });

  test("탐지가 낡지 않았다 — 아무 파일도 못 고르면 이 규칙은 의미를 잃는다", () => {
    expect(detected.length, `탐지된 파일: ${detected.join(", ") || "(없음)"}`).toBeGreaterThanOrEqual(10);
  });

  test("헬퍼 자신은 파서를 쓴다 (정규식으로 되돌아가지 않았다)", () => {
    const src = read("tests/helpers/strip-comments.ts");
    expect(definesInPlaceStripper(src), "헬퍼가 정규식 제거기로 되돌아갔다").toBe(false);
    expect(src).toMatch(/from\s+["']typescript["']/);
    expect(src).toContain("createSourceFile");
    expect(src).toContain("parseDiagnostics");
  });
});

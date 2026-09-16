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
/** TS/JS 주석 제거기인가 — 블록 주석 정규식 **그리고** 줄 주석 처리. SQL(`--`)·CSS 전용은 문법이 달라 제외한다(SQL 은 아래 §6-S). */
const definesInPlaceStripper = (src: string) =>
  IN_PLACE_BLOCK.test(src) && (IN_PLACE_LINE.test(src) || IN_PLACE_SCANNER.test(src));

/**
 * **SQL** 제자리 제거기인가 (P6-11) — `--` 로 시작하는 정규식 리터럴을 replace 에 넘기는 형태, 또는 그 이름의 정의.
 * 두 탐지식 모두 이 파일 소스에 **그대로 나타나지 않는** 형태로 적었다(`replace\(` · `)\s+` 가 원문 글자와 어긋난다).
 */
const IN_PLACE_SQL_LINE = /replace(?:All)?\(\s*(?:\/--|new\s+RegExp\(\s*["'`]--)/;
const IN_PLACE_SQL_NAME = /\b(?:const|let|var|function)\s+stripSqlComments\b/;
/**
 * ⚠️ **철자 검사다**(GPT 검증 P2). `replace`/`replaceAll` 에 `--` 로 시작하는 정규식(리터럴 또는 `new RegExp("--…")`)을
 * 넘기는 형태와 옛 이름을 잡는다. 문자열을 쪼개 만든 정규식이나 `split("--")` 스캐너는 못 잡는다 —
 * 구현 금지를 기계적으로 증명하는 것이 아니라 **알려진 형태의 재발**을 막는다.
 */
const definesInPlaceSqlStripper = (src: string) => IN_PLACE_SQL_LINE.test(src) || IN_PLACE_SQL_NAME.test(src);

/** tests/ 아래 모든 `.ts` — **하위 디렉터리 포함**(GPT 검증 P2: 최상위만 보던 열거). 경로는 tests/ 기준 `/` 구분. */
function listTestSources(dir = TESTS_DIR, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.isDirectory()) return d.name === "node_modules" ? [] : listTestSources(path.join(dir, d.name), `${prefix}${d.name}/`);
    return d.name.endsWith(".ts") ? [`${prefix}${d.name}`] : [];
  });
}

/** 이 헬퍼로 옮겨야 할 게이트 두 개. 여기에 제자리 제거기가 다시 생기면 실패한다. */
const GATE_FILES = ["copy-rules.test.ts", "db-test-preconditions.test.ts"];

/**
 * **재고 목록은 P6-8 에서 0 이 됐다** (2026-09-16).
 *
 * P6-7 은 두 게이트만 옮기고 나머지 20개는 "줄어들기만 하는 목록"으로 증가만 막았다.
 * P6-8 이 그 20개를 전부 헬퍼로 옮겼으므로 목록은 비었고, 규칙은 **부분집합**에서
 * **0건**으로 조인다: `tests/**` 어디에도 제자리 TS 주석 제거기가 있으면 안 된다.
 *
 * 목록을 지우면서 "탐지가 낡지 않았다" 단언의 근거가 사라진다 —
 * 예전에는 "실제로 N개를 고른다"가 탐지식이 살아 있다는 증거였는데, 이제 정답이 0이라
 * **탐지식이 썩어도 0이 나온다.** 그래서 증거를 **픽스처**로 옮겼다(§6-2):
 * 옛 제거기 3변종을 문자열로 지어 탐지식에 먹여 **true 가 나오는지** 확인한다.
 * 픽스처 문자열은 소스에 그대로 나타나지 않도록 조립한다 — 그렇지 않으면 이 파일 자신이 탐지된다.
 */
const LEGACY_IN_PLACE: string[] = [];

/**
 * 옛 제자리 제거기 3변종을 **런타임에 조립**한다. 탐지식이 찾는 글자열(블록 주석 정규식 리터럴,
 * 줄 스캐너의 다음 글자 비교식)이 이 파일 소스에는 **이어서 나타나지 않도록** 쪼개 적는다 —
 * 그대로 적으면 이 파일 자신이 제자리 제거기로 탐지된다(실제로 한 번 그렇게 빨개졌다).
 * 조립한 뒤의 문자열에는 온전히 나타나므로 탐지식은 정상적으로 반응한다.
 */
const BS = "\\";
const LEGACY_BLOCK_SRC = `  const noBlock = src.replace(/${BS}/${BS}*[${BS}s${BS}S]*?${BS}*${BS}//g, "");`;
/** 변종 A/C — 블록 정규식 + 한 줄씩 읽는 `//` 스캐너(실제 파일들이 쓰던 형태). */
const LEGACY_SAMPLE_SCANNER = [
  "function stripComments(src: string): string {",
  LEGACY_BLOCK_SRC,
  "  return noBlock.split(String.fromCharCode(10)).map((line) => {",
  "    for (let i = 0; i < line.length; i++) {",
  '      if (line[i] === "/" && line[i + ' + '1] === "/") return line.slice(0, i);',
  "    }",
  "    return line;",
  "  }).join(String.fromCharCode(10));",
  "}",
].join("\n");
/** 변종 B — 블록 정규식 + 줄 주석 정규식(`.*$`). */
const LEGACY_SAMPLE_REGEX_B = [
  "function stripComments(src: string): string {",
  `  return src.replace(/${BS}/${BS}*[${BS}s${BS}S]*?${BS}*${BS}//g, "").replace(/(^|[^:])${BS}/${BS}/.*$/gm, "$1");`,
  "}",
].join("\n");
/** 변종 naive — 블록 정규식 + `//` 부터 줄 끝까지(`[^\n]*`). 문자열 속 URL 도 지운다. */
const LEGACY_SAMPLE_NAIVE = [
  "const stripComments = (s: string) =>",
  `  s.replace(/${BS}/${BS}*[${BS}s${BS}S]*?${BS}*${BS}//g, "").replace(/${BS}/${BS}/[^${BS}n]*/g, "");`,
].join("\n");

describe("6. 제거기는 하나뿐이다", () => {
  const files = listTestSources().filter((f) => f !== "helpers/strip-comments.ts");
  const detected = files.filter((f) => definesInPlaceStripper(readFileSync(path.join(TESTS_DIR, f), "utf-8")));

  test.for(GATE_FILES.map((f) => [f] as const))("%s — 제자리 정의 0 · 헬퍼 import", ([rel]) => {
    const src = readFileSync(path.join(TESTS_DIR, rel), "utf-8");
    expect(definesInPlaceStripper(src), `${rel} 에 제자리 주석 제거기가 다시 생겼다`).toBe(false);
    expect(src).toMatch(/import\s*\{[^}]*stripComments[^}]*\}\s*from\s*["']\.\/helpers\/strip-comments["']/);
  });

  test("제자리 제거기 0건 — tests/** 전체 (재고 목록은 P6-8 에서 비었다)", () => {
    expect(LEGACY_IN_PLACE, "재고 목록은 비어 있어야 한다 — 다시 채우지 말고 헬퍼로 옮길 것").toEqual([]);
    expect(
      detected,
      "제자리 주석 제거기가 있다. tests/helpers/strip-comments.ts 의 stripComments(src, fileName) 을 쓸 것 — " +
        "정규식 제거기는 문자열 속 별표 두 개를 블록 주석 시작으로 읽어 파일 뒤쪽을 통째로 건너뛴다(known-defects D7).",
    ).toEqual([]);
  });

  test("stripComments 를 쓰는 테스트 파일은 전부 헬퍼에서 가져온다 (제자리 재정의 우회 차단)", () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(path.join(TESTS_DIR, f), "utf-8");
      if (!/\bstripComments\s*\(/.test(src)) return false;
      return !/import\s*\{[^}]*stripComments[^}]*\}\s*from\s*["'](?:\.\/helpers\/|\.\.\/helpers\/|\.\/)strip-comments["']/.test(src);
    });
    expect(offenders, `헬퍼를 import 하지 않고 stripComments 를 쓰는 파일: ${offenders.join(", ")}`).toEqual([]);
  });

  test.for([
    ["변종 A/C — 블록 정규식 + 줄 스캐너", LEGACY_SAMPLE_SCANNER],
    ["변종 B — 블록 정규식 + 줄 주석 정규식", LEGACY_SAMPLE_REGEX_B],
    ["변종 naive — 블록 정규식 + //부터 줄 끝", LEGACY_SAMPLE_NAIVE],
  ] as const)("탐지가 낡지 않았다 — %s 를 실제로 잡는다", ([, sample]) => {
    expect(definesInPlaceStripper(sample), `탐지식이 이 형태를 놓친다:\n${sample}`).toBe(true);
  });

  test("탐지가 아무 소스나 잡지는 않는다 — 헬퍼를 쓰는 형태는 통과", () => {
    const clean = ['import { stripComments } from "./helpers/strip-comments";', "const code = stripComments(src, rel);"].join("\n");
    expect(definesInPlaceStripper(clean)).toBe(false);
  });

  test("헬퍼 자신은 파서를 쓴다 (정규식으로 되돌아가지 않았다)", () => {
    const src = read("tests/helpers/strip-comments.ts");
    expect(definesInPlaceStripper(src), "헬퍼가 정규식 제거기로 되돌아갔다").toBe(false);
    expect(definesInPlaceSqlStripper(src), "헬퍼의 SQL 분기가 정규식 제거기로 되돌아갔다").toBe(false);
    expect(src).toMatch(/from\s+["']typescript["']/);
    expect(src).toContain("createSourceFile");
    expect(src).toContain("parseDiagnostics");
    expect(src, "SQL 은 문자 스캐너(stripSqlSource)가 맡는다").toContain("function stripSqlSource(");
  });
});

// =============================================================================
// 6-S. SQL 제자리 제거기도 하나뿐이다 (P6-11)
// =============================================================================
/**
 * **축소 전용 재고 목록** — 빼는 것은 자유, 더하는 것은 실패. 목록의 항목이 더는 탐지되지 않으면 그것도 실패(죽은 예외 금지).
 *
 * `admin-reservations.test.ts` 가 남은 이유: P6-11 브리프가 SQL 제거기 8곳(`admin-auth · consent · gallery-albums ·
 * kst-dates · outbox · outbox-claim-channel · outbox-reaper · write-privileges`)만 세었고, **`tests/admin-*.test.ts` 는
 * `admin-auth` 한 곳만 고치라**고 못박았다(다음 태스크가 나머지 admin 테스트를 쓴다). 그런데 탐지식을 돌리자
 * 아홉 번째가 나왔다 — 같은 한 줄짜리 정규식 제거기다. 브리프 경계를 넘지 않고 **여기 적어 봉쇄**한다.
 * 그 파일이 읽는 SQL(`0010`·`0010 down`·`0009`)은 옛/새 제거기가 **한 줄도 다르게 보지 않는다**(P6-11 보고서 §③ 측정).
 */
const LEGACY_SQL_IN_PLACE = ["admin-reservations.test.ts"];

/** 옛 SQL 제거기를 **런타임에 조립**한다 — 그대로 적으면 이 파일 자신이 탐지된다. */
const LEGACY_SQL_SAMPLE = [
  ["con", "st strip", "SqlComments = (sql: string) =>"].join(""),
  `  sql.replace(/${BS}/${BS}*[${BS}s${BS}S]*?${BS}*${BS}//g, "").replace(` + `/-` + `-[^${BS}n]*/g, "");`,
].join("\n");
/** 이름을 바꿔 숨긴 변종 — 정규식 형태로 잡는다. */
const LEGACY_SQL_SAMPLE_RENAMED = ["const noSql = (s: string) => s.replace(", "/-", "-.*$/gm, ", '"");'].join("");
/** GPT 검증 P2 가 준 우회 두 형태 — `replaceAll` · `new RegExp` */
const LEGACY_SQL_SAMPLE_REPLACE_ALL = ["const cleanSql = (s: string) => s.replace", "All(/-", "-[^", BS, "n]*/g, ", '"");'].join("");
const LEGACY_SQL_SAMPLE_NEW_REGEXP = ["const cleanSql = (s: string) => s.replace(new Reg", 'Exp("-', '-.*", "g"), "");'].join("");

describe("6-S. SQL 제거기도 하나뿐이다 (P6-11)", () => {
  const files = listTestSources().filter((f) => f !== "helpers/strip-comments.ts");
  const detected = files.filter((f) => definesInPlaceSqlStripper(readFileSync(path.join(TESTS_DIR, f), "utf-8")));

  test("새 SQL 제자리 제거기 0건 — 재고 목록 밖에서 탐지되면 실패", () => {
    const fresh = detected.filter((f) => !LEGACY_SQL_IN_PLACE.includes(f));
    expect(
      fresh,
      "SQL 주석 제거기를 제자리에 만들었다. stripComments(sql, '<경로>.sql') 을 쓸 것 — 정규식은 문자열·달러 인용 속 " +
        "`--`·`/*` 를 주석으로 읽어 권한 회수 마이그레이션의 텍스트 단언을 가린다(known-defects D7 C-3).",
    ).toEqual([]);
  });

  test("재고 목록은 줄어들기만 한다 — 목록의 항목이 실제로 아직 탐지된다(고쳤으면 목록에서 뺄 것)", () => {
    const dead = LEGACY_SQL_IN_PLACE.filter((f) => !detected.includes(f));
    expect(dead, "이미 고쳐진 파일이 재고 목록에 남아 있다 — 목록에서 지울 것").toEqual([]);
    expect(LEGACY_SQL_IN_PLACE.length, "재고 목록은 늘릴 수 없다(P6-11 시점 1건)").toBeLessThanOrEqual(1);
  });

  test("P6-11 이 옮긴 8개 파일은 제자리 정의 0 · 헬퍼 import", () => {
    for (const f of [
      "admin-auth.test.ts",
      "consent.test.ts",
      "gallery-albums.test.ts",
      "kst-dates.test.ts",
      "outbox.test.ts",
      "outbox-claim-channel.test.ts",
      "outbox-reaper.test.ts",
      "write-privileges.test.ts",
    ]) {
      const src = readFileSync(path.join(TESTS_DIR, f), "utf-8");
      expect(definesInPlaceSqlStripper(src), `${f} 에 SQL 제자리 제거기가 다시 생겼다`).toBe(false);
      expect(src, f).toMatch(/import\s*\{[^}]*stripComments[^}]*\}\s*from\s*["']\.\/helpers\/strip-comments["']/);
      // import 만으로는 부족하다 — 쓰지 않는 import 가 이 단언을 만족시킨다(GPT 검증 P2). SQL 경로를 실제로 넘겨 부르는지 본다.
      const code = stripComments(src, f);
      expect(code, `${f} 가 헬퍼를 import 만 하고 SQL 에 쓰지 않는다`).toMatch(/\bstripComments\(\s*(?:read(?:Sql)?\(|sql\b|raw\b)/);
    }
  });

  test.for([
    ["옛 한 줄 정의(이름 그대로)", LEGACY_SQL_SAMPLE],
    ["이름을 바꾼 정규식 변종", LEGACY_SQL_SAMPLE_RENAMED],
    ["replaceAll 변종", LEGACY_SQL_SAMPLE_REPLACE_ALL],
    ["new RegExp 변종", LEGACY_SQL_SAMPLE_NEW_REGEXP],
  ] as const)("탐지가 낡지 않았다 — %s 를 실제로 잡는다", ([, sample]) => {
    expect(definesInPlaceSqlStripper(sample), `탐지식이 이 형태를 놓친다:\n${sample}`).toBe(true);
  });

  test("탐지가 아무 소스나 잡지는 않는다 — 헬퍼 호출·SQL 문자열 속 `--` 는 통과", () => {
    const clean = [
      'import { stripComments } from "./helpers/strip-comments";',
      'const code = stripComments(readSql(UP_SQL_PATH), UP_SQL_PATH);',
      'const sql = "select 1 -- 주석";',
    ].join("\n");
    expect(definesInPlaceSqlStripper(clean)).toBe(false);
  });
});

// =============================================================================
// 7. SQL — PostgreSQL 어휘를 따르는 문자 스캐너 (P6-11)
// =============================================================================
/** 옛 SQL 제거기(8곳이 똑같이 쓰던 한 줄). 리터럴로 적으면 §6-S 가 이 파일을 잡으므로 문자열에서 만든다. */
const LEGACY_SQL_LINE_RE = new RegExp("--[^\\n]*", "g");
const legacySqlStrip = (sql: string) => sql.replace(LEGACY_BLOCK_RE, "").replace(LEGACY_SQL_LINE_RE, "");
const sql = (src: string) => stripComments(src, "fixture.sql");

describe("7-1. 회귀 픽스처 — 달러 인용·문자열 속 주석 모양이 권한 회수 문장을 가리던 조합", () => {
  /**
   * 이 저장소의 권한 회수 마이그레이션(0012~0017)의 모양 그대로: definer 함수 본문(`as $$ … $$`) 뒤에
   * `revoke … from public, anon, authenticated` 가 오고, 그 뒤에 설명 블록 주석이 온다.
   * 본문 안의 문자열 `'%/*%'` 가 옛 정규식에게는 블록 주석 시작이었고, 뒤의 진짜 주석이 닫는 짝이었다 —
   * **revoke 문이 통째로 시야에서 사라진다.** 테스트는 "revoke 가 있다" 를 단언하므로, 누가 revoke 를 지워도
   * 옛 제거기 위에서는 그 단언이 여전히… 아니, **애초에 그 텍스트를 보지 못한다.** 새 제거기는 본다.
   */
  const REVOKE = "revoke all on function public.guard() from public, anon, authenticated;";
  const GRANT = "grant execute on function public.guard() to service_role;";
  const BREACH = [
    "create or replace function public.guard() returns void",
    "language plpgsql security definer",
    "set search_path = public, pg_temp",
    "as $$",
    "begin",
    "  if current_setting('bestour.flag', true) like '%/*%' then",
    "    raise exception 'flag -- 가짜 줄 주석 모양';",
    "  end if;",
    "end",
    "$$;",
    REVOKE,
    "/* 진짜 블록 주석 — 옛 정규식은 여기의 닫는 짝까지를 하나의 주석으로 읽었다 */",
    GRANT,
  ].join("\n");

  test("옛 정규식 제거기는 revoke 문과 raise 문을 지웠다 (이 테스트가 증거다)", () => {
    const legacy = legacySqlStrip(BREACH);
    expect(legacy.includes(REVOKE), "옛 제거기가 revoke 를 남겼다면 재현이 틀린 것이다").toBe(false);
    expect(legacy).not.toContain("raise exception");
    expect(legacy).toContain(GRANT);
  });

  test("새 제거기는 revoke·raise·본문 문자열을 전부 남기고 진짜 주석만 지운다", () => {
    const stripped = sql(BREACH);
    expect(stripped).toContain(REVOKE);
    expect(stripped).toContain(GRANT);
    expect(stripped).toContain("like '%/*%'");
    expect(stripped).toContain("raise exception 'flag -- 가짜 줄 주석 모양';");
    expect(stripped).not.toContain("진짜 블록 주석");
  });

  test("같은 줄의 문자열 속 `--` 뒤 revoke — 옛 제거기는 줄 뒤쪽을 잘랐다", () => {
    const line = "select '--'; revoke insert on public.reservations from anon; -- 진짜 주석";
    expect(legacySqlStrip(line)).not.toContain("revoke");
    const stripped = sql(line);
    expect(stripped).toContain("revoke insert on public.reservations from anon;");
    expect(stripped).not.toContain("진짜 주석");
  });

  test("데이터 달러 인용(`is $c$ … $c$`) 속 `--`·`/*` 는 지워지지 않는다 — 옛 제거기는 지웠다", () => {
    const src = "comment on function public.guard() is $c$ -- 설명 데이터 /* 도 데이터 */ $c$;\nselect 1;";
    const legacy = legacySqlStrip(src);
    expect(legacy).not.toContain("설명 데이터");
    const stripped = sql(src);
    expect(stripped).toContain("$c$ -- 설명 데이터 /* 도 데이터 */ $c$");
  });

  test("반대 방향도 막는다 — **코드 본문** 안에서 주석 처리된 revoke 는 코드가 아니다(단언을 만족시키지 못한다)", () => {
    const src = ["do $$", "begin", "  -- revoke all on public.reservations from anon;", "  perform 1;", "end", "$$;"].join("\n");
    const stripped = sql(src);
    expect(stripped).not.toContain("revoke");
    expect(stripped).toContain("perform 1;");
    // 데이터 문자열처럼 통째로 남겼다면 주석 처리된 문장이 "revoke 가 있다" 단언을 통과시켰을 것이다
    expect(src).toContain("revoke");
  });
});

describe("7-2. 경계 사례", () => {
  test.for([
    ["중첩 블록 주석은 하나다", "/* 바깥 /* 안쪽 */ 아직 주석 */ select 1;", ["select 1;"], ["바깥", "안쪽", "아직 주석"]],
    ["태그 달러 인용 — 안쪽 $$ 는 닫지 않는다", "do $body$ begin raise notice $$ -- 데이터 $$; end $body$; -- 꼬리", ["$$ -- 데이터 $$", "end $body$;"], ["꼬리"]],
    ["태그 불일치는 닫지 않는다", "select $a$ x $b$ -- 데이터 $a$; -- 꼬리", ["$a$ x $b$ -- 데이터 $a$;"], ["꼬리"]],
    ["$1 위치 매개변수는 태그가 아니다", "create function f(int) returns int language sql as $$ select $1 + 1 -- 본문 주석\n $$;", ["select $1 + 1", "$$;"], ["본문 주석"]],
    ["식별자 속 $ 는 인용이 아니다", "select col$1, x$y$ from t; -- 꼬리", ["col$1, x$y$ from t;"], ["꼬리"]],
    ["'' 이스케이프", "select 'it''s -- 문자열 /* 도 */', 1; -- 꼬리", ["'it''s -- 문자열 /* 도 */', 1;"], ["꼬리"]],
    ["E'\\'' 백슬래시 이스케이프", "select E'\\' -- 문자열', 1; -- 꼬리", ["E'\\' -- 문자열', 1;"], ["꼬리"]],
    ["일반 문자열의 백슬래시는 글자다 — '\\' 는 거기서 닫힌다", "select '\\' -- 꼬리", ["select '\\'"], ["꼬리"]],
    ["식별자 끝 e 는 E 접두사가 아니다", "select namee'x' -- 꼬리", ["namee'x'"], ["꼬리"]],
    ["큰따옴표 식별자와 \"\" 이스케이프", 'select "a--b"" /* c", 1; -- 꼬리', ['"a--b"" /* c", 1;'], ["꼬리"]],
    ["코드 본문 안의 문자열 속 -- 는 남는다", "do $$ begin raise notice '-- 남는다'; end $$; -- 꼬리", ["'-- 남는다'"], ["꼬리"]],
    ["do language plpgsql 도 코드 본문이다", "do language plpgsql $$ begin -- 본문 주석\n null; end $$;", ["null; end $$;"], ["본문 주석"]],
    ["as 가 대문자여도 코드 본문이다", "CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $fn$ select 1 /* 본문 주석 */ $fn$;", ["select 1", "$fn$;"], ["본문 주석"]],
    ["코드 본문 안의 execute $q$ 는 데이터다", "do $$ begin execute $q$ select 1 -- 동적 SQL $q$; end $$;", ["$q$ select 1 -- 동적 SQL $q$"], []],
    ["주석 속 따옴표·달러는 아무것도 열지 않는다", "-- it's $$ 열리지 않는다\nselect 1; /* ' \" $x$ */ select 2;", ["select 1;", "select 2;"], ["열리지"]],
  ] as const)("%s", ([, src, keep, gone]) => {
    const stripped = sql(src);
    for (const k of keep) expect(stripped, `남아야 한다: ${k}`).toContain(k);
    for (const g of gone) expect(stripped, `지워져야 한다: ${g}`).not.toContain(g);
    expect(stripped.length, "제자리 공백 처리 — 길이 보존").toBe(src.length);
  });

  test("옛 정규식은 중첩 블록 주석의 꼬리를 코드로 남겼다 (대조)", () => {
    expect(legacySqlStrip("/* 바깥 /* 안쪽 */ 아직 주석 */ select 1;")).toContain("아직 주석");
  });

  test("줄 번호 보존 — LF·CRLF 모두 개행 수와 표식 줄이 같다", () => {
    const src = ["select 1;", "/* 여러 줄", "   주석 */", "do $$", "begin -- 본문 주석", "  perform 2;", "end $$;", "-- 꼬리", "select 3; -- marker"].join("\n");
    for (const s of [src, src.replace(/\n/g, "\r\n")]) {
      const stripped = sql(s);
      expect(newlines(stripped)).toBe(newlines(s));
      expect(stripped.split(/\r?\n/).findIndex((l) => l.includes("select 3;"))).toBe(8);
      expect(stripped.split(/\r?\n/).findIndex((l) => l.includes("perform 2;"))).toBe(5);
    }
  });
});

/**
 * **검증기**(제거기가 아니다): 스캐너가 공백으로 바꾼 원문 조각이 **주석으로만** 이루어졌는지 본다.
 * 바뀐 위치를 원문 공백만 사이에 둔 덩어리로 묶고, 각 덩어리가 `--…(줄 끝)` 와 `/* … *\/`(중첩) 의 나열인지 읽는다.
 * 반환: 주석이 아닌 것이 지워진 덩어리(위치·원문).
 */
function blankedNonComments(src: string, stripped: string): string[] {
  const changed: number[] = [];
  for (let k = 0; k < src.length; k++) if (stripped[k] !== src[k]) changed.push(k);
  const problems: string[] = [];
  let g = 0;
  while (g < changed.length) {
    let h = g;
    while (h + 1 < changed.length && /^\s*$/.test(src.slice(changed[h] + 1, changed[h + 1]))) h += 1;
    const s = changed[g];
    const e = changed[h] + 1;
    const seg = src.slice(s, e);
    let p = 0;
    let ok = true;
    while (p < seg.length && ok) {
      if (/\s/.test(seg[p])) p += 1;
      else if (seg.startsWith("--", p)) {
        while (p < seg.length && seg[p] !== "\n" && seg[p] !== "\r") p += 1;
      } else if (seg.startsWith("/*", p)) {
        let depth = 0;
        do {
          if (seg.startsWith("/*", p)) {
            depth += 1;
            p += 2;
          } else if (seg.startsWith("*/", p)) {
            depth -= 1;
            p += 2;
          } else p += 1;
        } while (depth > 0 && p < seg.length);
        if (depth > 0) ok = false;
      } else ok = false;
    }
    if (!ok) problems.push(`@${s}: ${JSON.stringify(seg.slice(0, 80))}`);
    g = h + 1;
  }
  return problems;
}

describe("7-3. 저장소의 실제 SQL 전부 — throw 0 · 개행 수 보존 · 길이 보존", () => {
  const MIGRATIONS = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
  const ROLLBACKS = readdirSync(path.join(ROOT, "supabase/rollbacks")).filter((f) => f.endsWith(".sql"));
  const all = [
    ...MIGRATIONS.map((f) => `supabase/migrations/${f}`),
    ...ROLLBACKS.map((f) => `supabase/rollbacks/${f}`),
  ];

  test("마이그레이션이 17개 이상 있다 (목록이 비어 통과하지 않는다)", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(17);
    expect(ROLLBACKS.length).toBeGreaterThanOrEqual(16);
  });

  test.for(all.map((f) => [f] as const))("%s", ([rel]) => {
    const src = read(rel);
    const stripped = stripComments(src, rel);
    expect(newlines(stripped)).toBe(newlines(src));
    expect(stripped.length).toBe(src.length);
    // 바뀐 자리는 전부 공백이고, **바뀐 자리의 원문은 주석뿐이다**(GPT 검증 P2: 공백인지만 보면 실행 코드를 지워도 통과했다)
    for (let k = 0; k < src.length; k++) {
      if (stripped[k] !== src[k]) expect(stripped[k], `${rel} @${k}`).toBe(" ");
    }
    expect(blankedNonComments(src, stripped), rel).toEqual([]);
  });

  test("검증기 자체의 이빨 — 주석 옆의 실행 코드를 지우면 잡는다", () => {
    const src = "select 1; -- 주석\ngrant all on t to anon;\n/* 블록 */ revoke all on t from anon;";
    const honest = sql(src);
    expect(blankedNonComments(src, honest)).toEqual([]);
    const blankRange = (s: string, from: number, to: number) =>
      s.slice(0, from) + " ".repeat(to - from) + s.slice(to);
    const g = src.indexOf("grant");
    const r = src.indexOf("revoke");
    expect(blankedNonComments(src, blankRange(honest, g, g + 5)).length).toBeGreaterThan(0);
    expect(blankedNonComments(src, blankRange(honest, r, r + 6)).length).toBeGreaterThan(0);
  });

  test("달러 인용 본문이 실제로 있다 — 이 픽스처가 공허하지 않다", () => {
    const withBodies = all.filter((rel) => /\$\$/.test(read(rel)));
    expect(withBodies.length).toBeGreaterThanOrEqual(20);
  });
});

describe("7-4. 닫히지 않은 구조는 throw 한다", () => {
  test.for([
    ["닫히지 않은 문자열", "select 'abc;"],
    ["E 문자열에서 백슬래시가 따옴표를 삼킨 경우", "select E'abc\\';"],
    ["닫히지 않은 큰따옴표 식별자", 'select "abc;'],
    ["닫히지 않은 블록 주석", "select 1; /* 끝나지 않는다"],
    ["중첩 블록 주석이 한 겹만 닫힌 경우", "/* 바깥 /* 안쪽 */ select 1;"],
    ["닫히지 않은 달러 인용", "do $$ begin perform 1; end;"],
    ["태그가 다른 짝으로는 닫히지 않는다", "do $body$ begin perform 1; end $bodyx$;"],
    ["코드 본문 안의 닫히지 않은 문자열", "do $$ begin raise notice 'abc; end $$;"],
    ["코드 본문 안의 닫히지 않은 블록 주석", "do $$ begin /* abc end $$; */"],
  ] as const)("%s → throw", ([, src]) => {
    expect(() => sql(src)).toThrow(StripCommentsError);
  });

  test("throw 메시지에 파일:줄이 들어 있다", () => {
    expect(() => stripComments("select 1;\n\nselect 'abc;", "supabase/migrations/9999_x.sql")).toThrow(
      /supabase\/migrations\/9999_x\.sql:3/,
    );
  });

  test("줄 주석이 개행 없이 파일 끝에서 끝나는 것은 정상이다", () => {
    expect(sql("select 1; -- 끝")).toBe("select 1;     ".padEnd("select 1; -- 끝".length, " "));
  });

  test("CR 전용 줄바꿈에서도 오류 줄 번호가 맞다 (GPT 검증 P2)", () => {
    expect(() => stripComments("select 1;\r\rselect 'unterminated", "x.sql")).toThrow(/x\.sql:3:/);
    expect(() => stripComments("select 1;\r\n\r\nselect 'unterminated", "x.sql")).toThrow(/x\.sql:3:/);
  });
});

// =============================================================================
// 7-5. GPT 검증 후속 (2026-09-17) — 외부 모델이 **실제 헬퍼로** 재현한 P1 세 건. 입력은 받은 그대로다.
// =============================================================================
/**
 * 세 건 모두 스캐너 수정 **전** 에는 결함 쪽으로 동작했다(보고서 §GPT 검증 후속에 전/후 출력):
 *   P1-1 이어붙인 `E''` 조각의 이스케이프 모드를 조각마다 새로 정해 **실제 GRANT 를 지웠다**(숨김 방향 — 가장 위험)
 *   P1-2 본문 판별이 출력 꼬리 200자에 기대 **긴 주석 하나로 뒤집혔고**, `do language "plpgsql"` 를 몰랐다
 *   P1-3 작은따옴표 본문(`as '…'` · `DO '…'`)을 통째로 데이터로 봤다
 * P1-2·P1-3 은 "주석 처리된 revoke 가 살아남아 텍스트 단언을 만족시키는" 방향이다.
 *
 * ⚠️ 이 절이 증명하지 않는 것(P1-4): 스캐너가 **데이터 인용을 옳게 보존**하면 `comment on … is $c$ revoke … $c$` 의
 * 글자도 남는다. "회수 문이 있다" 를 부분 문자열로 찾는 소비자는 그것을 센다 — 주석 제거로는 실행을 증명할 수 없다.
 * 실제 권한의 1차 방어선은 `tests/db-privilege-gate.test.ts`(카탈로그 실측)와 마이그레이션 자기검증 블록이다.
 */
describe("7-5. GPT 검증 후속 — P1 회귀 픽스처", () => {
  const REVOKE = "revoke insert, update, delete, truncate on table notifications_log from anon, authenticated;";
  const GRANT = "grant update on table notices to anon;";

  describe("P1-1 문자열 상수 이어붙이기 — 이스케이프 모드가 이어진다", () => {
    test("Codex 입력 그대로 — `E'a'⏎'\\' -- data'` 뒤의 GRANT 가 보인다 (옛 판: 지웠다)", () => {
      const src = "select E'a'\n'\\' -- data'; grant update on table notices to anon;";
      const stripped = sql(src);
      expect(stripped).toContain(GRANT);
      expect(stripped, "`-- data` 는 문자열 내용이다").toContain("'\\' -- data'");
    });

    test("Codex 입력 그대로 — 이어진 조각이 닫히지 않으면 throw (옛 판: 나머지를 조용히 삼켰다)", () => {
      expect(() => sql("select E'a'\n'\\' -- unterminated")).toThrow(StripCommentsError);
    });

    test("조각 사이의 `--` 주석은 진짜 주석이다 (가로 공백 뒤 · 줄바꿈 뒤 둘 다)", () => {
      const src = "select E'a' -- 앞 주석\n  -- 뒤 주석\n'\\' -- 글자';\nselect 1; -- 꼬리";
      const stripped = sql(src);
      expect(stripped).not.toContain("앞 주석");
      expect(stripped).not.toContain("뒤 주석");
      expect(stripped).toContain("'\\' -- 글자'");
      expect(stripped).not.toContain("꼬리");
      expect(stripped.length).toBe(src.length);
    });

    test("줄바꿈이 없으면 이어지지 않는다 — 뒤 조각은 일반 문자열이다", () => {
      const stripped = sql("select E'a' '\\' -- 꼬리");
      expect(stripped).toContain("'\\'");
      expect(stripped).not.toContain("꼬리");
    });

    test("일반 문자열의 이어붙이기는 일반 모드 그대로다", () => {
      const stripped = sql("select 'a'\n'\\' -- 꼬리");
      expect(stripped).not.toContain("꼬리");
    });

    test("금지 GRANT 의 **거짓 통과** 방향 — 옛 정규식은 GRANT 를 지워 '금지 GRANT 없음' 을 통과시켰다 (GPT 검증 P2)", () => {
      const src = ["do $$ begin raise notice '/* 설명'; end $$;", GRANT, "/* 설명 끝 */"].join("\n");
      const forbidden = /grant\s+update\s+on\s+table\s+notices\s+to\s+anon/;
      expect(forbidden.test(legacySqlStrip(src)), "옛 제거기 위에서 금지 GRANT 검사가 통과해 버린다").toBe(false);
      expect(forbidden.test(sql(src)), "새 제거기 위에서는 금지 GRANT 가 보인다 → 검사가 실패한다").toBe(true);
    });
  });

  describe("P1-2 본문 판별은 토큰으로 — 주석 길이·언어 이름 표기와 무관", () => {
    test("Codex 입력 그대로 — `do /*200자*/ $$` 의 주석 처리된 revoke 는 지워진다", () => {
      const src = "do /*" + "x".repeat(200) + "*/ $$ begin\n" + "-- " + REVOKE + "\n" + "null; end; $$;";
      const stripped = sql(src);
      expect(stripped).not.toContain("revoke");
      expect(stripped).toContain("null; end; $$;");
    });

    test("Codex 입력 그대로 — `do language \"plpgsql\" $$` 도 코드 본문이다", () => {
      const src = 'do language "plpgsql" $$\nbegin\n  -- ' + REVOKE + "\n  null;\nend;\n$$;";
      expect(sql(src)).not.toContain("revoke");
    });

    test("Codex 입력 그대로 — 판별이 빗나가 본문 미종결 검사를 건너뛰지 않는다", () => {
      expect(() => sql("do " + " ".repeat(201) + "$$ begin /* unterminated $$;")).toThrow(StripCommentsError);
    });

    test("줄 주석·여러 줄 공백이 끼어도 같다", () => {
      const src = "do -- 설명\n" + "\n".repeat(50) + "-- 또 설명\n$$ begin -- " + REVOKE + "\n null; end $$;";
      expect(sql(src)).not.toContain("revoke");
    });

    test("`as` · `do` 가 아닌 자리의 인용은 여전히 데이터다", () => {
      const src = "comment on table t is $c$ -- 데이터 $c$; select 'x -- 데이터';";
      expect(sql(src)).toContain("$c$ -- 데이터 $c$");
      expect(sql(src)).toContain("'x -- 데이터'");
    });
  });

  describe("P1-3 작은따옴표 본문도 코드로 훑는다", () => {
    test("Codex 입력 그대로 — `create function … as '…'` 의 주석 처리된 revoke 는 지워진다", () => {
      const src = "create function f() returns void language plpgsql as '\nbegin\n  -- " + REVOKE + "\n  null;\nend;\n';";
      const stripped = sql(src);
      expect(stripped).not.toContain("revoke");
      expect(stripped).toContain("null;");
      expect(stripped.length).toBe(src.length);
    });

    test("Codex 형태 그대로 — `DO '…'` 도 같다", () => {
      const stripped = sql("DO 'begin\n-- " + REVOKE + "\nnull; end;';");
      expect(stripped).not.toContain("revoke");
      expect(stripped).toContain("null; end;';");
    });

    test("본문 안의 `''` 는 풀린 뒤 문자열이다 — 그 안의 `--` 는 남고 진짜 주석만 지워진다", () => {
      const src = "create function g() returns text language sql as 'select ''-- 데이터''::text -- 본문 주석\n';";
      const stripped = sql(src);
      expect(stripped).toContain("''-- 데이터''::text");
      expect(stripped).not.toContain("본문 주석");
    });

    test("E 문자열 본문 — `\\n` 이스케이프가 줄 주석을 끝낸다", () => {
      const src = "do E'begin -- 주석\\nnull; end;';";
      const stripped = sql(src);
      expect(stripped).not.toContain("주석");
      expect(stripped).toContain("\\nnull; end;';");
    });

    test("작은따옴표 본문 안의 닫히지 않은 문자열·주석은 throw", () => {
      expect(() => sql("do 'begin raise notice ''x; end;';")).toThrow(StripCommentsError);
      expect(() => sql("do 'begin /* x end;';")).toThrow(StripCommentsError);
    });

    test("이어붙인 작은따옴표 본문 — 조각 사이 주석은 지우고 조각을 이어 읽는다", () => {
      // 첫 조각이 줄바꿈으로 끝나야 본문 주석이 거기서 끝난다(이어붙인 상수에는 조각 사이 줄바꿈이 들어가지 않는다)
      const src = "do 'begin -- 본문 주석\n'\n-- 조각 사이\n' null; end;';";
      const stripped = sql(src);
      expect(stripped).not.toContain("본문 주석");
      expect(stripped).not.toContain("조각 사이");
      expect(stripped).toContain("' null; end;';");
    });
  });
});

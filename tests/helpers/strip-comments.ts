/**
 * 주석 제거기 — **하나뿐인 구현** (P6-7 · known-defects D7).
 *
 * 왜 정규식을 버렸나
 * ---------------------------------------------------------------------------
 * 이 저장소의 게이트들은 "소스에서 주석을 걷어낸 뒤 금지 패턴을 찾는다" 는 모양을 공유한다.
 * 그 제거기가 정규식이면 **문자열 리터럴 속 `/*` 를 블록 주석 시작으로 읽는다.** 글로브 패턴
 * 문자열(예: 경로 패턴 `components/` + 별표 두 개)이 있는 파일은 그 지점부터 다음 블록 주석
 * 닫는 짝까지가 **스캔에서 통째로 사라진다.** 게이트가 눈을 감고 green 을 낸다.
 *
 * 가정이 아니라 실제로 뚫렸다(P6-6 독립 리뷰 M-1, 2026-09-16):
 * 배포되는 소스 `app/[locale]/(site)/fares/page.tsx` 에 글로브 패턴 문자열과 비교 광고 문장을
 * 함께 심자 `vitest 219 passed` + `셸 게이트 exit 0` 으로 **두 게이트를 모두 통과했다.**
 * 같은 문장을 가짜 주석 짝 없이 심으면 3건이 빨갛게 떴다 — 원인은 문장이 아니라 제거기였다.
 *
 * **이 저장소에서 세 번째 같은 교훈이다.** 관리자 인가 게이트(scripts/check-admin-gate.mjs)가
 * 정규식으로 두 번 무력화된 뒤 TypeScript AST 로 바꿔 해결했다. 그 파일의 헤더가 규범이다:
 * *"정규식은 자바스크립트를 이해하지 못한다."* 문자열·템플릿·정규식 리터럴·이스케이프를
 * 정규식으로 구분하려는 시도를 네 번째로 반복하지 않는다. **파서가 이미 푼 문제다.**
 *
 * 계약
 * ---------------------------------------------------------------------------
 *   stripComments(src, fileName) -> 주석이 제거된 소스 문자열
 *
 *   · **줄 번호가 보존된다.** 게이트는 파일:줄을 보고한다. 그래서 주석을 "지우는" 대신
 *     주석 자리의 문자를 공백으로 바꾸고 개행(`\n`·`\r`)은 그대로 남긴다 —
 *     제거 전후의 개행 수·줄 수·열 위치가 모두 같다.
 *   · **파싱에 실패하면 throw 한다.** 조용히 원문을 돌려주지 않는다. 조용한 폴백이
 *     바로 D7 이 고치려는 병이다 — 게이트는 눈이 멀면 빨개져야 한다.
 *   · 확장자로 문법을 고른다: `.tsx`/`.jsx` 는 JSX, 그 밖의 TS/JS 는 TS, `.css`/`.scss` 는 CSS.
 *     모르는 확장자는 **추측하지 않고** throw 한다.
 *
 * 왜 `.ts` 를 TSX 로 읽지 않나: `.ts` 의 제네릭 화살표(`<T>(x: T) => x`)는 TSX 문법에서 JSX 여는
 * 태그로 읽혀 **정상 파일이 파싱 오류**가 된다. 반대로 `.tsx` 를 TS 로 읽으면 JSX 가 오류다.
 * 확장자가 답을 갖고 있으므로 확장자로 고른다(check-admin-gate 는 저장소 전체를 TSX 하나로 읽지만
 * 그쪽은 진단을 보지 않는다 — 여기는 진단을 실패로 쓰므로 문법을 정확히 골라야 한다).
 */
import ts from "typescript";

/** 파싱 실패·미지원 입력. 게이트가 이 예외를 잡아 삼키지 않도록 별도 타입으로 둔다. */
export class StripCommentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripCommentsError";
  }
}

const TS_JSX_EXT = new Set([".tsx", ".jsx"]);
const TS_EXT = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const CSS_EXT = new Set([".css", ".scss"]);

/** 경로에서 확장자(소문자). `a/b.module.css` → `.css` · `x.test.ts` → `.ts` */
function extensionOf(fileName: string): string {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot).toLowerCase();
}

/** 주석 자리를 같은 길이의 공백으로 — 개행만 남긴다(줄 번호·열 보존). */
function blank(slice: string): string {
  return slice.replace(/[^\n\r]/g, " ");
}

/**
 * TypeScript 파서의 구문 진단. `parseDiagnostics` 는 공개 타입에 없는 내부 속성이라
 * **읽을 수 없으면 그것도 실패로 본다** — "진단이 없다" 와 "진단을 못 봤다" 를 같게 취급하면
 * 조용한 폴백이 되살아난다.
 */
function parseDiagnosticsOf(sourceFile: ts.SourceFile, fileName: string): readonly ts.Diagnostic[] {
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: unknown }).parseDiagnostics;
  if (!Array.isArray(diagnostics)) {
    throw new StripCommentsError(
      `${fileName}: TypeScript 의 parseDiagnostics 를 읽을 수 없다 — 내부 API 가 바뀌었다. ` +
        "구문 오류를 감지하지 못한 채 통과시키지 않기 위해 여기서 멈춘다.",
    );
  }
  return diagnostics as readonly ts.Diagnostic[];
}

/** 모든 토큰(구두점 포함)을 훑는다. 주석은 어떤 토큰의 **선행 트리비아**로 반드시 한 번 나타난다. */
function forEachToken(node: ts.Node, sourceFile: ts.SourceFile, visit: (token: ts.Node) => void): void {
  const children = node.getChildren(sourceFile);
  if (children.length === 0) {
    visit(node);
    return;
  }
  for (const child of children) forEachToken(child, sourceFile, visit);
}

function stripTsComments(src: string, fileName: string, scriptKind: ts.ScriptKind): string {
  const sourceFile = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, /* setParentNodes */ true, scriptKind);

  const diagnostics = parseDiagnosticsOf(sourceFile, fileName);
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    const where =
      typeof first.start === "number"
        ? `:${sourceFile.getLineAndCharacterOfPosition(first.start).line + 1}`
        : "";
    throw new StripCommentsError(
      `${fileName}${where}: 구문 분석 실패(진단 ${diagnostics.length}건) — ` +
        `${ts.flattenDiagnosticMessageText(first.messageText, " ")} ` +
        "주석 제거기가 원문을 그대로 돌려주면 게이트가 눈을 감는다. 그래서 통과시키지 않는다.",
    );
  }

  const ranges: ts.CommentRange[] = [];
  const seen = new Set<number>();
  forEachToken(sourceFile, sourceFile, (token) => {
    // JsxText 안의 `//`·`/*` 는 트리비아가 아니라 **화면에 보이는 글자**다. 트리비아로 읽지 않는다.
    if (token.kind === ts.SyntaxKind.JsxText) return;
    // 트리비아 구간은 [앞 토큰의 끝, 이 토큰의 시작) = [token.pos, token.getStart()) 이다.
    // getLeadingCommentRanges 는 **첫 줄바꿈 뒤부터** 모으고(그래서 줄 끝 주석을 돌려주지 않는다),
    // getTrailingCommentRanges 는 **첫 줄바꿈까지만** 모은다. 둘의 합집합이 그 구간 전체다.
    // (이 합집합을 빠뜨리면 `const x = 1; // 주석` 의 줄 끝 주석이 살아남는다 — 관리자 게이트가 F3 으로 겪은 그 자리다.)
    for (const range of [
      ...(ts.getTrailingCommentRanges(src, token.pos) ?? []),
      ...(ts.getLeadingCommentRanges(src, token.pos) ?? []),
    ]) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      ranges.push(range);
    }
  });

  ranges.sort((a, b) => a.pos - b.pos);

  let out = "";
  let cursor = 0;
  for (const range of ranges) {
    if (range.pos < cursor) continue; // 겹치는 구간(있을 수 없지만) 은 앞선 것이 이긴다
    out += src.slice(cursor, range.pos);
    out += blank(src.slice(range.pos, range.end));
    cursor = range.end;
  }
  out += src.slice(cursor);
  return out;
}

/**
 * CSS 에는 파서가 없다(새 패키지 금지). 대신 **정규식이 아니라 한 글자씩 읽는 스캐너**를 쓴다 —
 * CSS 에서 `/*` 를 가릴 수 있는 문맥은 따옴표 문자열 하나뿐이고, 줄 주석(`//`)은 문법에 없다.
 * 닫히지 않은 블록 주석은 **throw** 한다(정규식판은 이때 조용히 아무것도 지우지 않았다).
 */
function stripCssComments(src: string, fileName: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < src.length) {
        const c = src[i];
        out += c;
        i += 1;
        if (c === "\\" && i < src.length) {
          out += src[i];
          i += 1;
        } else if (c === quote || c === "\n") {
          break; // CSS 문자열은 줄을 넘지 못한다
        }
      }
      continue;
    }

    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) {
        throw new StripCommentsError(`${fileName}: 닫히지 않은 CSS 블록 주석 — 파일 끝까지 삼킨 채 통과시키지 않는다.`);
      }
      out += blank(src.slice(i, end + 2));
      i = end + 2;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 주석을 제거한 소스를 돌려준다. 줄 번호는 보존되고, 파싱에 실패하면 throw 한다.
 *
 * @param src      원본 소스
 * @param fileName 문법 선택과 오류 메시지에 쓰는 파일 경로(확장자가 필요하다)
 */
export function stripComments(src: string, fileName: string): string {
  const ext = extensionOf(fileName);
  if (TS_JSX_EXT.has(ext)) return stripTsComments(src, fileName, ts.ScriptKind.TSX);
  if (TS_EXT.has(ext)) return stripTsComments(src, fileName, ts.ScriptKind.TS);
  if (CSS_EXT.has(ext)) return stripCssComments(src, fileName);
  throw new StripCommentsError(
    `${fileName}: 주석 문법을 모르는 확장자(${ext || "(없음)"}) — 추측해서 통과시키지 않는다. ` +
      "지원: .ts .tsx .js .jsx .mts .cts .mjs .cjs .css .scss",
  );
}

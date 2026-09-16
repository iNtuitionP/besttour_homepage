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
 *   · 확장자로 문법을 고른다: `.tsx`/`.jsx` 는 JSX, 그 밖의 TS/JS 는 TS, `.css`/`.scss` 는 CSS,
 *     `.sql` 은 PostgreSQL(P6-11). 모르는 확장자는 **추측하지 않고** throw 한다.
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

// =============================================================================
// PostgreSQL (P6-11 · GPT 검증 후속 P1-1~3 반영)
// =============================================================================

/** 식별자 첫 글자. PostgreSQL 은 ASCII 밖의 글자(한글 등, 코드 0x80 이상)도 식별자에 허용한다. */
function isSqlIdentStart(c: string | undefined): boolean {
  if (c === undefined) return false;
  const code = c.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code >= 0x80;
}

/** 식별자 둘째 글자부터. 숫자와 `$` 가 더해진다(`a$b` 는 식별자 하나다). */
function isSqlIdentChar(c: string | undefined): boolean {
  if (c === undefined) return false;
  const code = c.charCodeAt(0);
  return isSqlIdentStart(c) || (code >= 48 && code <= 57) || code === 36;
}

/** PostgreSQL 어휘의 `space` = [ \t\n\r\f\v] · `horiz_space` = [ \t\f] · `newline` = [\n\r] */
const isSqlSpace = (c: string | undefined) =>
  c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
const isHorizSpace = (c: string | undefined) => c === " " || c === "\t" || c === "\f";
const isNewline = (c: string | undefined) => c === "\n" || c === "\r";

/** 줄 번호(1부터) — 오류 메시지용. `\r\n` · `\n` · `\r` 을 각각 한 줄바꿈으로 센다(CR 전용 입력 포함). */
function lineAt(src: string, index: number): number {
  let line = 1;
  for (let k = 0; k < index && k < src.length; k++) {
    if (src[k] === "\r") {
      line += 1;
      if (src[k + 1] === "\n" && k + 1 < index) k += 1;
    } else if (src[k] === "\n") {
      line += 1;
    }
  }
  return line;
}

/** 의미 있는 토큰 — 달러·작은따옴표 인용이 **코드 본문**인지 판정하는 데만 쓴다. 주석·공백은 토큰이 아니다. */
type SqlToken = { kind: "word"; value: string } | { kind: "qident" } | { kind: "other"; value: string };

/**
 * 데이터 인용을 어떻게 보여 줄지 (GPT 검증 P1-4 · 소비자 설계).
 *   · `keep`       — 데이터 인용의 내용을 **그대로** 둔다(주석만 지운다). `stripComments()` 의 동작이다.
 *                    **부재 단언**("금지 grant 가 없다")에 쓴다 — `execute 'grant …'` 같은 동적 SQL 까지 보여야 한다.
 *   · `executable` — 실행되는 글자만 남긴다. 데이터 인용의 내용은 공백 처리하되, **`execute` 의 인자**
 *                    (`execute '…'` · `execute format('…', …)` 의 첫 인자)는 실행될 SQL 이므로 남기고
 *                    그 안의 주석도 지운다. **문장 존재 단언**("회수 문이 있다")에 쓴다 — `comment on … is $c$ revoke … $c$` 나
 *                    동적 SQL 속 주석 처리된 revoke 가 존재를 만족시키지 못하게.
 *                    인자 조각이 SQL 로 닫히지 않으면(`'where x = ''' || v` 처럼 이어 붙이는 조각) 알 수 없으므로
 *                    **숨긴다** — 존재 단언에게 숨김은 "실패" 쪽이라 안전하다.
 *                    한계: 변수를 거치는 동적 SQL(`execute v_sql`)은 추적하지 못한다.
 */
export type SqlDataMode = "keep" | "executable";

/** 인용 바로 앞 토큰 열이 `execute` 의 인자 자리인가 — `execute <인용>` · `execute format ( <인용>` */
function isExecArgPosition(tokens: readonly SqlToken[]): boolean {
  const n = tokens.length;
  const isWord = (k: number, v: string) => {
    const t = tokens[k];
    return t !== undefined && t.kind === "word" && t.value === v;
  };
  if (isWord(n - 1, "execute")) return true;
  const paren = tokens[n - 1];
  return paren !== undefined && paren.kind === "other" && paren.value === "(" && isWord(n - 2, "format") && isWord(n - 3, "execute");
}

/**
 * 인용 바로 앞의 토큰 열이 본문 자리인가.
 *   · `… as <인용>` — `create function|procedure … as '…'` · `as $$ … $$`
 *   · `do <인용>` · `do language <식별자|"식별자"> <인용>`
 * 문자 수 창이 아니라 **토큰**으로 본다 — 주석이 아무리 길어도(주석은 토큰이 아니다) 판정이 바뀌지 않는다.
 */
function isCodeBodyPosition(tokens: readonly SqlToken[]): boolean {
  const n = tokens.length;
  const word = (k: number, v: string) => {
    const t = tokens[k];
    return t !== undefined && t.kind === "word" && t.value === v;
  };
  if (word(n - 1, "as") || word(n - 1, "do")) return true;
  const lang = tokens[n - 1];
  return n >= 3 && (lang?.kind === "word" || lang?.kind === "qident") && word(n - 2, "language") && word(n - 3, "do");
}

/** 디코딩된 본문 문자열 — 글자마다 원문(`text`) 위치 목록을 들고 다닌다(`''` 는 원문 두 글자가 한 글자가 된다). */
type Decoded = { text: string; origin: number[][] };

/**
 * PostgreSQL 에도 파서가 없다(새 패키지 금지). CSS 분기처럼 **한 글자씩 읽는 상태 기계**다 — 정규식이 아니다.
 *
 * 정규식판(블록 주석 정규식 + `--` 부터 줄 끝까지 지우던 두 줄)이 틀리던 자리와 여기서의 처리:
 *   · **문자열 속 `--`·`/*`** — `'…'`(`''`) · `E'…'`(백슬래시 이스케이프) · `U&'…'` · `"…"`(`""`) 안의 주석 모양은 글자다.
 *   · **문자열 상수 이어붙이기** — `'a'` 와 `'b'` 사이에 공백만 있고 **줄바꿈이 하나 이상** 있으면 한 상수다
 *     (PostgreSQL `whitespace_with_newline`: 가로 공백·`--` 주석 → 줄바꿈 → 공백·`--주석+줄바꿈` 반복).
 *     **이스케이프 모드는 첫 조각을 따라 이어진다** — `E'a'⏎'\' -- 글자'` 의 `-- 글자` 는 주석이 아니다(GPT 검증 P1-1:
 *     조각마다 모드를 새로 정하면 뒤따르는 실제 `grant` 를 지웠다). 조각 사이의 `--` 주석은 진짜 주석이라 지운다.
 *   · **달러 인용** `$$ … $$` · `$tag$ … $tag$` — 바깥 경계는 PostgreSQL 그대로 **태그가 정확히 같은 다음 자리**다.
 *     `$1` 위치 매개변수는 태그가 아니고, `a$b$` 는 식별자다.
 *   · **본문 인용** — 인용 바로 앞 **토큰 열**이 `as` · `do` · `do language <이름>` 이면 그 인용(달러든 작은따옴표든)은
 *     실행될 **코드**다. 안쪽을 같은 스캐너로 다시 훑는다(PL/pgSQL 본문의 `--` 는 실행 시에도 주석이다 — 남기면
 *     주석 처리된 `-- revoke …` 가 텍스트 단언을 만족시킨다). 작은따옴표 본문은 **디코딩한 뒤**(`''`→`'`, E 문자열은
 *     백슬래시 이스케이프까지) 훑고, 지울 자리를 원문 위치로 되돌려 공백 처리한다(GPT 검증 P1-2·P1-3).
 *     그 밖의 인용(`is $c$ … $c$`, `execute $q$ … $q$`, 일반 문자열)은 **데이터**라 손대지 않는다.
 *   · **블록 주석 중첩** — `/* a /* b *\/ c *\/` 는 하나다.
 *
 * 닫히지 않은 문자열·식별자·블록 주석·달러 인용은 **throw** 한다(본문 안에서 닫히지 않은 것도, 파일:줄과 함께).
 * 줄 주석은 파일 끝에서 끝나도 정상이다.
 *
 * ⚠️ **한계 — 이 스캐너가 증명하지 않는 것.** 주석을 옳게 지워도 "텍스트에 `revoke …` 가 있다" 는 **실행을 증명하지 않는다.**
 * 데이터 인용(`comment on … is $c$ revoke … $c$`, `execute format($q$ … $q$)`)은 의도대로 **보존**되므로, 소비자가
 * 부분 문자열로 찾으면 그 안의 글자도 센다(GPT 검증 P1-4 — 소비자 설계 과제). 이 저장소에서 **실제 권한을 재는 1차 방어선은
 * 텍스트 단언이 아니라** `tests/db-privilege-gate.test.ts`(카탈로그 실측)와 각 마이그레이션의 자기검증 블록이다.
 */
function stripSqlSource(src: string, fileName: string, mode: SqlDataMode = "keep"): string {
  const mask = new Uint8Array(src.length);
  const failAt = (what: string, at: number): never => {
    throw new StripCommentsError(`${fileName}:${lineAt(src, at)}: 닫히지 않은 ${what} — 끝까지 삼킨 채 통과시키지 않는다.`);
  };
  scanSql(src, 0, src.length, (k) => {
    mask[k] = 1;
  }, failAt, mode);

  let out = "";
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    out += mask[k] === 1 && c !== "\n" && c !== "\r" ? " " : c;
  }
  return out;
}

/**
 * `text` 의 [from, to) 를 훑어 **지울 위치**를 `mark` 로 알린다. `failAt(what, k)` 는 `text` 위치 k 에서 멈춘다
 * (디코딩된 본문을 훑을 때는 호출자가 원문 위치로 바꿔 주는 함수를 넘긴다).
 */
function scanSql(
  text: string,
  from: number,
  to: number,
  mark: (k: number) => void,
  failAt: (what: string, k: number) => never,
  mode: SqlDataMode,
): void {
  const at = (k: number): string | undefined => (k >= from && k < to ? text[k] : undefined);
  const markRange = (s: number, e: number) => {
    for (let k = s; k < e; k++) mark(k);
  };
  /** 줄 주석 끝(개행 직전) */
  const lineCommentEnd = (s: number) => {
    let j = s;
    while (j < to && !isNewline(text[j])) j += 1;
    return j;
  };

  const tokens: SqlToken[] = [];
  const push = (t: SqlToken) => {
    tokens.push(t);
    if (tokens.length > 4) tokens.shift();
  };

  /**
   * 작은따옴표 상수 하나(이어붙인 조각 전부)를 읽는다. `i` 는 여는 따옴표.
   * 반환: 끝 위치 · 디코딩된 내용(원문 위치 포함). 조각 사이의 `--` 주석은 여기서 지운다.
   */
  const readQuoted = (i: number, escape: boolean): { end: number; decoded: Decoded } => {
    const decoded: Decoded = { text: "", origin: [] };
    const emit = (ch: string, origin: number[]) => {
      decoded.text += ch;
      decoded.origin.push(origin);
    };
    let j = i + 1;
    for (;;) {
      // 조각 하나
      let closed = false;
      while (j < to) {
        const c = text[j];
        if (escape && c === "\\") {
          const n = at(j + 1);
          if (n === undefined) break;
          const hexRun = (start: number, max: number) => {
            let e = start;
            while (e < to && e - start < max && /[0-9A-Fa-f]/.test(text[e])) e += 1;
            return e;
          };
          const simple: Record<string, string> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (n in simple) {
            emit(simple[n], [j, j + 1]);
            j += 2;
          } else if (n >= "0" && n <= "7") {
            let e = j + 1;
            while (e < to && e - (j + 1) < 3 && text[e] >= "0" && text[e] <= "7") e += 1;
            emit(String.fromCharCode(parseInt(text.slice(j + 1, e), 8) & 0xff), range(j, e));
            j = e;
          } else if (n === "x" && /[0-9A-Fa-f]/.test(at(j + 2) ?? "")) {
            const e = hexRun(j + 2, 2);
            emit(String.fromCharCode(parseInt(text.slice(j + 2, e), 16)), range(j, e));
            j = e;
          } else if ((n === "u" || n === "U") && /[0-9A-Fa-f]/.test(at(j + 2) ?? "")) {
            const e = hexRun(j + 2, n === "u" ? 4 : 8);
            const cp = parseInt(text.slice(j + 2, e), 16);
            emit(cp <= 0x10ffff ? String.fromCodePoint(cp) : "?", range(j, e));
            j = e;
          } else {
            emit(n, [j, j + 1]);
            j += 2;
          }
          continue;
        }
        if (c === "'") {
          if (at(j + 1) === "'") {
            emit("'", [j, j + 1]);
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        emit(c, [j]);
        j += 1;
      }
      if (!closed) failAt(escape ? "E'…' 문자열" : "문자열 '…'", i);

      // 이어붙이기: 가로 공백·`--`주석 → 줄바꿈 하나 → (공백 | `--`주석+줄바꿈)* → `'`
      let k = j;
      const gapComments: [number, number][] = [];
      for (;;) {
        if (isHorizSpace(at(k))) k += 1;
        else if (at(k) === "-" && at(k + 1) === "-") {
          const e = lineCommentEnd(k);
          gapComments.push([k, e]);
          k = e;
        } else break;
      }
      if (!isNewline(at(k))) return { end: j, decoded };
      k += 1;
      for (;;) {
        if (isSqlSpace(at(k))) k += 1;
        else if (at(k) === "-" && at(k + 1) === "-") {
          const e = lineCommentEnd(k);
          if (!isNewline(at(e))) break; // 줄바꿈으로 끝나지 않는 주석은 이어붙이기 공백이 아니다
          gapComments.push([k, e]);
          k = e + 1;
        } else break;
      }
      if (at(k) !== "'") return { end: j, decoded };
      for (const [s, e] of gapComments) markRange(s, e);
      j = k + 1; // 다음 조각 — 같은 이스케이프 모드
    }
  };

  let i = from;
  while (i < to) {
    const ch = text[i];
    const next = at(i + 1);

    if (isSqlSpace(ch)) {
      i += 1;
      continue;
    }

    // 줄 주석
    if (ch === "-" && next === "-") {
      const e = lineCommentEnd(i);
      markRange(i, e);
      i = e;
      continue;
    }

    // 블록 주석(중첩)
    if (ch === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < to && depth > 0) {
        if (text[j] === "/" && at(j + 1) === "*") {
          depth += 1;
          j += 2;
        } else if (text[j] === "*" && at(j + 1) === "/") {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      if (depth > 0) failAt(`블록 주석(중첩 깊이 ${depth})`, i);
      markRange(i, j);
      i = j;
      continue;
    }

    // 작은따옴표 상수 — 접두사(E·B·X·N·U&)는 식별자 분기가 토큰으로 넣지 않고 여기로 넘긴다
    if (ch === "'") {
      const escape = (at(i - 1) === "E" || at(i - 1) === "e") && !isSqlIdentChar(at(i - 2));
      const isBody = isCodeBodyPosition(tokens);
      const isExecArg = isExecArgPosition(tokens);
      const { end, decoded } = readQuoted(i, escape);
      if (isBody) scanDecoded(decoded, mark, failAt, mode);
      else if (mode === "executable") {
        const hide = () => {
          for (const o of decoded.origin) for (const k of o) mark(k);
        };
        if (!isExecArg) hide();
        else {
          try {
            scanDecoded(decoded, mark, failAt, mode);
          } catch (e) {
            if (!(e instanceof StripCommentsError)) throw e;
            hide();
          }
        }
      }
      push({ kind: "other", value: "'" });
      i = end;
      continue;
    }

    // 큰따옴표 식별자
    if (ch === '"') {
      let j = i + 1;
      let closed = false;
      while (j < to) {
        if (text[j] === '"') {
          if (at(j + 1) === '"') {
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (!closed) failAt('큰따옴표 식별자 "…"', i);
      // `U&"…"` 도 식별자다 — 앞의 `u`·`&` 토큰을 걷어낸다
      if (at(i - 1) === "&" && (at(i - 2) === "U" || at(i - 2) === "u") && !isSqlIdentChar(at(i - 3))) {
        tokens.splice(-2, 2);
      }
      push({ kind: "qident" });
      i = j;
      continue;
    }

    // 달러 인용 — `$` 앞이 식별자 글자면 식별자의 일부이고, `$` 뒤가 숫자면 위치 매개변수다
    if (ch === "$" && !isSqlIdentChar(at(i - 1))) {
      let j = i + 1;
      if (at(j) !== "$" && isSqlIdentStart(at(j))) {
        while (j < to && isSqlIdentChar(text[j]) && text[j] !== "$") j += 1;
      }
      if (at(j) === "$") {
        const tag = text.slice(i, j + 1);
        const bodyStart = j + 1;
        const end = text.indexOf(tag, bodyStart);
        if (end === -1 || end + tag.length > to) failAt(`달러 인용 ${tag}`, i);
        if (isCodeBodyPosition(tokens)) scanSql(text, bodyStart, end, mark, failAt, mode);
        else if (mode === "executable") {
          if (!isExecArgPosition(tokens)) markRange(bodyStart, end);
          else {
            try {
              scanSql(text, bodyStart, end, mark, failAt, mode);
            } catch (e) {
              if (!(e instanceof StripCommentsError)) throw e;
              markRange(bodyStart, end);
            }
          }
        }
        push({ kind: "other", value: "$" });
        i = end + tag.length;
        continue;
      }
    }

    // 식별자·키워드 — 문자열 접두사(E'·B'·X'·N')는 토큰이 아니다
    if (isSqlIdentStart(ch)) {
      let j = i + 1;
      while (j < to && isSqlIdentChar(text[j])) j += 1;
      const word = text.slice(i, j).toLowerCase();
      const prefix = at(j) === "'" && ["e", "b", "x", "n"].includes(word);
      if (!prefix) push({ kind: "word", value: word });
      i = j;
      continue;
    }

    // `U&'…'` — 앞의 `u` 단어를 걷어내고 `&` 는 넣지 않는다
    if (ch === "&" && next === "'" && (at(i - 1) === "U" || at(i - 1) === "u") && !isSqlIdentChar(at(i - 2))) {
      tokens.pop();
      i += 1;
      continue;
    }

    push({ kind: "other", value: ch });
    i += 1;
  }
}

/** 디코딩된 작은따옴표 본문을 코드로 훑고, 지울 글자를 원문 위치로 되돌려 알린다. */
function scanDecoded(
  decoded: Decoded,
  mark: (k: number) => void,
  failAt: (what: string, k: number) => never,
  mode: SqlDataMode,
): void {
  const { text, origin } = decoded;
  scanSql(
    text,
    0,
    text.length,
    (k) => {
      for (const o of origin[k]) mark(o);
    },
    (what, k) => failAt(`${what}(작은따옴표 본문 안)`, origin[Math.min(k, origin.length - 1)]?.[0] ?? 0),
    mode,
  );
}

/** [s, e) 정수 목록 */
function range(s: number, e: number): number[] {
  const out: number[] = [];
  for (let k = s; k < e; k++) out.push(k);
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
  if (ext === ".sql") return stripSqlSource(src, fileName);
  throw new StripCommentsError(
    `${fileName}: 주석 문법을 모르는 확장자(${ext || "(없음)"}) — 추측해서 통과시키지 않는다. ` +
      "지원: .ts .tsx .js .jsx .mts .cts .mjs .cjs .css .scss .sql",
  );
}

/**
 * SQL 전용 — 데이터 인용을 보는 방식을 고른다(`SqlDataMode` 참고). `sqlView(src, f, { data: "keep" })` 는 `stripComments(src, f)` 와 같다.
 * 줄 번호·길이 보존과 미종결 throw 규칙은 같다.
 */
export function sqlView(src: string, fileName: string, opts: { data: SqlDataMode }): string {
  if (extensionOf(fileName) !== ".sql") {
    throw new StripCommentsError(`${fileName}: sqlView 는 .sql 전용이다`);
  }
  return stripSqlSource(src, fileName, opts.data);
}

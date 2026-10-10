/**
 * 공지·팝업 본문의 제한 서식 (T3-4 · 결정 7 · 사장님 요청 6.1) — 순수 모듈, 서버·브라우저 공용, 의존성 0.
 *
 * **HTML 을 저장하지 않는다.** 사이트에 CSP 가 없어(next.config.ts) HTML 저장 + 정화기는 한 번만 빠져도 홈 화면 XSS 가 된다.
 * 대신 기존 text 칸(마이그레이션 없음)에 아래 **마크다운 하위집합**을 넣고, 공개 화면은 components/content/RichText.tsx 가
 * 이 모듈의 구문 트리를 **React 요소로만** 그린다. 트리에는 글자와 허용된 모양뿐이라 어떤 입력도 태그가 되지 않는다.
 *
 * 형식(줄 단위):
 *   `# 글`  제목1      `## 글`  제목2      `- 글`  목록 항목(이어진 줄이 한 목록)
 *   빈 줄 = 문단 나눔 · 한 줄 바꿈 = 같은 문단 안의 줄바꿈(옛 본문의 "줄바꿈이 그대로 보여요" 와 같다)
 *   줄 안: `**굵게**` · `*기울임*` · 굵은 기울임은 `***글***`(굵게가 바깥). 짝이 없는 `*` 는 글자 그대로.
 *   이스케이프: `\\` `\*` 는 어디서나, 줄 머리의 `\#` `\-` 는 서식이 아닌 글자. 그 밖의 `\` 는 글자 그대로.
 *
 * 옛 본문(서식 이전 plain text)과의 관계: 제목은 `# `(뒤에 빈칸) · 목록은 `- ` 로만 시작하고, 기울임·굵게는 같은 줄에서 짝이 맞아야
 * 하므로 "#해시태그" · "*주의" · "5 * 3" 은 그대로 글자다. 줄 머리 "- " 로 쓴 옛 목록은 점 목록으로 보인다(뜻이 같다).
 */

export type RichInline =
  | { type: "text"; text: string }
  | { type: "bold"; children: RichInline[] }
  | { type: "italic"; children: RichInline[] };

export type RichBlock =
  | { type: "h1"; children: RichInline[] }
  | { type: "h2"; children: RichInline[] }
  | { type: "ul"; items: RichInline[][] }
  | { type: "p"; lines: RichInline[][] };

const ESCAPABLE = new Set(["\\", "*", "#", "-"]);

// =============================================================================
// parse
// =============================================================================

type Stop = "**" | "*" | null;

function pushText(out: RichInline[], text: string): void {
  if (text === "") return;
  const last = out[out.length - 1];
  if (last && last.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

/** 한 줄의 줄 안 서식. stop 을 만나면 닫힌 것으로 돌아간다. */
function parseInlineFrom(s: string, start: number, stop: Stop): { children: RichInline[]; end: number; closed: boolean } {
  const out: RichInline[] = [];
  let i = start;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.has(s[i + 1])) {
      pushText(out, s[i + 1]);
      i += 2;
      continue;
    }
    if (ch !== "*") {
      pushText(out, ch);
      i += 1;
      continue;
    }
    // 여는 표시는 바로 뒤가 빈칸이 아닐 때, 닫는 표시는 바로 앞이 빈칸이 아닐 때만 — "5 * 3" 은 글자다
    const prevSpace = i === 0 || /\s/.test(s[i - 1]);
    // 지금 열린 것의 닫힘을 먼저 본다 — `***글***` 은 굵게(기울임(글))
    if (!prevSpace && i > start) {
      if (stop === "**" && s.startsWith("**", i)) return { children: out, end: i + 2, closed: true };
      if (stop === "*") return { children: out, end: i + 1, closed: true };
    }
    if (stop === "*") {
      // 기울임 안의 '*' 는 닫힘이 아니면 글자(기울임 안에 굵게를 두지 않는다 — 직렬화가 만들지 않는 모양)
      pushText(out, "*");
      i += 1;
      continue;
    }
    const opens = (len: number) => i + len < s.length && !/\s/.test(s[i + len]);
    if (s.startsWith("**", i) && opens(2)) {
      const inner = parseInlineFrom(s, i + 2, "**");
      if (inner.closed && inner.children.length > 0) {
        out.push({ type: "bold", children: inner.children });
        i = inner.end;
        continue;
      }
      pushText(out, "**");
      i += 2;
      continue;
    }
    if (!s.startsWith("**", i) && opens(1)) {
      const inner = parseInlineFrom(s, i + 1, "*");
      if (inner.closed && inner.children.length > 0) {
        out.push({ type: "italic", children: inner.children });
        i = inner.end;
        continue;
      }
    }
    pushText(out, "*");
    i += 1;
  }
  return { children: out, end: i, closed: false };
}

function parseInline(line: string): RichInline[] {
  return parseInlineFrom(line, 0, null).children;
}

export function parseRichText(source: string | null | undefined): RichBlock[] {
  const lines = (source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: RichBlock[] = [];
  let para: RichInline[][] | null = null;
  let list: RichInline[][] | null = null;
  const flush = () => {
    if (para) blocks.push({ type: "p", lines: para });
    if (list) blocks.push({ type: "ul", items: list });
    para = null;
    list = null;
  };
  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    const h2 = /^## (.*)$/.exec(line);
    const h1 = h2 ? null : /^# (.*)$/.exec(line);
    if (h1 || h2) {
      flush();
      const children = parseInline(((h2 ?? h1) as RegExpExecArray)[1].trim());
      if (children.length > 0) blocks.push({ type: h2 ? "h2" : "h1", children });
      continue;
    }
    const li = /^- (.*)$/.exec(line);
    if (li) {
      if (para) flush();
      const children = parseInline(li[1].trim());
      if (children.length === 0) continue;
      (list ??= []).push(children);
      continue;
    }
    if (list) flush();
    (para ??= []).push(parseInline(line));
  }
  flush();
  return blocks;
}

// =============================================================================
// serialize
// =============================================================================

/** 글자 그대로를 줄 안에서 안전하게 — `\` 와 `*` 를 이스케이프한다. */
function escapeInline(text: string): string {
  return text.replace(/[\\*]/g, (c) => `\\${c}`);
}

/** 줄 머리 — 서식으로 읽힐 `#` · `- ` 를 이스케이프한다. */
function escapeLineStart(line: string): string {
  if (line.startsWith("#")) return `\\${line}`;
  if (line.startsWith("- ")) return `\\${line}`;
  return line;
}

function inlineHasText(nodes: RichInline[]): boolean {
  return nodes.some((n) => (n.type === "text" ? n.text !== "" : inlineHasText(n.children)));
}

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
}

function flatten(nodes: RichInline[], bold = false, italic = false, out: Run[] = []): Run[] {
  for (const n of nodes) {
    if (n.type === "text") out.push({ text: n.text, bold, italic });
    else flatten(n.children, bold || n.type === "bold", italic || n.type === "italic", out);
  }
  return out;
}

/** 굵게를 바깥, 기울임을 안쪽으로 묶어 쓴다 — 기울임 안에 굵게가 들어가는 모양은 만들지 않는다(파서가 한 가지로만 읽게). */
export function serializeInline(nodes: RichInline[]): string {
  const runs = flatten(nodes).filter((r) => r.text !== "");
  let out = "";
  let i = 0;
  while (i < runs.length) {
    const bold = runs[i].bold;
    let j = i;
    while (j < runs.length && runs[j].bold === bold) j++;
    const group = runs.slice(i, j);
    let inner = "";
    let k = 0;
    while (k < group.length) {
      const italic = group[k].italic;
      let m = k;
      let text = "";
      while (m < group.length && group[m].italic === italic) text += group[m++].text;
      // 서식 표시 바로 안쪽의 빈칸은 바깥으로 — "** 굵게**" 처럼 쓰지 않는다(읽기 쉬운 원문)
      if (italic) {
        const lead = /^\s*/.exec(text)?.[0] ?? "";
        const trail = /\s*$/.exec(text.slice(lead.length))?.[0] ?? "";
        const core = text.slice(lead.length, text.length - trail.length);
        inner += core === "" ? text : `${lead}*${escapeInline(core)}*${trail}`;
      } else inner += escapeInline(text);
      k = m;
    }
    if (bold && inner.trim() !== "") {
      // 빈칸은 표시 바깥으로 — 여는 표시 뒤·닫는 표시 앞에 빈칸이 있으면 파서가 서식으로 읽지 않는다
      const lead = /^\s*/.exec(inner)?.[0] ?? "";
      const trail = /\s*$/.exec(inner)?.[0] ?? "";
      out += `${lead}**${inner.slice(lead.length, inner.length - trail.length)}**${trail}`;
    } else out += inner;
    i = j;
  }
  return out;
}

export function serializeRichText(blocks: RichBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === "h1" || b.type === "h2") {
      if (!inlineHasText(b.children)) continue;
      parts.push(`${b.type === "h1" ? "#" : "##"} ${serializeInline(b.children).trim()}`);
    } else if (b.type === "ul") {
      const items = b.items.filter(inlineHasText).map((it) => `- ${serializeInline(it).trim()}`);
      if (items.length > 0) parts.push(items.join("\n"));
    } else {
      const lines = b.lines.map((l) => escapeLineStart(serializeInline(l))).filter((l) => l.trim() !== "");
      if (lines.length > 0) parts.push(lines.join("\n"));
    }
  }
  return parts.join("\n\n");
}

/** plain text 를 이 형식의 글자 그대로로 — 옛 본문을 서식 없이 보존해야 할 때(toPlainText 로 되돌리면 원문과 같다). */
export function escapeRichText(plain: string): string {
  return plain
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => escapeLineStart(escapeInline(line)))
    .join("\n");
}

/**
 * 서버 저장 직전의 정규형 — 받은 문자열을 한 번 읽고 다시 쓴다. 허용 밖의 것은 이 형식에 존재할 수 없으므로
 * 저장되는 값은 언제나 이 모듈이 만든 모양이다(편집기를 거치지 않은 요청도 같다).
 */
export function normalizeRichText(raw: string): string {
  return serializeRichText(parseRichText(raw));
}

/** 서식 기호까지 센 원문 길이의 상한 = 보이는 글자 상한 × 이 배수(굵게 기호·이스케이프 몫 — 남용만 막는다). */
export const RICH_TEXT_RAW_FACTOR = 4;

// =============================================================================
// plain text
// =============================================================================

function inlinePlain(nodes: RichInline[]): string {
  return nodes.map((n) => (n.type === "text" ? n.text : inlinePlain(n.children))).join("");
}

/** 보이는 글자 — 서식 기호를 빼고 블록·줄을 줄바꿈으로 잇는다. 길이 제한·문구 검사·미리보기 요약이 이것을 본다. */
export function toPlainText(source: string | null | undefined): string {
  const lines: string[] = [];
  for (const b of parseRichText(source)) {
    if (b.type === "h1" || b.type === "h2") lines.push(inlinePlain(b.children));
    else if (b.type === "ul") for (const it of b.items) lines.push(inlinePlain(it));
    else for (const l of b.lines) lines.push(inlinePlain(l));
  }
  return lines.join("\n").trim();
}

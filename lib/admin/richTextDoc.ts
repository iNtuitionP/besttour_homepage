/**
 * TipTap(ProseMirror) 문서 JSON ↔ 제한 서식 문자열 (T3-4 · 결정 7) — 순수 모듈. TipTap 을 import 하지 않는다(JSON 모양만 안다).
 *
 * 편집기는 관리자 화면에서만 동적으로 읽힌다(components/admin/RichTextEditor.tsx). 저장되는 것은 언제나 이 모듈이 만든
 * lib/content/richText.ts 형식의 문자열이다 — **HTML 을 만들거나 저장하지 않는다**(editor.getHTML 을 쓰지 않는다).
 *
 * 허용: 문단 · 줄바꿈(hardBreak) · 제목1·2 · 점 목록 · 굵게 · 기울임.
 * 그 밖(링크·코드·인용·번호 목록·제목3 이하·이미지·가로줄·표 …)은 **버린다** — 글자가 있으면 글자만 문단으로 남기고, 속성(href·src)은 어디에도 옮기지 않는다.
 * 붙여넣기로 들어온 서식도 여기서 걸러진다(편집기 확장을 꺼 둔 것과 별개로 저장 직전 한 번 더).
 */
import { parseRichText, serializeRichText, type RichBlock, type RichInline } from "@/lib/content/richText";

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/** 줄 안 노드들 → 줄(hardBreak 로 나뉜) 목록. 허용 마크(bold·italic)만 옮긴다. */
function inlineLines(nodes: DocNode[] | undefined): RichInline[][] {
  const lines: RichInline[][] = [[]];
  const walk = (list: DocNode[] | undefined) => {
    for (const n of list ?? []) {
      if (n.type === "hardBreak") {
        lines.push([]);
        continue;
      }
      if (n.type === "text" && typeof n.text === "string") {
        const marks = new Set((n.marks ?? []).map((m) => m.type));
        let node: RichInline = { type: "text", text: n.text };
        if (marks.has("italic")) node = { type: "italic", children: [node] };
        if (marks.has("bold")) node = { type: "bold", children: [node] };
        lines[lines.length - 1].push(node);
        continue;
      }
      // 줄 안의 모르는 노드(멘션·이미지 등) — 안에 글자가 있으면 글자만
      walk(n.content);
    }
  };
  walk(nodes);
  return lines;
}

const hasText = (line: RichInline[]) => serializeRichText([{ type: "p", lines: [line] }]).trim() !== "";

/** 블록 안의 글자를 문단 줄로 — 허용 밖 블록(인용·코드·번호 목록 …)을 글자만 남길 때 */
function textBlocks(node: DocNode, out: RichBlock[]): void {
  const isTextBlock = (node.content ?? []).some((c) => c.type === "text" || c.type === "hardBreak");
  if (isTextBlock) {
    // 코드 블록의 글자는 마크 없이(코드 서식은 허용 밖) — 줄바꿈 문자도 줄로 나눈다
    const plain = node.type === "codeBlock";
    const lines = inlineLines(node.content)
      .flatMap((l) =>
        plain
          ? l
              .map((n) => (n.type === "text" ? n.text : ""))
              .join("")
              .split("\n")
              .map((t): RichInline[] => [{ type: "text", text: t }])
          : [l],
      )
      .filter(hasText);
    if (lines.length > 0) out.push({ type: "p", lines });
    return;
  }
  for (const c of node.content ?? []) textBlocks(c, out);
}

function listItems(node: DocNode, out: RichInline[][]): void {
  for (const item of node.content ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "bulletList" || part.type === "orderedList") listItems(part, out);
      else for (const line of inlineLines(part.content)) if (hasText(line)) out.push(line);
    }
  }
}

export function docToBlocks(doc: DocNode | null | undefined): RichBlock[] {
  const out: RichBlock[] = [];
  for (const node of doc?.content ?? []) {
    if (node.type === "paragraph") {
      const lines = inlineLines(node.content);
      if (lines.some(hasText)) out.push({ type: "p", lines });
    } else if (node.type === "heading" && (node.attrs?.level === 1 || node.attrs?.level === 2)) {
      const children = inlineLines(node.content).flat();
      if (hasText(children)) out.push({ type: node.attrs.level === 1 ? "h1" : "h2", children });
    } else if (node.type === "bulletList") {
      const items: RichInline[][] = [];
      listItems(node, items);
      if (items.length > 0) out.push({ type: "ul", items });
    } else {
      textBlocks(node, out);
    }
  }
  return out;
}

export function docToRichText(doc: DocNode | null | undefined): string {
  return serializeRichText(docToBlocks(doc));
}

function inlineToDoc(nodes: RichInline[], bold = false, italic = false, out: DocNode[] = []): DocNode[] {
  for (const n of nodes) {
    if (n.type === "text") {
      if (n.text === "") continue;
      const marks = [...(bold ? [{ type: "bold" }] : []), ...(italic ? [{ type: "italic" }] : [])];
      out.push(marks.length > 0 ? { type: "text", text: n.text, marks } : { type: "text", text: n.text });
    } else inlineToDoc(n.children, bold || n.type === "bold", italic || n.type === "italic", out);
  }
  return out;
}

export function richTextToDoc(source: string | null | undefined): DocNode {
  const content: DocNode[] = [];
  for (const b of parseRichText(source)) {
    if (b.type === "h1" || b.type === "h2") {
      content.push({ type: "heading", attrs: { level: b.type === "h1" ? 1 : 2 }, content: inlineToDoc(b.children) });
    } else if (b.type === "ul") {
      content.push({
        type: "bulletList",
        content: b.items.map((it) => ({ type: "listItem", content: [{ type: "paragraph", content: inlineToDoc(it) }] })),
      });
    } else {
      const inner: DocNode[] = [];
      b.lines.forEach((l, i) => {
        if (i > 0) inner.push({ type: "hardBreak" });
        inlineToDoc(l, false, false, inner);
      });
      content.push({ type: "paragraph", content: inner });
    }
  }
  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

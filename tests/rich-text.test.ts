/**
 * T3-4(결정 7 · 사장님 요청 6.1) — 서식 편집기. **HTML 을 저장하지 않는다.**
 *
 * 저장 형식은 기존 text 칸에 넣는 마크다운 하위집합(마이그레이션 없음):
 *   줄 머리 `# ` 제목1 · `## ` 제목2 · `- ` 목록 · 줄 안의 `**굵게**` · `*기울임*` · 빈 줄 = 문단 나눔 · 한 줄 바꿈 = 같은 문단 안 줄바꿈.
 *   글자 그대로의 `\` `*` 와 줄 머리의 `#` `- ` 는 역슬래시로 이스케이프한다.
 * 공개 화면은 components/content/RichText.tsx 가 **React 요소만** 그린다(raw HTML 주입 0 · 정화기 패키지 0).
 * TipTap 문서(JSON) ↔ 이 형식 변환은 lib/admin/richTextDoc.ts — 허용 밖 노드·마크는 버린다.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { RichText } from "@/components/content/RichText";
import { findCopyWarnings } from "@/lib/admin/copyCheck";
import { parseNoticeForm } from "@/lib/admin/noticeInput";
import { parsePopupForm } from "@/lib/admin/popupInput";
import { docToRichText, richTextToDoc } from "@/lib/admin/richTextDoc";
import { escapeRichText, parseRichText, serializeRichText, toPlainText } from "@/lib/content/richText";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const html = (md: string) => renderToStaticMarkup(createElement(RichText, { text: md }));
const canon = (md: string) => serializeRichText(parseRichText(md));

describe("T3-4 parse · serialize", () => {
  test("🔴 블록 — 제목1·제목2·목록·문단(빈 줄)·줄바꿈", () => {
    const md = "# 큰 제목\n## 작은 제목\n- 하나\n- 둘\n\n첫 줄\n둘째 줄\n\n다음 문단";
    expect(parseRichText(md)).toEqual([
      { type: "h1", children: [{ type: "text", text: "큰 제목" }] },
      { type: "h2", children: [{ type: "text", text: "작은 제목" }] },
      { type: "ul", items: [[{ type: "text", text: "하나" }], [{ type: "text", text: "둘" }]] },
      { type: "p", lines: [[{ type: "text", text: "첫 줄" }], [{ type: "text", text: "둘째 줄" }]] },
      { type: "p", lines: [[{ type: "text", text: "다음 문단" }]] },
    ]);
  });

  test("🔴 줄 안 — **굵게** · *기울임* · 굵은 기울임 · 짝이 없는 * 는 글자", () => {
    expect(parseRichText("a **b** *c* ***d***")[0]).toEqual({
      type: "p",
      lines: [
        [
          { type: "text", text: "a " },
          { type: "bold", children: [{ type: "text", text: "b" }] },
          { type: "text", text: " " },
          { type: "italic", children: [{ type: "text", text: "c" }] },
          { type: "text", text: " " },
          { type: "bold", children: [{ type: "italic", children: [{ type: "text", text: "d" }] }] },
        ],
      ],
    });
    expect(toPlainText("*주의 사항")).toBe("*주의 사항");
    expect(toPlainText("5 * 3 = 15")).toBe("5 * 3 = 15");
    expect(toPlainText("**열고 안 닫음")).toBe("**열고 안 닫음");
  });

  test("🔴 '*'·'#'·'- '·'\\' 왕복 — 이스케이프한 글자는 글자 그대로 돌아온다", () => {
    for (const plain of ["# 해시로 시작", "#해시태그", "- 대시로 시작", "*별표*로 감싼 글", "a\\b", "5 * 3", "## 두 개", "-1도"]) {
      const md = escapeRichText(plain);
      expect(toPlainText(md), plain).toBe(plain);
      expect(parseRichText(md).every((b) => b.type === "p"), `${plain} 이 서식으로 바뀌었다`).toBe(true);
      expect(canon(md), plain).toBe(md);
    }
  });

  test("🔴 정규형 — serialize(parse(x)) 는 한 번 더 돌려도 같다", () => {
    for (const md of ["# 제목\n\n본문 **굵게**", "- a\n- *b*\n\n끝", "a\nb", "***x*** 와 **y**", "\\# 글자", "줄 *기울임* 끝"]) {
      expect(canon(canon(md)), md).toBe(canon(md));
    }
  });

  test("🔴 무작위 입력 3000개 — 정규형은 멱등 · 정규화해도 보이는 글자는 그대로(서버가 본문 뜻을 바꾸지 않는다)", () => {
    const alphabet = ["a", "가", " ", "*", "**", "#", "# ", "- ", "\\", "\n", "\n\n", "_"];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let n = 0; n < 3000; n++) {
      let src = "";
      const len = 1 + Math.floor(rnd() * 14);
      for (let k = 0; k < len; k++) src += alphabet[Math.floor(rnd() * alphabet.length)];
      const once = canon(src);
      expect(canon(once), JSON.stringify(src)).toBe(once);
      expect(toPlainText(once), JSON.stringify(src)).toBe(toPlainText(src));
    }
  });

  test("🔴 toPlainText — 기호를 뺀 보이는 글자 · 블록은 줄로 잇는다(길이·문구 검사는 이것으로)", () => {
    expect(toPlainText("# 제목\n- **하나**\n- 둘\n\n*끝*")).toBe("제목\n하나\n둘\n끝");
    expect(toPlainText("")).toBe("");
    expect(toPlainText("  \n\n ")).toBe("");
  });
});

describe("T3-4 RichText — React 요소만", () => {
  test("🔴 <script> 는 글자로 · 허용 요소(h·ul·li·p·strong·em·br)만 나온다", () => {
    const out = html("<script>alert(1)</script>\n\n# <img src=x onerror=alert(1)>\n- **<b>x</b>**");
    expect(out).not.toMatch(/<script|<img|<b>/);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    const tags = [...out.matchAll(/<([a-z0-9]+)[\s>]/g)].map((m) => m[1]);
    for (const tag of tags) expect(["div", "h2", "h3", "ul", "li", "p", "strong", "em", "br"], tag).toContain(tag);
  });

  test("🔴 본문 제목은 화면 제목(h1)과 겹치지 않게 한 단계 내린다 — 제목1 → h2 · 제목2 → h3", () => {
    expect(html("# A\n## B")).toMatch(/<h2[^>]*>A<\/h2><h3[^>]*>B<\/h3>/);
    expect(html("a\nb")).toMatch(/<p[^>]*>a<br\/>b<\/p>/);
  });

  test("🔴 raw HTML 금지 범위 — components/content · Popup · RichTextEditor · 공지 상세", () => {
    const files = [
      ...readdirSync(path.join(ROOT, "components/content")).map((f) => `components/content/${f}`),
      "components/home/Popup.tsx",
      "components/admin/RichTextEditor.tsx",
      "components/admin/RichTextEditorInner.tsx",
      "lib/content/richText.ts",
      "lib/admin/richTextDoc.ts",
      "app/[locale]/(site)/notices/[id]/page.tsx",
    ];
    for (const rel of files) {
      expect(/dangerouslySetInnerHTML|innerHTML|html-react-parser|sanitize-html|DOMPurify|getHTML\(|insertContent\(\s*["'`]</.test(codeOf(rel)), rel).toBe(false);
    }
    expect(codeOf("components/home/Popup.tsx")).toMatch(/<RichText\b/);
    expect(codeOf("app/[locale]/(site)/notices/[id]/page.tsx")).toMatch(/<RichText\b/);
  });
});

describe("T3-4 서버 — 정규형 저장 · 보이는 글자로 길이 · 문구 검사도 보이는 글자로", () => {
  const popupForm = (body: string) => {
    const fd = new FormData();
    fd.set("title", "제목");
    fd.set("body", body);
    fd.set("startsAt", "2026-10-10");
    fd.set("endsAt", "2026-10-11");
    return fd;
  };
  const noticeForm = (body: string) => {
    const fd = new FormData();
    fd.set("title", "제목");
    fd.set("body", body);
    fd.set("category", "info");
    fd.set("publishedAt", "2026-10-10");
    return fd;
  };

  test("🔴 길이 — 서식 기호는 세지 않는다(팝업 500 · 공지 4000) · 보이는 글자 0 이면 거부", () => {
    const bold500 = `**${"가".repeat(500)}**`;
    expect(parsePopupForm(popupForm(bold500)).ok).toBe(true);
    expect(parsePopupForm(popupForm(`**${"가".repeat(501)}**`)).ok).toBe(false);
    expect(parsePopupForm(popupForm("   \n\n# \n- ")).ok, "보이는 글자 0(빈 제목·빈 목록)").toBe(false);
    expect(toPlainText("**  **"), "빈칸만 감싼 표시는 서식이 아니라 글자").toBe("**  **");
    expect(parseNoticeForm(noticeForm(`- ${"나".repeat(3999)}`)).ok).toBe(true);
    expect(parseNoticeForm(noticeForm("나".repeat(4001))).ok).toBe(false);
  });

  test("🔴 정규형 — 저장 값은 serialize(parse(입력)) · 짝 없는 * 는 이스케이프돼 글자로 남는다", () => {
    const p = parsePopupForm(popupForm("  5 * 3 **굵게**  \n\n\n\n# 제목  "));
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.value.body).toBe(canon("  5 * 3 **굵게**  \n\n\n\n# 제목  "));
      expect(toPlainText(p.value.body)).toBe("5 * 3 굵게  \n제목");
    }
  });

  test("🔴 문구 검사 — 액션은 holdForCopy 에 보이는 글자(toPlainText)를 넘긴다(검사와 확인 키가 같은 기준)", () => {
    for (const rel of ["actions/admin/popup.ts", "actions/admin/notice.ts"]) {
      const src = codeOf(rel);
      const calls = [...src.matchAll(/holdForCopy\(([^;]*)\);/g)].map((m) => m[1]);
      expect(calls.length, rel).toBe(2);
      for (const c of calls) expect(c, rel).toMatch(/body: toPlainText\(parsed\.value\.body\)/);
    }
    expect(findCopyWarnings({ body: toPlainText("업계 **1위**") }).length).toBeGreaterThan(0);
  });
});

describe("T3-4 TipTap 문서 변환 — 허용 밖은 버린다", () => {
  test("🔴 허용 노드·마크 → 형식", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "제목" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "text", text: "b", marks: [{ type: "bold" }] },
            { type: "hardBreak" },
            { type: "text", text: "c", marks: [{ type: "italic" }, { type: "bold" }] },
            { type: "text", text: "*" },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "항목" }] }] }] },
      ],
    };
    expect(docToRichText(doc)).toBe("# 제목\n\na**b**\n***c***\\*\n\n- 항목");
  });

  test("🔴 링크·코드·이미지·인용·제목3·표 등 허용 밖 — 글자만 남기거나 버린다(HTML 이 새지 않는다)", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "링크", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "code" }] }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "작은" }] },
        { type: "codeBlock", content: [{ type: "text", text: "<script>x</script>" }] },
        { type: "image", attrs: { src: "https://evil.example/x.png" } },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "인용" }] }] },
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "번호" }] }] }] },
        { type: "horizontalRule" },
      ],
    };
    const md = docToRichText(doc);
    expect(md).not.toMatch(/javascript|evil|href|src=/);
    expect(toPlainText(md)).toBe("링크\n작은\n<script>x</script>\n인용\n번호");
    expect(html(md)).not.toMatch(/<script|<a |<img|<code|<blockquote|<ol/);
  });

  test("🔴 형식 → 문서 → 형식 왕복", () => {
    for (const md of ["# 제목\n\n본문 **굵게** *기울임*\n둘째 줄", "- 하나\n- **둘**", "\\# 글자 \\*", "## 작은 제목"]) {
      expect(docToRichText(richTextToDoc(md)), md).toBe(canon(md));
    }
  });
});

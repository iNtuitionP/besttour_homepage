/**
 * OF2-A(7) — 관리자 서식 편집기(TipTap) 디자인: 워드·티스토리처럼 한 줄 아이콘 툴바 · 그룹 구분선 · 눌린 상태 · 위 고정(sticky) · 넓은 쓰는 칸.
 *
 * 서버 렌더에서 TipTap 은 editor=null 이라(immediatelyRender:false) 툴바 마크업만 나온다 — 그것을 본다. 눌린 상태(aria-pressed)는
 * 버튼 값으로 이미 있었고(T3-4) 여기서는 그대로인지만 본다. 동작(굵게 토글 등)은 브라우저 실측으로 확인한다.
 * 문구는 ko.json admin.editor.* 에서만(한글 리터럴 0) · 아이콘은 인라인 SVG(새 패키지 0) · 색은 역할 토큰만.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { RichTextEditorInner } from "@/components/admin/RichTextEditorInner";
import type { RichTextEditorLabels } from "@/components/admin/RichTextEditor";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const ko = JSON.parse(read("messages/ko.json")) as { admin: { editor: Record<string, string> } };

const LABELS: RichTextEditorLabels = {
  toolbar: ko.admin.editor.toolbar,
  bold: ko.admin.editor.bold,
  italic: ko.admin.editor.italic,
  h1: ko.admin.editor.h1,
  h2: ko.admin.editor.h2,
  bullet: ko.admin.editor.bullet,
  undo: ko.admin.editor.undo,
  redo: ko.admin.editor.redo,
  sample: ko.admin.editor.sample,
  count: ko.admin.editor.count,
};

const html = renderToStaticMarkup(
  createElement(RichTextEditorInner, {
    id: "t-body",
    initialValue: "",
    disabled: false,
    labelledBy: "t-label",
    describedBy: "t-hint",
    invalid: false,
    labels: LABELS,
    onChange: () => {},
  }),
);
const toolbar = /<div[^>]*role="toolbar"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
const buttons = [...toolbar.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], inner: m[2] }));

describe("툴바 — 한 줄 아이콘 버튼 7개", () => {
  test("버튼 7개: 굵게 · 기울임 · 큰 제목 · 작은 제목 · 점 목록 · 되돌리기 · 다시 하기 (같은 순서)", () => {
    expect(buttons).toHaveLength(7);
    const names = buttons.map((b) => /aria-label="([^"]*)"/.exec(b.attrs)?.[1]);
    expect(names).toEqual([LABELS.bold, LABELS.italic, LABELS.h1, LABELS.h2, LABELS.bullet, LABELS.undo, LABELS.redo]);
  });

  test("각 버튼은 인라인 SVG 아이콘(장식 aria-hidden) 하나 · 보이는 글자 없음 · 이름은 aria-label + title", () => {
    for (const b of buttons) {
      expect(b.inner.match(/<svg\b/g) ?? [], b.attrs).toHaveLength(1);
      expect(b.inner).toMatch(/<svg[^>]*aria-hidden="true"/);
      expect(b.inner.replace(/<[^>]+>/g, "").trim(), "버튼 안에 글자 없음").toBe("");
      const label = /aria-label="([^"]*)"/.exec(b.attrs)?.[1];
      expect(b.attrs).toContain(`title="${label}"`);
      expect(b.attrs).toContain('type="button"');
    }
  });

  test("눌린 상태 표시(aria-pressed)는 서식 버튼 5개에만 · 되돌리기/다시 하기에는 없다 (T3-4 그대로)", () => {
    const pressed = buttons.map((b) => b.attrs.includes("aria-pressed"));
    expect(pressed).toEqual([true, true, true, true, true, false, false]);
  });

  test("그룹 사이 구분선 3개(굵게·기울임 | 제목 | 목록 | 되돌리기·다시) — 장식(role=separator)", () => {
    const seps = toolbar.match(/<span[^>]*role="separator"[^>]*>/g) ?? [];
    expect(seps).toHaveLength(3);
    for (const sep of seps) expect(sep).toContain('aria-orientation="vertical"');
    // 순서: B I | H1 H2 | 목록 | undo redo
    const order = [...toolbar.matchAll(/<button\b[^>]*aria-label="([^"]*)"|role="separator"/g)].map((m) => m[1] ?? "|");
    expect(order).toEqual([LABELS.bold, LABELS.italic, "|", LABELS.h1, LABELS.h2, "|", LABELS.bullet, "|", LABELS.undo, LABELS.redo]);
  });

  test("툴바 role=toolbar · aria-label · 쓰는 칸을 aria-controls 로 가리킨다", () => {
    expect(html).toMatch(/role="toolbar"[^>]*aria-label="글자 모양"/);
    expect(html).toContain('aria-controls="t-body"');
  });
});

describe("소스 — 새 패키지 0 · 한글 리터럴 0 · 역할 토큰만", () => {
  const inner = stripComments(read("components/admin/RichTextEditorInner.tsx"), "components/admin/RichTextEditorInner.tsx");

  test("아이콘 라이브러리 import 0(인라인 SVG) · package.json 의존성 그대로", () => {
    expect(inner).not.toMatch(/from\s+["'](lucide|react-icons|@heroicons|@tabler|@radix-ui\/react-icons|phosphor)/);
    expect(inner).toMatch(/<svg\b/);
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter((d) => /icon|lucide/i.test(d))).toEqual([]);
  });

  test("한글 리터럴 0 — 문구는 labels(ko.json admin.editor)에서", () => {
    expect(inner.split("\n").filter((l) => /[가-힣]/.test(l))).toEqual([]);
  });

  test("CSS(.rte*) — 툴바 sticky · 쓰는 칸 충분히 큼 · 구분선 · 눌린 상태 · 원시 색 0(역할 토큰만)", () => {
    const css = read("components/admin/admin.module.css");
    const start = css.indexOf(".rte {");
    const end = css.indexOf("/* T3-3");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(block).toMatch(/\.rteToolbar\s*\{[^}]*position:\s*sticky/);
    expect(block).toMatch(/\.rteToolbar\s*\{[^}]*top:\s*[^;]+;/);
    expect(block).toMatch(/\.rteToolbar\s*\{[^}]*z-index:/);
    expect(block).toMatch(/\.rteToolbar\s*\{[^}]*flex-wrap:\s*nowrap/); // 한 줄
    const min = /\.rteContent\s*\{[^}]*min-height:\s*(\d+)px/.exec(block)?.[1];
    expect(Number(min), ".rteContent min-height").toBeGreaterThanOrEqual(280);
    expect(block).toMatch(/\.rteSeparator\s*\{/);
    expect(block).toMatch(/\.rteButton\[aria-pressed="true"\]\s*\{/);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\brgba?\(/);
    expect(block).not.toMatch(/var\(--(brand|gray|purple|gold)-\d+\)/); // 원시 토큰 직접 사용 금지(CLAUDE.md §4)
  });

  test("미리보기 위치는 그대로 — 편집기 아래(rteCount 다음 rteSample)", () => {
    const outer = read("components/admin/RichTextEditor.tsx");
    expect(outer.indexOf("rteCount")).toBeLessThan(outer.indexOf("rteSample"));
    expect(outer.indexOf("<Inner")).toBeLessThan(outer.indexOf("rteCount"));
  });
});

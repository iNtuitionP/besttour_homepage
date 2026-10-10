"use client";
/**
 * TipTap 편집기 본체 (T3-4) — RichTextEditor 가 next/dynamic 으로만 읽는다(관리자 경로 전용 번들).
 *
 * 켜 둔 것: 문단 · 줄바꿈 · 제목(1·2만) · 점 목록 · 굵게 · 기울임 · 되돌리기/다시하기.
 * 끈 것: 인용 · 코드 · 코드 블록 · 가로줄 · 번호 목록 · 취소선 · 밑줄 · 링크(결정 7 — 링크 없음).
 * 저장 값은 editor.getJSON() → lib/admin/richTextDoc.ts → 제한 서식 문자열. **getHTML 을 쓰지 않는다.**
 */
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

import { docToRichText, richTextToDoc, type DocNode } from "@/lib/admin/richTextDoc";

import s from "./admin.module.css";
import type { RichTextEditorInnerProps } from "./RichTextEditor";

export function RichTextEditorInner({ id, initialValue, disabled, labelledBy, describedBy, invalid, labels, onChange }: RichTextEditorInnerProps) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        orderedList: false,
        strike: false,
        underline: false,
        link: false,
      }),
    ],
    content: richTextToDoc(initialValue) as never,
    editorProps: {
      attributes: {
        id,
        class: s.rteContent,
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelledBy,
        "aria-describedby": describedBy,
        ...(invalid ? { "aria-invalid": "true" } : {}),
      },
    },
    onUpdate: ({ editor: e }) => onChange(docToRichText(e.getJSON() as DocNode)),
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      h1: e?.isActive("heading", { level: 1 }) ?? false,
      h2: e?.isActive("heading", { level: 2 }) ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
    }),
  });

  const btn = (key: string, label: string, pressed: boolean | null, run: () => void, enabled = true) => (
    <button
      key={key}
      type="button"
      className={s.rteButton}
      aria-pressed={pressed === null ? undefined : pressed}
      disabled={disabled || !editor || !enabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  );

  return (
    <div className={s.rteEditor}>
      <div className={s.rteToolbar} role="toolbar" aria-label={labels.toolbar} aria-controls={id}>
        {btn("bold", labels.bold, state?.bold ?? false, () => editor?.chain().focus().toggleBold().run())}
        {btn("italic", labels.italic, state?.italic ?? false, () => editor?.chain().focus().toggleItalic().run())}
        {btn("h1", labels.h1, state?.h1 ?? false, () => editor?.chain().focus().toggleHeading({ level: 1 }).run())}
        {btn("h2", labels.h2, state?.h2 ?? false, () => editor?.chain().focus().toggleHeading({ level: 2 }).run())}
        {btn("bullet", labels.bullet, state?.bullet ?? false, () => editor?.chain().focus().toggleBulletList().run())}
        {btn("undo", labels.undo, null, () => editor?.chain().focus().undo().run(), state?.canUndo ?? false)}
        {btn("redo", labels.redo, null, () => editor?.chain().focus().redo().run(), state?.canRedo ?? false)}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

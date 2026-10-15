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
import { useEffect, type ReactNode } from "react";

import { docToRichText, richTextToDoc, type DocNode } from "@/lib/admin/richTextDoc";

import s from "./admin.module.css";
import type { RichTextEditorInnerProps } from "./RichTextEditor";

/** 아이콘 — 24×24 선 그림, 색은 글자색(currentColor)이라 역할 토큰을 그대로 따른다. 장식이라 스크린리더는 읽지 않는다(버튼의 aria-label 이 이름). */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className={s.rteIcon}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
const ICONS = {
  bold: (
    <Icon>
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
    </Icon>
  ),
  italic: (
    <Icon>
      <path d="M10 5h8M6 19h8M14 5l-4 14" />
    </Icon>
  ),
  h1: (
    <Icon>
      <path d="M4 5v14M12 5v14M4 12h8M17 9l2.5-1.5V19" />
    </Icon>
  ),
  h2: (
    <Icon>
      <path d="M4 5v14M12 5v14M4 12h8M16 9.5a2.5 2.5 0 1 1 4 2L16 19h5" />
    </Icon>
  ),
  bullet: (
    <Icon>
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </Icon>
  ),
  undo: (
    <Icon>
      <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
  ),
  redo: (
    <Icon>
      <path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Icon>
  ),
} as const;

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

  // 아이콘 버튼 — 이름은 aria-label + title(마우스를 올리면 보이는 이름). 보이는 글자는 없다. 아이콘은 인라인 SVG(새 패키지 0).
  const btn = (key: string, label: string, icon: ReactNode, pressed: boolean | null, run: () => void, enabled = true) => (
    <button
      key={key}
      type="button"
      className={s.rteButton}
      aria-label={label}
      title={label}
      aria-pressed={pressed === null ? undefined : pressed}
      disabled={disabled || !editor || !enabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );
  const separator = (key: string) => <span key={key} className={s.rteSeparator} role="separator" aria-orientation="vertical" />;

  return (
    <div className={s.rteEditor}>
      <div className={s.rteToolbar} role="toolbar" aria-label={labels.toolbar} aria-controls={id}>
        {btn("bold", labels.bold, ICONS.bold, state?.bold ?? false, () => editor?.chain().focus().toggleBold().run())}
        {btn("italic", labels.italic, ICONS.italic, state?.italic ?? false, () => editor?.chain().focus().toggleItalic().run())}
        {separator("sep-1")}
        {btn("h1", labels.h1, ICONS.h1, state?.h1 ?? false, () => editor?.chain().focus().toggleHeading({ level: 1 }).run())}
        {btn("h2", labels.h2, ICONS.h2, state?.h2 ?? false, () => editor?.chain().focus().toggleHeading({ level: 2 }).run())}
        {separator("sep-2")}
        {btn("bullet", labels.bullet, ICONS.bullet, state?.bullet ?? false, () => editor?.chain().focus().toggleBulletList().run())}
        {separator("sep-3")}
        {btn("undo", labels.undo, ICONS.undo, null, () => editor?.chain().focus().undo().run(), state?.canUndo ?? false)}
        {btn("redo", labels.redo, ICONS.redo, null, () => editor?.chain().focus().redo().run(), state?.canRedo ?? false)}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

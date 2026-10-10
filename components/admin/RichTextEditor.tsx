"use client";
/**
 * 공지·팝업 본문 서식 편집기 (T3-4 · 결정 7 · 사장님 요청 6.1) — 바깥 껍데기.
 *
 *   - TipTap(@tiptap/react · starter-kit · pm)은 **관리자 화면에서만, 동적으로** 읽는다(next/dynamic · ssr:false) — 공개 화면 번들에 들어가지 않는다.
 *   - 폼에 실리는 값은 숨은 칸(name=body)의 **제한 서식 문자열**이다(lib/content/richText.ts). HTML 을 만들거나 저장하지 않는다.
 *     편집기 문서 → 문자열 변환은 lib/admin/richTextDoc.ts 가 하고, 허용 밖 노드·마크(붙여넣은 링크 등)는 거기서 버린다.
 *   - 쓰는 중 **실시간 미리보기** — 공개 화면과 같은 부품(components/content/RichText.tsx)으로 그린다.
 *   - 글자 수는 **보이는 글자**(toPlainText)로 센다 — 서버의 길이 검사와 같은 기준.
 *   - 숨은 칸은 편집기가 읽히기 전부터 처음 값을 들고 있다 — 편집기를 읽는 동안 저장해도 본문이 비지 않는다.
 */
import dynamic from "next/dynamic";
import { useState } from "react";

import { RichText } from "@/components/content/RichText";
import { toPlainText } from "@/lib/content/richText";

import s from "./admin.module.css";

export interface RichTextEditorLabels {
  toolbar: string;
  bold: string;
  italic: string;
  h1: string;
  h2: string;
  bullet: string;
  undo: string;
  redo: string;
  /** 실시간 미리보기 제목 */
  sample: string;
  /** "{n}" · "{max}" 자리표시자 */
  count: string;
}

export interface RichTextEditorInnerProps {
  id: string;
  initialValue: string;
  disabled: boolean;
  labelledBy: string;
  describedBy: string;
  invalid: boolean;
  labels: RichTextEditorLabels;
  onChange: (value: string) => void;
}

const Inner = dynamic(() => import("./RichTextEditorInner").then((m) => m.RichTextEditorInner), {
  ssr: false,
  loading: () => <div className={s.rteLoading} aria-hidden="true" />,
});

export function RichTextEditor({
  id,
  name,
  initialValue,
  maxPlain,
  disabled,
  labelledBy,
  describedBy,
  invalid,
  labels,
}: {
  id: string;
  name: string;
  initialValue: string;
  maxPlain: number;
  disabled: boolean;
  labelledBy: string;
  describedBy: string;
  invalid: boolean;
  labels: RichTextEditorLabels;
}) {
  const [value, setValue] = useState(initialValue);
  const plainLength = toPlainText(value).length;
  const countId = `${id}-count`;

  return (
    <div className={s.rte} data-invalid={invalid ? "true" : undefined} data-testid={`${id}-editor`}>
      <input type="hidden" name={name} value={value} />
      <Inner
        id={id}
        initialValue={initialValue}
        disabled={disabled}
        labelledBy={labelledBy}
        describedBy={`${describedBy} ${countId}`}
        invalid={invalid}
        labels={labels}
        onChange={setValue}
      />
      <p className={s.rteCount} id={countId} data-over={plainLength > maxPlain ? "true" : undefined}>
        {labels.count.replace("{n}", String(plainLength)).replace("{max}", String(maxPlain))}
      </p>
      <div className={s.rteSample}>
        <p className={s.rteSampleTitle}>{labels.sample}</p>
        <RichText text={value} className={s.rteSampleBody} testId={`${id}-sample`} />
      </div>
    </div>
  );
}

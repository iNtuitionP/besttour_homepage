/**
 * 서식 편집기(T3-4) 문구 — 공지·팝업의 새로 쓰기·고치기 화면이 같이 쓴다(서버 전용). 원문은 messages/ko.json `admin.editor.*`.
 */
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";

import type { RichTextEditorLabels } from "./RichTextEditor";

export async function getRichTextEditorLabels(): Promise<RichTextEditorLabels> {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.editor" });
  return {
    toolbar: t("toolbar"),
    bold: t("bold"),
    italic: t("italic"),
    h1: t("h1"),
    h2: t("h2"),
    bullet: t("bullet"),
    undo: t("undo"),
    redo: t("redo"),
    sample: t("sample"),
    // `{n}` · `{max}` 는 화면이 채운다 — next-intl 보간을 거치지 않게 원문 그대로
    count: t.raw("count") as string,
  };
}

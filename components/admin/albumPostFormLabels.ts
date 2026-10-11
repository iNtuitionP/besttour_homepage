/**
 * 갤러리 글 폼(T4-2)의 문구 — 새 글·고치기 두 화면이 같이 쓴다(서버 전용). 원문은 messages/ko.json `admin.gallery.*`.
 */
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import type { GalleryActionCode } from "@/lib/admin/galleryInput";

import type { AlbumPostFormLabels } from "./AlbumPostForm";
import { getCopyWarningLabels } from "./copyWarningLabels";
import { getRichTextEditorLabels } from "./richTextEditorLabels";

export async function getGalleryResultLabels(): Promise<Record<GalleryActionCode, string>> {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.gallery" });
  const codes: GalleryActionCode[] = [
    "recorded", "updated", "deleted", "activated", "deactivated",
    "albumCreated", "albumUpdated", "albumActivated", "albumDeactivated", "albumDeleted",
    "notFound", "validation", "failed", "fileFailed", "inUseByPopup", "copyWarning",
  ];
  return Object.fromEntries(codes.map((c) => [c, t(`result.${c}`)])) as Record<GalleryActionCode, string>;
}

export async function getAlbumPostFormLabels(): Promise<AlbumPostFormLabels> {
  const [t, results, copyWarning, editor] = await Promise.all([
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.gallery" }),
    getGalleryResultLabels(),
    getCopyWarningLabels(),
    getRichTextEditorLabels(),
  ]);
  return {
    title: t("albumTitle"),
    titleHint: t("albumTitleHint"),
    date: t("albumDate"),
    dateHint: t("albumDateHint"),
    body: t("albumBody"),
    bodyHint: t("albumBodyHint"),
    active: t("albumActive"),
    activeHint: t("albumActiveHint"),
    submit: t("albumSave"),
    processing: t("processing"),
    delete: t("albumDelete"),
    deleteArm: t("albumDeleteArm"),
    deleteNote: t("albumDeleteNote"),
    deleteConfirm: t("albumDeleteConfirm"),
    results,
    copyWarning,
    editor,
  };
}

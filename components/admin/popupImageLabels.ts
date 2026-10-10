/**
 * 팝업 사진 고르기(T3-3)의 문구와 갤러리 사진 목록 — 팝업 목록(새 팝업)·고치기 두 화면이 같이 쓴다(서버 전용).
 * 문구는 messages/ko.json `admin.popups.image.*`, 고르기 부품 문구는 갤러리 것(`admin.gallery.*`)을 그대로 쓴다.
 */
import { getTranslations } from "next-intl/server";

import { resolveImageUrl } from "@/components/home/image-url";
import { routing } from "@/i18n/routing";
import { listAdminPhotos } from "@/lib/admin/gallery";

import type { PopupGalleryPhoto, PopupImageLabels } from "./PopupImagePicker";

export async function getPopupImageLabels(): Promise<PopupImageLabels> {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.popups.image" });
  const g = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.gallery" });
  return {
    current: t("current"),
    none: t("none"),
    clear: t("clear"),
    fromGallery: t("fromGallery"),
    galleryEmpty: t("galleryEmpty"),
    upload: t("upload"),
    uploading: t("uploading"),
    uploadFailed: t("uploadFailed"),
    heicHelp: g("heicHelp"),
    pick: g("upload"),
    pickNone: g("pickNone"),
    pickCount: g.raw("pickCount") as string,
    drop: g("dropHere"),
    remove: g("removePick"),
    start: g("startUpload"),
  };
}

/** 고를 수 있는 갤러리 사진 — 관리자 목록과 같은 순서·상한(비노출 사진도 고를 수 있다: 팝업은 갤러리 노출과 무관하다). */
export async function getPopupGalleryPhotos(): Promise<PopupGalleryPhoto[]> {
  const rows = await listAdminPhotos({ albumId: undefined });
  return rows.map((row) => ({ imagePath: row.image_path, caption: row.caption, url: resolveImageUrl(row.image_path) }));
}

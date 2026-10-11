/**
 * 차량 폼(T4-1)의 문구 — 새 차량·고치기 두 화면이 같이 쓴다(서버 전용).
 * 문구는 messages/ko.json `admin.fleet.*`, 사진 고르기 부품 문구는 갤러리 것(`admin.gallery.*`)을 그대로 쓴다.
 */
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";

import { getCopyWarningLabels } from "./copyWarningLabels";
import type { VehicleFormLabels } from "./VehicleForm";

export async function getVehicleFormLabels(): Promise<VehicleFormLabels> {
  const [t, g, copyWarning] = await Promise.all([
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.fleet" }),
    getTranslations({ locale: routing.defaultLocale, namespace: "admin.gallery" }),
    getCopyWarningLabels(),
  ]);
  const keys = ["nameKo", "nameEn", "capacity", "descriptionKo", "imagePath", "active"] as const;
  return {
    field: Object.fromEntries(keys.map((k) => [k, t(`field.${k}`)])) as VehicleFormLabels["field"],
    hint: Object.fromEntries(keys.map((k) => [k, t(`hint.${k}`)])) as VehicleFormLabels["hint"],
    lockedNote: t("lockedNote"),
    referencedNote: t("referencedNote"),
    count: t.raw("count") as string,
    submit: t("save"),
    processing: t("processing"),
    delete: t("delete"),
    deleteArm: t("deleteArm"),
    deleteConfirm: t("deleteConfirm"),
    results: {
      created: t("result.created"),
      updated: t("result.updated"),
      deleted: t("result.deleted"),
      activated: t("result.activated"),
      deactivated: t("result.deactivated"),
      reordered: t("result.reordered"),
      notFound: t("result.notFound"),
      locked: t("result.locked"),
      referenced: t("result.referenced"),
      validation: t("result.validation"),
      failed: t("result.failed"),
      copyWarning: t("result.copyWarning"),
    },
    copyWarning,
    image: {
      current: t("image.current"),
      none: t("image.none"),
      clear: t("image.clear"),
      upload: t("image.upload"),
      uploading: t("image.uploading"),
      uploadFailed: t("image.uploadFailed"),
      heicHelp: g("heicHelp"),
      pick: g("upload"),
      pickNone: g("pickNone"),
      pickCount: g.raw("pickCount") as string,
      drop: g("dropHere"),
      remove: g("removePick"),
      start: g("startUpload"),
    },
  };
}

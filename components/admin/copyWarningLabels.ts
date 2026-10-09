/**
 * 경고 패널 문구 — 서버 컴포넌트(관리자 페이지)가 부른다 (P6-12).
 *
 * 공지·팝업·갤러리 다섯 화면이 같은 문구를 쓰므로 한 곳에서 만든다. 문구는 messages/ko.json `admin.copyWarning.*`,
 * 사유 문장은 docs/ops/admin-manual.md 4장과 같은 말이다. 관리자 화면은 한국어 고정(routing.defaultLocale)이다 —
 * 다른 관리자 페이지와 같은 규약.
 */
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { COPY_FIELDS, type CopyWarningLabels } from "@/lib/admin/copyWarning";
import { OWNER_COPY_KINDS } from "@/lib/copy/kinds";

export async function getCopyWarningLabels(): Promise<CopyWarningLabels> {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.copyWarning" });
  return {
    title: t("title"),
    lead: t("lead"),
    confirm: t("confirm"),
    // `{field}` 같은 자리는 화면이 채운다 — next-intl 의 보간을 거치지 않도록 원문 그대로 꺼낸다.
    item: t.raw("item") as string,
    field: Object.fromEntries(COPY_FIELDS.map((f) => [f, t(`field.${f}`)])) as CopyWarningLabels["field"],
    kind: Object.fromEntries(OWNER_COPY_KINDS.map((k) => [k, t(`kind.${k}`)])) as CopyWarningLabels["kind"],
  };
}

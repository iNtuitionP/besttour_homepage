/**
 * 상태 배지 글자 — 서버 컴포넌트(관리자 페이지)가 부른다 (P5-20 · components/admin/copyWarningLabels.ts 와 같은 모양).
 *
 * 예약 상태 이름은 messages/ko.json `admin.reservations.status.*`, 간편 접수 칩은 `admin.labels.quickBadge` — 목록의 상태 필터·메뉴 배지와
 * **같은 말**이다(건수의 이름이 화면마다 다르지 않게 — 제안서 ④ 원칙 2). 관리자 영역은 로케일 밖이라 한국어 고정(routing.defaultLocale).
 * `waiting` 의 `{days}` 자리는 그리는 쪽(StatusBadge)이 채운다 — next-intl 의 보간을 거치지 않도록 원문 틀(t.raw)을 내린다.
 */
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";

import type { StatusBadgeLabels } from "./status-badge";

export async function getStatusBadgeLabels(): Promise<StatusBadgeLabels> {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.reservations.status" });
  const labels = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.labels" });
  return {
    new: t("new"),
    waiting: t.raw("waiting") as string,
    confirmed: t("confirmed"),
    done: t("done"),
    cancelled: t("cancelled"),
    quick: labels("quickBadge"),
    overdue: t("overdue"),
  };
}

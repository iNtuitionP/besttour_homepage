/**
 * 예약 상세 처리 영역 문구 — 서버 컴포넌트(예약 상세 페이지)가 부른다 (P5-19 · components/admin/copyWarningLabels.ts 와 같은 모양).
 *
 * 관리자 영역은 로케일 밖이라 NextIntlClientProvider 가 없다 — 클라이언트(ReservationActions)는 useTranslations 를 쓸 수 없고,
 * 서버가 카탈로그(messages/ko.json `admin.detail.*`)에서 문구를 풀어 props 로 내린다(기존 규약). 한국어 고정(routing.defaultLocale).
 *
 * 시트 제목의 `{name}` 자리와 상한 안내의 `{max}`·`{count}` 는 **화면이 채운다** — next-intl 의 보간을 거치지 않도록 원문 틀(t.raw)을 내린다.
 * 이름을 여기서 채우면 고객 이름이 props 로 클라이언트 경계를 넘는다(P3-5 리뷰 N-2). 화면은 서버가 이미 그린 이름 칸
 * (reservation-sheet.ts CUSTOMER_NAME_ELEMENT_ID)에서 시트를 열 때 읽는다.
 */
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { routing } from "@/i18n/routing";

import { CANCEL_REASONS, type ReservationActionLabels } from "./reservation-sheet";
import { ADMIN_TABS } from "./tabs";

const bold = (chunks: ReactNode) => <b>{chunks}</b>;

export async function getReservationActionLabels(): Promise<ReservationActionLabels> {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.detail" });
  const notifications = ADMIN_TABS.find((tab) => tab.key === "notifications" && tab.ready);

  return {
    panel: t("sectionAdmin"),
    confirm: t("confirm"),
    confirmHint: t("confirmHint"),
    complete: t("complete"),
    completeHint: t("completeHint"),
    cancel: t("cancel"),
    cancelHint: t("cancelHint"),
    processDone: t("process.done"),
    processCancelled: t("process.cancelled"),
    moreCancel: t("process.moreCancel"),
    memoLabel: t("memoLabel"),
    memoHint: t("memoHint"),
    memoSave: t("memoSave"),
    memoPlaceholder: t("memoPlaceholder"),
    processing: t("processing"),
    sheet: {
      close: t("sheet.close"),
      quickNote: t("sheet.quickNote"),
      slow: t("sheet.slow"),
      confirm: {
        title: t.raw("sheet.confirmTitle") as string,
        titleNoName: t("sheet.confirmTitleNoName"),
        body: t("sheet.confirmBody"),
        submit: t("sheet.confirmSubmit"),
      },
      cancel: {
        title: t.raw("sheet.cancelTitle") as string,
        titleNoName: t("sheet.cancelTitleNoName"),
        body: t.rich("sheet.cancelBody", { b: bold }),
        submit: t("sheet.cancelSubmit"),
        reasonLegend: t("sheet.reasonLegend"),
        reasonHint: t("sheet.reasonHint"),
        reasons: CANCEL_REASONS.map((key) => {
          const label = t(`sheet.reason.${key}`);
          return { key, label, line: t("sheet.reasonLine", { reason: label }) };
        }),
      },
      complete: {
        title: t.raw("sheet.completeTitle") as string,
        titleNoName: t("sheet.completeTitleNoName"),
        body: t("sheet.completeBody"),
        submit: t("sheet.completeSubmit"),
      },
    },
    results: {
      confirmed: t("result.confirmed"),
      cancelled: t("result.cancelled"),
      completed: t("result.completed"),
      memoUpdated: t("result.memoUpdated"),
      alreadyHandled: t("result.alreadyHandled"),
      failed: t("result.failed"),
    },
    memoTooLong: t.raw("sheet.memoTooLong") as string,
    memoTooLongWithReason: t.raw("sheet.memoTooLongWithReason") as string,
    toastLink: notifications ? { label: t("toastLink"), href: notifications.href } : null,
  };
}

"use client";
/**
 * 목록에서 팝업을 바로 내리고 올리는 버튼 (P5-4).
 *
 * 수정 화면까지 들어가지 않고 "지금 내리기" 를 할 수 있어야 한다 — 팝업은 잘못 올렸을 때 **빨리** 내려야 하는 물건이다.
 * 나머지 컬럼은 건드리지 않는다(actions/admin/popup.ts togglePopupActive → setPopupActive 가 active 만 쓴다).
 *
 * props 는 id·현재 상태·문구뿐이다. 마지막 판정은 언제나 DB 다: 다른 탭에서 이미 내렸다면 이 버튼의 상태는 낡았고,
 * 그때 액션은 바뀐 행이 없다고 답한다(notFound) — 그 경우에도 화면을 다시 읽는다.
 *
 * 결과 알림(P5-20): 성공은 레이아웃의 토스트, 실패는 이 버튼 옆 배너(role=alert — 다음 누름 때 걷힌다). 판정은 feedback.ts.
 * 처리 중(P5-21): 공용 PendingButton — disabled 대신 aria-disabled + 누름 무시라 포커스가 body 로 떨어지지 않는다(P5-20 ⑧-1).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { togglePopupActive } from "@/actions/admin/popup";
import type { PopupActionCode } from "@/lib/admin/popupInput";

import s from "./admin.module.css";
import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { feedbackKind } from "./feedback";
import { PendingButton } from "./PendingButton";

export interface PopupToggleLabels {
  turnOn: string;
  turnOff: string;
  processing: string;
  results: Record<PopupActionCode, string>;
}

export function PopupToggle({ id, active, labels }: { id: number; active: boolean; labels: PopupToggleLabels }) {
  const router = useRouter();
  const toast = useAdminToast();
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState("");

  const onClick = () => {
    setBanner("");
    startTransition(async () => {
      const result = await togglePopupActive(id, !active);
      const kind = feedbackKind(result);
      if (kind === "toast") toast.show({ text: labels.results[result.code] });
      else if (kind === "banner") setBanner(labels.results[result.code]);
      router.refresh();
    });
  };

  return (
    <>
      <PendingButton className={s.btnSecondary} pending={pending} onClick={onClick} testId="admin-popup-toggle">
        {pending ? labels.processing : active ? labels.turnOff : labels.turnOn}
      </PendingButton>
      <AdminBanner text={banner} variant="inline" />
    </>
  );
}

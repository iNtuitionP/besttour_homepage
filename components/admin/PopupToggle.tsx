"use client";
/**
 * 목록에서 팝업을 바로 내리고 올리는 버튼 (P5-4).
 *
 * 수정 화면까지 들어가지 않고 "지금 내리기" 를 할 수 있어야 한다 — 팝업은 잘못 올렸을 때 **빨리** 내려야 하는 물건이다.
 * 나머지 컬럼은 건드리지 않는다(actions/admin/popup.ts togglePopupActive → setPopupActive 가 active 만 쓴다).
 *
 * props 는 id·현재 상태·문구뿐이다. 마지막 판정은 언제나 DB 다: 다른 탭에서 이미 내렸다면 이 버튼의 상태는 낡았고,
 * 그때 액션은 바뀐 행이 없다고 답한다(notFound) — 그 경우에도 화면을 다시 읽는다.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { togglePopupActive } from "@/actions/admin/popup";
import type { PopupActionCode } from "@/lib/admin/popupInput";

import s from "./admin.module.css";

export interface PopupToggleLabels {
  turnOn: string;
  turnOff: string;
  processing: string;
  results: Record<PopupActionCode, string>;
}

export function PopupToggle({ id, active, labels }: { id: number; active: boolean; labels: PopupToggleLabels }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");

  const onClick = () => {
    setNotice("");
    startTransition(async () => {
      const result = await togglePopupActive(id, !active);
      setNotice(labels.results[result.code]);
      router.refresh();
    });
  };

  return (
    <>
      <button type="button" className={s.btnSecondary} disabled={pending} onClick={onClick} data-testid="admin-popup-toggle">
        {pending ? labels.processing : active ? labels.turnOff : labels.turnOn}
      </button>
      <p className={s.notice} role="status">
        {notice}
      </p>
    </>
  );
}

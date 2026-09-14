"use client";
/**
 * 목록에서 공지를 바로 내리고 올리는 버튼 (P5-5). components/admin/PopupToggle.tsx 와 같은 구조다.
 *
 * **이 탭에서 가장 자주 쓰는 도구**다: 지우는 대신 내린다. 노출을 끄면 방문자에게는 사라지지만 id 가 남아
 * 언제든 같은 URL 로 되살아난다 — 문자로 나간 상세 링크를 죽이지 않는 유일한 방법이다.
 * 목록에는 삭제 버튼을 두지 않는다(삭제는 수정 화면의 두 단계 확인을 거친다).
 *
 * props 는 id·현재 상태·문구뿐이다. 마지막 판정은 언제나 DB 다: 다른 탭에서 이미 내렸다면 이 버튼의 상태는 낡았고,
 * 그때 액션은 바뀐 행이 없다고 답한다(notFound) — 그 경우에도 화면을 다시 읽는다.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toggleNoticeActive } from "@/actions/admin/notice";
import type { NoticeActionCode } from "@/lib/admin/noticeInput";

import s from "./admin.module.css";

export interface NoticeToggleLabels {
  turnOn: string;
  turnOff: string;
  processing: string;
  results: Record<NoticeActionCode, string>;
}

export function NoticeToggle({ id, active, labels }: { id: number; active: boolean; labels: NoticeToggleLabels }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");

  const onClick = () => {
    setNotice("");
    startTransition(async () => {
      const result = await toggleNoticeActive(id, !active);
      setNotice(labels.results[result.code]);
      router.refresh();
    });
  };

  return (
    <>
      <button type="button" className={s.btnSecondary} disabled={pending} onClick={onClick} data-testid="admin-notice-toggle">
        {pending ? labels.processing : active ? labels.turnOff : labels.turnOn}
      </button>
      <p className={s.notice} role="status">
        {notice}
      </p>
    </>
  );
}

"use client";
/**
 * 예약 상세의 "홈에서 숨기기 / 다시 보이기" (OF2-B · 0026). 손님이 홈 접수 현황에서 내려 달라고 할 때 사장님이 한 번 누른다.
 *
 * 확인 시트를 거치지 않는다 — 접수 기록을 지우지 않고 되돌릴 수 있는(다시 보이기) 동작이라 한 번 더 묻지 않는다.
 * 결과는 NoticeToggle 과 같은 규약이다: 성공은 레이아웃의 토스트, 실패는 이 버튼 옆 배너(feedback.ts 판정). 처리 중은 PendingButton.
 * 마지막 판정은 언제나 DB 다 — 상태가 낡았어도 같은 값을 다시 보내면 오류가 아니다. 어느 쪽이든 화면을 다시 읽는다.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setReservationFeedHidden } from "@/actions/admin/reservationFeed";
import type { FeedHiddenCode } from "@/lib/admin/feedHidden";

import s from "./admin.module.css";
import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { feedbackKind } from "./feedback";
import { PendingButton } from "./PendingButton";

export interface FeedHideLabels {
  title: string;
  hint: string;
  hide: string;
  show: string;
  stateHidden: string;
  processing: string;
  results: Record<FeedHiddenCode, string>;
}

export function FeedHideToggle({ id, hidden, labels }: { id: string; hidden: boolean; labels: FeedHideLabels }) {
  const router = useRouter();
  const toast = useAdminToast();
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState("");

  const onClick = () => {
    setBanner("");
    startTransition(async () => {
      const result = await setReservationFeedHidden(id, !hidden);
      const kind = feedbackKind(result);
      if (kind === "toast") toast.show({ text: labels.results[result.code] });
      else if (kind === "banner") setBanner(labels.results[result.code]);
      router.refresh();
    });
  };

  return (
    <section className={s.detailCard} aria-labelledby="admin-feed-title" data-testid="admin-feed-hide" data-hidden={hidden ? "true" : "false"}>
      <h2 id="admin-feed-title" className={s.detailCardTitle}>
        {labels.title}
      </h2>
      {hidden ? (
        <p className={s.processNote} data-testid="admin-feed-state">
          {labels.stateHidden}
        </p>
      ) : null}
      <PendingButton className={s.btnSecondary} pending={pending} onClick={onClick} testId="admin-feed-toggle">
        {pending ? labels.processing : hidden ? labels.show : labels.hide}
      </PendingButton>
      <p className={s.hint}>{labels.hint}</p>
      <AdminBanner text={banner} variant="inline" />
    </section>
  );
}

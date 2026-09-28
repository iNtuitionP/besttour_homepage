"use client";
/**
 * 목록에서 대표 노선을 바로 내리고 올리는 버튼 (P5-6). components/admin/PopupToggle.tsx 와 같은 구조다.
 *
 * **지우는 대신 내린다** — 이 탭에는 삭제가 아예 없다(lib/admin/routes.ts 헤더). 내리면 홈 지도·카드에서 빠지고
 * 가격·정렬은 그대로 남아, 다시 올리면 원래 값으로 돌아온다.
 *
 * props 는 id·현재 상태·문구뿐이다. 마지막 판정은 언제나 DB 다.
 *
 * 결과 알림(P5-20): 성공은 레이아웃의 토스트, 실패는 이 버튼 옆 배너(role=alert — 다음 누름 때 걷힌다). 판정은 feedback.ts.
 * 처리 중(P5-21): 공용 PendingButton — disabled 대신 aria-disabled + 누름 무시라 포커스가 body 로 떨어지지 않는다(P5-20 ⑧-1).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toggleRouteActive } from "@/actions/admin/route";
import type { RouteActionCode } from "@/lib/admin/routeInput";

import s from "./admin.module.css";
import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { feedbackKind } from "./feedback";
import { PendingButton } from "./PendingButton";

export interface RouteToggleLabels {
  turnOn: string;
  turnOff: string;
  processing: string;
  results: Record<RouteActionCode, string>;
}

export function RouteToggle({ id, active, labels }: { id: number; active: boolean; labels: RouteToggleLabels }) {
  const router = useRouter();
  const toast = useAdminToast();
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState("");

  const onClick = () => {
    setBanner("");
    startTransition(async () => {
      const result = await toggleRouteActive(id, !active);
      const kind = feedbackKind(result);
      if (kind === "toast") toast.show({ text: labels.results[result.code] });
      else if (kind === "banner") setBanner(labels.results[result.code]);
      router.refresh();
    });
  };

  return (
    <>
      <PendingButton className={s.btnSecondary} pending={pending} onClick={onClick} testId="admin-route-toggle">
        {pending ? labels.processing : active ? labels.turnOff : labels.turnOn}
      </PendingButton>
      <AdminBanner text={banner} variant="inline" />
    </>
  );
}

"use client";
/**
 * 목록에서 대표 노선을 바로 내리고 올리는 버튼 (P5-6). components/admin/PopupToggle.tsx 와 같은 구조다.
 *
 * **지우는 대신 내린다** — 이 탭에는 삭제가 아예 없다(lib/admin/routes.ts 헤더). 내리면 홈 지도·카드에서 빠지고
 * 가격·정렬은 그대로 남아, 다시 올리면 원래 값으로 돌아온다.
 *
 * props 는 id·현재 상태·문구뿐이다. 마지막 판정은 언제나 DB 다.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toggleRouteActive } from "@/actions/admin/route";
import type { RouteActionCode } from "@/lib/admin/routeInput";

import s from "./admin.module.css";

export interface RouteToggleLabels {
  turnOn: string;
  turnOff: string;
  processing: string;
  results: Record<RouteActionCode, string>;
}

export function RouteToggle({ id, active, labels }: { id: number; active: boolean; labels: RouteToggleLabels }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");

  const onClick = () => {
    setNotice("");
    startTransition(async () => {
      const result = await toggleRouteActive(id, !active);
      setNotice(labels.results[result.code]);
      router.refresh();
    });
  };

  return (
    <>
      <button type="button" className={s.btnSecondary} disabled={pending} onClick={onClick} data-testid="admin-route-toggle">
        {pending ? labels.processing : active ? labels.turnOff : labels.turnOn}
      </button>
      <p className={s.notice} role="status">
        {notice}
      </p>
    </>
  );
}

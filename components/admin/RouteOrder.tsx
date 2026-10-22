"use client";
/**
 * 대표 노선 목록 (T3-5 · 결정 10 A안 · OF3-R2 한 목록) — 공용 SortableList 를 노선 순서 저장 액션에 잇는다.
 * 줄마다 이름·금액·상태와 줄 끝 슬롯([수정]·[켜기/끄기])이 들어 있다(페이지가 items[].end 로 내려 준다) — 순서가 바뀐 동안 그 슬롯은 잠긴다.
 * 성공은 토스트, 실패(중간에 멈춤 포함)는 배너 — feedback.ts 와 같은 원칙. 끝나면 목록을 새로 읽는다(부분 저장이어도 실제 순서가 보이게).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { reorderRoutes } from "@/actions/admin/route";

import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { SortableList, type SortableItem, type SortableListLabels } from "./SortableList";

export function RouteOrder({
  items,
  labels,
  saved,
  failed,
}: {
  items: readonly SortableItem[];
  labels: SortableListLabels;
  saved: string;
  failed: string;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const [banner, setBanner] = useState("");
  const [round, setRound] = useState(0);

  return (
    <>
      <SortableList
        // 목록이 새로 읽히면(순서·노출이 바뀌면) 부품을 새로 만든다 — 끌던 상태가 옛 목록에 남지 않게
        key={items.map((it) => `${it.id}:${it.meta ?? ""}:${it.status?.text ?? ""}`).join(",")}
        items={items}
        labels={labels}
        testId="admin-route-order"
        onSave={async (ids) => {
          setBanner("");
          const result = await reorderRoutes(ids);
          if (result.ok) toast.show({ text: saved });
          else {
            setBanner(failed);
            setRound((n) => n + 1);
          }
          router.refresh();
          return result.ok;
        }}
      />
      <AdminBanner text={banner} attempt={round} testId="admin-route-order-banner" />
    </>
  );
}

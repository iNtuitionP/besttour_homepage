"use client";
/**
 * 차량 목록의 두 조작 (T4-1) — 숨기기/다시 보이기(RouteToggle 과 같은 결)와 순서 바꾸기(공용 SortableList → 0024 의 원자적 저장).
 * 성공은 토스트, 실패는 배너(feedback.ts). 끝나면 목록을 새로 읽는다.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { reorderVehicles, toggleVehicleActive } from "@/actions/admin/vehicle";
import type { VehicleActionCode } from "@/lib/admin/vehicleInput";

import s from "./admin.module.css";
import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { feedbackKind } from "./feedback";
import { PendingButton } from "./PendingButton";
import { SortableList, type SortableItem, type SortableListLabels } from "./SortableList";

export interface VehicleToggleLabels {
  turnOn: string;
  turnOff: string;
  processing: string;
  results: Record<VehicleActionCode, string>;
}

export function VehicleToggle({ id, active, labels }: { id: number; active: boolean; labels: VehicleToggleLabels }) {
  const router = useRouter();
  const toast = useAdminToast();
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState("");

  const onClick = () => {
    setBanner("");
    startTransition(async () => {
      const result = await toggleVehicleActive(id, !active);
      const kind = feedbackKind(result);
      if (kind === "toast") toast.show({ text: labels.results[result.code] });
      else if (kind === "banner") setBanner(labels.results[result.code]);
      router.refresh();
    });
  };

  return (
    <>
      <PendingButton className={s.btnSecondary} pending={pending} onClick={onClick} testId="admin-vehicle-toggle">
        {pending ? labels.processing : active ? labels.turnOff : labels.turnOn}
      </PendingButton>
      <AdminBanner text={banner} variant="inline" />
    </>
  );
}

export function VehicleOrder({ items, labels, saved, failed }: { items: readonly SortableItem[]; labels: SortableListLabels; saved: string; failed: string }) {
  const router = useRouter();
  const toast = useAdminToast();
  const [banner, setBanner] = useState("");
  const [round, setRound] = useState(0);

  return (
    <>
      <SortableList
        key={items.map((it) => `${it.id}:${it.meta ?? ""}:${it.status?.text ?? ""}`).join(",")}
        items={items}
        labels={labels}
        testId="admin-vehicle-order"
        onSave={async (ids) => {
          setBanner("");
          const result = await reorderVehicles(ids);
          if (result.ok) toast.show({ text: saved });
          else {
            setBanner(failed);
            setRound((n) => n + 1);
          }
          router.refresh();
          return result.ok;
        }}
      />
      <AdminBanner text={banner} attempt={round} testId="admin-vehicle-order-banner" />
    </>
  );
}

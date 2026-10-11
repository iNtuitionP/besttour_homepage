"use client";
/**
 * 차량 등록·수정 폼 (T4-1 · 결정 11). 등록 화면과 수정 화면이 같은 컴포넌트를 쓴다 — PopupForm 과 같은 결.
 *
 *   - 칸: 한글 이름 · 영문 이름(필수) · 정원 · 한글 설명 · 사진. **영문 설명 칸은 없다**(영문 화면에서는 설명을 숨긴다).
 *   - **접수 기록이 있는 차량**(`hasBookings`)은 이름·정원 칸이 읽기 전용이고 지우기 대신 안내가 보인다 — 숨기기는 목록에서.
 *     막는 것은 DB 다(0024 'locked'·'referenced'). 이 화면의 잠금은 헛걸음을 줄이는 편의다.
 *   - 저장 전 확인(경고 후 저장 — 공지·팝업과 같다): 한글 이름·설명이 카피 목록에 걸리면 CopyWarningPanel 이 묻는다.
 *   - 성공은 토스트, 실패는 배너(feedback.ts). 삭제는 두 단계(무장 체크 → 확인 창).
 * 문구는 전부 props(messages/ko.json `admin.fleet.*`).
 */
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { createVehicle, deleteVehicle, updateVehicle } from "@/actions/admin/vehicle";
import { COPY_ACK_FIELD, type CopyWarning } from "@/lib/admin/copyWarning";
import {
  VEHICLE_CAPACITY_MAX,
  VEHICLE_CAPACITY_MIN,
  VEHICLE_DESCRIPTION_MAX,
  VEHICLE_FIELDS,
  VEHICLE_NAME_EN_MAX,
  VEHICLE_NAME_KO_MAX,
  type VehicleActionCode,
  type VehicleActionResult,
  type VehicleField,
} from "@/lib/admin/vehicleInput";

import s from "./admin.module.css";
import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { CopyWarningPanel, isCopyAckSubmitter, mergeAck, type CopyWarningLabels } from "./CopyWarningPanel";
import { feedbackKind } from "./feedback";
import { VehicleImageField, type VehicleImageLabels } from "./VehicleImageField";

export interface VehicleFormValues {
  nameKo: string;
  nameEn: string;
  capacity: string;
  descriptionKo: string;
  imagePath: string;
  active: boolean;
}

export interface VehicleFormLabels {
  field: Record<"nameKo" | "nameEn" | "capacity" | "descriptionKo" | "imagePath" | "active", string>;
  hint: Record<"nameKo" | "nameEn" | "capacity" | "descriptionKo" | "imagePath" | "active", string>;
  lockedNote: string;
  referencedNote: string;
  count: string;
  submit: string;
  processing: string;
  delete: string;
  deleteArm: string;
  deleteConfirm: string;
  results: Record<VehicleActionCode, string>;
  copyWarning: CopyWarningLabels;
  image: VehicleImageLabels;
}

export function VehicleForm({
  mode,
  id,
  initial,
  hasBookings,
  labels,
  listHref,
}: {
  mode: "create" | "edit";
  id?: number;
  initial: VehicleFormValues;
  hasBookings: boolean;
  labels: VehicleFormLabels;
  listHref: string;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState("");
  const [invalid, setInvalid] = useState<Partial<Record<VehicleField, true>>>({});
  const [armed, setArmed] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [warnings, setWarnings] = useState<CopyWarning[]>([]);
  const [warningRound, setWarningRound] = useState(0);
  const [ack, setAck] = useState<string[]>([]);
  const [descLength, setDescLength] = useState(initial.descriptionKo.length);

  const mark = (field: VehicleField): "true" | undefined => (invalid[field] ? "true" : undefined);
  const lockNames = mode === "edit" && hasBookings;

  const report = (result: VehicleActionResult) => {
    const kind = feedbackKind(result);
    if (kind === "toast") toast.show({ text: labels.results[result.code] });
    setBanner(kind === "banner" ? labels.results[result.code] : "");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (isCopyAckSubmitter((event.nativeEvent as SubmitEvent).submitter)) {
      for (const key of ack) formData.append(COPY_ACK_FIELD, key);
    }
    setBanner("");
    setInvalid({});
    startTransition(async () => {
      const result = mode === "create" ? await createVehicle(formData) : await updateVehicle(formData);
      report(result);
      setInvalid(result.fieldErrors ?? {});
      if (result.code === "copyWarning") {
        const held = result.copyWarnings ?? [];
        setWarnings(held);
        setWarningRound((n) => n + 1);
        setAck((prev) => mergeAck(prev, held));
        return;
      }
      setWarnings([]);
      setAck([]);
      if (!result.changed) return;
      if (mode === "create") {
        router.push(listHref);
        return;
      }
      setResetKey((k) => k + 1);
      router.refresh();
    });
  };

  const onDelete = () => {
    if (id === undefined || !armed) return;
    if (!window.confirm(labels.deleteConfirm)) return;
    setBanner("");
    startTransition(async () => {
      const result = await deleteVehicle(id);
      report(result);
      if (result.changed) router.push(listHref);
    });
  };

  return (
    <form ref={formRef} className={s.popupForm} onSubmit={onSubmit} data-testid="admin-vehicle-form">
      {mode === "edit" && id !== undefined ? <input type="hidden" name={VEHICLE_FIELDS.id} value={id} readOnly /> : null}

      {lockNames ? (
        <p className={s.hint} data-testid="admin-vehicle-locked">
          {labels.lockedNote}
        </p>
      ) : null}

      <div className={s.field}>
        <label className={s.label} htmlFor="vehicle-name-ko">
          {labels.field.nameKo}
        </label>
        <p className={s.hint} id="vehicle-name-ko-hint">
          {labels.hint.nameKo}
        </p>
        <input
          id="vehicle-name-ko"
          className={s.input}
          name={VEHICLE_FIELDS.nameKo}
          type="text"
          defaultValue={initial.nameKo}
          maxLength={VEHICLE_NAME_KO_MAX}
          required
          readOnly={lockNames}
          disabled={pending}
          aria-describedby="vehicle-name-ko-hint"
          aria-invalid={mark("nameKo")}
        />
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="vehicle-name-en">
          {labels.field.nameEn}
        </label>
        <p className={s.hint} id="vehicle-name-en-hint">
          {labels.hint.nameEn}
        </p>
        <input
          id="vehicle-name-en"
          className={s.input}
          name={VEHICLE_FIELDS.nameEn}
          type="text"
          lang="en"
          defaultValue={initial.nameEn}
          maxLength={VEHICLE_NAME_EN_MAX}
          required
          readOnly={lockNames}
          disabled={pending}
          aria-describedby="vehicle-name-en-hint"
          aria-invalid={mark("nameEn")}
        />
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="vehicle-capacity">
          {labels.field.capacity}
        </label>
        <p className={s.hint} id="vehicle-capacity-hint">
          {labels.hint.capacity}
        </p>
        <input
          id="vehicle-capacity"
          className={s.input}
          name={VEHICLE_FIELDS.capacity}
          type="number"
          inputMode="numeric"
          min={VEHICLE_CAPACITY_MIN}
          max={VEHICLE_CAPACITY_MAX}
          defaultValue={initial.capacity}
          required
          readOnly={lockNames}
          disabled={pending}
          aria-describedby="vehicle-capacity-hint"
          aria-invalid={mark("capacity")}
        />
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="vehicle-description">
          {labels.field.descriptionKo}
        </label>
        <p className={s.hint} id="vehicle-description-hint">
          {labels.hint.descriptionKo}
        </p>
        <textarea
          key={resetKey}
          id="vehicle-description"
          className={s.textarea}
          name={VEHICLE_FIELDS.descriptionKo}
          defaultValue={initial.descriptionKo}
          maxLength={VEHICLE_DESCRIPTION_MAX}
          rows={4}
          disabled={pending}
          onChange={(e) => setDescLength(e.currentTarget.value.length)}
          aria-describedby="vehicle-description-hint vehicle-description-count"
          aria-invalid={mark("descriptionKo")}
        />
        <p className={s.hint} id="vehicle-description-count">
          {labels.count.replace("{n}", String(descLength)).replace("{max}", String(VEHICLE_DESCRIPTION_MAX))}
        </p>
      </div>

      <div className={s.field}>
        <span className={s.label} id="vehicle-image-label">
          {labels.field.imagePath}
        </span>
        <p className={s.hint} id="vehicle-image-hint">
          {labels.hint.imagePath}
        </p>
        <VehicleImageField initialPath={initial.imagePath} labels={labels.image} disabled={pending} invalid={mark("imagePath") === "true"} hintId="vehicle-image-hint" />
      </div>

      {mode === "create" ? (
        <div className={s.field}>
          <div className={s.checkRow}>
            <input id="vehicle-active" name={VEHICLE_FIELDS.active} type="checkbox" defaultChecked={initial.active} disabled={pending} aria-describedby="vehicle-active-hint" />
            <label className={s.label} htmlFor="vehicle-active">
              {labels.field.active}
            </label>
          </div>
          <p className={s.hint} id="vehicle-active-hint">
            {labels.hint.active}
          </p>
        </div>
      ) : null}

      <div className={s.formActions}>
        <button type="submit" className={s.btnPrimary} disabled={pending} data-testid="admin-vehicle-submit">
          {pending ? labels.processing : labels.submit}
        </button>
      </div>

      <AdminBanner text={banner} testId="admin-vehicle-banner" />

      <CopyWarningPanel warnings={warnings} labels={labels.copyWarning} pending={pending} idPrefix="vehicle" attempt={warningRound} />

      {mode === "edit" && id !== undefined ? (
        hasBookings ? (
          <p className={s.hint} data-testid="admin-vehicle-referenced">
            {labels.referencedNote}
          </p>
        ) : (
          <div className={s.dangerZone} data-testid="admin-vehicle-danger">
            <div className={s.checkRow}>
              <input id="vehicle-delete-arm" type="checkbox" checked={armed} disabled={pending} onChange={(e) => setArmed(e.currentTarget.checked)} />
              <label className={s.label} htmlFor="vehicle-delete-arm">
                {labels.deleteArm}
              </label>
            </div>
            <button type="button" className={s.btnSecondary} disabled={pending || !armed} onClick={onDelete} data-testid="admin-vehicle-delete">
              {labels.delete}
            </button>
          </div>
        )
      ) : null}
    </form>
  );
}

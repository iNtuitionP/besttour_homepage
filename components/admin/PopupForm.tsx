"use client";
/**
 * 팝업 등록·수정 폼 (P5-4). 등록 화면과 수정 화면이 같은 컴포넌트를 쓴다 — 폼이 둘로 갈리면 검증도 둘로 갈린다.
 *
 * 클라이언트인 이유: 결과를 같은 자리에서 보여 주고(role="status"), 처리 중에 버튼을 잠그고, 저장 뒤 화면을 다시 읽기 위해서다.
 * props 에 개인정보가 없다(팝업은 콘텐츠 표다). 필드 이름은 lib/admin/popupInput.ts 의 단일 상수에서 온다 —
 * 화면과 서버가 각자 문자열을 적으면 조용히 어긋난다. 문구는 전부 props(messages/ko.json `admin.popups.*`)다.
 *
 * 검증은 서버가 한다. 여기서 막지 않는 이유: 이 컴포넌트를 거치지 않고 액션을 직접 부를 수 있기 때문이다(ADR-3).
 * 브라우저 기본 검사(required·maxLength)는 오타를 줄이는 편의일 뿐이고, 판정은 zod 의 결과(fieldErrors)로 표시한다.
 *
 * **삭제는 두 단계다**(P5-11 — 공지·사진의 선례를 팝업에도 맞췄다). 같은 사이트에서 같은 무게의 동작이
 * 화면마다 다른 문턱을 갖고 있으면 사장님이 "이 화면은 한 번만 누르면 되던가?" 를 매번 기억해야 한다.
 * 무장 체크박스를 켠 뒤에야 삭제 버튼이 눌리고, 누르면 브라우저가 한 번 더 묻는다.
 * 성공하면 목록으로 돌아간다 — 지워진 행의 수정 화면에 남아 있을 이유가 없다.
 *
 * **저장 전 확인(P6-12 · known-defects D4).** 서버가 제목·본문에서 확인이 필요한 표현을 찾으면 저장하지 않고
 * `copyWarning` 을 돌려준다. 그러면 저장 버튼 아래에 CopyWarningPanel 이 무엇이·왜 문제인지 보이고,
 * **그대로 저장하기**(submit + data-copy-ack)를 누르면 같은 폼에 확인 키를 붙여 다시 보낸다 — 막지 않는다.
 *
 * **결과 알림(P5-20).** 성공은 레이아웃의 토스트(3초 · components/admin/AdminToast.tsx), 실패는 저장 버튼 바로 아래 배너(role=alert —
 * 저절로 닫히지 않고 다음 저장 때 걷힌다). 삭제 뒤에는 목록으로 옮겨 가도 토스트가 남는다(레이아웃이 자리를 쥐고 있다). 판정은 feedback.ts.
 */
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { createPopup, deletePopup, updatePopup } from "@/actions/admin/popup";
import { COPY_ACK_FIELD, type CopyWarning } from "@/lib/admin/copyWarning";
import { POPUP_BODY_MAX, POPUP_FIELDS, POPUP_TITLE_MAX, type PopupActionCode, type PopupActionResult, type PopupField } from "@/lib/admin/popupInput";

import s from "./admin.module.css";
import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { CopyWarningPanel, isCopyAckSubmitter, mergeAck, type CopyWarningLabels } from "./CopyWarningPanel";
import { feedbackKind } from "./feedback";

export interface PopupFormValues {
  title: string;
  body: string;
  imagePath: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
}

export interface PopupFormLabels {
  field: Record<"title" | "body" | "imagePath" | "startsAt" | "endsAt" | "period" | "active", string>;
  hint: Record<"title" | "body" | "imagePath" | "period" | "active", string>;
  notice: string;
  submit: string;
  processing: string;
  delete: string;
  deleteArm: string;
  deleteConfirm: string;
  results: Record<PopupActionCode, string>;
  copyWarning: CopyWarningLabels;
}

export function PopupForm({
  mode,
  id,
  initial,
  labels,
  listHref,
}: {
  mode: "create" | "edit";
  id?: number;
  initial: PopupFormValues;
  labels: PopupFormLabels;
  listHref: string;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState("");
  const [invalid, setInvalid] = useState<Partial<Record<PopupField, true>>>({});
  const [armed, setArmed] = useState(false);
  const [warnings, setWarnings] = useState<CopyWarning[]>([]);
  /** 저장이 경고로 멈춘 횟수 — 같은 경고가 다시 와도 패널이 다시 보이는 자리로 온다(재리뷰 P2-R1 · CopyWarningPanel attempt). */
  const [warningRound, setWarningRound] = useState(0);
  const [ack, setAck] = useState<string[]>([]);

  const mark = (field: PopupField): "true" | undefined => (invalid[field] ? "true" : undefined);

  /** 성공은 토스트, 실패는 이 자리 배너(저장 전 확인은 패널이 말한다 — feedback.ts). */
  const report = (result: PopupActionResult) => {
    const kind = feedbackKind(result);
    if (kind === "toast") toast.show({ text: labels.results[result.code] });
    setBanner(kind === "banner" ? labels.results[result.code] : "");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    // 경고 패널의 "그대로 저장하기"로 보낸 제출에만 확인 키를 붙인다. 일반 저장은 언제나 다시 대조된다.
    if (isCopyAckSubmitter((event.nativeEvent as SubmitEvent).submitter)) {
      for (const key of ack) formData.append(COPY_ACK_FIELD, key);
    }
    setBanner("");
    setInvalid({});
    startTransition(async () => {
      const result = mode === "create" ? await createPopup(formData) : await updatePopup(formData);
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
      if (mode === "create") formRef.current?.reset();
      router.refresh();
    });
  };

  const onDelete = () => {
    if (id === undefined || !armed) return;
    if (!window.confirm(labels.deleteConfirm)) return;
    setBanner("");
    startTransition(async () => {
      const result = await deletePopup(id);
      report(result);
      if (result.changed) router.push(listHref);
    });
  };

  return (
    <form ref={formRef} className={s.popupForm} onSubmit={onSubmit} data-testid="admin-popup-form">
      {mode === "edit" && id !== undefined ? <input type="hidden" name={POPUP_FIELDS.id} value={id} readOnly /> : null}

      <div className={s.field}>
        <label className={s.label} htmlFor="popup-title">
          {labels.field.title}
        </label>
        <p className={s.hint} id="popup-title-hint">
          {labels.hint.title}
        </p>
        <input
          id="popup-title"
          className={s.input}
          name={POPUP_FIELDS.title}
          type="text"
          defaultValue={initial.title}
          maxLength={POPUP_TITLE_MAX}
          required
          disabled={pending}
          aria-describedby="popup-title-hint"
          aria-invalid={mark("title")}
        />
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="popup-body">
          {labels.field.body}
        </label>
        <p className={s.hint} id="popup-body-hint">
          {labels.hint.body}
        </p>
        <textarea
          id="popup-body"
          className={s.textarea}
          name={POPUP_FIELDS.body}
          rows={5}
          defaultValue={initial.body}
          maxLength={POPUP_BODY_MAX}
          required
          disabled={pending}
          aria-describedby="popup-body-hint"
          aria-invalid={mark("body")}
        />
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="popup-image">
          {labels.field.imagePath}
        </label>
        <p className={s.hint} id="popup-image-hint">
          {labels.hint.imagePath}
        </p>
        <input
          id="popup-image"
          className={s.input}
          name={POPUP_FIELDS.imagePath}
          type="text"
          defaultValue={initial.imagePath}
          disabled={pending}
          aria-describedby="popup-image-hint"
          aria-invalid={mark("imagePath")}
        />
      </div>

      {/* 노출 기간 — 다른 칸과 같은 순서(이름 → 안내 → 입력칸 · P5-23 라운드 2 B-9). 두 날짜 칸을 한 묶음으로 읽게 group 으로 이름을 단다. */}
      <div className={s.field} role="group" aria-labelledby="popup-period-label">
        <span className={s.label} id="popup-period-label">
          {labels.field.period}
        </span>
        <p className={s.hint} id="popup-period-hint">
          {labels.hint.period}
        </p>
        <div className={s.dateRow}>
          <div className={s.dateCol}>
            <label className={s.label} htmlFor="popup-starts">
              {labels.field.startsAt}
            </label>
            <input
              id="popup-starts"
              className={s.input}
              name={POPUP_FIELDS.startsAt}
              type="date"
              defaultValue={initial.startsAt}
              required
              disabled={pending}
              aria-describedby="popup-period-hint"
              aria-invalid={mark("startsAt")}
            />
          </div>
          <div className={s.dateCol}>
            <label className={s.label} htmlFor="popup-ends">
              {labels.field.endsAt}
            </label>
            <input
              id="popup-ends"
              className={s.input}
              name={POPUP_FIELDS.endsAt}
              type="date"
              defaultValue={initial.endsAt}
              required
              disabled={pending}
              aria-describedby="popup-period-hint"
              aria-invalid={mark("endsAt")}
            />
          </div>
        </div>
      </div>

      <div className={s.field}>
        <div className={s.checkRow}>
          <input
            id="popup-active"
            name={POPUP_FIELDS.active}
            type="checkbox"
            defaultChecked={initial.active}
            disabled={pending}
            aria-describedby="popup-active-hint"
          />
          <label className={s.label} htmlFor="popup-active">
            {labels.field.active}
          </label>
        </div>
        <p className={s.hint} id="popup-active-hint">
          {labels.hint.active}
        </p>
      </div>

      <p className={s.hint}>{labels.notice}</p>

      <div className={s.formActions}>
        <button type="submit" className={s.btnPrimary} disabled={pending} data-testid="admin-popup-submit">
          {pending ? labels.processing : labels.submit}
        </button>
      </div>

      <AdminBanner text={banner} testId="admin-popup-banner" />

      <CopyWarningPanel warnings={warnings} labels={labels.copyWarning} pending={pending} idPrefix="popup" attempt={warningRound} />

      {mode === "edit" && id !== undefined ? (
        <div className={s.dangerZone} data-testid="admin-popup-danger">
          <div className={s.checkRow}>
            <input
              id="popup-delete-arm"
              type="checkbox"
              checked={armed}
              disabled={pending}
              onChange={(e) => setArmed(e.currentTarget.checked)}
            />
            <label className={s.label} htmlFor="popup-delete-arm">
              {labels.deleteArm}
            </label>
          </div>
          <button
            type="button"
            className={s.btnSecondary}
            disabled={pending || !armed}
            onClick={onDelete}
            data-testid="admin-popup-delete"
          >
            {labels.delete}
          </button>
        </div>
      ) : null}
    </form>
  );
}

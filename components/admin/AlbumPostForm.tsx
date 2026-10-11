"use client";
/**
 * 갤러리 글(앨범) 쓰기·고치기 폼 (OWNER-FEEDBACK T4-2 · 결정 8-② · 마이그레이션 0025).
 *
 *   - 칸: 제목 · 날짜(KST, 처음에는 오늘) · 본문(공지와 같은 제한 서식 편집기 — HTML 을 저장하지 않는다) · 바로 보이기(새 글만).
 *   - **주소(slug) 입력란이 없다.** 새 글은 DB 가 짓고, 고치기는 slug 를 보내지 않아 공개 주소 `/gallery/<slug>` 가 바뀌지 않는다.
 *   - 저장 전 확인(경고 후 저장 — 공지와 같다): 제목·본문이 카피 목록에 걸리면 CopyWarningPanel 이 묻는다.
 *   - 삭제는 두 단계(무장 체크 → 확인 창). 지워도 사진은 미분류 · 비공개로 남는다는 것을 버튼 옆에 미리 적는다.
 * 문구는 전부 props(messages/ko.json `admin.gallery.*`).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { createGalleryAlbum, deleteGalleryAlbum, updateGalleryAlbum } from "@/actions/admin/gallery";
import { COPY_ACK_FIELD, type CopyWarning } from "@/lib/admin/copyWarning";
import { ALBUM_BODY_MAX, ALBUM_TITLE_MAX, type GalleryActionCode, type GalleryActionResult } from "@/lib/admin/galleryInput";

import s from "./admin.module.css";
import { AdminBanner } from "./AdminBanner";
import { useAdminToast } from "./AdminToast";
import { CopyWarningPanel, isCopyAckSubmitter, mergeAck, type CopyWarningLabels } from "./CopyWarningPanel";
import { feedbackKind } from "./feedback";
import { RichTextEditor, type RichTextEditorLabels } from "./RichTextEditor";

export interface AlbumPostFormLabels {
  title: string;
  titleHint: string;
  date: string;
  dateHint: string;
  body: string;
  bodyHint: string;
  active: string;
  activeHint: string;
  submit: string;
  processing: string;
  delete: string;
  deleteArm: string;
  deleteNote: string;
  deleteConfirm: string;
  results: Record<GalleryActionCode, string>;
  copyWarning: CopyWarningLabels;
  editor: RichTextEditorLabels;
}

export interface AlbumPostValues {
  title: string;
  body: string;
  publishedAt: string;
  active: boolean;
}

export function AlbumPostForm({
  mode,
  id,
  initial,
  labels,
  listHref,
}: {
  mode: "create" | "edit";
  id?: number;
  initial: AlbumPostValues;
  labels: AlbumPostFormLabels;
  listHref: string;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState("");
  const [armed, setArmed] = useState(false);
  const [warnings, setWarnings] = useState<CopyWarning[]>([]);
  const [warningRound, setWarningRound] = useState(0);
  const [ack, setAck] = useState<string[]>([]);

  const report = (result: GalleryActionResult) => {
    const kind = feedbackKind(result);
    if (kind === "toast") toast.show({ text: labels.results[result.code] });
    setBanner(kind === "banner" ? labels.results[result.code] : "");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const confirmed = isCopyAckSubmitter((event.nativeEvent as SubmitEvent).submitter);
    const values = {
      title: String(fd.get("title") ?? "").trim(),
      body: String(fd.get("body") ?? ""),
      publishedAt: String(fd.get("publishedAt") ?? "").trim(),
      active: mode === "create" ? fd.get("active") === "on" : initial.active,
      ...(confirmed ? { [COPY_ACK_FIELD]: ack } : {}),
    };
    setBanner("");
    startTransition(async () => {
      const result = mode === "create" ? await createGalleryAlbum(values) : await updateGalleryAlbum({ id, ...values });
      report(result);
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
      router.refresh();
    });
  };

  const onDelete = () => {
    if (id === undefined || !armed) return;
    if (!window.confirm(labels.deleteConfirm)) return;
    setBanner("");
    startTransition(async () => {
      const result = await deleteGalleryAlbum({ id });
      report(result);
      if (result.changed) router.push(listHref);
    });
  };

  return (
    <form className={s.popupForm} onSubmit={onSubmit} data-testid="admin-album-form">
      <div className={s.field}>
        <label className={s.label} htmlFor="album-title">
          {labels.title}
        </label>
        <p className={s.hint} id="album-title-hint">
          {labels.titleHint}
        </p>
        <input
          id="album-title"
          className={s.input}
          name="title"
          type="text"
          defaultValue={initial.title}
          maxLength={ALBUM_TITLE_MAX}
          required
          disabled={pending}
          aria-describedby="album-title-hint"
        />
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="album-date">
          {labels.date}
        </label>
        <p className={s.hint} id="album-date-hint">
          {labels.dateHint}
        </p>
        <input
          id="album-date"
          className={s.input}
          name="publishedAt"
          type="date"
          defaultValue={initial.publishedAt}
          required
          disabled={pending}
          aria-describedby="album-date-hint"
        />
      </div>

      <div className={s.field}>
        <span className={s.label} id="album-body-label">
          {labels.body}
        </span>
        <p className={s.hint} id="album-body-hint">
          {labels.bodyHint}
        </p>
        <RichTextEditor
          id="album-body"
          name="body"
          initialValue={initial.body}
          maxPlain={ALBUM_BODY_MAX}
          disabled={pending}
          labelledBy="album-body-label"
          describedBy="album-body-hint"
          invalid={false}
          labels={labels.editor}
        />
      </div>

      {mode === "create" ? (
        <div className={s.field}>
          <div className={s.checkRow}>
            <input id="album-active" name="active" type="checkbox" defaultChecked={initial.active} disabled={pending} aria-describedby="album-active-hint" />
            <label className={s.label} htmlFor="album-active">
              {labels.active}
            </label>
          </div>
          <p className={s.hint} id="album-active-hint">
            {labels.activeHint}
          </p>
        </div>
      ) : null}

      <div className={s.formActions}>
        <button type="submit" className={s.btnPrimary} disabled={pending} data-testid="admin-album-submit">
          {pending ? labels.processing : labels.submit}
        </button>
      </div>

      <AdminBanner text={banner} testId="admin-album-banner" />

      <CopyWarningPanel warnings={warnings} labels={labels.copyWarning} pending={pending} idPrefix="album" attempt={warningRound} />

      {mode === "edit" && id !== undefined ? (
        <div className={s.dangerZone} data-testid="admin-album-danger">
          <p className={s.hint}>{labels.deleteNote}</p>
          <div className={s.checkRow}>
            <input id="album-delete-arm" type="checkbox" checked={armed} disabled={pending} onChange={(e) => setArmed(e.currentTarget.checked)} />
            <label className={s.label} htmlFor="album-delete-arm">
              {labels.deleteArm}
            </label>
          </div>
          <button type="button" className={s.btnSecondary} disabled={pending || !armed} onClick={onDelete} data-testid="admin-album-delete">
            {labels.delete}
          </button>
        </div>
      ) : null}
    </form>
  );
}

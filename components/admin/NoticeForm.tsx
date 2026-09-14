"use client";
/**
 * 공지 등록·수정 폼 (P5-5). 등록 화면과 수정 화면이 같은 컴포넌트를 쓴다 — 폼이 둘로 갈리면 검증도 둘로 갈린다.
 * 구조는 components/admin/PopupForm.tsx 와 같다(P5-4 가 세운 패턴).
 *
 * 클라이언트인 이유: 결과를 같은 자리에서 보여 주고(role="status"), 처리 중에 버튼을 잠그고, 저장 뒤 화면을 다시 읽기 위해서다.
 * props 에 개인정보가 없다(공지는 콘텐츠 표다). 필드 이름은 lib/admin/noticeInput.ts 의 단일 상수에서 온다.
 * 문구는 전부 props(messages/ko.json `admin.notices.*`)이고, 카테고리 라벨은 `home.notice.category` 카탈로그에서 내려온다 —
 * **저장되는 것은 언제나 코드**다(CLAUDE.md §3).
 *
 * 검증은 서버가 한다. 여기서 막지 않는 이유: 이 컴포넌트를 거치지 않고 액션을 직접 부를 수 있기 때문이다(ADR-3).
 *
 * **삭제는 비활성화 다음이다.** 공개 상세 URL(/notices/{id})이 문자로 나갔을 수 있다 —
 * 노출을 끄면 같은 id 로 언제든 되살릴 수 있지만(링크가 다시 살아난다), 삭제하면 serial id 가 재사용되지 않아 그 링크는 영구히 죽는다.
 * 그래서 삭제 버튼은 **무장 체크박스를 켠 뒤에야** 눌리고, 누르면 한 번 더 묻는다. 기본 도구는 노출 중지다.
 */
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { createNotice, deleteNotice, updateNotice } from "@/actions/admin/notice";
import { NOTICE_BODY_MAX, NOTICE_FIELDS, NOTICE_TITLE_MAX, type NoticeActionCode, type NoticeField } from "@/lib/admin/noticeInput";

import s from "./admin.module.css";

export interface NoticeFormValues {
  title: string;
  body: string;
  category: string;
  publishedAt: string;
  active: boolean;
}

export interface NoticeCategoryOption {
  code: string;
  label: string;
}

export interface NoticeFormLabels {
  field: Record<"title" | "body" | "category" | "publishedAt" | "active", string>;
  hint: Record<"title" | "body" | "category" | "publishedAt" | "active", string>;
  submit: string;
  processing: string;
  delete: string;
  deleteArm: string;
  deleteConfirm: string;
  results: Record<NoticeActionCode, string>;
}

export function NoticeForm({
  mode,
  id,
  initial,
  categories,
  labels,
  listHref,
}: {
  mode: "create" | "edit";
  id?: number;
  initial: NoticeFormValues;
  categories: readonly NoticeCategoryOption[];
  labels: NoticeFormLabels;
  listHref: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [invalid, setInvalid] = useState<Partial<Record<NoticeField, true>>>({});
  const [armed, setArmed] = useState(false);

  const mark = (field: NoticeField): "true" | undefined => (invalid[field] ? "true" : undefined);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setNotice("");
    setInvalid({});
    startTransition(async () => {
      const result = mode === "create" ? await createNotice(formData) : await updateNotice(formData);
      setNotice(labels.results[result.code]);
      setInvalid(result.fieldErrors ?? {});
      if (!result.changed) return;
      if (mode === "create") formRef.current?.reset();
      router.refresh();
    });
  };

  const onDelete = () => {
    if (id === undefined || !armed) return;
    if (!window.confirm(labels.deleteConfirm)) return;
    setNotice("");
    startTransition(async () => {
      const result = await deleteNotice(id);
      setNotice(labels.results[result.code]);
      if (result.changed) router.push(listHref);
    });
  };

  return (
    <form ref={formRef} className={s.popupForm} onSubmit={onSubmit} data-testid="admin-notice-form">
      {mode === "edit" && id !== undefined ? <input type="hidden" name={NOTICE_FIELDS.id} value={id} readOnly /> : null}

      <div className={s.field}>
        <label className={s.label} htmlFor="notice-title">
          {labels.field.title}
        </label>
        <p className={s.hint} id="notice-title-hint">
          {labels.hint.title}
        </p>
        <input
          id="notice-title"
          className={s.input}
          name={NOTICE_FIELDS.title}
          type="text"
          defaultValue={initial.title}
          maxLength={NOTICE_TITLE_MAX}
          required
          disabled={pending}
          aria-describedby="notice-title-hint"
          aria-invalid={mark("title")}
        />
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="notice-category">
          {labels.field.category}
        </label>
        <p className={s.hint} id="notice-category-hint">
          {labels.hint.category}
        </p>
        <select
          id="notice-category"
          className={s.input}
          name={NOTICE_FIELDS.category}
          defaultValue={initial.category}
          disabled={pending}
          aria-describedby="notice-category-hint"
          aria-invalid={mark("category")}
        >
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="notice-published">
          {labels.field.publishedAt}
        </label>
        <p className={s.hint} id="notice-published-hint">
          {labels.hint.publishedAt}
        </p>
        <input
          id="notice-published"
          className={s.input}
          name={NOTICE_FIELDS.publishedAt}
          type="date"
          defaultValue={initial.publishedAt}
          required
          disabled={pending}
          aria-describedby="notice-published-hint"
          aria-invalid={mark("publishedAt")}
        />
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="notice-body">
          {labels.field.body}
        </label>
        <p className={s.hint} id="notice-body-hint">
          {labels.hint.body}
        </p>
        <textarea
          id="notice-body"
          className={s.textarea}
          name={NOTICE_FIELDS.body}
          rows={12}
          defaultValue={initial.body}
          maxLength={NOTICE_BODY_MAX}
          required
          disabled={pending}
          aria-describedby="notice-body-hint"
          aria-invalid={mark("body")}
        />
      </div>

      <div className={s.checkRow}>
        <input
          id="notice-active"
          name={NOTICE_FIELDS.active}
          type="checkbox"
          defaultChecked={initial.active}
          disabled={pending}
          aria-describedby="notice-active-hint"
        />
        <label className={s.label} htmlFor="notice-active">
          {labels.field.active}
        </label>
      </div>
      <p className={s.hint} id="notice-active-hint">
        {labels.hint.active}
      </p>

      <div className={s.formActions}>
        <button type="submit" className={s.btnPrimary} disabled={pending} data-testid="admin-notice-submit">
          {pending ? labels.processing : labels.submit}
        </button>
      </div>

      {mode === "edit" && id !== undefined ? (
        <div className={s.dangerZone} data-testid="admin-notice-danger">
          <div className={s.checkRow}>
            <input
              id="notice-delete-arm"
              type="checkbox"
              checked={armed}
              disabled={pending}
              onChange={(e) => setArmed(e.currentTarget.checked)}
            />
            <label className={s.label} htmlFor="notice-delete-arm">
              {labels.deleteArm}
            </label>
          </div>
          <button
            type="button"
            className={s.btnSecondary}
            disabled={pending || !armed}
            onClick={onDelete}
            data-testid="admin-notice-delete"
          >
            {labels.delete}
          </button>
        </div>
      ) : null}

      <p className={s.notice} role="status" data-testid="admin-notice-notice">
        {notice}
      </p>
    </form>
  );
}

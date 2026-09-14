"use client";
/**
 * 예약 상세의 처리 영역 — 확정 · 취소 · 완료 · 메모 (P5-3).
 *
 * 버튼은 **존재하는 전이만** 그린다: 확정은 `status === "new"` 일 때, 취소는 new·confirmed 일 때,
 * 완료는 `confirmed` 일 때만. 0010 에 없는 역방향 전이(done → new 등)는 화면에도 없다 —
 * 있으면 사장님이 누르고, 눌리면 아무 일도 안 일어나 혼란만 남는다.
 * 그래도 마지막 판정은 언제나 DB 다: 다른 탭에서 이미 확정했다면 이 화면의 버튼은 최신이 아니고, 그때 액션은
 * `alreadyHandled`(noop)를 돌려준다 — 빨간 오류가 아니라 안내로 보여 주고 화면을 새로 불러온다.
 *
 * 처리 중에는 모든 버튼이 disabled 다(두 번 클릭 방지의 **첫 번째** 층 — 진짜 방어선은 0010 의 `and status = 'new'` 다).
 * 결과는 `role="status"` 로 알린다(스크린리더가 포커스를 뺏기지 않고 듣는다).
 *
 * props 에 고객 개인정보를 싣지 않는다(P3-5 리뷰 N-2 — dev 는 서버 컴포넌트 props 를 HTML 에 직렬화한다):
 * 여기 오는 것은 uuid·상태·라벨과 사장님이 쓴 메모뿐이고, 메모는 어차피 이 화면의 textarea 값이다.
 *
 * 개발용 우회 분기는 없다(P5-3 독립 리뷰). 이 컴포넌트가 화면에 있다는 것은 서버가 이미 관리자 세션을 확인했다는 뜻이고,
 * 버튼은 언제나 진짜 서버액션을 부른다 — 그 액션도 자기 자리에서 requireAdmin() 을 다시 통과해야 한다.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  cancelReservation,
  completeReservation,
  confirmReservation,
  saveReservationMemo,
} from "@/actions/admin/reservation";
import type { AdminActionCode } from "@/lib/admin/result";
import type { ReservationStatus } from "@/lib/admin/reservations";

import s from "./admin.module.css";

export interface ReservationActionLabels {
  confirm: string;
  cancel: string;
  complete: string;
  confirmHint: string;
  memoLabel: string;
  memoHint: string;
  memoSave: string;
  processing: string;
  results: Record<AdminActionCode, string>;
}

export function ReservationActions({
  id,
  status,
  initialMemo,
  labels,
}: {
  id: string;
  status: ReservationStatus;
  initialMemo: string;
  labels: ReservationActionLabels;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [memo, setMemo] = useState(initialMemo);

  const run = (call: () => Promise<{ code: AdminActionCode; changed: boolean }>) => {
    setNotice("");
    startTransition(async () => {
      const result = await call();
      setNotice(labels.results[result.code]);
      // noop 도 화면이 낡았다는 뜻이다 — 다시 읽어 온다.
      if (result.changed || result.code === "alreadyHandled") router.refresh();
    });
  };

  const canConfirm = status === "new";
  const canCancel = status === "new" || status === "confirmed";
  const canComplete = status === "confirmed";

  return (
    <div className={s.actions} data-testid="admin-reservation-actions">
      <div className={s.actionRow}>
        {canConfirm ? (
          <button
            type="button"
            className={s.btnPrimary}
            disabled={pending}
            onClick={() => run(() => confirmReservation(id))}
            data-testid="admin-confirm"
          >
            {pending ? labels.processing : labels.confirm}
          </button>
        ) : null}
        {canComplete ? (
          <button
            type="button"
            className={s.btnPrimary}
            disabled={pending}
            onClick={() => run(() => completeReservation(id))}
            data-testid="admin-complete"
          >
            {pending ? labels.processing : labels.complete}
          </button>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            className={s.btnSecondary}
            disabled={pending}
            onClick={() => run(() => cancelReservation(id))}
            data-testid="admin-cancel"
          >
            {labels.cancel}
          </button>
        ) : null}
      </div>
      {canConfirm ? <p className={s.hint}>{labels.confirmHint}</p> : null}

      <div className={s.memoField}>
        <label className={s.label} htmlFor="admin-memo">
          {labels.memoLabel}
        </label>
        <p className={s.hint} id="admin-memo-hint">
          {labels.memoHint}
        </p>
        <textarea
          id="admin-memo"
          className={s.textarea}
          aria-describedby="admin-memo-hint"
          rows={3}
          value={memo}
          disabled={pending}
          onChange={(e) => setMemo(e.target.value)}
        />
        <button
          type="button"
          className={s.btnSecondary}
          disabled={pending}
          onClick={() => run(() => saveReservationMemo(id, memo))}
          data-testid="admin-memo-save"
        >
          {labels.memoSave}
        </button>
      </div>

      <p className={s.notice} role="status" data-testid="admin-action-notice">
        {notice}
      </p>
    </div>
  );
}

"use client";
/**
 * 예약 상세의 처리 영역 — 확정 · 운행 완료 · 메모 · 취소 (P5-3 → P5-19 확인 시트).
 *
 * 버튼은 **존재하는 전이만** 그린다: 확정은 `status === "new"` 일 때, 취소는 new·confirmed 일 때,
 * 완료는 `status === "confirmed"` 일 때만. 0010 에 없는 역방향 전이(done → new 등)는 화면에도 없다.
 * 그래도 마지막 판정은 언제나 DB 다: 다른 탭에서 이미 확정했다면 이 화면의 버튼은 최신이 아니고, 그때 액션은
 * `alreadyHandled`(noop)를 돌려준다 — 빨간 오류가 아니라 안내로 보여 주고 화면을 새로 불러온다.
 *
 * P5-19 — 되돌릴 수 없는 전이는 **확인 시트를 거친다**(components/admin/AdminSheet.tsx):
 *   - 확정·완료·취소 버튼은 시트를 **열기만** 한다(openSheet). 서버액션을 부르는 길은 시트의 실행 버튼 하나다
 *     (reservation-sheet.ts panelController.commit — 시트가 열려 있지 않으면 아무것도 하지 않는다).
 *   - 확정·완료·취소는 **고친 메모를 함께 넘긴다**(예전에는 넘기지 않아 확정 전에 쓴 메모가 사라졌다). 고치지 않았으면 넘기지 않는다 —
 *     다른 화면이 그 사이 저장한 메모를 덮지 않게(리뷰 P2-3). 취소는 고른 사유를 한 줄 덧붙인다.
 *   - "이미 처리된 접수" 를 받은 시트는 잠긴다 — 사유 칩까지 막고 다시 보내지 않는다(리뷰 P1-1). 응답이 SHEET_STUCK_MS 동안 오지 않으면
 *     [닫기]가 되살아난다(리뷰 P2-1).
 *   - 취소 진입은 확정 버튼 옆의 같은 크기 버튼이 아니다 — 메모와 구분선 아래의 **글자 버튼**이고, 취소해도 고객에게 문자가 가지 않는다는
 *     안내가 늘 붙어 있다(시안 #detail 처리 카드).
 *   - 성공은 토스트(role=status · 3초 · 링크가 있으면 5초), 실패는 시트를 닫지 않고 시트 안 배너(role=alert).
 *
 * 처리 중에는 모든 버튼이 disabled 다(두 번 클릭 방지의 **첫 번째** 층 — 진짜 방어선은 0010 의 `and status = 'new'` 다).
 *
 * props 에 고객 개인정보를 싣지 않는다(P3-5 리뷰 N-2 — dev 는 서버 컴포넌트 props 를 HTML 에 직렬화한다):
 * 여기 오는 것은 uuid·상태·라벨·사장님이 쓴 메모·운행 요약(구간·날짜·인원 — 식별 정보가 아니다)뿐이다.
 * 시트 제목의 **고객 이름**은 서버가 이미 화면에 그린 이름 칸(CUSTOMER_NAME_ELEMENT_ID)에서 시트를 열 때 읽는다 —
 * props 로 새 길을 내지 않는다. 읽지 못하면 이름 없는 제목으로 떨어진다.
 *
 * 개발용 우회 분기는 없다(P5-3 독립 리뷰). 이 컴포넌트가 화면에 있다는 것은 서버가 이미 관리자 세션을 확인했다는 뜻이고,
 * 버튼은 언제나 진짜 서버액션을 부른다 — 그 액션도 자기 자리에서 requireAdmin() 을 다시 통과해야 한다.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useReducer, useRef, useState, useTransition } from "react";

import {
  cancelReservation,
  completeReservation,
  confirmReservation,
  saveReservationMemo,
} from "@/actions/admin/reservation";
import { ADMIN_MEMO_MAX_CHARS } from "@/lib/admin/memo";
import type { ReservationStatus } from "@/lib/admin/reservations";

import { AdminSheet } from "./AdminSheet";
import {
  CUSTOMER_NAME_ELEMENT_ID,
  SHEET_STUCK_MS,
  bannerMessage,
  cleanCustomerName,
  focusReturn,
  initialPanelState,
  panelController,
  panelReducer,
  sheetTitle,
  toastDurationMs,
  toastHasLink,
  type CancelReason,
  type PanelActions,
  type PanelState,
  type ReservationActionLabels,
  type ReservationSummary,
  type SheetKind,
} from "./reservation-sheet";

import s from "./admin.module.css";

export type { ReservationActionLabels, ReservationSummary } from "./reservation-sheet";

/** 서버액션 표 — 컨트롤러만 부른다(시트의 실행 버튼 · 메모 저장). 이 파일은 네 함수를 직접 부르지 않는다. */
const ACTIONS: PanelActions = {
  confirm: confirmReservation,
  cancel: cancelReservation,
  complete: completeReservation,
  memo: saveReservationMemo,
};

/** 서버가 그린 고객 이름 칸의 글자(시트 제목용). 없으면 "" — 이름 없는 제목으로 떨어진다. */
function readCustomerName(): string {
  return cleanCustomerName(document.getElementById(CUSTOMER_NAME_ELEMENT_ID)?.textContent);
}

export interface ReservationActionsProps {
  id: string;
  status: ReservationStatus;
  initialMemo: string;
  summary: ReservationSummary;
  labels: ReservationActionLabels;
}

export function ReservationActions({ id, status, initialMemo, summary, labels }: ReservationActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, dispatch] = useReducer(panelReducer, initialMemo, initialPanelState);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const memoHintId = useId();
  /** 처리 중 SHEET_STUCK_MS 가 지났다(응답이 오지 않는다) — 시트의 [닫기]·ESC·바깥 누르기를 되살린다(리뷰 P2-1). */
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), SHEET_STUCK_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  // 새로고침이 새 메모를 내려 주면 — 사장님이 고치는 중이 아니면 그 값을 따른다(다른 탭의 저장을 덮어쓰지 않게).
  if (initialMemo !== state.propMemo) dispatch({ type: "propMemo", memo: initialMemo });

  const controller = panelController({
    id,
    actions: ACTIONS,
    dispatch,
    refresh: () => router.refresh(),
    readCustomerName,
    reasonLine: (reason: CancelReason) => labels.sheet.cancel.reasons.find((r) => r.key === reason)?.line ?? "",
  });

  const openSheet = (sheet: SheetKind, opener: HTMLElement) => {
    openerRef.current = opener;
    controller.open(sheet);
  };
  const submit = () => startTransition(() => controller.commit(state));
  const saveMemo = () => startTransition(() => controller.saveMemo(state));
  const onToastDone = useCallback((toastId: number) => dispatch({ type: "toastDone", id: toastId }), []);

  // 시트가 닫히면 포커스를 돌려놓는다 — 그냥 닫혔으면 연 버튼, 바뀌었으면 처리 영역(연 버튼은 새로고침에서 사라진다).
  useEffect(() => {
    if (state.sheet !== null) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const opener = openerRef.current;
    openerRef.current = null;
    // 연 버튼이 사라졌거나(새로고침) 처리 중이라 비활성이면(늦어서 닫았을 때) 처리 영역으로 — 비활성 버튼에는 포커스가 가지 않는다.
    if (focusReturn(state.lastClose, opener !== null && opener.isConnected && !opener.matches(":disabled")) === "opener" && opener !== null) opener.focus();
    else panelRef.current?.focus();
  }, [state.sheet, state.lastClose]);

  const canConfirm = status === "new";
  const canCancel = status === "new" || status === "confirmed";
  const canComplete = status === "confirmed";

  return (
    <div ref={panelRef} className={s.actions} role="group" aria-label={labels.panel} tabIndex={-1} data-testid="admin-reservation-actions">
      {canConfirm || canComplete ? (
        <div className={s.actionPrimary} data-zone="primary">
          {canConfirm ? (
            <button
              type="button"
              className={s.btnPrimary}
              data-variant="primary"
              disabled={pending}
              onClick={(e) => openSheet("confirm", e.currentTarget)}
              data-testid="admin-confirm"
            >
              {labels.confirm}
            </button>
          ) : null}
          {canComplete ? (
            <button
              type="button"
              className={s.btnPrimary}
              data-variant="primary"
              disabled={pending}
              onClick={(e) => openSheet("complete", e.currentTarget)}
              data-testid="admin-complete"
            >
              {labels.complete}
            </button>
          ) : null}
          <p className={s.hint}>{canConfirm ? labels.confirmHint : labels.completeHint}</p>
        </div>
      ) : null}

      <div className={s.memoField} data-zone="memo">
        <label className={s.label} htmlFor="admin-memo">
          {labels.memoLabel}
        </label>
        <p className={s.hint} id={memoHintId}>
          {labels.memoHint}
        </p>
        <textarea
          id="admin-memo"
          className={s.textarea}
          aria-describedby={memoHintId}
          rows={3}
          maxLength={ADMIN_MEMO_MAX_CHARS}
          value={state.memoText}
          disabled={pending}
          onChange={(e) => controller.editMemo(e.target.value)}
          data-testid="admin-memo"
        />
        <button type="button" className={s.btnSecondary} disabled={pending} onClick={saveMemo} data-testid="admin-memo-save">
          {labels.memoSave}
        </button>
        {state.memoBanner === null ? null : (
          <p className={s.banner} role="alert" data-testid="admin-memo-banner">
            {bannerMessage(state.memoBanner, labels)}
          </p>
        )}
      </div>

      {canCancel ? (
        <>
          <hr className={s.divider} />
          <div className={s.cancelZone} data-zone="cancel">
            <button
              type="button"
              className={s.btnText}
              data-variant="text"
              disabled={pending}
              onClick={(e) => openSheet("cancel", e.currentTarget)}
              data-testid="admin-cancel"
            >
              <svg className={s.btnTextIcon} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
              {labels.cancel}
            </button>
            <p className={s.hint}>{labels.cancelHint}</p>
          </div>
        </>
      ) : null}

      {state.sheet === null ? null : (
        <ReservationSheet
          sheet={state.sheet}
          state={state}
          labels={labels}
          summary={summary}
          pending={pending}
          slow={slow}
          onClose={controller.close}
          onSubmit={submit}
          onPickReason={controller.pickReason}
        />
      )}

      <ActionToast toast={state.toast} labels={labels} onDone={onToastDone} />
    </div>
  );
}

/**
 * 시트 하나 — 종류별 문구·요약·사유를 AdminSheet 에 채운다. 상태는 부르는 쪽(ReservationActions)이 든다.
 * 잠긴 시트(이미 처리됨 — `state.sheetLocked`)는 실행 버튼과 사유 라디오를 막는다(리뷰 P1-1). 판정은 배너 모양이 아니라 잠금이다.
 */
export function ReservationSheet({
  sheet,
  state,
  labels,
  summary,
  pending,
  slow,
  onClose,
  onSubmit,
  onPickReason,
}: {
  sheet: SheetKind;
  state: PanelState;
  labels: ReservationActionLabels;
  summary: ReservationSummary;
  pending: boolean;
  /** 처리 중 SHEET_STUCK_MS 가 지났다 — [닫기]를 되살리고 늦음 안내를 보인다. */
  slow: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onPickReason: (reason: CancelReason) => void;
}) {
  const reasonIdPrefix = useId();
  const copy = labels.sheet[sheet];
  const title = sheetTitle(copy.title, copy.titleNoName, state.customerName);
  const banner = state.sheetBanner === null ? null : bannerMessage(state.sheetBanner, labels);

  const before =
    sheet === "cancel" ? null : (
      <p className={s.sheetSummary} data-testid="admin-sheet-summary">
        {summary.parts.join(" · ")}
        {sheet === "confirm" && summary.quick ? <span className={s.sheetSummaryNote}>{labels.sheet.quickNote}</span> : null}
      </p>
    );

  const cancel = labels.sheet.cancel;
  const after =
    sheet === "cancel" ? (
      <fieldset className={s.reasonSet}>
        <legend className={s.reasonLegend}>{cancel.reasonLegend}</legend>
        <div className={s.reasons}>
          {cancel.reasons.map((reason) => (
            <span key={reason.key} className={s.reasonItem}>
              <input
                type="radio"
                id={`${reasonIdPrefix}-${reason.key}`}
                name="admin-cancel-reason"
                value={reason.key}
                className={s.reasonInput}
                checked={state.reason === reason.key}
                disabled={pending || state.sheetLocked}
                onChange={() => onPickReason(reason.key)}
                data-testid={`admin-cancel-reason-${reason.key}`}
              />
              <label htmlFor={`${reasonIdPrefix}-${reason.key}`} className={s.reasonChip}>
                {reason.label}
              </label>
            </span>
          ))}
        </div>
        <p className={s.hint}>{cancel.reasonHint}</p>
      </fieldset>
    ) : null;

  return (
    <AdminSheet
      name={sheet}
      title={title}
      before={before}
      description={copy.body}
      after={after}
      banner={banner}
      closeLabel={labels.sheet.close}
      submitLabel={copy.submit}
      processingLabel={labels.processing}
      submitVariant={sheet === "cancel" ? "destructive" : "primary"}
      pending={pending}
      slow={slow}
      slowNote={labels.sheet.slow}
      submitDisabled={state.sheetLocked}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

/**
 * 결과 토스트 — role=status 자리는 처음부터 있고(비어 있음), 문구는 **한 번 늦게** 넣는다.
 * 시트가 닫히는 순간에는 배경(이 자리 포함)이 아직 inert 다 — 같은 순간에 문구를 넣으면 스크린리더가 놓칠 수 있다.
 * 시트의 inert 해제(effect 정리)가 먼저 돌고 이 effect 가 뒤에 돌아, 문구는 읽히는 자리에 들어간다.
 * 마우스를 올리거나 포커스가 들어가 있는 동안은 사라지지 않는다(링크를 누르러 가는 사이 없어지지 않게).
 */
function ActionToast({ toast, labels, onDone }: { toast: PanelState["toast"]; labels: ReservationActionLabels; onDone: (id: number) => void }) {
  const [shown, setShown] = useState<PanelState["toast"]>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setShown(toast);
  }, [toast]);

  const link = shown !== null && toastHasLink(shown.code) ? labels.toastLink : null;
  const hasLink = link !== null;

  useEffect(() => {
    if (shown === null || paused) return;
    const timer = window.setTimeout(() => onDone(shown.id), toastDurationMs(hasLink));
    return () => window.clearTimeout(timer);
  }, [shown, paused, hasLink, onDone]);

  return (
    <div className={s.toastRegion} role="status" aria-live="polite" aria-atomic="true" data-testid="admin-toast-region">
      {shown === null ? null : (
        <div
          className={s.toast}
          data-testid="admin-toast"
          data-code={shown.code}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
          }}
        >
          <svg className={s.toastIcon} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <span className={s.toastText}>{labels.results[shown.code]}</span>
          {link === null ? null : (
            <Link className={s.toastLink} href={link.href}>
              {link.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

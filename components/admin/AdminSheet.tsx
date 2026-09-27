"use client";
/**
 * 관리자 확인 시트 — 되돌릴 수 없는 동작을 한 번 더 묻는다 (P5-19 · 시안 docs/handoff/2026-09-27-admin-ux #detail 확정·취소 시트).
 *
 * 모양: 휴대폰은 아래에서 올라오는 시트, 1024px 이상은 가운데 대화상자. 제목은 결과를 묻는 질문, 버튼은 왼쪽 [닫기](보조) ·
 * 오른쪽 결과 동사(주 버튼 또는 되돌릴 수 없는 동작의 짙은 면). 실패는 닫지 않고 시트 안 배너(role=alert)로 알린다.
 *
 * 접근성 — 홈 간편 견적 모달(components/quote/QuickQuoteModal.tsx, P3-8 리뷰 통과)과 같은 방식:
 *   - role="alertdialog"(확인 요청) · aria-modal · 제목(aria-labelledby) · 결과 문장(aria-describedby)
 *   - 열리면 포커스는 **[닫기]** — 실수로 Enter 를 눌러도 아무 일도 일어나지 않는 쪽이다(시안 ⑤-3).
 *   - 배경은 inert(간편 견적 모달과 **같은 함수** inertBackground) · 배경 스크롤 잠금
 *   - ESC · 바깥(딤) 누르기로 닫힘. Tab 은 시트 안에서만 돈다(라디오 묶음은 한 칸 — reservation-sheet.ts wrapFocus).
 *     키는 document 에서 받는다 — 바깥을 눌러 포커스가 body 로 빠져도 ESC·Tab 이 잡힌다.
 *   - 처리 중에는 닫지 않는다(ESC·바깥·[닫기] 모두) — 결과가 도착할 자리를 지킨다. 처리 중 비활성이 된 버튼에서 포커스가 빠지면
 *     끝난 뒤(실패로 시트가 남으면) [닫기]로 돌려놓는다.
 *   - 단 처리 중 SHEET_STUCK_MS(15초)가 지나도록 응답이 없으면(`slow`) 셋 다 되살리고 "닫아도 괜찮아요" 안내를 보인다(리뷰 P2-1) —
 *     응답이 영영 오지 않을 때(연결이 죽음) 배경이 inert 인 채로 갇히지 않게. 실행 버튼은 처리 중인 동안 계속 막는다.
 *     안내 자리(role=status)는 늘 있고 비어 있다가 그때 채워진다(스크린리더가 읽는다).
 *   - 닫힌 뒤 포커스 복귀는 부르는 쪽(ReservationActions)이 정한다 — 성공하면 연 버튼이 사라지기 때문이다.
 *
 * 바깥 누르기는 **눌림과 떼기가 둘 다 딤 위**일 때만 닫는다(시트 안에서 글자를 끌어 선택하다 딤에서 놓아도 닫히지 않게).
 * 누르는 순간(mousedown) 닫으면 떼는 순간의 click 이 시트 뒤 버튼에 떨어진다 — 그래서 click 에서 닫는다.
 */
import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";

import { inertBackground } from "@/components/quote/quick-quote";

import { sheetClosable, wrapFocus } from "./reservation-sheet";

import s from "./admin.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface AdminSheetProps {
  /** data-testid 접미사(admin-sheet-<name>). */
  name: string;
  title: string;
  /** 설명 앞(요약 상자 등). */
  before?: ReactNode;
  /** 결과 문장 — aria-describedby 가 가리킨다. */
  description: ReactNode;
  /** 설명 뒤(사유 고르기 등). */
  after?: ReactNode;
  /** 시트 안 배너(role=alert). null 이면 없다. */
  banner: string | null;
  closeLabel: string;
  submitLabel: string;
  processingLabel: string;
  submitVariant: "primary" | "destructive";
  pending: boolean;
  /** 처리 중 SHEET_STUCK_MS 가 지났다 — 닫기를 되살리고 slowNote 를 보인다. 처리 중이 아니면 무시된다. */
  slow: boolean;
  slowNote: string;
  submitDisabled: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

export function AdminSheet({
  name,
  title,
  before,
  description,
  after,
  banner,
  closeLabel,
  submitLabel,
  processingLabel,
  submitVariant,
  pending,
  slow,
  slowNote,
  submitDisabled,
  onClose,
  onSubmit,
}: AdminSheetProps) {
  const closable = sheetClosable(pending, slow);
  const titleId = useId();
  const descId = useId();
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const downOnBackdrop = useRef(false);

  // 열릴 때 — 배경 inert · 스크롤 잠금 · 포커스는 [닫기]. 닫힐 때 되돌린다.
  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    const restoreInert = inertBackground(backdrop, document.body);
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      restoreInert();
      body.style.overflow = prevOverflow;
    };
  }, []);

  // 처리 중 비활성이 된 버튼에서 포커스가 빠졌으면, 닫을 수 있게 되는 순간(실패로 시트가 남음 · 응답이 늦어 닫기가 되살아남) [닫기]로 돌려놓는다.
  useEffect(() => {
    if (!closable) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) closeRef.current?.focus();
  }, [closable]);

  // ESC 닫기 · Tab 가둠.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (closable) onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = wrapFocus(items, active, e.shiftKey, {
        container: dialog,
        radioGroup: (el) => (el instanceof HTMLInputElement && el.type === "radio" ? el.name : null),
        isChecked: (el) => el instanceof HTMLInputElement && el.checked,
      });
      if (target) {
        e.preventDefault();
        target.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closable, onClose]);

  const onBackdropMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    downOnBackdrop.current = e.target === e.currentTarget;
  };
  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    const fromBackdrop = downOnBackdrop.current && e.target === e.currentTarget;
    downOnBackdrop.current = false;
    if (fromBackdrop && closable) onClose();
  };

  return (
    <div ref={backdropRef} className={s.sheetBackdrop} onMouseDown={onBackdropMouseDown} onClick={onBackdropClick} data-testid="admin-sheet-backdrop">
      <div
        ref={dialogRef}
        className={s.sheet}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        data-testid={`admin-sheet-${name}`}
      >
        <h2 id={titleId} className={s.sheetTitle}>
          {title}
        </h2>
        {before}
        <p id={descId} className={s.sheetBody}>
          {description}
        </p>
        {after}
        {banner === null ? null : (
          <p className={s.banner} role="alert" data-testid="admin-sheet-banner">
            {banner}
          </p>
        )}
        <p className={s.sheetSlow} role="status" data-testid="admin-sheet-slow">
          {pending && slow ? slowNote : null}
        </p>
        <div className={s.sheetActions}>
          <button ref={closeRef} type="button" className={s.btnSecondary} disabled={!closable} onClick={onClose} data-testid="admin-sheet-close">
            {closeLabel}
          </button>
          <button
            type="button"
            className={submitVariant === "destructive" ? s.btnDestructive : s.btnPrimary}
            data-variant={submitVariant}
            disabled={pending || submitDisabled}
            onClick={onSubmit}
            data-testid="admin-sheet-submit"
          >
            {pending ? processingLabel : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

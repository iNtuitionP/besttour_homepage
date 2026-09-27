"use client";
/**
 * 관리자 결과 토스트 — 자리 하나를 관리자 전체가 쓴다 (P5-20 · P5-19 예약 처리 토스트를 넓혔다 · 제안서 ④ 원칙 4).
 *
 * 성공은 토스트, 실패는 그 자리 배너(components/admin/feedback.ts). 토스트는
 *   - **3초**, 동작 링크가 붙으면 **5초** 뒤 저절로 사라진다(시간은 P5-19 와 같은 상수 — reservation-sheet.ts TOAST_MS).
 *   - 마우스를 올리거나 포커스가 들어가 있는 동안은 사라지지 않는다(링크를 누르러 가는 사이 없어지지 않게).
 *   - 자리(role=status · aria-live=polite)는 **처음부터 비어 있는 채로** 있고, 문구는 한 번 늦게(effect) 넣는다 — 같은 순간에 자리와 문구가
 *     함께 생기면 스크린리더가 놓칠 수 있고, 확인 시트가 닫히는 순간에는 배경이 아직 inert 다(P5-19 ActionToast 의 근거 그대로).
 *   - 시간은 토스트 **번호**로 잰다 — 같은 토스트가 새로고침으로 다시 그려져도 시계가 처음부터 다시 돌지 않는다.
 *
 * AdminToastProvider — (protected) 레이아웃이 본문을 감싼다. 공지·팝업·갤러리·노선의 폼·버튼은 useAdminToast().show 로 알린다.
 * 레이아웃은 탭 이동에도 남으므로, 삭제 뒤 목록으로 옮겨 가도 "삭제했어요" 가 사라지지 않는다(예전 한 줄 알림은 폼과 함께 없어졌다).
 * 공급자 밖(테스트·단독 렌더)에서는 알림이 아무 일도 하지 않는다 — 화면이 죽지 않는다.
 *
 * 문구는 props 로만 받는다(한글 리터럴 0) — 관리자 영역은 로케일 밖이라 서버가 카탈로그에서 풀어 내린다.
 */
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { toastDurationMs } from "./reservation-sheet";

import s from "./admin.module.css";

export interface AdminToastMessage {
  text: string;
  /** 토스트 안의 동작 링크(있으면 5초). */
  link?: { label: string; href: string } | null;
}

export interface ShownToast extends AdminToastMessage {
  /** 토스트마다 새 번호 — 시간은 번호로 잰다. */
  id: number;
  /** 결과 코드(예약 처리 토스트가 싣는다 — 실측·테스트용 표시). */
  code?: string;
}

export interface AdminToastApi {
  show(message: AdminToastMessage): void;
}

const NOOP: AdminToastApi = { show: () => {} };
const ToastContext = createContext<AdminToastApi>(NOOP);

/** 결과 알림 — 공급자 안이면 레이아웃의 자리에, 밖이면 아무 일도 하지 않는다. */
export function useAdminToast(): AdminToastApi {
  return useContext(ToastContext);
}

export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ShownToast | null>(null);
  const seq = useRef(0);
  const show = useCallback((message: AdminToastMessage) => {
    seq.current += 1;
    setToast({ id: seq.current, text: message.text, link: message.link ?? null });
  }, []);
  const done = useCallback((id: number) => setToast((cur) => (cur !== null && cur.id === id ? null : cur)), []);
  const api = useMemo<AdminToastApi>(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <AdminToastRegion toast={toast} onDone={done} testId="admin-page-toast" />
    </ToastContext.Provider>
  );
}

/**
 * 토스트 자리 하나 — 예약 처리 영역(ReservationActions)과 공급자가 같은 부품을 쓴다.
 * testId 는 자리(`<testId>-region`)와 토스트(`<testId>`)의 data-testid 접두다.
 */
export function AdminToastRegion({
  toast,
  onDone,
  testId = "admin-toast",
}: {
  toast: ShownToast | null;
  onDone: (id: number) => void;
  testId?: string;
}) {
  const [shown, setShown] = useState<ShownToast | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setShown(toast);
  }, [toast]);

  const shownId = shown === null ? null : shown.id;
  const hasLink = shown !== null && Boolean(shown.link);

  useEffect(() => {
    if (shownId === null || paused) return;
    const timer = window.setTimeout(() => onDone(shownId), toastDurationMs(hasLink));
    return () => window.clearTimeout(timer);
  }, [shownId, paused, hasLink, onDone]);

  return (
    <div className={s.toastRegion} role="status" aria-live="polite" aria-atomic="true" data-testid={`${testId}-region`}>
      {shown === null ? null : (
        <div
          className={s.toast}
          data-testid={testId}
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
          <span className={s.toastText}>{shown.text}</span>
          {shown.link ? (
            <Link className={s.toastLink} href={shown.link.href}>
              {shown.link.label}
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

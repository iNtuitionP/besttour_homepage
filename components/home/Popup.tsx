"use client";

/**
 * 홈 팝업 — "오늘 하루 보지 않기" client island (P2-4 §팝업).
 *
 *   - 저장 키 = dismissKey(id, now) = popup-dismissed:<id>:<KST YYYY-MM-DD>. 날짜가 바뀌면 키가 달라져 다시 뜬다.
 *   - localStorage 읽기·쓰기는 try/catch — 사생활 모드·저장소 차단이면 throw 하는데, 그래도 팝업은 뜨고 닫힌다.
 *   - ESC · 배경 클릭 · 닫기 버튼(X, 텍스트) · Tab 포커스 트랩 · 열려 있는 동안 배경 스크롤 잠금 · 닫으면 포커스 복귀.
 *   - role="dialog" aria-modal aria-labelledby(제목). 목업처럼 진입 0.7초 뒤에 연다.
 * 이 파일에 한글 리터럴·원장 import 없음 — 문구·이미지 URL 은 서버 HomePopup 이 넣는다.
 */
import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react";

import { dismissKey } from "./popup-dismiss";
import s from "./Popup.module.css";

const OPEN_DELAY_MS = 700;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface PopupContent {
  id: number;
  title: string;
  body: string;
  imageSrc: string | null;
}
export interface PopupLabels {
  close: string;
  closeAria: string;
  hideToday: string;
}

function isDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function remember(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // 저장소를 못 쓰면 그냥 닫힌다 — 다음 방문에 다시 뜨는 것이 유일한 부작용
  }
}

export function Popup({ popup, labels }: { popup: PopupContent; labels: PopupLabels }) {
  const [open, setOpen] = useState(false);
  const [hideToday, setHideToday] = useState(false);
  const hideTodayRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (isDismissed(dismissKey(popup.id, new Date()))) return;
    const timer = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [popup.id]);

  const close = useCallback(() => {
    if (hideTodayRef.current) remember(dismissKey(popup.id, new Date()));
    setOpen(false);
  }, [popup.id]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (focusables()[0] ?? dialog)?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open, close]);

  if (!open) return null;

  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close();
  };

  return (
    <div className={s.overlay} onMouseDown={onBackdrop} data-testid="popup-overlay">
      <div ref={dialogRef} className={s.modal} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid="popup">
        <button type="button" className={s.x} aria-label={labels.closeAria} onClick={close} data-testid="popup-x">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>

        {popup.imageSrc ? (
          <div className={s.ph}>
            <Image className={s.phImg} src={popup.imageSrc} alt="" fill sizes="(min-width: 480px) 432px, 100vw" />
          </div>
        ) : null}

        <div className={s.bd}>
          <h2 id={titleId} className={s.title}>
            {popup.title}
          </h2>
          <p className={s.body}>{popup.body}</p>
        </div>

        <div className={s.ft}>
          <label className={s.chk}>
            <input
              type="checkbox"
              checked={hideToday}
              onChange={(event) => {
                hideTodayRef.current = event.target.checked;
                setHideToday(event.target.checked);
              }}
              data-testid="popup-hide-today"
            />
            {labels.hideToday}
          </label>
          <button type="button" className={s.txt} onClick={close} data-testid="popup-close">
            {labels.close}
          </button>
        </div>
      </div>
    </div>
  );
}

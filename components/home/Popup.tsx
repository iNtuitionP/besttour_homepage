"use client";

/**
 * 홈 팝업 — 여러 창 + "오늘 하루 보지 않기" client island (P2-4 §팝업 · OF3-R2 사진만·여러 창).
 *
 *   - 창이 여러 개면 **왼쪽 위부터 가로로 나란히**(넘치면 다음 줄 · 휴대폰 폭은 세로로 쌓기), 뒤 화면을 어둡게 하는 막은 하나다.
 *   - 저장 키 = dismissKey(id, now) = popup-dismissed:<id>:<KST YYYY-MM-DD>. 창마다 따로. 날짜가 바뀌면 키가 달라져 다시 뜬다.
 *     오늘 하루 숨긴 창은 처음부터 그리지 않고, 남은 것이 0개면 막도 없다(popup-dismiss.ts undismissedIds).
 *   - 닫기 버튼(X · 텍스트)은 **그 창만** 닫는다. 막 클릭 · Esc 는 **열린 창 전부**를 닫는다. 어느 쪽이든 창의 "오늘 하루 보지 않기" 체크를 따른다.
 *   - localStorage 읽기·쓰기는 try/catch — 사생활 모드·저장소 차단이면 throw 하는데, 그래도 팝업은 뜨고 닫힌다.
 *   - 모달 접근성: 창마다 role="dialog" aria-modal · Tab 포커스 가둠(막 안의 모든 창을 한 고리로 — Tab 으로 창 사이를 오간다) ·
 *     열려 있는 동안 배경 스크롤 잠금 · 창이 닫혀 포커스를 잃으면 남은 첫 창으로 · 전부 닫히면 열기 전 자리로 복귀. 목업처럼 진입 0.7초 뒤에 연다.
 *   - 사진만 팝업(imageOnly): 제목·본문 없이 사진을 원래 비율로(잘림 없이 · 화면 높이에 맞춰 축소). 제목은 사진 대체 글·창 이름으로만 쓴다.
 * 이 파일에 한글 리터럴·원장 import 없음 — 문구·이미지 URL 은 서버 HomePopup 이 넣는다.
 */
import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react";

import { RichText } from "@/components/content/RichText";
import { lockDocumentScroll } from "@/lib/scroll-lock";

import { dismissKey, undismissedIds } from "./popup-dismiss";
import s from "./Popup.module.css";

const OPEN_DELAY_MS = 700;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface PopupContent {
  id: number;
  title: string;
  body: string;
  imageSrc: string | null;
  /** 사진만 보이는 팝업인가(서버가 isImageOnlyPopup 으로 정해 내려 준다) */
  imageOnly: boolean;
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

function PopupWindow({
  popup,
  labels,
  lang,
  hideToday,
  onHideToday,
  onClose,
}: {
  popup: PopupContent;
  labels: PopupLabels;
  lang?: string;
  hideToday: boolean;
  onHideToday: (checked: boolean) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const imageOnly = popup.imageOnly && popup.imageSrc !== null;
  return (
    <div
      className={imageOnly ? `${s.modal} ${s.modalImageOnly}` : s.modal}
      role="dialog"
      aria-modal="true"
      // 사진만 창에는 보이는 제목이 없다 — 관리용 이름이 창 이름이 된다
      aria-labelledby={imageOnly ? undefined : titleId}
      aria-label={imageOnly ? popup.title : undefined}
      tabIndex={-1}
      data-testid="popup"
      data-popup-id={popup.id}
      data-image-only={imageOnly ? "true" : undefined}
    >
      <button type="button" className={s.x} aria-label={labels.closeAria} onClick={onClose} data-testid="popup-x">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>

      {popup.imageSrc ? (
        <div className={s.ph}>
          {/* 사진은 원래 비율 그대로 — 크기를 모르는 파일이라 width/height 0 + CSS(width 100% · height auto · contain · 최대 높이) */}
          <Image
            className={s.phImg}
            src={popup.imageSrc}
            alt={imageOnly ? popup.title : ""}
            width={0}
            height={0}
            sizes={imageOnly ? "(min-width: 480px) 360px, 100vw" : "(min-width: 480px) 432px, 100vw"}
          />
        </div>
      ) : null}

      {imageOnly ? null : (
        <div className={s.bd} lang={lang}>
          <h2 id={titleId} className={s.title}>
            {popup.title}
          </h2>
          {/* T3-4 — 본문은 제한 서식. React 요소로만 그린다(팝업 제목이 h2 라 본문 제목은 h3부터) */}
          <RichText text={popup.body} className={s.body} headingBase={3} />
        </div>
      )}

      <div className={s.ft}>
        <label className={s.chk}>
          <input
            type="checkbox"
            checked={hideToday}
            onChange={(event) => onHideToday(event.target.checked)}
            data-testid="popup-hide-today"
          />
          {labels.hideToday}
        </label>
        <button type="button" className={s.txt} onClick={onClose} data-testid="popup-close">
          {labels.close}
        </button>
      </div>
    </div>
  );
}

/** `lang`(P7-4) — 사장님이 쓴 제목·본문의 언어. 홈 팝업은 한국어 화면에만 뜬다(OF3-R2)지만 속성 전달은 그대로 둔다. 버튼 라벨은 화면 언어 그대로다. */
export function Popup({ popups, labels, lang }: { popups: readonly PopupContent[]; labels: PopupLabels; lang?: string }) {
  /** 지금 열려 있는 창 — 서버가 정한 순서 그대로(왼쪽 위부터) */
  const [openIds, setOpenIds] = useState<number[]>([]);
  const [hideIds, setHideIds] = useState<number[]>([]);
  const openRef = useRef<number[]>([]);
  const hideRef = useRef<Set<number>>(new Set());
  const overlayRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const idsKey = popups.map((p) => p.id).join(",");
  const open = openIds.length > 0;

  const show = useCallback((ids: number[]) => {
    openRef.current = ids;
    setOpenIds(ids);
  }, []);

  useEffect(() => {
    const ids = idsKey === "" ? [] : idsKey.split(",").map(Number);
    const timer = window.setTimeout(() => show(undismissedIds(ids, new Date(), isDismissed)), OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [idsKey, show]);

  /** 한 창 닫기 — 그 창의 "오늘 하루 보지 않기" 가 켜져 있으면 기억한다 */
  const closeOne = useCallback(
    (id: number) => {
      if (hideRef.current.has(id)) remember(dismissKey(id, new Date()));
      show(openRef.current.filter((x) => x !== id));
    },
    [show],
  );

  /** 막 클릭 · Esc — 열린 창 전부. 창마다 자기 체크를 따른다 */
  const closeAll = useCallback(() => {
    const now = new Date();
    for (const id of openRef.current) if (hideRef.current.has(id)) remember(dismissKey(id, now));
    show([]);
  }, [show]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockDocumentScroll(); // 배경 스크롤 잠금은 문서 루트에(P7-4 · lib/scroll-lock.ts)

    const focusables = () => Array.from(overlayRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAll();
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
      unlock();
      restoreFocusRef.current?.focus();
    };
  }, [open, closeAll]);

  // 처음 열릴 때, 그리고 창 하나가 닫혀 포커스가 막 밖(body)으로 떨어졌을 때 — 남은 첫 창의 첫 조작으로 보낸다(포커스 가둠이 새지 않게)
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || openIds.length === 0) return;
    if (overlay.contains(document.activeElement)) return;
    const first = overlay.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, [openIds]);

  if (!open) return null;

  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) closeAll();
  };

  const byId = new Map(popups.map((p) => [p.id, p]));

  return (
    <div ref={overlayRef} className={s.overlay} onMouseDown={onBackdrop} data-testid="popup-overlay">
      <div className={s.stack}>
        {openIds.map((id) => {
          const popup = byId.get(id);
          if (!popup) return null;
          return (
            <PopupWindow
              key={id}
              popup={popup}
              labels={labels}
              lang={lang}
              hideToday={hideIds.includes(id)}
              onHideToday={(checked) => {
                if (checked) hideRef.current.add(id);
                else hideRef.current.delete(id);
                setHideIds([...hideRef.current]);
              }}
              onClose={() => closeOne(id)}
            />
          );
        })}
      </div>
    </div>
  );
}

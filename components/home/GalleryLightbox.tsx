"use client";
/**
 * 갤러리 글 상세의 사진 그리드 + 확대 보기 (OWNER-FEEDBACK T4-2 · 사장님 요청 19).
 *
 *   - 그리드 칸 모양은 GalleryGrid 와 같다(Sections.module.css .gal*). 칸마다 투명 버튼이 덮여 누르면 그 사진이 크게 열린다.
 *   - 확대 보기는 모달 대화상자다: Esc 닫기 · ←/→ 이전·다음 · 배경 누르면 닫기 · 닫으면 누른 칸으로 초점이 돌아간다.
 *   - 배경 스크롤 잠금은 lib/scroll-lock.ts(중첩 안전 — 팝업과 함께 열려도 풀림이 꼬이지 않는다).
 *   - 문구는 전부 props(messages pages.gallery.detail.lightbox.*). 데이터·원장·쿼리를 import 하지 않는다(tests/home.test.ts §2).
 *   - 사진 설명은 사장님이 쓴 한국어 — 영문 화면에서 lang 을 받는다(GalleryGrid 와 같은 규약).
 */
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { lockDocumentScroll } from "@/lib/scroll-lock";

import s from "./Sections.module.css";
import l from "./GalleryLightbox.module.css";

export interface LightboxPicture {
  id: number;
  src: string;
  caption: string | null;
}

export interface LightboxLabels {
  /** "{n}" 자리표시자 — 칸 버튼의 이름 */
  open: string;
  label: string;
  close: string;
  prev: string;
  next: string;
  /** "{n}" · "{total}" 자리표시자 */
  position: string;
}

export function GalleryLightbox({
  pictures,
  labels,
  captionLang,
  testId = "album-gallery-grid",
}: {
  pictures: readonly LightboxPicture[];
  labels: LightboxLabels;
  captionLang?: string;
  testId?: string;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const total = pictures.length;

  const close = useCallback(() => setIndex(null), []);
  const step = useCallback((d: number) => setIndex((i) => (i === null ? i : Math.min(Math.max(i + d, 0), total - 1))), [total]);

  const open = index !== null;
  // 여는 순간에만 잠그고 초점을 옮긴다 — 이전·다음으로 index 가 바뀔 때는 다시 돌지 않는다(open 은 그대로다).
  useEffect(() => {
    if (!open) return;
    const unlock = lockDocumentScroll();
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      unlock();
    };
  }, [open, close, step]);

  useEffect(() => {
    if (!open) triggerRef.current?.focus();
  }, [open]);

  const current = index === null ? null : pictures[index];

  return (
    <>
      <div className={s.gal} data-testid={testId}>
        {pictures.map((g, i) => (
          <figure key={g.id} className={i === 0 ? s.galWide : s.galItem} lang={g.caption ? captionLang : undefined}>
            <Image className={s.galImg} src={g.src} alt={g.caption ?? ""} fill sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" />
            {g.caption ? <figcaption className={s.galCap}>{g.caption}</figcaption> : null}
            <button
              type="button"
              className={l.cell}
              aria-label={labels.open.replace("{n}", String(i + 1))}
              aria-haspopup="dialog"
              onClick={(e) => {
                triggerRef.current = e.currentTarget;
                setIndex(i);
              }}
              data-testid="lightbox-open"
            />
          </figure>
        ))}
      </div>

      {current ? (
        <div
          className={l.backdrop}
          role="dialog"
          aria-modal="true"
          aria-label={labels.label}
          data-testid="lightbox"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className={l.bar}>
            <span className={l.position} aria-live="polite">
              {labels.position.replace("{n}", String((index ?? 0) + 1)).replace("{total}", String(total))}
            </span>
            <button ref={closeRef} type="button" className={l.btn} onClick={close} data-testid="lightbox-close">
              {labels.close}
            </button>
          </div>
          <div className={l.stage} onClick={close}>
            <Image key={current.id} className={l.img} src={current.src} alt={current.caption ?? ""} fill sizes="100vw" loading="eager" />
          </div>
          {current.caption ? (
            <p className={l.caption} lang={captionLang}>
              {current.caption}
            </p>
          ) : null}
          <div className={l.nav}>
            <button type="button" className={l.btn} onClick={() => step(-1)} disabled={index === 0} data-testid="lightbox-prev">
              {labels.prev}
            </button>
            <button type="button" className={l.btn} onClick={() => step(1)} disabled={index === total - 1} data-testid="lightbox-next">
              {labels.next}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

"use client";

/**
 * 히어로 캐러셀 — client island 하나 (P2-4 §1). 슬라이드 내용(JSX)은 서버 Hero 가 props 로 내린다.
 *
 * 동작 (목업 variant-08 히어로 스크립트 그대로):
 *   - 5초 자동 전환 · hover/focus 정지 · 탭이 안 보이면 정지 · prefers-reduced-motion: reduce 면 자동 전환 끔
 *   - 좌우 버튼 · 인디케이터(aria-current) · 방향키 ←→
 *   - 수동 조작(jump)마다 타이머를 다시 시작한다(idx 가 바뀌면 interval 을 새로 건다)
 * 접근성: region + aria-roledescription, 비활성 슬라이드는 aria-hidden + inert(탭 순서에서 제외),
 *   자동 회전 중에는 aria-live="off", 멈추면 "polite" (WAI-ARIA 캐러셀 패턴).
 * 이미지: next/image fill — LCP 인 첫 슬라이드만 priority.
 * 이 파일에 한글 리터럴 없음(라벨은 서버가 넣는다). 원장·쿼리 import 없음.
 */
import Image from "next/image";
import { useCallback, useEffect, useId, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";

import s from "./Hero.module.css";

export const AUTOPLAY_MS = 5000;

export interface HeroSlide {
  key: string;
  /** public/hero/*.jpg */
  image: string;
  /** "1 / 3 인천공항 픽업·샌딩" 처럼 서버가 완성한 라벨 */
  ariaLabel: string;
  dotLabel: string;
  content: ReactNode;
}

export interface HeroCarouselLabels {
  carousel: string;
  role: string;
  slideRole: string;
  prev: string;
  next: string;
  dots: string;
}

export function HeroCarousel({ slides, labels }: { slides: HeroSlide[]; labels: HeroCarouselLabels }) {
  const total = slides.length;
  const baseId = useId();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const go = useCallback((n: number) => setIndex(((n % total) + total) % total), [total]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const autoplay = total > 1 && !paused && !hidden && !reduceMotion;
  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setInterval(() => go(index + 1), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [autoplay, index, go]);

  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    }
  };

  return (
    <section
      className={s.car}
      role="region"
      aria-roledescription={labels.role}
      aria-label={labels.carousel}
      data-testid="hero-carousel"
      data-autoplay={autoplay ? "on" : "off"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <div className={s.stage} aria-live={autoplay ? "off" : "polite"}>
        {slides.map((slide, i) => {
          const active = i === index;
          return (
            <article
              key={slide.key}
              id={`${baseId}-slide-${i}`}
              className={active ? `${s.slide} ${s.slideOn}` : s.slide}
              role="group"
              aria-roledescription={labels.slideRole}
              aria-label={slide.ariaLabel}
              aria-hidden={!active}
              inert={!active}
              data-slide={slide.key}
              data-active={active ? "true" : "false"}
            >
              <div className={s.bg} aria-hidden="true">
                <Image
                  className={s.bgImg}
                  src={slide.image}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 60vw, 100vw"
                  priority={i === 0}
                />
              </div>
              {slide.content}
            </article>
          );
        })}
      </div>

      <button type="button" className={`${s.arrow} ${s.arrowPrev}`} aria-label={labels.prev} onClick={() => go(index - 1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 5-7 7 7 7" />
        </svg>
      </button>
      <button type="button" className={`${s.arrow} ${s.arrowNext}`} aria-label={labels.next} onClick={() => go(index + 1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m9 5 7 7-7 7" />
        </svg>
      </button>

      <div className={s.dots} role="group" aria-label={labels.dots}>
        {slides.map((slide, i) => (
          <button
            key={slide.key}
            type="button"
            className={s.dot}
            aria-current={i === index ? "true" : "false"}
            aria-controls={`${baseId}-slide-${i}`}
            aria-label={slide.dotLabel}
            onClick={() => go(i)}
          />
        ))}
        <span className={s.cnt} aria-hidden="true">
          <b data-testid="hero-index">{index + 1}</b> / {total}
        </span>
      </div>
    </section>
  );
}

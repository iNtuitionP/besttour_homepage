"use client";

/**
 * 히어로 캐러셀 — client island 하나 (P2-4 §1). 슬라이드 내용(JSX)은 서버 Hero 가 props 로 내린다.
 *
 * 동작 (목업 variant-08 히어로 스크립트 그대로):
 *   - 5초 자동 전환 · hover/focus 정지 · 탭이 안 보이면 정지 · prefers-reduced-motion: reduce 면 자동 전환 끔
 *   - 좌우 버튼 · 인디케이터(aria-current) · 방향키 ←→
 *   - 수동 조작(jump)마다 타이머를 다시 시작한다(idx 가 바뀌면 interval 을 새로 건다)
 * 자동 넘김 멈춤/재생 버튼 (P7-4 · WCAG 2.2.2): 사용자의 선택이 우선이다 — 아직 고르지 않았으면 감속 설정(reduce)일 때 멈춤, 아니면 재생.
 *   재생을 누르면 hover·focus 로 잠시 멈춘 것도 풀린다(사용자가 명시적으로 원했다 — APG). 라벨은 상태에 따라 "멈춤" ↔ "재생".
 * 컨트롤 줄 (P7-4): 모든 폭에서 슬라이드 아래 — [멈춤·재생][점][쪽수] ……… [이전][다음]. 예전 640px 이상의 세로 가운데 화살표는
 *   제목·본문 글자를 덮었다(UIUX 감사 1280·768 · ko·en). 탭 순서 = 보이는 순서, 회전 컨트롤이 첫 번째(WAI-ARIA APG 캐러셀).
 *   점은 누르는 영역 44×44 · 보이는 막대는 그대로(Hero.module.css .dot::before).
 * 접근성: region + aria-roledescription, 비활성 슬라이드는 aria-hidden + inert(탭 순서에서 제외),
 *   자동 회전 중에는 aria-live="off", 멈추면 "polite" (WAI-ARIA 캐러셀 패턴). 슬라이드 제목은 전부 h2 — 페이지 h1 은 Hero 가 캐러셀 밖에 둔다.
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
  /** 자동 넘김 멈춤 버튼(재생 중일 때의 라벨) */
  pause: string;
  /** 자동 넘김 재생 버튼(멈춰 있을 때의 라벨) */
  play: string;
}

export function HeroCarousel({ slides, labels }: { slides: HeroSlide[]; labels: HeroCarouselLabels }) {
  const total = slides.length;
  const baseId = useId();
  const [index, setIndex] = useState(0);
  /** hover·focus 로 잠시 멈춤 */
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  /** 멈춤/재생 버튼으로 고른 것 — auto 는 아직 고르지 않음(감속 설정이면 멈춤, 아니면 재생) */
  const [choice, setChoice] = useState<"auto" | "playing" | "stopped">("auto");
  const playing = choice === "playing" || (choice === "auto" && !reduceMotion);

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

  const autoplay = total > 1 && playing && !paused && !hidden;
  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setInterval(() => go(index + 1), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [autoplay, index, go]);

  const togglePlay = () => {
    if (playing) {
      setChoice("stopped");
      return;
    }
    setChoice("playing");
    setPaused(false);
  };

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

      <div className={s.controls} data-testid="hero-controls">
        <div className={s.navGroup}>
          {total > 1 ? (
            <button
              type="button"
              className={s.navBtn}
              aria-label={playing ? labels.pause : labels.play}
              onClick={togglePlay}
              data-testid="hero-play-toggle"
              data-playing={playing ? "true" : "false"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {playing ? <path d="M9 6v12M15 6v12" /> : <path d="M8 5.5v13l11-6.5z" fill="currentColor" />}
              </svg>
            </button>
          ) : null}
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
        </div>
        <div className={s.navGroup}>
          <button type="button" className={s.navBtn} aria-label={labels.prev} onClick={() => go(index - 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 5-7 7 7 7" />
            </svg>
          </button>
          <button type="button" className={s.navBtn} aria-label={labels.next} onClick={() => go(index + 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 5 7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}

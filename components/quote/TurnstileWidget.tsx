"use client";

/**
 * Cloudflare Turnstile 위젯 래퍼 (P3-4). 스크립트는 next/script afterInteractive, 렌더는 explicit 모드.
 *
 *   - `action` 은 TURNSTILE_ACTION('reserve') — 서버 deps 가 siteverify 응답의 action 과 비교한다(다른 위젯 토큰 재사용 차단).
 *   - 위젯이 폼 안에 `<input type="hidden" name="cf-turnstile-response">` 를 스스로 넣는다(response-field 기본값). 이름을 바꾸지 않는다.
 *   - 6단계가 보일 때만 마운트한다(QuoteWizard). 언마운트 시 remove. 서버가 거부를 돌려주면 resetKey 가 올라가 토큰을 새로 받는다
 *     (siteverify 토큰은 1회용이라 같은 토큰으로 재제출하면 turnstile 거부가 난다).
 *   - 사이트키가 없으면 이 컴포넌트를 렌더하지 않는다 — 대신 "접수 준비 중" 안내(QuoteWizard, fail-closed).
 */
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import s from "./quote.module.css";

export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function TurnstileWidget({ siteKey, action, resetKey }: { siteKey: string; action: string; resetKey: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  // 스크립트가 이미 로드된 채 다시 마운트되는 경우(단계를 오갈 때) — onReady 가 커버하지만 한 번 더 확인한다.
  useEffect(() => {
    if (typeof window !== "undefined" && window.turnstile) setReady(true);
  }, []);

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.turnstile : undefined;
    const el = containerRef.current;
    if (!ready || !api || !el) return;
    let id: string | null = null;
    try {
      id = api.render(el, { sitekey: siteKey, action, theme: "light", size: "flexible" });
      widgetIdRef.current = id;
    } catch {
      widgetIdRef.current = null;
    }
    return () => {
      if (id) {
        try {
          api.remove(id);
        } catch {
          // 이미 사라진 위젯 — 무시
        }
      }
      widgetIdRef.current = null;
    };
  }, [ready, siteKey, action]);

  useEffect(() => {
    if (resetKey === 0 || !widgetIdRef.current) return;
    try {
      window.turnstile?.reset(widgetIdRef.current);
    } catch {
      // 리셋 실패 — 다음 제출에서 서버가 다시 거부하고 사용자는 새로고침 안내를 받는다
    }
  }, [resetKey]);

  return (
    <div className={s.turnstile} data-testid="turnstile" data-action={action}>
      <Script src={TURNSTILE_SCRIPT_SRC} strategy="afterInteractive" onReady={() => setReady(true)} />
      <div ref={containerRef} />
    </div>
  );
}

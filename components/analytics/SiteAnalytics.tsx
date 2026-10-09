"use client";

/**
 * 방문 통계(Vercel Web Analytics) — 공개 로케일 레이아웃(app/[locale]/layout.tsx)에서만 렌더한다 (P1-7 브리프 (3) · 수정 라운드 2).
 *
 * 거부 신호가 하나라도 있으면 **`<Analytics>` 를 렌더하지 않는다 — 스크립트 자체를 불러오지 않는다**(R2 · 사용자 결정):
 *   거부 표시(/privacy 의 '방문 통계 거부' 버튼 — localStorage) · Do Not Track · GPC. 판정은 lib/analytics/before-send.ts.
 *   - 서버 렌더와 첫 화면에서는 아무것도 렌더하지 않는다(allowed=false). 마운트 뒤 브라우저에서 신호를 읽고 허용일 때만 렌더한다 —
 *     서버는 localStorage·DNT·GPC 를 모르므로 "일단 불러오고 나중에 끄기" 가 되지 않게.
 *   - 같은 탭에서 버튼을 누르면(ANALYTICS_OPTOUT_EVENT) · 다른 탭에서 바꾸면(storage) 즉시 다시 판정한다.
 *     이미 불러온 스크립트는 남지만 beforeSend(liveAnalyticsBeforeSend)가 보낼 때마다 신호를 다시 읽어 null 을 돌려준다(이중 안전).
 *
 * 왜 클라이언트 래퍼인가: `beforeSend` 는 함수다. 서버 컴포넌트(레이아웃)는 함수를 클라이언트 컴포넌트 props 로 넘길 수 없다.
 *   - 관리자 레이아웃(app/admin/**)에는 넣지 않는다. 필터도 /admin 을 한 번 더 막는다.
 *   - 쿼리 문자열·해시는 보내기 전에 지운다(`/quote/done?code=…` 의 접수번호 등).
 *   - 커스텀 이벤트(track)는 쓰지 않는다.
 *   - 실제 수집은 Vercel 대시보드에서 Web Analytics 를 켜야 시작된다(사람 몫). 운영 스크립트는 같은 출처 `/_vercel/insights/script.js` 다.
 */
import { Analytics } from "@vercel/analytics/next";
import { useEffect, useState } from "react";

import { ANALYTICS_OPTOUT_EVENT, liveAnalyticsBeforeSend, readAnalyticsSignals, shouldLoadAnalytics } from "@/lib/analytics/before-send";

export function SiteAnalytics() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const check = () => setAllowed(shouldLoadAnalytics(readAnalyticsSignals()));
    check();
    window.addEventListener(ANALYTICS_OPTOUT_EVENT, check);
    window.addEventListener("storage", check);
    return () => {
      window.removeEventListener(ANALYTICS_OPTOUT_EVENT, check);
      window.removeEventListener("storage", check);
    };
  }, []);

  if (!allowed) return null;
  return <Analytics beforeSend={liveAnalyticsBeforeSend} />;
}

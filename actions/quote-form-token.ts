"use server";
/**
 * 간편 견적 모달의 타임트랩 폼 토큰 — 모달을 **열 때** 받는다 (P3-8 · 브리프 §D-5).
 *
 * 왜 서버액션인가: 홈은 ISR(revalidate 600)이다. 토큰을 HTML 에 구우면 방문이 뜸한 시간에는 구워진 토큰이 만료(FORM_MAX_AGE_MS 1시간)되어
 * **모든** 제출이 bot 이 된다. 그래서 페이지는 정적으로 두고 토큰만 요청마다 새로 서명한다(옛 /quote 가 force-dynamic 이던 이유와 같다).
 *
 * 경계
 *   - export 는 이 async 함수 하나(ADR-3).
 *   - 시크릿은 components/quote/form-token.ts issueQuoteFormToken() → lib/guard/deps guardSecret() 로만 읽는다. 이 파일은 env 를 읽지 않는다.
 *   - 시크릿이 없으면 null(throw 0 · 로그 한 줄은 issueQuoteFormToken 이 남긴다) → 모달이 "접수 준비 중 — 전화로 문의" + 제출 비활성(fail-closed).
 *   - 토큰은 발급 시각의 서명뿐이다(IP·세션·개인정보 없음). 이 액션을 여러 번 불러 얻는 것은 페이지를 여러 번 열어 얻는 것과 같다 —
 *     재사용은 rate limit 이 흡수한다(lib/guard/timetrap.ts 헤더).
 */
import { issueQuoteFormToken } from "@/components/quote/form-token";

export async function requestQuoteFormToken(): Promise<string | null> {
  return issueQuoteFormToken();
}

/**
 * 폼 토큰 발급 — /quote 서버 컴포넌트 전용 (P3-4, 렌더 전략·토큰 컨트롤러 결정).
 *
 *   - 타임트랩 토큰은 **서버가 요청마다** 만든다(issueFormToken, HMAC(GUARD_SECRET)). 클라이언트가 만들면 의미가 없고,
 *     정적/ISR 로 구워지면 FORM_MAX_AGE_MS(1시간) 뒤 모든 방문자가 bot 이 된다 → page.tsx 는 force-dynamic.
 *   - 시크릿은 guardSecret() 로만 읽는다. defaultGuardDeps() 는 Turnstile·Upstash·허용 호스트가 하나라도 없으면 throw 라
 *     렌더에서 부르면 env 가 빈 환경(CI legal-pages-http 빌드·로컬 dev·프리뷰)에서 /quote 가 500 이 된다.
 *   - 시크릿이 없으면 페이지는 죽지 않는다: throw 를 잡아 null 을 돌려주고 structuredLog 한 줄(quote.form_token_unavailable).
 *     6단계는 null 을 보고 "접수 준비 중 — 전화로 문의" + 제출 disabled 를 보인다(fail-closed, 정직하게).
 *   - 로그에는 오류 이름·메시지만(시크릿 값·개인정보 없음).
 *
 * lib/guard/deps 는 server-only 다 — 이 모듈을 클라이언트 컴포넌트에서 import 하면 빌드가 깨진다(의도).
 */
import { issueFormToken } from "@/lib/guard";
import { guardSecret } from "@/lib/guard/deps";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";

export const FORM_TOKEN_UNAVAILABLE_EVENT = "quote.form_token_unavailable";

export interface FormTokenLogEntry extends StructuredLogEntry {
  level: "error";
  event: typeof FORM_TOKEN_UNAVAILABLE_EVENT;
  name: string;
  message: string;
}

export function issueQuoteFormToken(now: Date = new Date(), log: (entry: FormTokenLogEntry) => void = structuredLog): string | null {
  try {
    return issueFormToken(now, guardSecret());
  } catch (err) {
    log({
      level: "error",
      event: FORM_TOKEN_UNAVAILABLE_EVENT,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

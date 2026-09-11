import en from "../messages/en.json";
import ko from "../messages/ko.json";
import { routing, type Locale } from "./routing";

const catalogs: Record<Locale, Record<string, unknown>> = { ko, en };

/**
 * 메시지 폴백 정책 — 병합 순서가 곧 폴백 순서다.
 *
 *   messages = { ...ko, ...<요청 로케일> }
 *
 * 기본 로케일(ko)을 먼저 펼쳐 바닥을 깔고, 요청 로케일 메시지를 나중에 펼쳐 덮어쓴다.
 * → en.json이 비어 있으면(현재 상태) /en에서도 ko 문자열이 그대로 나온다.
 *
 * 주의: 최상위 키 기준의 shallow 병합이다. en.json에 네임스페이스를 추가할 때는
 * 그 네임스페이스의 키를 전부 채우거나 중첩 병합으로 승격해야 한다. [TEMP]
 * (영문 카피 실수령 전까지 en.json = {} 를 유지하므로 지금은 shallow로 충분하다)
 *
 * 이 함수는 next-intl에 의존하지 않는 순수 함수다 — getRequestConfig가 이것을 호출한다.
 */
export function loadMessages(locale: string): Record<string, unknown> {
  const requested = catalogs[locale as Locale];
  return { ...catalogs[routing.defaultLocale], ...requested };
}

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
 *
 * 최상위 키 기준의 **shallow 병합**이다(P2-6 에서 그대로 두기로 했다).
 *   - en.json 은 공개 네임스페이스(common·layout·errors·home·reservation·quote·reservationCheck·pages)를 **키 하나 빠짐없이**
 *     갖는다. 네임스페이스 안에서 키가 하나라도 빠지면 그 키는 ko 로 떨어지지 않고 비어서 깨진다 —
 *     tests/i18n-en.test.ts §2 의 패리티 테스트가 키·배열 길이·ICU 인자·리치 태그까지 잠근다.
 *   - admin 은 en 에 없다 → /admin(로케일 밖, 한국어 전용)은 어느 경우에도 ko 네임스페이스를 쓴다.
 *   - en 의 `legal` 은 원장 UI 문구의 영문이다. ko 에는 없다 — ko 는 원장 상수를 직접 읽는다(lib/i18n/ledger-ui.ts).
 * 중첩(deep) 병합으로 승격하지 않은 이유: 빠진 영문 키가 조용히 한국어로 채워지면 `/en` 에 한국어가 섞여도 아무도 모른다.
 * 테스트로 빠짐을 막고, 런타임은 단순하게 둔다.
 *
 * 이 함수는 next-intl에 의존하지 않는 순수 함수다 — getRequestConfig가 이것을 호출한다.
 */
export function loadMessages(locale: string): Record<string, unknown> {
  const requested = catalogs[locale as Locale];
  return { ...catalogs[routing.defaultLocale], ...requested };
}

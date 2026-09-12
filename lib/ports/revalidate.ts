/**
 * `next/cache` `revalidateTag()` 포트 (플랜 v4 ADR-4 · 계약 §5 `lib/ports/*.ts`).
 *
 * 접수 뒤 홈 "접수 현황"(P3-5, 60초 캐시) 같은 태그 캐시를 무효화할 때 서버액션 래퍼(P3-3)가 쓴다.
 * lib/<domain> 순수 함수는 이것을 import 하지 않고 deps 로만 받는다. vitest 에서는 no-op mock.
 *
 * 서버 전용: revalidateTag 는 서버 컨텍스트에서만 동작한다. `server-only` 마커로 클라이언트 번들 유입을 막는다.
 */
import "server-only";

import { revalidateTag } from "next/cache";

export type Revalidate = (tag: string) => void;

/** `revalidateTag(tag)` 위임. 얇아야 한다. */
export const revalidate: Revalidate = (tag) => {
  revalidateTag(tag);
};

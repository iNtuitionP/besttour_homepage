/**
 * `next/server` `after()` 포트 (플랜 v4 ADR-4 · 계약 §5 `lib/ports/*.ts`).
 *
 * lib/<domain> 순수 함수(예: lib/reservations/create.ts)는 Next 원시값을 직접 import 하지 않는다 — 단위 테스트가 불가능해진다.
 * 서버액션 래퍼(actions/*, P3-3)가 이 포트를 deps 로 넘기고, vitest 에서는 즉시 실행하는 mock 으로 대체한다.
 *
 * 서버 전용: after() 는 요청 스코프 안에서만 동작한다. `server-only` 마커로 클라이언트 번들 유입을 빌드 타임에 막는다.
 */
import "server-only";

import { after } from "next/server";

/** 응답이 나간 뒤 실행할 작업. 반환값은 버려진다 — 결과가 필요한 일은 after 로 미루지 않는다. */
export type AfterTask = () => void | Promise<void>;
export type RunAfter = (task: AfterTask) => void;

/** `after(task)` 위임. 얇아야 한다 — 여기에 로직을 두면 그 로직은 테스트되지 않는다. */
export const runAfter: RunAfter = (task) => {
  after(task);
};

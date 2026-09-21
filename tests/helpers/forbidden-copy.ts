/**
 * 통합 카피 금지 목록 — **테스트 쪽 입구**. 정의는 `lib/copy/rules.ts` 한 곳이다 (P6-12 이동).
 *
 * P6-6 이 목록을 여기 한 곳으로 모았고, P6-12 가 사장님 글 경고(known-defects D4)에 쓰려고 `lib/` 로 옮겼다.
 * `tests/` 아래 모듈은 앱 코드가 import 할 수 없기 때문이다. 두 벌을 두지 않으려고 **정의를 옮기고 여기서는 그대로 다시 내보낸다** —
 * tests/copy-rules.test.ts · tests/home.test.ts · tests/pages.test.ts 는 이 경로·이름·형태를 그대로 쓴다(무수정).
 * P2-6 에서 영문 목록 둘(FORBIDDEN_TERMS_EN · UNPROVEN_CLAIMS_EN)을 더했다 — 정의는 여전히 rules.ts 하나다.
 *
 * 여기에 목록을 **다시 정의하지 마라.** tests/admin-copy-warning.test.ts 가 저장소 전체에서 목록 정의가
 * `lib/copy/rules.ts` 하나뿐인지 grep 으로 단언한다.
 */
export {
  COMPARATIVE_CLAIMS,
  COMPARATIVE_CLAIMS_EN,
  CONTACT_LITERALS,
  COPY_ALLOWLIST,
  FORBIDDEN_TERMS_EN,
  FORBIDDEN_WORDS,
  PRICE_LITERALS,
  UNPROVEN_CLAIMS,
  UNPROVEN_CLAIMS_EN,
  type CopyAllowEntry,
  type CopyRule,
} from "@/lib/copy/rules";

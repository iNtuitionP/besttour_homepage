/**
 * 사장님 글 경고의 분류 이름 — 낱말은 하나도 없다 (P6-12).
 *
 * 목록(lib/copy/rules.ts)과 떨어진 파일인 이유: 관리자 화면(클라이언트 패널·문구 조립)이 분류 이름을 값으로 써야 하는데,
 * rules.ts 를 값으로 import 하면 목록이 따라온다. 분류 이름만 여기 두고 rules.ts 가 이것을 가져다 쓴다.
 * 화면 문구는 messages/ko.json `admin.copyWarning.kind.*`, 설명은 docs/ops/admin-manual.md 4장과 **같은 문장**이다.
 */
export const OWNER_COPY_KINDS = ["license", "rival", "internal", "unproven", "comparative"] as const;
export type OwnerCopyKind = (typeof OWNER_COPY_KINDS)[number];

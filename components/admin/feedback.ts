/**
 * 관리자 결과 알림 — 어느 모양으로 알릴까 (P5-20 · 제안서 ④ 원칙 4 · Polaris "오류는 토스트가 아니라 배너로").
 *
 *   - **toast** — DB 가 실제로 바뀐 성공(ok · changed). 토스트는 3초(링크가 붙으면 5초) 뒤 저절로 사라진다(components/admin/AdminToast.tsx).
 *   - **banner** — 실패·찾을 수 없음·입력 확인·중복·파일 실패. 그 자리에 role=alert 로 남고 **저절로 닫히지 않는다**(다음 동작 때 걷힌다).
 *     바뀐 것이 없는 성공 모양(ok 인데 changed 가 아님)도 성공 알림을 띄우지 않는다 — "했어요" 라고 말할 일이 없다.
 *   - **none** — 저장 전 확인(copyWarning). 확인 패널(CopyWarningPanel, role=alert)이 무엇이·왜 인지 이미 말한다 — 같은 말을 두 번 읽히지 않는다.
 *
 * 순수 함수 — 공지·팝업·노선·갤러리의 결과 객체({ ok, changed, code })를 그대로 받는다(lib/admin/*Input.ts). 예약 처리(확정·취소)는
 * P5-19 의 처리 영역이 같은 원칙(성공 토스트 · 실패 시트 안 배너)을 자기 상태 기계로 지킨다(components/admin/reservation-sheet.ts).
 */
export type FeedbackKind = "toast" | "banner" | "none";

export interface ActionOutcome {
  ok: boolean;
  changed: boolean;
  code: string;
}

export function feedbackKind(result: ActionOutcome): FeedbackKind {
  if (result.code === "copyWarning") return "none";
  return result.ok && result.changed ? "toast" : "banner";
}

/**
 * 사진 올리기 한 번의 실패 요약 (P5-20 수정 라운드 · 리뷰 P2-6). 올라간 장이 있으면 성공 토스트는 따로 뜬다(GalleryUploader).
 *   - 전부 실패(올라간 장 0 · 실패 1장 이상) → allFailed — 예전에는 토스트도 role=alert 도 없이 줄마다 이유만 적혔다.
 *   - 일부 실패 → someFailed — 성공 토스트와 함께 "N장은 올리지 못했어요"(실패 = 배너 원칙 그대로).
 *   - 실패 없음(0장 선택 포함) → null.
 */
export function uploadSummary(ok: number, failed: number): { kind: "allFailed" | "someFailed"; failed: number } | null {
  if (failed <= 0) return null;
  return { kind: ok > 0 ? "someFailed" : "allFailed", failed };
}

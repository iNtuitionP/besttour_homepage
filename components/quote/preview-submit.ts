/**
 * 개발 전용 — 서버액션 mock 결과 3종 (P3-4 브리프 §browse: `?previewSubmit=ok|fieldErrors|infra`, `1` 은 ok).
 *
 * 원격 Supabase 에는 쓰기 테스트를 하지 않고(로컬 스택 없음·Turnstile 실키 없음) UI 반응만 실측하기 위한 분기다.
 * page.tsx 가 NODE_ENV !== production 에서만 searchParams 를 읽어 mode 문자열 하나를 props 로 내리고, 위저드는 그 mode 가 있으면
 * submitReservation 대신 아래 previewSubmitAction 을 useActionState 에 감싼다. 개인정보 모양의 값은 없다(P3-5 리뷰 N-2).
 * production 빌드에서는 page.tsx 의 분기가 죽어 mode 가 항상 null 이다.
 */
import { RESERVATION_ERROR_KEYS, type SubmitResult } from "@/lib/reservations/submitResult";

export const PREVIEW_SUBMIT_MODES = ["ok", "fieldErrors", "infra"] as const;
export type PreviewSubmitMode = (typeof PREVIEW_SUBMIT_MODES)[number];

/** PUBLIC_CODE_ALPHABET(0·O·1·I·L 제외 31자) 안의 8자 — 실제 접수번호 모양이지만 저장된 적 없는 값. */
export const PREVIEW_PUBLIC_CODE = "PRV2PRV2";
/** pending 상태를 눈으로 볼 수 있게 살짝 기다린다. */
const PREVIEW_DELAY_MS = 400;

export function parsePreviewSubmit(v: string | string[] | undefined): PreviewSubmitMode | null {
  if (typeof v !== "string") return null;
  if (v === "1") return "ok";
  return (PREVIEW_SUBMIT_MODES as readonly string[]).includes(v) ? (v as PreviewSubmitMode) : null;
}

export function previewSubmitResult(mode: PreviewSubmitMode): SubmitResult {
  switch (mode) {
    case "ok":
      return { ok: true, publicCode: PREVIEW_PUBLIC_CODE, notifyQueued: true };
    case "fieldErrors":
      return {
        ok: false,
        code: "validation",
        messageKey: RESERVATION_ERROR_KEYS.validation,
        fieldErrors: { phone: RESERVATION_ERROR_KEYS.validation },
      };
    case "infra":
      return { ok: false, code: "infra", messageKey: RESERVATION_ERROR_KEYS.infra };
  }
}

/** submitReservation 과 같은 시그니처 `(formData) => Promise<SubmitResult>` — 폼 데이터는 읽지 않는다. */
export function previewSubmitAction(mode: PreviewSubmitMode): (formData: FormData) => Promise<SubmitResult> {
  return async () => {
    await new Promise((r) => setTimeout(r, PREVIEW_DELAY_MS));
    return previewSubmitResult(mode);
  };
}

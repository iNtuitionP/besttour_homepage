/**
 * 개발 전용 — 서버액션 mock 결과 3종 (P6-3a 브리프 §browse: `?previewResult=ok|not_found|ratelimit`, `1` 은 ok). P3-4 preview-submit.ts 와 같은 규약.
 *
 * 원격 reservations 는 비어 있고 **원격에 쓰지 않는다** — 실제 액션은 not_found 만 낸다. 카드·오류 렌더를 실측하기 위한 분기다.
 * page.tsx 가 NODE_ENV !== production 에서만 searchParams 를 읽어 mode 문자열 하나를 props 로 내리고, CheckForm 은 그 mode 가 있으면
 * checkReservation 대신 아래 previewCheckAction 을 useActionState 에 감싼다. production 빌드에서는 page.tsx 의 분기가 죽어 mode 가 항상 null 이다.
 *
 * ok 뷰는 **가려진 값만** 든 ReservationView 리터럴이다 — 원문 이름·전화를 넣고 maskName/maskPhone 으로 가리는 방식이 아니다(P3-5 리뷰 N-2:
 * dev 에서 클라이언트 번들·서버 props 는 브라우저에 그대로 간다). 라벨은 lib/codes.ts 의 표시 함수로, 차량명은 0001 시드 name_ko 그대로.
 */
import { locationLabelKo } from "@/lib/codes";
import { CHECK_ERROR_KEYS, notFoundResult, type CheckResult } from "@/lib/reservation-check/result";
import type { ReservationView } from "@/lib/reservation-check/view";

export const PREVIEW_RESULT_MODES = ["ok", "not_found", "ratelimit"] as const;
export type PreviewResultMode = (typeof PREVIEW_RESULT_MODES)[number];

/** PUBLIC_CODE_ALPHABET(0·O·1·I·L 제외 31자) 안의 8자 — 실제 접수번호 모양이지만 저장된 적 없는 값(P3-4 와 같은 값). */
export const PREVIEW_PUBLIC_CODE = "PRV2PRV2";
/** pending 상태를 눈으로 볼 수 있게 살짝 기다린다. */
const PREVIEW_DELAY_MS = 400;

const PREVIEW_VIEW: ReservationView = {
  publicCode: PREVIEW_PUBLIC_CODE,
  status: "confirmed",
  statusKey: "reservationCheck.status.confirmed",
  tripType: "round",
  tripTypeKey: "reservationCheck.tripType.round",
  departAtKst: "2026-10-01 08:00",
  returnAtKst: "2026-10-01 18:00",
  vehicleLabel: "45인승 관광버스",
  originLabel: locationLabelKo("SEL"),
  destinationLabel: locationLabelKo("BSN"),
  busCount: 1,
  passengers: 40,
  maskedName: "홍**",
  maskedPhone: "010-****-0000",
  createdAtKst: "2026-09-13 14:00",
};

export function parsePreviewResult(v: string | string[] | undefined): PreviewResultMode | null {
  if (typeof v !== "string") return null;
  if (v === "1") return "ok";
  return (PREVIEW_RESULT_MODES as readonly string[]).includes(v) ? (v as PreviewResultMode) : null;
}

export function previewCheckResult(mode: PreviewResultMode): CheckResult {
  switch (mode) {
    case "ok":
      return { ok: true, view: { ...PREVIEW_VIEW } };
    case "not_found":
      return notFoundResult();
    case "ratelimit":
      return { ok: false, code: "ratelimit", messageKey: CHECK_ERROR_KEYS.ratelimit };
  }
}

/** checkReservation 과 같은 시그니처 `(formData) => Promise<CheckResult>` — 폼 데이터는 읽지 않는다. */
export function previewCheckAction(mode: PreviewResultMode): (formData: FormData) => Promise<CheckResult> {
  return async () => {
    await new Promise((r) => setTimeout(r, PREVIEW_DELAY_MS));
    return previewCheckResult(mode);
  };
}

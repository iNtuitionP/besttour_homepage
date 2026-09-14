/**
 * 팝업 입력 검증 · 결과 타입 — 순수 모듈 (플랜 v4 P5-4 · ADR-4).
 *
 * Next 도 Supabase 도 모른다. 서버액션(actions/admin/popup.ts)이 FormData 를 주면 값을 돌려주고,
 * 클라이언트 폼(components/admin/PopupForm.tsx)은 여기서 필드 이름과 결과 타입만 가져간다 —
 * 필드 이름 문자열을 화면·액션·테스트가 각자 적으면 조용히 어긋난다.
 *
 * 규칙 셋:
 *   1. **기간은 KST 벽시계 날짜다**(CLAUDE.md §3). 폼이 `YYYY-MM-DD` 를 주고 서버는 그 문자열을 그대로 `date` 컬럼에 넣는다.
 *      `new Date()` 로 바꾸지 않는다 — UTC 로 해석되는 순간 KST 00:00~08:59 에 하루가 밀린다.
 *      실존하는 달력 날짜인지까지 본다(2026-02-30 은 형식은 맞지만 없는 날이다).
 *   2. **이미지 경로는 형식으로 잠근다.** components/home/image-url.ts 가 해석할 수 있는 두 가지만 받는다 —
 *      Storage 상대 경로(`bucket/object.jpg`)와 로컬 public 경로(`/hero/bus-02.jpg`).
 *      절대 URL 은 받지 않는다: next.config.ts 의 remotePatterns 밖 호스트는 <Image> 가 렌더하지 못하고,
 *      `javascript:` 같은 스킴이 화면에 실릴 길도 여기서 닫는다.
 *   3. **결과에 개인정보가 없다.** 팝업은 컨텐츠 표라 애초에 개인정보가 없지만, 결과 객체는 브라우저까지
 *      나가는 값이므로 화면이 쓸 최소(ok·changed·code·필드별 오류 표시)만 담는다. 문구는 messages/ko.json 몫이다.
 *
 * 사용자에게 보일 문구는 여기 없다(한글 리터럴 0). zod 메시지는 개발자용이라 ASCII 로 적는다.
 */
import { z } from "zod";

/** 폼 필드 이름 — 화면·액션·테스트가 같은 문자열을 쓴다. */
export const POPUP_FIELDS = {
  id: "id",
  title: "title",
  body: "body",
  imagePath: "imagePath",
  startsAt: "startsAt",
  endsAt: "endsAt",
  active: "active",
} as const;
export type PopupField = keyof typeof POPUP_FIELDS;

/** 제목 한 줄, 본문은 짧은 안내문 길이. 팝업은 읽히려고 있는 것이라 길면 아무도 읽지 않는다. */
export const POPUP_TITLE_MAX = 60;
export const POPUP_BODY_MAX = 500;
export const POPUP_IMAGE_PATH_MAX = 200;

/** <Image> 가 그릴 수 있는 확장자만. svg 는 제외한다(스크립트를 품을 수 있다). */
export const POPUP_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "gif"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const IMAGE_PATH = new RegExp(
  `^/?[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*\\.(?:${POPUP_IMAGE_EXTENSIONS.join("|")})$`,
  "i",
);

/** "YYYY-MM-DD" 이면서 달력에 실제로 있는 날인가. 서버 TZ 와 무관하게 UTC 왕복으로만 판정한다. */
export function isKstDateString(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Storage 상대 경로 또는 로컬 public 경로인가. 상위 경로 이동(..)과 절대 URL 은 거부한다. */
export function isPopupImagePath(value: string): boolean {
  if (value.length === 0 || value.length > POPUP_IMAGE_PATH_MAX) return false;
  if (value.includes("..")) return false;
  return IMAGE_PATH.test(value);
}

export interface PopupValues {
  title: string;
  body: string;
  /** 비우면 글만 있는 팝업이다. */
  imagePath: string | null;
  /** KST 달력 날짜 "YYYY-MM-DD" — 양 끝 포함 구간. */
  startsAt: string;
  endsAt: string;
  active: boolean;
}

export const PopupInput = z
  .object({
    title: z.string().trim().min(1).max(POPUP_TITLE_MAX),
    body: z.string().trim().min(1).max(POPUP_BODY_MAX),
    imagePath: z.string().trim().max(POPUP_IMAGE_PATH_MAX).nullable(),
    startsAt: z.string().trim(),
    endsAt: z.string().trim(),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.imagePath !== null && !isPopupImagePath(v.imagePath)) {
      ctx.addIssue({ code: "custom", path: ["imagePath"], message: "image path must be a storage or local image path" });
    }
    const startsOk = isKstDateString(v.startsAt);
    const endsOk = isKstDateString(v.endsAt);
    if (!startsOk) ctx.addIssue({ code: "custom", path: ["startsAt"], message: "startsAt must be an existing YYYY-MM-DD date" });
    if (!endsOk) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "endsAt must be an existing YYYY-MM-DD date" });
    // 제로패딩 ISO 날짜라 사전순 비교가 곧 날짜 비교다(lib/queries/popups.ts isActiveOn 과 같은 전제).
    if (startsOk && endsOk && v.startsAt > v.endsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "endsAt must not precede startsAt" });
    }
  });

/** 화면이 문구 키로 쓰는 결과 어휘 — messages/ko.json `admin.popups.result.*`. */
export type PopupActionCode =
  | "created"
  | "updated"
  | "deleted"
  | "activated"
  | "deactivated"
  | "notFound"
  | "validation"
  | "failed";

export interface PopupActionResult {
  /** 사장님에게 빨간 오류를 보일 것인가. */
  ok: boolean;
  /** DB 가 실제로 바뀌었는가. 캐시 무효화는 이것이 true 일 때만. */
  changed: boolean;
  code: PopupActionCode;
  /** 어느 입력을 고쳐야 하는지 표시만 한다(문구는 화면 몫). */
  fieldErrors?: Partial<Record<PopupField, true>>;
}

export const POPUP_FAILED: PopupActionResult = { ok: false, changed: false, code: "failed" };
export const POPUP_NOT_FOUND: PopupActionResult = { ok: false, changed: false, code: "notFound" };

/** 성공 결과 — changed 는 언제나 true 다(바뀐 것이 없으면 notFound 로 끝난다). */
export const popupChanged = (code: PopupActionCode): PopupActionResult => ({ ok: true, changed: true, code });

export function popupValidationFailed(fieldErrors: Partial<Record<PopupField, true>>): PopupActionResult {
  return { ok: false, changed: false, code: "validation", fieldErrors };
}

/** 체크박스는 켜져 있을 때만 값이 온다. 켜짐으로 보는 값은 브라우저가 보내는 "on" 과 명시적인 true/1 뿐이다. */
function isChecked(raw: FormDataEntryValue | null): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

const text = (raw: FormDataEntryValue | null): string => (typeof raw === "string" ? raw : "");

export type ParsedPopupForm = { ok: true; value: PopupValues } | { ok: false; result: PopupActionResult };

/** FormData → 값. 실패는 필드별 표시가 붙은 결과로 돌려준다(예외를 던지지 않는다). */
export function parsePopupForm(formData: FormData): ParsedPopupForm {
  const rawImage = text(formData.get(POPUP_FIELDS.imagePath)).trim();
  const parsed = PopupInput.safeParse({
    title: text(formData.get(POPUP_FIELDS.title)),
    body: text(formData.get(POPUP_FIELDS.body)),
    imagePath: rawImage === "" ? null : rawImage,
    startsAt: text(formData.get(POPUP_FIELDS.startsAt)),
    endsAt: text(formData.get(POPUP_FIELDS.endsAt)),
    active: isChecked(formData.get(POPUP_FIELDS.active)),
  });

  if (!parsed.success) {
    const fieldErrors: Partial<Record<PopupField, true>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && field in POPUP_FIELDS) fieldErrors[field as PopupField] = true;
    }
    return { ok: false, result: popupValidationFailed(fieldErrors) };
  }
  return { ok: true, value: parsed.data };
}

/** 경로·폼으로 들어온 id → 양의 정수. 아니면 null(DB 를 부르지 않는다). */
export function parsePopupId(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

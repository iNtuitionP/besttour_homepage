/**
 * 공지 입력 검증 · 결과 타입 — 순수 모듈 (플랜 v4 P5-5 · ADR-4).
 *
 * Next 도 Supabase 도 모른다(lib/admin/popupInput.ts 와 같은 자리). 서버액션(actions/admin/notice.ts)이 FormData 를
 * 주면 값을 돌려주고, 클라이언트 폼(components/admin/NoticeForm.tsx)은 여기서 필드 이름과 결과 타입만 가져간다 —
 * 필드 이름 문자열을 화면·액션·테스트가 각자 적으면 조용히 어긋난다.
 *
 * 규칙 넷:
 *   1. **게시일은 KST 벽시계 날짜다**(CLAUDE.md §3 · 0004 가 notices.published_at 의 default 를
 *      `(now() at time zone 'Asia/Seoul')::date` 로 바꿨다). 폼이 `YYYY-MM-DD` 를 주고 서버는 그 문자열을 그대로
 *      `date` 컬럼에 넣는다 — `new Date()` 로 바꾸는 순간 UTC 로 해석돼 KST 00:00~08:59 에 하루가 밀린다.
 *      실존하는 달력 날짜인지까지 본다(2026-02-30 은 형식은 맞지만 없는 날이다).
 *   2. **카테고리는 코드로 저장한다**(CLAUDE.md §3 — 번역 문자열 저장 금지). 세 코드는 화면 라벨
 *      `messages/ko.json home.notice.category` 의 키와 같은 집합이고, tests/admin-notices.test.ts 가 그 일치를 단언한다.
 *   3. **본문은 plain text 다.** 공개 상세(P6-3)가 `splitParagraphs` 로 문단만 나눠 렌더하고 HTML 을 해석하지 않는다 —
 *      여기서도 마크업을 해석하거나 정제하지 않는다. 길이만 본다.
 *   4. **결과에 개인정보가 없다.** 공지는 콘텐츠 표라 애초에 개인정보가 없지만, 결과 객체는 브라우저까지 나가는 값이므로
 *      화면이 쓸 최소(ok·changed·code·필드별 오류 표시)만 담는다. 문구는 messages/ko.json 몫이다.
 *
 * KST 날짜 판정은 lib/admin/popupInput.ts 의 `isKstDateString` 을 **재사용한다** — 날짜 규칙이 탭마다 갈리면 안 된다.
 * 사용자에게 보일 문구는 여기 없다(한글 리터럴 0). zod 메시지는 개발자용이라 ASCII 로 적는다.
 */
import { z } from "zod";

import type { CopyWarning } from "./copyWarning";
import { isKstDateString } from "./popupInput";

/** 폼 필드 이름 — 화면·액션·테스트가 같은 문자열을 쓴다. */
export const NOTICE_FIELDS = {
  id: "id",
  title: "title",
  body: "body",
  category: "category",
  publishedAt: "publishedAt",
  active: "active",
} as const;
export type NoticeField = keyof typeof NOTICE_FIELDS;

/** 제목은 목록에서 한 줄, 본문은 안내문 몇 문단. 상한은 화면이 무너지지 않는 선이다. */
export const NOTICE_TITLE_MAX = 80;
export const NOTICE_BODY_MAX = 4000;

/**
 * 카테고리 코드 — `messages/ko.json home.notice.category` 의 키와 같은 집합.
 * 라벨(안내·공지·공항)은 그 카탈로그에서 오고, DB 에는 이 코드만 들어간다.
 */
export const NOTICE_CATEGORIES = ["info", "notice", "airport"] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

const CATEGORY_SET: ReadonlySet<string> = new Set(NOTICE_CATEGORIES);

/** 코드 집합에 있는가 — 대소문자·공백을 관대하게 보지 않는다(코드는 canonical 그대로). */
export function isNoticeCategory(value: string): value is NoticeCategory {
  return CATEGORY_SET.has(value);
}

export interface NoticeValues {
  title: string;
  body: string;
  category: NoticeCategory;
  /** KST 달력 날짜 "YYYY-MM-DD". */
  publishedAt: string;
  active: boolean;
}

export const NoticeInput = z
  .object({
    title: z.string().trim().min(1).max(NOTICE_TITLE_MAX),
    body: z.string().trim().min(1).max(NOTICE_BODY_MAX),
    category: z.string(),
    publishedAt: z.string().trim(),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!isNoticeCategory(v.category)) {
      ctx.addIssue({ code: "custom", path: ["category"], message: "category must be one of the canonical notice codes" });
    }
    if (!isKstDateString(v.publishedAt)) {
      ctx.addIssue({ code: "custom", path: ["publishedAt"], message: "publishedAt must be an existing YYYY-MM-DD date" });
    }
  });

/** 화면이 문구 키로 쓰는 결과 어휘 — messages/ko.json `admin.notices.result.*`. */
export type NoticeActionCode =
  | "created"
  | "updated"
  | "deleted"
  | "activated"
  | "deactivated"
  | "notFound"
  | "validation"
  | "failed"
  /** 저장하지 않았다 — 확인이 필요한 표현이 있다(P6-12 · lib/admin/copyWarning.ts). 오류가 아니다. */
  | "copyWarning";

export interface NoticeActionResult {
  /** 사장님에게 빨간 오류를 보일 것인가. */
  ok: boolean;
  /** DB 가 실제로 바뀌었는가. 캐시 무효화는 이것이 true 일 때만. */
  changed: boolean;
  code: NoticeActionCode;
  /** 어느 입력을 고쳐야 하는지 표시만 한다(문구는 화면 몫). */
  fieldErrors?: Partial<Record<NoticeField, true>>;
  /** code 가 copyWarning 일 때만 — 걸린 표현 목록. */
  copyWarnings?: CopyWarning[];
}

export const NOTICE_FAILED: NoticeActionResult = { ok: false, changed: false, code: "failed" };
export const NOTICE_NOT_FOUND: NoticeActionResult = { ok: false, changed: false, code: "notFound" };

/** 성공 결과 — changed 는 언제나 true 다(바뀐 것이 없으면 notFound 로 끝난다). */
export const noticeChanged = (code: NoticeActionCode): NoticeActionResult => ({ ok: true, changed: true, code });

export function noticeValidationFailed(fieldErrors: Partial<Record<NoticeField, true>>): NoticeActionResult {
  return { ok: false, changed: false, code: "validation", fieldErrors };
}

/** 체크박스는 켜져 있을 때만 값이 온다. 켜짐으로 보는 값은 브라우저가 보내는 "on" 과 명시적인 true/1 뿐이다. */
function isChecked(raw: FormDataEntryValue | null): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

const text = (raw: FormDataEntryValue | null): string => (typeof raw === "string" ? raw : "");

export type ParsedNoticeForm = { ok: true; value: NoticeValues } | { ok: false; result: NoticeActionResult };

/** FormData → 값. 실패는 필드별 표시가 붙은 결과로 돌려준다(예외를 던지지 않는다). */
export function parseNoticeForm(formData: FormData): ParsedNoticeForm {
  const parsed = NoticeInput.safeParse({
    title: text(formData.get(NOTICE_FIELDS.title)),
    // 본문은 trim 뒤 그대로 — 줄바꿈이 문단 구분이다(P6-3 splitParagraphs).
    body: text(formData.get(NOTICE_FIELDS.body)),
    category: text(formData.get(NOTICE_FIELDS.category)),
    publishedAt: text(formData.get(NOTICE_FIELDS.publishedAt)),
    active: isChecked(formData.get(NOTICE_FIELDS.active)),
  });

  if (!parsed.success) {
    const fieldErrors: Partial<Record<NoticeField, true>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && field in NOTICE_FIELDS) fieldErrors[field as NoticeField] = true;
    }
    return { ok: false, result: noticeValidationFailed(fieldErrors) };
  }
  return { ok: true, value: { ...parsed.data, category: parsed.data.category as NoticeCategory } };
}

/**
 * 경로·폼으로 들어온 id → 양의 정수. 아니면 null(DB 를 부르지 않는다).
 *
 * 판정 규칙은 공개 상세(lib/queries/notices.ts `parseNoticeId`)와 **같아야 한다** — 관리자 목록의 링크와
 * 방문자가 받은 URL 이 같은 id 공간을 가리키기 때문이다. 그 파일을 import 하지 않는 이유는 하나뿐이다:
 * 그쪽은 `@supabase/supabase-js` 를 끌고 오고, 이 모듈은 클라이언트 폼이 import 하는 순수 모듈이어야 한다.
 * 대신 tests/admin-notices.test.ts 가 두 함수의 답을 표로 대조해 어긋남을 막는다.
 * (notices.id 는 serial = int4 이므로 상한은 2147483647 이다.)
 */
const NOTICE_ID_PATTERN = /^[1-9]\d{0,9}$/;
const INT4_MAX = 2147483647;

export function parseAdminNoticeId(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw >= 1 && raw <= INT4_MAX ? raw : null;
  if (typeof raw !== "string" || !NOTICE_ID_PATTERN.test(raw)) return null;
  const n = Number(raw);
  return n <= INT4_MAX ? n : null;
}

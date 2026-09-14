"use server";
/**
 * 관리자 공지 서버액션 — 얇은 래퍼 (플랜 v4 P5-5 · ADR-3·ADR-4).
 *
 * 순서: requireAdmin() → zod → DB 한 번 → 바뀌었으면 무효화. **로직 0** —
 * 입력 검증은 lib/admin/noticeInput.ts(순수)에서, 쿼리는 lib/admin/notices.ts(세션 클라이언트 + RLS)에서 테스트된다.
 *
 * 경계 규칙 (actions/admin/popup.ts 와 같은 규약)
 *   - export 는 async 함수 4개뿐이다(ADR-3 — 'use server' 파일의 export 는 전부 공개 POST 엔드포인트가 된다).
 *     **네 함수 모두 본문 첫 문장이 `await requireAdmin();`** 이다. 화면의 게이트를 믿지 않는다 —
 *     scripts/check-admin-gate.mjs 가 이 규약을 구조로 강제한다(조건·try/catch·앞선 early return 전부 위반).
 *   - 게이트는 별칭 없이 정본 이름 그대로 가져온다. 다른 함수를 게이트의 이름에 끼워 넣는 별칭 import 는
 *     글자만 게이트인 채 인증을 지운다(P5-4 독립 리뷰 M2) — 게이트가 그것을 거부하고 테스트도 다시 확인한다.
 *   - 서비스 롤을 쓰지 않는다(ADR-2). 0009 의 `notices_admin_all` 정책이 DB 에서 한 번 더 막는다 —
 *     명단 밖 세션은 insert 가 오류가 되고 update·delete 는 0행이 된다.
 *   - 예외는 여기서 끝난다. 서버액션이 throw 하면 Next 가 500 과 다이제스트만 내고 사장님 화면은 아무 말도 못 한다.
 *     단 requireAdmin() 의 redirect 는 throw 로 전파돼야 한다(그것이 리다이렉트의 구현이다) — 그래서 게이트는 try 밖에 있다.
 *   - 로그에 남기는 것은 공지 id 와 결과 코드뿐이다. 제목·본문은 싣지 않는다.
 *   - **바뀐 것이 없으면 무효화하지 않는다.** 캐시 무효화는 실제 변경의 결과여야 한다.
 */
import { revalidatePath } from "next/cache";

import {
  NOTICE_FAILED,
  NOTICE_FIELDS,
  NOTICE_NOT_FOUND,
  noticeChanged,
  noticeValidationFailed,
  parseAdminNoticeId,
  parseNoticeForm,
  type NoticeActionCode,
  type NoticeActionResult,
} from "@/lib/admin/noticeInput";
import { ADMIN_NOTICES_PATH, deleteNoticeRow, insertNotice, setNoticeActive, updateNoticeRow } from "@/lib/admin/notices";
import { PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE } from "@/lib/admin/publicRevalidate";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { runAfter } from "@/lib/ports/after";
import { revalidate } from "@/lib/ports/revalidate";
import { QUERY_TAGS } from "@/lib/queries/tags";

/** 이 파일이 남기는 로그의 전부. 필드를 늘리기 전에 그것이 운영 문구가 아닌지 먼저 확인할 것. */
interface AdminNoticeLogEntry extends StructuredLogEntry {
  /** 공지 id. 새로 만드는 중이면 null. */
  id: number | null;
  outcome: NoticeActionCode;
}

type NoticeAction = "create" | "update" | "delete" | "toggle";

const EVENT: Record<NoticeAction, string> = {
  create: "admin.notice.create",
  update: "admin.notice.update",
  delete: "admin.notice.delete",
  toggle: "admin.notice.toggle",
};

function report(action: NoticeAction, id: number | null, result: NoticeActionResult): NoticeActionResult {
  const entry: AdminNoticeLogEntry = {
    level: result.ok ? "info" : "error",
    event: EVENT[action],
    id,
    outcome: result.code,
  };
  structuredLog(entry);
  return result;
}

/**
 * 쓰기 한 번 → 결과 매핑 → 바뀌었으면 무효화.
 * `changed === false` 의 뜻이 갈린다: 기존 행을 고치던 중이면 "그런 행이 없다"(notFound), 새로 만드는 중이면 실패다.
 * 둘 다 정책에 막힌 경우를 포함한다 — 관리자가 아닌 세션에는 행이 보이지 않기 때문이다.
 */
async function apply(action: NoticeAction, id: number | null, code: NoticeActionCode, write: () => Promise<boolean>): Promise<NoticeActionResult> {
  let changed: boolean;
  try {
    changed = await write();
  } catch {
    return report(action, id, NOTICE_FAILED);
  }
  if (!changed) return report(action, id, id === null ? NOTICE_FAILED : NOTICE_NOT_FOUND);

  runAfter(() => {
    // 공개 화면(홈·/notices)을 실제로 새로 그리게 하는 것은 **이 한 줄뿐**이다 — 근거·실측표는 lib/admin/publicRevalidate.ts.
    revalidatePath(PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE);
    // 아래 태그는 지금 소비자가 없다(공개 읽기가 unstable_cache 로 감싸여 있지 않다). 누가 감싸는 날을 위한 배선이지 반영 수단이 아니다.
    revalidate(QUERY_TAGS.notices);
    revalidatePath(ADMIN_NOTICES_PATH);
  });
  return report(action, id, noticeChanged(code));
}

/** 새 공지. 카테고리 코드·게시일 형식이 맞지 않으면 DB 를 부르지 않는다. */
export async function createNotice(formData: FormData): Promise<NoticeActionResult> {
  await requireAdmin();
  const parsed = parseNoticeForm(formData);
  if (!parsed.ok) return report("create", null, parsed.result);
  return apply("create", null, "created", () => insertNotice(parsed.value));
}

/** 기존 공지 덮어쓰기. id 는 폼의 숨은 필드로 온다 — 없거나 형식이 틀리면 검증 실패다. */
export async function updateNotice(formData: FormData): Promise<NoticeActionResult> {
  await requireAdmin();
  const id = parseAdminNoticeId(formData.get(NOTICE_FIELDS.id));
  if (id === null) return report("update", null, noticeValidationFailed({ id: true }));
  const parsed = parseNoticeForm(formData);
  if (!parsed.ok) return report("update", id, parsed.result);
  return apply("update", id, "updated", () => updateNoticeRow(id, parsed.value));
}

/**
 * 삭제 — 되돌릴 수 없다. 공개 상세 URL(/notices/{id})이 문자로 나갔을 수 있고 serial id 는 재사용되지 않으므로,
 * 지우면 그 링크는 영구히 죽는다. 감추는 것으로 충분하면 toggleNoticeActive 를 쓴다(같은 id·같은 URL 로 되살아난다).
 * 화면은 이 액션에 닿기 전에 두 단계를 요구한다(components/admin/NoticeForm.tsx).
 */
export async function deleteNotice(id: number): Promise<NoticeActionResult> {
  await requireAdmin();
  const noticeId = parseAdminNoticeId(id);
  if (noticeId === null) return report("delete", null, noticeValidationFailed({ id: true }));
  return apply("delete", noticeId, "deleted", () => deleteNoticeRow(noticeId));
}

/** 목록에서 한 번에 내리고 올리기. 나머지 컬럼은 건드리지 않는다 — 공지를 다루는 기본 도구다. */
export async function toggleNoticeActive(id: number, active: boolean): Promise<NoticeActionResult> {
  await requireAdmin();
  const noticeId = parseAdminNoticeId(id);
  if (noticeId === null) return report("toggle", null, noticeValidationFailed({ id: true }));
  return apply("toggle", noticeId, active ? "activated" : "deactivated", () => setNoticeActive(noticeId, active));
}

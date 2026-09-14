"use server";
/**
 * 관리자 팝업 서버액션 — 얇은 래퍼 (플랜 v4 P5-4 · ADR-3·ADR-4).
 *
 * 순서: requireAdmin() → zod → DB 한 번 → 바뀌었으면 무효화. **로직 0** —
 * 입력 검증은 lib/admin/popupInput.ts(순수)에서, 쿼리는 lib/admin/popups.ts(세션 클라이언트 + RLS)에서 테스트된다.
 *
 * 경계 규칙
 *   - export 는 async 함수 4개뿐이다(ADR-3 — 'use server' 파일의 export 는 전부 공개 POST 엔드포인트가 된다).
 *     **네 함수 모두 본문 첫 문장이 `await requireAdmin();`** 이다. 화면의 게이트를 믿지 않는다 —
 *     scripts/check-admin-gate.sh 가 이 규약을 구조로 강제한다(조건·try/catch·앞선 early return 전부 위반).
 *   - 서비스 롤을 쓰지 않는다(ADR-2). 0009 의 `popups_admin_all` 정책이 DB 에서 한 번 더 막는다 —
 *     명단 밖 세션은 insert 가 오류가 되고 update·delete 는 0행이 된다.
 *   - 예외는 여기서 끝난다. 서버액션이 throw 하면 Next 가 500 과 다이제스트만 내고 사장님 화면은 아무 말도 못 한다.
 *     단 requireAdmin() 의 redirect 는 throw 로 전파돼야 한다(그것이 리다이렉트의 구현이다) — 그래서 게이트는 try 밖에 있다.
 *   - 로그에 남기는 것은 팝업 id 와 결과 코드뿐이다. 제목·본문은 싣지 않는다(운영 문구가 로그로 새 나갈 이유가 없다).
 *   - **바뀐 것이 없으면 무효화하지 않는다.** 캐시 무효화는 실제 변경의 결과여야 한다.
 */
import { revalidatePath } from "next/cache";

import {
  POPUP_FAILED,
  POPUP_FIELDS,
  POPUP_NOT_FOUND,
  parsePopupForm,
  parsePopupId,
  popupChanged,
  popupValidationFailed,
  type PopupActionCode,
  type PopupActionResult,
} from "@/lib/admin/popupInput";
import { ADMIN_POPUPS_PATH, deletePopupRow, insertPopup, setPopupActive, updatePopupRow } from "@/lib/admin/popups";
import { PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE } from "@/lib/admin/publicRevalidate";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { runAfter } from "@/lib/ports/after";
import { revalidate } from "@/lib/ports/revalidate";
import { QUERY_TAGS } from "@/lib/queries/tags";

/** 이 파일이 남기는 로그의 전부. 필드를 늘리기 전에 그것이 운영 문구가 아닌지 먼저 확인할 것. */
interface AdminPopupLogEntry extends StructuredLogEntry {
  /** 팝업 id. 새로 만드는 중이면 null. */
  id: number | null;
  outcome: PopupActionCode;
}

type PopupAction = "create" | "update" | "delete" | "toggle";

const EVENT: Record<PopupAction, string> = {
  create: "admin.popup.create",
  update: "admin.popup.update",
  delete: "admin.popup.delete",
  toggle: "admin.popup.toggle",
};

function report(action: PopupAction, id: number | null, result: PopupActionResult): PopupActionResult {
  const entry: AdminPopupLogEntry = {
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
async function apply(action: PopupAction, id: number | null, code: PopupActionCode, write: () => Promise<boolean>): Promise<PopupActionResult> {
  let changed: boolean;
  try {
    changed = await write();
  } catch {
    return report(action, id, POPUP_FAILED);
  }
  if (!changed) return report(action, id, id === null ? POPUP_FAILED : POPUP_NOT_FOUND);

  runAfter(() => {
    // 공개 홈에 팝업을 실제로 반영하는 것은 **이 한 줄뿐**이다 — 근거·실측표는 lib/admin/publicRevalidate.ts.
    revalidatePath(PUBLIC_CACHE_PATH, PUBLIC_CACHE_SCOPE);
    // 아래 태그는 지금 소비자가 없다(공개 읽기가 unstable_cache 로 감싸여 있지 않다). 누가 감싸는 날을 위한 배선이지 반영 수단이 아니다.
    revalidate(QUERY_TAGS.popups);
    revalidatePath(ADMIN_POPUPS_PATH);
  });
  return report(action, id, popupChanged(code));
}

/** 새 팝업. 기간·이미지 경로가 형식에 맞지 않으면 DB 를 부르지 않는다. */
export async function createPopup(formData: FormData): Promise<PopupActionResult> {
  await requireAdmin();
  const parsed = parsePopupForm(formData);
  if (!parsed.ok) return report("create", null, parsed.result);
  return apply("create", null, "created", () => insertPopup(parsed.value));
}

/** 기존 팝업 덮어쓰기. id 는 폼의 숨은 필드로 온다 — 없거나 형식이 틀리면 검증 실패다. */
export async function updatePopup(formData: FormData): Promise<PopupActionResult> {
  await requireAdmin();
  const id = parsePopupId(formData.get(POPUP_FIELDS.id));
  if (id === null) return report("update", null, popupValidationFailed({ id: true }));
  const parsed = parsePopupForm(formData);
  if (!parsed.ok) return report("update", id, parsed.result);
  return apply("update", id, "updated", () => updatePopupRow(id, parsed.value));
}

/** 삭제. 되돌릴 수 없으므로 화면이 한 번 더 묻는다(components/admin/PopupForm.tsx). */
export async function deletePopup(id: number): Promise<PopupActionResult> {
  await requireAdmin();
  const popupId = parsePopupId(id);
  if (popupId === null) return report("delete", null, popupValidationFailed({ id: true }));
  return apply("delete", popupId, "deleted", () => deletePopupRow(popupId));
}

/** 목록에서 한 번에 내리고 올리기. 나머지 컬럼은 건드리지 않는다. */
export async function togglePopupActive(id: number, active: boolean): Promise<PopupActionResult> {
  await requireAdmin();
  const popupId = parsePopupId(id);
  if (popupId === null) return report("toggle", null, popupValidationFailed({ id: true }));
  return apply("toggle", popupId, active ? "activated" : "deactivated", () => setPopupActive(popupId, active));
}

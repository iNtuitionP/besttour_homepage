import { expect } from "vitest";

/**
 * 거부 판정 헬퍼 — **"400 이상이면 통과" 를 대신한다** (P4-5 리뷰 K3 · P5-13 · P6-13).
 *
 * `expect(status).toBeGreaterThanOrEqual(400)` 은 500(서버가 고장 났다) · 400(입력 검증에서 걸렸다) ·
 * 404(표·함수·버킷 이름을 잘못 썼다) · 409(중복)까지 "보안 성공" 으로 읽는다. 어느 것도 **"거부됐다"** 를 증명하지 않는다.
 * 이 파일은 응답의 **성격별로** 판정을 나눈다 — 섞어 쓰면 테스트의 뜻이 바뀐다:
 *
 *   PostgREST(`/rest/v1`) — PostgreSQL SQLSTATE `42501` 이 곧 거부다. 상태는 anon 401 · 로그인 세션 403.
 *     · `expectPermissionDenied`        — 401/403 + 42501. 무엇이 막았는지는 묻지 않는다(P5-13 원형, 판정 로직 불변).
 *     · `expectTablePrivilegeDenied`    — + 메시지 `permission denied for table <표>` = **GRANT 층**이 막았다.
 *     · `expectFunctionPrivilegeDenied` — + 메시지 `permission denied for function <함수>` = **EXECUTE** 가 없다.
 *     · `expectRlsInsertDenied`         — + 메시지 `new row violates row-level security policy for table "<표>"` = **정책(with check)** 이 막았다.
 *     · `expectRaisedDenied`            — + 함수가 `raise … using errcode = '42501'` 로 던진 **그 메시지** = definer 함수의 **자기 가드**가 막았다.
 *   Storage(`/storage/v1`) — PostgREST 가 아니다. SQLSTATE 를 주지 않고 본문이 `{ statusCode, error, code, message }` 다.
 *     · `expectStorageDenied`           — 본문 statusCode "403" + code `AccessDenied`.
 *     · `expectStorageNotFound`         — 본문 statusCode "404" + code `NoSuchKey`/`NoSuchBucket`. Storage 는 **읽기 거부를 "없음" 으로 숨긴다**
 *       (RLS 가 행을 가리면 객체가 없는 것과 같고, 공개 라우트는 비공개 버킷을 "없는 버킷" 이라 답한다). 이 판정만으로는
 *       부재와 거부가 **구분되지 않으므로**, 부르는 쪽이 같은 키가 실제로 있다는 대조(관리자 200 등)를 **같은 테스트에** 둬야 한다.
 *
 * 로컬 스택(storage-api)은 오류를 **HTTP 400** 으로 싸서 보내고 진짜 상태를 본문 `statusCode`(문자열)에 싣는다
 * (2026-09-17 실측 — P6-13 보고서 ②). 그래서 Storage 판정은 본문을 기준으로 삼고, HTTP 상태는 그 포장(400) 또는
 * 포장을 벗긴 판(본문과 같은 값)만 허용한다. 어느 쪽이든 5xx 는 통과하지 못한다.
 *
 * **제자리 재정의 금지** — 이 판정들을 테스트 파일 안에 다시 쓰지 않는다(tests/expect-denied.test.ts 가 강제한다).
 * `stripComments`(P6-7·P6-8)와 DB 잠금(P5-10)에 세운 것과 같은 규약이다.
 */
export interface HttpResult {
  status: number;
  body: unknown;
}

const shown = (res: HttpResult) => JSON.stringify(res.body)?.slice(0, 300);

/**
 * **권한 거부를 명시적으로** 단언한다 — PostgREST 의 **상태코드**(401 또는 403)와 PostgreSQL 의
 * **SQLSTATE `42501`**(insufficient_privilege)를 함께 요구한다. (tests/write-privileges.test.ts 에서 옮겼다 · 판정 불변)
 */
export function expectPermissionDenied(res: HttpResult, what: string): void {
  const body = res.body as { code?: string } | null;
  expect([401, 403], `${what}: 권한 거부가 아니다 (status=${res.status} body=${shown(res)})`).toContain(res.status);
  expect(body?.code, `${what}: PostgreSQL 권한 거부 코드(42501)가 아니다 (status=${res.status} body=${shown(res)})`).toBe("42501");
}

function pgMessage(res: HttpResult): unknown {
  return (res.body as { message?: unknown } | null)?.message;
}

/** GRANT 층의 거부 — 표 권한이 없다. RLS 정책의 거부(`expectRlsInsertDenied`)와 메시지로 갈린다. */
export function expectTablePrivilegeDenied(res: HttpResult, table: string, what: string): void {
  expectPermissionDenied(res, what);
  expect(pgMessage(res), `${what}: 표 권한(GRANT) 거부가 아니다 (status=${res.status} body=${shown(res)})`).toBe(
    `permission denied for table ${table}`,
  );
}

/** EXECUTE 가 없는 함수 호출 — 함수 본문은 한 줄도 돌지 않았다. */
export function expectFunctionPrivilegeDenied(res: HttpResult, fn: string, what: string): void {
  expectPermissionDenied(res, what);
  expect(pgMessage(res), `${what}: 함수 실행 권한(EXECUTE) 거부가 아니다 (status=${res.status} body=${shown(res)})`).toBe(
    `permission denied for function ${fn}`,
  );
}

/** RLS `with check` 위반 — 권한은 있고 **정책**이 새 행을 막았다. PostgreSQL 은 이것도 42501 로 보고한다. */
export function expectRlsInsertDenied(res: HttpResult, table: string, what: string): void {
  expectPermissionDenied(res, what);
  expect(pgMessage(res), `${what}: RLS 정책(with check) 거부가 아니다 (status=${res.status} body=${shown(res)})`).toBe(
    `new row violates row-level security policy for table "${table}"`,
  );
}

/**
 * security definer 함수의 **자기 가드**가 던진 거부 — `raise exception '<message>' using errcode = '42501'`.
 * 메시지까지 맞춰야 "EXECUTE 는 있었고, 함수가 스스로 막았다" 가 증명된다(EXECUTE 거부와 같은 42501 이라 코드만으로는 못 가른다).
 */
export function expectRaisedDenied(res: HttpResult, message: string, what: string): void {
  expectPermissionDenied(res, what);
  expect(pgMessage(res), `${what}: 함수의 관리자 가드가 던진 거부가 아니다 (status=${res.status} body=${shown(res)})`).toBe(message);
}

interface StorageErrorBody {
  statusCode?: unknown;
  error?: unknown;
  code?: unknown;
  message?: unknown;
}

function expectStorageError(res: HttpResult, statusCode: "403" | "404", codes: readonly string[], what: string, kind: string): void {
  const body = (typeof res.body === "object" ? res.body : null) as StorageErrorBody | null;
  expect([400, Number(statusCode)], `${what}: Storage ${kind} 응답의 HTTP 상태가 아니다 (status=${res.status} body=${shown(res)})`).toContain(
    res.status,
  );
  expect(String(body?.statusCode), `${what}: Storage ${kind} 가 아니다 — 본문 statusCode (status=${res.status} body=${shown(res)})`).toBe(statusCode);
  expect(codes, `${what}: Storage ${kind} 코드가 아니다 (status=${res.status} body=${shown(res)})`).toContain(body?.code);
}

/**
 * Storage 의 **쓰기·지우기 거부** — 본문 `statusCode: "403"` · `code: "AccessDenied"`.
 * 메시지는 동작마다 다르다(올리기·덮어쓰기 = `new row violates row-level security policy` · 지우기 = `Access denied`) —
 * 넘기면 그것까지 맞춘다.
 */
export function expectStorageDenied(res: HttpResult, what: string, message?: string): void {
  expectStorageError(res, "403", ["AccessDenied"], what, "거부(403 AccessDenied)");
  if (message !== undefined) {
    expect((res.body as StorageErrorBody).message, `${what}: Storage 거부 메시지가 다르다 (body=${shown(res)})`).toBe(message);
  }
}

/** Storage RLS 가 올리기·덮어쓰기를 막을 때의 메시지 (storage.objects 의 insert/update 정책). */
export const STORAGE_RLS_MESSAGE = "new row violates row-level security policy";
/** Storage 가 지우기를 막을 때의 메시지 (지울 행이 정책에 가려 0행). */
export const STORAGE_DELETE_DENIED_MESSAGE = "Access denied";

/**
 * Storage 의 **"없음"** — 본문 `statusCode: "404"` + `NoSuchKey`(객체) 또는 `NoSuchBucket`(버킷).
 * 읽기 거부가 이 모양으로 온다(위 머리 주석). **이 판정 하나로는 거부를 증명하지 못한다** — 같은 테스트에
 * "같은 키를 권한 있는 쪽은 200 으로 읽는다" 는 대조를 반드시 둔다.
 */
export function expectStorageNotFound(res: HttpResult, code: "NoSuchKey" | "NoSuchBucket", what: string): void {
  expectStorageError(res, "404", [code], what, `없음(404 ${code})`);
}

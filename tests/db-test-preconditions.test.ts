import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { dbSmokeEnv, dbWriteGate, isLocalStackUrl, loadDotEnvLocal } from "./helpers/load-env-local";
import { stripComments } from "./helpers/strip-comments";

/**
 * DB 테스트 전제 — REQUIRE_DB_TESTS=1 이면 "조용한 skip" 은 실패다 (P3-3 독립 리뷰 N5, 2026-09-13).
 *
 * 여덟 파일(consent·kst-dates·outbox·purge·reservation-action.e2e·outbox-reaper·gallery-albums·write-privileges)이 `describe.skipIf(!gate.allowed || !env.hasServiceRole)` 로
 * DB 실증 블록을 가둔다(새 DB 실증 파일이 생기면 이 목록도 갱신 — 규약 문서용, 테스트는 파일 목록에 의존하지 않는다). 가드는 URL 과 REQUIRE_DB_TESTS 만 보고, 서비스 롤 키 부재는 skipIf 의 두 번째 조건이 **조용히** 삼킨다.
 * CI db-test 잡에서 status export 한 줄이 빠지면 그 블록이 전부 skip 인 채 green 이 된다 — P2-1 때 anon 키로 실제 일어났던 일이다.
 * 이 파일은 그 잡에서만(REQUIRE_DB_TESTS=1) 켜져 "접속 정보가 전부 있고 가드가 열렸다" 를 단언한다. tests/home.test.ts:278 의 anon 선례와 같은 취지.
 * 로컬(.env.local 이 원격을 가리킴)에서는 첫 테스트가 skip 이다 — 그것이 정답이다(원격에는 쓰지 않는다).
 */
loadDotEnvLocal();
const required = process.env.REQUIRE_DB_TESTS === "1";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

describe("DB 테스트 전제 (REQUIRE_DB_TESTS=1 일 때만)", () => {
  test.skipIf(!required)("접속 정보가 전부 있고 dbWriteGate 가 열려 있다 — 하나라도 비면 skip 이 아니라 실패", () => {
    expect(isLocalStackUrl(url), `NEXT_PUBLIC_SUPABASE_URL 이 로컬 스택이 아니다: ${url ?? "(없음)"}`).toBe(true);
    const env = dbSmokeEnv();
    expect(env.hasServiceRole, "SUPABASE_SERVICE_ROLE_KEY 가 비어 있다 — db-test 의 status export 를 확인").toBe(true);
    expect(Boolean(env.anonKey), "NEXT_PUBLIC_SUPABASE_ANON_KEY 가 비어 있다 — db-test 의 status export 를 확인").toBe(true);
    const gate = dbWriteGate();
    expect(gate.allowed, gate.reason).toBe(true);
  });
});

describe("dbWriteGate — 순수 판정", () => {
  test("로컬 URL + REQUIRE_DB_TESTS=1 → 열림", () => {
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", REQUIRE_DB_TESTS: "1" }).allowed).toBe(true);
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", REQUIRE_DB_TESTS: "1" }).allowed).toBe(true);
  });

  test("원격 URL 은 REQUIRE_DB_TESTS=1 이어도 닫힘 · 로컬이어도 플래그 없으면 닫힘 · URL 없음도 닫힘", () => {
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", REQUIRE_DB_TESTS: "1" }).allowed).toBe(false);
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }).allowed).toBe(false);
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", REQUIRE_DB_TESTS: "true" }).allowed).toBe(false);
    expect(dbWriteGate({ REQUIRE_DB_TESTS: "1" }).allowed).toBe(false);
  });

  test("닫힌 이유가 항상 문자열로 온다 (skip 로그가 이유를 찍는다)", () => {
    for (const env of [
      { NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", REQUIRE_DB_TESTS: "1" },
      { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
    ]) {
      const gate = dbWriteGate(env);
      expect(gate.allowed).toBe(false);
      expect(gate.reason.length).toBeGreaterThan(10);
    }
  });
});

// =============================================================================
// 통지 아웃박스 잠금의 **완전성** (P5-10)
// =============================================================================
/**
 * 뿌리: 0005 `claim_pending_notifications(p_limit)` 의 where 절은
 * `status = 'pending' and next_attempt_at <= now() and attempts < 5` 뿐이다 — 소유자·예약·채널 조건이 없다.
 * 0007 `reap_stale_notifications()` 도 같다(`attempts >= 5`). 둘 다 **표 전체**를 훑는 것이 설계다
 * (운영 발송기는 예약 하나만 보고 도는 물건이 아니다). 그래서 다음 둘은 서로 배타적이어야 한다:
 *   (A) claim/reap 의 **결과 집합**을 단언하는 블록
 *   (B) claim 조건을 만족하는 행(=claimable pending)을 잠시라도 표에 남기는 블록
 * vitest 는 파일을 병렬로 돌리므로, 배타성이 없으면 결과가 스케줄링에 달라진다.
 *
 * 불변식: **(A)·(B) 에 해당하는 모든 블록은 machine-wide 뮤텍스(`withNotificationsLock()`) 안에서만 돈다.**
 * 잠금 자체는 tests/helpers/db-lock.ts 가 보장한다. 이 테스트가 보장하는 것은 그 불변식의 **완전성** —
 * 새 DB 실증 파일이 잠금을 빠뜨리면 "가끔 빨간불" 이 아니라 여기서 **매번** 빨간불이 난다.
 *
 * 탐지는 grep 휴리스틱이다(저장소의 다른 게이트와 같은 성격). 아웃박스에 닿는 새로운 경로가 생기면
 * OUTBOX_MARKERS 에 추가한다 — 마지막 단언이 마커가 낡아 아무 파일도 못 고르는 상황을 막는다.
 */
const TESTS_DIR = path.resolve(import.meta.dirname);
/**
 * 주석은 빼고 본다. 주석에 함수 이름을 설명해 둔 파일(예: "…와 `claim_pending_notifications` RPC 를 확인한다")을
 * 잠금 대상으로 오인하면, 실제로는 표를 건드리지도 않는 파일에 잠금을 강요하게 된다 — 2026-09-15 실측으로 한 번 겪었다.
 *
 * 제거는 **TypeScript 파서**가 한다(tests/helpers/strip-comments.ts). 여기 있던 정규식판은
 * 문자열 속 글로브 패턴의 별표 두 개를 블록 주석 시작으로 읽어 `tests/pages.test.ts` 의 182~470행(289줄)을
 * 스캔에서 지우고 있었다 — 그 구간에 DB 블록이 하나 생기는 순간 이 게이트가 조용히 통과한다(known-defects D7).
 * 파싱에 실패하면 헬퍼가 throw 한다(조용히 원문을 돌려주지 않는다).
 */
/** 모든 DB 실증 블록의 공통 형태 — 이것이 없으면 실 DB 를 건드리지 않는 파일이다(가짜 클라이언트·SQL 텍스트 단언). */
const DB_BLOCK_RE = /describe\.skipIf\(\s*!gate\.allowed/;
const OUTBOX_MARKERS: [label: string, re: RegExp][] = [
  // 인자가 줄바꿈으로 흩어진 호출(`rest(\n "POST",\n "/notifications_log",`)도 잡아야 한다 — \s 는 개행을 포함한다.
  ["notifications_log 직접 insert", /"POST",\s*["'`]?\/notifications_log/],
  ["admin_confirm_reservation — 확정이 통지를 큐에 넣는다(0010)", /admin_confirm_reservation/],
  ["submitReservation — 접수가 통지를 큐에 넣는다(P3-3)", /submitReservation\(/],
  ["claim/reap 호출", /claim_pending_notifications|reap_stale_notifications|\breapStale\(|\bclaimPending\(/],
];

describe("통지 아웃박스 잠금 — 완전성 게이트 (P5-10)", () => {
  // 이 파일 자신은 제외한다 — 게이트 본문에 마커 문자열이 그대로 적혀 있어 자기 자신을 탐지해 버린다(DB 는 건드리지 않는다).
  const SELF = path.basename(import.meta.filename);
  const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith(".test.ts") && f !== SELF);

  const needsLock = files
    .map((f) => {
      const raw = readFileSync(path.join(TESTS_DIR, f), "utf-8");
      return { file: f, raw, code: stripComments(raw, f) };
    })
    .filter(({ code }) => DB_BLOCK_RE.test(code))
    .map((f) => ({ ...f, hits: OUTBOX_MARKERS.filter(([, re]) => re.test(f.code)).map(([label]) => label) }))
    .filter(({ hits }) => hits.length > 0);

  test("claim/reap 의 사정권에 드는 DB 블록은 전부 withNotificationsLock() 을 쓴다", () => {
    const missing = needsLock
      .filter(({ code }) => !/withNotificationsLock\(\s*\)/.test(code))
      .map(({ file, hits }) => `${file} (${hits.join(", ")})`);
    expect(
      missing,
      "이 파일들의 DB 블록은 notifications_log 에 claimable 한 행을 남기거나 claim/reap 을 부른다 — " +
        "describe 본문 맨 위에서 `withNotificationsLock()` 을 부르고 `./helpers/db-lock` 에서 import 할 것 " +
        "(안 그러면 outbox·outbox-reaper 와 서로의 행을 집어가 간헐적으로 깨진다)",
    ).toEqual([]);
  });

  test("마커가 낡지 않았다 — 탐지가 아무 파일도 고르지 못하면 게이트가 의미를 잃는다", () => {
    expect(needsLock.length, `탐지된 파일: ${needsLock.map((n) => n.file).join(", ") || "(없음)"}`).toBeGreaterThanOrEqual(6);
  });

  test("잠금을 쓰는 파일은 helpers/db-lock 에서 가져온다 (제자리 정의 금지)", () => {
    for (const f of files) {
      const src = readFileSync(path.join(TESTS_DIR, f), "utf-8");
      if (!src.includes("withNotificationsLock")) continue;
      expect(src, f).toMatch(/import\s*\{[^}]*withNotificationsLock[^}]*\}\s*from\s*["']\.\/helpers\/db-lock["']/);
    }
  });
});

// =============================================================================
// 갤러리 표 잠금의 **완전성** (P6-3b — P5-10 이 관측하고 진단만 남긴 경합)
// =============================================================================
/**
 * 뿌리: 0008 `gallery_select_active` 는
 * `active and (album_id is null or exists (select 1 from gallery_albums a where a.id = album_id and a.active))`
 * 로 **표 전체**에 걸리는 정책이고, 공개 읽기(`getGallery`·`getGalleryPage`·`getAlbums`)에는 소유자 조건이 없다.
 * 접두사로 자기 행만 고르는 블록끼리는 부딪히지 않지만, 다음 둘은 서로 배타적이어야 한다:
 *   (A) `gallery`·`gallery_albums` **표 전체의 결과 집합**(행 수·순서·일치)을 단언하는 블록
 *   (B) 그 두 표에 행을 잠시라도 남기는 블록
 * 실측 형태: tests/home.test.ts 의 4-DB 블록은 `getGallery(100)` 의 id 배열이 직접 anon REST 조회와 **같은지**를
 * 단언한다 — 그 두 조회 사이에 다른 파일이 사진 한 장을 넣거나 지우면 어긋난다.
 *
 * 불변식: **(A)·(B) 에 해당하는 모든 블록은 `withGalleryLock()` 안에서만 돈다.**
 *
 * 탐지가 아웃박스 게이트와 다른 점 하나: DB 블록의 형태가 `describe.skipIf(!gate.allowed …)` 하나가 아니다.
 * home.test.ts 는 서비스 롤 없이 anon 으로만 읽으므로 `describe.skipIf(!hasAnon)` 를 쓴다 — 그것까지 봐야
 * 정작 제일 잘 깨지는 파일이 탐지에서 빠지지 않는다(P5-10 이 이 파일을 진단만 남긴 이유이기도 하다).
 */
const GALLERY_DB_BLOCK_RE = /describe\.skipIf\(\s*!(gate\.allowed|hasAnon)\b/;
const GALLERY_MARKERS: [label: string, re: RegExp][] = [
  // REST 경로로 두 표를 직접 만진다. `"/gallery"` `"/gallery?…"` `` `/gallery_albums?…` `` 를 잡고,
  // 화면 경로(`"/gallery/does-not-exist"`)나 저장 경로(`"gallery/a.jpg"`)는 잡지 않는다(뒤따르는 문자가 다르다).
  ["gallery · gallery_albums REST 경로", /["'`]\/gallery(_albums)?[?"'`]/],
  // 공개 읽기 계층을 실 DB 클라이언트로 부른다(= 표 전체를 본다).
  ["공개 읽기 호출", /\bgetGallery\(|\bgetGalleryPage\(|\bgetAlbums\(|\bgetAlbumBySlug\(/],
];

describe("갤러리 표 잠금 — 완전성 게이트 (P6-3b)", () => {
  const SELF = path.basename(import.meta.filename);
  const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith(".test.ts") && f !== SELF);

  const needsLock = files
    .map((f) => ({ file: f, raw: readFileSync(path.join(TESTS_DIR, f), "utf-8") }))
    .map((f) => ({ ...f, code: stripComments(f.raw, f.file) }))
    .filter(({ code }) => GALLERY_DB_BLOCK_RE.test(code))
    .map((f) => ({ ...f, hits: GALLERY_MARKERS.filter(([, re]) => re.test(f.code)).map(([label]) => label) }))
    .filter(({ hits }) => hits.length > 0);

  test("gallery · gallery_albums 를 만지는 DB 블록은 전부 withGalleryLock() 을 쓴다", () => {
    const missing = needsLock
      .filter(({ code }) => !/withGalleryLock\(\s*\)/.test(code))
      .map(({ file, hits }) => `${file} (${hits.join(", ")})`);
    expect(
      missing,
      "이 파일들의 DB 블록은 gallery · gallery_albums 에 행을 남기거나 표 전체를 단언한다 — " +
        "describe 본문 맨 위에서 `withGalleryLock()` 을 부르고 `./helpers/db-lock` 에서 import 할 것 " +
        "(안 그러면 home 의 getGallery 전수 대조와 서로의 사진을 집어가 간헐적으로 깨진다)",
    ).toEqual([]);
  });

  test("마커가 낡지 않았다 — 탐지가 아무 파일도 고르지 못하면 게이트가 의미를 잃는다", () => {
    expect(needsLock.length, `탐지된 파일: ${needsLock.map((n) => n.file).join(", ") || "(없음)"}`).toBeGreaterThanOrEqual(5);
  });

  test("anon 전용 DB 블록(home.test.ts 형태)도 탐지된다 — 이 경로가 빠지면 게이트가 가장 잘 깨지는 파일을 놓친다", () => {
    const anonOnly = needsLock.filter(({ code }) => /describe\.skipIf\(\s*!hasAnon\b/.test(code)).map((n) => n.file);
    expect(anonOnly, "`describe.skipIf(!hasAnon)` 형태의 갤러리 DB 블록을 하나도 못 찾았다").toContain("home.test.ts");
  });

  test("잠금을 쓰는 파일은 helpers/db-lock 에서 가져온다 (제자리 정의 금지)", () => {
    for (const f of files) {
      const src = readFileSync(path.join(TESTS_DIR, f), "utf-8");
      if (!src.includes("withGalleryLock")) continue;
      expect(src, f).toMatch(/import\s*\{[^}]*withGalleryLock[^}]*\}\s*from\s*["']\.\/helpers\/db-lock["']/);
    }
  });

  test("두 잠금을 다 쓰는 파일은 notifications → gallery 순서로 잡는다 (순환 대기 = 교착 방지)", () => {
    for (const f of files) {
      const code = stripComments(readFileSync(path.join(TESTS_DIR, f), "utf-8"), f);
      const n = code.indexOf("withNotificationsLock()");
      const g = code.indexOf("withGalleryLock()");
      if (n === -1 || g === -1) continue;
      expect(
        n,
        `${f} — 두 잠금을 다 쓰는 파일은 withNotificationsLock() 을 먼저 불러야 한다. ` +
          "모두가 같은 순서로 잡아야 순환 대기가 생기지 않는다(tests/helpers/db-lock.ts GALLERY_LOCK 주석).",
      ).toBeLessThan(g);
    }
  });
});

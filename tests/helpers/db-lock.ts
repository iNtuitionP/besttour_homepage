import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect } from "vitest";

/**
 * 테스트 파일 사이의 DB 상호배제 (P5-10).
 *
 * ## 뿌리와 불변식
 * 뿌리: 0005 `claim_pending_notifications(p_limit)` 의 where 절은
 * `status = 'pending' and next_attempt_at <= now() and attempts < 5` **뿐**이다 — 소유자·예약·채널 조건이 없다.
 * 0007 `reap_stale_notifications()` 도 같다(`attempts >= 5`). 표 전체를 훑는 것이 **설계**다: 운영 발송기는
 * 예약 하나만 보고 도는 물건이 아니다. 그러므로 다음 둘은 서로 배타적이어야 한다.
 *   (A) claim/reap 의 **결과 집합**을 단언하는 블록
 *   (B) claim 조건을 만족하는 행(claimable pending)을 잠시라도 `notifications_log` 에 남기는 블록
 *
 * **불변식: (A)·(B) 에 해당하는 블록은 이 머신에서 한 번에 하나만 돈다.**
 * 이 파일이 그 배타성을 만들고, tests/db-test-preconditions.test.ts 의 "완전성 게이트" 가
 * "그런 블록이 전부 이 잠금을 쓴다" 를 grep 으로 강제한다. 둘이 합쳐져야 불변식이 성립한다 —
 * 잠금만으로는 새 파일이 빠져나가고, 게이트만으로는 배타성이 없다.
 *
 * ## 잠금은 셋이다 (P6-3b · P6-13)
 * 같은 모양의 경합이 **갤러리 표**에도 있다(`GALLERY_LOCK` 주석 참고): 0008 정책이 표 전체에 걸리고
 * 공개 읽기에 소유자 조건이 없어서, 전체 결과 집합을 단언하는 블록이 남의 픽스처에 깨진다.
 * **대표 노선 표**도 같다(`SHOWCASE_ROUTES_LOCK` 주석 참고): 시드 행을 잠시 바꾸는 블록과 16행 전체를 대조하는 블록.
 * 세 잠금은 이름만 다르고 구현은 같다. **여럿을 쓰면 notifications → gallery → showcase-routes 순서로 부른다** —
 * 모두가 같은 순서로 잡아야 순환 대기(교착)가 생기지 않는다. 그 순서도 완전성 게이트가 강제한다.
 *
 * 성립 근거(스케줄링과 무관): 잠금은 `beforeAll` 에서 잡혀 `afterAll` 에서 풀리고, describe 본문 맨 위에서
 * 부르므로 vitest 의 기본 훅 순서상 **가장 먼저 잡히고 가장 나중에 풀린다**. 즉 블록이 만든 claimable 행이
 * 존재하는 구간 전체(정리까지)가 임계구역 안에 들어간다. 파일 수·실행 순서·워커 수와 무관하다.
 *
 * ## 왜 필요한가
 * vitest 는 파일을 병렬로 돌린다. 배타성이 없으면 (A)와 (B)가 겹쳐 서로의 픽스처를 집어가고,
 * 결과가 스케줄링에 따라 달라진다. 2026-09-15 실측(로컬 스택 + REQUIRE_DB_TESTS=1):
 *   - `vitest run tests/outbox.test.ts tests/outbox-reaper.test.ts` → 2 failed
 *     (reaper 의 `attempts=5 · lease 만료` 와 outbox 의 `claim 2회 연속`이 서로의 행을 먹었다)
 *   - 각 파일 단독 → 둘 다 통과
 * 간헐적 red 는 red 보다 나쁘다 — 다시 돌리면 되는 스위트는 아무도 믿지 않게 된다.
 *
 * ## 왜 파일 뮤텍스인가 (Postgres advisory lock 이 아니라)
 * 진짜 advisory lock 이 더 넓게 막는다(같은 로컬 DB 를 보는 다른 프로세스·다른 도구까지). 하지만 그 잠금은
 * **세션에 붙어** 있어야 하는데, 이 저장소에서 Postgres 에 닿는 두 채널 모두 세션을 들고 있지 못한다:
 *   - PostgREST — 요청 하나가 트랜잭션 하나다. `pg_advisory_lock()` 을 REST 로 걸어도 그 응답이 오기 전에 풀린다
 *     (`pg_advisory_xact_lock()` 은 애초에 트랜잭션 스코프다). 세션을 고정할 수단이 없다.
 *   - `supabase db query --local` (tests/helpers/local-stack-sql.ts) — 호출마다 프로세스·세션이 새로 뜨고 끝난다.
 * 세션을 붙들려면 pg 드라이버가 필요한데 저장소에 없고 새 의존성은 금지다(local-stack-sql.ts 주석과 같은 이유).
 * 한편 실제 경합의 범위는 "한 머신에서 도는 vitest 워커들"이다 — 머신 로컬 뮤텍스면 그 범위를 정확히 덮는다.
 * 잠금 디렉터리를 `tmpdir()` 에 두므로 같은 머신의 다른 체크아웃(= 같은 127.0.0.1:54321 을 보는)도 함께 직렬화된다.
 *
 * ## 왜 전체 직렬 실행(fileParallelism:false)이 아닌가
 * 파일 50개 중 DB 블록을 가진 것은 소수다. 전체를 직렬로 돌리면 나머지 전부가 세금을 문다.
 * 이 잠금은 `notifications_log` 를 만지는 describe 블록만 줄 세운다.
 *
 * ## 구현 — 획득은 `mkdir` 하나뿐이고, **남의 잠금은 절대 건드리지 않는다**
 * `mkdir` 은 원자적이다(이미 있으면 실패). 실패 코드는 POSIX 에서 EEXIST 하나지만 Windows 는 삭제가
 * 진행 중이면 EPERM/EACCES/EBUSY 도 준다 — 전부 "지금은 남이 쥐고 있다"로 읽는다(`CONTENDED_CODES`).
 *
 * **회수(stale steal)를 넣었다가 뺐다.** 처음에는 "소유자 pid 가 죽었으면 잠금을 치운다" 를 넣었는데,
 * 어떤 형태로 만들어도 파일시스템 원시연산만으로는 안전하게 만들 수 없었다(둘 다 실측):
 *   - `rmSync` 로 치우면 대기자 여럿이 **각자** 치우고 각자 만든다 → 넷이 동시에 잠금을 쥐었다고 믿었다.
 *   - 원자적 `rename` 으로 바꾸고 "살아 있는 소유자였으면 되돌린다" 를 붙여도, 되돌리는 사이 제3자가
 *     그 자리를 차지하면 되돌릴 곳이 없다 — 피해자는 자기가 쥐고 있다고 믿고 제3자도 쥐고 있다.
 *     trace 에 `stolen=0` 인 채 동시 보유 3이 찍혔다(되돌리기 경로는 stolen 을 올리지 않는다).
 *   - 근본 원인은 "판정(stat·owner 읽기)과 회수(rename·rm)가 원자적으로 묶이지 않는다"는 것이다.
 *     rename-if-token-matches 같은 원시연산이 없으므로 이 틈은 닫을 수 없다.
 * 그래서 **안전성을 택하고 생존성을 포기한다.** 잠금이 정말로 새면 `acquireDbLock` 이 제한시간 뒤에
 * **디렉터리 경로와 지우는 법을 적어** 크게 실패한다. 조용히 배타성이 깨져 스위트가 흔들리는 것보다
 * 시끄럽게 멈추는 편이 낫다 — 이 태스크가 존재하는 이유가 바로 그것이다.
 *
 * 새는 것 자체는 세 겹으로 막는다: describe 의 `afterAll` 해제 · `process.on("exit")` · SIGINT/SIGTERM 해제.
 * CI 러너는 매번 새 tmpdir 로 시작하므로 실행 사이에 잠금이 남지 않는다.
 *
 * 계약은 tests/db-lock.test.ts 가 단언한다(회귀 포함).
 */

const LOCK_ROOT = path.join(tmpdir(), "besttour-test-db-locks");

/** `notifications_log` 를 쓰거나 claim/reap 결과를 단언하는 블록이 공유하는 잠금 이름. */
export const NOTIFICATIONS_LOCK = "notifications-log";

/**
 * `gallery` · `gallery_albums` 를 쓰거나 **표 전체의 결과 집합**을 단언하는 블록이 공유하는 잠금 이름 (P6-3b).
 *
 * 아웃박스와 같은 부류의 경합이다. 뿌리는 0008 `gallery_select_active` 가
 * `active and (album_id is null or exists (select 1 from gallery_albums a where a.id = album_id and a.active))`
 * 로 **표 전체**에 걸리는 정책이고, 공개 읽기(`getGallery` · `getGalleryPage` · `getAlbums`)에 소유자 조건이
 * 없다는 것이다 — 접두사로 자기 행만 고르는 테스트끼리는 안 부딪히지만, **전체를 세거나 순서를 단언하는 블록**은
 * 남이 잠깐 넣은 행에 그대로 깨진다. 실제 형태:
 *   tests/home.test.ts 4-DB 는 `getGallery(100)` 의 id 배열이 직접 anon REST 조회와 **같은지**를 단언한다.
 *   그 두 번의 조회 사이에 다른 파일이 사진 한 장을 넣거나 지우면 배열이 어긋난다(P5-10 이 1회 관측하고 진단만 남긴 것).
 * 다투는 파일이 P6-3b 로 하나 더 늘어(`gallery-albums-public.test.ts`) 잠금으로 승격했다.
 *
 * **잠금 순서 규약(교착 방지)**: 한 파일이 두 잠금을 다 쓰면 **`withNotificationsLock()` 을 먼저** 부른다.
 * 모든 파일이 같은 순서로 잡으면 순환 대기가 생기지 않는다. 지금 둘 다 쓰는 파일은
 * `tests/write-privileges.test.ts` 하나이고, 이 규약은 tests/db-test-preconditions.test.ts 의 게이트가 강제한다.
 */
export const GALLERY_LOCK = "gallery-tables";

/**
 * `showcase_routes` 를 **잠시 바꾸는** 블록과 **표 전체의 결과 집합**을 단언하는 블록이 공유하는 잠금 이름 (P6-13).
 *
 * 같은 부류의 세 번째 경합이다. 16행은 0002 가 시드한 고정 집합이라 쓰는 쪽은 행을 만들지 않고 **값을 바꿨다 되돌린다**:
 *   tests/admin-routes.test.ts 는 마지막 시드 행(SEL→WJU)의 `price_from`·`sort`·`active` 를 바꿨다 되돌리고,
 *   tests/write-privileges.test.ts §5 는 ICN→SEL 의 `sort` 를 바꿨다 되돌린다.
 * 읽는 쪽은 **16행 전체**를 시드와 대조한다: tests/places.test.ts(서비스 롤 · 값·순서까지) · tests/queries.test.ts(anon · 16행 · sort 연번).
 * 그 사이에 읽으면 되돌리기 전 값을 본다. 실측(2026-09-17): 쓰는 쪽 한 번에 약 180ms 동안 WJU 행이
 * `price_from=null · sort=99` 이고 그중 일부 구간은 `active=false`(anon 에게 15행)였다. 두 쓰기 파일과 두 읽기 파일을 겹쳐 돌리자
 * queries 가 84회 중 2회 "16행이 아니라 15행" 으로 깨졌다(P6-12 전량 실행의 places "원주 price_from null" 과 같은 뿌리).
 *
 * 임시 행을 쓰는 길(쓰는 쪽이 시드 행을 건드리지 않는다)은 이 경합을 풀지 못한다 — 읽는 쪽이 **표 전체**를 세고 대조하므로
 * 임시 행 자체가 같은 순간에 보인다. 그래서 잠금이다.
 *
 * **잠금 순서 규약**: `withNotificationsLock()` → `withGalleryLock()` → `withShowcaseRoutesLock()`. 지금 셋을 다 쓰는 파일은
 * `tests/write-privileges.test.ts` 하나다. 순서는 tests/db-test-preconditions.test.ts 의 게이트가 강제한다.
 */
export const SHOWCASE_ROUTES_LOCK = "showcase-routes";

const POLL_MS = 20;
/**
 * 잠금을 기다리는 최대 시간. **줄을 서는 모든 DB 블록의 합보다 넉넉해야 한다** — 상한은 "한 블록이 얼마나 오래 쥐나" 가 아니라
 * "마지막으로 줄을 선 블록이 얼마나 기다리나" 다.
 *
 * 180초였다가 2026-09-23(P1-7 R3)에 **420초로** 올렸다. 그날 전량 실행에서 통지 잠금을 기다리던 **DB 블록 11개가 한꺼번에**
 * `180초 안에 잠금을 얻지 못했다` 로 실패했다 — 잠금을 쥔 쪽이 잘못한 것이 아니라 줄이 길어졌다(0021 의 새 탐침 · 0017 행렬 이빨
 * 테스트 등으로 잠금 안에서 도는 `supabase db query` 왕복이 늘었다. 한 번에 3~5초씩이다). 그 실패는 **경합이 아니라 대기 시간**이었고,
 * 다시 돌리면 순서만 바뀌어 다른 블록이 실패했다. 값을 올리는 것 말고 다른 방법(잠금 쪼개기)은 상호배제를 깨뜨린다.
 * 대신 남은 잠금 디렉터리를 사람이 지우라는 규칙은 그대로다 — 강제 종료 흔적을 조용히 덮지 않는다.
 * 값을 올리면 **누수된 잠금을 알아채는 시점도 그만큼 늦어진다**(4분 더) — 진단이 아니라 대기 상한일 뿐이다.
 * CLAUDE.md §7 은 숫자를 박지 않고 이 상수를 가리킨다(컨트롤러가 2026-09-23 에 그렇게 고쳤다).
 */
export const LOCK_ACQUIRE_TIMEOUT_MS = 420_000;
/**
 * "지금은 남이 쥐고 있다" 로 읽어야 하는 오류 코드.
 * POSIX 는 EEXIST 하나지만, Windows 는 삭제가 진행 중인 디렉터리에 mkdir 하면 EPERM/EACCES/EBUSY 를 준다
 * (2026-09-15 실측: 두 vitest 프로세스를 동시에 돌리자 `EPERM: operation not permitted, mkdir …notifications-log.lock`
 *  이 훅을 죽여 그 블록의 DB 단언 8건이 실패가 아니라 skip 으로 사라졌다).
 */
const CONTENDED_CODES = new Set(["EEXIST", "EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]);

const heldByThisProcess = new Set<string>();

/** 진단용 — 마지막 획득이 몇 번 돌았는지(DB_LOCK_TRACE 가 켜졌을 때만 읽힌다). */
let lastSpins = 0;

/** 잠금 디렉터리에 적힌 소유자 pid. **오류 메시지 전용** — 회수 판정에는 쓰지 않는다(회수 자체가 없다). */
function ownerPid(dir: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(path.join(dir, "owner"), "utf8").trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface DbLock {
  /** 여러 번 불러도 안전하다. */
  release(): void;
}

/**
 * 잠금 디렉터리 제거 — **자기가 만든 것에만** 부른다.
 * Windows 에서는 남이 같은 경로를 들여다보는 사이 EBUSY/EPERM 이 날 수 있어 재시도를 붙인다.
 * 그래도 실패하면 삼킨다 — 여기서 던지면 정리 훅이 죽어 그 블록이 실패가 아니라 skip 으로 사라진다.
 */
function removeDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  } catch {
    // 남으면 다음 실행이 제한시간 뒤 크게 실패하며 경로를 알려 준다
  }
}

/** 이름 하나에 대한 머신 로컬 상호배제를 얻는다. 얻을 때까지 기다리고, timeoutMs 를 넘기면 throw. */
export async function acquireDbLock(name: string, timeoutMs: number = LOCK_ACQUIRE_TIMEOUT_MS): Promise<DbLock> {
  const dir = path.join(LOCK_ROOT, `${name}.lock`);
  mkdirSync(LOCK_ROOT, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  lastSpins = 0;

  for (;;) {
    lastSpins++;
    try {
      mkdirSync(dir); // recursive 아님 — 이미 있으면 실패한다(= 원자적 획득)
      writeFileSync(path.join(dir, "owner"), String(process.pid), "utf8");
      heldByThisProcess.add(dir);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          heldByThisProcess.delete(dir);
          removeDir(dir);
        },
      };
    } catch (e) {
      // 경합 코드면 기다린다. 그 밖의 오류(ENOSPC 등)는 진짜 고장이니 그대로 터뜨린다.
      if (!CONTENDED_CODES.has((e as NodeJS.ErrnoException).code ?? "")) throw e;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `acquireDbLock('${name}'): ${Math.round(timeoutMs / 1000)}초 안에 잠금을 얻지 못했다 (소유 pid ${ownerPid(dir) ?? "?"}).\n` +
          "이 잠금은 남의 것을 절대 뺏지 않는다 — 워커가 강제 종료돼 남은 것이라면 사람이 지워야 한다:\n" +
          `  rm -rf "${dir}"\n` +
          "왜 뺏지 않는지는 tests/helpers/db-lock.ts 의 '구현' 주석 참고(뺏다가 상호배제가 깨졌다).",
      );
    }
    await sleep(POLL_MS);
  }
}

/** 이 프로세스가 쥐고 있는 잠금을 전부 놓는다. 종료 경로 전용. */
function releaseAllHeld(): void {
  for (const dir of heldByThisProcess) removeDir(dir);
  heldByThisProcess.clear();
}

// 새는 것을 막는 세 겹 중 둘 (첫째는 describe 의 afterAll).
process.on("exit", releaseAllHeld);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
  process.on(signal, () => {
    releaseAllHeld();
    process.exit(130);
  });
}

/**
 * describe 블록 전체를 이름 하나의 잠금 안에서 돌린다 (`withNotificationsLock`·`withGalleryLock` 의 공통 몸통).
 *
 * **describe 본문 맨 위에서 부른다.** vitest 기본 훅 순서(`sequence.hooks = 'stack'`)는 beforeAll 을 등록 순서대로,
 * afterAll 을 역순으로 실행한다(2026-09-15 probe 로 실측). 맨 위에서 부르면 이 잠금이 가장 먼저 잡히고
 * **가장 나중에** 풀린다 — 그 블록의 정리(afterAll 의 wipe/delete)까지 끝난 뒤에 다음 파일이 들어온다.
 * 두 개를 부르면 등록 순서대로 잡히고 역순으로 풀린다(= 올바른 중첩). 그래서 **순서 규약**이 교착을 막는다.
 */
function withDbLock(name: string): void {
  let lock: DbLock | null = null;
  // 훅 콜백은 **인자를 받지 않는다.** vitest 4 에서 첫 인자는 fixture 컨텍스트라 구조분해가 아니면
  // FixtureParseError 로 훅 자체가 죽고, 그 블록의 테스트가 실패가 아니라 **skip** 으로 조용히 사라진다
  // (2026-09-15 P5-10 에서 실제로 밟았다 — DB 단언 56건이 skip 되고 요약은 "255 passed" 였다).
  beforeAll(async () => {
    lock = await acquireDbLock(name);
    trace("acquire", name);
  }, LOCK_ACQUIRE_TIMEOUT_MS + 10_000);
  afterAll(() => {
    trace("release", name);
    lock?.release();
    lock = null;
  });
}

/** describe 블록 전체를 `notifications_log` 잠금 안에서 돌린다. 두 잠금을 다 쓰면 **이것을 먼저** 부른다. */
export function withNotificationsLock(): void {
  withDbLock(NOTIFICATIONS_LOCK);
}

/**
 * describe 블록 전체를 `gallery`·`gallery_albums` 잠금 안에서 돌린다 (P6-3b).
 * 두 잠금을 다 쓰는 파일에서는 `withNotificationsLock()` **뒤에** 부른다(GALLERY_LOCK 주석의 순서 규약).
 */
export function withGalleryLock(): void {
  withDbLock(GALLERY_LOCK);
}

/**
 * describe 블록 전체를 `showcase_routes` 잠금 안에서 돌린다 (P6-13).
 * 다른 잠금과 함께 쓰면 **맨 나중에** 부른다(notifications → gallery → showcase-routes · SHOWCASE_ROUTES_LOCK 주석).
 */
export function withShowcaseRoutesLock(): void {
  withDbLock(SHOWCASE_ROUTES_LOCK);
}

/**
 * 진단용 흐름 기록 — `DB_LOCK_TRACE=<파일경로>` 일 때만 켜진다(평소에는 아무 일도 하지 않는다).
 * acquire/release 를 시간순으로 세어 동시 보유 인원이 1 을 넘으면 상호배제가 깨진 것이다 —
 * 2026-09-15 P5-10 에서 이 계산으로 회수 경로의 결함 두 개를 찾아냈다.
 */
function trace(event: "acquire" | "release", lock: string): void {
  const out = process.env.DB_LOCK_TRACE;
  if (!out) return;
  try {
    const testPath = (expect.getState().testPath as string | undefined) ?? "";
    appendFileSync(
      out,
      `${JSON.stringify({
        event,
        // 잠금이 둘이 되었으므로(P6-3b) 이름이 없으면 동시 보유 계산이 두 잠금을 뒤섞는다.
        lock,
        pid: process.pid,
        at: new Date().toISOString(),
        file: testPath ? path.basename(testPath) : "",
        root: LOCK_ROOT,
        spins: lastSpins,
      })}\n`,
      "utf8",
    );
  } catch {
    // 진단이 본 테스트를 깨뜨리지 않는다
  }
}

/** 남아 있는 잠금 이름들 — 진단·테스트용. 평소 코드 경로에서는 부르지 않는다. */
export function listHeldLocks(): string[] {
  try {
    return readdirSync(LOCK_ROOT).filter((f) => f.endsWith(".lock"));
  } catch {
    return [];
  }
}

/**
 * 홈 "접수 현황" 피드 읽기 — **lib/queries 에서 유일하게 서비스 롤을 쓰는 파일** (P3-5 · G4).
 *
 * 왜 예외인가: reservations 는 RLS 정책이 없다(0001 — "정책 없음 = 서비스 롤만 접근"). anon 으로는 0행이라
 * 이 계층의 원칙(anon + RLS, index.ts 헤더)으로는 사장님이 확정한 접수 현황 섹션을 만들 수 없다. 그래서 서버(RSC)가
 * 서비스 롤로 읽되, 누출을 구조로 막는다:
 *   1. select 는 RECENT_SELECT(화이트리스트 5컬럼)뿐 — 전화·이메일·메시지·id·public_code 는 메모리에도 올리지 않는다.
 *   2. 반환 타입 RecentFeedItem(lib/recent-feed.ts)에는 원문 필드가 없다 — 실수로도 못 내린다. 마스킹은 lib/mask.ts maskName.
 *   3. 캐시는 모른다(ADR-3) — 호출부 app/[locale]/(site)/page.tsx 가 60초 태그 캐시(QUERY_TAGS.recent)로 감싼다.
 *      접수 서버액션(actions/reservation.ts, P3-3)이 성공 뒤 그 태그를 무효화하므로 새 접수는 즉시 반영된다.
 *   4. 서버 액션이 아니다 — 서버 액션 지시어 없음. index.ts 배럴에서 re-export 하지 않는다(anon 전용 배럴에 서버 전용 모듈을
 *      섞지 않기 위해; 호출부는 이 경로를 직접 import 한다).
 * tests/queries.test.ts 의 "서비스 롤 0건" 단언은 이 파일만 사유와 함께 예외(SERVICE_ROLE_EXCEPTIONS)로 등록한다 —
 * 그 외 파일은 여전히 0건이고, 이 파일도 서버 액션·Next import 금지는 그대로 받는다.
 *
 * 실패 정책(브리프 §P3-3 인계):
 *   - env 누락(createServiceClient 가 throw) → 그대로 throw. 홈 빌드가 죽는 것이 맞다(fail-loud — 키가 빠진 채 배포되는 것보다 낫다).
 *   - DB 오류(쿼리 error·네트워크 예외) → structuredLog 한 줄 + []. 피드 하나 때문에 홈 전체가 500 이 되면 안 된다.
 *     로그에는 테이블명·PostgREST 코드(또는 예외 클래스명)만 싣는다 — 오류 메시지 원문도 싣지 않는다.
 */
import { structuredLog, type StructuredLogEntry } from "../log";
import {
  mapRecentRows,
  RECENT_PUBLIC_STATUSES,
  RECENT_SELECT_COLUMNS,
  type RecentFeedItem,
  type RecentReservationRow,
} from "../recent-feed";
import { createServiceClient } from "../supabase/server";

export { RECENT_SELECT_COLUMNS, type RecentFeedItem } from "../recent-feed";

export type ServiceClient = ReturnType<typeof createServiceClient>;

/** 홈 섹션이 보여 주는 최대 건수. */
export const DEFAULT_RECENT_LIMIT = 8;

/**
 * 섹션이 "최근"이라고 말할 수 있는 범위 (일). **카피를 참으로 만드는 값이다** — P6-6 감사 R-1.
 *
 * 예전에는 쿼리에 기간 조건이 아예 없었다. `status` 로 거르고 `created_at` 내림차순으로 N 건을 집을 뿐이라,
 * 접수가 드문 기간에는 몇 달 전 접수가 화면에서 "방금 견적 받은 분들"로 표시됐다. 오픈 직후에는 첫 접수 한 건이
 * 몇 주 동안 "방금"으로 남는다. "오늘 접수 17건"을 지웠을 때 함께 지웠어야 할 같은 종류의 주장이다.
 *
 * 고친 방법은 둘 다다: (1) 카피를 "최근"으로 낮추고(messages/ko.json home.recentFeed) (2) 쿼리에 그 "최근"의
 * 범위를 실제로 걸었다. 30 일을 고른 근거는 **사장님이 준 값이 아니라 카피를 참으로 만드는 최소 범위**다 —
 * 한국어에서 "최근"이 가리킬 수 있는 가장 짧은 상식적 단위(한 달)를 골랐고, 더 길게 잡으면 다시 같은 문제가 된다.
 * 사장님이 다른 범위를 확인해 주면 이 상수만 바꾼다. [TEMP] RECENT_WINDOW_DAYS: 사장님 확인 전 잠정값
 *
 * 0 건이면 홈이 섹션을 통째로 숨긴다(components/home/RecentFeed.tsx). 그 숨김은 **마케팅 섹션에만** 허용되며
 * 법정 고지의 빈 값 숨김과는 다른 규칙이다 — tests/recent-feed.test.ts 가 그 구분을 명시적으로 단언한다.
 */
export const RECENT_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

/** 기준 시각에서 창의 시작(포함)을 ISO 로. 테스트가 `now` 를 주입해 경계를 고정한다. */
export function recentWindowStart(now: Date = new Date()): string {
  return new Date(now.getTime() - RECENT_WINDOW_DAYS * DAY_MS).toISOString();
}

/** PostgREST select 문자열 = 화이트리스트 join. 임베드·별칭 없음 — 다른 컬럼을 덧붙이는 경로가 없다. */
export const RECENT_SELECT: string = RECENT_SELECT_COLUMNS.join(",");

/**
 * 차종 라벨용. vehicles 는 공개 테이블이지만 비활성 차량으로 접수된 건도 라벨이 있어야 하므로(anon 정책은 active 만 보여 준다)
 * 같은 클라이언트로 전부 읽는다 — FK(reservations.vehicle_slug → vehicles.slug)가 slug 존재를 보장한다.
 */
const VEHICLE_LABEL_SELECT = "slug,name_ko";

interface VehicleLabelRow {
  slug: string;
  name_ko: string;
}

interface RecentFeedLogEntry extends StructuredLogEntry {
  event: "recent_feed.query_failed" | "recent_feed.rows_skipped";
  table?: "reservations" | "vehicles";
  /** PostgREST 오류 코드 또는 예외 클래스 이름 — 메시지 원문은 싣지 않는다. */
  code?: string | null;
  /** 매퍼가 fail-closed 로 버린 행 수(개인정보 없음). 쿼리가 status 를 거르므로 운영에서 0 이어야 정상이다. */
  skipped?: number;
}

function logFailure(table: RecentFeedLogEntry["table"], code: string | null | undefined): void {
  const entry: RecentFeedLogEntry = { level: "error", event: "recent_feed.query_failed", table, code: code ?? null };
  structuredLog(entry);
}

/**
 * 최근 `RECENT_WINDOW_DAYS` 일 안의 접수 `limit` 건(status new·confirmed, created_at 내림차순)을 마스킹한 항목으로.
 * 실패 정책은 파일 헤더. `client`·`now` 는 테스트 주입용 — 운영 호출부는 넘기지 않는다.
 */
export async function getRecentReservationsMasked(
  limit: number = DEFAULT_RECENT_LIMIT,
  client?: ServiceClient,
  now: Date = new Date(),
): Promise<RecentFeedItem[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`getRecentReservationsMasked: limit 은 1 이상의 정수여야 합니다 (받은 값: ${limit})`);
  }
  const since = recentWindowStart(now);
  // env 누락은 여기서 throw 된다 — 의도적으로 try 밖이다(fail-loud).
  const db = client ?? createServiceClient();

  try {
    const [reservations, vehicles] = await Promise.all([
      db
        .from("reservations")
        .select(RECENT_SELECT)
        .in("status", [...RECENT_PUBLIC_STATUSES])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(limit)
        .overrideTypes<RecentReservationRow[], { merge: false }>(),
      db.from("vehicles").select(VEHICLE_LABEL_SELECT).overrideTypes<VehicleLabelRow[], { merge: false }>(),
    ]);
    if (reservations.error) {
      logFailure("reservations", reservations.error.code);
      return [];
    }
    if (vehicles.error) {
      logFailure("vehicles", vehicles.error.code);
      return [];
    }
    const labels = new Map(vehicles.data.map((v): [string, string] => [v.slug, v.name_ko]));
    const items = mapRecentRows(reservations.data, labels);
    if (items.length !== reservations.data.length) {
      const entry: RecentFeedLogEntry = {
        level: "warn",
        event: "recent_feed.rows_skipped",
        skipped: reservations.data.length - items.length,
      };
      structuredLog(entry);
    }
    return items;
  } catch (e) {
    logFailure(undefined, e instanceof Error ? e.name : null);
    return [];
  }
}

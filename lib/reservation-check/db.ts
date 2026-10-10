/**
 * 예약확인 DB 어댑터 — 서비스 롤 클라이언트 → lookup.ts 의 `ReservationCheckDb` 포트 (P6-3a · T2-5).
 *
 * 서버 전용. `server-only` 로 클라이언트 번들 유입을 빌드 타임에 막는다(lib/supabase/server.ts·lib/reservations/db.ts 와 같은 방식).
 * reservations 는 RLS 정책이 없어(0001) 서비스 롤만 읽을 수 있다 — 그래서 여기 있다.
 *
 * 로직은 없다 — select 두 개. 판단(이름 비교·범위·뷰 매핑)은 전부 lookup.ts·view.ts 에 있고 거기서 테스트된다.
 * select 는 lookup.ts 의 화이트리스트 상수(RESERVATION_CHECK_SELECT)만 — 여기서 컬럼 문자열을 다시 쓰지 않는다.
 * **조건은 `phone in (…)` 하나다**(T2-5 · 결정 5) — 이름·상태·날짜를 SQL 에 넣지 않는다. 전화번호 인덱스는 두지 않았다
 * (표가 작고 조회가 드물어 이득이 없다 — 계획 T2-5 "마이그레이션은 하지 않는다").
 *
 * 오류: PostgREST error 의 `code`·`message` 만 싣는다. `details`/`hint` 는 싣지 않는다(행 내용을 담을 수 있다 — lib/reservations/db.ts 와 같은 이유).
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CHECK_MAX_ROWS, RESERVATION_CHECK_SELECT, type ReservationCheckDb, type ReservationCheckRow } from "./lookup";
import type { VehicleNames } from "./view";

const RESERVATIONS = "reservations";
const VEHICLES = "vehicles";

export function supabaseReservationCheckDb(client: SupabaseClient): ReservationCheckDb {
  return {
    async findByPhones(phones: readonly string[]): Promise<ReservationCheckRow[]> {
      const { data, error } = await client
        .from(RESERVATIONS)
        .select(RESERVATION_CHECK_SELECT)
        .in("phone", [...phones])
        .order("depart_at", { ascending: false })
        .limit(CHECK_MAX_ROWS);
      if (error) throw new Error(`reservations select 실패: [${error.code}] ${error.message}`);
      return Array.isArray(data) ? (data as unknown as ReservationCheckRow[]) : [];
    },
    // P7-4: 영문 화면은 name_en 을 보인다 — 한 번의 select 로 두 이름을 함께 읽는다. name_en 이 문자열이 아니면 "" (뷰가 name_ko 로 폴백).
    async vehicleNames(slug: string): Promise<VehicleNames | null> {
      const { data, error } = await client.from(VEHICLES).select("name_ko,name_en").eq("slug", slug).maybeSingle();
      if (error) throw new Error(`vehicles select 실패: [${error.code}] ${error.message}`);
      const row = data as { name_ko?: unknown; name_en?: unknown } | null;
      if (typeof row?.name_ko !== "string" || row.name_ko.length === 0) return null;
      return { ko: row.name_ko, en: typeof row.name_en === "string" ? row.name_en : "" };
    },
  };
}

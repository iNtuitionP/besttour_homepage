/**
 * reservations DB 어댑터 — 서비스 롤 클라이언트 → lib/reservations/create.ts 의 `ReservationDb` 포트 (P3-2).
 *
 * 서버 전용. `server-only` 로 클라이언트 번들 유입을 빌드 타임에 막는다(lib/supabase/server.ts 와 같은 방식).
 * 로직은 없다 — insert 한 줄 + enqueue 위임. 판단(재시도·통지 계획·검증)은 전부 create.ts 에 있고 거기서 테스트된다.
 *
 * 오류: PostgREST error 의 `code`(SQLSTATE)만 ReservationDbError 에 싣는다. `details`/`hint` 는 싣지 않는다 —
 * CHECK 위반의 details 는 "Failing row contains (…이름, 전화…)" 로 행 전체를 담아 로그에 개인정보가 새는 경로가 된다.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { enqueue } from "../notify/outbox";
import type { ReservationInsert } from "../types";
import { ReservationDbError, type ReservationDb } from "./create";

const TABLE = "reservations";

/** 서비스 롤 클라이언트(lib/supabase/server.ts createServiceClient)를 받아 포트를 만든다. 클라이언트는 여기서 닫힌다. */
export function supabaseReservationDb(client: SupabaseClient): ReservationDb {
  return {
    async insert(row: ReservationInsert): Promise<{ id: string }> {
      const { data, error } = await client.from(TABLE).insert(row).select("id").single();
      if (error) {
        throw new ReservationDbError(`reservations insert 실패: [${error.code}] ${error.message}`, { code: error.code });
      }
      const id: unknown = (data as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || id.length === 0) {
        throw new ReservationDbError("reservations insert 가 id 를 돌려주지 않았다");
      }
      return { id };
    },
    enqueue: (rows) => enqueue(rows, client),
  };
}

/**
 * 통지 문안 변수 로더 — `TemplateVarsPort`(lib/notify/solapi.ts) 구현 (플랜 v4 P4-2b · ADR-7).
 *
 * P4-2 가 어댑터를 끝냈지만 `SendRequest` 는 `reservationId` 만 나른다. 문안을 그리려면 예약을 다시 읽어야 하는데
 * 기존 읽기 함수는 둘 다 못 쓴다 — `lib/admin/reservations.ts` 는 **세션 스코프**(크론에는 세션이 없다),
 * `lib/reservation-check/view.ts` 는 **설계상 마스킹**돼 있다(사장님은 전화를 걸어야 한다). 그래서 이 모듈이 있다.
 * 이것이 없는 동안 어댑터는 `configured:false` 였다 — 문안을 만들 수 없는 발송기가 claim 하면 되돌릴 수 없는 attempts 를 태운다.
 *
 * ## 왜 두 함수인가 — 규율이 아니라 구조
 * `customerVars` 와 `ownerVars` 는 **반환 타입이 다르다**(lib/notify/templates.ts). 고객 변수에는 이름·전화가
 * 타입에 없어서, 고객 문자를 보내면서 남의 개인정보를 읽어 오는 코드를 **쓸 수가 없다**. 넓은 타입 하나를 만들고
 * 고객 쪽에서 일부만 쓰는 방식은 쓰지 않았다 — 그것은 구조가 아니라 규율이고, 규율은 언젠가 깨진다.
 * 조회 경로도 함께 갈랐다: 고객 조회는 `public_code` 한 컬럼만 읽는다(§select 화이트리스트).
 *
 * ## 서비스 롤 예외
 * `reservations` 는 RLS 정책이 없다(0001 — "정책 없음 = 서비스 롤만 접근"). anon 으로는 0행이고 크론에는 세션이 없으므로
 * service_role 권한의 클라이언트로 읽는다. `lib/queries/recent.ts` 와 같은 이유·같은 방식이며, tests/queries.test.ts 의
 * `SERVICE_ROLE_EXCEPTIONS` 에 **사유와 함께** 등록돼 있다(그 외 파일은 여전히 0건).
 * 다만 클라이언트를 **여기서 만들지 않는다**: lib/supabase/server.ts 의 createServiceClient 로 만든 것을
 * app/api/cron/notify/route.ts 가 주입한다. 그래서 이 파일에는 env 도, `server-only` 도, 네트워크 호출도 없다
 * (lib/notify/** 의 규약 — P4-1 이 세운 경계이고 tests/notify-vars.test.ts §7 이 정적으로 잠근다).
 * 부수 효과: `server-only` 를 import 하지 않으므로 이 모듈은 vitest 에서 **그대로 import 되어 실측**된다.
 *
 * ## 실패 정책 (포트 계약)
 *   - 행이 없다 / id 가 uuid 가 아니다 → `null`. **throw 하지 않는다.** 어댑터가 `{ok:false, error:'reservation_not_found', retryable:false}` 를 낸다.
 *   - DB 오류 → throw. 어댑터가 `{ok:false, error:'vars_load_failed', retryable:true}` 로 받는다.
 *   - 행은 있는데 컬럼이 비었다 → throw(위와 같은 경로). 반쯤 빈 문안을 보내는 것보다 보내지 않는 편이 낫다(스키마가 어긋났다는 신호다).
 *   - 로그·오류 문구에 **개인정보 0** — 남는 것은 `reservationId`·오류 코드·표 이름·수신자 구분뿐이다(lib/log.ts 규약).
 *
 * ### `retryable:false` 는 "즉시 포기"가 아니다 — 착각하기 쉬운 자리 (2026-09-15 독립 리뷰 경미-1)
 * `retryable` 은 **기록용**이다(lib/notify/sender.ts:34 가 명시). 워커의 `recordFailure`(worker.ts:229-241)는 그 값을 로그에만 싣고
 * 종료 판정에는 쓰지 않는다 — pending 유지냐 failed 냐는 오직 `attempts` 가 정한다(outbox.ts `retryPlanAfterFailure`:129 의
 * `attempts >= MAX_ATTEMPTS` 와 0005 `mark_notification_failed`). **그래서 없는 예약도 5회를 다 태운 뒤에야 failed 가 된다.**
 * `null` 과 `throw` 가 실제로 가르는 것은 소모되는 attempts 수가 아니라 `last_error` 에 남는 코드
 * (`reservation_not_found` ↔ `vars_load_failed`)와 로그의 `retryable` 값, 즉 **사람이 원인을 읽는 방식**이다.
 * 그것만으로도 `null` 이 맞다(없는 예약을 "조회 실패" 로 기록하면 DB 를 의심하게 된다). 다만 "attempts 를 아낀다"는 효과는 없다 —
 * P4-2b 브리프가 그렇게 적었으나 워커의 실제 동작이 아니었다. 바꾸려면 워커(P4-1) 쪽 태스크다. 이 파일은 동작을 바꾸지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { isLocationCode, locationLabelKo } from "../codes";
import { structuredLog, type StructuredLogEntry } from "../log";
import { kstWallClock } from "../reservation-check/view";
import type { TemplateVarsPort } from "./solapi";
import type { CustomerVars, OwnerVars } from "./templates";

// =============================================================================
// select 화이트리스트 — 여기 없는 컬럼은 서버 메모리에도 올라오지 않는다
// =============================================================================

const RESERVATIONS = "reservations";
const VEHICLES = "vehicles";

/**
 * 고객 문안이 읽는 전부. **한 컬럼이다.**
 * 고객 문자 2종(created·confirmed)이 쓰는 값은 접수번호와 사이트 원점뿐이고, 원점은 DB 가 아니라 주입값이다
 * (lib/notify/templates.ts `CustomerVars`). 운행일·구간·차량을 고객 문자에 넣지 않는 것은 실수가 아니라 설계다 —
 * 문안이 "접수 내용은 예약확인 화면에서 접수번호와 휴대폰 뒷 4자리로 확인하실 수 있습니다" 로 안내한다.
 * 그래서 쓰지 않는 값은 읽지도 않는다(lib/queries/recent.ts 가 public_code 조차 읽지 않는 것과 같은 원칙).
 */
export const CUSTOMER_VARS_COLUMNS = ["public_code"] as const;

/**
 * 사장님 접수 알림이 읽는 전부. 문안(templates.ts `ownerVariants`)이 실제로 쓰는 9컬럼이다 —
 * 접수번호·성명·연락처·차량·구간·운행일·대수·인원. `reservations.id` 는 인자로 이미 받았으므로 읽지 않는다.
 */
export const OWNER_VARS_COLUMNS = [
  "public_code",
  "name",
  "phone",
  "vehicle_slug",
  "origin_code",
  "destination_code",
  "depart_at",
  "bus_count",
  "passengers",
] as const;

/**
 * **어느 쪽도 읽지 않는 컬럼.** 문안에 쓰지 않으므로 읽을 이유가 없고, 읽지 않으면 샐 수도 없다.
 * (동의 컬럼·retention_until 은 0003, admin_memo 는 0001 — 통지와 무관한 운영·법정 보존용 값이다.)
 */
export const FORBIDDEN_VARS_COLUMNS = [
  "email",
  "message",
  "admin_memo",
  "privacy_consent_at",
  "privacy_policy_version",
  "marketing_consent_at",
  "retention_until",
] as const;

/** PostgREST select 문자열 — 화이트리스트를 쉼표로 이은 것. `*` 없음. */
export const CUSTOMER_VARS_SELECT: string = CUSTOMER_VARS_COLUMNS.join(",");
export const OWNER_VARS_SELECT: string = OWNER_VARS_COLUMNS.join(",");

/** 차량 라벨 한 컬럼. slug 가 아니라 사람이 읽는 이름을 문안에 쓴다. */
const VEHICLE_LABEL_SELECT = "name_ko";

// =============================================================================
// 반환 타입 잠금 — 키가 생기거나 빠지면 컴파일이 깨진다
// =============================================================================

/** 고객 변수의 키 전부(lib/notify/templates.ts `CustomerVars`). 테스트가 결과 객체의 키 집합과 대조한다. */
export const CUSTOMER_VARS_KEYS = ["publicCode", "origin"] as const satisfies readonly (keyof CustomerVars)[];

/** 사장님 변수의 키 전부(`OwnerVars`). `CustomerVars` 를 확장하므로 접수번호·원점이 앞에 있다. */
export const OWNER_VARS_KEYS = [
  "publicCode",
  "origin",
  "reservationId",
  "name",
  "phone",
  "vehicleLabel",
  "departAtKst",
  "originLabel",
  "destinationLabel",
  "busCount",
  "passengers",
] as const satisfies readonly (keyof OwnerVars)[];

type MissingCustomerKey = Exclude<keyof CustomerVars, (typeof CUSTOMER_VARS_KEYS)[number]>;
/** keyof 잠금 1 — CUSTOMER_VARS_KEYS 가 CustomerVars 의 모든 키를 담는다. */
export const CUSTOMER_VARS_KEYS_EXHAUSTIVE: MissingCustomerKey extends never ? true : never = true;

type MissingOwnerKey = Exclude<keyof OwnerVars, (typeof OWNER_VARS_KEYS)[number]>;
/** keyof 잠금 2 — OWNER_VARS_KEYS 가 OwnerVars 의 모든 키를 담는다. */
export const OWNER_VARS_KEYS_EXHAUSTIVE: MissingOwnerKey extends never ? true : never = true;

type CustomerPiiKey = Extract<keyof CustomerVars, "name" | "phone" | "email" | "message">;
/** keyof 잠금 3 — 고객 변수에 원문 개인정보 키가 없다. 생기는 순간 컴파일이 깨진다(lib/reservation-check/view.ts 와 같은 방식). */
export const CUSTOMER_VARS_HAS_NO_PII: CustomerPiiKey extends never ? true : never = true;

type OwnerForbiddenKey = Extract<keyof OwnerVars, "email" | "message">;
/** keyof 잠금 4 — 사장님 변수에도 메일·요청사항은 없다(문안이 쓰지 않는다). */
export const OWNER_VARS_HAS_NO_EMAIL_OR_MESSAGE: OwnerForbiddenKey extends never ? true : never = true;

// =============================================================================
// 로그 · 오류
// =============================================================================

/** 수신자 구분 — 어느 경로에서 실패했는지만 남긴다(lib/notify/solapi.ts TEMPLATE_AUDIENCE 와 같은 낱말). */
export type VarsAudience = "owner" | "customer";

/**
 * 조회 실패 한 줄. **개인정보 0** — 행의 값은 하나도 싣지 않는다.
 * `code` 는 PostgREST/SQLSTATE 코드뿐이고 오류 메시지 원문은 버린다(CHECK 위반의 details 에는 행 전체가 실린다 —
 * lib/reservations/db.ts 가 같은 이유로 code 만 남긴다).
 */
export interface TemplateVarsLogEntry extends StructuredLogEntry {
  level: "error";
  event: "notify.vars_query_failed";
  reservationId: string;
  audience: VarsAudience;
  table: "reservations" | "vehicles";
  code: string | null;
}

/** reservations.id 는 uuid 다. 형태가 아니면 조회 자체를 하지 않는다 — 없는 예약과 같게 다룬다. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres `invalid_text_representation`. uuid 컬럼에 uuid 가 아닌 문자열을 비교시키면 이 코드가 온다.
 * 위 형태 검사로 대부분 걸러지지만, 걸러지지 않은 경우에도 **오류가 아니라 부재**로 다룬다 — 다시 시도해도 같은 답이다.
 */
const INVALID_TEXT_REPRESENTATION = "22P02";

// =============================================================================
// 행 → 값 (fail-closed)
// =============================================================================

type Row = Record<string, unknown>;

/** 오류 문구에는 **컬럼 이름만** 들어간다. 값은 절대 넣지 않는다(그 값이 곧 개인정보다). */
function badColumn(column: string, why: string): Error {
  return new Error(`templateVars: ${RESERVATIONS}.${column} ${why} — 반쯤 빈 문안을 보내지 않는다`);
}

function requiredString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string" || value.length === 0) throw badColumn(column, "가 비었거나 문자열이 아니다");
  return value;
}

function requiredInteger(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isFinite(value)) throw badColumn(column, "가 비었거나 수가 아니다");
  return value;
}

function nullableInteger(row: Row, column: string): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw badColumn(column, "가 수가 아니다");
  return value;
}

/**
 * 표시용 라벨 — canonical code 면 한글 라벨, 아니면 코드 그대로(저장값을 바꾸지 않는다).
 * lib/reservation-check/view.ts 의 같은 판정과 한 줄까지 같다. 그쪽은 export 하지 않는 내부 함수라 여기서 다시 적었다 —
 * 공용 모듈로 올리는 것은 이 태스크의 범위(브리프 §산출물) 밖이다.
 */
function labelOf(code: string): string {
  return isLocationCode(code) ? locationLabelKo(code) : code;
}

// =============================================================================
// 로더
// =============================================================================

export interface TemplateVarsDeps {
  /**
   * 서비스 롤 Supabase 클라이언트. app/api/cron/notify/route.ts 가 만들어 주입한다 —
   * 이 모듈은 env 를 읽지 않고 클라이언트를 만들지도 않는다(§서비스 롤 예외). 테스트는 mock 을 넣는다.
   */
  client: SupabaseClient;
  /**
   * 사이트 원점(`https://…`, 끝 슬래시 없음). 문안의 예약확인·관리자 링크에 쓴다.
   * route.ts 가 lib/site-url.ts `siteOrigin()` 으로 얻어 넘긴다 — 문안 모듈도 이 모듈도 env 를 보지 않는다.
   */
  origin: string;
  /** 기본 structuredLog. 개인정보 없는 항목만 싣는다(TemplateVarsLogEntry). */
  log?: (entry: TemplateVarsLogEntry) => void;
}

/**
 * 포트 구현 하나. 호출마다 클라이언트를 새로 만들지 않는다 — 주입받은 것을 그대로 쓴다.
 * 반환 타입은 lib/notify/solapi.ts 의 `TemplateVarsPort` 그대로이며, 두 메서드의 반환 타입이 서로 다르다는 것이 이 모듈의 핵심이다.
 */
export function templateVars(deps: TemplateVarsDeps): TemplateVarsPort {
  const log = deps.log ?? structuredLog;

  /** 화이트리스트 select 로 1행. 없으면 null, DB 오류면 throw(로그 한 줄). */
  async function loadRow(reservationId: string, select: string, audience: VarsAudience): Promise<Row | null> {
    if (!UUID_SHAPE.test(reservationId)) return null;
    const { data, error } = await deps.client.from(RESERVATIONS).select(select).eq("id", reservationId).maybeSingle();
    if (error) {
      if (error.code === INVALID_TEXT_REPRESENTATION) return null;
      log({
        level: "error",
        event: "notify.vars_query_failed",
        reservationId,
        audience,
        table: RESERVATIONS,
        code: error.code ?? null,
      });
      throw new Error(`templateVars: ${RESERVATIONS} 조회 실패 [${error.code}]`);
    }
    return (data as Row | null) ?? null;
  }

  /** vehicles.name_ko. 행이 없으면 null → 호출부가 slug 로 폴백한다(라벨 하나 때문에 접수 알림을 막지 않는다). */
  async function vehicleLabel(reservationId: string, slug: string): Promise<string | null> {
    const { data, error } = await deps.client.from(VEHICLES).select(VEHICLE_LABEL_SELECT).eq("slug", slug).maybeSingle();
    if (error) {
      log({
        level: "error",
        event: "notify.vars_query_failed",
        reservationId,
        audience: "owner",
        table: VEHICLES,
        code: error.code ?? null,
      });
      throw new Error(`templateVars: ${VEHICLES} 조회 실패 [${error.code}]`);
    }
    const name: unknown = (data as { name_ko?: unknown } | null)?.name_ko;
    return typeof name === "string" && name.length > 0 ? name : null;
  }

  return {
    async customerVars(reservationId: string): Promise<CustomerVars | null> {
      const row = await loadRow(reservationId, CUSTOMER_VARS_SELECT, "customer");
      if (row === null) return null;
      // 이 객체에 담을 수 있는 필드가 두 개뿐이라, 위 행이 무엇을 더 들고 왔든 여기서 끝난다.
      return { publicCode: requiredString(row, "public_code"), origin: deps.origin };
    },

    async ownerVars(reservationId: string): Promise<OwnerVars | null> {
      const row = await loadRow(reservationId, OWNER_VARS_SELECT, "owner");
      if (row === null) return null;

      const publicCode = requiredString(row, "public_code");
      const name = requiredString(row, "name");
      const phone = requiredString(row, "phone");
      const slug = requiredString(row, "vehicle_slug");
      const originCode = requiredString(row, "origin_code");
      const destinationCode = requiredString(row, "destination_code");
      // KST 벽시계 변환은 lib/reservation-check/view.ts kstWallClock 하나뿐이다(서버 TZ 와 무관한 고정 +09:00).
      // 사본을 두면 한쪽만 고쳐지고 다른 쪽이 계속 틀린다 — 형식이 유효하지 않으면 여기서 throw 한다.
      const departAtKst = kstWallClock(requiredString(row, "depart_at"));
      const busCount = requiredInteger(row, "bus_count");
      const passengers = nullableInteger(row, "passengers");

      return {
        publicCode,
        origin: deps.origin,
        reservationId,
        name,
        phone,
        vehicleLabel: (await vehicleLabel(reservationId, slug)) ?? slug,
        departAtKst,
        originLabel: labelOf(originCode),
        destinationLabel: labelOf(destinationCode),
        busCount,
        passengers,
      };
    },
  };
}

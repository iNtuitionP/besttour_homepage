/**
 * 개인정보 파기 배치 (플랜 v4 P1-5 · PIPA §21 · 전자상거래법 §6③).
 *
 * 처리방침에 게시한 보유기간(lib/legal/disclosures.ts PRIVACY_NOTICE.retention)을 실제로 이행하는 유일한 수단이다.
 * 이행 수단이 없으면 그 고지는 오픈 첫날부터 허위 표시다.
 *
 * 원칙
 *   1. dry-run 이 기본값. `purge()` 를 옵션 없이 부르면 아무것도 지우지 않고 보고만 한다. 실삭제는 `dryRun:false` 명시.
 *   2. 삭제 상한. 1회 실행 최대 `limit` 건(기본 200). 버그로 전부 지우는 사고를 막는다. limit 은 1 이상 정수만.
 *   3. 계약 기록은 더 오래 보관. 전자상거래법 §6③ + 시행령 §6①2호·3호: 계약·청약철회 기록, 대금결제·재화공급 기록은 5년.
 *      확정 이력이 있는 예약(status confirmed·done, 또는 confirmed_at 이 있는 cancelled = 확정 후 철회)은
 *      retention_until 이 지나도 created_at + 5년 전까지 keep(legal_hold). 확정 이력 없는 접수(new·미확정 cancelled)는
 *      retention_until 만 본다 — 원장의 보유기간은 여기서 재정의하지 않는다(consent.ts retentionUntil 이 행에 써 둔 값을 읽는다).
 *   4. 경계는 "초과만". retention_until == now 는 keep. 비교는 인스턴트(timestamptz)라 서버 TZ 와 무관하고,
 *      로그·보고에 찍는 달력 날짜만 KST(lib/kst.ts toKstDateString).
 *   5. 감사 기록. 지운/보류한 행의 id·created_at·status·결정·사유만 남긴다 — 이름·전화 등 개인정보는 보고서에도 로그에도 없다.
 *      우선 console.info 구조화 JSON(event: "retention_purge"). 테이블(retention_purge_log)은 P5(0006 admin_rls)에서 함께 만든다 —
 *      P1-4 가 0005 를 쓰고 있어 이 태스크는 마이그레이션을 만들지 않는다.
 *   6. 모르는 행은 지우지 않는다. 시각 파싱이 실패하면 throw — 그 실행 전체가 멈춘다.
 *
 * 구조: selectPurgeCandidates(순수 판정) → purge(어댑터, PurgeClient 포트) ← supabasePurgeClient(supabase-js 구현).
 * notifications_log.reservation_id FK 에 on delete 절이 없고(0001) to_phone 도 개인정보라, 예약을 지우기 전에 로그를 먼저 지운다.
 */
import { toKstDateString } from "../kst";

/** 0001 reservation_status enum. */
export type ReservationStatus = "new" | "confirmed" | "done" | "cancelled";

/** 판정에 필요한 최소 컬럼 — 개인정보 컬럼은 읽지 않는다. timestamptz 는 ISO 문자열(PostgREST 출력 형식 포함). */
export interface RetentionRow {
  id: string;
  created_at: string;
  status: ReservationStatus;
  retention_until: string;
  /** 사장님이 admin 에서 확정한 시각. cancelled 라도 이 값이 있으면 "확정 후 철회" = 계약 기록. */
  confirmed_at?: string | null;
}

export type KeepReason = "retention_active" | "legal_hold";

export interface PurgePolicy {
  /** 계약 기록 보존 연수. 전자상거래법 시행령 §6①2호·3호 = 5년. */
  confirmedKeepYears: number;
}

/** 전자상거래법 §6③ · 시행령 §6①2호(계약·청약철회 기록)·3호(대금결제·재화공급 기록) — 5년. */
export const CONFIRMED_KEEP_YEARS = 5;
export const DEFAULT_POLICY: PurgePolicy = { confirmedKeepYears: CONFIRMED_KEEP_YEARS };

/** 1회 실행 삭제 상한 기본값. */
export const DEFAULT_PURGE_LIMIT = 200;
/** 1회 실행에서 DB 에서 읽어 오는 만료 행 상한(판정 대상). 보류(legal_hold) 행이 많아져 여기 걸리면 보고서 scanTruncated 로 드러난다. */
export const DEFAULT_SCAN_LIMIT = 1000;

function parseInstant(value: string | null | undefined, label: string, id: string): Date {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`purge: 행 ${id} 의 ${label} 이 비어 있다 — 판정할 수 없어 실행을 멈춘다`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`purge: 행 ${id} 의 ${label}="${value}" 을 시각으로 해석할 수 없다 — 판정할 수 없어 실행을 멈춘다`);
  }
  return d;
}

/** created_at + N년 (UTC 달력 연도 가산. 2/29 접수는 Date.UTC 규칙대로 3/1 로 넘어간다 — 하루 더 보관하는 쪽이라 안전). */
export function legalHoldUntil(createdAt: Date, years: number): Date {
  return new Date(
    Date.UTC(
      createdAt.getUTCFullYear() + years,
      createdAt.getUTCMonth(),
      createdAt.getUTCDate(),
      createdAt.getUTCHours(),
      createdAt.getUTCMinutes(),
      createdAt.getUTCSeconds(),
      createdAt.getUTCMilliseconds(),
    ),
  );
}

/** 확정 이력이 있는가 = 전자상거래법상 계약 기록인가. */
export function isContractRecord(row: Pick<RetentionRow, "status" | "confirmed_at">): boolean {
  if (row.status === "confirmed" || row.status === "done") return true;
  return typeof row.confirmed_at === "string" && row.confirmed_at.length > 0;
}

export interface PurgeSelection {
  /** 지울 행 id — 입력 순서 유지. */
  purge: string[];
  keep: { id: string; reason: KeepReason }[];
}

/**
 * 순수 판정. 입력 행마다 purge 또는 keep(이유) 중 정확히 하나.
 *   - retention_until >= now            → keep(retention_active)
 *   - 계약 기록 && created_at+N년 >= now → keep(legal_hold)
 *   - 그 외                              → purge
 */
export function selectPurgeCandidates(rows: RetentionRow[], now: Date, policy: PurgePolicy = DEFAULT_POLICY): PurgeSelection {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("purge: now 가 유효한 Date 가 아니다");
  }
  if (!Number.isInteger(policy.confirmedKeepYears) || policy.confirmedKeepYears < 0) {
    throw new Error(`purge: policy.confirmedKeepYears=${policy.confirmedKeepYears} 는 0 이상의 정수여야 한다`);
  }
  const nowMs = now.getTime();
  const purge: string[] = [];
  const keep: { id: string; reason: KeepReason }[] = [];

  for (const row of rows) {
    const retentionUntil = parseInstant(row.retention_until, "retention_until", row.id);
    if (retentionUntil.getTime() >= nowMs) {
      keep.push({ id: row.id, reason: "retention_active" });
      continue;
    }
    if (isContractRecord(row)) {
      const createdAt = parseInstant(row.created_at, "created_at", row.id);
      if (legalHoldUntil(createdAt, policy.confirmedKeepYears).getTime() >= nowMs) {
        keep.push({ id: row.id, reason: "legal_hold" });
        continue;
      }
    }
    purge.push(row.id);
  }
  return { purge, keep };
}

// =============================================================================
// 어댑터
// =============================================================================

/** DB 포트 — 테스트는 이것을 mock 한다. 실제 구현은 supabasePurgeClient. */
export interface PurgeClient {
  /** retention_until < nowIso 인 행을 retention_until 오름차순으로 최대 scanLimit 건. 개인정보 컬럼은 읽지 않는다. */
  selectExpired(nowIso: string, scanLimit: number): Promise<RetentionRow[]>;
  /** 주어진 id 의 예약(과 그에 딸린 통지 로그)을 지우고, 지워진 reservations 행 수를 돌려준다. */
  deleteReservations(ids: string[]): Promise<number>;
}

export interface PurgeOptions {
  /** 기본 true. false 를 명시해야만 지운다. */
  dryRun?: boolean;
  /** 1회 삭제 상한. 기본 DEFAULT_PURGE_LIMIT(200). 1 이상 정수. */
  limit?: number;
  /** 판정 대상 조회 상한. 기본 DEFAULT_SCAN_LIMIT(1000). */
  scanLimit?: number;
  /** 판정 기준 인스턴트. 기본 new Date(). 테스트는 고정 시각을 주입한다. */
  now?: Date;
  policy?: PurgePolicy;
}

export type PurgeDecision = "purge" | "deferred" | "keep";

/** 보고서 1행 — 개인정보 없음. deferred = 지울 대상이지만 이번 실행의 limit 밖. */
export interface PurgeEntry {
  id: string;
  created_at: string;
  status: ReservationStatus;
  decision: PurgeDecision;
  reason: KeepReason | "expired" | "limit";
}

export interface PurgeReport {
  event: "retention_purge";
  dryRun: boolean;
  limit: number;
  /** 판정 기준 인스턴트(ISO UTC). */
  nowIso: string;
  /** 같은 인스턴트의 KST 달력 날짜 — 사람이 읽는 용도. */
  nowKstDate: string;
  policy: PurgePolicy;
  /** DB 에서 읽어 판정한 행 수. */
  scanned: number;
  /** scanned == scanLimit — 더 있을 수 있다. */
  scanTruncated: boolean;
  /** 지울 자격이 있는 행 수(limit 무관). */
  candidates: number;
  /** 이번 실행이 지우는(지웠을) 행 수 = min(candidates, limit). */
  wouldPurge: number;
  /** 실제로 지워진 행 수. dry-run 이면 0. */
  purged: number;
  /** candidates > limit. */
  limitReached: boolean;
  kept: Record<KeepReason, number>;
  entries: PurgeEntry[];
}

function assertLimit(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`purge: ${label}=${String(value)} 는 1 이상의 정수여야 한다 — 상한 없는 삭제는 허용하지 않는다`);
  }
}

/**
 * 배치 본체. 기본은 dry-run(보고만). `dryRun:false` 일 때만 client.deleteReservations 를 부르고, 그마저 limit 건까지만.
 * 보고서와 console.info 감사 로그에는 id·created_at·status·결정·사유만 담긴다.
 */
export async function purge(opts: PurgeOptions = {}, client: PurgeClient): Promise<PurgeReport> {
  const dryRun = opts.dryRun !== false;
  const limit = opts.limit ?? DEFAULT_PURGE_LIMIT;
  const scanLimit = opts.scanLimit ?? DEFAULT_SCAN_LIMIT;
  assertLimit(limit, "limit");
  assertLimit(scanLimit, "scanLimit");
  const now = opts.now ?? new Date();
  const policy = opts.policy ?? DEFAULT_POLICY;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("purge: now 가 유효한 Date 가 아니다");
  }
  const nowIso = now.toISOString();

  const rows = await client.selectExpired(nowIso, scanLimit);
  const selection = selectPurgeCandidates(rows, now, policy);
  const toDelete = selection.purge.slice(0, limit);
  const deleteSet = new Set(toDelete);

  const entries: PurgeEntry[] = [];
  const kept: Record<KeepReason, number> = { retention_active: 0, legal_hold: 0 };
  const keepReason = new Map(selection.keep.map((k) => [k.id, k.reason]));
  for (const r of rows) {
    const reason = keepReason.get(r.id);
    if (reason) {
      kept[reason] += 1;
      entries.push({ id: r.id, created_at: r.created_at, status: r.status, decision: "keep", reason });
    } else if (deleteSet.has(r.id)) {
      entries.push({ id: r.id, created_at: r.created_at, status: r.status, decision: "purge", reason: "expired" });
    } else {
      entries.push({ id: r.id, created_at: r.created_at, status: r.status, decision: "deferred", reason: "limit" });
    }
  }

  let purged = 0;
  if (!dryRun && toDelete.length > 0) {
    purged = await client.deleteReservations(toDelete);
  }

  const report: PurgeReport = {
    event: "retention_purge",
    dryRun,
    limit,
    nowIso,
    nowKstDate: toKstDateString(now),
    policy,
    scanned: rows.length,
    scanTruncated: rows.length >= scanLimit,
    candidates: selection.purge.length,
    wouldPurge: toDelete.length,
    purged,
    limitReached: selection.purge.length > limit,
    kept,
    entries,
  };

  // 감사 로그(임시): 구조화 JSON 한 줄. 테이블은 P5 에서.
  console.info(JSON.stringify(report));
  return report;
}

// =============================================================================
// supabase-js 구현
// =============================================================================

/** supabase-js 의 쿼리 빌더 중 이 모듈이 쓰는 표면만. 실제 SupabaseClient 를 그대로 넘기면 된다. */
type SelectResult = PromiseLike<{ data: RetentionRow[] | null; error: { message: string } | null }>;
type DeleteResult = PromiseLike<{ error: { message: string } | null; count: number | null }>;
interface SelectBuilder extends SelectResult {
  lt(column: string, value: string): SelectBuilder;
  order(column: string, opts: { ascending: boolean }): SelectBuilder;
  limit(n: number): SelectBuilder;
}
interface DeleteBuilder {
  in(column: string, values: string[]): DeleteResult;
}
export interface PurgeSupabaseLike {
  from(table: string): {
    select(columns: string): SelectBuilder;
    delete(opts?: { count?: "exact" }): DeleteBuilder;
  };
}

export const RETENTION_COLUMNS = "id, created_at, status, retention_until, confirmed_at";

export function supabasePurgeClient(supabase: PurgeSupabaseLike): PurgeClient {
  return {
    async selectExpired(nowIso, scanLimit) {
      const { data, error } = await supabase
        .from("reservations")
        .select(RETENTION_COLUMNS)
        .lt("retention_until", nowIso)
        .order("retention_until", { ascending: true })
        .limit(scanLimit);
      if (error) throw new Error(`purge: reservations 조회 실패 — ${error.message}`);
      return data ?? [];
    },
    async deleteReservations(ids) {
      if (ids.length === 0) return 0;
      // 1) 통지 로그 — FK(on delete 절 없음) 이자 to_phone 을 가진 개인정보 테이블
      const logs = await supabase.from("notifications_log").delete({ count: "exact" }).in("reservation_id", ids);
      if (logs.error) throw new Error(`purge: notifications_log 삭제 실패 — ${logs.error.message}`);
      // 2) 예약 본행
      const res = await supabase.from("reservations").delete({ count: "exact" }).in("id", ids);
      if (res.error) throw new Error(`purge: reservations 삭제 실패 — ${res.error.message}`);
      return res.count ?? ids.length;
    },
  };
}

/**
 * 공지사항(notices, 0001) 읽기 — anon 키 + RLS, 서버 액션 아님(ADR-3).
 */
import { createAnonClient, type AnonClient } from "../supabase/anon";
import type { Notice } from "../types";

const SELECT = "id,title,body,category,published_at,active";

/** limit 을 주지 않았을 때의 상한. 홈 섹션·목록 페이지가 각자 필요한 만큼 넘긴다. */
export const DEFAULT_NOTICE_LIMIT = 10;

export interface NoticeRow {
  id: number;
  title: string;
  body: string;
  category: string;
  published_at: string;
  active: boolean;
}

function toNotice(r: NoticeRow): Notice {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    category: r.category,
    publishedAt: r.published_at,
    active: r.active,
  };
}

/**
 * notices.id 는 serial(int4). 라우트 파라미터(문자열)를 여기서 검증한다 — 양의 정수(선행 0·부호·소수·지수·공백 없음)가
 * 아니면 null 이고, 호출부는 DB 에 가지 않고 404 로 보낸다(P6-3 상세 페이지). 숫자를 넘기면 같은 규칙으로 검사한다.
 */
const NOTICE_ID_PATTERN = /^[1-9]\d{0,9}$/;
const INT4_MAX = 2147483647;

export function parseNoticeId(raw: string | number): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 1 && raw <= INT4_MAX ? raw : null;
  }
  if (typeof raw !== "string" || !NOTICE_ID_PATTERN.test(raw)) return null;
  const n = Number(raw);
  return n <= INT4_MAX ? n : null;
}

/**
 * 공지 한 건 — id 로 조회하되 `active = true` 를 쿼리에도 명시한다(RLS 와 같은 조건, 정책이 바뀌어도 의도가 남게).
 * 형식이 틀린 id → null(DB 호출 0) · 부재/미공개 → null · DB 오류 → throw(404 로 위장하지 않는다).
 */
export async function getNotice(rawId: string | number, client?: AnonClient): Promise<Notice | null> {
  const id = parseNoticeId(rawId);
  if (id === null) return null;
  const db = client ?? createAnonClient();
  const { data, error } = await db
    .from("notices")
    .select(SELECT)
    .eq("id", id)
    .eq("active", true)
    .maybeSingle()
    .overrideTypes<NoticeRow | null, { merge: false }>();

  if (error) throw new Error(`getNotice: ${error.message}`);
  return data ? toNotice(data) : null;
}

/** 활성 공지 — published_at 내림차순(동률은 id 내림차순), 최대 `limit` 건. limit 은 1 이상의 정수. */
export async function getNotices(limit: number = DEFAULT_NOTICE_LIMIT, client?: AnonClient): Promise<Notice[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`getNotices: limit 은 1 이상의 정수여야 합니다 (받은 값: ${limit})`);
  }
  const db = client ?? createAnonClient();
  const { data, error } = await db
    .from("notices")
    .select(SELECT)
    .eq("active", true)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)
    .overrideTypes<NoticeRow[], { merge: false }>();

  if (error) throw new Error(`getNotices: ${error.message}`);
  return data.map(toNotice);
}

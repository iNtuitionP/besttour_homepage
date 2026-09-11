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

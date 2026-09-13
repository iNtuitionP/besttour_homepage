/**
 * 공지 게시일 표시 — 홈 NoticeSection(섹션 9)과 /notices · /notices/[id](P6-3)가 같은 함수를 쓴다.
 * date 컬럼 "YYYY-MM-DD" 든 timestamptz 든 KST 달력 날짜로 — 파싱 불가 값은 그대로 보여 준다(페이지를 죽이지 않는다).
 */
import { toKstDateString } from "@/lib/kst";

export function noticeDate(value: string): string {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? value : toKstDateString(instant);
}

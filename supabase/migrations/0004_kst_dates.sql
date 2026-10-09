-- 0004_kst_dates.sql — 0001 의 current_date(DB 세션 TZ 기준) → KST 달력 날짜 (CLAUDE.md §3 · P2-1 발견)
--
-- 버그: Supabase 의 DB 세션 타임존은 UTC 다. current_date 는 세션 TZ 의 오늘이라 KST 00:00~08:59
-- (= UTC 전날 15:00~23:59)에는 KST 기준 어제를 돌려준다. 그 결과
--   - 0001:189 popups_select_active — 그날 시작하는 팝업이 KST 00:00~08:59 에 RLS 에 가려 anon 에게 안 보인다.
--     끝난 팝업 쪽은 쿼리 계층(lib/queries/popups.ts isActiveOn)이 KST 로 다시 걸러 노출 사고는 없지만,
--     시작 쪽은 RLS 가 먼저 막으니 코드로는 살릴 수 없다.
--   - 0001:150 notices.published_at default — 같은 시간대에 올린 공지의 게시일이 전날로 찍힌다.
--
-- 고침: KST 오늘 = (now() at time zone 'Asia/Seoul')::date. 세션 TZ 와 무관하게 항상 서울 벽시계 날짜다
-- (KST 는 UTC+9 고정, 서머타임 없음). 정책 이름·구간(양 끝 포함)은 0001 과 같다 — 기준 날짜만 바뀐다.
-- 0001 은 수정하지 않는다(원격에 이미 적용됨). 0003 과 별도 파일인 이유: 관심사 분리·개별 롤백.
-- 롤백: supabase/rollbacks/0004_kst_dates.down.sql (수동 실행 전용).

-- =========================================================================
-- 1. popups 공개 조회 정책 — KST 오늘 기준
-- =========================================================================
drop policy if exists popups_select_active on popups;
create policy popups_select_active on popups
  for select using (active and (now() at time zone 'Asia/Seoul')::date between starts_at and ends_at);

-- =========================================================================
-- 2. notices.published_at default — KST 오늘
-- =========================================================================
alter table notices alter column published_at set default (now() at time zone 'Asia/Seoul')::date;

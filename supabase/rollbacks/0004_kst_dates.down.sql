-- 0004_kst_dates.down.sql — supabase/migrations/0004_kst_dates.sql 롤백 (수동 실행 전용)
--
-- rollbacks/ 에 두는 이유는 0002 롤백 헤더 참조 (migrations/ 에 두면 CLI 가 마이그레이션으로 집는다).
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 이 파일을 통째로 실행한 뒤, CLI 이력에서 0004 를 되돌린다:
--
--   supabase migration repair --status reverted 0004
--
-- 0001 원문(current_date)으로 되돌린다 — 정책 정의문은 0001 187~189행, default 는 150행과 글자 단위로 같다.
-- 되돌리면 KST 00:00~08:59 의 팝업 비노출·공지 게시일 전날 문제가 재발한다. 0004 자체에 결함이 있을 때만 쓴다.

begin;

-- 1. popups 정책 — 0001 원문
drop policy if exists popups_select_active on popups;
create policy popups_select_active on popups
  for select using (active and current_date between starts_at and ends_at);

-- 2. notices.published_at default — 0001 원문
alter table notices alter column published_at set default current_date;

commit;

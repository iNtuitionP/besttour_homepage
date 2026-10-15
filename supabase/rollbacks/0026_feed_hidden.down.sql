-- 0026_feed_hidden.down.sql — supabase/migrations/0026_feed_hidden.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다.
--
-- 🔴 순서: **코드를 먼저 0026 이전으로 되돌린 뒤** 이 파일을 돌린다. 새 코드는 hidden_from_feed 를 SELECT 하고 admin_set_feed_hidden 을 부른다 —
--    칸·함수를 먼저 지우면 홈 접수 현황이 통째로 사라지고(피드 쿼리 실패 → 섹션 숨김) 관리자 상세의 숨기기가 실패한다.
--
-- 🔴 **숨긴 행이 있으면 멈춘다.** 칸을 지우면 "홈에서 내려 달라" 던 손님의 접수가 옛 코드의 피드에 다시 나온다(개인정보 일부 재공개).
--    멈췄다면 그 접수 목록을 먼저 확인할 것(`select id, public_code from reservations where hidden_from_feed`). 정말 되돌리려면
--    같은 세션에서 `set besttour.allow_unhide = 'yes';` 를 먼저 실행한다 — 사람이 판단한 뒤에만.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0026
--
-- ## 하는 일 (0026 의 반대)
--   1. admin_set_feed_hidden(uuid, boolean) 을 지운다.
--   2. reservations.hidden_from_feed 칸을 지운다. 그 사이 숨긴 표시는 **사라진다**.
--
-- 재실행: if exists 라 몇 번 돌려도 같다.

begin;

set local lock_timeout = '5s';

do $$
declare
  has_hidden boolean := false;
begin
  -- 칸이 이미 없으면(재실행) 읽지 않는다 — 동적 SQL 이라 칸이 없는 표에서도 이 블록이 죽지 않는다.
  if exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'reservations' and column_name = 'hidden_from_feed'
     ) then
    execute 'select exists (select 1 from public.reservations where hidden_from_feed)' into has_hidden;
  end if;
  if has_hidden and coalesce(current_setting('besttour.allow_unhide', true), '') <> 'yes' then
    raise exception '0026 롤백: 홈에서 숨긴 접수가 있다 — 칸을 지우면 그 접수가 옛 코드의 홈 피드에 다시 나온다'
      using hint = '숨긴 접수를 확인한 뒤, 정말 되돌리려면 같은 세션에서 set besttour.allow_unhide = ''yes''; 를 먼저 실행할 것.';
  end if;
end
$$;

drop function if exists admin_set_feed_hidden(uuid, boolean);
alter table reservations drop column if exists hidden_from_feed;

commit;

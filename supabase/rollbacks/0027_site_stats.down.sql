-- 0027_site_stats.down.sql — supabase/migrations/0027_site_stats.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다.
--
-- 🔴 순서: **코드를 먼저 0027 이전으로 되돌린 뒤** 이 파일을 돌린다. 새 코드는 record_site_view·purge_site_visitors_seen·admin_site_stats 를 부른다 —
--    함수·표를 먼저 지우면 비콘 라우트는 조용히 204(세지 못할 뿐)이지만 매일 크론 응답에 오류가 섞이고 관리자 통계의 방문자 칸이 실패한다.
--
-- 🔴 **집계 숫자가 있으면 멈춘다.** site_stats_daily 는 날짜별 조회수·방문자 숫자를 영구 보관하는 유일한 곳이다 — 표를 지우면 되살릴 수 없다.
--    멈췄다면 숫자를 먼저 내려받을 것(`select * from site_stats_daily order by day`). 정말 지우려면 같은 세션에서
--    `set besttour.allow_drop_site_stats = 'yes';` 를 먼저 실행한다 — 사람이 판단한 뒤에만.
--    (site_visitors_seen 은 하루 단위 일회용 값이라 지워도 잃는 것이 없다.)
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0027
--
-- ## 하는 일 (0027 의 반대)
--   1. record_site_view(text) · purge_site_visitors_seen() · admin_site_stats(integer) 를 지운다.
--   2. site_visitors_seen · site_stats_daily 표를 지운다(RLS·권한도 함께 사라진다).
--
-- 재실행: if exists 라 몇 번 돌려도 같다.

begin;

set local lock_timeout = '5s';

do $$
declare
  has_rows boolean := false;
begin
  -- 표가 이미 없으면(재실행) 읽지 않는다 — 동적 SQL 이라 표가 없어도 이 블록이 죽지 않는다.
  if to_regclass('public.site_stats_daily') is not null then
    execute 'select exists (select 1 from public.site_stats_daily)' into has_rows;
  end if;
  if has_rows and coalesce(current_setting('besttour.allow_drop_site_stats', true), '') <> 'yes' then
    raise exception '0027 롤백: 방문 통계 집계 숫자가 있다 — 표를 지우면 되살릴 수 없다'
      using hint = '숫자를 내려받은 뒤, 정말 지우려면 같은 세션에서 set besttour.allow_drop_site_stats = ''yes''; 를 먼저 실행할 것.';
  end if;
end
$$;

drop function if exists record_site_view(text);
drop function if exists purge_site_visitors_seen();
drop function if exists admin_site_stats(integer);

drop table if exists site_visitors_seen;
drop table if exists site_stats_daily;

commit;

-- 0013_anon_write_privileges.down.sql — supabase/migrations/0013_anon_write_privileges.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005·0007·0008·0009·0010·0012 롤백 헤더 참조). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0013
--
-- 이 롤백이 하는 일: 0013 이 회수한 `anon` 의 쓰기 권한(7표 × insert·update·delete·truncate)을 되돌린다.
-- 데이터는 건드리지 않는다.
--
-- **승인 플래그를 언제나 요구한다 — 행 수를 보지 않는다.** (0012 독립 리뷰 M2 와 같은 규약)
-- 행이 0이라는 것은 위험이 없다는 뜻이 아니라 **아직 없다**는 뜻이다. 권한을 열어 두면 데이터는 나중에 들어온다.
-- 게다가 0013 이 회수한 것을 **필요로 하는 정상 경로가 하나도 없다** — 공개 사이트는 select 만 하고, 쓰기는 전부
-- `authenticated`(관리자 정책) 또는 서비스 롤이다. 즉 이 롤백이 조용히 도는 것이 옳은 상황은 존재하지 않는다.
-- 되돌리려면 사람이 그 판단을 명시해야 한다:
--
--   set bestour.rollback_0013_ack = '1';
--   \i supabase/rollbacks/0013_anon_write_privileges.down.sql
--
-- 특히 **TRUNCATE 를 되살린다는 뜻임을 알고 눌러야 한다** — TRUNCATE 는 RLS 의 적용을 받지 않으므로,
-- 공개 정책이 select 뿐이어도 공개 롤이 표를 통째로 비울 수 있는 상태로 돌아간다.
--
-- 재실행 가능(idempotent): `grant` 는 이미 있는 권한을 다시 줘도 오류가 아니다. 표가 없으면(0001·0002·0008 롤백이
-- 먼저 돈 상태) to_regclass 로 확인하고 그 표만 건너뛴다 — 0008·0009·0010·0012 롤백과 같은 처리.

begin;

-- =========================================================================
-- 0. 안전장치 — 조건 없음. 승인 플래그가 없으면 언제나 멈춘다 (리뷰 M2)
-- =========================================================================
do $$
begin
  if coalesce(current_setting('bestour.rollback_0013_ack', true), '') <> '1' then
    raise exception '0013 롤백 중단: 공개 롤(anon)에 7표의 insert·update·delete·TRUNCATE 를 다시 열려 한다. 이것을 필요로 하는 정상 경로는 없다 — 사람이 판단할 것'
      using hint = '되살릴 이유를 확인했으면 같은 세션에서 `set bestour.rollback_0013_ack = ''1'';` 을 실행한 뒤 다시 돌린다. TRUNCATE 는 RLS 로 막히지 않는다는 점을 알고 누를 것.';
  end if;
end
$$;

-- =========================================================================
-- 1. 7표 복원 — 있는 표에만. 0013 이 회수한 네 동작만(select 는 회수한 적이 없다)
-- =========================================================================
-- 표 이름을 한 줄씩 적는다(루프 + format(%I) 로 줄이지 않는다) — 이 파일만 읽고 "무엇이 어디로 돌아가는지" 알 수 있어야 하고,
-- 상행이 회수한 (롤·표·권한) 삼중항과 하행이 부여하는 삼중항을 tests/write-privileges.test.ts 가 **텍스트에서 직접** 대조한다.
do $$
begin
  if to_regclass('public.notices') is not null then
    execute 'grant insert, update, delete, truncate on table notices to anon';
  else raise notice '0013 롤백: notices 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.popups') is not null then
    execute 'grant insert, update, delete, truncate on table popups to anon';
  else raise notice '0013 롤백: popups 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.gallery') is not null then
    execute 'grant insert, update, delete, truncate on table gallery to anon';
  else raise notice '0013 롤백: gallery 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.gallery_albums') is not null then
    execute 'grant insert, update, delete, truncate on table gallery_albums to anon';
  else raise notice '0013 롤백: gallery_albums 가 없다 — 건너뛴다(0008 롤백이 먼저 돌았다).'; end if;

  if to_regclass('public.showcase_routes') is not null then
    execute 'grant insert, update, delete, truncate on table showcase_routes to anon';
  else raise notice '0013 롤백: showcase_routes 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.vehicles') is not null then
    execute 'grant insert, update, delete, truncate on table vehicles to anon';
  else raise notice '0013 롤백: vehicles 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.places') is not null then
    execute 'grant insert, update, delete, truncate on table places to anon';
  else raise notice '0013 롤백: places 가 없다 — 건너뛴다(0002 롤백이 먼저 돌았다).'; end if;
end
$$;

commit;

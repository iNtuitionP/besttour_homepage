-- 0006_trip_return_check.down.sql — supabase/migrations/0006_trip_return_check.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다(0002 참조).
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0006
--
-- 주의: 롤백은 CHECK 를 **좁힌다**. oneway_oneway 이면서 return_at 이 있는 행이 하나라도 있으면 0001 원문 CHECK 를
-- 복원할 수 없다. 그 행들은 사람이 먼저 판단해야 한다(귀가 일시를 지울지, 롤백을 포기할지). 조용히 지우지 않는다.

begin;

do $$
declare n int;
begin
  select count(*) into n from reservations where trip_type = 'oneway_oneway' and return_at is not null;
  if n > 0 then
    raise exception '0006 롤백 중단: oneway_oneway + return_at 행 % 건 — 0001 CHECK 로 되돌리면 이 행들이 위반이 된다. 사람이 먼저 처리할 것', n;
  end if;
end $$;

alter table reservations
  drop constraint if exists reservations_round_trip_return_ck;

alter table reservations
  add constraint reservations_round_trip_return_ck
    check ((trip_type = 'round') = (return_at is not null));

commit;

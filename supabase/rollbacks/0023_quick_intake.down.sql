-- 0023_quick_intake.down.sql — supabase/migrations/0023_quick_intake.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다(0005~0022 롤백 헤더와 같다).
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0023
--
-- ## 하는 일
-- 0023 의 반대 — 새 CHECK 셋(intake_ck · intake_fields_ck · quick_passengers_ck)과 intake 칸을 지우고, 차종·목적·대수를 다시 NOT NULL 로(대수 기본값 1 복구), round_trip CHECK 를 0006 판으로 되돌린다.
--
-- ## 🔴 간편 접수(intake='quick') 행이 한 건이라도 있으면 **멈춘다** — 지우지도 채우지도 않는다
-- 간편 행은 차종·목적·대수가 null 이다. NOT NULL 을 되살리려면 그 값을 **지어내거나**(허위 기록) 행을 **지워야**(고객 접수 유실) 한다.
-- 롤백이 어느 쪽도 스스로 하지 않는다. 사람이 먼저:
--   ① 앱을 0023 이전 코드로 되돌린다(새 간편 접수가 더 들어오지 않게 — 반대로 하면 그 사이 접수가 전부 실패한다).
--   ② 간편 행을 관리자 화면에서 처리(전화 확인)하고, 필요한 기록은 반출한다.
--   ③ 그 행들을 어떻게 할지(삭제 · 전화로 확인한 실제 값으로 채워 wizard 로 바꾸기)를 사람이 정해 실행한다.
--   ④ 이 파일을 다시 돌린다.
-- 건수는 **쓰기 잠금을 쥔 뒤에** 센다 — 세는 사이에 새 간편 접수가 들어와 NOT NULL 복구가 23502 로 터지는 틈을 없앤다.
--
-- ## admin_stats(0023 §2)는 되돌리지 않는다
-- 0023 §2 는 admin_stats 의 "기타" 대수 한 줄만 바꿨다(접힌 칸에 대수 미상이 섞이면 null). 그 본문은 intake 를 읽지 않아
-- 0022 스키마에서도 그대로 돈다 — 되돌릴 필요가 없고, 되돌리면 함수를 한 번 더 건드리는 위험만 는다. 정말 0022 판이 필요하면
-- 0022 파일의 `create or replace function admin_stats` 문장 하나만 다시 실행한다(create or replace — 권한 불변).
--
-- ## 권한
-- 0023 은 권한 문장이 0 개였다. 이 파일도 권한을 바꾸지 않는다(칸을 지우면 그 칸의 ACL 이 함께 사라지는데, 0023 은 칸 ACL 을 만들지 않았다).
--
-- 재실행: intake 칸이 없으면 NOTICE 만 남기고 아무것도 하지 않는다.

begin;

set local lock_timeout = '5s';

do $$
declare
  n_quick bigint;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.reservations'::regclass and attname = 'intake' and not attisdropped) then
    raise notice '0023 롤백: reservations.intake 가 없다 — 되돌릴 것이 없다.';
    return;
  end if;

  -- 쓰기 잠금 — 여기부터 커밋까지 새 접수는 들어오지 않는다(읽기는 된다).
  lock table public.reservations in exclusive mode;

  select count(*) into n_quick from public.reservations where intake = 'quick';
  if n_quick > 0 then
    raise exception '0023 롤백: 간편 접수(intake=quick) 행이 % 건 있다 — 차종·목적·대수가 비어 있어 NOT NULL 을 되살릴 수 없다', n_quick
      using hint = '이 파일 헤더의 ①~④ 를 먼저 한다. 롤백이 값을 지어내거나 행을 지우지 않는다.';
  end if;

  alter table public.reservations drop constraint if exists reservations_quick_passengers_ck;
  alter table public.reservations drop constraint if exists reservations_intake_fields_ck;
  alter table public.reservations drop constraint if exists reservations_intake_ck;
  alter table public.reservations drop constraint if exists reservations_round_trip_return_ck;
  alter table public.reservations add constraint reservations_round_trip_return_ck check (
       (trip_type = 'round'         and return_at is not null)
    or (trip_type = 'oneway_oneway')
    or (trip_type = 'oneway'        and return_at is null)
  );
  alter table public.reservations
    alter column vehicle_slug set not null,
    alter column purpose_code set not null,
    alter column bus_count set default 1,
    alter column bus_count set not null;
  alter table public.reservations drop column intake;

  raise notice '0023 롤백: intake 제거 · 차종·목적·대수 NOT NULL 복구(대수 기본값 1) · round_trip CHECK 0006 판 복구. 이제 supabase migration repair --status reverted 0023';
end
$$;

commit;

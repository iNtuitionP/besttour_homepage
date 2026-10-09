-- 0010_admin_reservation_actions.down.sql — supabase/migrations/0010_admin_reservation_actions.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005·0007·0008·0009 롤백 헤더 참조). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0010
--
-- 이 롤백이 하는 일: 함수 4개를 지우고 0009 의 `reservations_admin_update` 정책과 update 권한을 되살린다.
-- **되살리는 방향이 위험한 롤백이다.** 그 정책은 컬럼을 제한하지 않아서, 되돌리는 순간 관리자 세션이 다시
-- retention_until(파기 예정)·privacy_consent_at(동의 기록)까지 PostgREST 로 고칠 수 있게 된다(리뷰 N5 가 지적한 상태).
-- 그래서 reservations 에 행이 있으면 아래 가드가 먼저 멈춰 세운다 — 고객 데이터가 들어 있는 표에 넓은 쓰기 문을
-- 다시 여는 것은 사람이 판단할 일이다. 판단을 마쳤으면 같은 세션에서 승인 플래그를 켜고 다시 실행한다:
--
--   set bestour.rollback_0010_ack = '1';
--   \i supabase/rollbacks/0010_admin_reservation_actions.down.sql
--
-- 데이터는 건드리지 않는다: 이미 확정된 예약의 status·confirmed_at·admin_memo, 큐에 쌓인 통지는 그대로 둔다.
-- 그것들은 "실제로 일어난 일"의 기록이고, 되돌리면 발송기가 이미 보낸 문자와 어긋난다(0007 롤백 헤더와 같은 원칙).
--
-- 재실행 가능(idempotent): 없는 함수를 지우고(if exists), 정책은 drop 뒤 create 한다. 0009 롤백이 먼저 돌아
-- is_admin() 이나 표가 사라진 상태면 복원을 건너뛴다(to_regproc·to_regclass) — 없는 함수를 쓰는 정책은 만들 수 없다.

begin;

-- =========================================================================
-- 0. 안전장치 — 고객 데이터가 있는데 넓은 update 문을 되살리려 하면 멈춘다 (0003·0009 롤백과 같은 규약)
-- =========================================================================
do $$
declare
  n bigint;
begin
  if to_regclass('public.reservations') is null then
    raise notice '0010 롤백: reservations 가 없다 — 가드를 건너뛴다(재실행 또는 초기 스키마 이전).';
  else
    select count(*) into n from reservations;
    if n > 0 and coalesce(current_setting('bestour.rollback_0010_ack', true), '') <> '1' then
      raise exception '0010 롤백 중단: reservations 에 행 % 건 — 컬럼 제한 없는 update 정책을 되살리려 한다(리뷰 N5 상태로 복귀). 사람이 판단할 것', n
        using hint = '되살릴 이유를 확인했으면 같은 세션에서 `set bestour.rollback_0010_ack = ''1'';` 을 실행한 뒤 다시 돌린다. 행을 지우지 말 것.';
    end if;
  end if;
end
$$;

-- =========================================================================
-- 1. 0009 상태 복원 — 정책 + 권한. is_admin() 과 표가 살아 있을 때만.
-- =========================================================================
do $$
begin
  if to_regclass('public.reservations') is null then
    raise notice '0010 롤백: reservations 가 없어 정책 복원을 건너뛴다.';
  elsif to_regproc('public.is_admin') is null then
    raise notice '0010 롤백: is_admin() 이 없다(0009 가 이미 롤백됨) — 정책 복원을 건너뛴다.';
  else
    execute 'drop policy if exists reservations_admin_update on reservations';
    execute 'create policy reservations_admin_update on reservations for update to authenticated using (is_admin()) with check (is_admin())';
    execute 'grant update on table reservations to authenticated';
  end if;
end
$$;

-- =========================================================================
-- 2. 함수 — 인자 타입까지 적어 오버로드를 남기지 않는다
-- =========================================================================
drop function if exists admin_confirm_reservation(uuid, text);
drop function if exists admin_cancel_reservation(uuid, text);
drop function if exists admin_complete_reservation(uuid, text);
drop function if exists admin_update_memo(uuid, text);

commit;

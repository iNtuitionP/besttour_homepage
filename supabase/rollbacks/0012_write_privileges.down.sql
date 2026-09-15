-- 0012_write_privileges.down.sql — supabase/migrations/0012_write_privileges.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005·0007·0008·0009·0010 롤백 헤더 참조). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0012
--
-- 이 롤백이 하는 일: 0012 가 회수한 쓰기 권한을 `anon`·`authenticated` 에게 되돌린다. 데이터는 건드리지 않는다.
--
-- **되살리는 방향이 위험한 롤백이다.** 되돌리는 순간 reservations·notifications_log 는 다시 "RLS 가 유일한 방어선" 상태가 된다.
-- 특히 TRUNCATE 는 RLS 의 적용을 받지 않으므로, 그 권한을 가진 롤로 DB 에 붙을 수 있으면 고객 개인정보 표를 통째로 비울 수 있다.
-- 그래서 아래 가드가 **언제나** 멈춰 세운다 — 판단을 마쳤으면 같은 세션에서 승인 플래그를 켜고 다시 실행한다:
--
--   set bestour.rollback_0012_ack = '1';
--   \i supabase/rollbacks/0012_write_privileges.down.sql
--
-- **행 수를 조건으로 걸지 않는다** (독립 리뷰 M2). 처음에는 "행이 있을 때만" 물었는데, 그러면 빈 DB —
-- 즉 오픈 전인 **지금 이 프로젝트의 상태** — 에서는 롤백이 말없이 통과하고 개인정보 표 두 개에 TRUNCATE 를 포함한
-- 15종의 쓰기 권한이 조용히 복원된다. 행이 0인 것은 위험이 없다는 뜻이 아니라 **아직 없다**는 뜻이다:
-- 권한은 열린 채로 남고 데이터는 나중에 들어온다. 게다가 0012 가 회수한 것을 필요로 하는 정상 경로가 하나도 없으므로
-- (서비스 롤·definer 함수·관리자 select 는 전부 영향을 받지 않는다), 이 롤백이 조용히 도는 것이 옳은 상황은 존재하지 않는다.
--
-- **0010 이 닫은 문은 되살리지 않는다.** `reservations` 의 UPDATE → `authenticated` 는 0012 가 회수한 것이 아니라
-- 0010 §6 이 회수한 것이다(독립 리뷰 N5: 컬럼 제한 없는 update 정책으로 관리자가 retention_until·privacy_consent_at 까지
-- 고칠 수 있었다). 여기서 그것까지 부여하면 롤백이 0012 이전 상태가 아니라 **0010 이전 상태**로 되돌리는 셈이 된다.
-- 그 문을 다시 열어야 한다면 0010 롤백을 쓴다(거기에도 별도의 승인 가드가 있다).
--
-- 재실행 가능(idempotent): `grant` 는 이미 있는 권한을 다시 줘도 오류가 아니다. 표가 없으면(0001 롤백이 먼저 돈 상태)
-- to_regclass 로 확인하고 건너뛴다 — 0008·0009·0010 롤백과 같은 처리.

begin;

-- =========================================================================
-- 0. 안전장치 — 조건 없음. 승인 플래그가 없으면 언제나 멈춘다 (독립 리뷰 M2)
--    행 수는 판정에 쓰지 않고 **메시지에만** 싣는다 — 사람이 "무엇을 지키려는 것인지" 를 보고 판단하도록.
-- =========================================================================
do $$
declare
  n bigint := 0;
  m bigint := 0;
begin
  if to_regclass('public.reservations') is not null then
    select count(*) into n from reservations;
  end if;
  if to_regclass('public.notifications_log') is not null then
    select count(*) into m from notifications_log;
  end if;

  if coalesce(current_setting('bestour.rollback_0012_ack', true), '') <> '1' then
    raise exception '0012 롤백 중단: 고객 개인정보 표에 쓰기 권한을 다시 열려 한다(TRUNCATE 포함 — RLS 로는 막히지 않는다). 현재 reservations % 건 · notifications_log % 건이며, 행이 0이어도 멈춘다(권한은 열린 채로 남고 데이터는 나중에 들어온다). 사람이 판단할 것', n, m
      using hint = '되살릴 이유를 확인했으면 같은 세션에서 `set bestour.rollback_0012_ack = ''1'';` 을 실행한 뒤 다시 돌린다. 행을 지우지 말 것.';
  end if;
end
$$;

-- =========================================================================
-- 1. notifications_log — 0012 §1 이 회수한 네 동작
-- =========================================================================
do $$
begin
  if to_regclass('public.notifications_log') is null then
    raise notice '0012 롤백: notifications_log 가 없다 — 복원을 건너뛴다(0001 롤백이 먼저 돌았거나 초기 스키마 이전).';
  else
    execute 'grant insert, update, delete, truncate on table notifications_log to anon, authenticated';
  end if;
end
$$;

-- =========================================================================
-- 2. reservations — 0012 §2 가 회수한 것만.
--    update 는 `anon` 에게만 돌려준다. `authenticated` 의 update 는 0010 소관이다(파일 헤더).
-- =========================================================================
do $$
begin
  if to_regclass('public.reservations') is null then
    raise notice '0012 롤백: reservations 가 없다 — 복원을 건너뛴다(0001 롤백이 먼저 돌았거나 초기 스키마 이전).';
  else
    execute 'grant insert, delete, truncate on table reservations to anon, authenticated';
    execute 'grant update on table reservations to anon';
  end if;
end
$$;

commit;

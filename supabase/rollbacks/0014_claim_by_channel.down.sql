-- 0014_claim_by_channel.down.sql — supabase/migrations/0014_claim_by_channel.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005·0007·0008·0009·0010·0012·0013 롤백 헤더와 같다). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0014
--
-- 이 롤백이 하는 일: 2-인자 함수를 지우고 0005 의 1-인자 `claim_pending_notifications(p_limit)` 를 그대로 복원한다.
-- 표·행·인덱스·정책은 건드리지 않는다.
--
-- **되돌리면 무슨 일이 일어나는지 알고 눌러야 한다.**
-- 1-인자 함수는 채널을 가리지 않는다. 그러면 사장님 번호가 없어 생긴 `channel='email'` 행을 문자 어댑터가 다시 집어가고,
-- 그 행은 `unsupported_channel:email` 로 **attempts 5회를 확정적으로 태운 뒤 failed 로 종착한다.**
-- 고객 문자는 나가고 사장님 알림만 조용히 죽는, 0014 가 막으려던 바로 그 상태로 돌아간다.
-- 게다가 지금 워커(lib/notify/worker.ts)는 claim 을 **2인자로** 부른다 — 이 롤백을 돌리면 그 호출이
-- "함수 없음(PGRST202 / 42883)" 으로 떨어져 **발송이 통째로 멈춘다.** 코드를 함께 되돌리지 않으면 롤백은 반쪽이다.
--
-- **승인 플래그를 언제나 요구한다 — 행 수를 보지 않는다.** (0012 독립 리뷰 M2 · 0013 과 같은 규약)
-- 큐가 비어 있다는 것은 위험이 없다는 뜻이 아니라 **아직 없다**는 뜻이다. 접수는 내일 들어온다.
--
--   set bestour.rollback_0014_ack = '1';
--   \i supabase/rollbacks/0014_claim_by_channel.down.sql
--
-- 재실행 가능(idempotent): drop 은 if exists, create 는 or replace, grant/revoke 는 같은 상태를 다시 만들어도 오류가 아니다.
-- 표가 없으면(0005 롤백이 먼저 돈 상태) 함수 본문이 참조할 대상이 없으므로 create 자체가 실패한다 — 그때는
-- 0005 롤백까지 되돌린 상태이므로 이 파일을 돌릴 이유가 없다.

begin;

-- =========================================================================
-- 0. 안전장치 — 조건 없음. 승인 플래그가 없으면 언제나 멈춘다 (리뷰 M2)
-- =========================================================================
do $$
begin
  if coalesce(current_setting('bestour.rollback_0014_ack', true), '') <> '1' then
    raise exception '0014 롤백 중단: claim 이 다시 채널을 가리지 않게 된다 — 사장님 메일 행을 문자 어댑터가 집어가 attempts 5회를 태우고 죽인다. 게다가 현재 워커는 claim 을 2인자로 부르므로 발송이 통째로 멈춘다'
      using hint = '되돌릴 이유를 확인했으면 같은 세션에서 `set bestour.rollback_0014_ack = ''1'';` 을 실행한 뒤 다시 돌린다. 코드(lib/notify/worker.ts·router.ts)도 함께 되돌려야 발송이 이어진다.';
  end if;
end
$$;

-- =========================================================================
-- 1. 2-인자 제거 → 0005 의 1-인자 복원
-- =========================================================================
drop function if exists claim_pending_notifications(int, text[]);

-- 0005 §4 의 본문 그대로다(채널 조건 없음 · search_path 도 0005 와 같게 되돌린다).
create or replace function claim_pending_notifications(p_limit int default 10)
returns setof notifications_log
language sql
security definer
set search_path = public
as $$
  with picked as (
    select id
    from notifications_log
    where status = 'pending' and next_attempt_at <= now() and attempts < 5
    order by created_at
    limit greatest(coalesce(p_limit, 0), 0)
    for update skip locked
  )
  update notifications_log n
  set attempts        = n.attempts + 1,
      updated_at      = now(),
      next_attempt_at = now() + interval '5 minutes'
  from picked
  where n.id = picked.id
  returning n.*;
$$;

-- =========================================================================
-- 2. 실행 권한 복원 — drop + create 는 ACL 을 초기화하고, 이 DB 의 default privileges 가
--    anon·authenticated 에게 EXECUTE 를 **자동으로 다시 부여한다**. 0005 §6 과 같은 삼중항으로 잠근다.
-- =========================================================================
revoke all on function claim_pending_notifications(int) from public, anon, authenticated;
grant execute on function claim_pending_notifications(int) to service_role;

do $$
declare
  fn_oid oid := to_regprocedure('public.claim_pending_notifications(int)')::oid;
begin
  if fn_oid is null then
    raise exception '0014 롤백: 1-인자 함수가 복원되지 않았다';
  end if;
  if has_function_privilege('anon', fn_oid, 'execute') or has_function_privilege('authenticated', fn_oid, 'execute') then
    raise exception '0014 롤백: 복원한 함수의 EXECUTE 가 공개 롤에 남아 있다'
      using hint = 'revoke all … from public, anon, authenticated 가 create 뒤에 있는지 확인할 것.';
  end if;
end
$$;

-- PostgREST 는 시그니처를 캐시한다 — 되돌린 시그니처를 즉시 보게 한다.
notify pgrst, 'reload schema';

commit;

-- 0014_claim_by_channel.sql — claim 이 채널을 가리게 한다 (플랜 v4 P4-5 · ADR-7)
--
-- 무엇이 잘못돼 있었나. 0005 `claim_pending_notifications(p_limit)` 의 where 절은
-- `status = 'pending' and next_attempt_at <= now() and attempts < 5` 뿐이다 — **channel 조건이 없다.**
-- 그래서 사장님 번호(OWNER_PHONE)가 없어 만들어진 `channel='email'` 행을 문자 어댑터가 집어간다.
-- 문자 어댑터는 그 행을 `unsupported_channel:email`(retryable:false)로 돌려주고, 행은 다섯 번을 확정적으로
-- 실패한 뒤 failed 로 종착한다. 즉 지금 상태로 문자 서비스 키를 넣으면 **고객 문자는 나가고 사장님 알림만 조용히 죽는다.**
-- 화면에는 "실패" 로만 남는다.
--
-- 발송기의 대원칙은 "**보낼 수 없으면 claim 하지 않는다**" 다(lib/notify/worker.ts 헤더). claim 은 attempts 를 +1 하고
-- lease 를 건다 — 되돌릴 수 없다. 그 원칙이 sender **전체**에만 걸려 있었고 **채널 단위로는 걸려 있지 않았다.**
-- 이 파일이 그 원칙을 채널까지 내린다: 발송기가 "내가 보낼 수 있는 채널" 을 넘기고, 그 밖의 행은 집지 않는다.
-- 집히지 않은 행은 pending 그대로, attempts 0 그대로 큐에 남는다 — **키가 온 날 그대로 나간다.**
--
-- 왜 기본값 추가로는 안 되나. `create or replace` 에 인자를 더하면 Postgres 는 그것을 **새 함수**로 본다.
-- 1-인자 구버전이 그대로 남아 두 함수가 공존하면 `claim_pending_notifications(10)` 호출이 **모호(42725)** 해져
-- 발송기가 통째로 멈춘다. 그래서 반드시 **구버전을 먼저 drop** 한다.
--
-- 하위 호환: `p_channels` 가 null 이면 0005 와 **완전히 같은 동작**(전 채널)이다. 롤백한 DB 나 구버전 워커가
-- `{p_limit}` 만 보내도 기본값 null 이 받아 그대로 돈다. 다만 그 경로는 이 마이그레이션이 고치려는 옛 동작 그대로라는
-- 점을 알고 있어야 한다 — 실제 수정은 **호출부(lib/notify/worker.ts 가 sender.channels 를 넘기는 것)까지** 가야 완성된다.
--
-- **drop + create 는 함수 ACL 을 초기화한다. 그리고 이 프로젝트의 DB 에는**
--   `alter default privileges for role postgres in schema public grant all on functions to anon, authenticated;`
-- **가 걸려 있다(2026-09-16 컨트롤러 실측).** 즉 새로 만든 함수의 EXECUTE 가 공개 롤에게 "빠뜨려서 남는" 것이 아니라
-- **적극적으로 부여된다.** 그대로 두면 anon 이 PostgREST /rpc 로 아웃박스 큐를 변경하고(attempts +1 · lease)
-- 통지 행 전체(수신처 포함)를 돌려받을 수 있다 — 0012 가 표 권한을 회수해 둔 것이 함수 하나로 무의미해진다.
-- 그래서 아래 §3 의 revoke/grant 는 **같은 트랜잭션 안에서** 끝나야 한다(이 파일에는 commit 이 없다 — CLI 가 파일 하나를
-- 한 트랜잭션으로 적용한다). §4 ② 가 그것을 실행 중에 다시 확인한다.
--
-- 기존 행 영향: 함수 정의만 바꾼다. 표·컬럼·CHECK·인덱스·정책 변경 0, 데이터 변경 0.
--   (§4 ③ 의 자기검증이 임시 행 2건을 넣지만 같은 블록에서 되돌린다 — 표에 남지 않는다.)
-- 재실행 안전: drop 은 if exists, create 는 or replace, revoke/grant 는 멱등이다.
-- 롤백: supabase/rollbacks/0014_claim_by_channel.down.sql (수동 실행 전용 · 승인 플래그 **무조건** 요구)

-- lock_timeout 상한 (P5-15 R7): CLI 가 이 파일을 한 트랜잭션으로 돌려 set local 은 이 파일에만 걸린다 — 잠금을 5초 넘게 기다리면 파일째 롤백.
set local lock_timeout = '5s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0014: 앞 문장의 set local lock_timeout 이 남지 않았다 (지금 %) — 파일이 한 트랜잭션으로 돌지 않는 경로다. 아무것도 바꾸기 전에 멈춘다', current_setting('lock_timeout')
      using hint = 'supabase db push 로 적용할 것(파일 하나 = 트랜잭션 하나). psql -f 처럼 문장마다 커밋하는 경로에서는 set local 이 그 문장에서 끝난다(PostgreSQL 은 경고만 낸다).';
  end if;
end
$$;

-- =========================================================================
-- 1. 구버전 제거 — create 보다 **반드시 앞**
-- =========================================================================
drop function if exists claim_pending_notifications(int);

-- =========================================================================
-- 2. 새 함수 — 채널 화이트리스트를 받는다
-- =========================================================================
-- p_channels:
--   null        전 채널 (0005 와 같은 동작)
--   '{sms}'     문자 행만
--   '{}'        **0행** — `= any('{}')` 는 어떤 값과도 참이 되지 않는다. "전 채널" 이 아니다.
-- 나머지(for update skip locked · attempts+1 · lease 5분 · security definer)는 0005 와 한 글자도 다르지 않다.
-- search_path 에 pg_temp 를 붙인 이유: security definer 함수의 표준 방어다. 임시 스키마가 먼저 검색되면
-- 호출자가 만든 `pg_temp.notifications_log` 가 진짜 표를 가릴 수 있다(0009·0010 과 같은 형태).
create or replace function claim_pending_notifications(p_limit int default 10, p_channels text[] default null)
returns setof notifications_log
language sql
security definer
set search_path = public, pg_temp
as $$
  with picked as (
    select id
    from notifications_log
    where status = 'pending'
      and next_attempt_at <= now()
      and attempts < 5
      and (p_channels is null or channel = any (p_channels))
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
-- 3. 실행 권한 — drop 이 지운 ACL 을 **같은 트랜잭션에서** 다시 잠근다 (0005 §6 과 같은 삼중항)
-- =========================================================================
revoke all on function claim_pending_notifications(int, text[]) from public, anon, authenticated;
grant execute on function claim_pending_notifications(int, text[]) to service_role;

-- =========================================================================
-- 4. 자기검증 — 조용히 어긋나는 것 세 가지를 실행 중에 못박는다 (0012·0013 과 같은 규약)
--    ① 1-인자 구버전이 남아 있는가(= 호출이 모호해진다)
--    ② 새 함수의 EXECUTE 를 service_role 말고 누가 갖고 있는가(= 공개 롤이 큐를 만질 수 있다)
--    ③ 채널 필터가 실제로 듣는가(= 메일 행이 '{sms}' claim 에 섞여 나오는가)
-- =========================================================================
do $$
declare
  fn_sig      constant text := 'public.claim_pending_notifications(int, text[])';
  probe_mark  constant text := '0014-self-check';
  fn_oid      oid;
  holders     text;
  probe_email int := -1;
  probe_sms   int := -1;
begin
  -- ① 구버전 잔존
  if to_regprocedure('public.claim_pending_notifications(int)') is not null then
    raise exception '0014: 1-인자 구버전 claim_pending_notifications(int) 가 아직 있다 — 두 함수가 공존하면 1-인자 호출이 모호(42725)해져 발송기가 멈춘다'
      using hint = 'drop function if exists claim_pending_notifications(int); 가 create 보다 앞에 있는지 확인할 것. create or replace 에 인자를 더하면 Postgres 는 기존 함수를 대체하지 않고 새 함수를 만든다.';
  end if;

  fn_oid := to_regprocedure(fn_sig)::oid;
  if fn_oid is null then
    raise exception '0014: 새 시그니처 % 가 만들어지지 않았다', fn_sig
      using hint = 'create 문의 인자 형태(p_limit int default 10, p_channels text[] default null)를 확인할 것.';
  end if;

  -- ② EXECUTE 보유자 — service_role(과 함수 소유자) 뿐이어야 한다.
  --    이 DB 에는 default privileges 로 anon·authenticated 에게 함수 EXECUTE 를 주는 설정이 있다(헤더 참조).
  --    drop+create 직후에는 그 권한이 **자동으로 붙어 있다** — §3 의 revoke 가 그것을 걷어낸 상태여야 한다.
  if has_function_privilege('anon', fn_oid, 'execute') or has_function_privilege('authenticated', fn_oid, 'execute') then
    raise exception '0014: 공개 롤이 claim RPC 를 실행할 수 있다 (anon=% · authenticated=%) — 큐를 변경하고 수신처가 든 행을 돌려받을 수 있다',
      has_function_privilege('anon', fn_oid, 'execute'), has_function_privilege('authenticated', fn_oid, 'execute')
      using hint = 'drop + create 는 함수 ACL 을 초기화하고, 이 DB 의 alter default privileges 가 anon·authenticated 에 EXECUTE 를 다시 부여한다. §3 의 revoke all … from public, anon, authenticated 가 create 뒤에 같은 트랜잭션으로 있어야 한다.';
  end if;

  select string_agg(distinct g, ', ')
    into holders
    from (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as g
        from pg_proc p
        cross join lateral aclexplode(p.proacl) a
       where p.oid = fn_oid and a.privilege_type = 'EXECUTE'
    ) s
   where s.g <> 'service_role'
     and s.g <> (select pg_get_userbyid(proowner) from pg_proc where oid = fn_oid);
  if holders is not null then
    raise exception '0014: claim RPC 의 EXECUTE 를 service_role 말고도 갖고 있다 — %', holders
      using hint = 'PUBLIC 이 보이면 revoke 문에 public 이 빠졌거나 create 뒤가 아니라 앞에 있다. 다른 롤이 보이면 이 파일 밖에서 grant 한 것이다.';
  end if;

  if not has_function_privilege('service_role', fn_oid, 'execute') then
    raise exception '0014: service_role 이 claim RPC 를 실행할 수 없다 — 발송기가 통째로 멈춘다'
      using hint = 'grant execute on function claim_pending_notifications(int, text[]) to service_role; 이 revoke 뒤에 있는지 확인할 것.';
  end if;

  -- ③ 채널 필터 — 임시 행 2건을 넣고 실제로 불러 본 뒤 되돌린다(서브트랜잭션).
  --    created_at 을 과거로 못박아 우리 행이 order by created_at 의 맨 앞에 오게 한다(다른 pending 행에 밀리지 않는다).
  begin
    insert into notifications_log (reservation_id, event, channel, to_phone, template, status, created_at)
    values (null, 'created', 'email', probe_mark, 'created.owner.email',   'pending', timestamptz '1970-01-01'),
           (null, 'created', 'sms',   probe_mark, 'created.customer.sms',  'pending', timestamptz '1970-01-02');

    select count(*) filter (where channel = 'email'), count(*) filter (where channel = 'sms')
      into probe_email, probe_sms
      from claim_pending_notifications(2, array['sms'])
     where to_phone = probe_mark;

    -- 여기서 일부러 터뜨려 위 insert·claim 을 전부 되돌린다. 아래 exception 절이 이 문구만 삼킨다.
    raise exception '0014_probe_rollback';
  exception
    when raise_exception then
      if sqlerrm <> '0014_probe_rollback' then
        raise;
      end if;
  end;

  if probe_email <> 0 or probe_sms <> 1 then
    raise exception '0014: 채널 필터가 듣지 않는다 — p_channels => ''{sms}'' 로 부른 결과에 임시 메일 행 %건 · 임시 문자 행 %건 (기대: 0건 · 1건)', probe_email, probe_sms
      using hint = 'where 절에 (p_channels is null or channel = any (p_channels)) 가 있는지 확인할 것. 두 값이 모두 -1 이면 자기검증 블록이 결과를 받지 못한 것이다(서브트랜잭션 구조를 확인).';
  end if;
end
$$;

-- =========================================================================
-- 5. PostgREST 스키마 캐시 갱신
-- =========================================================================
-- 함수 **시그니처**가 바뀌었다. PostgREST 는 스키마를 캐시해 두고 그것으로 인자 이름을 맞추므로, 갱신 없이는
-- `{p_limit, p_channels}` 호출이 "함수를 찾을 수 없다(PGRST202)" 로 떨어질 수 있다. 커밋 시점에 알림이 나간다.
-- (로컬 `db reset` 은 컨테이너를 다시 세우므로 이것 없이도 보이지만, 원격 `db push` 에는 필요하다.)
notify pgrst, 'reload schema';

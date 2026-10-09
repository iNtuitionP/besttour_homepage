-- 0016_privileges_rls_cannot_protect.down.sql — supabase/migrations/0016_privileges_rls_cannot_protect.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005·0007·0008·0009·0010·0012·0013·0014·0015 롤백 헤더와 같다). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0016
--
-- 이 롤백이 하는 일(0016 이 한 것의 정확한 역):
--   ① 일곱 표에서 `authenticated` 에게 TRUNCATE·TRIGGER·REFERENCES 를 되돌려 준다
--   ② 같은 일곱 표에서 `anon` 에게 TRIGGER·REFERENCES 를 되돌려 준다
--   ③ `places` 에서 `authenticated` 에게 insert·update·delete 를 되돌려 준다
--   ④ definer 함수 셋의 `search_path` 를 옛 형태(`public` — pg_temp 없음)로 되돌린다
-- 표·컬럼·행·CHECK·인덱스·정책은 한 글자도 건드리지 않는다. **함수 본문 로직도 그대로다**(0005·0007 원문).
-- 0013 이 회수한 `anon` 의 네 동작과 0009 가 준 콘텐츠 6표 CRUD 는 **건드리지 않는다** — 0016 이 회수하지 않았다.
--
-- ## 승인 플래그를 요구한다 — 판단과 근거
-- 0015 롤백 헤더가 세운 기준을 그대로 쓴다: **"실행이 안전한가" 가 아니라 "실행한 뒤의 세계가 조용히 위험한가".**
-- 이 롤백은 실행 자체는 안전하다 — 데이터가 사라지지 않고 잘못 눌러도 0016 을 다시 적용하면 된다.
-- 그런데 되돌려 놓는 세계가 정확히 **조용한 종류**다. 세 가지 전부 오류도, 로그도, 화면의 변화도 없다:
--   · **TRUNCATE 는 RLS 의 적용을 받지 않는다.** 정책이 몇 개든 상관없이 그 권한을 가진 롤이 붙으면 표가 한 문장에
--     통째로 빈다. 지워진 뒤에 알게 된다.
--   · **TRIGGER 는 `supabase_functions.http_request` 를 붙일 수 있게 한다**(anon·authenticated 모두 그 함수의
--     EXECUTE 를 갖고 있다 — 2026-09-16 실측). 붙는 순간부터 그 표의 모든 변경이 외부 URL 로 흘러 나가고,
--     사이트는 아무 일 없이 정상 동작한다. 유출은 화면에 나타나지 않는다.
--   · **`search_path` 에서 `pg_temp` 를 빼면** 호출자가 만든 임시 표가 definer 함수 안의 `notifications_log` 를
--     가릴 수 있다(P4-5 리뷰 K2 실증). 함수는 오류 없이 **엉뚱한 표를 고치고** 성공을 돌려준다.
-- 그리고 **되돌린 것을 필요로 하는 정상 경로가 하나도 없다.** 관리자 화면은 TRUNCATE 를 쓰지 않고(한 행씩 지운다),
-- 아무도 트리거를 만들지 않으며, `places` 에는 쓰기 화면이 아예 없다. 즉 이 롤백이 **조용히 도는 것이 옳은 상황은
-- 존재하지 않는다** — 손이 미끄러져서는 안 된다.
-- 행 수는 조건에 넣지 않는다(0012 독립 리뷰 M2 와 같은 근거): 지금 콘텐츠 표가 비어 있다는 것은 위험이 없다는 뜻이
-- 아니라 **아직 없다**는 뜻이다. 사진과 공지는 내일 들어온다.
--
--   set bestour.rollback_0016_ack = '1';
--   \i supabase/rollbacks/0016_privileges_rls_cannot_protect.down.sql
--
-- ## ④ 에 대한 주의 — 일부러 약한 형태로 되돌린다
-- P4-5 리뷰 K2 는 "롤백이 `set search_path = public` 을 되살리는 것" 을 지적했다. 그 지적은 옳다. 그럼에도
-- 여기서 옛 형태로 되돌리는 이유는 **롤백의 정의 때문이다**: `migration repair --status reverted 0016` 뒤의 DB 는
-- 0016 적용 **전**의 상태여야 하고, 그래야 0016 을 다시 적용했을 때 자기검증이 실제로 무언가를 검사한다
-- (pg_temp 를 남겨 두면 §5 ④ 는 재적용에서 언제나 참이 되어 눈이 먼다).
-- 대신 아래 §3 의 검증이 **EXECUTE 보유자가 `service_role` 뿐임을 롤백 뒤에도 확인한다**(리뷰 K4 가 0014 롤백에서
-- 빠졌다고 지적한 절이다) — 섀도잉을 실제로 하려면 함수를 부를 수 있어야 하는데, 그 문이 닫혀 있음을 여기서 못박는다.
--
-- 재실행 가능(idempotent): `grant` 는 이미 있는 권한을 다시 줘도 오류가 아니고, 표가 없으면 to_regclass 로 건너뛴다
-- (0008·0009·0010·0012·0013 롤백과 같은 처리). `create or replace` 도 멱등이다.
-- **`drop function` 을 쓰지 않는다** — ACL 이 초기화되면 이 DB 의 기본 권한이 공개 롤에 EXECUTE 를 다시 부여한다
-- (CLAUDE.md §3). 롤백이 상행보다 넓은 문을 여는 것은 롤백이 아니다.

begin;

-- =========================================================================
-- 0. 안전장치 — 조건 없음. 승인 플래그가 없으면 언제나 멈춘다 (근거는 헤더)
-- =========================================================================
do $$
begin
  if coalesce(current_setting('bestour.rollback_0016_ack', true), '') <> '1' then
    raise exception '0016 롤백 중단: TRUNCATE(표를 통째로 비운다 · RLS 가 막지 않는다)와 TRIGGER(supabase_functions.http_request 를 붙여 모든 변경을 외부로 흘린다)를 다시 열려 한다 — 셋 다 오류도 로그도 없이 조용하다'
      using hint = '되돌릴 이유를 확인했으면 같은 세션에서 `set bestour.rollback_0016_ack = ''1'';` 을 실행한 뒤 다시 돌린다. 되돌린 것을 필요로 하는 정상 경로는 하나도 없다 — 관리자 화면은 TRUNCATE 를 쓰지 않고(한 행씩 지운다) places 에는 쓰기 화면이 없다. 관리자 화면이 죽어서 여기까지 왔다면 원인은 0016 이 아닐 가능성이 높다: 먼저 콘텐츠 6표의 authenticated CRUD 와 시퀀스 usage 를 has_table_privilege·has_sequence_privilege 로 확인할 것.';
  end if;
end
$$;

-- =========================================================================
-- 1. 표 권한 복원 — 있는 표에만
--    표 이름을 한 줄씩 적는다(루프 + format(%I) 로 줄이지 않는다) — 이 파일만 읽고 "무엇이 어디로 돌아가는지"
--    알 수 있어야 하고, 상행이 회수한 삼중항과 하행이 부여하는 삼중항을 tests/write-privileges.test.ts 가
--    **텍스트에서 직접** 집합으로 대조한다(0013 롤백과 같은 규약).
-- =========================================================================
do $$
begin
  if to_regclass('public.notices') is not null then
    execute 'grant truncate, trigger, references on table notices to authenticated';
    execute 'grant trigger, references on table notices to anon';
  else raise notice '0016 롤백: notices 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.popups') is not null then
    execute 'grant truncate, trigger, references on table popups to authenticated';
    execute 'grant trigger, references on table popups to anon';
  else raise notice '0016 롤백: popups 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.gallery') is not null then
    execute 'grant truncate, trigger, references on table gallery to authenticated';
    execute 'grant trigger, references on table gallery to anon';
  else raise notice '0016 롤백: gallery 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.gallery_albums') is not null then
    execute 'grant truncate, trigger, references on table gallery_albums to authenticated';
    execute 'grant trigger, references on table gallery_albums to anon';
  else raise notice '0016 롤백: gallery_albums 가 없다 — 건너뛴다(0008 롤백이 먼저 돌았다).'; end if;

  if to_regclass('public.showcase_routes') is not null then
    execute 'grant truncate, trigger, references on table showcase_routes to authenticated';
    execute 'grant trigger, references on table showcase_routes to anon';
  else raise notice '0016 롤백: showcase_routes 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.vehicles') is not null then
    execute 'grant truncate, trigger, references on table vehicles to authenticated';
    execute 'grant trigger, references on table vehicles to anon';
  else raise notice '0016 롤백: vehicles 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.places') is not null then
    execute 'grant truncate, trigger, references on table places to authenticated';
    execute 'grant trigger, references on table places to anon';
    -- §3 상행이 따로 회수한 세 동작. `places` 에만 있는 항목이다.
    execute 'grant insert, update, delete on table places to authenticated';
  else raise notice '0016 롤백: places 가 없다 — 건너뛴다(0002 롤백이 먼저 돌았다).'; end if;
end
$$;

-- =========================================================================
-- 2. definer 함수 셋 — `search_path` 를 옛 형태(pg_temp 없음)로. 본문은 0005·0007 원문 그대로다.
--    `create or replace` 라 ACL 이 보존된다 — drop 을 쓰면 기본 권한이 공개 롤에 EXECUTE 를 다시 부여한다(헤더).
--    claim_pending_notifications 는 여기 없다 — 0016 이 건드리지 않았고, 1-인자 형태를 만들면 2-인자 판과
--    공존해 호출이 모호(42725)해진다(0014 §4 ①).
-- =========================================================================
create or replace function mark_notification_sent(p_id bigint, p_provider_message_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update notifications_log
  set status = 'sent',
      provider_message_id = p_provider_message_id,
      last_error = null,
      updated_at = now()
  where id = p_id and status = 'pending';
  return found;
exception
  when unique_violation then
    update notifications_log
    set status = 'failed',
        last_error = 'duplicate_sent',
        updated_at = now()
    where id = p_id;
    return false;
end;
$$;

create or replace function mark_notification_failed(p_id bigint, p_error text, p_give_up boolean, p_retry_after_ms bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update notifications_log
  set status          = case when p_give_up then 'failed' else 'pending' end,
      last_error      = p_error,
      updated_at      = now(),
      next_attempt_at = case when p_give_up then now()
                             else now() + make_interval(secs => greatest(coalesce(p_retry_after_ms, 0), 0) / 1000.0) end
  where id = p_id and status = 'pending';
$$;

create or replace function reap_stale_notifications()
returns setof notifications_log
language sql
security definer
set search_path = public
as $$
  update notifications_log
  set status     = 'failed',
      last_error = 'lease_expired_after_max_attempts',
      updated_at = now()
  where status = 'pending' and attempts >= 5 and next_attempt_at <= now()
  returning *;
$$;

-- =========================================================================
-- 3. 검증 — 롤백이 반쯤 돌거나, 상행보다 넓은 문을 열거나, 발송기를 죽인 채 끝나지 않게 한다
--    ① 되돌렸어야 할 권한이 실제로 돌아왔는가(표가 있는 경우에만)
--    ② 함수 셋의 search_path 가 옛 형태인가
--    ③ EXECUTE 보유자가 여전히 service_role(+소유자) 뿐이고 service_role 이 실행할 수 있는가 (리뷰 K4)
--    ③ 이 중요한 이유: 롤백이 "성공했다" 고 말하면서 발송기를 죽이거나, 반대로 공개 롤에 함수를 열어 둘 수 있다.
--    이 DB 의 기본 권한이 우연히 살려 주는 경우도 있는데, 그 우연에 기대는 것이 바로 0014 가 경계한 것이다.
-- =========================================================================
do $$
declare
  fns    constant text[] := array['public.mark_notification_sent(bigint, text)',
                                  'public.mark_notification_failed(bigint, text, boolean, bigint)',
                                  'public.reap_stale_notifications()'];
  missed text;
  fn_sig text;
  fn_oid oid;
  cfg    text[];
  extra  text;
begin
  -- ① 표 권한 복원 — 없는 표는 건너뛰었으므로 to_regclass 가 null 이 아닌 것만 본다.
  select string_agg(format('%s → %s(%s)', r.role, t.tbl, r.priv), ', ' order by r.role, t.tbl, r.priv)
    into missed
    from unnest(array['public.notices', 'public.popups', 'public.gallery', 'public.gallery_albums',
                      'public.showcase_routes', 'public.vehicles', 'public.places']) as t(tbl)
    cross join (values ('authenticated', 'truncate'), ('authenticated', 'trigger'), ('authenticated', 'references'),
                       ('anon', 'trigger'), ('anon', 'references')) as r(role, priv)
   where to_regclass(t.tbl) is not null
     and not has_table_privilege(r.role, t.tbl, r.priv);
  if missed is not null then
    raise exception '0016 롤백: 되돌리지 못한 권한이 있다 — %', missed
      using hint = '§1 의 grant 문 중 일부가 실행되지 않았다. 표 이름·롤 이름을 확인할 것.';
  end if;

  if to_regclass('public.places') is not null then
    select string_agg(format('places(%s)', p.priv), ', ' order by p.priv)
      into missed
      from (values ('insert'), ('update'), ('delete')) as p(priv)
     where not has_table_privilege('authenticated', 'public.places', p.priv);
    if missed is not null then
      raise exception '0016 롤백: places 의 쓰기 권한을 되돌리지 못했다 — %', missed
        using hint = '§1 의 마지막 grant insert, update, delete on table places to authenticated 를 확인할 것.';
    end if;
  end if;

  -- ②③ 함수 셋
  foreach fn_sig in array fns loop
    fn_oid := to_regprocedure(fn_sig)::oid;
    if fn_oid is null then
      raise exception '0016 롤백: definer 함수 % 가 사라졌다', fn_sig
        using hint = '§2 의 create or replace 가 실패했다. 발송기가 이 함수를 부른다 — 0005·0007 을 다시 적용할 것.';
    end if;

    select p.proconfig into cfg from pg_proc p where p.oid = fn_oid;
    -- search_path 항목만 스키마 목록으로 풀어 비교한다(P5-15 R6 — 0016 ④ 와 같은 판정).
    -- 토큰 앞뒤 공백 = src/backend/parser/scansup.c scanner_isspace — 스페이스·\t·\n·\r·\f 는 모든 버전, \v 는 17 이상에서만
    -- (P5-15 R8 실측 · chr(11)||'public' 뒤 current_schemas(false): 15.17 {} · 16.15 {} · 17.6 {public} · 18.6 {public} → 경계는 17).
    -- 스페이스만 지우면 이 **역판정**이
    -- `public,<탭>pg_temp` 를 놓쳐 pg_temp 가 남은 채 통과했다(R7 실측).
    if cfg is null or exists (
         select 1
           from unnest(cfg) c
          cross join lateral regexp_split_to_table(substr(c, 13), ',(?=(?:[^"]*"[^"]*")*[^"]*$)') x(tok)
          cross join lateral (select btrim(x.tok, ' ' || chr(9) || chr(10) || chr(13) || chr(12)
                                       || case when current_setting('server_version_num')::int >= 170000 then chr(11) else '' end) as t) y
          where left(c, 12) = 'search_path='
            and case when y.t like '"%'
                     then replace(substr(y.t, 2, length(y.t) - 2), '""', '"')
                     else lower(y.t) end = 'pg_temp') then
      raise exception '0016 롤백: % 의 search_path 가 옛 형태로 돌아가지 않았다 (proconfig=%)', fn_sig, cfg
        using hint = '§2 의 set search_path = public (pg_temp 없이) 을 확인할 것. 되돌리지 않으면 0016 재적용 시 §5 ④ 가 언제나 참이 되어 검사가 눈이 먼다.';
    end if;

    select string_agg(distinct g, ', ')
      into extra
      from (
        select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as g
          -- NULL proacl = 기본 ACL(PUBLIC EXECUTE) — aclexplode(NULL) 은 0행이라 그대로 두면 통과한다(P5-15 R5)
          from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where p.oid = fn_oid and a.privilege_type = 'EXECUTE'
      ) s
     where s.g <> 'service_role'
       and s.g <> (select pg_get_userbyid(proowner) from pg_proc where oid = fn_oid);
    if extra is not null then
      raise exception '0016 롤백: % 의 EXECUTE 를 service_role 말고도 갖게 됐다 — % (롤백이 상행보다 넓은 문을 열었다)', fn_sig, extra
        using hint = '§2 에 drop function 이 섞였는지 확인할 것 — ACL 이 초기화되면 이 DB 의 기본 권한이 anon·authenticated·service_role 에 EXECUTE 를 다시 부여한다. create or replace 는 ACL 을 보존한다. PUBLIC 이 보이면 ACL 이 NULL(기본값)일 수 있다.';
    end if;

    -- 유효값으로도 본다 — PUBLIC·멤버십으로 얻은 EXECUTE 까지(P5-15 R5 · 상행 0016 ④ 와 같은 판정).
    if has_function_privilege('anon', fn_oid, 'EXECUTE') or has_function_privilege('authenticated', fn_oid, 'EXECUTE') then
      raise exception '0016 롤백: 공개 롤이 % 를 실행할 수 있다 (anon=% · authenticated=%) — 롤백이 상행보다 넓은 문을 열었다',
        fn_sig, has_function_privilege('anon', fn_oid, 'EXECUTE'), has_function_privilege('authenticated', fn_oid, 'EXECUTE')
        using hint = '롤백은 함수의 EXECUTE 를 건드리지 않는다 — 여기가 걸렸다면 drop 이 섞였거나 이 파일 밖에서 grant 했다.';
    end if;

    if not has_function_privilege('service_role', fn_oid, 'execute') then
      raise exception '0016 롤백: service_role 이 % 를 실행할 수 없다 — 롤백은 성공했다고 말하면서 발송기를 죽인다', fn_sig
        using hint = '0005 §6 · 0007 의 grant execute … to service_role 을 다시 실행할 것 (리뷰 K4).';
    end if;
  end loop;
end
$$;

commit;

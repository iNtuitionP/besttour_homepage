-- 0017_pii_tables_trigger_references.down.sql — supabase/migrations/0017_pii_tables_trigger_references.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005·0007·0008·0009·0010·0012·0013·0014·0015·0016 롤백 헤더와 같다). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0017
--
-- 이 롤백이 하는 일(0017 이 한 것의 정확한 역):
--   ① `reservations`·`notifications_log` 에서 `anon`·`authenticated` 에게 TRIGGER·REFERENCES 를 되돌려 준다
--   ② 같은 두 표에서 `anon` 에게 SELECT 를 되돌려 준다
-- 표·컬럼·행·CHECK·인덱스·정책·함수는 한 글자도 건드리지 않는다.
-- 0010·0012 가 회수한 쓰기 네 동작과 0009 가 준 `authenticated` 의 select 는 **건드리지 않는다** — 0017 이 회수하지 않았다.
--
-- ## 승인 플래그를 **조건 없이** 요구한다 — 판단과 근거
-- 0015·0016 롤백이 세운 기준을 그대로 쓴다: **"실행이 안전한가" 가 아니라 "실행한 뒤의 세계가 조용히 위험한가".**
-- 이 롤백은 실행 자체는 안전하다 — 데이터가 사라지지 않고 잘못 눌러도 0017 을 다시 적용하면 된다.
-- 그런데 되돌려 놓는 세계는 **이 계열에서 가장 조용하다.** 되살아나는 것이 무엇인지 그대로 적는다:
--   · **TRIGGER 가 돌아온다 → `supabase_functions.http_request` 트리거를 `reservations` 에 붙일 수 있다**
--     (anon·authenticated 모두 그 함수의 EXECUTE 를 갖고 있다 — 2026-09-16 실측, 그리고 실제로 붙여 봤더니 붙었다).
--     붙는 순간부터 **접수가 들어올 때마다 고객 성명·전화번호·이메일·문의내용이 공격자 주소로 전송된다.**
--     `notifications_log` 쪽은 수신처와 문자 본문이 같은 길로 나간다. 오류도, 로그도, 화면의 변화도 없다 —
--     사이트는 아무 일 없이 정상 동작하고 유출은 어디에도 나타나지 않는다. RLS 는 이것을 막지 못한다.
--   · **`anon` 의 SELECT 가 돌아온다** → 지금의 "0행" 이 다시 **RLS 정책이 없다는 사실 하나에만** 기대게 된다.
--     누군가 `anon` 용 select 정책을 한 줄 붙이는 순간 고객 표가 공개된다.
--   · **REFERENCES 가 돌아온다** → 고객 표를 가리키는 외래키가 생기면 보유기간 파기 크론이 조용히 실패한다.
-- 그리고 **되돌린 것을 필요로 하는 정상 경로가 하나도 없다.** 아무도 이 두 표에 트리거·외래키를 만들지 않고,
-- `anon` 으로 두 표를 읽는 코드도 없다(공개 경로는 전부 서비스 롤, 관리자 화면은 `authenticated`).
-- 즉 이 롤백이 **조용히 도는 것이 옳은 상황은 존재하지 않는다** — 손이 미끄러져서는 안 된다.
-- 행 수는 조건에 넣지 않는다(0012 독립 리뷰 M2 와 같은 근거): 지금 예약 표가 비어 있다는 것은 위험이 없다는 뜻이
-- 아니라 **아직 없다**는 뜻이다. 접수는 오픈 첫날부터 들어온다.
--
--   set bestour.rollback_0017_ack = '1';
--   \i supabase/rollbacks/0017_pii_tables_trigger_references.down.sql
--
-- 재실행 가능(idempotent): `grant` 는 이미 있는 권한을 다시 줘도 오류가 아니고, 표가 없으면 to_regclass 로 건너뛴다
-- (0008·0009·0010·0012·0013·0016 롤백과 같은 처리).
-- **`drop function` 을 쓰지 않는다 — 함수를 아예 언급하지 않는다.** 0017 이 함수를 건드리지 않았으므로 롤백도 건드리지 않는다.
-- 아래 §3 은 그 "건드리지 않았음" 을 롤백 뒤에도 확인한다(리뷰 K4 가 0014 롤백에서 빠졌다고 지적한 절과 같은 취지).

begin;

-- =========================================================================
-- 0. 안전장치 — 조건 없음. 승인 플래그가 없으면 언제나 멈춘다 (근거는 헤더)
-- =========================================================================
do $$
begin
  if coalesce(current_setting('bestour.rollback_0017_ack', true), '') <> '1' then
    raise exception '0017 롤백 중단: 고객 개인정보 표에 TRIGGER(supabase_functions.http_request 를 붙여 접수마다 성명·전화번호를 외부로 흘린다)와 anon 의 SELECT 를 다시 열려 한다 — 둘 다 오류도 로그도 화면 변화도 없이 조용하다'
      using hint = '되돌릴 이유를 확인했으면 같은 세션에서 `set bestour.rollback_0017_ack = ''1'';` 을 실행한 뒤 다시 돌린다. 되돌린 것을 필요로 하는 정상 경로는 하나도 없다 — 두 표에 트리거·외래키를 만드는 코드가 없고 anon 으로 읽는 코드도 없다(공개 경로는 전부 서비스 롤, 관리자 화면은 authenticated). 관리자 화면이 죽어서 여기까지 왔다면 원인은 0017 이 아닐 가능성이 높다: 먼저 `has_table_privilege(''authenticated'', ''public.reservations'', ''select'')` 와 `…''public.notifications_log''…` 를 확인할 것 — 0017 은 그 둘을 건드리지 않는다.';
  end if;
end
$$;

-- =========================================================================
-- 1. 표 권한 복원 — 있는 표에만
--    표 이름을 한 줄씩 적는다(루프 + format(%I) 로 줄이지 않는다) — 이 파일만 읽고 "무엇이 어디로 돌아가는지"
--    알 수 있어야 하고, 상행이 회수한 삼중항과 하행이 부여하는 삼중항을 tests/write-privileges.test.ts 가
--    **텍스트에서 직접** 집합으로 대조한다(0013·0016 롤백과 같은 규약).
-- =========================================================================
do $$
begin
  if to_regclass('public.reservations') is not null then
    execute 'grant trigger, references on table reservations to anon, authenticated';
    execute 'grant select on table reservations to anon';
  else raise notice '0017 롤백: reservations 가 없다 — 건너뛴다(0001 롤백이 먼저 돌았다).'; end if;

  if to_regclass('public.notifications_log') is not null then
    execute 'grant trigger, references on table notifications_log to anon, authenticated';
    execute 'grant select on table notifications_log to anon';
  else raise notice '0017 롤백: notifications_log 가 없다 — 건너뛴다(0005 롤백이 먼저 돌았다).'; end if;
end
$$;

-- =========================================================================
-- 2. 검증 — 롤백이 반쯤 돌거나, 상행보다 넓은 문을 열거나, 관리자 화면·발송기를 죽인 채 끝나지 않게 한다
--    ① 되돌렸어야 할 권한이 실제로 돌아왔는가(표가 있는 경우에만)
--    ② 0017 이 회수하지 않은 것까지 열지 않았는가 — 쓰기 네 동작은 여전히 두 공개 롤에서 닫혀 있어야 한다
--       (0010·0012 소관이다. 롤백이 그 문을 되살리면 그것은 롤백이 아니라 후퇴다)
--    ③ `authenticated` 의 select 와 `service_role` 의 일곱 동작은 그대로인가
--    ④ 아웃박스 definer 함수 넷의 EXECUTE 보유자가 여전히 `service_role`(+소유자) 뿐이고 실행할 수 있는가 (리뷰 K4)
-- =========================================================================
do $$
declare
  two    constant text[] := array['public.reservations', 'public.notifications_log'];
  fns    constant text[] := array['public.claim_pending_notifications(int, text[])',
                                  'public.mark_notification_sent(bigint, text)',
                                  'public.mark_notification_failed(bigint, text, boolean, bigint)',
                                  'public.reap_stale_notifications()'];
  missed text;
  extra  text;
  fn_sig text;
  fn_oid oid;
begin
  -- ① 되돌렸어야 할 것
  select string_agg(format('%s → %s(%s)', r.role, t.tbl, r.priv), ', ' order by r.role, t.tbl, r.priv)
    into missed
    from unnest(two) as t(tbl)
    cross join (values ('anon', 'trigger'), ('anon', 'references'), ('anon', 'select'),
                       ('authenticated', 'trigger'), ('authenticated', 'references')) as r(role, priv)
   where to_regclass(t.tbl) is not null
     and not has_table_privilege(r.role, t.tbl, r.priv);
  if missed is not null then
    raise exception '0017 롤백: 되돌리지 못한 권한이 있다 — %', missed
      using hint = '§1 의 grant 문 중 일부가 실행되지 않았다. 표 이름·롤 이름을 확인할 것.';
  end if;

  -- ② 상행이 회수하지 않은 것까지 열지 않았는가 — 쓰기 네 동작은 0010·0012 가 닫았다.
  select string_agg(format('%s → %s(%s)', r.role, t.tbl, p.priv), ', ' order by r.role, t.tbl, p.priv)
    into extra
    from (values ('anon'), ('authenticated')) as r(role)
    cross join unnest(two) as t(tbl)
    cross join (values ('insert'), ('update'), ('delete'), ('truncate')) as p(priv)
   where to_regclass(t.tbl) is not null
     and has_table_privilege(r.role, t.tbl, p.priv);
  if extra is not null then
    raise exception '0017 롤백: 0017 이 회수하지 않은 쓰기 권한까지 열렸다 — % (롤백이 상행보다 넓은 문을 열었다)', extra
      using hint = '§1 의 grant 목록에 insert/update/delete/truncate 가 섞였다. 그 넷은 0010·0012 소관이고 0017 은 건드리지 않았다 — 되살리면 관리자·공개 롤이 고객 표를 직접 고칠 수 있게 된다.';
  end if;

  -- ③ 관리자 화면(authenticated select)과 서비스 롤 경로
  select string_agg(format('%s → %s(%s)', r.role, t.tbl, r.priv), ', ' order by r.role, t.tbl, r.priv)
    into missed
    from unnest(two) as t(tbl)
    cross join (values ('authenticated', 'select'),
                       ('service_role', 'select'), ('service_role', 'insert'),
                       ('service_role', 'update'), ('service_role', 'delete'),
                       ('service_role', 'truncate'), ('service_role', 'trigger'), ('service_role', 'references')) as r(role, priv)
   where to_regclass(t.tbl) is not null
     and not has_table_privilege(r.role, t.tbl, r.priv);
  if missed is not null then
    raise exception '0017 롤백: 롤백은 성공했다고 말하면서 관리자 화면이나 서비스 롤 경로를 죽였다 — %', missed
      using hint = '0017 도 이 롤백도 그 권한들을 건드리지 않는다 — 여기가 걸렸다면 다른 원인이다. 0009 §6(관리자 select)과 접수·enqueue·발송기·파기(서비스 롤)를 확인할 것.';
  end if;

  -- ④ 아웃박스 definer 함수 — 0017 도 롤백도 함수를 건드리지 않는다. 건드려지지 않았음을 확인한다 (K4).
  foreach fn_sig in array fns loop
    fn_oid := to_regprocedure(fn_sig)::oid;
    if fn_oid is null then
      raise notice '0017 롤백: definer 함수 % 가 없다 — 앞선 마이그레이션의 롤백이 먼저 돌았다. 건너뛴다.', fn_sig;
      continue;
    end if;

    select string_agg(distinct g, ', ')
      into extra
      from (
        select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as g
          from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a  -- NULL = 기본 ACL(PUBLIC EXECUTE) · P5-15 R4
         where p.oid = fn_oid and a.privilege_type = 'EXECUTE'
      ) s
     where s.g <> 'service_role'
       and s.g <> (select pg_get_userbyid(proowner) from pg_proc where oid = fn_oid);
    if extra is not null then
      raise exception '0017 롤백: % 의 EXECUTE 를 service_role 말고도 갖게 됐다 — %', fn_sig, extra
        using hint = '이 롤백은 함수를 언급조차 하지 않는다 — 여기가 걸렸다면 밖에서 drop function 후 재생성했거나(ACL 초기화 → 기본 권한이 공개 롤에 EXECUTE 재부여) 직접 grant 한 것이다. /rpc 로 통지 큐를 조작할 수 있는 상태다.';
    end if;

    if not has_function_privilege('service_role', fn_oid, 'execute') then
      raise exception '0017 롤백: service_role 이 % 를 실행할 수 없다 — 롤백은 성공했다고 말하면서 발송기를 죽인다', fn_sig
        using hint = '0005 §6 · 0007 · 0014 의 grant execute … to service_role 을 다시 실행할 것 (리뷰 K4).';
    end if;
  end loop;
end
$$;

commit;

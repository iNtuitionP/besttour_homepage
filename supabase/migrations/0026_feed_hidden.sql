-- 0026_feed_hidden.sql — 홈 접수 현황에서 한 건을 숨기는 칸과 함수 (OF2-B · 사장님 요청 2026-10-15)
--
-- ## 왜
--   홈 "최근 견적현황"은 접수자의 성명 일부·차종·운행일·상태를 공개한다(원장 PRIVACY_NOTICE.publicFeedNotice).
--   손님이 "내 접수를 홈에서 내려 달라" 고 하면 사장님이 관리자에서 그 한 건만 빼야 한다 — 지우면 계약·정산 기록이 사라진다.
--   그래서 접수 행은 두고 **홈 노출만 끄는** 칸 하나를 둔다.
--
-- ## 무엇을 하나
--   1. `reservations.hidden_from_feed boolean not null default false` — 숨긴 행은 상태와 무관하게 홈에 안 나온다.
--      기본값이 false 라 기존 행·새 접수는 그대로 보인다(상담 없이 취소한 건은 앱 규칙이 따로 뺀다 — lib/queries/recent.ts).
--      상수 기본값 + not null 칸 추가는 표를 다시 쓰지 않는다(PostgreSQL 11+). 잠깐 잠그는 것뿐이라 lock_timeout 5초로 상한을 둔다.
--   2. `admin_set_feed_hidden(p_id uuid, p_hidden boolean)` — 유일한 쓰기 길. definer · 첫 문장 is_admin() · search_path 고정.
--      반환 outcome: 'hidden' | 'shown' | 'noop'(없는 id). 같은 값을 다시 눌러도 오류가 아니다(두 번 클릭).
--
-- ## 바꾸지 않는 것 (그리고 확인한 것)
--   · 표 GRANT·RLS — 새 칸은 표 권한을 새로 열지 않는다. anon 은 reservations SELECT 가 없고(0017), authenticated 는 표 UPDATE 가 없다(0010 §6).
--     §3 자기검증이 새 칸에 대해 그것을 **실측**한다(has_column_privilege · PUBLIC · 컬럼 ACL).
--   · 취소·확정·완료 함수 — **취소는 confirmed_at 을 지우지 않는다**(0010 admin_cancel_reservation 은 status 와 메모만 바꾼다 — 확인함).
--     그래서 "상담완료 뒤 취소" 는 홈에서 여전히 "상담완료" 로 보인다(결정). 이 파일은 그 함수를 건드리지 않는다.
--   · CLAUDE.md §3 — 새 함수는 기본으로 공개 롤에 EXECUTE 가 열린다(pg_default_acl: postgres·supabase_admin → anon·authenticated·service_role).
--     그래서 §2 에서 **같은 파일에** public·anon·service_role 을 회수하고 authenticated 에게만 준다.
--
-- ## 배포 순서 (필수)
--   **DB 적용 → 코드 배포.** 새 코드는 hidden_from_feed 를 SELECT 하고 admin_set_feed_hidden 을 부른다. 코드가 먼저 나가면 홈 피드 쿼리가
--   없는 칸을 읽어 실패하고(홈은 접수 현황 섹션을 통째로 숨긴다) 관리자 상세의 숨기기가 실패한다. DB 를 먼저 올리면 옛 코드는 새 칸을 모를 뿐이다.
--   롤백은 반대: 코드를 먼저 되돌린 뒤 supabase/rollbacks/0026_feed_hidden.down.sql (숨긴 행이 있으면 멈춘다 — 파일 헤더).
--
-- 재실행 안전: add column if not exists · create or replace · revoke/grant 는 멱등.

-- lock_timeout 상한 (P5-15 R7): CLI 가 이 파일을 한 트랜잭션으로 돌려 set local 은 이 파일에만 걸린다 — 잠금을 5초 넘게 기다리면 파일째 롤백.
set local lock_timeout = '5s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0026: 앞 문장의 set local lock_timeout 이 남지 않았다 (지금 %) — 파일이 한 트랜잭션으로 돌지 않는 경로다', current_setting('lock_timeout')
      using hint = 'supabase db push 로 적용할 것(파일 하나 = 트랜잭션 하나).';
  end if;
end
$$;

-- =========================================================================
-- 1. 칸
-- =========================================================================
alter table reservations add column if not exists hidden_from_feed boolean not null default false;

-- =========================================================================
-- 2. admin_set_feed_hidden — 홈에서 숨기기 / 다시 보이기
-- =========================================================================
create or replace function admin_set_feed_hidden(p_id uuid, p_hidden boolean)
returns table (outcome text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'admin_set_feed_hidden: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;
  if p_hidden is null then
    raise exception 'admin_set_feed_hidden: p_hidden 은 true 또는 false 여야 한다' using errcode = '22023';
  end if;

  update reservations set hidden_from_feed = p_hidden where reservations.id = p_id;
  if not found then
    return query select 'noop'::text;
    return;
  end if;
  return query select case when p_hidden then 'hidden' else 'shown' end;
end;
$$;

-- CLAUDE.md §3 — 새 함수는 같은 파일에서 회수한다(create or replace 도 새 함수에는 기본권한이 EXECUTE 를 공개 롤에 연다).
revoke all on function admin_set_feed_hidden(uuid, boolean) from public, anon, service_role;
grant execute on function admin_set_feed_hidden(uuid, boolean) to authenticated;

-- =========================================================================
-- 3. 자기검증
--   ① 칸: boolean · not null · default false
--   ② 칸 권한: anon 은 읽기·쓰기·참조 모두 불가 · authenticated 는 읽기만(관리자 RLS 가 읽는다) · service_role 은 읽기(홈 피드) ·
--      PUBLIC(컬럼 ACL · 표 ACL)에 아무것도 없다. 컬럼 권한 종류는 PostgreSQL 이 정한 넷(SELECT·INSERT·UPDATE·REFERENCES)이다 —
--      표 권한과 달리 늘어나지 않는다(MAINTAIN 류는 표 단위다).
--   ③ 함수: EXECUTE 보유자 = authenticated 하나(has_function_privilege 로 롤마다 + PUBLIC aclexplode) · definer · search_path · 첫 문장 가드
-- =========================================================================
do $$
declare
  col        record;
  cprivs     constant text[] := array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'];
  p          text;
  r          text;
  fn         constant regprocedure := to_regprocedure('public.admin_set_feed_hidden(uuid,boolean)');
  fn_row     record;
  holders    text;
  leaked     text;
begin
  -- ① 칸
  select a.atttypid::regtype::text as typ, a.attnotnull as notnull, pg_get_expr(d.adbin, d.adrelid) as dflt
    into col
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.reservations'::regclass and a.attname = 'hidden_from_feed' and not a.attisdropped;
  if col is null then
    raise exception '0026: reservations.hidden_from_feed 칸이 없다';
  end if;
  if col.typ <> 'boolean' or not col.notnull or col.dflt is distinct from 'false' then
    raise exception '0026: hidden_from_feed 의 모양이 기대와 다르다 (형 %, not null %, 기본값 %)', col.typ, col.notnull, col.dflt;
  end if;

  -- ② 칸 권한 — anon: 아무것도 · authenticated: SELECT 만 · service_role: SELECT 는 있어야(홈 피드)
  foreach p in array cprivs loop
    if has_column_privilege('anon', 'public.reservations'::regclass, 'hidden_from_feed', p) then
      raise exception '0026: anon 이 hidden_from_feed 에 % 권한을 갖는다', p;
    end if;
    if p <> 'SELECT' and has_column_privilege('authenticated', 'public.reservations'::regclass, 'hidden_from_feed', p) then
      raise exception '0026: authenticated 가 hidden_from_feed 에 % 권한을 갖는다 — 쓰기 길은 admin_set_feed_hidden 하나뿐이다', p;
    end if;
  end loop;
  -- 표 전체의 컬럼 단위 grant 도 본다(표 단위 revoke 는 따로 부여된 컬럼 grant 를 지우지 않는다 — 0017) — 이 칸을 쓰는 길이 다른 칸의 grant 로 열려 있지 않다.
  if has_any_column_privilege('anon', 'public.reservations'::regclass, 'SELECT')
     or has_any_column_privilege('anon', 'public.reservations'::regclass, 'INSERT')
     or has_any_column_privilege('anon', 'public.reservations'::regclass, 'UPDATE')
     or has_any_column_privilege('authenticated', 'public.reservations'::regclass, 'INSERT')
     or has_any_column_privilege('authenticated', 'public.reservations'::regclass, 'UPDATE') then
    raise exception '0026: reservations 에 공개 롤의 컬럼 단위 쓰기·읽기 권한이 있다 (anon: select·insert·update · authenticated: insert·update)';
  end if;
  if not has_column_privilege('service_role', 'public.reservations'::regclass, 'hidden_from_feed', 'SELECT') then
    raise exception '0026: service_role 이 hidden_from_feed 를 읽지 못한다 — 홈 피드(lib/queries/recent.ts)가 이 칸을 읽는다';
  end if;
  -- PUBLIC: 컬럼 ACL(attacl) · 표 ACL(relacl) 어디에도 grantee 0 이 없다
  select string_agg(format('컬럼 %s', lower(x.privilege_type)), ', ') into leaked
    from pg_attribute a cross join lateral aclexplode(a.attacl) x
   where a.attrelid = 'public.reservations'::regclass and a.attname = 'hidden_from_feed' and a.attacl is not null and x.grantee = 0;
  if leaked is not null then
    raise exception '0026: hidden_from_feed 에 PUBLIC 권한이 있다 — %', leaked;
  end if;
  select string_agg(format('표 %s', lower(x.privilege_type)), ', ') into leaked
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
   where c.oid = 'public.reservations'::regclass and x.grantee = 0;
  if leaked is not null then
    raise exception '0026: reservations 에 PUBLIC 권한이 있다 — %', leaked;
  end if;

  -- ③ 함수
  if fn is null then
    raise exception '0026: admin_set_feed_hidden(uuid, boolean) 이 없다';
  end if;
  foreach r in array array['anon', 'service_role'] loop
    if has_function_privilege(r, fn, 'EXECUTE') then
      raise exception '0026: % 가 admin_set_feed_hidden 을 실행할 수 있다 — drop/create·기본권한이 EXECUTE 를 다시 열었다', r;
    end if;
  end loop;
  if not has_function_privilege('authenticated', fn, 'EXECUTE') then
    raise exception '0026: authenticated 가 admin_set_feed_hidden 을 실행하지 못한다 — 관리자 세션이 부르는 길이다';
  end if;
  select p.prosecdef as definer, coalesce(array_to_string(p.proconfig, ' '), '') as cfg, p.prosrc as src, p.proowner as owner, p.proacl as acl
    into fn_row from pg_proc p where p.oid = fn;
  select string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',' order by case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end) into holders
    from aclexplode(coalesce(fn_row.acl, acldefault('f', fn_row.owner))) a
   where a.privilege_type = 'EXECUTE' and a.grantee <> fn_row.owner;
  if holders is distinct from 'authenticated' then
    raise exception '0026: admin_set_feed_hidden 의 EXECUTE 보유자가 authenticated 하나가 아니다 (지금 %)', coalesce(holders, '(없음)');
  end if;
  if not fn_row.definer or fn_row.cfg <> 'search_path=public, pg_temp' then
    raise exception '0026: admin_set_feed_hidden 이 definer + search_path=public, pg_temp 가 아니다 (definer %, 설정 %)', fn_row.definer, fn_row.cfg;
  end if;
  if fn_row.src !~ '^\s*(declare\s.*?)?begin\s+if not is_admin\(\) then\s+raise exception' then
    raise exception '0026: admin_set_feed_hidden 의 첫 문장이 is_admin() 가드가 아니다';
  end if;
end
$$;

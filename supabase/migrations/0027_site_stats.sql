-- 0027_site_stats.sql — 자체 방문자 통계: 표 둘 · 기록 함수 · 읽기 함수 · 옛 값 삭제 함수 (OF2-C · 사장님 요청 2026-10-15)
--
-- ## 왜
--   사장님이 "오늘·어제·누적 조회수와 방문자, 최근 30일 그래프" 를 관리자에서 보고 싶어 한다(티스토리 통계 화면처럼).
--   Vercel Web Analytics 는 사이트 밖(Vercel 화면)에서만 보인다. 그래서 공개 페이지가 열릴 때마다 하루 단위 숫자를 DB 에 직접 센다.
--
-- ## 무엇을 하나 (처리방침 원장 PRIVACY_POLICY_SECTIONS.siteStats 와 한 줄씩 맞는다 — tests/of2c-site-stats.test.ts §4)
--   1. `site_stats_daily(day, views, visitors)` — **날짜별 숫자만** 영구 보관한다. 지우지 않는다. day 는 KST 날짜.
--   2. `site_visitors_seen(day, vid)` — "오늘 이 방문자를 이미 셌는가" 만 가리는 **일회용 값**. vid 는 앱이 sha256(GUARD_SECRET + KST날짜 + IP + UA)
--      앞 32자로 만든다 — IP 원문·UA 원문이 이 DB 에 들어올 길이 없다(칸이 없고, 함수가 32자 hex 가 아니면 거부한다).
--      어제보다 오래된 값은 지운다: 남는 것은 오늘·어제뿐이라 가장 오래 남는 값도 사흘을 넘지 않는다(고지: "사흘 안에 삭제").
--   3. `record_site_view(p_vid text) returns boolean` — 유일한 쓰기 길. definer · **service_role 만 EXECUTE**. 조회수는 늘 +1,
--      그날 처음 보는 vid 일 때만 방문자 +1. 반환 = 새 방문자였는가. 호출될 때 옛 일회용 값도 함께 지운다.
--   4. `purge_site_visitors_seen() returns integer` — 옛 일회용 값 삭제(매일 크론 /api/cron/purge 가 부른다 — 방문이 끊겨도 지워지게). service_role 만.
--   5. `admin_site_stats(p_days integer) returns jsonb` — 읽기 전용. definer · **첫 문장 is_admin()** · authenticated 만 EXECUTE.
--      반환: { today, days:[{day,views,visitors}…(빈 날 0 채움, 오래된 날 → 오늘)], total_views, total_visitors }. p_days 는 1~90.
--
-- ## 권한 (CLAUDE.md §3 — 새 표·함수는 기본으로 공개 롤에 전권이 열린다)
--   · 두 표: RLS 켬(정책 0개 = 기본 거부) + **anon·authenticated·service_role·PUBLIC 의 모든 표 권한 회수**(SELECT·INSERT·UPDATE·DELETE·TRUNCATE·
--     REFERENCES·TRIGGER + PostgreSQL 17+ 의 MAINTAIN — RLS 밖이라 잠금·VACUUM 으로 접수를 멈출 수 있다). 쓰기·읽기는 전부 definer 함수(소유자 권한)가 한다.
--     → service_role 도 표를 직접 못 만진다(함수만). `revoke all` 이 MAINTAIN 을 포함하지만, 버전이 권한을 더해도 회수가 남도록
--       server_version_num >= 170000 조건부 동적 SQL 로 한 번 더 명시한다(16 이하에서 `revoke maintain` 은 문법 오류다).
--   · 함수: 새로 만들 때 기본권한이 EXECUTE 를 anon·authenticated·service_role 에 연다 → **같은 파일에서** 넷(PUBLIC 포함) 모두 회수한 뒤 필요한 롤에만 grant.
--   · §3 자기검증이 has_*_privilege · aclexplode(acldefault) 로 **실측**한다(권한 종류는 목록으로 박지 않고 카탈로그에서 얻는다).
--
-- ## 배포 순서 (필수)
--   **DB 적용 → 코드 배포.** 새 코드는 record_site_view·purge_site_visitors_seen·admin_site_stats 를 부른다. 코드가 먼저 나가면
--   비콘 라우트는 조용히 204(세지 못할 뿐)이고 관리자 통계의 방문자 칸이 "불러오지 못했어요" 로 나온다. DB 를 먼저 올리면 옛 코드는 이 객체를 모를 뿐이다.
--   롤백은 반대: 코드를 먼저 되돌린 뒤 supabase/rollbacks/0027_site_stats.down.sql (집계 숫자가 있으면 멈춘다 — 파일 헤더).
--
-- 재실행 안전: create table if not exists · create or replace · revoke/grant 는 멱등.

-- lock_timeout 상한 (P5-15 R7): CLI 가 이 파일을 한 트랜잭션으로 돌려 set local 은 이 파일에만 걸린다.
set local lock_timeout = '5s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0027: 앞 문장의 set local lock_timeout 이 남지 않았다 (지금 %) — 파일이 한 트랜잭션으로 돌지 않는 경로다', current_setting('lock_timeout')
      using hint = 'supabase db push 로 적용할 것(파일 하나 = 트랜잭션 하나).';
  end if;
end
$$;

-- =========================================================================
-- 1. 표 둘
-- =========================================================================
create table if not exists site_stats_daily (
  day      date    primary key,
  views    integer not null default 0 check (views >= 0),
  visitors integer not null default 0 check (visitors >= 0 and visitors <= views)
);

create table if not exists site_visitors_seen (
  day date not null,
  vid text not null check (vid ~ '^[0-9a-f]{32}$'),
  primary key (day, vid)
);

alter table site_stats_daily  enable row level security;
alter table site_visitors_seen enable row level security;
-- 정책은 두지 않는다 — 기본 거부. 소유자(definer 함수)만 지나간다.

-- 표 권한 전부 회수(service_role 포함 — CLAUDE.md §3 표: 부여자 postgres·supabase_admin → anon·authenticated·postgres·service_role).
revoke all on table site_stats_daily, site_visitors_seen from public, anon, authenticated, service_role;
-- PostgreSQL 17+ 의 MAINTAIN 은 RLS 밖이다(LOCK TABLE·VACUUM·ANALYZE·REINDEX). 16 이하에서는 문법 오류라 조건부 동적 SQL.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on table public.site_stats_daily, public.site_visitors_seen from public, anon, authenticated, service_role';
  end if;
end
$$;

-- =========================================================================
-- 2. record_site_view — 유일한 쓰기 길 (service_role 전용)
-- =========================================================================
create or replace function record_site_view(p_vid text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_new   integer;
begin
  -- IP·UA 원문이 흘러 들어오지 못하게 모양을 강제한다(점이 있는 IP 는 통과할 수 없다).
  if p_vid is null or p_vid !~ '^[0-9a-f]{32}$' then
    raise exception 'record_site_view: vid 는 소문자 16진수 32자여야 한다' using errcode = '22023';
  end if;

  -- 어제보다 오래된 일회용 값은 지운다(남는 것은 오늘·어제) — 고지 "사흘 안에 삭제".
  delete from site_visitors_seen where day < v_today - 1;

  insert into site_visitors_seen (day, vid) values (v_today, p_vid) on conflict do nothing;
  get diagnostics v_new = row_count; -- 1 = 오늘 처음 보는 방문자

  insert into site_stats_daily as s (day, views, visitors) values (v_today, 1, v_new)
  on conflict (day) do update set views = s.views + 1, visitors = s.visitors + v_new;

  return v_new = 1;
end;
$$;

-- =========================================================================
-- 3. purge_site_visitors_seen — 옛 일회용 값 삭제 (매일 크론 · service_role 전용)
-- =========================================================================
create or replace function purge_site_visitors_seen()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_gone  integer;
begin
  delete from site_visitors_seen where day < v_today - 1;
  get diagnostics v_gone = row_count;
  return v_gone;
end;
$$;

-- =========================================================================
-- 4. admin_site_stats — 관리자 읽기 전용 집계
-- =========================================================================
create or replace function admin_site_stats(p_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not is_admin() then
    raise exception 'admin_site_stats: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'admin_site_stats: p_days 는 1~90 이어야 한다 (받은 값 %)', p_days using errcode = '22023';
  end if;

  return jsonb_build_object(
    'today', v_today,
    'days', (
      select jsonb_agg(
               jsonb_build_object('day', g.d, 'views', coalesce(s.views, 0), 'visitors', coalesce(s.visitors, 0))
               order by g.d
             )
        from (select v_today - (p_days - 1) + i as d from generate_series(0, p_days - 1) as i) g
        left join site_stats_daily s on s.day = g.d
    ),
    'total_views', coalesce((select sum(views) from site_stats_daily), 0)::bigint,
    'total_visitors', coalesce((select sum(visitors) from site_stats_daily), 0)::bigint
  );
end;
$$;

-- CLAUDE.md §3 — 새 함수는 같은 파일에서 넷(PUBLIC 포함) 모두 회수한 뒤 필요한 롤에만 준다.
revoke all on function record_site_view(text)        from public, anon, authenticated, service_role;
revoke all on function purge_site_visitors_seen()    from public, anon, authenticated, service_role;
revoke all on function admin_site_stats(integer)     from public, anon, authenticated, service_role;
grant execute on function record_site_view(text)     to service_role;
grant execute on function purge_site_visitors_seen() to service_role;
grant execute on function admin_site_stats(integer)  to authenticated;

-- =========================================================================
-- 5. 자기검증
--   ① 표: RLS 켜짐 · 칸 모양 · 공개 롤 셋(anon·authenticated·service_role)과 PUBLIC 에 표 권한이 **하나도 없다**
--      (권한 종류는 acldefault + 실제 ACL 에서 열거 — 직접 부여와 has_table_privilege 유효값 둘 다, grant option 포함) · 컬럼 단위 권한 없음
--   ② 함수: EXECUTE 보유자가 정확히 기대한 롤 하나(has_function_privilege 로 롤마다 + PUBLIC aclexplode) · definer · search_path 고정
--   ③ admin_site_stats 의 첫 문장이 is_admin() 가드
-- =========================================================================
do $$
declare
  t          text;
  r          text;
  k          text;
  tbl        regclass;
  owner_oid  oid;
  kinds      text[];
  cprivs     constant text[] := array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'];
  leaked     text;
  fn         regprocedure;
  fn_row     record;
  holders    text;
  spec       text[];
  cols       text;
begin
  -- ① 표
  foreach t in array array['site_stats_daily', 'site_visitors_seen'] loop
    tbl := to_regclass('public.' || t);
    if tbl is null then
      raise exception '0027: 표 % 가 없다', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = tbl) then
      raise exception '0027: % 에 RLS 가 꺼져 있다', t;
    end if;
    select relowner into owner_oid from pg_class where oid = tbl;

    select string_agg(attname, ',' order by attnum) into cols
      from pg_attribute where attrelid = tbl and attnum > 0 and not attisdropped;
    -- (case 식은 괄호로 감싼다 — PL/pgSQL 의 if 는 식 안의 첫 THEN 에서 조건을 끊는다)
    if cols is distinct from (case t when 'site_stats_daily' then 'day,views,visitors' else 'day,vid' end) then
      raise exception '0027: % 의 칸이 기대와 다르다 (지금 %) — IP·UA 를 담을 칸이 생기면 안 된다', t, cols;
    end if;

    -- 권한 종류: 이 서버가 표에 대해 아는 전부(acldefault) ∪ 실제 ACL 의 종류 — 목록으로 박지 않는다
    select array_agg(distinct p) into kinds from (
      select a.privilege_type as p from aclexplode(acldefault('r', owner_oid)) a
      union
      select a.privilege_type from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = tbl
    ) s;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      foreach k in array kinds loop
        if has_table_privilege(r, tbl, k) or has_table_privilege(r, tbl, k || ' WITH GRANT OPTION') then
          raise exception '0027: % 가 % 에 % 권한을 갖는다 (RLS 밖의 권한일 수 있다 — TRUNCATE·MAINTAIN 포함)', r, t, k;
        end if;
      end loop;
      foreach k in array cprivs loop
        if has_any_column_privilege(r, tbl, k) then
          raise exception '0027: % 가 % 의 어떤 칸에 % 컬럼 권한을 갖는다', r, t, k;
        end if;
      end loop;
    end loop;
    -- 직접 부여(ACL): PUBLIC(grantee 0) · anon · authenticated · service_role 항목이 하나도 없다
    select string_agg(format('%s:%s', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, lower(a.privilege_type)), ', ') into leaked
      from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.oid = tbl and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'));
    if leaked is not null then
      raise exception '0027: % 의 ACL 에 공개 롤 항목이 남아 있다 — %', t, leaked;
    end if;
  end loop;

  -- ② 함수 — (서명, 허용 롤)
  foreach spec slice 1 in array array[
    array['public.record_site_view(text)', 'service_role'],
    array['public.purge_site_visitors_seen()', 'service_role'],
    array['public.admin_site_stats(integer)', 'authenticated']
  ] loop
    fn := to_regprocedure(spec[1]);
    if fn is null then
      raise exception '0027: 함수 % 가 없다', spec[1];
    end if;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if (r = spec[2]) <> has_function_privilege(r, fn, 'EXECUTE') then
        raise exception '0027: % 의 EXECUTE 가 % 에게 % 이다 — 허용은 % 하나뿐이어야 한다', spec[1], r, has_function_privilege(r, fn, 'EXECUTE'), spec[2];
      end if;
    end loop;
    select p.prosecdef as definer, coalesce(array_to_string(p.proconfig, ' '), '') as cfg, p.prosrc as src, p.proowner as owner, p.proacl as acl
      into fn_row from pg_proc p where p.oid = fn;
    select string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',') into holders
      from aclexplode(coalesce(fn_row.acl, acldefault('f', fn_row.owner))) a
     where a.privilege_type = 'EXECUTE' and a.grantee <> fn_row.owner;
    if holders is distinct from spec[2] then
      raise exception '0027: % 의 EXECUTE 보유자가 % 하나가 아니다 (지금 %) — PUBLIC 포함', spec[1], spec[2], coalesce(holders, '(없음)');
    end if;
    if not fn_row.definer or fn_row.cfg <> 'search_path=public, pg_temp' then
      raise exception '0027: % 이 definer + search_path=public, pg_temp 가 아니다 (definer %, 설정 %)', spec[1], fn_row.definer, fn_row.cfg;
    end if;
    -- ③ 관리자 함수는 첫 문장이 is_admin() 가드
    if spec[1] = 'public.admin_site_stats(integer)' and fn_row.src !~ '^\s*(declare\s.*?)?begin\s+if not is_admin\(\) then\s+raise exception' then
      raise exception '0027: admin_site_stats 의 첫 문장이 is_admin() 가드가 아니다';
    end if;
  end loop;
end
$$;

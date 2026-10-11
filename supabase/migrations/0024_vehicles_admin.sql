-- 0024_vehicles_admin.sql — 차량 소개를 관리자가 고친다 (OWNER-FEEDBACK T4-1 · 사장님 요청 15 · 결정 9·11)
--
-- ## 무엇을 하나
--   1. `vehicles` 에 `description_ko`(≤300자)와 `image_path` 두 칸을 더한다. **영문 설명 칸은 만들지 않는다**(결정 11 —
--      관리자 금지어 검사에 영문 규칙이 없다). 두 칸 모두 공개해도 되는 값이다: anon 이 표 단위 SELECT 를 갖고 있어(0001·0013)
--      새 칸이 자동으로 공개되는데, 그것이 의도다(공개 /fleet·홈이 읽는다).
--   2. `image_path` 는 **형식으로 잠근다**(CHECK). 허용은 둘뿐이다:
--        · `gallery/vehicles/<uuid v4>-1600.webp` — 관리자 화면이 gallery 버킷 `vehicles/` 접두어에 올린 공개본(결정 9 · 0011 정책 재사용)
--        · `/hero/bus-0[1-6].jpg` — 저장소 public/hero 의 기존 사진(지금 홈이 쓰는 것)
--      절대 URL·상위 경로·다른 버킷은 DB 가 거부한다 — 앱 검증(lib/admin/vehicleInput.ts)을 거치지 않은 쓰기도 같다.
--   3. 기존 5행을 **지금 공개 화면의 문구·사진 그대로** 백필한다(messages/ko.json home.fleet.lines · FleetSection FLEET_IMAGES —
--      이 파일과 같은 커밋에서 코드 쪽 하드코딩을 지운다). 칸이 비어 있을 때만 채운다 → 재실행해도 관리자가 고친 값을 덮지 않는다.
--   4. definer 함수 다섯(create · update · set_active · delete · reorder). **첫 문장은 `is_admin()` 가드**(0020 과 같은 문구 —
--      lib/admin/adminRpc.ts 가 문구로 가드 거부와 EXECUTE 거부를 가른다).
--        · update: **접수 기록이 있는 차량은 이름(한·영)·정원을 바꿀 수 없다**(결정 11 — 과거 예약 확인 화면의 표시가 소급해 바뀐다).
--          바꾸려 하면 'locked' 를 돌려주고 아무것도 쓰지 않는다. 설명·사진은 바꿀 수 있다.
--        · delete: 접수 기록이 있으면 FK(0001:83, restrict)가 23503 을 던진다 — 잡아서 'referenced' 를 돌려준다(숨기기만 허용).
--        · reorder: 배열이 null·빈 배열·null 원소·중복·지금 표의 id 집합과 다름 중 하나면 22023 으로 거부한다(일부만 바뀌는 순서가 없다).
--   5. 실행 권한: 기본권한이 새 함수 EXECUTE 를 anon·authenticated·service_role 에 **부여한다**(CLAUDE.md §3 · pg_default_acl 실측).
--      같은 트랜잭션에서 `revoke all … from public, anon, service_role` + `grant execute … to authenticated`.
--   6. 자기검증 DO 블록 — 권한 종류는 `acldefault` 에서 열거한다(하드코딩 금지).
--
-- ## 바꾸지 않는 것
--   · 표 GRANT·정책. vehicles 의 쓰기는 0020 이 이미 회수했고(anon·authenticated 는 SELECT 뿐) 정책은 `vehicles_select_active`
--     (공개) + `vehicles_admin_select`(관리자). 칸을 더해도 표 ACL 은 그대로다 — §6 ① 이 확인한다.
--   · 정원 상한 60(0001:32 · 결정 11 유지).
--
-- ## 배포 순서 (필수)
--   **원격 DB 적용 → 코드 배포.** 새 코드는 새 칸을 SELECT 한다 — 코드가 먼저 나가면 홈과 /fleet 이 통째로 에러다
--   (lib/queries/vehicles.ts 가 throw). 롤백은 반대: 코드를 먼저 되돌린 뒤 supabase/rollbacks/0024_vehicles_admin.down.sql.
--
-- 기존 행 영향: 칸 두 개 추가 · CHECK 두 개 · 5행 백필(빈 칸만). 재실행 안전(if not exists · drop constraint if exists · 빈 칸만 갱신 · create or replace).
-- PostgREST 스키마 캐시: 새 RPC 가 생기므로 `notify pgrst, 'reload schema'` 를 끝에 둔다.

-- lock_timeout 상한 (P5-15 R7): CLI 가 이 파일을 한 트랜잭션으로 돌려 set local 은 이 파일에만 걸린다 — 잠금을 5초 넘게 기다리면 파일째 롤백.
set local lock_timeout = '5s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0024: 앞 문장의 set local lock_timeout 이 남지 않았다 (지금 %) — 파일이 한 트랜잭션으로 돌지 않는 경로다', current_setting('lock_timeout')
      using hint = 'supabase db push 로 적용할 것(파일 하나 = 트랜잭션 하나).';
  end if;
end
$$;

-- =========================================================================
-- 1. 칸 · CHECK
-- =========================================================================
alter table vehicles add column if not exists description_ko text;
alter table vehicles add column if not exists image_path text;

alter table vehicles drop constraint if exists vehicles_description_ko_len;
alter table vehicles add constraint vehicles_description_ko_len
  check (description_ko is null or char_length(description_ko) <= 300);

alter table vehicles drop constraint if exists vehicles_image_path_format;
alter table vehicles add constraint vehicles_image_path_format
  check (
    image_path is null
    or image_path ~ '^gallery/vehicles/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-1600\.webp$'
    or image_path ~ '^/hero/bus-0[1-6]\.jpg$'
  );

-- =========================================================================
-- 2. 백필 — 지금 공개 화면의 문구·사진 그대로. 빈 칸만 채운다(관리자가 고친 값을 재실행이 덮지 않게).
-- =========================================================================
update vehicles v
   set description_ko = coalesce(v.description_ko, s.description_ko),
       image_path     = coalesce(v.image_path, s.image_path)
  from (values
    ('bus45',  '단체 워크숍·현장학습·종교단체 이동에 쓰이는 대형 차량.', '/hero/bus-01.jpg'),
    ('bus35',  '중형 단체에 알맞은 크기. 친목회·가족여행·통근 운행까지 폭넓게 운용합니다.', '/hero/bus-04.jpg'),
    ('limo28', '넓은 좌석 간격의 우등 시트. 외국인 의전·관광, 관혼상제 등 격이 필요한 일정에 추천합니다.', '/hero/bus-03.jpg'),
    ('bus25',  '소규모 단체의 합리적인 선택. 대학MT·워크숍 등 20명 안팎 일정에 적합합니다.', '/hero/bus-02.jpg'),
    ('bus16',  '공항 픽업·샌딩과 소규모 이동에 적합. 골목길 진입이 편해 도심 일정에 강합니다.', '/hero/bus-05.jpg')
  ) as s(slug, description_ko, image_path)
 where v.slug = s.slug
   and (v.description_ko is null or v.image_path is null);

-- =========================================================================
-- 3. definer 함수 다섯 — 첫 문장 is_admin() 가드 · search_path public, pg_temp
-- =========================================================================

-- 만들기 — slug 는 서버가 짓는다('v-' + 무작위 8자, 23505 면 다시). 순서는 맨 뒤.
create or replace function admin_create_vehicle(
  p_name_ko text, p_name_en text, p_capacity integer, p_description_ko text, p_image_path text, p_active boolean
)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id   integer;
  v_slug text;
  v_try  integer := 0;
begin
  if not is_admin() then
    raise exception 'admin_create_vehicle: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  loop
    v_try := v_try + 1;
    v_slug := 'v-' || substr(md5(gen_random_uuid()::text), 1, 8);
    begin
      insert into vehicles (slug, name_ko, name_en, capacity, description_ko, image_path, sort, active)
      values (v_slug, p_name_ko, p_name_en, p_capacity, p_description_ko, p_image_path,
              coalesce((select max(sort) from vehicles), 0) + 1, p_active)
      returning vehicles.id into v_id;
      exit;
    exception when unique_violation then
      if v_try >= 5 then
        raise;
      end if;
    end;
  end loop;

  return query select v_id;
end;
$$;

-- 고치기 — 'updated' | 'not_found' | 'locked'(접수 기록이 있는데 이름·정원을 바꾸려 함 — 아무것도 쓰지 않는다)
create or replace function admin_update_vehicle(
  p_id integer, p_name_ko text, p_name_en text, p_capacity integer, p_description_ko text, p_image_path text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row vehicles%rowtype;
begin
  if not is_admin() then
    raise exception 'admin_update_vehicle: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  select * into v_row from vehicles where vehicles.id = p_id for update;
  if not found then
    return 'not_found';
  end if;

  if (v_row.name_ko is distinct from p_name_ko or v_row.name_en is distinct from p_name_en or v_row.capacity is distinct from p_capacity)
     and exists (select 1 from reservations r where r.vehicle_slug = v_row.slug) then
    return 'locked';
  end if;

  update vehicles
     set name_ko = p_name_ko, name_en = p_name_en, capacity = p_capacity,
         description_ko = p_description_ko, image_path = p_image_path
   where vehicles.id = p_id;
  return 'updated';
end;
$$;

create or replace function admin_set_vehicle_active(p_id integer, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_set_vehicle_active: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update vehicles set active = p_active where vehicles.id = p_id returning vehicles.id into v_id;
  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

-- 지우기 — 'deleted' | 'not_found' | 'referenced'(접수 기록이 있다 — FK restrict 23503. 숨기기만 허용)
create or replace function admin_delete_vehicle(p_id integer)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_delete_vehicle: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  begin
    delete from vehicles where vehicles.id = p_id returning vehicles.id into v_id;
  exception when foreign_key_violation then
    return 'referenced';
  end;
  if v_id is null then
    return 'not_found';
  end if;
  return 'deleted';
end;
$$;

-- 순서 — 배열 순서대로 sort = 1..n. 지금 표의 id 집합과 정확히 같아야 한다(빠짐·덧붙임·중복·null 거부 → 22023).
create or replace function admin_reorder_vehicles(p_ids integer[])
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_given    integer;
  n_distinct integer;
  n_table    integer;
  n_match    integer;
begin
  if not is_admin() then
    raise exception 'admin_reorder_vehicles: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'admin_reorder_vehicles: 빈 순서다' using errcode = '22023';
  end if;
  if array_position(p_ids, null) is not null then
    raise exception 'admin_reorder_vehicles: 순서에 빈 값이 있다' using errcode = '22023';
  end if;

  select count(*), count(distinct x) into n_given, n_distinct from unnest(p_ids) as u(x);
  if n_given <> n_distinct then
    raise exception 'admin_reorder_vehicles: 같은 차량이 두 번 있다' using errcode = '22023';
  end if;

  -- 표 전체를 잠그지 않는다 — 행 잠금만(지금 행 전부).
  perform 1 from vehicles for update;
  select count(*) into n_table from vehicles;
  select count(*) into n_match from vehicles v where v.id = any (p_ids);
  if n_table <> n_given or n_match <> n_given then
    raise exception 'admin_reorder_vehicles: 순서가 지금 차량 목록과 다르다' using errcode = '22023';
  end if;

  return query
    update vehicles v set sort = o.pos::integer
      from unnest(p_ids) with ordinality as o(vid, pos)
     where v.id = o.vid
    returning v.id;
end;
$$;

-- =========================================================================
-- 4. 실행 권한 — 기본권한이 준 EXECUTE 를 같은 트랜잭션에서 걷고 authenticated 에만 다시 준다
-- =========================================================================
revoke all on function admin_create_vehicle(text, text, integer, text, text, boolean) from public, anon, service_role;
revoke all on function admin_update_vehicle(integer, text, text, integer, text, text) from public, anon, service_role;
revoke all on function admin_set_vehicle_active(integer, boolean) from public, anon, service_role;
revoke all on function admin_delete_vehicle(integer) from public, anon, service_role;
revoke all on function admin_reorder_vehicles(integer[]) from public, anon, service_role;

grant execute on function admin_create_vehicle(text, text, integer, text, text, boolean) to authenticated;
grant execute on function admin_update_vehicle(integer, text, text, integer, text, text) to authenticated;
grant execute on function admin_set_vehicle_active(integer, boolean) to authenticated;
grant execute on function admin_delete_vehicle(integer) to authenticated;
grant execute on function admin_reorder_vehicles(integer[]) to authenticated;

-- =========================================================================
-- 5. 자기검증
--   ① vehicles 표: anon·authenticated 는 SELECT 말고 아무 권한도 없다(종류는 acldefault 에서 열거 — MAINTAIN 포함) · PUBLIC 0
--   ② 새 칸은 anon 이 읽을 수 있다(공개 화면이 읽는다 — has_any_column_privilege)
--   ③ 새 함수 다섯: 있다 · EXECUTE 보유자가 소유자 말고 authenticated 하나뿐(aclexplode 전수) · definer · search_path · 첫 문장 가드
--   ④ CHECK 거동: 허용 두 형식은 들어가고, 절대 URL·다른 접두어·301자 설명은 거부된다(되돌린다)
--   ⑤ 가드 거동: 명단 밖 authenticated 는 가드 문구의 42501 을, anon 은 EXECUTE 거부를 받는다
--   ⑥ 백필: 시드 5행이 있으면 설명·사진이 비어 있지 않다
-- =========================================================================
do $$
declare
  applier constant text := current_user;
  sigs    constant text[] := array[
    'public.admin_create_vehicle(text,text,integer,text,text,boolean)',
    'public.admin_update_vehicle(integer,text,text,integer,text,text)',
    'public.admin_set_vehicle_active(integer,boolean)',
    'public.admin_delete_vehicle(integer)',
    'public.admin_reorder_vehicles(integer[])'
  ];
  leaked  text;
  st      text;
  ms      text;
  ok      boolean;
begin
  -- ① 표 권한
  select string_agg(format('%s/%s', r.role, lower(d.privilege_type)), ', ' order by r.role, d.privilege_type)
    into leaked
    from (values ('anon'), ('authenticated')) r(role)
    cross join lateral aclexplode(acldefault('r', (select relowner from pg_class where oid = 'public.vehicles'::regclass))) d
   where d.privilege_type <> 'SELECT'
     and has_table_privilege(r.role, 'public.vehicles'::regclass, d.privilege_type);
  if leaked is not null then
    raise exception '0024: vehicles 에 공개 롤의 SELECT 아닌 권한이 있다 — %', leaked
      using hint = '0020 이 회수한 쓰기 권한이 되살아났다. UPDATE·DELETE·TRUNCATE·MAINTAIN 중 하나라도 있으면 표를 잠글 수 있다(D10).';
  end if;
  select string_agg(lower(a.privilege_type), ', ') into leaked
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = 'public.vehicles'::regclass and a.grantee = 0;
  if leaked is not null then
    raise exception '0024: vehicles 에 PUBLIC 권한이 있다 — %', leaked;
  end if;

  -- ② 새 칸 공개 읽기
  if not has_column_privilege('anon', 'public.vehicles'::regclass, 'description_ko', 'select')
     or not has_column_privilege('anon', 'public.vehicles'::regclass, 'image_path', 'select') then
    raise exception '0024: anon 이 새 칸을 읽지 못한다 — 공개 /fleet·홈이 에러가 난다';
  end if;

  -- ③ 함수 상태
  select string_agg(x, ', ' order by x) into leaked from (
    select format('없다:%s', s.sig) as x from unnest(sigs) s(sig) where to_regprocedure(s.sig) is null
    union all
    select format('EXECUTE 보유자 어긋남:%s (%s)', s.sig, coalesce(h.holders, '(없음)'))
      from unnest(sigs) s(sig)
      join pg_proc p on p.oid = to_regprocedure(s.sig)
      left join lateral (
        select string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',') as holders
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
      ) h on true
     where h.holders is distinct from 'authenticated'
    union all
    select format('definer·search_path 어긋남:%s', s.sig)
      from unnest(sigs) s(sig) join pg_proc p on p.oid = to_regprocedure(s.sig)
     where not p.prosecdef or coalesce(array_to_string(p.proconfig, ' '), '') <> 'search_path=public, pg_temp'
    union all
    select format('첫 문장이 is_admin 가드가 아니다:%s', s.sig)
      from unnest(sigs) s(sig) join pg_proc p on p.oid = to_regprocedure(s.sig)
     where p.prosrc !~ '^\s*(declare\s.*?)?begin\s+if not is_admin\(\) then\s+raise exception'
  ) y;
  if leaked is not null then
    raise exception '0024: 새 함수의 상태가 기대와 다르다 — %', leaked
      using hint = '§4 의 revoke/grant 목록과 함수 시그니처가 같은지 볼 것. 기본권한이 anon·service_role 에도 EXECUTE 를 준다(CLAUDE.md §3).';
  end if;

  -- ④ CHECK 거동 — 서브트랜잭션에서 넣고 되돌린다
  begin
    insert into vehicles (slug, name_ko, name_en, capacity, sort, image_path, description_ko)
    values ('zz-0024-a', '검증', 'check', 1, 900001, 'gallery/vehicles/0b8f0c5e-1d2a-4c3b-9e4f-5a6b7c8d9e0f-1600.webp', repeat('가', 300)),
           ('zz-0024-b', '검증', 'check', 1, 900002, '/hero/bus-06.jpg', null);
    raise exception using errcode = 'P0024', message = 'probe rollback';
  exception when sqlstate 'P0024' then null;
  end;
  foreach ms in array array[
    'https://example.com/a.jpg', '/hero/bus-07.jpg', 'gallery/popups/0b8f0c5e-1d2a-4c3b-9e4f-5a6b7c8d9e0f-1600.webp',
    'gallery/vehicles/../x-1600.webp', 'gallery/vehicles/0B8F0C5E-1D2A-4C3B-9E4F-5A6B7C8D9E0F-1600.webp'
  ] loop
    ok := false;
    begin
      insert into vehicles (slug, name_ko, name_en, capacity, sort, image_path) values ('zz-0024-c', '검증', 'check', 1, 900003, ms);
      raise exception using errcode = 'P0024', message = 'probe rollback';
    exception
      when check_violation then ok := true;
      when sqlstate 'P0024' then ok := false;
    end;
    if not ok then
      raise exception '0024: image_path CHECK 가 % 를 받아들였다', ms;
    end if;
  end loop;
  ok := false;
  begin
    insert into vehicles (slug, name_ko, name_en, capacity, sort, description_ko) values ('zz-0024-d', '검증', 'check', 1, 900004, repeat('가', 301));
    raise exception using errcode = 'P0024', message = 'probe rollback';
  exception
    when check_violation then ok := true;
    when sqlstate 'P0024' then ok := false;
  end;
  if not ok then
    raise exception '0024: description_ko 301자가 들어갔다 — 길이 CHECK 가 없다';
  end if;

  -- ⑤ 가드 거동 — authenticated(JWT 없음 = 명단 밖)는 가드 문구, anon 은 EXECUTE 거부
  st := null; ms := null;
  begin
    execute 'set local role authenticated';
    perform admin_set_vehicle_active(-1, false);
  exception when others then
    get stacked diagnostics st = returned_sqlstate, ms = message_text;
  end;
  execute format('set local role %I', applier);
  if st is distinct from '42501' or ms is distinct from 'admin_set_vehicle_active: 관리자 명단에 없는 호출자다' then
    raise exception '0024: 명단 밖 authenticated 가 가드에 막히지 않았다 (SQLSTATE=% MESSAGE=%)', st, ms;
  end if;
  st := null; ms := null;
  begin
    execute 'set local role anon';
    perform admin_delete_vehicle(-1);
  exception when others then
    get stacked diagnostics st = returned_sqlstate, ms = message_text;
  end;
  execute format('set local role %I', applier);
  if st is distinct from '42501' or ms not like 'permission denied for function%' then
    raise exception '0024: anon 이 차량 함수를 실행했다 (SQLSTATE=% MESSAGE=%)', st, ms;
  end if;
  if current_user <> applier then
    raise exception '0024: 적용 롤(%)로 돌아오지 못했다 (current_user=%)', applier, current_user;
  end if;

  -- ⑥ 백필
  select string_agg(v.slug, ', ') into leaked from vehicles v
   where v.slug in ('bus45', 'bus35', 'limo28', 'bus25', 'bus16') and (v.description_ko is null or v.image_path is null);
  if leaked is not null then
    raise exception '0024: 백필이 비었다 — %', leaked;
  end if;

  raise notice '0024: vehicles 칸 2 · CHECK 2 · definer 함수 5 (EXECUTE=authenticated) · 표 권한 SELECT 전용 확인 · 가드·CHECK 거동 확인';
end
$$;

notify pgrst, 'reload schema';

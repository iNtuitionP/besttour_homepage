-- 0025_gallery_posts.sql — 갤러리 앨범을 "글" 로 승격한다 (OWNER-FEEDBACK T4-2 · 사장님 요청 6.3·19 · 결정 8-②)
--
-- ## 무엇을 하나
--   1. `gallery_albums` 에 `body`(제한 서식 문자열 · lib/content/richText.ts — HTML 이 아니다)와
--      `published_at date`(KST 오늘이 기본 — 0004 선례)를 더한다. 글 하나 = 제목 + 날짜 + 본문 + 사진 여러 장(gallery.album_id).
--      🔴 anon 은 이 표에 **표 단위 SELECT** 를 갖고 있다(0008:96) — 새 칸은 자동으로 공개된다. 그래서 **공개해도 되는 칸만** 더한다
--      (본문·게시일은 공개 /gallery 가 읽는 값이다). §5 ① 이 anon 이 읽는 칸 목록을 **정확히** 대조한다 — 다음에 칸을 더하는 사람이 멈춘다.
--      기존 행의 게시일은 만든 날(created_at 의 KST 날짜)로 채운다. 본문은 비워 둔다(null = 본문 없는 글).
--   2. 앨범 함수 두 개의 서명을 바꾼다(drop + create). **같은 트랜잭션에서 revoke/grant 를 다시 적는다**(CLAUDE.md §3 —
--      drop 후 create 는 기본권한이 EXECUTE 를 anon·authenticated·service_role 에 다시 연다).
--        · admin_create_album(p_title, p_body, p_published_at, p_active) → (id, slug).
--          **slug 는 DB 가 짓는다**('a-' + 무작위 8자, 23505 면 다시 — 0024 차량과 같은 방식). 입력란이 없어진다.
--        · admin_update_album(p_id, p_title, p_body, p_published_at, p_active) — **slug 를 받지 않는다.**
--          수정이 공개 주소 `/gallery/<slug>` 를 바꿀 길 자체가 없다(옛 함수는 p_slug 를 받아 덮어썼다).
--        · 정렬(sort)은 받지 않는다 — 글은 게시일 최신순이다. 칸은 남는다(옛 행의 값 · 사진 고르기 목록의 보조 순서).
--   3. 0015 개정 — **글(앨범)을 지우면 그 안의 사진은 언제나 비공개로 내린다**(결정 8 (b) · 되돌릴 수 있다).
--      0015 는 비활성 앨범을 지울 때만 내리고 활성 앨범의 사진은 미분류로 **계속 공개**했다. 사장님은 글을 지우면 사진도
--      사라진다고 기대하신다. 행·파일은 지우지 않는다 — 사진은 '미분류 · 숨김' 으로 남고 관리자 사진 목록에서 다시 켤 수 있다.
--      트리거의 when 절(not old.active)을 걷어 낸다.
--
-- ## 바꾸지 않는 것
--   · 표 GRANT·RLS 정책 — 공개 정책 `gallery_albums_select_active`(active) · 관리자 `gallery_albums_admin_select` 그대로.
--   · admin_set_album_active · admin_delete_album 서명·ACL(§5 ② 가 보유자를 다시 본다).
--   · 기존 slug — 공개 주소는 그대로다(새 글에만 자동 생성).
--
-- ## 배포 순서 (필수)
--   **원격 DB 적용 → 코드 배포.** 새 코드는 새 칸을 SELECT 하고 새 서명을 부른다. DB 를 먼저 올리면 코드가 나가기 전 몇 분 동안
--   옛 관리자 화면의 앨범 만들기·고치기가 실패한다(옛 서명이 없다 — 공개 화면은 영향 없음: 옛 코드는 새 칸을 모른다).
--   롤백은 반대: 코드를 먼저 되돌린 뒤 supabase/rollbacks/0025_gallery_posts.down.sql.
--
-- 재실행 안전: add column if not exists · 빈 게시일만 채움 · drop function if exists · create or replace.

-- lock_timeout 상한 (P5-15 R7): CLI 가 이 파일을 한 트랜잭션으로 돌려 set local 은 이 파일에만 걸린다 — 잠금을 5초 넘게 기다리면 파일째 롤백.
set local lock_timeout = '5s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0025: 앞 문장의 set local lock_timeout 이 남지 않았다 (지금 %) — 파일이 한 트랜잭션으로 돌지 않는 경로다', current_setting('lock_timeout')
      using hint = 'supabase db push 로 적용할 것(파일 하나 = 트랜잭션 하나).';
  end if;
end
$$;

-- =========================================================================
-- 1. 칸
-- =========================================================================
alter table gallery_albums add column if not exists body text;
alter table gallery_albums drop constraint if exists gallery_albums_body_len;
-- 보이는 글자 4000(앱 ALBUM_BODY_MAX) × 서식 여유 4(RICH_TEXT_RAW_FACTOR) — 앱이 먼저 거르고 DB 는 폭주 방지선이다.
alter table gallery_albums add constraint gallery_albums_body_len check (body is null or char_length(body) <= 16000);

alter table gallery_albums add column if not exists published_at date;
update gallery_albums set published_at = (created_at at time zone 'Asia/Seoul')::date where published_at is null;
alter table gallery_albums alter column published_at set default (now() at time zone 'Asia/Seoul')::date;
alter table gallery_albums alter column published_at set not null;

-- 공개 목록 경로 — 게시일 최신순(동률은 id 최신순).
create index if not exists gallery_albums_published_idx on gallery_albums (published_at desc, id desc);

-- =========================================================================
-- 2. 앨범 함수 서명 교체 — drop + create + 같은 트랜잭션 revoke/grant
-- =========================================================================
drop function if exists admin_create_album(text, text, integer, boolean);
drop function if exists admin_update_album(integer, text, text, integer, boolean);

create or replace function admin_create_album(p_title text, p_body text, p_published_at date, p_active boolean)
returns table (id integer, slug text)
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
    raise exception 'admin_create_album: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  loop
    v_try := v_try + 1;
    v_slug := 'a-' || substr(md5(gen_random_uuid()::text), 1, 8);
    begin
      insert into gallery_albums (slug, title, body, published_at, sort, active)
      values (v_slug, p_title, p_body, coalesce(p_published_at, (now() at time zone 'Asia/Seoul')::date), 0, p_active)
      returning gallery_albums.id into v_id;
      exit;
    exception when unique_violation then
      if v_try >= 5 then
        raise;
      end if;
    end;
  end loop;

  return query select v_id, v_slug;
end;
$$;

create or replace function admin_update_album(p_id integer, p_title text, p_body text, p_published_at date, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_update_album: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  -- slug 는 건드리지 않는다 — 공개 주소 /gallery/<slug> 가 수정으로 바뀌지 않는다(위험 31).
  update gallery_albums
     set title = p_title, body = p_body,
         published_at = coalesce(p_published_at, gallery_albums.published_at),
         active = p_active
   where gallery_albums.id = p_id
  returning gallery_albums.id into v_id;

  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

revoke all on function admin_create_album(text, text, date, boolean) from public, anon, service_role;
revoke all on function admin_update_album(integer, text, text, date, boolean) from public, anon, service_role;
grant execute on function admin_create_album(text, text, date, boolean) to authenticated;
grant execute on function admin_update_album(integer, text, text, date, boolean) to authenticated;

-- =========================================================================
-- 3. 0015 개정 — 글을 지우면 그 안의 사진은 언제나 비공개(행·파일은 그대로 · 되돌릴 수 있다)
-- =========================================================================
create or replace function gallery_album_delete_keep_visibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 0025: 활성 여부와 상관없이 내린다(결정 8 (b)). FK 의 on delete set null 이 album_id 를 지우기 **전에**(before 트리거) 고른다.
  -- 행도 파일 경로도 지우지 않는다 — 사진은 '미분류 · 숨김' 으로 남고 관리자가 다시 켤 수 있다.
  update gallery set active = false where album_id = old.id and active;
  return old;
end
$$;

drop trigger if exists gallery_albums_keep_visibility_on_delete on gallery_albums;
create trigger gallery_albums_keep_visibility_on_delete
  before delete on gallery_albums
  for each row
  execute function gallery_album_delete_keep_visibility();

revoke all on function gallery_album_delete_keep_visibility() from public, anon, authenticated, service_role;

-- =========================================================================
-- 4. (없음 — 표 ACL·정책은 바꾸지 않는다)
-- =========================================================================

-- =========================================================================
-- 5. 자기검증
--   ① anon: gallery_albums 에 SELECT 말고 아무 권한 없음(종류는 acldefault 에서) · PUBLIC 0 ·
--      anon 이 읽는 칸이 **정확히** 기대 목록(has_column_privilege 전수 — 새 칸이 몰래 공개되지 않게) · has_any_column_privilege 로 쓰기 칸 0
--   ② 함수: 옛 서명 없음 · 앨범 함수 넷의 EXECUTE 보유자 = authenticated 하나 · definer · search_path · 첫 문장 가드 ·
--      트리거 함수는 보유자 0
--   ③ 트리거: before/row/delete · when 절 없음 · 거동 — **활성** 글을 지워도 사진이 내려가고 행은 남는다(되돌린다)
--   ④ 가드: 명단 밖 authenticated 는 가드 문구, anon 은 EXECUTE 거부
-- =========================================================================
do $$
declare
  applier  constant text := current_user;
  expected constant text[] := array['active', 'body', 'created_at', 'description', 'id', 'published_at', 'slug', 'sort', 'title'];
  sigs     constant text[] := array[
    'public.admin_create_album(text,text,date,boolean)',
    'public.admin_update_album(integer,text,text,date,boolean)',
    'public.admin_set_album_active(integer,boolean)',
    'public.admin_delete_album(integer)'
  ];
  leaked   text;
  cols     text[];
  st       text;
  ms       text;
  trg      record;
  photo_active boolean;
  photo_album  integer;
  photo_rows   integer;
begin
  -- ① 표 권한
  select string_agg(format('%s/%s', r.role, lower(d.privilege_type)), ', ' order by r.role, d.privilege_type)
    into leaked
    from (values ('anon'), ('authenticated')) r(role)
    cross join lateral aclexplode(acldefault('r', (select relowner from pg_class where oid = 'public.gallery_albums'::regclass))) d
   where d.privilege_type <> 'SELECT'
     and has_table_privilege(r.role, 'public.gallery_albums'::regclass, d.privilege_type);
  if leaked is not null then
    raise exception '0025: gallery_albums 에 공개 롤의 SELECT 아닌 권한이 있다 — %', leaked;
  end if;
  if has_any_column_privilege('anon', 'public.gallery_albums'::regclass, 'insert')
     or has_any_column_privilege('anon', 'public.gallery_albums'::regclass, 'update')
     or has_any_column_privilege('authenticated', 'public.gallery_albums'::regclass, 'update') then
    raise exception '0025: gallery_albums 에 컬럼 단위 쓰기 권한이 있다';
  end if;
  select string_agg(lower(a.privilege_type), ', ') into leaked
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = 'public.gallery_albums'::regclass and a.grantee = 0;
  if leaked is not null then
    raise exception '0025: gallery_albums 에 PUBLIC 권한이 있다 — %', leaked;
  end if;
  select array_agg(a.attname::text order by a.attname::text) into cols
    from pg_attribute a
   where a.attrelid = 'public.gallery_albums'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('anon', 'public.gallery_albums'::regclass, a.attname, 'select');
  if cols is distinct from expected then
    raise exception '0025: anon 이 읽는 gallery_albums 칸이 기대와 다르다 — 지금 % · 기대 %', cols, expected
      using hint = 'anon 은 표 단위 SELECT 를 갖는다(0008). 새 칸은 자동 공개다 — 공개해도 되는 칸인지 확인하고 expected 를 고칠 것.';
  end if;

  -- ② 함수 상태
  select string_agg(x, ', ' order by x) into leaked from (
    select '옛 서명이 남았다:admin_create_album(text,text,integer,boolean)' as x
     where to_regprocedure('public.admin_create_album(text,text,integer,boolean)') is not null
    union all
    select '옛 서명이 남았다:admin_update_album(integer,text,text,integer,boolean)'
     where to_regprocedure('public.admin_update_album(integer,text,text,integer,boolean)') is not null
    union all
    select format('없다:%s', s.sig) from unnest(sigs) s(sig) where to_regprocedure(s.sig) is null
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
    union all
    select format('트리거 함수 EXECUTE 보유자:%s', a.grantee::regrole::text)
      from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = to_regprocedure('public.gallery_album_delete_keep_visibility()')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  ) y;
  if leaked is not null then
    raise exception '0025: 함수 상태가 기대와 다르다 — %', leaked
      using hint = 'drop + create 는 기본권한이 EXECUTE 를 anon·authenticated·service_role 에 다시 연다(CLAUDE.md §3). §2·§3 의 revoke/grant 를 볼 것.';
  end if;

  -- ③ 트리거
  select t.tgtype, t.tgqual, t.tgfoid into trg
    from pg_trigger t
   where t.tgrelid = 'public.gallery_albums'::regclass and not t.tgisinternal and t.tgname = 'gallery_albums_keep_visibility_on_delete';
  if not found then
    raise exception '0025: gallery_albums 에 before delete 트리거가 없다 — 글을 지우면 사진이 계속 공개된다';
  end if;
  if (trg.tgtype & 1) = 0 or (trg.tgtype & 2) = 0 or (trg.tgtype & 8) = 0 then
    raise exception '0025: 트리거가 before/row/delete 가 아니다 (tgtype=%)', trg.tgtype;
  end if;
  if trg.tgqual is not null then
    raise exception '0025: 트리거에 when 절이 남았다 — 활성 글을 지우면 사진이 계속 공개된다';
  end if;
  if trg.tgfoid <> to_regprocedure('public.gallery_album_delete_keep_visibility()')::oid then
    raise exception '0025: 트리거가 다른 함수(%)를 부른다', trg.tgfoid::regprocedure;
  end if;

  begin
    insert into gallery_albums (slug, title, sort, active) values ('zz-0025-selfcheck', '0025 self-check', 900001, true);
    insert into gallery (image_path, original_path, sort, active, album_id)
    select '0025-self-check/on.webp', '0025-self-check/on.orig', 900001, true, a.id from gallery_albums a where a.slug = 'zz-0025-selfcheck';
    delete from gallery_albums where slug = 'zz-0025-selfcheck';
    select count(*), bool_or(g.active), max(g.album_id) into photo_rows, photo_active, photo_album
      from gallery g where g.image_path = '0025-self-check/on.webp';
    raise exception using errcode = 'P0025', message = 'probe rollback';
  exception when sqlstate 'P0025' then null;
  end;
  if photo_rows is distinct from 1 or photo_active is distinct from false or photo_album is not null then
    raise exception '0025: 활성 글을 지운 뒤 사진 상태가 기대와 다르다 (행 % · active % · album_id %) — 기대 1 · false · null',
      photo_rows, photo_active, photo_album;
  end if;

  -- ④ 가드
  st := null; ms := null;
  begin
    execute 'set local role authenticated';
    perform admin_update_album(-1, 'x', null, null, false);
  exception when others then
    get stacked diagnostics st = returned_sqlstate, ms = message_text;
  end;
  execute format('set local role %I', applier);
  if st is distinct from '42501' or ms is distinct from 'admin_update_album: 관리자 명단에 없는 호출자다' then
    raise exception '0025: 명단 밖 authenticated 가 가드에 막히지 않았다 (SQLSTATE=% MESSAGE=%)', st, ms;
  end if;
  st := null; ms := null;
  begin
    execute 'set local role anon';
    perform admin_create_album('x', null, null, false);
  exception when others then
    get stacked diagnostics st = returned_sqlstate, ms = message_text;
  end;
  execute format('set local role %I', applier);
  if st is distinct from '42501' or ms not like 'permission denied for function%' then
    raise exception '0025: anon 이 앨범 함수를 실행했다 (SQLSTATE=% MESSAGE=%)', st, ms;
  end if;
  if current_user <> applier then
    raise exception '0025: 적용 롤(%)로 돌아오지 못했다 (current_user=%)', applier, current_user;
  end if;

  raise notice '0025: gallery_albums 칸 2(body·published_at, anon 공개 칸 % 개 일치) · 함수 2 서명 교체(EXECUTE=authenticated) · 0015 개정(활성 글 삭제도 사진 비공개) 확인',
    cardinality(expected);
end
$$;

notify pgrst, 'reload schema';

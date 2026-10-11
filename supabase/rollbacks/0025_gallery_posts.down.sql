-- 0025_gallery_posts.down.sql — supabase/migrations/0025_gallery_posts.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다.
--
-- 🔴 순서: **코드를 먼저 0025 이전으로 되돌린 뒤** 이 파일을 돌린다. 새 코드는 body·published_at 을 SELECT 하고
--    새 서명의 앨범 함수를 부른다 — 칸·함수를 먼저 지우면 공개 /gallery 와 관리자 글 화면이 에러다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0025
--
-- ## 하는 일 (0025 의 반대)
--   1. 새 서명의 앨범 함수 둘을 지우고 0020 의 옛 서명(slug·sort 를 받는 것)을 다시 만든다 — **같은 트랜잭션에서 revoke/grant 를 다시 적는다**
--      (drop 후 create 는 기본권한이 EXECUTE 를 공개 롤에 다시 연다 · CLAUDE.md §3).
--   2. 0015 의 트리거(when not old.active)와 함수 본문으로 되돌린다 — 활성 앨범을 지우면 사진이 미분류로 **계속 공개**되는 옛 거동이다.
--   3. body·published_at 칸과 제약·색인을 지운다. 그 사이 쓴 본문·게시일은 **사라진다**(제목·사진·slug 는 남는다).
--
-- 재실행: if exists · create or replace 라 몇 번 돌려도 같다.

begin;

set local lock_timeout = '5s';

drop function if exists admin_create_album(text, text, date, boolean);
drop function if exists admin_update_album(integer, text, text, date, boolean);

create or replace function admin_create_album(p_slug text, p_title text, p_sort integer, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_create_album: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  insert into gallery_albums (slug, title, sort, active)
  values (p_slug, p_title, p_sort, p_active)
  returning gallery_albums.id into v_id;

  return query select v_id;
end;
$$;

create or replace function admin_update_album(p_id integer, p_slug text, p_title text, p_sort integer, p_active boolean)
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

  update gallery_albums set slug = p_slug, title = p_title, sort = p_sort, active = p_active
   where gallery_albums.id = p_id
  returning gallery_albums.id into v_id;

  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

revoke all on function admin_create_album(text, text, integer, boolean) from public, anon, service_role;
revoke all on function admin_update_album(integer, text, text, integer, boolean) from public, anon, service_role;
grant execute on function admin_create_album(text, text, integer, boolean) to authenticated;
grant execute on function admin_update_album(integer, text, text, integer, boolean) to authenticated;

create or replace function gallery_album_delete_keep_visibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.active then
    return old;
  end if;
  update gallery set active = false where album_id = old.id and active;
  return old;
end
$$;

drop trigger if exists gallery_albums_keep_visibility_on_delete on gallery_albums;
create trigger gallery_albums_keep_visibility_on_delete
  before delete on gallery_albums
  for each row
  when (not old.active)
  execute function gallery_album_delete_keep_visibility();

revoke all on function gallery_album_delete_keep_visibility() from public, anon, authenticated, service_role;

drop index if exists gallery_albums_published_idx;
alter table gallery_albums drop constraint if exists gallery_albums_body_len;
alter table gallery_albums drop column if exists body;
alter table gallery_albums drop column if exists published_at;

-- 되돌린 함수의 보유자 확인 — authenticated 하나여야 한다.
do $$
declare
  leaked text;
begin
  select string_agg(format('%s:%s', p.oid::regprocedure, a.grantee::regrole), ', ') into leaked
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid in (to_regprocedure('public.admin_create_album(text,text,integer,boolean)'), to_regprocedure('public.admin_update_album(integer,text,text,integer,boolean)'))
     and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner and a.grantee::regrole::text <> 'authenticated';
  if leaked is not null then
    raise exception '0025 롤백: 되돌린 앨범 함수가 공개 롤에 열렸다 — %', leaked;
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;

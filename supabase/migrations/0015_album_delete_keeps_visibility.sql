-- 0015_album_delete_keeps_visibility.sql — 앨범을 지워도 공개 여부가 바뀌지 않게 한다 (플랜 v4 P6-9 · D8)
--
-- ## 무엇이 잘못돼 있었나
-- 0008 은 두 가지를 동시에 정했다.
--   (1) `alter table gallery … album_id int references gallery_albums (id) **on delete set null**` (0008:61)
--   (2) 공개 정책 `gallery_select_active` (0008:99-102)
--         active and (album_id is null or exists (select 1 from gallery_albums a where a.id = gallery.album_id and a.active))
-- 둘 다 각각은 옳은데 **합쳐지면 삭제가 공개 스위치가 된다.**
--   · 사진이 active 이고 소속 앨범이 비활성이면 `exists` 가 거짓이라 손님에게 **안 보인다**.
--   · 그 앨범을 **지우면** FK 가 `album_id` 를 null 로 만들고, 그 순간 `album_id is null` 가지가 열려 **보인다**.
-- 사장님의 머릿속은 정확히 반대다 — "이 앨범은 안 보이게 해 뒀으니 이제 지워도 되겠다" 가
-- **지우는 순간 손님에게 공개** 로 끝난다. 실측(2026-09-16, 로컬 스택):
--   삭제 전 anon 조회 1행(활성 앨범 사진) → 앨범 둘 삭제 → 삭제 후 anon 조회 **2행**(비활성 앨범 사진이 올라왔다).
--
-- ## 고치지 않는 것 두 가지 — 둘 다 고치면 더 큰 사고가 난다
--   · `on delete set null` → `cascade` 로 바꾸지 않는다. 0008:56-58 이 이유를 적어 뒀다: 앨범 하나를 지울 때
--     사진 수백 장의 DB 행이 사라지고 **Storage 객체는 남아 복구 불가능한 고아 파일**이 된다. 행을 남기는 선택은 유지한다.
--   · 공개 정책의 `album_id is null` 가지를 없애지 않는다. 앨범 도입 이전의 평면 사진이 전부 그 상태이고
--     (미분류 = 지금 공개 갤러리의 기본 상태), 없애면 갤러리가 통째로 빈다.
--
-- ## 이 파일이 세우는 불변식
--   **삭제가 공개 여부를 바꾸면 안 된다.**
--   지우기 전에 안 보이던 사진은 지운 뒤에도 안 보인다. 보이던 앨범을 지우면 계속 보인다(놀랍지 않다).
-- 그래서 `before delete` 트리거가 **지워지는 앨범이 비활성일 때만** 그 앨범 사진을 `active = false` 로 내린다.
-- 활성 앨범을 지울 때 사진을 내리는 것은 **반대 방향의 같은 잘못**이다(보이던 것이 사라진다) — 하지 않는다.
--
-- ## 왜 애플리케이션이 아니라 DB 인가
-- `deleteAlbumRow`(lib/admin/gallery.ts:285-290)는 세션 클라이언트로 도는 평범한 `delete` 하나다. 거기에 조건을 얹으면
-- 그 경로에서만 참이 되고 대시보드·psql·앞으로 생길 다른 액션에서는 그대로 깨진다. 규칙을 DB 에 두는 것이 이 저장소의 관례다
-- (0009 의 RLS·0005/0010 의 definer 함수). 게다가 FK 의 `set null` 자체가 DB 안에서 벌어지는 일이라, 그것을 상쇄하는
-- 규칙도 **같은 트랜잭션·같은 층**에 있어야 한다.
--
-- ## before 인 이유 (after 로는 만들 수 없다)
-- `on delete set null` 은 내부적으로 **AFTER DELETE** RI 트리거다. after 로 짜면 우리 코드가 도는 시점에는 이미
-- `album_id` 가 null 이라 **어느 사진이 그 앨범 것이었는지 알 방법이 없다.** before 에서는 아직 `album_id = old.id` 다.
--
-- ## security definer 인 이유 (invoker 가 아니라)
--   ① `gallery` 는 RLS 가 켜져 있고(0001), 관리자 경로의 쓰기는 `gallery_admin_all`(0009 §5)이 `is_admin()` 으로 받친다.
--      invoker 로 두면 이 update 가 **호출자의 정책 평가를 받는다** — 정책이 거짓이면 오류도 나지 않고 **0행 갱신**으로 조용히
--      끝난다. 즉 실패 모드가 "안 보이던 사진이 공개된다" 이고, 그것이 바로 이 파일이 막으려는 사고다.
--   ② 짝이 되는 FK 의 `set null` 은 RI 트리거라 **RLS 와 권한 검사를 받지 않는다.** 한쪽(공개로 미는 힘)은 무조건 돌고
--      다른 쪽(막는 힘)만 정책에 걸리면 불변식이 성립할 수 없다. 두 힘을 같은 조건에 둔다.
--   ③ 함수 소유자는 마이그레이션 롤(postgres)이고 `gallery` 의 소유자도 postgres, `relforcerowsecurity = false` 다
--      (2026-09-16 실측) — 따라서 definer 본문의 update 는 RLS 를 통과한다.
-- 대가로 definer 의 표준 방어를 전부 붙인다: `set search_path = public, pg_temp`(0009·0010 이 정본. pg_temp 를 목록에서
-- 빼면 Postgres 가 그것을 **맨 앞**에서 암묵 검색해 임시 스키마 섀도잉 여지가 남는다) + 아래 §3 의 EXECUTE 회수.
-- 함수가 하는 일은 "지워지는 앨범의 사진을 내린다" 하나뿐이고 인자를 받지 않는다 — definer 로 열 수 있는 표면이 그만큼 좁다.
--
-- ## 🔴 EXECUTE 는 반드시 회수한다 (CLAUDE.md §3)
-- 이 DB 에는 `alter default privileges for role postgres in schema public grant all on functions to anon, authenticated;`
-- 가 **실재한다**(2026-09-16 컨트롤러 실측 · 0014 헤더와 같은 근거). 새 함수의 EXECUTE 가 "빠뜨려서 남는" 것이 아니라
-- **적극적으로 부여된다.** §3 이 같은 트랜잭션에서 걷어내고 §4 ② 가 실행 중에 확인한다.
-- 실측으로 하나 더 나왔다(pg_default_acl): 받는 롤은 **anon·authenticated·service_role 셋**이고, 같은 기본권한을
-- `postgres` 와 `supabase_admin` 두 grantor 가 각각 깔아 둔다. 그래서 §3 의 회수 목록에 service_role 도 들어간다.
-- 회수해도 트리거는 정상 발화한다 — **트리거 함수의 EXECUTE 는 트리거를 만들 때만 검사되고 발화 시점에는 검사되지 않는다**
-- (2026-09-16 로컬 스택 실측: anon·authenticated 모두 execute=false 인 채로 `authenticated` 의 delete 가 트리거를 태웠다).
-- 그래서 `grant execute … to` 를 **아무에게도 하지 않는다.** 소유자만 남는다.
--
-- **기본권한이 실제로 붙는 시점**: `create or replace` 는 **이미 있는 함수의 ACL 을 보존한다.** 기본권한이 EXECUTE 를
-- 새로 부여하는 것은 **최초 생성(또는 drop 후 재생성)** 때뿐이다 — 그러므로 §4 ② 는 두 번째 적용에서는 조용히 통과한다.
-- 그것이 이 검사가 약하다는 뜻은 아니다. 위험한 것이 바로 그 최초 생성이고, 거기서 잡는다(2026-09-16 뮤테이션 실측:
-- 함수를 지운 뒤 revoke 없이 적용하면 `anon=t · authenticated=t` 로 멈춘다). 재적용에서 revoke 는 멱등하게 다시 돈다.
--
-- 기존 행 영향: 함수 하나와 트리거 하나를 더한다. 표·컬럼·CHECK·인덱스·정책·데이터 변경 0.
--   (§4 ③ 의 자기검증이 임시 앨범 2건·사진 2건을 넣지만 같은 블록에서 되돌린다 — 표에 남지 않는다.)
-- 재실행 안전: create 는 or replace, drop trigger 는 if exists, revoke 는 멱등이다.
-- PostgREST 스키마 캐시: 갱신하지 않는다. 트리거 함수는 반환형이 `trigger` 라 PostgREST 가 RPC 로 노출하지 않고,
--   표·컬럼 모양도 바뀌지 않는다(0014 는 **RPC 시그니처**가 바뀌어 필요했던 것이다).
-- 롤백: supabase/rollbacks/0015_album_delete_keeps_visibility.down.sql (수동 실행 전용 · 승인 플래그 요구 — 근거는 그 파일 헤더).

-- =========================================================================
-- 1. 트리거 함수 — 지워지는 앨범이 비활성일 때만 그 앨범 사진을 내린다
-- =========================================================================
create or replace function gallery_album_delete_keep_visibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 활성 앨범이었으면 아무것도 하지 않는다. 보이던 사진을 내리는 것도 "삭제가 공개 여부를 바꾸는" 같은 잘못이다.
  -- (트리거의 when 절이 이미 거르지만 본문에도 둔다 — when 절 없이 다시 붙이는 사람이 있어도 불변식은 함수가 지킨다.)
  if old.active then
    return old;
  end if;

  -- `and active` 로 이미 내려가 있는 행은 건드리지 않는다 — 바꿀 것이 없는 update 를 남기지 않는다.
  -- 행도 파일 경로도 지우지 않는다. 이 트리거가 바꾸는 컬럼은 active 하나뿐이다(고아 파일 방지 의도를 그대로 둔다).
  update gallery set active = false where album_id = old.id and active;

  return old;
end
$$;

-- =========================================================================
-- 2. 트리거 — before delete · 행 단위 · 비활성 앨범에만
--    when 절에 조건을 두면 활성 앨범 삭제에서는 함수가 호출조차 되지 않고, 조건이 pg_get_triggerdef 로 드러나
--    "무엇을 할 때만 도는가" 를 사람이 읽을 수 있다(테스트도 그것을 잠근다).
-- =========================================================================
drop trigger if exists gallery_albums_keep_visibility_on_delete on gallery_albums;
create trigger gallery_albums_keep_visibility_on_delete
  before delete on gallery_albums
  for each row
  when (not old.active)
  execute function gallery_album_delete_keep_visibility();

-- =========================================================================
-- 3. 실행 권한 — 기본권한이 부여한 EXECUTE 를 **같은 트랜잭션에서** 걷어낸다 (CLAUDE.md §3)
--    grant 는 없다. 트리거 발화에는 EXECUTE 가 필요하지 않다(헤더의 실측) — 그러므로 남길 롤도 없다.
--    `service_role` 까지 회수한다: 이 DB 의 default privileges 는 **service_role 에도** 함수 EXECUTE 를 준다
--    (pg_default_acl 실측 — postgres·supabase_admin 두 grantor 가 `anon·authenticated·service_role=X` 를 깐다).
--    0014 는 service_role 이 실제로 부르는 RPC 라 남겼지만, 이 함수는 아무도 부르지 않는다.
--    (§4 ② 의 아클 전수 검사가 이것을 실제로 잡아냈다 — 처음 적용에서 service_role 이 걸려 멈췄다.)
-- =========================================================================
revoke all on function gallery_album_delete_keep_visibility() from public, anon, authenticated, service_role;

-- =========================================================================
-- 4. 자기검증 — 조용히 어긋나는 것 셋을 실행 중에 못박는다 (0012·0013·0014 와 같은 규약)
--    ① 트리거가 실제로 gallery_albums 의 before delete 로 붙었는가
--    ② 공개 롤이 그 함수를 실행할 수 있는가(= 기본권한이 되돌려 놓은 것을 회수하지 못했는가)
--    ③ 거동 — 비활성 앨범을 지우면 사진이 내려가고, 활성 앨범을 지우면 내려가지 않고, 어느 쪽도 사진 행이 사라지지 않는가
-- =========================================================================
do $$
declare
  fn_sig      constant text := 'public.gallery_album_delete_keep_visibility()';
  probe_mark  constant text := '0015-self-check/';
  fn_oid      oid;
  trg         record;
  holders     text;
  off_active  boolean := null;   -- 비활성 앨범에 있던 사진의 삭제 후 active
  on_active   boolean := null;   -- 활성  앨범에 있던 사진의 삭제 후 active
  rows_left   int     := -1;     -- 삭제 후 남아 있는 임시 사진 행 수 (기대 2 — 사진은 지워지지 않는다)
  paths_left  int     := -1;     -- 그중 original_path 가 살아 있는 행 수 (기대 2)
  albums_left int     := -1;     -- 삭제 후 남은 임시 앨범 수 (기대 0)
begin
  -- ① 트리거 부착
  fn_oid := to_regprocedure(fn_sig)::oid;
  if fn_oid is null then
    raise exception '0015: 트리거 함수 % 가 만들어지지 않았다', fn_sig
      using hint = '§1 의 create or replace function 이 실행됐는지 확인할 것.';
  end if;

  select t.tgname, t.tgtype, t.tgenabled, t.tgfoid
    into trg
    from pg_trigger t
   where t.tgrelid = 'public.gallery_albums'::regclass
     and not t.tgisinternal
     and t.tgname = 'gallery_albums_keep_visibility_on_delete';
  if not found then
    raise exception '0015: gallery_albums 에 before delete 트리거가 붙지 않았다 — 앨범을 지우면 숨긴 사진이 공개된다'
      using hint = '§2 의 create trigger 를 확인할 것. drop trigger 만 돌고 create 가 실패했을 수 있다.';
  end if;
  if trg.tgfoid <> fn_oid then
    raise exception '0015: 트리거가 다른 함수(%)를 부른다', trg.tgfoid::regprocedure
      using hint = '같은 이름의 옛 함수가 남아 있는지 확인할 것.';
  end if;
  -- tgtype 비트: 1 = row, 2 = before, 8 = delete (pg_trigger 의 TRIGGER_TYPE_* 상수)
  if (trg.tgtype & 1) = 0 or (trg.tgtype & 2) = 0 or (trg.tgtype & 8) = 0 then
    raise exception '0015: 트리거가 before/row/delete 가 아니다 (tgtype=%)', trg.tgtype
      using hint = 'after 로 붙으면 FK 의 on delete set null 이 먼저 돌아 album_id 가 이미 null 이다 — 어느 사진이 그 앨범 것이었는지 알 수 없다. statement 단위면 old 가 없다.';
  end if;
  if trg.tgenabled = 'D' then
    raise exception '0015: 트리거가 비활성(disabled) 상태다'
      using hint = 'alter table gallery_albums enable trigger gallery_albums_keep_visibility_on_delete;';
  end if;

  -- ② EXECUTE 보유자 — 소유자 말고는 아무도 없어야 한다.
  --    이 DB 의 alter default privileges 가 create 직후 anon·authenticated 에 EXECUTE 를 **자동으로 부여한다**(헤더 참조).
  if has_function_privilege('anon', fn_oid, 'execute') or has_function_privilege('authenticated', fn_oid, 'execute') then
    raise exception '0015: 공개 롤이 트리거 함수를 실행할 수 있다 (anon=% · authenticated=%)',
      has_function_privilege('anon', fn_oid, 'execute'), has_function_privilege('authenticated', fn_oid, 'execute')
      using hint = 'create 는 이 DB 의 alter default privileges 때문에 공개 롤에 EXECUTE 를 부여한다. §3 의 revoke all … from public, anon, authenticated, service_role 이 create **뒤에** 같은 트랜잭션으로 있어야 한다. 회수해도 트리거 발화에는 지장이 없다.';
  end if;

  select string_agg(distinct g, ', ')
    into holders
    from (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as g
        from pg_proc p
        cross join lateral aclexplode(p.proacl) a
       where p.oid = fn_oid and a.privilege_type = 'EXECUTE'
    ) s
   where s.g <> (select pg_get_userbyid(proowner) from pg_proc where oid = fn_oid);
  if holders is not null then
    raise exception '0015: 트리거 함수의 EXECUTE 를 소유자 말고도 갖고 있다 — %', holders
      using hint = 'PUBLIC 이 보이면 revoke 문에 public 이 빠졌다. 다른 롤이 보이면 이 파일 밖에서 grant 한 것이다 — 트리거는 EXECUTE 없이 발화하므로 grant 할 이유가 없다.';
  end if;

  -- ③ 거동 — 임시 앨범 2·사진 2를 넣고 실제로 지워 본 뒤 전부 되돌린다(서브트랜잭션).
  begin
    insert into gallery_albums (slug, title, sort, active)
    values ('zz-0015-selfcheck-off', '0015 self-check off', 900001, false),
           ('zz-0015-selfcheck-on',  '0015 self-check on',  900002, true);

    insert into gallery (image_path, original_path, sort, active, album_id)
    select probe_mark || 'off.webp', probe_mark || 'off.orig', 900001, true, a.id
      from gallery_albums a where a.slug = 'zz-0015-selfcheck-off';
    insert into gallery (image_path, original_path, sort, active, album_id)
    select probe_mark || 'on.webp', probe_mark || 'on.orig', 900002, true, a.id
      from gallery_albums a where a.slug = 'zz-0015-selfcheck-on';

    delete from gallery_albums where slug in ('zz-0015-selfcheck-off', 'zz-0015-selfcheck-on');

    select g.active into off_active from gallery g where g.image_path = probe_mark || 'off.webp';
    select g.active into on_active  from gallery g where g.image_path = probe_mark || 'on.webp';
    select count(*), count(*) filter (where g.original_path is not null)
      into rows_left, paths_left
      from gallery g where g.image_path like probe_mark || '%';
    select count(*) into albums_left from gallery_albums a where a.slug like 'zz-0015-selfcheck-%';

    -- 일부러 터뜨려 위 insert·delete 를 전부 되돌린다. 아래 exception 절이 이 문구만 삼킨다.
    raise exception '0015_probe_rollback';
  exception
    when raise_exception then
      if sqlerrm <> '0015_probe_rollback' then
        raise;
      end if;
  end;

  -- 판정 순서는 거친 것부터다. 삭제 자체가 막혔거나 사진 행이 사라진 상태에서 active 를 먼저 따지면
  -- "사진이 안 내려갔다"(실은 행이 없다) 같은 **틀린 진단**이 먼저 나온다.
  if albums_left <> 0 then
    raise exception '0015: 앨범 삭제가 막혔다 (남은 앨범 %건) — 트리거가 delete 를 되돌리고 있다', albums_left
      using hint = 'before 트리거가 null 을 돌려주면 그 행의 삭제가 취소된다. 함수는 모든 경로에서 old 를 돌려줘야 한다.';
  end if;

  if rows_left <> 2 or paths_left <> 2 then
    raise exception '0015: 앨범을 지웠더니 사진 행이 사라졌다 (남은 행 % · original_path 있는 행 %, 기대 2 · 2) — Storage 고아 파일이 생긴다', rows_left, paths_left
      using hint = 'FK 가 on delete set null 인지(0008:61) 확인할 것. cascade 로 바뀌었거나 트리거가 update 가 아니라 delete 를 하고 있다.';
  end if;

  if off_active is distinct from false then
    raise exception '0015: 비활성 앨범을 지웠는데 그 사진이 내려가지 않았다 (active=%) — 숨겨 둔 사진이 손님에게 공개된다', off_active
      using hint = 'null 이면 사진 행을 찾지 못한 것이다(자기검증 블록의 구조를 확인). true 면 트리거가 돌지 않았거나 when 절/본문 조건이 뒤집혔다.';
  end if;

  if on_active is distinct from true then
    raise exception '0015: 활성 앨범을 지웠는데 그 사진이 내려갔다 (active=%) — 보이던 사진이 사라진다. 반대 방향의 같은 잘못이다', on_active
      using hint = 'when 절 (not old.active) 와 본문의 `if old.active then return old; end if;` 를 확인할 것.';
  end if;
end
$$;

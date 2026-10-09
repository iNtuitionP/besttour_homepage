-- 0020_admin_content_writes.down.sql — supabase/migrations/0020_admin_content_writes.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005~0019 롤백 헤더와 같다). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0020
--
-- ## 이 롤백이 하는 일 (0020 의 정확한 역)
--   ① 콘텐츠 여섯 표에서 `authenticated` 에게 `insert`·`update`·`delete` 를 **다시 부여**한다.
--   ② `*_admin_select` 정책을 지우고 0009 의 `*_admin_all`(`for all … using (is_admin()) with check (is_admin())`)을 되살린다.
--   ③ definer 함수 18개를 **지운다**(인자 타입까지 적어 오버로드를 남기지 않는다 — 0010 롤백과 같은 규약).
-- 표·컬럼·시퀀스의 다른 권한, 공개 정책(`*_select_active`), 데이터는 한 글자도 건드리지 않는다.
--
-- ## 🔴 되돌리면 **D10 이 다시 열린다** — 그것이 이 롤백의 전부다
-- PostgreSQL 은 `ACCESS EXCLUSIVE` 잠금을 **MAINTAIN·UPDATE·DELETE·TRUNCATE 중 하나**로 허용한다
-- (`src/backend/commands/lockcmds.c` `LockTableAclCheck`). ① 이 `UPDATE`·`DELETE` 를 되돌려 주는 순간,
-- **로그인만 한 사용자(관리자 명단에 없어도)** 가 `lock table notices in access exclusive mode` 로
-- 공개 화면과 관리자 화면을 동시에 멈출 수 있다. **RLS 는 이것을 막지 못한다** — 잠금은 행을 보지 않는다.
-- 0020 적용 직전 로컬 실측에서 여섯 표 전부 실제로 잡혔다(P5-16 보고서 ⑥).
-- 오늘 PostgREST 로 `LOCK` 에 닿을 경로는 없다. 그러나 "경로가 없으니 괜찮다" 는 TRIGGER 에서 이미 한 번 틀렸다(0017).
--
-- ## 승인 플래그를 **조건 없이** 요구한다 — 판단과 근거
-- 0015~0019 롤백이 세운 기준 그대로다: **"실행이 안전한가" 가 아니라 "실행한 뒤의 세계가 조용히 위험한가".**
-- 이 롤백은 실행 자체는 안전하다(데이터가 사라지지 않고, 잘못 눌러도 0020 을 다시 적용하면 된다).
-- 그런데 되돌려 놓는 세계는 **오류도 로그도 화면 변화도 없이** D10 이 열린 상태다 — 아무도 눈치채지 못한다.
-- 행이 0이어도 멈춘다: 권한은 열린 채 남고 콘텐츠는 나중에 들어온다.
--
-- ## ⚠️ 코드 배포와의 순서 — 이 롤백만 돌리면 관리자 화면이 **두 가지 방식으로** 고장난다
-- 0020 뒤의 앱(lib/admin/*.ts)은 `.rpc('admin_…')` 로 쓴다. ③ 이 함수를 지우면 그 호출이 **PGRST202(함수 없음)** 가 된다.
-- 그러므로 이 롤백은 **앱을 0020 이전 코드로 되돌리는 것과 짝**이다. 둘 중 하나만 하면:
--   · 롤백만 → 저장 버튼이 전부 실패(PGRST202)
--   · 코드만 되돌림 → 저장 버튼이 전부 실패(42501 — 표 권한이 없다)
-- 순서: **코드 롤백 → 이 파일** (0020 적용은 그 반대: 이 마이그레이션 → 코드 배포).
--
-- ⚠️ **관리자 화면이 죽어서 여기까지 왔다면 원인이 0020 이 아닐 수 있다.** 먼저 볼 것:
--   `select to_regprocedure('public.admin_update_notice(integer,text,text,text,date,boolean)');`  → null 이면 0020 이 적용되지 않았다
--   `select has_function_privilege('authenticated', 'public.admin_update_notice(integer,text,text,text,date,boolean)', 'execute');`
--   그리고 앱 배포본이 0020 이후 코드인지(=`.rpc('admin_update_notice'` 를 부르는지).
--
--   set bestour.rollback_0020_ack = '1';
--   \i supabase/rollbacks/0020_admin_content_writes.down.sql
--
-- 재실행 가능(idempotent): `grant` 는 이미 있는 권한을 다시 줘도 오류가 아니고, 정책은 drop 뒤 create 하며
-- (**되살리는 `*_admin_all` 도 먼저 drop 한다** — P5-16 인계 실측: 처음 판은 `_admin_select` 만 지우고 `_admin_all` 을 만들어
--  두 번째 실행이 `policy "notices_admin_all" … already exists` 로 멈췄다. 머리 주석의 "재실행 가능" 이 거짓이었다),
-- 함수는 `drop … if exists` 다. 표·함수가 없으면 to_regclass·to_regproc 로 건너뛴다.

begin;

-- 잠금 대기 상한 (GPT astra P2, P5-16). 아래 §1 의 `drop policy`·`create policy` 는 표에 강한 잠금을 요구한다.
-- 긴 트랜잭션 뒤에서 그 잠금을 기다리면, 뒤따르는 읽기·쓰기가 **이 롤백 뒤에 줄을 선다** — 공개 화면이 멈춘다.
-- 5초 넘게 기다리면 `55P03 lock timeout` 으로 이 파일 전체가 롤백된다(아무것도 바뀌지 않는다). 막던 세션이 끝난 뒤 다시 돌린다.
-- 0012~0020 상행의 첫 실행문과 같은 값이다. 설정일 뿐 변경이 아니므로 승인 플래그 확인보다 앞에 둬도 된다.
set local lock_timeout = '5s';

-- =========================================================================
-- 0. 안전장치 — 조건 없음. 승인 플래그가 없으면 언제나 멈춘다 (근거는 헤더)
-- =========================================================================
do $$
begin
  if coalesce(current_setting('bestour.rollback_0020_ack', true), '') <> '1' then
    raise exception '0020 롤백 중단: 콘텐츠 여섯 표에 authenticated 의 insert·update·delete 를 다시 열려 한다 — 로그인만 한 사용자(관리자가 아니어도)가 LOCK TABLE … ACCESS EXCLUSIVE 로 공개 화면과 관리자 화면을 멈출 수 있고(known-defects D10), RLS 는 그것을 막지 못한다'
      using hint = '되돌릴 이유를 확인했으면 같은 세션에서 `set bestour.rollback_0020_ack = ''1'';` 을 실행한 뒤 다시 돌린다. 그리고 이 롤백은 앱 코드 롤백과 짝이다 — 먼저 0020 이전 코드를 배포할 것(그러지 않으면 관리자 저장이 PGRST202 로 전부 실패한다).';
  end if;
end
$$;

-- =========================================================================
-- 1. 0009 상태 복원 — 정책 + 표 권한. is_admin() 과 표가 살아 있을 때만.
--    표 이름을 한 줄씩 적는다(루프로 줄이지 않는다) — 이 파일만 읽고 "무엇이 어디로 돌아가는지" 알 수 있어야 하고,
--    tests/write-privileges.test.ts 가 상·하행의 (롤|표|권한) 삼중항 집합을 **텍스트에서** 대조한다.
-- =========================================================================
do $$
begin
  if to_regproc('public.is_admin') is null then
    raise notice '0020 롤백: is_admin() 이 없다(0009 가 이미 롤백됨) — 정책 복원을 건너뛴다.';
  else
    if to_regclass('public.notices') is not null then
      execute 'drop policy if exists notices_admin_select on notices';
      execute 'drop policy if exists notices_admin_all on notices';
      execute 'create policy notices_admin_all on notices for all to authenticated using (is_admin()) with check (is_admin())';
    else raise notice '0020 롤백: notices 가 없다 — 건너뛴다.'; end if;

    if to_regclass('public.popups') is not null then
      execute 'drop policy if exists popups_admin_select on popups';
      execute 'drop policy if exists popups_admin_all on popups';
      execute 'create policy popups_admin_all on popups for all to authenticated using (is_admin()) with check (is_admin())';
    else raise notice '0020 롤백: popups 가 없다 — 건너뛴다.'; end if;

    if to_regclass('public.gallery') is not null then
      execute 'drop policy if exists gallery_admin_select on gallery';
      execute 'drop policy if exists gallery_admin_all on gallery';
      execute 'create policy gallery_admin_all on gallery for all to authenticated using (is_admin()) with check (is_admin())';
    else raise notice '0020 롤백: gallery 가 없다 — 건너뛴다.'; end if;

    if to_regclass('public.gallery_albums') is not null then
      execute 'drop policy if exists gallery_albums_admin_select on gallery_albums';
      execute 'drop policy if exists gallery_albums_admin_all on gallery_albums';
      execute 'create policy gallery_albums_admin_all on gallery_albums for all to authenticated using (is_admin()) with check (is_admin())';
    else raise notice '0020 롤백: gallery_albums 가 없다 — 건너뛴다.'; end if;

    if to_regclass('public.showcase_routes') is not null then
      execute 'drop policy if exists showcase_routes_admin_select on showcase_routes';
      execute 'drop policy if exists showcase_routes_admin_all on showcase_routes';
      execute 'create policy showcase_routes_admin_all on showcase_routes for all to authenticated using (is_admin()) with check (is_admin())';
    else raise notice '0020 롤백: showcase_routes 가 없다 — 건너뛴다.'; end if;

    if to_regclass('public.vehicles') is not null then
      execute 'drop policy if exists vehicles_admin_select on vehicles';
      execute 'drop policy if exists vehicles_admin_all on vehicles';
      execute 'create policy vehicles_admin_all on vehicles for all to authenticated using (is_admin()) with check (is_admin())';
    else raise notice '0020 롤백: vehicles 가 없다 — 건너뛴다.'; end if;
  end if;

  if to_regclass('public.notices') is not null then
    execute 'grant insert, update, delete on table notices to authenticated';
  end if;
  if to_regclass('public.popups') is not null then
    execute 'grant insert, update, delete on table popups to authenticated';
  end if;
  if to_regclass('public.gallery') is not null then
    execute 'grant insert, update, delete on table gallery to authenticated';
  end if;
  if to_regclass('public.gallery_albums') is not null then
    execute 'grant insert, update, delete on table gallery_albums to authenticated';
  end if;
  if to_regclass('public.showcase_routes') is not null then
    execute 'grant insert, update, delete on table showcase_routes to authenticated';
  end if;
  if to_regclass('public.vehicles') is not null then
    execute 'grant insert, update, delete on table vehicles to authenticated';
  end if;
end
$$;

-- =========================================================================
-- 2. definer 함수 18개 — 인자 타입까지 적어 오버로드를 남기지 않는다 (0010 롤백과 같은 규약)
-- =========================================================================
drop function if exists admin_create_notice(text, text, text, date, boolean);
drop function if exists admin_update_notice(integer, text, text, text, date, boolean);
drop function if exists admin_delete_notice(integer);
drop function if exists admin_set_notice_active(integer, boolean);
drop function if exists admin_create_popup(text, text, text, date, date, boolean);
drop function if exists admin_update_popup(integer, text, text, text, date, date, boolean);
drop function if exists admin_delete_popup(integer);
drop function if exists admin_set_popup_active(integer, boolean);
drop function if exists admin_create_gallery_photo(text, text, integer, integer, integer, integer, text, integer, boolean);
drop function if exists admin_update_gallery_photo(integer, text, integer, integer);
drop function if exists admin_set_gallery_photo_active(integer, boolean);
drop function if exists admin_delete_gallery_photo(integer);
drop function if exists admin_create_album(text, text, integer, boolean);
drop function if exists admin_update_album(integer, text, text, integer, boolean);
drop function if exists admin_set_album_active(integer, boolean);
drop function if exists admin_delete_album(integer);
drop function if exists admin_update_route(integer, text, text, integer, integer, boolean);
drop function if exists admin_set_route_active(integer, boolean);

-- =========================================================================
-- 3. 복원 확인 — 되돌렸다면 여섯 표 × 세 동작이 전부 살아 있고, 새 함수는 하나도 남지 않았다.
--    (D10 이 다시 열렸다는 사실을 notice 로 남긴다 — 조용히 끝나지 않게.)
-- =========================================================================
do $$
declare
  tbls constant text[] := array['notices', 'popups', 'gallery', 'gallery_albums', 'showcase_routes', 'vehicles'];
  miss text;
  left_over text;
begin
  select string_agg(format('%s/%s', t, p.priv), ', ' order by t, p.priv)
    into miss
    from unnest(tbls) t
    cross join (values ('insert'), ('update'), ('delete')) p(priv)
   where to_regclass('public.' || t) is not null and not has_table_privilege('authenticated', 'public.' || t, p.priv);
  if miss is not null then
    raise exception '0020 롤백: 되돌리지 못한 권한이 있다 — %', miss
      using hint = '표가 없거나 grant 가 실패했다. 이 상태에서는 0020 이전 코드의 관리자 화면이 42501 로 저장에 실패한다.';
  end if;

  select string_agg(s.sig, ', ' order by s.sig) into left_over from unnest(array[
    'public.admin_create_notice(text,text,text,date,boolean)',
    'public.admin_update_notice(integer,text,text,text,date,boolean)',
    'public.admin_delete_notice(integer)',
    'public.admin_set_notice_active(integer,boolean)',
    'public.admin_create_popup(text,text,text,date,date,boolean)',
    'public.admin_update_popup(integer,text,text,text,date,date,boolean)',
    'public.admin_delete_popup(integer)',
    'public.admin_set_popup_active(integer,boolean)',
    'public.admin_create_gallery_photo(text,text,integer,integer,integer,integer,text,integer,boolean)',
    'public.admin_update_gallery_photo(integer,text,integer,integer)',
    'public.admin_set_gallery_photo_active(integer,boolean)',
    'public.admin_delete_gallery_photo(integer)',
    'public.admin_create_album(text,text,integer,boolean)',
    'public.admin_update_album(integer,text,text,integer,boolean)',
    'public.admin_set_album_active(integer,boolean)',
    'public.admin_delete_album(integer)',
    'public.admin_update_route(integer,text,text,integer,integer,boolean)',
    'public.admin_set_route_active(integer,boolean)'
  ]) s(sig) where to_regprocedure(s.sig) is not null;
  if left_over is not null then
    raise exception '0020 롤백: 지우지 못한 함수가 있다 — %', left_over;
  end if;

  raise notice '0020 롤백 완료 — 콘텐츠 여섯 표의 authenticated insert·update·delete 를 되돌렸다. 🔴 known-defects D10 이 다시 열려 있다: 로그인한 사용자가 그 여섯 표를 ACCESS EXCLUSIVE 로 잠글 수 있다.';
end
$$;

commit;

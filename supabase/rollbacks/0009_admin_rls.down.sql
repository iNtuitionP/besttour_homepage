-- 0009_admin_rls.down.sql — supabase/migrations/0009_admin_rls.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005·0007·0008 롤백 헤더 참조). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0009
--
-- 이 롤백이 하는 일: 0009 가 **더한 것만** 되돌린다. 관리자 문을 닫는 방향이라 데이터 손실은 명단(admin_users)뿐이고,
-- 그 명단이 비어 있지 않으면 아래 가드가 먼저 멈춰 세운다 — 누가 관리자였는지는 되돌릴 곳이 없다(auth.users 는 남지만
-- 명단이 사라지면 어느 사용자가 관리자였는지 알 수 없다). 사람이 내보내거나 버릴지 판단한 뒤 가드를 통과시켜야 한다.
--
-- 공개 정책(`*_select_active`)은 0009 가 건드리지 않았으므로 여기서도 손대지 않는다. 되살릴 것이 없다.
--
-- 재실행 가능(idempotent): 한 번 성공한 뒤 다시 돌려도 죽지 않는다. 가드가 보는 표가 이미 없으면 그 검사를 건너뛴다
-- (to_regclass) — 0008 롤백과 같은 성질이며, 이 롤백이 자기가 보는 대상을 지우기 때문에 필요하다.
--
-- 순서가 중요하다: 정책 → 함수 → 표. 정책이 is_admin() 에 의존하므로 함수를 먼저 지우면 의존성 오류로 실패한다.

begin;

-- =========================================================================
-- 0. 안전장치 — 잃을 명단이 있으면 멈춘다 (0003·0006·0008 롤백과 같은 규약)
-- =========================================================================
do $$
declare
  admins bigint;
begin
  if to_regclass('public.admin_users') is null then
    raise notice '0009 롤백: admin_users 가 이미 없다 — 명단 가드를 건너뛴다(재실행).';
  else
    select count(*) into admins from admin_users;
    if admins > 0 then
      raise exception '0009 롤백 중단: admin_users 에 행 % 건 — 관리자 명단이 사라진다. 사람이 판단할 것', admins
        using hint = '명단을 먼저 내보낸 뒤(select user_id, email, note from admin_users) 행을 비우고 다시 실행한다. 여기서 자동으로 지우지 않는다.';
    end if;
  end if;
end
$$;

-- =========================================================================
-- 1. 0009 가 추가한 정책만 — 공개 정책은 이름조차 나오지 않는다
-- =========================================================================
drop policy if exists reservations_admin_select on reservations;
drop policy if exists reservations_admin_update on reservations;
drop policy if exists notifications_log_admin_select on notifications_log;
drop policy if exists notices_admin_all on notices;
drop policy if exists popups_admin_all on popups;
drop policy if exists gallery_admin_all on gallery;
drop policy if exists showcase_routes_admin_all on showcase_routes;
drop policy if exists vehicles_admin_all on vehicles;

-- gallery_albums 는 0008 이 만든 표다. 0008 롤백이 먼저 돌아 표가 사라진 상태일 수 있으므로 존재를 확인하고 부른다
-- (`drop policy … on <없는 표>` 는 if exists 로도 막히지 않는다 — 0008 롤백 §1 과 같은 처리).
do $$
begin
  if to_regclass('public.gallery_albums') is not null then
    execute 'drop policy if exists gallery_albums_admin_all on gallery_albums';
  end if;
end
$$;

-- =========================================================================
-- 2. 표 권한 — 0009 가 준 것만 회수한다
--    Supabase 기본권한(anon·authenticated 에 광범위 GRANT + RLS 로 통제)보다 좁아질 수 있다. 닫히는 방향이라
--    안전하고, 공개 사이트는 anon 역할로 읽으므로 영향이 없다.
-- =========================================================================
revoke select, update on table reservations from authenticated;
revoke select on table notifications_log from authenticated;
revoke select, insert, update, delete on table notices, popups, gallery, showcase_routes, vehicles from authenticated;
revoke usage, select on sequence
  notices_id_seq, popups_id_seq, gallery_id_seq, showcase_routes_id_seq, vehicles_id_seq
  from authenticated;

do $$
begin
  if to_regclass('public.gallery_albums') is not null then
    -- 0008 이 anon·authenticated 에 준 select 는 남긴다 — 그것은 0009 것이 아니다.
    execute 'revoke insert, update, delete on table gallery_albums from authenticated';
    execute 'revoke usage, select on sequence gallery_albums_id_seq from authenticated';
  end if;
end
$$;

-- =========================================================================
-- 3. 함수 — 위에서 정책을 전부 지운 뒤에만 여기 도달한다
-- =========================================================================
drop function if exists is_admin();

-- =========================================================================
-- 4. 명단 표 — 위 가드로 0행임이 확인된 상태에서만 여기 도달한다
--
--    0009 의 `revoke all on table admin_users from anon, authenticated`(독립 리뷰 M1)는 여기서 되돌리지 않는다.
--    표가 사라지면 그 표에 붙은 권한도 함께 사라지고, 애초에 이 표는 0009 가 만든 것이라 "복원할 이전 상태"가 없다.
--    **다시 GRANT 하지 않는다** — 롤백이 명단 표를 열어 주는 일이 있어서는 안 된다(tests/admin-auth.test.ts 가 단언).
-- =========================================================================
drop table if exists admin_users;

commit;

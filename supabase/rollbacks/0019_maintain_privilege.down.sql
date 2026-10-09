-- 0019_maintain_privilege.down.sql — supabase/migrations/0019_maintain_privilege.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005~0018 롤백 헤더와 같다). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0019
--
-- ## 🔴 이 롤백은 "이전 ACL" 이 아니라 **"Supabase 기본 기준선"** 으로 복원한다 (0018 롤백과 같은 방식)
-- 0019 는 적용 전 ACL 을 어디에도 기록하지 않는다. 이 롤백은 그때 무엇이 있었는지 모르는 채 **고정 목록을 부여**한다.
-- 그 목록은 **이 DB 의 기본 권한이 만든 상태**다: `pg_default_acl`(부여자 postgres)이 새 표에 `anon`·`authenticated` 전권
-- (`arwdDxtm` — 마지막 `m` 이 MAINTAIN)을 주고(CLAUDE.md §3), 0001~0018 중 공개 롤의 MAINTAIN 을 건드린 것은
-- 0009 의 `admin_users` `revoke all` 하나뿐이다. 따라서 **마이그레이션만으로 만들어진 PostgreSQL 17 DB 에서는
-- 기준선 = 0019 직전 상태**다: 아홉 표 × 두 공개 롤 MAINTAIN 있음, `admin_users` 없음(로컬 실측으로 일치 확인).
-- **어긋나는 경우**
--   · 누가 대시보드·SQL Editor 로 MAINTAIN 을 미리 좁혀 뒀다면, 이 롤백은 0019 가 지운 적 없는 권한까지 **새로 연다.**
--   · 원격이 **16 이하에서 17 로 업그레이드**된 DB 라면 기존 표의 relacl 에 `m` 이 **애초에 없을 수 있다**(업그레이드는 옛 ACL 을
--     그대로 옮긴다). 그 경우 0019 는 아무것도 지우지 않았고, 이 롤백은 **없던 권한을 새로 준다.**
-- 그래서 원격 적용 **직전** 공개 표의 `relacl` 스냅샷을 docs/ops/migration-runbook.md 0019 절에 남기는 것을 적용 절차로 둔다
-- (0018 스냅샷 질의가 이제 MAINTAIN 을 포함한다). 롤백 전에 그 스냅샷과 이 목록을 대조하고, 다르면 **이 파일을 스냅샷에 맞게 고친 뒤** 실행한다.
--
-- 이 롤백이 하는 일(0019 가 회수한 것의 역 = 기본 기준선):
--   아홉 표(notices·popups·gallery·gallery_albums·showcase_routes·vehicles·places·reservations·notifications_log)에서
--   `anon`·`authenticated` 에게 MAINTAIN 을 되돌려 준다. `admin_users` 에는 주지 않는다(0009 가 revoke all — 기준선에 없다).
-- 표 이름을 **고정 목록으로** 적는다 — 상행은 적용 시점의 표를 전부 열거했지만, 롤백이 그렇게 하면 0019 **뒤에** 생긴 표에도
-- MAINTAIN 을 연다(그 표의 기준선은 그 표를 만든 마이그레이션이 정한다). 상행 적용 시점의 표는 이 아홉 + admin_users 였다.
-- 표·함수·정책·데이터·다른 권한은 한 글자도 건드리지 않는다.
--
-- ## 🔴 버전 조건부 — 상행과 같다
-- 16 이하에서는 `grant maintain` 이 문법 오류다. 0019 도 16 이하에서는 아무것도 하지 않았으므로 되돌릴 것이 없다 —
-- `server_version_num < 170000` 이면 notice 만 남기고 끝난다. 버전 판정과 서버 능력(`acldefault('r', …)` 에 MAINTAIN)이
-- 어긋나면 멈춘다(상행 ⑤ 와 같은 이유).
--
-- ## 승인 플래그를 **조건 없이** 요구한다 — 판단과 근거
-- 0015~0018 롤백이 세운 기준을 그대로 쓴다: **"실행이 안전한가" 가 아니라 "실행한 뒤의 세계가 조용히 위험한가".**
-- 이 롤백은 실행 자체는 안전하다 — 데이터가 사라지지 않고, 잘못 눌러도 0019 를 다시 적용하면 된다.
-- 그런데 되돌려 놓는 세계는 이렇다:
--   · **`anon` 이 `LOCK TABLE reservations IN ACCESS EXCLUSIVE MODE` 를 할 수 있다.** 잠금을 쥐고 있는 동안 **예약 접수가 전부 멈춘다.**
--     RLS 는 이것을 보지 않는다. 적용 전 로컬에서 anon 으로 실제로 잡혔다(P5-15 보고서 ⑥). `ANALYZE`·`VACUUM` 도 열린다.
--   · 오늘 PostgREST 로 이 문장들에 닿을 경로는 없다. 그러나 "경로가 없으니 괜찮다" 는 TRIGGER 에서 이미 한 번 틀렸다(0017).
-- 그리고 **되돌린 것을 필요로 하는 정상 경로가 하나도 없다.** 관리자 화면은 MAINTAIN 을 쓰지 않고(P5-15 실행 증명),
-- 접수·통지·파기는 서비스 롤이며 0019 는 서비스 롤을 건드리지 않았다. 즉 이 롤백이 **조용히 도는 것이 옳은 상황은 존재하지 않는다.**
-- 16 이하에서도 플래그를 먼저 요구한다 — 거기서는 롤백이 아무것도 하지 않지만, 플래그 검사를 버전 뒤로 미루면
-- "어느 서버에서 무엇이 필요한가" 를 사람이 따로 기억해야 한다. 한 가지 규칙이 낫다.
--
-- ⚠️ **관리자 화면이 죽어서 여기까지 왔다면 원인은 0019 가 아닐 가능성이 높다** — 관리자 CRUD 는 insert·update·delete·select 만 쓴다.
-- 먼저 `has_table_privilege('authenticated', 'public.notices', 'UPDATE')`·`has_sequence_privilege('authenticated', 'public.notices_id_seq', 'USAGE')` 를 볼 것.
--
--   set bestour.rollback_0019_ack = '1';
--   \i supabase/rollbacks/0019_maintain_privilege.down.sql
--
-- 재실행 가능(idempotent): `grant` 는 이미 있는 권한을 다시 줘도 오류가 아니고, 표가 없으면 to_regclass 로 건너뛴다.

begin;

-- =========================================================================
-- 0. 안전장치 — 조건 없음. 승인 플래그가 없으면 언제나 멈춘다 (근거는 헤더)
-- =========================================================================
do $$
begin
  if coalesce(current_setting('bestour.rollback_0019_ack', true), '') <> '1' then
    raise exception '0019 롤백 중단: 공개 롤에 MAINTAIN 을 다시 열려 한다 — anon 이 LOCK TABLE reservations IN ACCESS EXCLUSIVE MODE 로 예약 접수를 멈출 수 있고, RLS 는 그것을 막지 못한다. 이 롤백은 적용 전 ACL 이 아니라 Supabase 기본 기준선(아홉 표 × anon·authenticated MAINTAIN)으로 복원한다'
      using hint = '롤백 전에 docs/ops/migration-runbook.md 0019 절의 적용 직전 relacl 스냅샷과 이 파일의 부여 목록을 대조할 것 — 적용 전에 이미 m 이 없던 표(업그레이드된 DB·수동으로 좁힌 표)가 있으면 이 롤백은 그것까지 새로 연다(그때는 파일을 스냅샷에 맞게 고친다). 되돌릴 이유를 확인했으면 같은 세션에서 `set bestour.rollback_0019_ack = ''1'';` 을 실행한 뒤 다시 돌린다. 되돌린 것을 필요로 하는 정상 경로는 하나도 없다 — 관리자 화면은 MAINTAIN 을 쓰지 않는다.';
  end if;
end
$$;

-- =========================================================================
-- 1. MAINTAIN 복원 — 17 이상에서만, 있는 표에만
--    표 이름을 한 줄씩 적는다(루프로 줄이지 않는다) — 이 파일만 읽고 "무엇이 어디로 돌아가는지" 알 수 있어야 하고,
--    tests/write-privileges.test.ts §17 이 **텍스트에서 직접** 아홉 표 × 두 롤을 집합으로 대조한다.
-- =========================================================================
do $$
declare
  v_ver             constant int     := current_setting('server_version_num')::int;
  v_knows_maintain  constant boolean := exists (select 1 from aclexplode(acldefault('r', to_regrole(current_user))) d where d.privilege_type = 'MAINTAIN');
  v_applies         constant boolean := v_ver >= 170000;
begin
  if v_applies is distinct from v_knows_maintain then
    raise exception '0019 롤백: 버전 분기와 서버 능력이 어긋난다 — server_version_num=% (17 이상 판정=%) · MAINTAIN 을 안다=%', v_ver, v_applies, v_knows_maintain
      using hint = '상행 0019 ⑤ 와 같은 검사다. 서버를 확인한 뒤 분기를 고칠 것.';
  end if;
  if not v_applies then
    raise notice '0019 롤백: PostgreSQL % — MAINTAIN 이 없는 버전이다. 0019 도 아무것도 하지 않았으므로 되돌릴 것이 없다.', current_setting('server_version');
    return;
  end if;

  if to_regclass('public.notices') is not null then
    execute 'grant maintain on table notices to anon, authenticated';
  else raise notice '0019 롤백: notices 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.popups') is not null then
    execute 'grant maintain on table popups to anon, authenticated';
  else raise notice '0019 롤백: popups 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.gallery') is not null then
    execute 'grant maintain on table gallery to anon, authenticated';
  else raise notice '0019 롤백: gallery 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.gallery_albums') is not null then
    execute 'grant maintain on table gallery_albums to anon, authenticated';
  else raise notice '0019 롤백: gallery_albums 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.showcase_routes') is not null then
    execute 'grant maintain on table showcase_routes to anon, authenticated';
  else raise notice '0019 롤백: showcase_routes 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.vehicles') is not null then
    execute 'grant maintain on table vehicles to anon, authenticated';
  else raise notice '0019 롤백: vehicles 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.places') is not null then
    execute 'grant maintain on table places to anon, authenticated';
  else raise notice '0019 롤백: places 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.reservations') is not null then
    execute 'grant maintain on table reservations to anon, authenticated';
  else raise notice '0019 롤백: reservations 가 없다 — 건너뛴다.'; end if;

  if to_regclass('public.notifications_log') is not null then
    execute 'grant maintain on table notifications_log to anon, authenticated';
  else raise notice '0019 롤백: notifications_log 가 없다 — 건너뛴다.'; end if;
end
$$;

-- =========================================================================
-- 2. 검증 — 17 이상에서만. 롤백이 반쯤 돌거나, 기준선보다 넓은 문을 열거나, 서비스 롤을 건드린 채 끝나지 않게 한다
--    ① 되돌렸어야 할 권한이 실제로 돌아왔는가(표가 있는 경우에만)
--    ② 기준선보다 넓은 문을 열지 않았는가 — PUBLIC 직접 부여 0 · admin_users 는 여전히 공개 롤 MAINTAIN 없음
--    ③ service_role 의 MAINTAIN 은 그대로인가 — **경고만**(업그레이드 DB 에서는 원래 없을 수 있다 · astra P2-6)
-- =========================================================================
do $$
declare
  nine   constant text[] := array['public.notices', 'public.popups', 'public.gallery', 'public.gallery_albums',
                                  'public.showcase_routes', 'public.vehicles', 'public.places',
                                  'public.reservations', 'public.notifications_log'];
  missed text;
  extra  text;
begin
  if current_setting('server_version_num')::int < 170000 then
    return;
  end if;

  -- ①
  select string_agg(format('%s → %s', r.role, t.tbl), ', ' order by t.tbl, r.role)
    into missed
    from unnest(nine) as t(tbl)
    cross join (values ('anon'), ('authenticated')) as r(role)
   where to_regclass(t.tbl) is not null
     and not has_table_privilege(r.role, t.tbl, 'MAINTAIN');
  if missed is not null then
    raise exception '0019 롤백: 되돌리지 못한 권한이 있다 — %', missed
      using hint = '§1 의 부여 문장 중 일부가 실행되지 않았다. 표 이름·롤 이름을 확인할 것.';
  end if;

  -- ② PUBLIC 직접 부여 · admin_users
  select string_agg(c.relname, ', ')
    into extra
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.grantee = 0 and a.privilege_type = 'MAINTAIN';
  if extra is not null then
    raise exception '0019 롤백: PUBLIC 에 MAINTAIN 이 생겼다 — % (롤백이 기준선보다 넓은 문을 열었다)', extra
      using hint = '0019 는 anon·authenticated 에서만 회수했다. 되돌리는 대상도 그 둘뿐이어야 한다.';
  end if;
  if to_regclass('public.admin_users') is not null
     and (has_table_privilege('anon', 'public.admin_users', 'MAINTAIN')
          or has_table_privilege('authenticated', 'public.admin_users', 'MAINTAIN')) then
    raise exception '0019 롤백: admin_users 에 공개 롤 MAINTAIN 이 있다 — 기준선보다 넓다'
      using hint = '0009 가 admin_users 에서 공개 롤 권한을 전부 회수했다. 이 롤백은 그 표에 부여하지 않는다 — 다른 경로를 확인할 것.';
  end if;

  -- ③ 서비스 롤 — **경고만 한다**(astra P2-6). 이 롤백은 부여만 하므로 service_role 의 MAINTAIN 을 없앨 수 없다.
  --    그리고 16→17 업그레이드 DB 는 기존 표 ACL 에 m 이 **원래 없을 수 있다**(업그레이드는 옛 ACL 을 옮긴다).
  --    0019 상행 ② 가 "true" 가 아니라 "적용 전과 불변" 을 보는 것과 같은 이유로, 여기서 멈추면 정상인 롤백이 거짓 실패한다.
  --    판단 기준은 runbook 0019 절의 **적용 직전 relacl 스냅샷**이다 — 스냅샷에 service_role 의 m 이 있었는데 지금 없다면 다른 원인을 찾을 것.
  select string_agg(t.tbl, ', ')
    into missed
    from unnest(nine || array['public.admin_users']) as t(tbl)
   where to_regclass(t.tbl) is not null
     and not has_table_privilege('service_role', t.tbl, 'MAINTAIN');
  if missed is not null then
    raise warning '0019 롤백: service_role 의 MAINTAIN 이 없는 표가 있다 — % (이 롤백의 결과가 아니다 · 적용 직전 스냅샷과 대조할 것)', missed;
  end if;
end
$$;

commit;

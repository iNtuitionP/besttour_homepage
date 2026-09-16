-- 0018_sequence_privileges.down.sql — supabase/migrations/0018_sequence_privileges.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005~0017 롤백 헤더와 같다). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0018
--
-- ## 🔴 이 롤백은 "이전 ACL" 이 아니라 **"Supabase 기본 기준선"** 으로 복원한다 (GPT 검증 P2)
-- 0018 은 적용 전 ACL 을 어디에도 기록하지 않는다. 이 롤백은 그때 무엇이 있었는지 모르는 채 **고정 목록을 부여**한다.
-- 그 목록은 **이 DB 의 기본 권한이 만든 상태**다: `pg_default_acl`(부여자 postgres)이 새 시퀀스에 `anon`·`authenticated` 전권을 주고
-- (CLAUDE.md §3 · 원격 실측 2026-09-16), 0001~0017 중 시퀀스 권한을 바꾼 것은 0009 §6 의 부여(usage·select → authenticated,
-- 기본값의 부분집합) 하나뿐이다. 따라서 **마이그레이션만으로 만들어진 DB 에서는 기준선 = 0018 직전 상태**다(로컬 실측으로 일치 확인).
-- **어긋나는 경우**: 누가 대시보드·SQL Editor 로 시퀀스 권한을 미리 좁혀 뒀다면, 이 롤백은 0018 이 지운 적 없는 권한까지 **새로 연다.**
-- 그래서 원격 적용 **직전** 일곱 시퀀스의 `relacl` 스냅샷을 docs/ops/migration-runbook.md 0018 절에 남기는 것을 적용 절차로 둔다.
-- 롤백 전에 그 스냅샷과 이 목록을 대조하고, 다르면 **이 파일을 스냅샷에 맞게 고친 뒤** 실행한다.
-- (0012~0017 롤백도 같은 방식 — 상행이 회수한 고정 목록을 조건 없이 부여 — 이다. 그 헤더의 "정확한 역" 은 같은 전제 위의 말이다.)
--
-- 이 롤백이 하는 일(0018 이 회수한 목록의 역 = 기본 기준선):
--   ① 일곱 시퀀스에서 `anon` 에게 usage·select·update 를 되돌려 준다
--   ② 일곱 시퀀스에서 `authenticated` 에게 select·update 를 되돌려 준다
--   ③ `notifications_log_id_seq` 에서 `authenticated` 에게 usage 를 되돌려 준다
-- 표·함수·정책·데이터·시퀀스 값은 한 글자도 건드리지 않는다.
-- 콘텐츠 여섯의 `authenticated` usage 는 **건드리지 않는다** — 0018 이 회수하지 않았다(0009 §6 이 준 그대로다).
--
-- ## 승인 플래그를 **조건 없이** 요구한다 — 판단과 근거
-- 0015·0016·0017 롤백이 세운 기준을 그대로 쓴다: **"실행이 안전한가" 가 아니라 "실행한 뒤의 세계가 조용히 위험한가".**
-- 이 롤백은 실행 자체는 안전하다 — 데이터가 사라지지 않고, 잘못 눌러도 0018 을 다시 적용하면 된다.
-- 그런데 되돌려 놓는 세계는 이렇다:
--   · **`anon`·`authenticated` 가 `notifications_log_id_seq` 의 UPDATE 를 되찾는다 → `setval()` 로 되감을 수 있다.**
--     되감기는 순간부터 통지 적재가 **기본키 중복으로 전부 실패**한다. 예약 접수는 정상으로 끝나고 화면에도 오류가 없는데,
--     사장님에게도 고객에게도 **문자가 한 통도 나가지 않는다.** 누가 언제 되감았는지 남는 흔적도 없다
--     (setval 은 행을 바꾸지 않아 감사 대상 표에 아무것도 적히지 않는다). 콘텐츠 시퀀스를 되감으면 관리자 저장이 같은 식으로 실패한다.
--   · 오늘 PostgREST 로 setval 을 부를 경로는 없다(P6-11 실측). 그러나 "경로가 없으니 괜찮다" 는 TRIGGER 에서 이미 한 번 틀렸다(0017).
-- 그리고 **되돌린 것을 필요로 하는 정상 경로가 하나도 없다.** 앱 코드는 시퀀스를 직접 부르지 않고(저장소 전수 0건),
-- 관리자 insert 가 쓰는 콘텐츠 여섯의 usage 는 0018 이 남겨 뒀으며, 통지 적재는 서비스 롤·소유자 권한으로 돈다.
-- 즉 이 롤백이 **조용히 도는 것이 옳은 상황은 존재하지 않는다** — 손이 미끄러져서는 안 된다.
-- 행 수·시퀀스 값은 조건에 넣지 않는다(0012 독립 리뷰 M2 와 같은 근거): 지금 통지가 적다는 것은 위험이 없다는 뜻이 아니다.
--
-- ⚠️ **관리자 화면이 "새 글 저장" 에서 죽어서 여기까지 왔다면 원인은 0018 이 아닐 가능성이 높다** —
-- 0018 은 콘텐츠 여섯의 authenticated usage 를 남긴다. 먼저 `has_sequence_privilege('authenticated', 'public.notices_id_seq', 'usage')`
-- 를 확인하고, false 면 이 롤백이 아니라 0009 §6 의 부여를 다시 실행할 것(이 롤백은 그 권한을 되돌리지 않는다 — 회수한 적이 없으므로).
--
--   set bestour.rollback_0018_ack = '1';
--   \i supabase/rollbacks/0018_sequence_privileges.down.sql
--
-- 재실행 가능(idempotent): `grant` 는 이미 있는 권한을 다시 줘도 오류가 아니고, 시퀀스가 없으면 to_regclass 로 건너뛴다.
-- **함수를 언급하지 않는다.** 0018 이 함수를 건드리지 않았으므로 롤백도 건드리지 않는다.

begin;

-- =========================================================================
-- 0. 안전장치 — 조건 없음. 승인 플래그가 없으면 언제나 멈춘다 (근거는 헤더)
-- =========================================================================
do $$
begin
  if coalesce(current_setting('bestour.rollback_0018_ack', true), '') <> '1' then
    raise exception '0018 롤백 중단: 공개 롤에 시퀀스 UPDATE(setval) 를 다시 열려 한다 — notifications_log_id_seq 를 되감으면 접수는 정상인데 통지 적재가 기본키 중복으로 전부 실패하고, 오류도 로그도 화면 변화도 없다. 이 롤백은 적용 전 ACL 이 아니라 Supabase 기본 기준선(anon·authenticated 전권)으로 복원한다'
      using hint = '롤백 전에 docs/ops/migration-runbook.md 0018 절의 적용 직전 relacl 스냅샷과 이 파일의 부여 목록을 대조할 것 — 적용 전에 이미 좁혀져 있던 권한이 있으면 이 롤백은 그것까지 새로 연다(그때는 파일을 스냅샷에 맞게 고친다). 되돌릴 이유를 확인했으면 같은 세션에서 `set bestour.rollback_0018_ack = ''1'';` 을 실행한 뒤 다시 돌린다. 되돌린 것을 필요로 하는 정상 경로는 하나도 없다 — 앱 코드는 시퀀스를 직접 부르지 않는다. 관리자 새 글 저장이 실패해서 왔다면 먼저 has_sequence_privilege(''authenticated'', ''public.notices_id_seq'', ''usage'') 를 볼 것 — 0018 은 그 권한을 회수하지 않았고 이 롤백도 되돌리지 않는다.';
  end if;
end
$$;

-- =========================================================================
-- 1. 시퀀스 권한 복원 — 있는 시퀀스에만
--    시퀀스 이름을 한 줄씩 적는다(루프 + format(%I) 로 줄이지 않는다) — 이 파일만 읽고 "무엇이 어디로 돌아가는지"
--    알 수 있어야 하고, 상행이 회수한 삼중항과 하행이 부여하는 삼중항을 tests/write-privileges.test.ts 가
--    **텍스트에서 직접** 집합으로 대조한다(0013·0016·0017 롤백과 같은 규약).
-- =========================================================================
do $$
begin
  if to_regclass('public.notices_id_seq') is not null then
    execute 'grant usage, select, update on sequence notices_id_seq to anon';
    execute 'grant select, update on sequence notices_id_seq to authenticated';
  else raise notice '0018 롤백: notices_id_seq 가 없다 — 건너뛴다(0001 롤백이 먼저 돌았다).'; end if;

  if to_regclass('public.popups_id_seq') is not null then
    execute 'grant usage, select, update on sequence popups_id_seq to anon';
    execute 'grant select, update on sequence popups_id_seq to authenticated';
  else raise notice '0018 롤백: popups_id_seq 가 없다 — 건너뛴다(0001 롤백이 먼저 돌았다).'; end if;

  if to_regclass('public.gallery_id_seq') is not null then
    execute 'grant usage, select, update on sequence gallery_id_seq to anon';
    execute 'grant select, update on sequence gallery_id_seq to authenticated';
  else raise notice '0018 롤백: gallery_id_seq 가 없다 — 건너뛴다(0001 롤백이 먼저 돌았다).'; end if;

  if to_regclass('public.gallery_albums_id_seq') is not null then
    execute 'grant usage, select, update on sequence gallery_albums_id_seq to anon';
    execute 'grant select, update on sequence gallery_albums_id_seq to authenticated';
  else raise notice '0018 롤백: gallery_albums_id_seq 가 없다 — 건너뛴다(0008 롤백이 먼저 돌았다).'; end if;

  if to_regclass('public.showcase_routes_id_seq') is not null then
    execute 'grant usage, select, update on sequence showcase_routes_id_seq to anon';
    execute 'grant select, update on sequence showcase_routes_id_seq to authenticated';
  else raise notice '0018 롤백: showcase_routes_id_seq 가 없다 — 건너뛴다(0001 롤백이 먼저 돌았다).'; end if;

  if to_regclass('public.vehicles_id_seq') is not null then
    execute 'grant usage, select, update on sequence vehicles_id_seq to anon';
    execute 'grant select, update on sequence vehicles_id_seq to authenticated';
  else raise notice '0018 롤백: vehicles_id_seq 가 없다 — 건너뛴다(0001 롤백이 먼저 돌았다).'; end if;

  if to_regclass('public.notifications_log_id_seq') is not null then
    execute 'grant usage, select, update on sequence notifications_log_id_seq to anon';
    execute 'grant select, update on sequence notifications_log_id_seq to authenticated';
    execute 'grant usage on sequence notifications_log_id_seq to authenticated';
  else raise notice '0018 롤백: notifications_log_id_seq 가 없다 — 건너뛴다(0001 롤백이 먼저 돌았다).'; end if;
end
$$;

-- =========================================================================
-- 2. 검증 — 롤백이 반쯤 돌거나, 상행보다 넓은 문을 열거나, 관리자 화면·통지 적재를 죽인 채 끝나지 않게 한다
--    ① 되돌렸어야 할 권한이 실제로 돌아왔는가(시퀀스가 있는 경우에만)
--    ② 상행보다 넓은 문을 열지 않았는가 — PUBLIC 직접 부여 0
--    ③ 콘텐츠 여섯의 authenticated usage 와 service_role·postgres 의 세 권한은 그대로인가
-- =========================================================================
do $$
declare
  seven  constant text[] := array['public.notices_id_seq', 'public.popups_id_seq', 'public.gallery_id_seq',
                                  'public.gallery_albums_id_seq', 'public.showcase_routes_id_seq',
                                  'public.vehicles_id_seq', 'public.notifications_log_id_seq'];
  missed text;
  extra  text;
begin
  -- ① 되돌렸어야 할 것
  select string_agg(format('%s → %s(%s)', r.role, s.seq, r.priv), ', ' order by r.role, s.seq, r.priv)
    into missed
    from unnest(seven) as s(seq)
    cross join (values ('anon', 'usage'), ('anon', 'select'), ('anon', 'update'),
                       ('authenticated', 'select'), ('authenticated', 'update')) as r(role, priv)
   where to_regclass(s.seq) is not null
     and not has_sequence_privilege(r.role, s.seq, r.priv);
  if missed is null
     and to_regclass('public.notifications_log_id_seq') is not null
     and not has_sequence_privilege('authenticated', 'public.notifications_log_id_seq', 'usage') then
    missed := 'authenticated → public.notifications_log_id_seq(usage)';
  end if;
  if missed is not null then
    raise exception '0018 롤백: 되돌리지 못한 권한이 있다 — %', missed
      using hint = '§1 의 부여 문장 중 일부가 실행되지 않았다. 시퀀스 이름·롤 이름을 확인할 것.';
  end if;

  -- ② PUBLIC 직접 부여 — 롤백은 두 롤에만 준다. PUBLIC 이 보이면 상행보다 넓어진 것이다.
  select string_agg(format('%s(%s)', c.relname, a.privilege_type), ', ')
    into extra
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where n.nspname = 'public' and c.relkind = 'S' and a.grantee = 0;
  if extra is not null then
    raise exception '0018 롤백: PUBLIC 에 시퀀스 권한이 생겼다 — % (롤백이 상행보다 넓은 문을 열었다)', extra
      using hint = '0018 은 anon·authenticated 에서만 회수했다. 되돌리는 대상도 그 둘뿐이어야 한다.';
  end if;

  -- ③ 관리자 화면(콘텐츠 여섯 usage)과 서비스 롤·소유자 경로
  select string_agg(format('%s → %s(%s)', r.role, s.seq, r.priv), ', ' order by r.role, s.seq, r.priv)
    into missed
    from unnest(seven) as s(seq)
    cross join (values ('service_role', 'usage'), ('service_role', 'select'), ('service_role', 'update'),
                       ('postgres', 'usage'), ('postgres', 'select'), ('postgres', 'update'),
                       ('authenticated', 'usage')) as r(role, priv)
   where to_regclass(s.seq) is not null
     and not has_sequence_privilege(r.role, s.seq, r.priv);
  if missed is not null then
    raise exception '0018 롤백: 롤백은 성공했다고 말하면서 관리자 화면이나 서비스 롤 경로가 죽어 있다 — %', missed
      using hint = '0018 도 이 롤백도 service_role·postgres 와 콘텐츠 여섯의 authenticated usage 를 건드리지 않는다 — 여기가 걸렸다면 다른 원인이다. 0009 §6(관리자 시퀀스 usage)과 통지 적재(서비스 롤)를 확인할 것.';
  end if;
end
$$;

commit;

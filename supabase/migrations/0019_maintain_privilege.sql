-- 0019_maintain_privilege.sql — 공개 롤의 표 `MAINTAIN` 권한 회수 (PostgreSQL 17+ 전용 · 버전 조건부)
--                              (플랜 v4 P5-15 · ADR-2)
--
-- ## 왜 이 파일이 생겼나 — 여섯 번째, 그리고 게이트가 놓쳤다
-- 이 DB 의 기본 권한(`pg_default_acl`)은 새로 만드는 표를 `anon`·`authenticated` 에게 **전권**(`arwdDxtm`)으로 연다(CLAUDE.md §3).
-- 그 마지막 글자 `m` 이 **`MAINTAIN`** — PostgreSQL 17 에 새로 생긴 표 권한이다. 허용하는 것:
--   `VACUUM` · `ANALYZE` · `CLUSTER` · `REINDEX` · `REFRESH MATERIALIZED VIEW` · **`LOCK TABLE`(모든 모드)**
-- 0009~0018 은 표 권한을 차례로 정리했지만 **이 글자는 한 번도 회수하지 않았다**(P6-13 이 범위 밖에서 발견, 컨트롤러 재측정).
-- 그리고 P6-11 의 새 권한 게이트(tests/db-privilege-gate.test.ts)는 이것을 **초록으로 통과시켰다** — 객체는 카탈로그에서
-- 열거하면서 권한 종류는 `('select'), ('insert'), …` 로 하드코딩했기 때문이다. P5-15 가 게이트를 먼저 고쳤고
-- (종류도 `acldefault`·`aclexplode` 로 열거), 고친 게이트가 **이 파일 적용 전** 같은 DB 에서 18건을 이름으로 대며 빨개졌다.
--
-- 적용 전 실측(2026-09-17, 로컬 PostgreSQL 17.6 · `has_table_privilege(…, 'MAINTAIN')`):
--   gallery · gallery_albums · notices · notifications_log · places · popups · reservations · showcase_routes · vehicles
--     × anon, authenticated, service_role  = true      ← 공개 스키마 표 아홉 개 전부
--   admin_users: service_role 만 true (0009 가 공개 롤에서 `revoke all`)
--   relacl 예: reservations `{…,anon=m/postgres,authenticated=rm/postgres,…}` — 0012·0017 이 다른 글자는 다 걷었는데 `m` 만 남았다.
--
-- ## 왜 위험한가 — RLS 는 이것을 전혀 보지 않는다 (TRUNCATE·TRIGGER 와 같은 부류)
--   · **`LOCK TABLE reservations IN ACCESS EXCLUSIVE MODE`** — 잠금을 쥐고 있는 동안 **예약 접수(insert)가 전부 멈춘다.**
--     적용 전 로컬에서 `set local role anon` 으로 실제로 잡혔다(P5-15 보고서 ⑥).
--   · `ANALYZE reservations` — 역시 anon 으로 **실제로 돌았다**(`pg_stat_user_tables.last_analyze` 갱신 확인). 통계를 흔들어
--     계획을 바꾸고, `VACUUM`(FULL 포함)은 표를 오래 잠근다.
-- 오늘 PostgREST 로 이 문장들에 도달할 경로는 없다. **그러나 같은 판단을 TRIGGER 때도 했고 실제 경로가 나왔다**
-- (0017 — supabase_functions.http_request). "오늘은 도달 불가" 는 회수를 미룰 근거가 아니다.
--
-- ## 회수하는 것
--   `anon`·`authenticated` 에서 **public 스키마의 모든 표·뷰(시퀀스 제외)의 `MAINTAIN`**.
--   표 이름을 하드코딩하지 않고 **카탈로그에서 열거**한다(0018 ① 과 같은 원칙) — 적용 시점에 있는 표 전부가 대상이다.
--
-- ## 회수하지 않는 것
--   · **`service_role`·`postgres`** — 불변. 서비스 롤은 원래 전권이고, 소유자 권한은 회수 대상이 아니다.
--   · **다른 모든 권한** — 표·컬럼·시퀀스·함수의 ACL 은 한 글자도 바꾸지 않는다. 자기검증 ④ 가 적용 전후 ACL 전수를 대조한다.
--   · **관리자 화면은 `MAINTAIN` 을 쓰지 않는다** — 관리자 CRUD 는 insert·update·delete·select 뿐이다(P5-15 실행 증명:
--     tests/write-privileges.test.ts §5-6 — 관리자 CRUD 2xx · 실제 enqueue · 실제 파기 어댑터). 접수·통지·파기는 서비스 롤이다.
--   · **기본 권한(`alter default privileges`) 자체** — runbook "기본 권한 자체를 회수할 것인가? 하지 않는다(지금은)" 결정을 따른다.
--     앞으로 생기는 표의 `MAINTAIN` 은 고친 게이트가 이름을 대며 잡는다.
--
-- ## ⚠️ 이 파일이 닫지 **못하는** 것 — `authenticated` 의 콘텐츠 여섯 표 `LOCK TABLE`
-- PostgreSQL 은 `ACCESS EXCLUSIVE` 등 강한 잠금을 **MAINTAIN · UPDATE · DELETE · TRUNCATE 중 하나**로 허용한다.
-- `authenticated` 는 콘텐츠 여섯 표(notices·popups·gallery·gallery_albums·showcase_routes·vehicles)에 관리자 편집용
-- UPDATE·DELETE 를 **표 단위로** 갖고 있다(0009 정책 · 게이트 AUTH_WRITE). 그래서 이 파일 뒤에도 로그인한 사용자라면
-- 그 여섯 표를 잠글 수 있다(로컬 실측). 관리자 화면을 죽이지 않고는 이 파일이 닫을 수 없는 문이라 **범위 밖**으로 두고
-- 보고한다(P5-15 보고서 ⑩). 개인정보 두 표(reservations·notifications_log)의 `authenticated` 는 SELECT 만 남아
-- 강한 잠금이 **거부된다** — 자기검증 ⑥ 이 실제로 친다.
--
-- ## 🔴 버전 조건부 — 16 이하에서는 아무것도 하지 않고 notice 만 남긴다
-- `MAINTAIN` 은 PostgreSQL 17 부터다. 16 이하에서 `revoke maintain` 은 **오류(unrecognized privilege type)로 마이그레이션을 멈추고,
-- `supabase db push` 는 0012~0019 를 한 번에 밀므로 원격 푸시 전체가 막힌다.** 원격 버전은 이 파일을 쓴 세션에서 확인하지 못했다
-- (로컬 17.6 · supabase/config.toml major_version 17). 그래서:
--   · 모든 `MAINTAIN` 문장·검사는 **`server_version_num >= 170000` 일 때만** 동적 SQL 로 실행한다.
--   · 미만이면 `raise notice` 로 **건너뛴 사실**을 남기고 끝난다(아무것도 바꾸지 않는다).
--   · 자기검증 ⑤ 가 **분기와 실제 능력을 대조**한다: 서버가 아는 표 권한(`acldefault('r', …)`)에 MAINTAIN 이 있는가 ↔ 버전 판정.
--     둘이 어긋나면(예: 17 인데 MAINTAIN 을 모른다, 16 인데 안다) 멈춘다 — 버전 번호만 믿고 조용히 건너뛰지 않는다.
--   로컬 실측: PostgreSQL 15(`postgres:15-alpine`) 컨테이너에서 이 파일이 notice 만 남기고 성공, ACL 불변(P5-15 보고서 ⑦).
--
-- 기존 행 영향: 권한만 회수한다. 표·컬럼·시퀀스·정책·함수 변경 0, 데이터 변경 0.
--   자기검증 ⑥ 의 거동 탐침은 `LOCK TABLE … NOWAIT` 를 **거부를 기대하는 조합에서만** 치고, 각 시도를 서브트랜잭션으로 감싸
--   끝에서 되돌린다(만에 하나 통과해도 잠금이 즉시 풀린다 · NOWAIT 라 기다리지 않는다). 권한 검사는 잠금 획득보다 먼저 일어나므로
--   거부되는 시도는 잠금을 잡지 않는다. `VACUUM` 은 트랜잭션 안에서 실행할 수 없고 `ANALYZE` 는 권한이 없으면 오류가 아니라
--   WARNING 으로 건너뛰므로(예외로 잡을 수 없다) 마이그레이션 안의 탐침은 `LOCK` 만 쓴다 — 셋 모두의 거부 출력은 보고서 ⑥.
-- 재실행 안전: `revoke` 는 없는 권한을 회수해도 오류가 아니다. ④ 의 대조는 "이번 실행 전후" 이므로 재실행에서도 성립한다.
-- PostgREST 스키마 캐시: 갱신하지 않는다(권한 변경은 캐시가 아니라 요청마다 평가된다).
-- 적용 경로: **`supabase db push` 만**(P5-15 R6 — SQL Editor 로 본문을 돌리면 schema_migrations 이력이 남지 않아
--   다음 db push 가 이 파일을 다시 돌린다. SQL Editor 는 읽기 확인용). **`psql -f` 를 쓰지 마라** — 파일이 원자적이지 않다(P4-5 리뷰 K1).
--   이 파일은 DO 블록 하나라 그 자체로 원자적이지만 규약을 따른다. 로컬 검증은 `psql -1`(단일 트랜잭션).
-- ⚠️ 자기검증 ⑥ 이 `set local role` 로 롤을 바꾼다 — 적용하는 롤이 `anon`·`authenticated` 의 멤버여야 한다(0017·0018 과 같다).
--    탐침 뒤에는 `reset role` 이 아니라 **시작할 때 캡처한 적용 롤**로 `set local role` 해서 돌아온다(0017·0018 의 GPT 검증 P2).
-- ⚠️ ⑥ 의 대조군은 `public.p0019_probe_tbl` 을 **만들었다 되돌린다**(커밋되지 않는다). 적용 롤에 public 스키마 CREATE 가 필요하다.
-- 롤백: supabase/rollbacks/0019_maintain_privilege.down.sql (수동 실행 전용 · 승인 플래그 요구).

-- lock_timeout 상한 (P5-15 R7): CLI 가 이 파일을 한 트랜잭션으로 돌려 set local 은 이 파일에만 걸린다 — 잠금을 5초 넘게 기다리면 파일째 롤백.
set local lock_timeout = '5s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0019: 앞 문장의 set local lock_timeout 이 남지 않았다 (지금 %) — 파일이 한 트랜잭션으로 돌지 않는 경로다. 아무것도 바꾸기 전에 멈춘다', current_setting('lock_timeout')
      using hint = 'supabase db push 로 적용할 것(파일 하나 = 트랜잭션 하나). psql -f 처럼 문장마다 커밋하는 경로에서는 set local 이 그 문장에서 끝난다(PostgreSQL 은 경고만 낸다).';
  end if;
end
$$;

do $$
declare
  -- ⑤ 분기 — **이 두 줄이 분기의 전부다.** 테스트가 이 줄들을 치환해 16 이하 경로를 실행한다(tests/write-privileges.test.ts §18).
  v_ver             constant int     := current_setting('server_version_num')::int;
  v_knows_maintain  constant boolean := exists (select 1 from aclexplode(acldefault('r', to_regrole(current_user))) d where d.privilege_type = 'MAINTAIN');
  v_applies         constant boolean := v_ver >= 170000;

  applier    constant text := current_user;
  rel        regclass;
  before_acl text[];
  after_acl  text[];
  before_svc text[];
  after_svc  text[];
  leaked     text;
  diff       text;
  probe      record;
  n_probes   int := 0;
  ok         boolean;
  st         text;
  ms         text;
  control_ok boolean := false;
begin
  -- ⑤ 분기가 옳은가 — 버전 판정과 서버의 실제 능력(acldefault 가 아는 표 권한)이 일치해야 한다.
  if v_applies is distinct from v_knows_maintain then
    raise exception '0019: 버전 분기와 서버 능력이 어긋난다 — server_version_num=% (17 이상 판정=%) · 서버가 아는 표 권한에 MAINTAIN 이 있다=%', v_ver, v_applies, v_knows_maintain
      using hint = '버전 번호만 믿고 건너뛰거나 실행하지 않는다. 17 이상인데 MAINTAIN 을 모르면 포크·패치된 서버일 수 있고, 17 미만인데 안다면 백포트다. 어느 쪽이든 사람이 서버를 확인한 뒤 이 파일의 분기를 고쳐야 한다(select version(); select * from aclexplode(acldefault(''r'', to_regrole(current_user)));).';
  end if;

  if not v_applies then
    raise notice '0019: PostgreSQL % (server_version_num=%) — MAINTAIN 권한이 없는 버전이다(17 부터). 회수를 건너뛴다. 아무것도 바꾸지 않았다.', current_setting('server_version'), v_ver;
    return;
  end if;

  -- ── 여기부터 17 이상 ─────────────────────────────────────────────────────────────────────────────────
  -- ④·② 의 "적용 전" — public 스키마 모든 표·뷰·시퀀스의 ACL 항목 전부(종류 불문 · aclexplode 로 열거)에서
  --   **이 파일이 바꾸는 것(공개 롤의 MAINTAIN)만 뺀** 집합. 컬럼 ACL 도 함께 본다.
  select coalesce(array_agg(x order by x), '{}') into before_acl from (
    select format('%s|%s|%s|%s|%s', c.relname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable) as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
       and not (a.privilege_type = 'MAINTAIN' and a.grantee in (to_regrole('anon'), to_regrole('authenticated')))
    union all
    select format('%s.%s|%s|%s|%s|%s', c.relname, at.attname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable)
      from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(at.attacl) a
     where n.nspname = 'public' and at.attacl is not null
  ) s;
  select coalesce(array_agg(x order by x), '{}') into before_svc from (
    select format('%s|%s|%s', r.role, c.relname, has_table_privilege(r.role, c.oid, 'MAINTAIN')) as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('service_role'), ('postgres')) r(role)
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
  ) s;

  -- 회수 — 카탈로그 열거. `%s` 에 regclass 를 넣어 스키마·인용을 PostgreSQL 이 처리하게 한다.
  for rel in
    select c.oid::regclass
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     order by c.relname
  loop
    execute format('revoke maintain on table %s from anon, authenticated', rel);
  end loop;

  -- ③ PUBLIC(grantee 0)에 MAINTAIN 0 — **① 보다 먼저 본다**(0017·0018 의 교훈). has_table_privilege 는 PUBLIC 상속을 잡으므로,
  --    PUBLIC 에 grant 가 있으면 ① 이 "anon → x" 로 보고하고, 그 메시지대로 anon 에서 회수하면 아무것도 바뀌지 않는다.
  select string_agg(c.relname, ', ' order by c.relname)
    into leaked
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and a.grantee = 0 and a.privilege_type = 'MAINTAIN';
  if leaked is not null then
    raise exception '0019: PUBLIC 에 MAINTAIN 이 부여돼 있다 — %', leaked
      using hint = 'PUBLIC 에 준 권한은 anon·authenticated 가 상속한다. 롤을 지정한 회수로는 지워지지 않는다 — 대상을 PUBLIC 으로 지정해 따로 회수할 것. 이 검사가 ① 보다 먼저 도는 이유: ① 은 상속된 권한을 anon 의 권한으로 보고하므로 그 메시지만 보고 anon 에서 회수하면 아무것도 바뀌지 않는다.';
  end if;

  -- ① 공개 롤의 MAINTAIN 이 **모든** 표에서 false — 카탈로그 열거(모르는 새 표도 이름으로 멈춘다).
  select string_agg(format('%s → %s', r.role, c.relname), ', ' order by c.relname, r.role)
    into leaked
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) r(role)
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_table_privilege(r.role, c.oid, 'MAINTAIN');
  if leaked is not null then
    raise exception '0019: 공개 롤에 MAINTAIN 이 남았다 — %', leaked
      using hint = '원인을 순서대로 볼 것: ① 회수 루프가 그 표를 열거하지 못했다(스키마·relkind) ② 다른 부여자(supabase_admin 등)가 준 grant 가 있다 — revoke 는 실행 롤이 부여한 것만 지운다. 부여자는 `select a.grantor::regrole, a.grantee::regrole, a.privilege_type from pg_class c cross join lateral aclexplode(c.relacl) a where c.relname = <표>` 로 본다 ③ anon·authenticated 가 MAINTAIN 을 가진 다른 롤(pg_maintain 등)의 멤버다 — `select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid where m.member = ''anon''::regrole`. MAINTAIN 이 남으면 LOCK TABLE … ACCESS EXCLUSIVE 로 예약 접수를 멈출 수 있고 RLS 는 그것을 막지 못한다.';
  end if;

  -- ② service_role·postgres 의 MAINTAIN 불변 — 적용 전과 같은 값(적용 전에 없던 표가 있어도 막지 않는다: 업그레이드된 DB 의 옛 ACL 에는 m 이 없을 수 있다).
  select coalesce(array_agg(x order by x), '{}') into after_svc from (
    select format('%s|%s|%s', r.role, c.relname, has_table_privilege(r.role, c.oid, 'MAINTAIN')) as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('service_role'), ('postgres')) r(role)
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
  ) s;
  if after_svc is distinct from before_svc then
    select string_agg(x, ', ') into diff from (
      select unnest(before_svc) except select unnest(after_svc)
    ) d(x);
    raise exception '0019: service_role·postgres 의 MAINTAIN 이 바뀌었다 — 적용 전: %', diff
      using hint = '회수 문장의 롤 목록에 service_role 이나 postgres 가 섞였다. 이 파일은 anon·authenticated 에서만 회수한다.';
  end if;

  -- ④ 다른 권한은 한 글자도 변하지 않았다 — 적용 전 집합(공개 롤 MAINTAIN 제외)과 적용 후 같은 질의가 같아야 한다.
  select coalesce(array_agg(x order by x), '{}') into after_acl from (
    select format('%s|%s|%s|%s|%s', c.relname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable) as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
       and not (a.privilege_type = 'MAINTAIN' and a.grantee in (to_regrole('anon'), to_regrole('authenticated')))
    union all
    select format('%s.%s|%s|%s|%s|%s', c.relname, at.attname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable)
      from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(at.attacl) a
     where n.nspname = 'public' and at.attacl is not null
  ) s;
  if after_acl is distinct from before_acl then
    select string_agg(x, ', ') into diff from (
      (select '-' || unnest(before_acl) except select '-' || unnest(after_acl))
      union all
      (select '+' || unnest(after_acl) except select '+' || unnest(before_acl))
    ) d(x);
    raise exception '0019: MAINTAIN 말고 다른 권한이 바뀌었다 — %', diff
      using hint = '이 파일은 공개 롤의 MAINTAIN 만 회수한다. 표 권한을 뭉뚱그리는 문장(revoke all 등)이나 다른 롤이 섞였는지 볼 것. 표·컬럼·시퀀스 ACL 전수(종류 불문)를 적용 전후로 대조한 결과다.';
  end if;

  -- ⑥ 거동 탐침 — 행렬로 끝내지 않는다. `set local role` 로 공개 롤이 되어 **실제로** `LOCK TABLE … ACCESS EXCLUSIVE MODE NOWAIT` 를 친다.
  --    대상: 그 롤이 그 표에 SELECT·MAINTAIN 말고는 **아무 권한도 없는** 조합 전부(카탈로그 열거 — 종류는 acldefault 에서 얻는다).
  --    즉 "강한 잠금을 허용할 수 있는 것이 MAINTAIN 뿐인" 조합이다. SELECT 만으로는 강한 잠금이 허용되지 않으므로 회수가
  --    옳다면 전부 42501 이어야 한다. **MAINTAIN 을 선정 조건에서 빼는 이유**: 회수가 실패해 MAINTAIN 이 남은 조합이
  --    바로 잡아야 할 대상인데, 그것을 "다른 권한이 있다" 로 보고 제외하면 탐침이 정확히 새는 곳에서 눈을 감는다(깨뜨리기 ⑥ 에서 확인).
  --    (UPDATE·DELETE 가 있는 조합 — authenticated × 콘텐츠 여섯 — 은 MAINTAIN 없이도 잠글 수 있어 대상이 아니다. 헤더 "닫지 못하는 것".)
  --
  --    🔴 **잠금 획득은 구조적으로 불가능해야 한다** (astra R2 P1-A — 이 블록은 원격 적용 중에 실제 표를 대상으로 돈다).
  --    ① 이 이 블록보다 먼저 돌아 MAINTAIN 이 남았으면 여기 오기 전에 멈춘다. 그래도 **시도 직전에 한 번 더**,
  --    그 롤이 그 표에 **SELECT 말고 어떤 권한이든**(종류는 acldefault 에서 열거 — MAINTAIN·UPDATE·DELETE·TRUNCATE·INSERT… 전부)
  --    갖고 있으면 **LOCK 을 시도하지 않고** 멈춘다. PostgreSQL 17 LockTableAclCheck 는 ACCESS EXCLUSIVE 에
  --    MAINTAIN|UPDATE|DELETE|TRUNCATE 중 하나를 요구하므로(SELECT·INSERT 는 약한 모드에만), 이 사전 검사를 통과한 조합은
  --    잠금을 **얻을 수 없다**. has_table_privilege 는 소유권·슈퍼유저·멤버십(pg_maintain 포함)·PUBLIC 까지 반영한다.
  --    처음 판은 이 검사가 없어서, ① 을 가린 깨뜨리기 변형에서 탐침이 실제로 gallery 의 ACCESS EXCLUSIVE 를 **잡았다가** 되돌렸다.
  for probe in
    select r.role as who, c.oid::regclass as tbl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated')) r(role)
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not exists (
             select 1 from aclexplode(acldefault('r', c.relowner)) d
              where d.privilege_type not in ('SELECT', 'MAINTAIN')  -- src/backend/commands/lockcmds.c LockTableAclCheck: ACCESS EXCLUSIVE 는 SELECT 로 허용되지 않는다(MAINTAIN 은 ① 과 아래 사전 검사가 본다)
                and has_table_privilege(r.role, c.oid, d.privilege_type))
     order by c.relname, r.role
  loop
    n_probes := n_probes + 1;
    -- 시도 직전 사전 검사 — SELECT 외의 권한이 하나라도 있으면 시도하지 않는다(위 🔴).
    select string_agg(lower(d.privilege_type), ',' order by d.privilege_type)
      into leaked
      from pg_class k
      cross join lateral aclexplode(acldefault('r', k.relowner)) d
     where k.oid = probe.tbl
       and d.privilege_type <> 'SELECT'  -- src/backend/commands/lockcmds.c LockTableAclCheck: SELECT 는 ACCESS SHARE 이하만, INSERT 는 ROW EXCLUSIVE 이하만 — 그래도 INSERT 는 남겨 보수적으로 멈춘다
       and has_table_privilege(probe.who, k.oid, d.privilege_type);
    if leaked is not null then
      raise exception '0019: % 가 % 에 강한 잠금을 줄 수 있는 권한(%)을 갖고 있다 — 잠금을 시도하지 않고 멈춘다', probe.who, probe.tbl, leaked
        using hint = '① 의 행렬이 통과했는데 여기 걸렸다면 권한 판정 밖의 경로가 있다(롤 멤버십·다른 부여자·소유권). 실제 표에 잠금을 거는 시도는 하지 않았다.';
    end if;
    begin
      execute format('set local role %I', probe.who);
    exception when others then
      get stacked diagnostics st = returned_sqlstate, ms = message_text;
      raise exception '0019: 거동 탐침이 롤 %(으)로 전환하지 못했다 — % %', probe.who, st, ms
        using hint = '이 마이그레이션을 적용하는 롤이 anon·authenticated 의 멤버가 아니다. 보통 postgres(또는 supabase_admin)로 적용하며 그 롤은 둘 모두의 멤버다 — supabase db push 로 적용할 것. 조용히 건너뛰지 않는다.';
    end;
    if current_user <> probe.who then
      raise exception '0019: 거동 탐침의 롤 전환이 반영되지 않았다 (current_user=% · 기대=%)', current_user, probe.who;
    end if;

    ok := false;
    st := null;
    ms := null;
    begin
      execute format('lock table %s in access exclusive mode nowait', probe.tbl);
      ok := true;
      -- 통과했다면 잠금을 쥐고 있다 — 서브트랜잭션째 되돌려 즉시 푼다.
      raise exception using errcode = 'P0019', message = 'p0019 lock acquired — rolling back';
    exception
      when sqlstate 'P0019' then
        null;
      when others then
        get stacked diagnostics st = returned_sqlstate, ms = message_text;
    end;
    -- `reset role` 을 쓰지 않는다 — 세션 기본 롤로 돌아간다(0018 GPT 검증 P2). 캡처한 적용 롤로 명시 복원.
    execute format('set local role %I', applier);
    if current_user <> applier then
      raise exception '0019: 탐침 뒤 적용 롤(%)로 돌아오지 못했다 (current_user=%)', applier, current_user;
    end if;

    if ok then
      raise exception '0019: % 가 % 를 ACCESS EXCLUSIVE 로 잠글 수 있다', probe.who, probe.tbl
        using hint = '① 의 행렬이 통과했는데 잠금이 된다면 권한 판정 밖의 경로가 있다(롤 멤버십·다른 부여자). 이 잠금이 쥐어져 있는 동안 그 표의 모든 읽기·쓰기가 멈춘다.';
    end if;
    if st is distinct from '42501' then
      raise exception '0019: 탐침이 권한 거부(42501)가 아닌 이유로 실패했다 — % → LOCK % : SQLSTATE=% MESSAGE=%', probe.who, probe.tbl, st, ms
        using hint = '거부는 됐지만 이유가 권한이 아니다(55P03 잠금 대기 실패 등). 그 상태에서는 "권한을 회수했다" 가 증명되지 않는다.';
    end if;
  end loop;
  if n_probes = 0 then
    raise exception '0019: 거동 탐침 대상이 하나도 없다 — 탐침이 공허하다'
      using hint = '개인정보 두 표(reservations·notifications_log)는 0017 뒤 anon 에게 권한이 0 이어야 한다. 대상이 0 이면 앞선 회수(0012·0017)가 적용되지 않았거나 열거가 고장났다.';
  end if;

  -- ⑥-대조군 — **같은 문장**이 MAINTAIN **하나만** 있을 때는 성공하는가. 없으면 "탐침 SQL 이 틀려서 실패" 와 "권한이 없어서 거부" 가
  --    구분되지 않는다(0017·0018 규범). 임시 표는 서브트랜잭션 안에서 만들고 끝에서 예외로 통째로 되돌린다 — 커밋되지 않는다.
  begin
    execute 'create table public.p0019_probe_tbl (id int)';
    -- PUBLIC 까지 회수한다 — 기본 PUBLIC UPDATE 등이 있으면 "MAINTAIN 하나로 성공" 이 다른 권한으로 성립한다(P5-15 astra R4 P2-3).
    execute 'revoke all on table public.p0019_probe_tbl from public, anon, authenticated, service_role';
    execute 'grant maintain on table public.p0019_probe_tbl to anon';
    -- 의도한 유효 권한만 — anon 의 MAINTAIN 하나. 세 롤 × 열거한 표 권한 종류 전부를 본다.
    select string_agg(format('%s(%s)=%s', w.role, lower(d.privilege_type), has_table_privilege(w.role, 'public.p0019_probe_tbl', d.privilege_type)), ', ')
      into leaked
      from (values ('anon'), ('authenticated'), ('service_role')) w(role)
      cross join lateral aclexplode(acldefault('r', (select relowner from pg_class where oid = 'public.p0019_probe_tbl'::regclass))) d
     where has_table_privilege(w.role, 'public.p0019_probe_tbl', d.privilege_type)
           is distinct from (w.role = 'anon' and d.privilege_type = 'MAINTAIN');
    if leaked is not null then
      raise exception '0019: 대조군 일회용 표의 유효 권한이 의도와 다르다 — %', leaked
        using hint = 'PUBLIC 이나 기본 권한이 남아 있으면 대조군이 MAINTAIN 이 아닌 권한으로 성공한다. 회수 목록에 public 이 있는지 볼 것.';
    end if;
    execute 'set local role anon';
    if current_user <> 'anon' then
      raise exception '0019: 대조군의 롤 전환이 반영되지 않았다 (current_user=%)', current_user;
    end if;
    execute 'lock table public.p0019_probe_tbl in access exclusive mode nowait';
    execute format('set local role %I', applier);
    raise exception using errcode = 'P0019', message = 'p0019 control rollback';
  exception
    when sqlstate 'P0019' then
      control_ok := true;
    when others then
      get stacked diagnostics st = returned_sqlstate, ms = message_text;
      if ms like '0019:%' then
        raise exception '%', ms using hint = '대조군 준비 단계의 자기검증이 멈췄다(위 메시지).';
      end if;
      raise exception '0019: 대조군이 실패했다 — MAINTAIN 만 준 임시 표에서도 anon 의 LOCK 이 돌지 않았다 (SQLSTATE=% MESSAGE=%)', st, ms
        using hint = '탐침 SQL 자체가 틀렸거나 롤 전환이 되지 않는다. 대조군이 실패하면 ⑥ 의 "거부" 는 아무것도 증명하지 못한다 — 그래서 여기서 멈춘다.';
  end;
  if not control_ok then
    raise exception '0019: 대조군이 끝까지 돌지 않았다';
  end if;

  if current_user <> applier then
    raise exception '0019: 탐침이 롤을 되돌리지 못했다 (current_user=% · 기대=%)', current_user, applier
      using hint = '적용 롤 복원(set local role <적용 롤>)이 빠진 경로가 있는지 확인할 것. reset role 로 바꾸면 안 된다 — 세션 기본 롤로 돌아간다.';
  end if;
  if to_regclass('public.p0019_probe_tbl') is not null then
    raise exception '0019: 대조군의 임시 표가 남았다'
      using hint = '대조군 서브트랜잭션이 되돌려지지 않았다. public.p0019_probe_tbl 을 직접 지울 것.';
  end if;

  raise notice '0019: PostgreSQL % — 공개 롤의 MAINTAIN 회수 완료 · 거동 탐침 %건 거부 확인 · 대조군 성공', current_setting('server_version'), n_probes;
end
$$;

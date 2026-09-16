-- 0018_sequence_privileges.sql — 공개 롤의 시퀀스 권한 회수 (관리자 insert 의 nextval 만 남긴다)
--                                (플랜 v4 P5-14 · ADR-2)
--
-- ## 왜 이 파일이 생겼나 — 사람이 아니라 게이트가 먼저 찾았다
-- 이 DB 의 기본 권한(`pg_default_acl`)은 새로 만드는 표·함수·**시퀀스**를 `anon`·`authenticated` 에게 연다(CLAUDE.md §3).
-- 0009·0010·0012·0013·0016·0017 이 표와 함수를 차례로 정리했지만 **시퀀스는 한 번도 회수하지 않았다.**
-- 같은 뿌리의 **다섯 번째 사례**이고, 이번에는 P6-11 의 새 객체 권한 게이트(tests/db-privilege-gate.test.ts)가
-- **첫 실행에서** 36건을 이름으로 대며 빨개졌다. 게이트는 허용 목록을 넓히지 않고 빨간 채로 두었고, 이 파일이 그것을 닫는다.
--
-- 적용 전 실측(2026-09-17, 로컬 스택 · `has_sequence_privilege` 실효값 + `pg_class.relacl`):
--   gallery_albums_id_seq · gallery_id_seq · notices_id_seq · notifications_log_id_seq ·
--   popups_id_seq · showcase_routes_id_seq · vehicles_id_seq
--     anon:          select, update, usage      ← 일곱 개 전부
--     authenticated: select, update, usage      ← 일곱 개 전부
--     service_role · postgres: select, update, usage
--   relacl 은 일곱 개 모두 `{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}`
--   (부여자는 postgres 하나 — 마이그레이션이 postgres 로 적용됐기 때문이다) · PUBLIC(grantee 0) grant 0.
--
-- ## 무엇이 실제로 필요한가
--   · `nextval()` 은 **`usage` 또는 `update`** 하나면 된다. 관리자 화면(authenticated + is_admin 정책)이 콘텐츠 표에
--     행을 넣을 때 serial 기본값이 `nextval` 을 부른다 → **`authenticated` 의 콘텐츠 여섯 시퀀스 `usage`** 가 필요하다.
--     (0009 §6 이 그것을 명시적으로 줬다. 0016 자기검증 ⑧ 이 그 생존을 이미 확인한다.)
--   · `notifications_log` 에 행을 넣는 것은 **서비스 롤**(lib/notify/outbox.ts)과 **소유자 권한으로 도는 definer 함수**
--     (0010 의 관리자 전이 — 호출자가 authenticated 여도 함수 안의 nextval 은 소유자 postgres 권한이다)뿐이다.
--     → `authenticated` 는 그 시퀀스에 아무것도 필요 없다. 0012 가 그 표의 insert 를 이미 회수했다.
--   · `anon` 은 **어느 표에도 넣지 않는다**(0012·0013). → 시퀀스 권한이 전혀 필요 없다.
--   · `select`(`currval`·`lastval`·시퀀스 행 조회)는 앱이 쓰지 않는다. 저장소 전수 검색에서 `nextval`·`setval`·`currval`·
--     `_id_seq` 를 부르는 앱 코드 0건(마이그레이션과 테스트만).
--
-- ## 왜 위험한가 — `update` 는 `setval()` 이다
-- `notifications_log_id_seq` 를 되감으면(`setval(…, 1)`) 이후 통지 적재가 **기본키 중복(23505)으로 전부 실패**한다.
-- 예약은 들어오는데 **어떤 알림도 적재되지 않는** 조용한 장애다 — 사장님도 고객도 문자를 받지 못하고, 화면에는 아무 일도 없다.
-- 콘텐츠 시퀀스를 되감으면 관리자의 새 글 저장이 같은 이유로 실패한다.
-- 오늘 공개 롤이 이 권한에 닿는 경로는 없다(P6-11 실측: PostgREST 는 pg_catalog 의 setval·nextval 을 노출하지 않아
-- `/rpc/setval` 이 404 PGRST202, anon 이 실행할 수 있는 public 함수 0). **그러나 같은 판단을 TRIGGER 때도 했고
-- 실제 경로가 나왔다**(0017 — supabase_functions.http_request). "오늘은 도달 불가" 는 회수를 미룰 근거가 아니다.
--
-- ## 회수하는 것
--   1. `anon`         : 일곱 시퀀스에서 usage·select·update **전부**
--   2. `authenticated`: 일곱 시퀀스에서 select·update
--   3. `authenticated`: `notifications_log_id_seq` 에서 usage 도
--
-- ## 회수하지 않는 것 (범위를 좁게 잡는 것이 이 계열 마이그레이션의 핵심이다)
--   · 🔴 **`authenticated` 의 콘텐츠 여섯 시퀀스 `usage`** — 회수하면 관리자가 공지·팝업·사진·앨범을 **새로 만들지 못한다**
--     (insert 권한은 있는데 nextval 에서 42501 — 저장 버튼만 실패하는 조용한 고장). §3 ② 가 그 생존을 확인한다.
--   · **`service_role`·`postgres`** — 공개 접수 뒤의 통지 적재(서비스 롤)와 definer 함수(소유자)가 nextval 한다. §3 ③.
--   · **표·함수 권한** — 0009~0017 소관이다. 이 파일은 `on sequence` 문장만 쓴다. 함수는 만들지도 지우지도 않는다
--     (`drop function` 후 재생성은 EXECUTE 를 공개 롤에 다시 연다 — CLAUDE.md §3).
--   · **기본 권한(`alter default privileges`) 자체** — runbook 의 "기본 권한 자체를 회수할 것인가? 하지 않는다(지금은)" 결정을
--     따른다. 앞으로 생기는 시퀀스는 P6-11 게이트가 이름을 대며 잡는다.
--
-- ## 부여자가 둘일 수 있다는 점 (CLAUDE.md §3)
-- `revoke` 는 **실행하는 롤이 부여한 grant** 만 지운다. 로컬 실측의 부여자는 postgres 하나였고 원격도 postgres 로 적용된
-- 객체라 같을 것이다. 그러나 확인하지 않은 가정에 기대지 않는다 — §3 ① 은 행렬(부여자 무관 실효값)을 보므로,
-- 다른 부여자의 grant 가 남아 있으면 적용이 **멈춘다**(조용히 성공하지 않는다).
--
-- 기존 행 영향: 권한만 회수한다. 표·컬럼·시퀀스 값·정책·함수 변경 0, 데이터 변경 0.
--   §3 ⑤ 는 실제 시퀀스에 아무것도 시도하지 않는다(P5-15 astra R4) — 거동은 되돌려지는 일회용 시퀀스에서만 본다.
--   일회용 시퀀스(`public.p0018_probe_seq`)는 적용 중의 DDL 이다 — 이벤트 트리거가 CREATE SEQUENCE 태그로 분기할 수 있으므로
--   원격 적용 **직전**에 `pg_event_trigger` 를 읽어 확인한다(runbook "적용 직전 필수"). 적용 롤에 public 스키마 CREATE 가 필요하다.
-- 재실행 안전: `revoke` 는 없는 권한을 회수해도 오류가 아니다. 조건 분기가 필요 없다.
-- PostgREST 스키마 캐시: 갱신하지 않는다(권한 변경은 캐시가 아니라 요청마다 평가된다).
-- 적용 경로: `supabase db push` 또는 SQL Editor. **`psql -f` 를 쓰지 마라** — 파일이 원자적이지 않아 자기검증이
--   `raise` 해도 앞 문장이 남는다(P4-5 리뷰 K1, docs/ops/migration-runbook.md). 로컬 검증은 `psql -1`(단일 트랜잭션).
-- ⚠️ §3 ⑤ 가 `set local role` 로 롤을 바꾼다 — 적용하는 롤이 `anon`·`authenticated` 의 멤버여야 한다(0017 과 같다).
--    탐침 뒤에는 `reset role` 이 아니라 **시작할 때 캡처한 적용 롤**로 `set local role` 해서 돌아온다. `reset role` 은 세션 기본 롤로
--    돌아가므로, 로그인 롤과 적용 롤이 다른 연결(`set role postgres` 후 적용)에서는 권한이 옳아도 마지막 단언이 실패한다
--    (GPT 검증 P2 — 로컬에서 supabase_admin 로그인 + set role postgres 로 재현하고, 이 방식으로 고친 뒤 통과를 확인했다).
-- 롤백: supabase/rollbacks/0018_sequence_privileges.down.sql (수동 실행 전용 · 승인 플래그 요구).

-- =========================================================================
-- 1. `anon` — 일곱 시퀀스 전부, 세 권한 전부
--    시퀀스 이름을 한 줄로 적는다(0013·0016·0017 과 같은 형태) — tests/write-privileges.test.ts 가 이 문장을 파싱해
--    상행이 회수한 (롤·시퀀스·권한) 삼중항과 하행이 부여하는 삼중항을 집합으로 대조한다.
-- =========================================================================
revoke usage, select, update on sequence
  notices_id_seq, popups_id_seq, gallery_id_seq, gallery_albums_id_seq, showcase_routes_id_seq, vehicles_id_seq, notifications_log_id_seq
  from anon;

-- =========================================================================
-- 2. `authenticated` — select·update 는 일곱 전부에서, usage 는 통지 시퀀스에서만
--    콘텐츠 여섯의 usage 는 **여기 없다** — 관리자 화면이 새 행을 만든다(헤더 "회수하지 않는 것").
-- =========================================================================
revoke select, update on sequence
  notices_id_seq, popups_id_seq, gallery_id_seq, gallery_albums_id_seq, showcase_routes_id_seq, vehicles_id_seq, notifications_log_id_seq
  from authenticated;

revoke usage on sequence
  notifications_log_id_seq
  from authenticated;

-- =========================================================================
-- 3. 자기검증 — 조용히 어긋나는 것들을 실행 중에 못박는다 (0012~0017 과 같은 규약)
--
--    ① **public 스키마의 모든 시퀀스**에서 `anon`·`authenticated` 의 권한이 허용(콘텐츠 6 × authenticated.usage) 밖으로 0
--       — 일곱 개를 하드코딩하지 않고 카탈로그에서 열거한다. 적용 시점에 모르는 시퀀스가 있으면 그것도 이름으로 멈춘다.
--    ② 콘텐츠 6 × `authenticated.usage` 가 **true** — 이 마이그레이션의 가장 큰 사고는 "너무 많이 회수하는 것" 이다
--    ③ `service_role`·`postgres` 가 일곱 시퀀스 모두에서 usage·select·update 를 그대로 갖는다
--    ④ PUBLIC(`aclexplode` grantee 0) 에 부여된 시퀀스 권한 0 — 표 단위든 시퀀스 단위든 롤 단위 revoke 는 PUBLIC 을 지우지 않는다
--    ⑤ **거동** — 행렬 대조로 끝내지 않는다. 단 **실제 시퀀스에는 setval·nextval 을 치지 않는다**(P5-15 astra R4 —
--       두 함수는 권한 검사 전에 ROW EXCLUSIVE 를 커밋까지 잡는다). 실제 시퀀스는 카탈로그로만(⑤-가), 거동은
--       PUBLIC 까지 회수한 **일회용 시퀀스**에서만(⑤-나: 거부 42501 · USAGE 만 가진 authenticated 의 nextval 성공 ·
--       UPDATE 만 받은 anon 의 setval·nextval 성공 · 매 단계 의도한 유효 권한을 열거로 단언 · 예측↔결과 대조) 본다.
--
--    🔴 **④ 를 ① 보다 먼저 본다 — 순서가 진단을 가른다**(0017 의 ④/⑤ 와 같은 교훈).
--    `has_sequence_privilege()` 는 PUBLIC 상속까지 잡으므로, PUBLIC 에 grant 가 있으면 ① 이 그것을 "anon → x(select)" 로
--    보고한다. 그 메시지대로 anon 에서 회수하면 **아무것도 바뀌지 않는다**(롤 단위 회수는 PUBLIC 의 grant 를 지우지 않는다).
--    이 순서라면 두 사고가 서로 다른 메시지로 갈린다:
--      · PUBLIC 에 grant 가 있다               → ④ 가 잡는다
--      · anon·authenticated 에 직접 grant 가 남았다 → ① 이 잡는다
--
--    `information_schema` 를 쓰지 않는다 — 필터된 뷰다(CLAUDE.md §3). `has_sequence_privilege()` 는 PUBLIC·상속까지 잡는다.
-- =========================================================================
do $$
declare
  seven      constant text[] := array['public.notices_id_seq', 'public.popups_id_seq', 'public.gallery_id_seq',
                                      'public.gallery_albums_id_seq', 'public.showcase_routes_id_seq',
                                      'public.vehicles_id_seq', 'public.notifications_log_id_seq'];
  content6   constant text[] := array['notices_id_seq', 'popups_id_seq', 'gallery_id_seq',
                                      'gallery_albums_id_seq', 'showcase_routes_id_seq', 'vehicles_id_seq'];
  leaked     text;
  lost       text;
  changed    text;
  missing    text;
  -- 거동 탐침용. 루프 변수 이름은 질의의 컬럼 별칭과 겹치지 않게 짓는다(0017 의 42702 교훈).
  probe_role text;
  probe_call text;
  step       text;
  expected   boolean;
  ok         boolean;
  st         text;
  ms         text;
  control_ok boolean := false;
  applier    constant text := current_user;
begin
  -- 0) 대상 일곱이 실재하는가 — 없으면 §1·§2 의 revoke 가 이미 실패했겠지만, 메시지를 분명히 한다.
  select string_agg(s.seq, ', ' order by s.seq)
    into missing
    from unnest(seven) as s(seq)
   where to_regclass(s.seq) is null;
  if missing is not null then
    raise exception '0018: 대상 시퀀스가 없다 — %', missing
      using hint = '0001(notices·popups·gallery·showcase_routes·vehicles·notifications_log)과 0008(gallery_albums)이 적용됐는지 확인할 것.';
  end if;

  -- ④ PUBLIC 직접 부여 0 — **① 보다 먼저 본다**(헤더 🔴). 롤 단위 revoke 는 PUBLIC 의 grant 를 지우지 않고,
  --    두 공개 롤은 그것을 상속한다.
  select string_agg(format('%s(%s)', c.relname, a.privilege_type), ', ' order by c.relname, a.privilege_type)
    into leaked
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where n.nspname = 'public'
     and c.relkind = 'S'
     and a.grantee = 0;
  if leaked is not null then
    raise exception '0018: PUBLIC 에 시퀀스 권한이 부여돼 있다 — %', leaked
      using hint = 'PUBLIC 에 준 권한은 anon·authenticated 가 상속한다. 롤을 지정한 회수로는 지워지지 않는다 — 대상을 PUBLIC 으로 지정해 따로 회수할 것. 이 검사가 ① 보다 먼저 도는 이유: ① 은 상속된 권한을 anon 의 권한으로 보고하므로, 그 메시지만 보고 anon 에서 회수하면 아무것도 바뀌지 않는다.';
  end if;

  -- ① 허용 밖 권한 0 — public 스키마의 **모든** 시퀀스를 카탈로그에서 열거한다.
  select string_agg(format('%s → %s(%s)', r.role, c.relname, p.priv), ', ' order by c.relname, r.role, p.priv)
    into leaked
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) as r(role)
    cross join (values ('usage'), ('select'), ('update')) as p(priv)
   where n.nspname = 'public'
     and c.relkind = 'S'
     and has_sequence_privilege(r.role, c.oid, p.priv)
     and not (r.role = 'authenticated' and p.priv = 'usage' and c.relname = any(content6));
  if leaked is not null then
    raise exception '0018: 공개 롤에 허용 밖의 시퀀스 권한이 남았다 — %', leaked
      using hint = '원인을 순서대로 볼 것: ① §1·§2 의 revoke 문에서 시퀀스나 롤이 빠졌다 ② 다른 부여자(supabase_admin 등)가 준 grant 가 있다 — revoke 는 실행 롤이 부여한 것만 지운다. 부여자는 `select a.grantor::regrole, a.grantee::regrole, a.privilege_type from pg_class c cross join lateral aclexplode(c.relacl) a where c.relname = <시퀀스>` 로 본다 ③ 이 파일이 모르는 새 시퀀스가 생겼다 — 그 표가 무엇인지 보고 같은 기준(관리자 insert 가 있으면 authenticated usage 만)으로 회수할 것. update 가 남으면 setval 로 시퀀스를 되감아 이후 insert 를 기본키 중복으로 전부 실패시킬 수 있다.';
  end if;

  -- ② 관리자 화면 생존 — 콘텐츠 여섯의 authenticated usage.
  select string_agg(s.seq, ', ' order by s.seq)
    into lost
    from unnest(content6) as s(seq)
   where not has_sequence_privilege('authenticated', 'public.' || s.seq, 'usage');
  if lost is not null then
    raise exception '0018: 관리자 화면이 새 행을 만드는 데 필요한 authenticated 의 시퀀스 usage 가 사라졌다 — %', lost
      using hint = '§2 의 usage 회수 문장에 콘텐츠 시퀀스가 섞였거나 §1 의 롤 목록에 authenticated 가 섞였다. 0009 §6 이 이 여섯에 usage 를 준다 — 사라지면 공지·팝업·사진·앨범 저장이 nextval 에서 42501 로 실패한다(insert 권한은 있어서 원인이 잘 보이지 않는다).';
  end if;

  -- ③ service_role·postgres 불변 — 공개 접수 뒤의 통지 적재(서비스 롤)와 definer 함수(소유자)가 nextval 한다.
  select string_agg(format('%s → %s(%s)', r.role, s.seq, p.priv), ', ' order by r.role, s.seq, p.priv)
    into changed
    from (values ('service_role'), ('postgres')) as r(role)
    cross join unnest(seven) as s(seq)
    cross join (values ('usage'), ('select'), ('update')) as p(priv)
   where not has_sequence_privilege(r.role, s.seq, p.priv);
  if changed is not null then
    raise exception '0018: service_role·postgres 의 시퀀스 권한이 바뀌었다 — %', changed
      using hint = '회수 문장의 롤 목록에 service_role 이나 postgres 가 섞였다. 통지 적재(lib/notify/outbox.ts)와 관리자 확정 definer 함수(0010)가 notifications_log 에 행을 넣으며 nextval 한다 — 막히면 접수는 되는데 문자가 한 통도 나가지 않는다.';
  end if;

  -- ⑤ 거동 — **실제 시퀀스에는 setval·nextval 을 치지 않는다** (P5-15 astra R4 P2-2 · 컨트롤러 결정).
  --
  --    🔴 왜: PostgreSQL 17 sequence.c 의 nextval_internal·do_setval 은 `init_sequence` → `lock_and_open_sequence` 로
  --    **권한 검사 전에** `LockRelationOid(seq, RowExclusiveLock)` 를 **최상위 트랜잭션 소유자**로 잡는다 — 거부돼도, 예외를 잡아도
  --    마이그레이션 커밋까지 풀리지 않는다. 앱의 nextval 과는 직접 충돌하지 않지만, 그 사이 누가 `ALTER SEQUENCE`
  --    (ShareRowExclusive)를 치면 그것이 이 잠금 뒤에 줄을 서고, **그 뒤의 앱 nextval 이 ALTER 뒤에 줄을 선다**(간접 정지).
  --    원칙(0017 ⑦ 과 같다): 권한 검사보다 잠금이 먼저인 탐침은 실제 객체에 치지 않는다.
  --
  --    ⑤-가 실제 시퀀스 — **카탈로그로만**. 종류는 acldefault('s') 열거, 소스상 그 호출을 허용하지 않는 것만 뺀다
  --         (nextval: ACL_USAGE|ACL_UPDATE → SELECT 제외 · setval: ACL_UPDATE → SELECT·USAGE 제외).
  --         허용된 유일한 경로(authenticated × 콘텐츠 여섯 × nextval 의 USAGE — ② 가 본다)만 뺀다.
  select string_agg(format('%s → %s(%s: %s)', r.role, q.call, c.relname, lower(d.privilege_type)), ', '
                    order by c.relname, r.role, q.call, d.privilege_type)
    into leaked
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) as r(role)
    cross join (values ('setval'), ('nextval')) as q(call)
    cross join lateral aclexplode(acldefault('s', c.relowner)) d
   where n.nspname = 'public'
     and c.relkind = 'S'
     and d.privilege_type <> 'SELECT'                             -- src/backend/commands/sequence.c: nextval_internal·do_setval 어느 쪽도 ACL_SELECT 로 허용하지 않는다
     and not (q.call = 'setval' and d.privilege_type = 'USAGE')   -- src/backend/commands/sequence.c do_setval: pg_class_aclcheck(…, ACL_UPDATE) 만
     and not (r.role = 'authenticated' and q.call = 'nextval' and d.privilege_type = 'USAGE' and c.relname = any(content6))
     and has_sequence_privilege(r.role, c.oid, d.privilege_type);
  if leaked is not null then
    raise exception '0018: 공개 롤이 실제 시퀀스에 setval·nextval 을 할 수 있는 권한을 갖고 있다 — % (실제 시퀀스에는 아무것도 시도하지 않았다)', leaked
      using hint = '① 이 통과했는데 여기 걸렸다면 판정 밖 경로(멤버십·소유권)다. setval 이 가능하면 notifications_log_id_seq 를 되감아 통지 적재를 전부 실패시킬 수 있다.';
  end if;

  --    ⑤-나 거동 — **일회용 시퀀스**에서만. 서브트랜잭션 안에서 만들고 끝에서 P0018 로 통째로 되돌린다.
  --         PUBLIC 까지 전부 회수한 뒤 `authenticated` 에게 USAGE 만 주고, 탐침 직전마다 "의도한 권한만 유효하다" 를
  --         열거로 단언한다(기본 PUBLIC 권한이 있으면 대조군이 엉뚱한 권한으로 성공한다 — astra R4 P2-3).
  --         예측은 소스 그대로: setval ⇐ UPDATE · nextval ⇐ USAGE 또는 UPDATE. 결과가 예측과 다르면 멈춘다(카탈로그 ↔ 거동 일치).
  --         마지막 두 단계는 anon 에게 UPDATE 만 주고 성공을 본다(대조군 — 같은 문장이 권한이 있으면 돈다).
  begin
    execute 'create sequence public.p0018_probe_seq';
    execute 'revoke all on sequence public.p0018_probe_seq from public, anon, authenticated, service_role';
    execute 'grant usage on sequence public.p0018_probe_seq to authenticated';

    foreach step in array array['anon:setval', 'anon:nextval', 'authenticated:setval', 'authenticated:nextval',
                                'anon+update:setval', 'anon+update:nextval'] loop
      probe_role := split_part(split_part(step, ':', 1), '+', 1);
      probe_call := split_part(step, ':', 2);
      if step = 'anon+update:setval' then
        execute 'grant update on sequence public.p0018_probe_seq to anon';
      end if;

      -- 의도한 유효 권한만 — 세 롤 × 열거한 종류 전부
      select string_agg(format('%s(%s)=%s', w.role, lower(d.privilege_type), has_sequence_privilege(w.role, 'public.p0018_probe_seq', d.privilege_type)), ', ')
        into leaked
        from (values ('anon'), ('authenticated'), ('service_role')) w(role)
        cross join lateral aclexplode(acldefault('s', (select relowner from pg_class where oid = 'public.p0018_probe_seq'::regclass))) d
       where has_sequence_privilege(w.role, 'public.p0018_probe_seq', d.privilege_type)
             is distinct from ((w.role = 'authenticated' and d.privilege_type = 'USAGE')
                               or (w.role = 'anon' and d.privilege_type = 'UPDATE' and step like 'anon+update:%'));
      if leaked is not null then
        raise exception '0018: 일회용 시퀀스의 유효 권한이 의도와 다르다 — % (단계 %)', leaked, step
          using hint = 'PUBLIC 이나 기본 권한(pg_default_acl)이 남아 있으면 대조군이 엉뚱한 권한으로 성공하거나 거부 기대가 깨진다. 회수 목록에 public 이 있는지 볼 것.';
      end if;

      expected := case probe_call
                    -- src/backend/commands/sequence.c do_setval: ACL_UPDATE · nextval_internal: ACL_USAGE | ACL_UPDATE
                    when 'setval' then has_sequence_privilege(probe_role, 'public.p0018_probe_seq', 'UPDATE')
                    else has_sequence_privilege(probe_role, 'public.p0018_probe_seq', 'USAGE')
                      or has_sequence_privilege(probe_role, 'public.p0018_probe_seq', 'UPDATE')
                  end;

      begin
        execute format('set local role %I', probe_role);
      exception when others then
        get stacked diagnostics st = returned_sqlstate, ms = message_text;
        raise exception '0018: 거동 탐침이 롤 %(으)로 전환하지 못했다 — % %', probe_role, st, ms
          using hint = '이 마이그레이션을 적용하는 롤이 anon·authenticated 의 멤버가 아니다. 보통 postgres(또는 supabase_admin)로 적용하며 그 롤은 둘 모두의 멤버다 — supabase db push 또는 SQL Editor 로 적용할 것. 조용히 건너뛰지 않는다.';
      end;
      if current_user <> probe_role then
        raise exception '0018: 거동 탐침의 롤 전환이 반영되지 않았다 (current_user=% · 기대=%)', current_user, probe_role
          using hint = 'set local role 이 트랜잭션 밖이라 무시됐을 수 있다. DO 블록 안에서는 정상 동작한다 — 적용 경로를 확인할 것.';
      end if;

      ok := false;
      st := null;
      ms := null;
      begin
        if probe_call = 'setval' then
          execute 'select pg_catalog.setval(''public.p0018_probe_seq''::regclass, 1, false)';
        else
          execute 'select pg_catalog.nextval(''public.p0018_probe_seq''::regclass)';
        end if;
        ok := true;
      exception when others then
        get stacked diagnostics st = returned_sqlstate, ms = message_text;
      end;
      -- `reset role` 을 쓰지 않는다 — 그것은 캡처한 적용 롤이 아니라 **세션 기본 롤**로 돌아간다
      -- (GPT 검증 P2 · 로컬 재현: session_user=supabase_admin 에서 current_user 가 supabase_admin 으로 돌아갔다).
      execute format('set local role %I', applier);
      if current_user <> applier then
        raise exception '0018: 탐침 뒤 적용 롤(%)로 돌아오지 못했다 (current_user=%)', applier, current_user;
      end if;

      if ok is distinct from expected then
        raise exception '0018: 카탈로그와 거동이 어긋난다 — % : 예측=% · 실행 성공=% (SQLSTATE=% MESSAGE=%)', step, expected, ok, st, ms
          using hint = '⑤-가 는 실제 시퀀스를 카탈로그로만 본다 — 그 판단이 옳으려면 권한이 setval·nextval 을 정확히 결정해야 한다. 대조군(anon+update)이 실패했다면 탐침 SQL 이나 롤 전환이 고장 난 것이다.';
      end if;
      if not ok and st is distinct from '42501' then
        raise exception '0018: 탐침이 권한 거부(42501)가 아닌 이유로 실패했다 — % : SQLSTATE=% MESSAGE=%', step, st, ms
          using hint = '거부는 됐지만 이유가 권한이 아니다(인자가 틀렸다 등). 그 상태에서는 "권한이 거동을 막는다" 가 증명되지 않는다.';
      end if;
    end loop;

    raise exception using errcode = 'P0018', message = 'p0018 probe rollback';
  exception
    when sqlstate 'P0018' then
      control_ok := true;
  end;
  if not control_ok then
    raise exception '0018: 대조군이 끝까지 돌지 않았다';
  end if;

  if current_user <> applier then
    raise exception '0018: 탐침이 롤을 되돌리지 못했다 (current_user=% · 기대=%)', current_user, applier
      using hint = '이 상태로 뒤 문장이 돌면 엉뚱한 롤로 실행된다. 적용 롤 복원(set local role <적용 롤>)이 빠진 경로가 있는지 확인할 것. reset role 로 바꾸면 안 된다 — 세션 기본 롤로 돌아간다.';
  end if;
  if to_regclass('public.p0018_probe_seq') is not null then
    raise exception '0018: 대조군의 임시 시퀀스가 남았다'
      using hint = '대조군 서브트랜잭션이 되돌려지지 않았다. public.p0018_probe_seq 를 직접 지울 것.';
  end if;
end
$$;

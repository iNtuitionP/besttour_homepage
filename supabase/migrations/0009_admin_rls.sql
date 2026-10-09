-- 0009_admin_rls.sql — 관리자 신원 표 + is_admin() + 표별 admin 정책 (플랜 v4 P5-1·P5-2 · ADR-2)
--
-- 왜: reservations 와 notifications_log 에는 고객 이름·전화번호·문자 본문이 있고, 지금까지는 서비스 롤만 닿을 수 있었다.
-- 이 마이그레이션이 사람(사장님)이 들어올 두 번째 문을 연다. ADR-2 는 그 문을 service role 이 아니라 RLS 위에 두라고 못박는다 —
-- service role 은 RLS 를 우회하므로 방어선이 애플리케이션의 requireAdmin() 호출 하나뿐이 되고, 한 화면에서 조기 return 을
-- 빠뜨리면 그 순간 전체가 노출된다. RLS 위에 서면 정책이 DB 에서 한 번 더 막는다.
--
-- 신원을 JWT 클레임(app_metadata.role)이 아니라 **표**로 두는 이유:
--   1) 회수 지연 — 클레임은 토큰 발급 시점에 굳는다. 권한을 뺏어도 그 사람이 들고 있는 액세스 토큰이 만료될 때까지 유효하다.
--      표는 `delete from admin_users where …` 한 줄로 다음 쿼리부터 즉시 막힌다.
--   2) 감사 불가 — 누가 관리자인지 DB 에 물어볼 수 없다. 표는 select 한 번이면 명단이 나온다(서비스 롤로만).
--   3) 발급 경로 — 클레임을 심으려면 Auth 관리 API 나 훅이 필요하고, 그 경로 자체가 또 하나의 권한 상승 표면이다.
--
-- 관리자도 admin_users 를 **읽지 못한다**(RLS enable + 정책 0개 + authenticated 에 GRANT 없음). 명단을 읽을 수 있으면
-- 그것이 곧 다음 단계의 권한 상승 정보다. 명단은 서비스 롤(= 컨트롤러의 부트스트랩)만 다룬다.
--
-- 정책은 전부 `to authenticated` 다. 빼면 anon 요청도 이 정책을 평가하게 되는데, anon 에게는 is_admin() 실행 권한이 없어
-- "permission denied for function is_admin" 으로 **공개 사이트의 조회가 통째로 죽는다**. 0001·0004·0008 의 공개 정책
-- (`*_select_active`)은 한 글자도 건드리지 않는다 — Postgres 의 permissive 정책은 OR 결합이라 추가만 하면 된다.
--
-- 기존 행 영향: 표 하나와 함수 하나를 더하고 정책을 추가할 뿐이다(컬럼·CHECK·인덱스 변경 0, 데이터 변경 0).
-- 롤백: supabase/rollbacks/0009_admin_rls.down.sql (수동 실행 전용 — migrations/ 밖에 두는 이유는 0005·0007·0008 롤백 헤더 참조).
-- 번호: 플랜 §4 — 0007 은 회수기, 0008 은 갤러리 앨범이 선점했고 admin_rls 가 0009.

-- =========================================================================
-- 1. admin_users — 관리자 명단. 이 표에 행이 있는 사용자만 관리자다.
--    user_id 가 auth.users 를 참조하고 on delete cascade 라 Auth 에서 사용자를 지우면 명단에서도 함께 사라진다
--    (지운 사용자가 명단에 유령으로 남아 같은 주소로 다시 가입했을 때 되살아나는 경로를 막는다).
--    email 은 사람이 명단을 읽기 위한 기록이다 — 판정은 언제나 user_id 로 한다(주소는 Auth 에서 바뀔 수 있다).
-- =========================================================================
create table if not exists admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,              -- 사람이 읽는 기록. 판정 키가 아니다
  note       text,                              -- 누구인지·언제 왜 넣었는지
  created_at timestamptz not null default now()
);

-- 정책 0개 = 서비스 롤만. 관리자도 이 표를 읽지 못한다(권한 상승 경로 차단).
alter table admin_users enable row level security;

-- 권한도 명시적으로 회수한다 (독립 리뷰 M1).
-- Supabase 는 public 스키마에 기본권한을 넓게 깔아 둔다 — anon·authenticated 는 마이그레이션이 GRANT 하지 않은 표에도
-- 이미 권한을 갖고 있다(lib/queries/* 가 GRANT 없이 읽히는 이유가 그것이다). 즉 "GRANT 를 안 줬으니 못 읽는다"는 틀렸고,
-- 이 표를 막는 것은 RLS 하나뿐이었다. 잠금을 둘로 만든다: RLS(정책 0개) + 권한 회수.
-- 명단은 서비스 롤만 다룬다(컨트롤러 부트스트랩) — 서비스 롤은 이 회수의 영향을 받지 않는다.
revoke all on table admin_users from anon, authenticated;

-- =========================================================================
-- 2. is_admin() — 정책이 부르는 판정 함수
--    security definer 인 이유: admin_users 는 RLS 가 켜져 있고 정책이 0개다. 호출자 권한으로 돌면 관리자 자신도
--    자기 행을 볼 수 없어 항상 false 가 된다. 함수 소유자 권한으로 표를 보고 boolean 하나만 돌려준다 — 명단은 새지 않는다.
--    search_path 고정: security definer 함수의 표준 방어(악의적 스키마 섀도잉 차단). 0005·0007 과 같은 규약.
--    `pg_temp` 를 **끝에 명시**하는 이유(독립 리뷰 M3): 목록에서 빼면 Postgres 가 pg_temp 를 암묵적으로 **맨 앞**에서 찾는다.
--    임시 스키마에는 어떤 롤이든 객체를 만들 수 있으므로, 이름이 겹치는 함수·연산자를 심어 definer 권한으로 실행시킬 여지가 남는다.
--    끝에 적으면 검색 순서가 public → pg_temp 로 고정된다. 이 함수의 반환값이 곧 인가 판정이라 가장 보수적으로 간다.
--    stable: 한 문장 안에서 여러 행을 검사할 때 재평가하지 않아도 된다(정책은 행마다 평가된다).
-- =========================================================================
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from admin_users where user_id = auth.uid());
$$;

-- 실행 권한 — security definer 함수는 기본으로 public 에 execute 가 열린다. 로그인한 사용자에게만 남긴다.
-- anon 에게 주지 않는 것이 핵심이다: 주면 로그인하지 않은 누구나 /rpc/is_admin 을 두드릴 수 있고,
-- 무엇보다 아래 정책들이 anon 요청에서도 평가 가능해져 정책 범위 실수의 대가가 커진다.
revoke all on function is_admin() from public, anon;
grant execute on function is_admin() to authenticated;

-- =========================================================================
-- 3. reservations — select · update 만. insert·delete 정책은 만들지 않는다.
--    접수(insert)는 공개 폼의 서버액션이 서비스 롤로 하고(가드 4종을 통과한 뒤), 파기(delete)는 보유기간 크론이 한다.
--    관리자 화면에서 예약을 새로 만들거나 지울 이유가 없고, 지울 수 있으면 파기 기록과 어긋난 삭제가 생긴다.
-- =========================================================================
drop policy if exists reservations_admin_select on reservations;
create policy reservations_admin_select on reservations for select to authenticated using (is_admin());

drop policy if exists reservations_admin_update on reservations;
create policy reservations_admin_update on reservations for update to authenticated using (is_admin()) with check (is_admin());

-- =========================================================================
-- 4. notifications_log — select 만. 상태 전이(pending→sent/failed)는 0005·0007 의 security definer 함수 몫이다.
--    관리자가 직접 status 를 고칠 수 있으면 "보내지 않은 것을 보냈다고 적는" 경로가 열린다.
-- =========================================================================
drop policy if exists notifications_log_admin_select on notifications_log;
create policy notifications_log_admin_select on notifications_log for select to authenticated using (is_admin());

-- =========================================================================
-- 5. 콘텐츠 표 6개 — 전체 행 CRUD (비활성 행 포함)
--    공개 정책은 active 행만 보여 준다. 관리자는 비활성 행도 봐야 내리고 되살릴 수 있다.
--    with check 도 is_admin() 이어야 한다 — using 만 두면 관리자가 아닌 사용자가 새 행을 밀어 넣는 경로가 남는다.
-- =========================================================================
drop policy if exists notices_admin_all on notices;
create policy notices_admin_all on notices for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists popups_admin_all on popups;
create policy popups_admin_all on popups for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists gallery_admin_all on gallery;
create policy gallery_admin_all on gallery for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists gallery_albums_admin_all on gallery_albums;
create policy gallery_albums_admin_all on gallery_albums for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists showcase_routes_admin_all on showcase_routes;
create policy showcase_routes_admin_all on showcase_routes for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists vehicles_admin_all on vehicles;
create policy vehicles_admin_all on vehicles for all to authenticated using (is_admin()) with check (is_admin());

-- =========================================================================
-- 6. 표 권한 — 정책만으로는 부족하다. RLS 는 "어느 행" 이고 GRANT 는 "어느 동작" 이다.
--    public 스키마 기본권한에 기대지 않고 명시한다(0008 §3 과 같은 이유). 필요한 만큼만:
--    reservations 에 delete 를 주지 않는 것은 위 정책과 같은 뜻을 권한 층에서 한 번 더 못박는 것이다.
-- =========================================================================
grant select, update on table reservations to authenticated;
grant select on table notifications_log to authenticated;
grant select, insert, update, delete on table notices, popups, gallery, gallery_albums, showcase_routes, vehicles to authenticated;

-- serial 기본키에 insert 하려면 시퀀스 사용 권한이 필요하다. 위에서 insert 를 허용한 표의 것만 준다.
grant usage, select on sequence
  notices_id_seq, popups_id_seq, gallery_id_seq, gallery_albums_id_seq, showcase_routes_id_seq, vehicles_id_seq
  to authenticated;

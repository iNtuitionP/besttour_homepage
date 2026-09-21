-- 0020_admin_content_writes.sql — 관리자 콘텐츠 쓰기를 definer 함수로 옮기고 `authenticated` 의 표 쓰기 권한을 회수한다
--                                 (플랜 v4 P5-16 · ADR-2 · known-defects **D10**)
--
-- ## 왜 이 파일이 생겼나 — D10
-- PostgreSQL 은 `ACCESS EXCLUSIVE` 같은 강한 표 잠금을 **`MAINTAIN` · `UPDATE` · `DELETE` · `TRUNCATE` 중 하나**로 허용한다
-- (`src/backend/commands/lockcmds.c` `LockTableAclCheck` — 약한 모드에만 SELECT·INSERT 가 더해진다).
-- 0019 가 `MAINTAIN` 을 회수했지만 `authenticated` 는 **관리자 화면 때문에** 콘텐츠 여섯 표
-- (`notices`·`popups`·`gallery`·`gallery_albums`·`showcase_routes`·`vehicles`)에 `UPDATE`·`DELETE` 를 표 단위로 갖고 있었다.
-- 그래서 **로그인만 하면(관리자 명단에 없어도)** `lock table notices in access exclusive mode` 로 공개 화면과 관리자 화면을
-- 동시에 멈출 수 있었다. 적용 직전 로컬 실측(2026-09-21): 여섯 표 전부 `authenticated` 로 **잠금 성공**.
-- **RLS 는 이것을 막지 못한다** — RLS 는 "어느 행", GRANT 는 "어느 동작"이고, 잠금은 행을 보지 않는다.
--
-- 지금까지의 결정은 **C(기록하고 둠)** 였고 근거는 "공개 가입이 막혀 있으니 `authenticated` = 관리자 명단"(D2)이었다.
-- **사장님 지시로 선택지 A 를 구현한다**: 관리자 쓰기를 definer 함수로 옮기고 표 쓰기 권한을 회수한다.
-- 그러면 전제(D2)가 깨져도 — 공개 가입이 다시 열려도 — 이 문은 닫혀 있다. 방어선이 "전제 하나"에서 "권한 층"으로 옮겨 간다.
--
-- ## 규범은 0010 이다
-- 0010(`admin_reservation_actions`)이 예약 표에서 이미 같은 일을 했다: definer 함수 + 첫 문장 `is_admin()` 가드 +
-- 정책 삭제 + GRANT 회수. 이 파일은 그 논리를 콘텐츠 여섯 표에 그대로 옮긴다.
-- 다른 점은 **경합이 아니라 잠금**이 동기라는 것이다. 그래서 함수는 상태 전이표를 만들지 않는다 —
-- 콘텐츠는 "마지막 저장이 이긴다" 가 옳은 표이고(lib/admin/notices.ts 헤더), 이 파일은 그 의미를 바꾸지 않는다.
--
-- ## 함수 18개 — **화면이 실제로 하는 쓰기만**
-- 목록은 저장소 실측으로 확정했다(lib/admin/{notices,popups,gallery,routes}.ts 의 `.insert`/`.update`/`.delete` 전수).
--   공지  4 — create · update · delete · set_active
--   팝업  4 — create · update · delete · set_active
--   사진  4 — create · update(캡션·앨범·순서) · set_active · delete
--   앨범  4 — create · update · set_active · delete
--   노선  2 — update · set_active   (**만들기·지우기가 없다** — 16행은 스펙 §13.2 가 고정한 집합이고 lib/admin/routes.ts 에 경로가 없다)
--   차량  0 — **관리자 쓰기 경로가 저장소에 하나도 없다**(읽기는 lib/queries/vehicles.ts). 함수를 만들지 않고 회수만 한다.
--
-- **컬럼 화이트리스트** = 함수의 인자. 0010 이 `retention_until`·`privacy_consent_at` 을 못 건드리게 한 것과 같은 이유로
-- `id`·`created_at`·`highlight`(스펙이 정한 값)·`gallery_albums.description`(화면에 입력란이 없다)은 **받지 않는다.**
-- `notices.published_at` 은 받는다 — 화면의 입력 항목이다(0004 의 KST 기본값은 그 컬럼의 default 로 남아 있다).
--
-- **반환은 `table (id integer)` — 바뀐 행의 id 한 줄, 없으면 0행.** 앱이 "0행이면 실패" 로 판정하는 현재 의미
-- (lib/admin/notices.ts `changedRows`)를 글자 그대로 유지하기 위해서다. 상태 코드가 아니라 결과로 판정한다.
--
-- **가드**: 모든 함수의 첫 문장이 `is_admin()` 이다. security definer 는 **RLS 를 우회하므로**(소유자 `postgres` 는
-- FORCE RLS 가 아닌 표에서 정책을 평가받지 않는다) 실행 권한만 있으면 정책은 아무것도 막아 주지 않는다.
-- `grant execute … to authenticated` 인 이상 가드가 **유일한 방어선**이다 — 0010 §헤더와 같은 말이다.
-- 가드 문구는 0010 과 같은 `'<함수>: 관리자 명단에 없는 호출자다'` 이고, 앱(lib/admin/adminRpc.ts)이 이 문구로
-- **가드 거부**와 **EXECUTE 거부**(둘 다 42501 이다)를 가른다. 문구를 바꾸면 앱의 "권한 없음" 경로가 오류 경로로 바뀐다.
--
-- `search_path = public, pg_temp` 이고 **pg_temp 가 끝**이다(0009 §2 · 0010 과 같은 규약 — 임시 스키마 섀도잉 차단).
-- **`drop function` 을 쓰지 않는다**: drop 후 create 는 EXECUTE 를 공개 롤에 다시 열어 준다(CLAUDE.md §3).
-- 새로 만드는 함수라도 `pg_default_acl` 이 `anon`·`authenticated`·`postgres`·`service_role` 넷에 EXECUTE 를 주므로
-- §5 가 **명시적으로** 회수하고 `authenticated` 에만 다시 준다.
--
-- ## 0009 의 `*_admin_all` 정책을 `*_admin_select` 로 좁힌다 (§6)
-- GRANT 가 없어지면 `for all` 의 쓰기 부분은 **닿을 수 없는 죽은 정책**이 된다(권한 검사가 정책 평가보다 먼저다).
-- 죽은 채로 두면 나중에 누가 표 GRANT 를 한 줄 되살렸을 때 **쓰기가 조용히 함께 열린다.** 0010 이 `reservations_admin_update`
-- 를 지운 것과 같은 판단이다 — "정책과 권한 둘 다".
-- **관리자의 SELECT 는 반드시 남긴다**: 공개 정책(`*_select_active`)은 활성 행만 보여 주므로, 내린 공지·비공개 사진을
-- 되살리려면 관리자가 먼저 그것을 봐야 한다. 그래서 같은 조건(`is_admin()`)의 `for select` 정책으로 교체한다.
-- 이름을 `*_admin_select` 로 바꾸는 이유: `_admin_all` 이라는 이름으로 select 전용 정책을 두면 다음 사람이 파일을 열기 전에
-- 틀린 뜻을 읽는다. 0009 의 `reservations_admin_select`·`notifications_log_admin_select` 와 같은 이름 규칙이다.
--
-- ## 회수하는 것 (§7 ①)
--   콘텐츠 여섯 표에서 `authenticated` 의 **`insert`·`update`·`delete`**. 표 이름은 **명시 목록**으로 적는다 —
--   카탈로그 열거는 "새로 생긴 표까지 대상" 이 옳을 때(0019 의 MAINTAIN) 쓰는 방식이고, 여기서는 그 반대다:
--   대상은 "관리자 화면이 쓰던 여섯 표" 라는 **고정된 사실**이고, 앞으로 생길 표의 권한은 그 표를 만든 마이그레이션이 정한다.
--   열거로 적으면 `places`(쓰기 정책이 없다)·`admin_users`(0009 가 revoke all) 처럼 이미 다른 파일이 정리한 표를 다시 훑고,
--   무엇보다 **이 파일이 무엇을 닫았는지** 파일만 읽어서는 알 수 없게 된다.
--
-- ## 회수하지 않는 것
--   · **`select`** — 관리자 화면이 내린 행까지 읽는다(§7 ②). `anon` 의 select 는 공개 화면이 읽는다.
--   · **`truncate`** — 0016 이 이미 두 공개 롤에서 회수했다. 중복 회수하지 않고 §7 ① 이 **확인만** 한다.
--   · **`service_role`·`postgres`** — 불변(§7 ③). 서비스 롤은 접수·통지·파기의 경로이고 소유자 권한은 회수 대상이 아니다.
--   · **시퀀스 `usage`** — 0018 이 남긴 `authenticated` 의 여섯 시퀀스 usage 는 이 파일 뒤로 **쓸 일이 없어진다**
--     (표 insert 가 없으니 serial 기본값의 nextval 도 호출되지 않는다. definer 함수는 소유자 권한으로 돈다).
--     그래도 이 파일은 건드리지 않는다: 시퀀스 usage 로는 표를 잠글 수 없어 D10 과 무관하고, 권한 변경은 한 번에 한 가지
--     이유만 담는 편이 롤백 판단을 쉽게 한다. **후속으로 남긴다**(docs/ops/migration-runbook.md 0020 절 「남은 것」).
--   · **`places`·개인정보 두 표·`admin_users`** — 이름조차 꺼내지 않는다(0012·0013·0016·0017 소관).
--
-- 기존 행 영향: 함수 18개 추가 · 정책 6개 교체(`for all` → `for select`, 조건 동일) · 권한 18건(6표 × 3동작) 회수.
--   컬럼·CHECK·인덱스·트리거 변경 0, **데이터 변경 0**.
--   자기검증 ⑦ 의 거동 탐침은 `LOCK TABLE … NOWAIT` 를 **거부를 기대하는 조합에서만** 치고, 시도 직전에 그 롤이 그 표에
--   SELECT 외의 권한을 하나라도 갖고 있으면 **시도하지 않고 멈춘다**(0019 ⑥ 과 같은 사전 검사 — 권한 검사가 잠금 획득보다
--   먼저 일어나므로 이 검사를 통과한 조합은 잠금을 얻을 수 없다). 대조군은 **일회용 표**이고 서브트랜잭션째 되돌린다.
--   잠금이 권한 검사보다 먼저인 문장(CREATE TRIGGER 등)은 실제 표에 치지 않는다(P5-15 R3).
-- 재실행 안전: `create or replace` · `drop policy if exists` · `revoke`(없는 권한을 회수해도 오류가 아니다).
--   ④ 의 대조는 "이번 실행 전후" 이므로 재실행에서도 성립한다(두 번째 실행의 diff 는 빈 집합이다).
-- PostgREST 스키마 캐시: 함수를 새로 만들므로 캐시 갱신이 필요하다. 이 DB 의 이벤트 트리거 `pgrst_ddl_watch` 가
--   `NOTIFY pgrst, 'reload schema'` 를 낸다(runbook 0019 절 「이벤트 트리거 확인」 — 원격에도 같은 본문임을 실측했다).
-- 적용 경로: **`supabase db push` 만**(runbook 「적용 경로」). **`psql -f` 를 쓰지 마라** — 파일이 원자적이지 않다(P4-5 리뷰 K1).
--   로컬 검증은 `psql -1`(단일 트랜잭션).
-- ⚠️ 자기검증 ⑦ 이 `set local role` 로 롤을 바꾼다 — 적용 롤이 `anon`·`authenticated` 의 멤버여야 한다(0017·0018·0019 와 같다).
--    탐침 뒤에는 `reset role` 이 아니라 **시작할 때 캡처한 적용 롤**로 `set local role` 해서 돌아온다.
-- ⚠️ ⑦ 의 대조군은 `public.p0020_probe_tbl` 을 **만들었다 되돌린다**(커밋되지 않는다). 적용 롤에 public 스키마 CREATE 가 필요하다.
-- 🔴 **배포 순서**: 이 파일이 원격에 적용되기 **전에** 새 앱 코드를 배포하면 관리자 화면의 저장이 PGRST202(함수 없음)로 실패하고,
--    적용 뒤 옛 코드가 남아 있으면 저장이 42501(표 권한 없음)로 실패한다. **적용 → 배포** 순서를 지킨다(runbook 0020 절).
-- 롤백: supabase/rollbacks/0020_admin_content_writes.down.sql (수동 실행 전용 · 승인 플래그 요구).

-- lock_timeout 상한 (P5-15 R7): CLI 가 이 파일을 한 트랜잭션으로 돌려 set local 은 이 파일에만 걸린다 — 잠금을 5초 넘게 기다리면 파일째 롤백.
set local lock_timeout = '5s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception '0020: 앞 문장의 set local lock_timeout 이 남지 않았다 (지금 %) — 파일이 한 트랜잭션으로 돌지 않는 경로다. 아무것도 바꾸기 전에 멈춘다', current_setting('lock_timeout')
      using hint = 'supabase db push 로 적용할 것(파일 하나 = 트랜잭션 하나). psql -f 처럼 문장마다 커밋하는 경로에서는 set local 이 그 문장에서 끝난다(PostgreSQL 은 경고만 낸다).';
  end if;
end
$$;

-- =========================================================================
-- 1. 공지 (notices) — lib/admin/notices.ts 의 네 쓰기
--    화이트리스트: title · body · category · published_at · active. id 는 받지 않고(만들기), created_at 컬럼이 없다.
-- =========================================================================
create or replace function admin_create_notice(p_title text, p_body text, p_category text, p_published_at date, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_create_notice: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  insert into notices (title, body, category, published_at, active)
  values (p_title, p_body, p_category, p_published_at, p_active)
  returning notices.id into v_id;

  return query select v_id;
end;
$$;

create or replace function admin_update_notice(p_id integer, p_title text, p_body text, p_category text, p_published_at date, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_update_notice: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update notices set title = p_title, body = p_body, category = p_category, published_at = p_published_at, active = p_active
   where notices.id = p_id
  returning notices.id into v_id;

  -- 없는 id 는 오류가 아니라 0행이다 — 앱이 "그런 행이 없다" 로 읽는 현재 의미 그대로.
  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

create or replace function admin_delete_notice(p_id integer)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_delete_notice: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  delete from notices where notices.id = p_id returning notices.id into v_id;
  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

create or replace function admin_set_notice_active(p_id integer, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_set_notice_active: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  -- 노출/중지만 — 나머지 컬럼은 건드리지 않는다(목록에서 한 번에 내리기 위한 좁은 쓰기).
  update notices set active = p_active where notices.id = p_id returning notices.id into v_id;
  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

-- =========================================================================
-- 2. 팝업 (popups) — lib/admin/popups.ts 의 네 쓰기
--    화이트리스트: title · body · image_path · starts_at · ends_at · active. created_at 은 DB default 다.
-- =========================================================================
create or replace function admin_create_popup(p_title text, p_body text, p_image_path text, p_starts_at date, p_ends_at date, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_create_popup: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  insert into popups (title, body, image_path, starts_at, ends_at, active)
  values (p_title, p_body, p_image_path, p_starts_at, p_ends_at, p_active)
  returning popups.id into v_id;

  return query select v_id;
end;
$$;

create or replace function admin_update_popup(p_id integer, p_title text, p_body text, p_image_path text, p_starts_at date, p_ends_at date, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_update_popup: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update popups set title = p_title, body = p_body, image_path = p_image_path, starts_at = p_starts_at, ends_at = p_ends_at, active = p_active
   where popups.id = p_id
  returning popups.id into v_id;

  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

create or replace function admin_delete_popup(p_id integer)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_delete_popup: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  delete from popups where popups.id = p_id returning popups.id into v_id;
  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

create or replace function admin_set_popup_active(p_id integer, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_set_popup_active: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update popups set active = p_active where popups.id = p_id returning popups.id into v_id;
  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

-- =========================================================================
-- 3. 갤러리 사진 (gallery) — lib/admin/gallery.ts 의 네 쓰기
--    파일은 브라우저가 올리고(ADR-9) 서버는 행만 만든다. created_at 은 DB default(P6-1 §7-1).
--    고치기는 캡션·앨범·순서만 받는다 — 파일 경로를 바꾸는 경로는 화면에 없다(앨범 이동이 UPDATE 한 줄인 이유).
-- =========================================================================
create or replace function admin_create_gallery_photo(
  p_image_path text, p_original_path text, p_width integer, p_height integer, p_bytes integer,
  p_album_id integer, p_caption text, p_sort integer, p_active boolean
)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_create_gallery_photo: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  insert into gallery (image_path, original_path, width, height, bytes, album_id, caption, sort, active)
  values (p_image_path, p_original_path, p_width, p_height, p_bytes, p_album_id, p_caption, p_sort, p_active)
  returning gallery.id into v_id;

  return query select v_id;
end;
$$;

create or replace function admin_update_gallery_photo(p_id integer, p_caption text, p_album_id integer, p_sort integer)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_update_gallery_photo: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update gallery set caption = p_caption, album_id = p_album_id, sort = p_sort
   where gallery.id = p_id
  returning gallery.id into v_id;

  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

create or replace function admin_set_gallery_photo_active(p_id integer, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_set_gallery_photo_active: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update gallery set active = p_active where gallery.id = p_id returning gallery.id into v_id;
  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

create or replace function admin_delete_gallery_photo(p_id integer)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_delete_gallery_photo: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  -- 파일은 호출부가 먼저 지운다(actions/admin/gallery.ts deleteGalleryPhoto). 여기서 Storage 를 건드리지 않는다.
  delete from gallery where gallery.id = p_id returning gallery.id into v_id;
  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

-- =========================================================================
-- 4. 갤러리 앨범 (gallery_albums) — lib/admin/gallery.ts 의 네 쓰기
--    화이트리스트: slug · title · sort · active. `description` 은 화면에 입력란이 없어 받지 않는다.
--    삭제는 0008 의 FK(on delete set null)와 0015 의 before delete 트리거를 그대로 태운다 —
--    사진은 지워지지 않고 미분류로 남으며, 앨범이 비활성이었으면 그 안의 사진이 함께 내려간다.
-- =========================================================================
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

create or replace function admin_set_album_active(p_id integer, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_set_album_active: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update gallery_albums set active = p_active where gallery_albums.id = p_id returning gallery_albums.id into v_id;
  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

create or replace function admin_delete_album(p_id integer)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_delete_album: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  -- 사진 행이나 파일을 함께 지우지 않는다 — 앨범 하나로 사진 수백 장이 사라지는 경로를 만들지 않는다.
  delete from gallery_albums where gallery_albums.id = p_id returning gallery_albums.id into v_id;
  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

-- =========================================================================
-- 5. 대표 노선 (showcase_routes) — lib/admin/routes.ts 의 두 쓰기
--    **만들기·지우기 함수가 없다.** 16행은 스펙 §13.2 가 고정한 집합이고, 0002 가 출발·도착을 `places(code)` 에 FK 로 묶었다.
--    화이트리스트: origin_code · destination_code · price_from · sort · active. `highlight` 는 받지 않는다(스펙이 정한 값).
--    같은 쌍이 이미 있으면 0001 의 unique 제약이 23505 를 던진다 — **잡지 않는다.** 앱이 그것을 "중복" 으로 읽어
--    사장님이 고칠 수 있는 오류로 보여 준다(lib/admin/routes.ts RouteWriteOutcome).
--    가격은 나르기만 한다 — 계산·변환·포맷 0(CLAUDE.md §3).
-- =========================================================================
create or replace function admin_update_route(p_id integer, p_origin_code text, p_destination_code text, p_price_from integer, p_sort integer, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_update_route: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update showcase_routes set origin_code = p_origin_code, destination_code = p_destination_code,
                             price_from = p_price_from, sort = p_sort, active = p_active
   where showcase_routes.id = p_id
  returning showcase_routes.id into v_id;

  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

create or replace function admin_set_route_active(p_id integer, p_active boolean)
returns table (id integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id integer;
begin
  if not is_admin() then
    raise exception 'admin_set_route_active: 관리자 명단에 없는 호출자다' using errcode = '42501';
  end if;

  update showcase_routes set active = p_active where showcase_routes.id = p_id returning showcase_routes.id into v_id;
  if not found then
    return;
  end if;
  return query select v_id;
end;
$$;

-- =========================================================================
-- 6. 실행 권한 — 0010 §5 와 같은 규약.
--    security definer 함수는 기본으로 PUBLIC 에 EXECUTE 가 열리고, 이 DB 의 `pg_default_acl` 은 `anon`·`authenticated`·
--    `postgres`·`service_role` 넷에게도 준다(CLAUDE.md §3). 명시적으로 회수하고 `authenticated` 에만 다시 준다.
--    **`anon`**: 로그인하지 않은 요청이 /rpc/admin_* 을 두드릴 수 있으면 안 된다.
--    **`service_role`**: 콘텐츠를 배치로 고치는 경로는 없어야 한다 — 고치는 것은 사람이고, 그 사람이 명단에 있는지 함수가 본다.
--      (서비스 롤로 불러도 auth.uid() 가 없어 is_admin() 이 false 지만, 권한 층에서 한 번 더 못박는다.)
-- =========================================================================
revoke all on function admin_create_notice(text, text, text, date, boolean) from public, anon, service_role;
revoke all on function admin_update_notice(integer, text, text, text, date, boolean) from public, anon, service_role;
revoke all on function admin_delete_notice(integer) from public, anon, service_role;
revoke all on function admin_set_notice_active(integer, boolean) from public, anon, service_role;
revoke all on function admin_create_popup(text, text, text, date, date, boolean) from public, anon, service_role;
revoke all on function admin_update_popup(integer, text, text, text, date, date, boolean) from public, anon, service_role;
revoke all on function admin_delete_popup(integer) from public, anon, service_role;
revoke all on function admin_set_popup_active(integer, boolean) from public, anon, service_role;
revoke all on function admin_create_gallery_photo(text, text, integer, integer, integer, integer, text, integer, boolean) from public, anon, service_role;
revoke all on function admin_update_gallery_photo(integer, text, integer, integer) from public, anon, service_role;
revoke all on function admin_set_gallery_photo_active(integer, boolean) from public, anon, service_role;
revoke all on function admin_delete_gallery_photo(integer) from public, anon, service_role;
revoke all on function admin_create_album(text, text, integer, boolean) from public, anon, service_role;
revoke all on function admin_update_album(integer, text, text, integer, boolean) from public, anon, service_role;
revoke all on function admin_set_album_active(integer, boolean) from public, anon, service_role;
revoke all on function admin_delete_album(integer) from public, anon, service_role;
revoke all on function admin_update_route(integer, text, text, integer, integer, boolean) from public, anon, service_role;
revoke all on function admin_set_route_active(integer, boolean) from public, anon, service_role;

grant execute on function admin_create_notice(text, text, text, date, boolean) to authenticated;
grant execute on function admin_update_notice(integer, text, text, text, date, boolean) to authenticated;
grant execute on function admin_delete_notice(integer) to authenticated;
grant execute on function admin_set_notice_active(integer, boolean) to authenticated;
grant execute on function admin_create_popup(text, text, text, date, date, boolean) to authenticated;
grant execute on function admin_update_popup(integer, text, text, text, date, date, boolean) to authenticated;
grant execute on function admin_delete_popup(integer) to authenticated;
grant execute on function admin_set_popup_active(integer, boolean) to authenticated;
grant execute on function admin_create_gallery_photo(text, text, integer, integer, integer, integer, text, integer, boolean) to authenticated;
grant execute on function admin_update_gallery_photo(integer, text, integer, integer) to authenticated;
grant execute on function admin_set_gallery_photo_active(integer, boolean) to authenticated;
grant execute on function admin_delete_gallery_photo(integer) to authenticated;
grant execute on function admin_create_album(text, text, integer, boolean) to authenticated;
grant execute on function admin_update_album(integer, text, text, integer, boolean) to authenticated;
grant execute on function admin_set_album_active(integer, boolean) to authenticated;
grant execute on function admin_delete_album(integer) to authenticated;
grant execute on function admin_update_route(integer, text, text, integer, integer, boolean) to authenticated;
grant execute on function admin_set_route_active(integer, boolean) to authenticated;

-- =========================================================================
-- 7. 0009 의 `*_admin_all` → `*_admin_select` (헤더 「0009 의 정책」)
--    조건(`is_admin()`)은 그대로다. 바뀌는 것은 **어느 동작에 걸리는가** 뿐이다.
--    공개 정책(`*_select_active`)은 한 글자도 건드리지 않는다 — permissive 정책은 OR 로 결합된다.
-- =========================================================================
drop policy if exists notices_admin_all on notices;
drop policy if exists notices_admin_select on notices;
create policy notices_admin_select on notices for select to authenticated using (is_admin());

drop policy if exists popups_admin_all on popups;
drop policy if exists popups_admin_select on popups;
create policy popups_admin_select on popups for select to authenticated using (is_admin());

drop policy if exists gallery_admin_all on gallery;
drop policy if exists gallery_admin_select on gallery;
create policy gallery_admin_select on gallery for select to authenticated using (is_admin());

drop policy if exists gallery_albums_admin_all on gallery_albums;
drop policy if exists gallery_albums_admin_select on gallery_albums;
create policy gallery_albums_admin_select on gallery_albums for select to authenticated using (is_admin());

drop policy if exists showcase_routes_admin_all on showcase_routes;
drop policy if exists showcase_routes_admin_select on showcase_routes;
create policy showcase_routes_admin_select on showcase_routes for select to authenticated using (is_admin());

drop policy if exists vehicles_admin_all on vehicles;
drop policy if exists vehicles_admin_select on vehicles;
create policy vehicles_admin_select on vehicles for select to authenticated using (is_admin());

-- =========================================================================
-- 8. 회수 + 자기검증 (0016~0019 규범 — 회수를 검증 블록 안에서 한다.
--    그래야 ④ 가 "이번 실행 직전" 의 ACL 전수를 실제로 스냅샷할 수 있다.)
-- =========================================================================
do $$
declare
  applier    constant text := current_user;
  tbls       constant text[] := array['notices', 'popups', 'gallery', 'gallery_albums', 'showcase_routes', 'vehicles'];
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
  -- ④ 의 "적용 전" — public 스키마 모든 표·뷰·시퀀스의 ACL 항목 전부(종류 불문 · aclexplode 로 열거)에서
  --   **이 파일이 바꾸는 것(콘텐츠 여섯 × authenticated × insert/update/delete)만 뺀** 집합. 컬럼 ACL 도 함께 본다.
  select coalesce(array_agg(x order by x), '{}') into before_acl from (
    select format('%s|%s|%s|%s|%s', c.relname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable) as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
       and not (a.privilege_type in ('INSERT', 'UPDATE', 'DELETE') and a.grantee = to_regrole('authenticated') and c.relname = any (tbls))
    union all
    select format('%s.%s|%s|%s|%s|%s', c.relname, at.attname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable)
      from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(at.attacl) a
     where n.nspname = 'public' and at.attacl is not null
  ) s;
  -- ③ 의 "적용 전" — service_role·postgres 가 콘텐츠 여섯 표에서 갖는 **모든 종류**의 권한(종류는 카탈로그에서 열거).
  select coalesce(array_agg(x order by x), '{}') into before_svc from (
    select format('%s|%s|%s|%s', r.role, c.relname, d.privilege_type, has_table_privilege(r.role, c.oid, d.privilege_type)) as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('service_role'), ('postgres')) r(role)
      cross join lateral aclexplode(acldefault('r', c.relowner)) d
     where n.nspname = 'public' and c.relname = any (tbls)
  ) s;

  -- 회수 — 대상 표는 명시 목록(헤더 「회수하는 것」). `anon` 은 0013·0016 이 이미 가져갔다(① 이 확인한다).
  execute 'revoke insert, update, delete on table notices, popups, gallery, gallery_albums, showcase_routes, vehicles from authenticated';

  -- ⓪ PUBLIC(grantee 0)에 콘텐츠 여섯 표의 권한이 있는가 — **① 보다 먼저 본다**(0019 ③ 의 교훈).
  --    has_table_privilege 는 PUBLIC 상속을 잡으므로, PUBLIC 에 grant 가 있으면 ① 이 "authenticated → x" 로 보고하고
  --    그 메시지대로 authenticated 에서 회수해도 아무것도 바뀌지 않는다.
  select string_agg(format('%s/%s', c.relname, lower(a.privilege_type)), ', ' order by c.relname, a.privilege_type)
    into leaked
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where n.nspname = 'public' and c.relname = any (tbls) and a.grantee = 0;
  if leaked is not null then
    raise exception '0020: 콘텐츠 표에 PUBLIC 권한이 부여돼 있다 — %', leaked
      using hint = 'PUBLIC 에 준 권한은 anon·authenticated 가 상속한다. 롤을 지정한 회수로는 지워지지 않는다 — 대상을 PUBLIC 으로 지정해 따로 회수할 것.';
  end if;

  -- ① 콘텐츠 여섯 표에서 두 공개 롤이 갖는 것은 **SELECT 뿐**이다.
  --    권한 종류는 `acldefault` 에서 **열거**한다(하드코딩 금지 — CLAUDE.md §3). 그래서 insert·update·delete 는 물론
  --    TRUNCATE(0016)·MAINTAIN(0019)·TRIGGER·REFERENCES 까지 한 번에 본다. 강한 잠금을 허용하는 네 권한이 전부 여기 걸린다.
  select string_agg(format('%s → %s/%s', r.role, c.relname, lower(d.privilege_type)), ', ' order by c.relname, r.role, d.privilege_type)
    into leaked
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) r(role)
    cross join lateral aclexplode(acldefault('r', c.relowner)) d
   where n.nspname = 'public' and c.relname = any (tbls)
     and d.privilege_type <> 'SELECT'
     and has_table_privilege(r.role, c.oid, d.privilege_type);
  if leaked is not null then
    raise exception '0020: 콘텐츠 표에 공개 롤의 SELECT 아닌 권한이 남았다 — %', leaked
      using hint = '원인을 순서대로 볼 것: ① 회수 문장의 표 목록이 빠졌다 ② 다른 부여자(supabase_admin 등)가 준 grant 가 있다 — revoke 는 실행 롤이 부여한 것만 지운다(`select a.grantor::regrole, a.grantee::regrole, a.privilege_type from pg_class c cross join lateral aclexplode(c.relacl) a where c.relname = <표>`) ③ 공개 롤이 그 권한을 가진 다른 롤의 멤버다. UPDATE·DELETE·TRUNCATE·MAINTAIN 중 하나라도 남으면 LOCK TABLE … ACCESS EXCLUSIVE 로 공개 화면과 관리자 화면을 멈출 수 있고 RLS 는 그것을 막지 못한다(known-defects D10).';
  end if;

  -- ② SELECT 는 살아 있다 — 관리자는 내린 공지·비공개 사진을 봐야 되살릴 수 있고, 공개 화면은 활성 행을 읽는다.
  select string_agg(format('%s → %s', r.role, c.relname), ', ' order by c.relname, r.role)
    into leaked
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) r(role)
   where n.nspname = 'public' and c.relname = any (tbls)
     and not has_table_privilege(r.role, c.oid, 'select');
  if leaked is not null then
    raise exception '0020: 콘텐츠 표의 SELECT 가 사라졌다 — %', leaked
      using hint = '회수 문장에 select 가 섞였다. 이 파일은 insert·update·delete 만 회수한다 — select 가 없으면 공개 화면이 비고 관리자가 내린 행을 되살릴 수 없다.';
  end if;

  -- ③ service_role·postgres 불변.
  select coalesce(array_agg(x order by x), '{}') into after_svc from (
    select format('%s|%s|%s|%s', r.role, c.relname, d.privilege_type, has_table_privilege(r.role, c.oid, d.privilege_type)) as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('service_role'), ('postgres')) r(role)
      cross join lateral aclexplode(acldefault('r', c.relowner)) d
     where n.nspname = 'public' and c.relname = any (tbls)
  ) s;
  if after_svc is distinct from before_svc then
    select string_agg(x, ', ') into diff from (
      select unnest(before_svc) except select unnest(after_svc)
    ) d(x);
    raise exception '0020: service_role·postgres 의 콘텐츠 표 권한이 바뀌었다 — 적용 전: %', diff
      using hint = '회수 문장의 롤 목록에 service_role 이나 postgres 가 섞였다. 이 파일은 authenticated 에서만 회수한다.';
  end if;

  -- ④ 다른 권한은 한 글자도 변하지 않았다 — 적용 전 집합과 적용 후 같은 질의가 같아야 한다(시퀀스·컬럼 ACL 포함).
  select coalesce(array_agg(x order by x), '{}') into after_acl from (
    select format('%s|%s|%s|%s|%s', c.relname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable) as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
       and not (a.privilege_type in ('INSERT', 'UPDATE', 'DELETE') and a.grantee = to_regrole('authenticated') and c.relname = any (tbls))
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
    raise exception '0020: 의도한 것(콘텐츠 여섯 × authenticated × insert/update/delete) 말고 다른 권한이 바뀌었다 — %', diff
      using hint = '표를 뭉뚱그리는 문장(revoke all 등)이나 다른 롤·다른 표가 섞였는지 볼 것. 표·컬럼·시퀀스 ACL 전수(종류 불문)를 적용 전후로 대조한 결과다.';
  end if;

  -- ⑤ 새 함수 18개 — 존재하고, EXECUTE 보유자가 `authenticated` 뿐이며(PUBLIC·anon·service_role 0),
  --    ⑥ `prosecdef` 이고 `search_path` 가 `public, pg_temp`(pg_temp 가 끝)다.
  select string_agg(x, ', ' order by x) into leaked from (
    select format('없다:%s', s.sig) as x
      from unnest(array[
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
      ]) s(sig)
     where to_regprocedure(s.sig) is null
    union all
    select format('%s 에 열림:%s', w.role, s.sig)
      from unnest(array[
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
      ]) s(sig)
      cross join (values ('anon'), ('service_role')) w(role)
     where to_regprocedure(s.sig) is not null and has_function_privilege(w.role, to_regprocedure(s.sig), 'execute')
    union all
    select format('authenticated 가 못 부른다:%s', s.sig)
      from unnest(array[
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
      ]) s(sig)
     where to_regprocedure(s.sig) is not null and not has_function_privilege('authenticated', to_regprocedure(s.sig), 'execute')
    union all
    select format('PUBLIC 에 열림:%s', s.sig)
      from unnest(array[
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
      ]) s(sig)
      join pg_proc p on p.oid = to_regprocedure(s.sig)
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    union all
    select format('definer·search_path 어긋남:%s (prosecdef=%s proconfig=%s)', s.sig, p.prosecdef, coalesce(array_to_string(p.proconfig, ' '), '(없음)'))
      from unnest(array[
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
      ]) s(sig)
      join pg_proc p on p.oid = to_regprocedure(s.sig)
     where not p.prosecdef or coalesce(array_to_string(p.proconfig, ' '), '') <> 'search_path=public, pg_temp'
  ) y;
  if leaked is not null then
    raise exception '0020: 새 함수의 상태가 기대와 다르다 — %', leaked
      using hint = 'create or replace 가 시그니처를 바꿨거나(인자 타입 한 글자), §6 의 revoke/grant 목록이 함수 목록과 어긋난다. 함수를 지웠다 다시 만들면 EXECUTE 가 공개 롤에 다시 열린다 — 이 파일은 그렇게 하지 않는다(CLAUDE.md §3). search_path 는 pg_temp 를 끝에 둔 `public, pg_temp` 여야 한다.';
  end if;

  -- ⑦ 정책 — 여섯 표에 `*_admin_select`(SELECT 전용, `to authenticated`)만 있고 `*_admin_all` 은 없다.
  --    공개 정책 `*_select_active` 는 그대로 있어야 한다(공개 화면이 그것으로 읽는다).
  select string_agg(x, ', ' order by x) into leaked from (
    select format('%s 에 관리자 select 정책이 없다', t) as x from unnest(tbls) t
     where not exists (
       select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relname = t and p.polname = t || '_admin_select' and p.polcmd = 'r'
          and 'authenticated' = any (select r.rolname from pg_roles r where r.oid = any (p.polroles))
     )
    union all
    select format('%s 에 옛 %s_admin_all 이 남았다', t, t) from unnest(tbls) t
     where exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = t and p.polname = t || '_admin_all')
    union all
    select format('%s 의 공개 정책 %s_select_active 가 사라졌다', t, t) from unnest(tbls) t
     where not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = t and p.polname = t || '_select_active')
    union all
    select format('%s 에 authenticated 쓰기 정책이 남았다: %s', c.relname, p.polname)
      from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = any (tbls) and p.polcmd <> 'r'
       and 'authenticated' = any (select r.rolname from pg_roles r where r.oid = any (p.polroles))
  ) y;
  if leaked is not null then
    raise exception '0020: 정책 상태가 기대와 다르다 — %', leaked
      using hint = '관리자 SELECT 정책이 없으면 사장님이 내린 공지·비공개 사진을 화면에서 볼 수 없어 되살릴 수 없다. 쓰기 정책이 남아 있으면 GRANT 를 한 줄 되살리는 순간 쓰기가 함께 열린다.';
  end if;

  -- ⑧ 거동 탐침 — 행렬로 끝내지 않는다. `set local role` 로 공개 롤이 되어 **실제로**
  --    `LOCK TABLE … ACCESS EXCLUSIVE MODE NOWAIT` 를 친다. 대상은 콘텐츠 여섯 × 두 공개 롤 전부(D10 의 정확한 표면).
  --
  --    🔴 **잠금 획득은 구조적으로 불가능해야 한다**(0019 ⑥ astra R2 P1-A 와 같은 규약 — 이 블록은 원격 적용 중에 실제 표를 대상으로 돈다).
  --    ① 이 이 블록보다 먼저 돌아 SELECT 아닌 권한이 남았으면 여기 오기 전에 멈춘다. 그래도 **시도 직전에 한 번 더**,
  --    그 롤이 그 표에 SELECT 말고 어떤 권한이든(종류는 acldefault 에서 열거) 갖고 있으면 **LOCK 을 시도하지 않고** 멈춘다.
  --    PostgreSQL 17 `LockTableAclCheck`(src/backend/commands/lockcmds.c)는 ACCESS EXCLUSIVE 에
  --    MAINTAIN|UPDATE|DELETE|TRUNCATE 중 하나를 요구하므로(SELECT·INSERT 는 약한 모드에만), 이 사전 검사를 통과한
  --    조합은 잠금을 **얻을 수 없다**. has_table_privilege 는 소유권·슈퍼유저·멤버십·PUBLIC 까지 반영한다.
  for probe in
    select r.role as who, c.oid::regclass as tbl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated')) r(role)
     where n.nspname = 'public' and c.relname = any (tbls)
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
      raise exception '0020: % 가 % 에 강한 잠금을 줄 수 있는 권한(%)을 갖고 있다 — 잠금을 시도하지 않고 멈춘다', probe.who, probe.tbl, leaked
        using hint = '① 의 행렬이 통과했는데 여기 걸렸다면 권한 판정 밖의 경로가 있다(롤 멤버십·다른 부여자·소유권). 실제 표에 잠금을 거는 시도는 하지 않았다.';
    end if;
    begin
      execute format('set local role %I', probe.who);
    exception when others then
      get stacked diagnostics st = returned_sqlstate, ms = message_text;
      raise exception '0020: 거동 탐침이 롤 %(으)로 전환하지 못했다 — % %', probe.who, st, ms
        using hint = '이 마이그레이션을 적용하는 롤이 anon·authenticated 의 멤버가 아니다. 보통 postgres(또는 supabase_admin)로 적용하며 그 롤은 둘 모두의 멤버다 — supabase db push 로 적용할 것. 조용히 건너뛰지 않는다.';
    end;
    if current_user <> probe.who then
      raise exception '0020: 거동 탐침의 롤 전환이 반영되지 않았다 (current_user=% · 기대=%)', current_user, probe.who;
    end if;

    ok := false;
    st := null;
    ms := null;
    begin
      execute format('lock table %s in access exclusive mode nowait', probe.tbl);
      ok := true;
      -- 통과했다면 잠금을 쥐고 있다 — 서브트랜잭션째 되돌려 즉시 푼다.
      raise exception using errcode = 'P0020', message = 'p0020 lock acquired — rolling back';
    exception
      when sqlstate 'P0020' then
        null;
      when others then
        get stacked diagnostics st = returned_sqlstate, ms = message_text;
    end;
    -- `reset role` 을 쓰지 않는다 — 세션 기본 롤로 돌아간다(0018 GPT 검증 P2). 캡처한 적용 롤로 명시 복원.
    execute format('set local role %I', applier);
    if current_user <> applier then
      raise exception '0020: 탐침 뒤 적용 롤(%)로 돌아오지 못했다 (current_user=%)', applier, current_user;
    end if;

    if ok then
      raise exception '0020: % 가 % 를 ACCESS EXCLUSIVE 로 잠글 수 있다 — D10 이 닫히지 않았다', probe.who, probe.tbl
        using hint = '이 잠금이 쥐어져 있는 동안 그 표의 모든 읽기·쓰기가 멈춘다 — 공개 화면과 관리자 화면이 함께 선다. ① 이 통과했는데 잠금이 된다면 권한 판정 밖의 경로가 있다(롤 멤버십·다른 부여자).';
    end if;
    if st is distinct from '42501' then
      raise exception '0020: 탐침이 권한 거부(42501)가 아닌 이유로 실패했다 — % → LOCK % : SQLSTATE=% MESSAGE=%', probe.who, probe.tbl, st, ms
        using hint = '거부는 됐지만 이유가 권한이 아니다(55P03 잠금 대기 실패 등). 그 상태에서는 "권한을 회수했다" 가 증명되지 않는다.';
    end if;
  end loop;
  if n_probes <> array_length(tbls, 1) * 2 then
    raise exception '0020: 거동 탐침 대상이 % 개다 — 콘텐츠 여섯 표 × 두 공개 롤 = % 개여야 한다', n_probes, array_length(tbls, 1) * 2
      using hint = '표가 사라졌거나 열거가 고장났다. 탐침이 공허하면 "거부됐다" 는 아무것도 증명하지 않는다.';
  end if;

  -- ⑧-대조군 — **같은 문장**이 UPDATE **하나만** 있을 때는 성공하는가. 없으면 "탐침 SQL 이 틀려서 실패" 와
  --    "권한이 없어서 거부" 가 구분되지 않는다(0017~0019 규범). UPDATE 를 고른 이유: D10 의 뿌리가 바로 그것이다.
  --    임시 표는 서브트랜잭션 안에서 만들고 끝에서 예외로 통째로 되돌린다 — 커밋되지 않는다.
  begin
    execute 'create table public.p0020_probe_tbl (id int)';
    -- PUBLIC 까지 회수한다 — 기본 PUBLIC 권한이 있으면 "UPDATE 하나로 성공" 이 다른 권한으로 성립한다.
    execute 'revoke all on table public.p0020_probe_tbl from public, anon, authenticated, service_role';
    execute 'grant update on table public.p0020_probe_tbl to authenticated';
    -- 의도한 유효 권한만 — authenticated 의 UPDATE 하나. 세 롤 × 열거한 표 권한 종류 전부를 본다.
    select string_agg(format('%s(%s)=%s', w.role, lower(d.privilege_type), has_table_privilege(w.role, 'public.p0020_probe_tbl', d.privilege_type)), ', ')
      into leaked
      from (values ('anon'), ('authenticated'), ('service_role')) w(role)
      cross join lateral aclexplode(acldefault('r', (select relowner from pg_class where oid = 'public.p0020_probe_tbl'::regclass))) d
     where has_table_privilege(w.role, 'public.p0020_probe_tbl', d.privilege_type)
           is distinct from (w.role = 'authenticated' and d.privilege_type = 'UPDATE');
    if leaked is not null then
      raise exception '0020: 대조군 일회용 표의 유효 권한이 의도와 다르다 — %', leaked
        using hint = 'PUBLIC 이나 기본 권한이 남아 있으면 대조군이 UPDATE 가 아닌 권한으로 성공한다. 회수 목록에 public 이 있는지 볼 것.';
    end if;
    execute 'set local role authenticated';
    if current_user <> 'authenticated' then
      raise exception '0020: 대조군의 롤 전환이 반영되지 않았다 (current_user=%)', current_user;
    end if;
    execute 'lock table public.p0020_probe_tbl in access exclusive mode nowait';
    execute format('set local role %I', applier);
    raise exception using errcode = 'P0020', message = 'p0020 control rollback';
  exception
    when sqlstate 'P0020' then
      control_ok := true;
    when others then
      get stacked diagnostics st = returned_sqlstate, ms = message_text;
      if ms like '0020:%' then
        raise exception '%', ms using hint = '대조군 준비 단계의 자기검증이 멈췄다(위 메시지).';
      end if;
      raise exception '0020: 대조군이 실패했다 — UPDATE 만 준 임시 표에서도 authenticated 의 LOCK 이 돌지 않았다 (SQLSTATE=% MESSAGE=%)', st, ms
        using hint = '탐침 SQL 자체가 틀렸거나 롤 전환이 되지 않는다. 대조군이 실패하면 ⑧ 의 "거부" 는 아무것도 증명하지 못한다 — 그래서 여기서 멈춘다. (UPDATE 하나로 ACCESS EXCLUSIVE 가 잡히는 것이 D10 의 뿌리다.)';
  end;
  if not control_ok then
    raise exception '0020: 대조군이 끝까지 돌지 않았다';
  end if;

  if current_user <> applier then
    raise exception '0020: 탐침이 롤을 되돌리지 못했다 (current_user=% · 기대=%)', current_user, applier
      using hint = '적용 롤 복원(set local role <적용 롤>)이 빠진 경로가 있는지 확인할 것. 롤 초기화 문(RESET)으로 바꾸면 안 된다 — 세션 기본 롤로 돌아간다.';
  end if;
  if to_regclass('public.p0020_probe_tbl') is not null then
    raise exception '0020: 대조군의 임시 표가 남았다'
      using hint = '대조군 서브트랜잭션이 되돌려지지 않았다. public.p0020_probe_tbl 을 직접 지울 것.';
  end if;

  raise notice '0020: 콘텐츠 여섯 표에서 authenticated 의 insert·update·delete 회수 완료 · definer 함수 18개 · 거동 탐침 %건 거부 확인 · 대조군 성공', n_probes;
end
$$;

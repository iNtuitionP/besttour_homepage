-- 0015_album_delete_keeps_visibility.down.sql — supabase/migrations/0015_album_delete_keeps_visibility.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005·0007·0008·0009·0010·0012·0013·0014 롤백 헤더와 같다). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0015
--
-- 이 롤백이 하는 일: 트리거와 트리거 함수를 지운다. 표·컬럼·행·FK·정책은 한 글자도 건드리지 않는다.
-- **이미 내려간 사진을 되살리지 않는다.** 트리거가 내린 `active = false` 는 사장님이 의도했던 "안 보이는 상태" 그대로이고,
-- 되살리면 이 파일이 되돌리려는 것보다 큰 사고(숨긴 사진 공개)가 된다. 되살릴 사진은 관리자 화면에서 한 장씩 고른다.
--
-- ## 승인 플래그를 요구한다 — 판단과 근거
-- 이 롤백은 **되살리는 방향이 위험한 종류가 아니다.** 지우는 것이 트리거 하나뿐이라 데이터가 사라지지 않고,
-- 잘못 눌러도 되돌리는 비용은 0015 를 다시 적용하는 것뿐이다. 그래서 0012·0013·0014 의 "무조건 요구" 를
-- **기계적으로 흉내 내지는 않았다.** 그럼에도 플래그를 두는 이유는 하나다:
--   **이 롤백이 되돌려 놓는 상태의 피해가 조용하다.** 트리거가 없어지면 사장님이 "안 보이게 해 둔" 앨범을 정리하는
--   그 동작이 **그 안의 사진을 손님에게 공개한다.** 오류도, 로그도, 화면의 변화도 없다 — 사장님은 지웠다고 생각하고
--   손님은 그 사진을 본다. 개인정보·초상이 담긴 사진일 수 있고, 그때는 되돌릴 수 없다.
--   "실행이 안전한가" 가 아니라 "실행한 뒤의 세계가 조용히 위험한가" 로 판정한다. 후자가 참이면 손이 미끄러져서는 안 된다.
-- 행 수는 보지 않는다(0012 독립 리뷰 M2 와 같은 근거) — 지금 비활성 앨범이 0개라는 것은 위험이 없다는 뜻이 아니라
-- **아직 없다**는 뜻이다. 앨범은 내일 만들어진다.
--
--   set bestour.rollback_0015_ack = '1';
--   \i supabase/rollbacks/0015_album_delete_keeps_visibility.down.sql
--
-- 재실행 가능(idempotent): drop 은 둘 다 if exists 다. 트리거가 함수보다 먼저 사라져야 한다(의존성) — 순서를 지킨다.

begin;

-- =========================================================================
-- 0. 안전장치 — 조건 없음. 승인 플래그가 없으면 언제나 멈춘다 (근거는 헤더)
-- =========================================================================
do $$
begin
  if coalesce(current_setting('bestour.rollback_0015_ack', true), '') <> '1' then
    raise exception '0015 롤백 중단: 노출을 꺼 둔 앨범을 지우면 그 안의 사진이 다시 손님에게 공개되는 상태로 돌아간다 — 오류도 로그도 없이 조용히 공개된다'
      using hint = '되돌릴 이유를 확인했으면 같은 세션에서 `set bestour.rollback_0015_ack = ''1'';` 을 실행한 뒤 다시 돌린다. 앨범을 감추는 것이 목적이면 삭제가 아니라 그 앨범의 노출 중지를 쓰시라고 안내할 것.';
  end if;
end
$$;

-- =========================================================================
-- 1. 트리거 → 함수 순서로 제거
-- =========================================================================
drop trigger if exists gallery_albums_keep_visibility_on_delete on gallery_albums;
drop function if exists gallery_album_delete_keep_visibility();

-- =========================================================================
-- 2. 검증 — 반쯤 지워진 상태(함수만 남거나 트리거만 남는 것)로 끝나지 않게 한다
-- =========================================================================
do $$
begin
  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.gallery_albums'::regclass
       and not tgisinternal
       and tgname = 'gallery_albums_keep_visibility_on_delete'
  ) then
    raise exception '0015 롤백: 트리거가 아직 붙어 있다';
  end if;
  if to_regprocedure('public.gallery_album_delete_keep_visibility()') is not null then
    raise exception '0015 롤백: 트리거 함수가 아직 남아 있다 — 다른 트리거가 이 함수를 쓰고 있는지 확인할 것';
  end if;
end
$$;

commit;

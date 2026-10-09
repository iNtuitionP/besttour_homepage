-- 0003_consent.sql — reservations 에 동의 기록 컬럼 4개 + 제약 3개 (플랜 v4 P1-3 · ADR-6)
--
-- 왜: 동의·고지 사실의 입증책임은 개인정보처리자에게 있다(PIPA §22③). 0001 의 reservations 에는 동의 기록
-- 컬럼이 하나도 없다. 명시 체크박스 동의(ADR-6)로 확정했으므로 행마다 "언제, 어느 버전의 방침에" 동의했는지
-- 남기고, 동의 없는 insert 는 코드 경로가 아니라 DB 제약이 막는다 — 코드 차단만으로는 입증이 안 된다.
--
-- default now() 를 쓰지 않는 이유 (플랜 ADR-6 이 지적한 합성 초안의 결함):
--   privacy_consent_at 에 default now() 를 두면 앱이 값을 빠뜨린 insert 도 통과하면서 "동의를 받은 적 없는데
--   동의 시각이 있는" 행이 생긴다. 그것은 허위 기록이다. default 없음 + NOT NULL 이어야 "값이 없으면 실패"가
--   되고, 저장된 시각은 전부 앱이 실제 동의를 받고 넣은 값이라고 말할 수 있다. retention_until 도 같은 이유로
--   default 없음 — 앱이 원장의 보유기간(lib/legal/disclosures.ts PRIVACY_NOTICE.retentionDays)으로 계산해 넣는다.
--
-- 값은 lib/reservations/consent.ts consentFields() 가 만든다 — 서버가 접수 요청을 받은 인스턴트 기준.
-- 클라이언트가 보낸 시각은 쓰지 않는다. 0001 은 수정하지 않는다(원격에 이미 적용됨).
-- 롤백: supabase/rollbacks/0003_consent.down.sql (수동 실행 전용 — migrations/ 밖에 두는 이유는 그 파일 헤더 참조).

-- =========================================================================
-- 0. 안전장치 — 기존 행이 있으면 멈춘다
--    NOT NULL 컬럼을 default 없이 추가하면 기존 행 때문에 실패하고, default 로 채우면 가짜 동의 시각이 된다.
--    어느 쪽도 자동으로 하지 않는다. 사람이 기존 행(옛 사이트 이관분 등)을 보고 판단한 뒤 다시 적용한다.
-- =========================================================================
do $$
declare
  n bigint;
begin
  if exists (select 1 from reservations) then
    select count(*) into n from reservations;
    raise exception '0003_consent: reservations 에 기존 행 % 건 — 동의 컬럼을 소급 채울 수 없다. 사람이 판단할 것', n
      using hint = '기존 행의 동의 근거를 확인해 별도 스크립트로 채우거나 삭제한 뒤 0003 을 다시 적용한다. 빈 값을 현재 시각으로 자동 채우지 말 것.';
  end if;
end
$$;

-- =========================================================================
-- 1. 컬럼 4개 — 전부 default 없음 (헤더 참조)
-- =========================================================================
alter table reservations
  add column privacy_consent_at     timestamptz not null,   -- 필수 동의 시각. 앱이 반드시 넣는다
  add column privacy_policy_version text        not null,   -- 동의 당시 방침 버전 (consent.ts PRIVACY_POLICY_VERSION, 예: '2026-09-11')
  add column marketing_consent_at   timestamptz,            -- 선택 동의(광고성 정보 수신) 시각. null = 미동의
  add column retention_until        timestamptz not null;   -- 파기 예정 시각 (P1-5 배치가 읽는다). 앱이 접수 시각 + 보유기간으로 계산

-- =========================================================================
-- 2. 제약 3개
-- =========================================================================
alter table reservations
  -- 동의 시각이 접수 시각보다 늦을 수 없다. +5분은 앱 서버↔DB 시계 오차 허용 폭. 그 이상 미래면 조작 또는 버그.
  add constraint reservations_consent_before_created
    check (privacy_consent_at <= created_at + interval '5 minutes'),
  -- 너무 과거의 동의 시각도 거부한다 (옛 동의 재사용·클라이언트 시계 조작 방어). 위저드 체류를 넉넉히 하루로 본다.
  add constraint reservations_consent_not_stale
    check (privacy_consent_at >= created_at - interval '1 day'),
  -- 파기 예정 시각은 접수 이후여야 한다. 과거면 배치가 접수 직후 지우고, 접수 시각과 같으면 보유기간 0 이 된다.
  add constraint reservations_retention_after_created
    check (retention_until > created_at);

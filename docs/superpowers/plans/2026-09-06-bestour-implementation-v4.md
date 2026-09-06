# 베스트투어 홈페이지 — 구현 계획 v4 (최종)

> `docs/superpowers/plans/2026-08-15-bestour-implementation-master.md`(v3.1)를 **대체**한다.
> 작성 2026-09-06 · 3개 관점 독립 계획 → 3인 교차 심사 → 합성 → 완결성 비평 → **컨트롤러 사실검증** 후 확정.
> 심사·비평 원본: `docs/superpowers/reports/2026-09-06-impl-plan-{judges,draft,critique}.md`

---

## 0. 전제와 범위

### 0-1. 컨트롤러가 실측한 현재 상태 (2026-09-06)

세 계획 모두 저장소를 제대로 안 읽고 쓴 전제가 있었다. 아래가 **검증된 사실**이다.

| 항목 | 실제 상태 | 계획들의 오해 |
|---|---|---|
| Supabase 원격 | **이미 존재하고 살아 있다.** 0001이 SQL Editor로 적용돼 8테이블 생성, `vehicles` 5행, `showcase_routes` 5행(price NULL). CLI link + `migration repair`로 이력 동기화 완료 | "프로비저닝한다" / "빈 DB라 지금이 마지막 무통증 시점" — **둘 다 틀렸다** |
| `styles/tokens.css` | **이미 존재**하고 `app/layout.tsx:2`가 import 중 | "새로 만든다" |
| `public/brand/*.png` | **이미 커밋됨** (6165574) | "미커밋이라 Vercel 404" |
| `notifications_log.status` | CHECK가 `('sent','failed')` **2값뿐** | 아웃박스(pending)를 스키마 변경 없이 쓸 수 있다고 가정 |
| i18n | 마스터플랜 §Tech Stack에 **next-intl KO/EN 명시** — 범위 안이다 | risk·legal 계획이 `[locale]` 세그먼트를 아예 누락 |
| 코드 | `app/`은 스캐폴드뿐(layout/page/globals). 서버액션 0, 컴포넌트 0, admin 라우트 0, 인증 게이트 자리 0 | — |

### 0-2. 이 계획이 하지 않는 것

- **목업(`mockups/**`) 수정.** 별도 UIUX 세션 소유. 인계 브리프 `docs/handoff/2026-09-06-uiux-session-brief.md`.
- **도메인 갱신 실행.** 사장님이 직접 요청하기로 함(만료 2026-10-05). 리스크로만 등록한다.
- **메일 서비스 교체.** A 레코드만 바꾸고 MX는 손대지 않으므로 오픈 게이트에서 제외(스펙 §13.4).
- **가격 계산.** 어떤 형태로도 금지(CLAUDE.md §3).

### 0-3. 일정 역산

도메인 만료 **D-29**(2026-10-05). 단 갱신은 사장님 몫이고 전환과 분리 가능하므로 개발 일정을 압박하지 않는다.

| Phase | 태스크 | 추정 | 누적 |
|---|---:|---:|---:|
| P0 조달·골격 | 7 | 3일 | 3일 |
| P1 법정 원장·스키마 | 6 | 3일 | 6일 |
| P2 공개 수직 슬라이스 | 5 | 4일 | 10일 |
| P3 접수 | 5 | 3일 | 13일 |
| P4 통지 | 4 | 3일 | 16일 |
| P5 관리자 | 7 | 5일 | 21일 |
| P6 잔여 화면·갤러리·파기 | 6 | 4일 | 25일 |
| P7 전환 | 5 | 2일 | 27일 |

SDD 루프(브리프→구현→리뷰→픽스)를 감안한 추정이다. 사장님 미회신 항목은 `[TEMP]`로 통과시키므로 대기가 일정에 들어가지 않는다.

---

## 1. 전략 요약

리스크 우선 골격 위에 배포 우선의 수직 슬라이스를 얹는다. **되돌릴 수 없는 것**(라우트 URL 골격, 동의 기록, 인증 경계, 원격 DB 스키마)을 먼저 굳히되, P2에서 홈 1페이지를 실제로 배포해 사장님이 눈으로 볼 것을 만든다. 법정 문구는 `lib/legal/disclosures.ts` 단일 원장에 격리해 목업이 어떻게 바뀌어도 함께 날아가지 않게 한다. 관리자는 service role이 아니라 RLS 위에 세워 최종 방어선을 코드 밖에 둔다. 목업 추종은 테스트가 아니라 **커밋 해시 고정**으로 해서 UIUX 세션 커밋이 내 CI를 깨뜨리지 못하게 한다.

---

## 2. 아키텍처 결정 (ADR)

### ADR-1. 라우트 골격을 첫 라우트 파일보다 먼저 확정한다
**결정**: `app/[locale]/(site)/**` + `app/admin/**`(로케일 밖) + `app/[locale]/(legal)/**`. next-intl `localePrefix: 'as-needed'`, EN 메시지는 빈 채로 ko 폴백.
**대안**: 나중에 i18n을 배선한다(risk·legal 계획).
**근거**: EN을 켜는 순간 이미 만든 전 라우트를 이동해야 하고, **발송된 문자 본문의 `/guide` 링크가 깨진다.** 법정 문서 URL은 한 번 발송되면 되돌릴 수 없다. 셸 소유권도 여기서 한 번만 정한다 — `app/layout.tsx`는 `<html>`만, 공개 셸은 `(site)/layout.tsx`, 관리자 셸은 `admin/layout.tsx`. 그래야 **관리자 화면이 공개 푸터(계좌번호·사업자정보)를 상속하지 않는다.**

### ADR-2. 관리자는 service role이 아니라 RLS 위에 선다
**결정**: `is_admin()` SQL 함수 + 테이블별 admin 정책. admin 경로에서 `createServiceClient()` 호출 **0건**을 grep 게이트로 강제.
**폴백(명시)**: 집계·크로스테이블 조회가 정책에 걸리면 그 쿼리만 `SECURITY DEFINER` 뷰/RPC로 격리한다. service role로 되돌아가지 않는다.
**근거**: admin은 고객 이름·전화번호를 다룬다. service role은 RLS를 우회하므로 방어선이 `requireAdmin()` 함수 호출 하나뿐이 된다. 한 번의 조기 return 누락이 전체 노출로 이어진다.

### ADR-3. 읽기는 서버액션에 두지 않는다
**결정**: 읽기는 `lib/queries/*.ts`에서 RSC가 직접 호출. `'use server'` 모듈에는 **뮤테이션만**.
**근거**: `'use server'` 모듈의 export는 전부 공개 POST RPC가 된다. 캐시 읽기를 공개 엔드포인트로 만들 이유가 없다.

### ADR-4. 서버액션 본체는 순수 함수, `'use server'`는 얇은 래퍼
**결정**: `lib/reservations/create.ts`에 deps 주입 순수 함수, `actions/reservation.ts`는 래퍼. `after()`·`revalidateTag()`·`cookies()`는 `lib/ports/*.ts`로 감싼다.
**근거**: 서버액션을 테스트 가능하게 만드는 유일한 방법. Next 원시값을 직접 부르면 단위 테스트가 불가능해진다.

### ADR-5. 법정 문구는 단일 원장 모듈
**결정**: `lib/legal/disclosures.ts` — **상수만, 함수 export 0개**(테스트로 강제). 컴포넌트에 법정 한글 리터럴 금지(게이트로 검사).
**근거**: `check-no-pricing.sh`가 "있으면 안 되는 것"을 막는다면 이건 "있어야 하는 것"을 반대편에서 잠근다. 목업이 스킨을 갈아도 법정 문구가 함께 날아가지 않는다.

### ADR-6. 동의는 명시 체크박스로 간다
**결정**: 필수 체크박스 1개(개인정보 수집·이용) + 선택 1개(광고성 정보 수신). 컬럼 `privacy_consent_at`, `privacy_policy_version`, `marketing_consent_at`.
**대안**: 계약 이행 근거(PIPA §15①4호)로 처리하고 체크박스를 없앤다.
**근거**: 합성 초안은 체크박스를 없애면서 `privacy_consent_at`을 채우려 했다 — **받지 않은 동의의 시각을 기록하는 허위 기록**이다. 둘 중 하나를 골라야 하고, 입증책임 대응과 UI 명료성에서 명시 동의가 낫다. 체크박스는 **사전 선택 금지**.

### ADR-7. 통지는 아웃박스 패턴
**결정**: `notifications_log`에 `pending` 추가 + `attempts` + `last_error` + `unique(reservation_id, event, channel) where status='sent'` 부분 인덱스. **기록 후 발송**.
**근거**: 현재 CHECK가 `('sent','failed')` 2값이라 "기록 후 발송"이 구조적으로 불가능하다. `after()` 실패가 조용히 사라지는 경로를 스키마로 막는다. 부분 유니크는 중복 발송을 막으면서 재발송(실패건)은 허용한다.

### ADR-8. 목업 추종은 커밋 해시 고정으로
**결정**: 이식 브리프에 목업 커밋 해시를 박고, 이후 해시 구간 diff만 재적용. 카피 문자열 대조 테스트(copy-parity)는 **만들지 않는다**.
**근거**: 목업은 UIUX 세션 소유다. HTML 파싱 기반 대조 테스트는 그쪽의 마크업 리팩터 한 번으로 내 CI를 red로 만들고, 그 red는 내 파일을 고쳐서 해소되지 않는다. 남의 커밋이 내 CI를 깨는 결합을 만들면 안 된다.

### ADR-9. 갤러리는 브라우저 직업로드
**결정**: 브라우저 → signed URL로 원본 버킷 직업로드 → 서버는 변환만. HEIC는 클라이언트 변환 또는 미지원 확정.
**근거**: Server Action 기본 `bodySizeLimit` 1MB, Vercel 요청 4.5MB. 20MB×30장은 구조적으로 통과 못 한다. `sharp`는 의존성에 없고 기본 빌드에 libheif가 없어 HEIC 디코드도 안 된다.

### ADR-10. 환경 3분리
**결정**: `local`(supabase start) / `preview`(**별도 Supabase 프로젝트**, noindex) / `prod`.
**근거**: 게이트가 전부 "프리뷰에서 E2E"인데 프리뷰가 운영 DB를 쓰면 **테스트가 실개인정보 행을 운영 DB에 쓴다.**

---

## 3. 단계별 실행 계획

> 표기 규약: 모든 태스크의 검증 첫 항목은 **테스트 선작성**(CLAUDE.md §7 TDD). UI 태스크는 검증에
> `browse 실측: 콘솔 0 / 375px 가로 스크롤 0 / 인터랙션 동작 / **실패 경로 1건**`을 고정으로 포함한다.

### P0 — 조달과 골격 (되돌리기 비싼 것을 먼저 굳힌다)

**목표**: 계정·키가 갖춰지고, URL 골격과 팔레트 교체 지점이 확정되고, 되돌릴 수 없는 백업이 확보된다.

| ID | 태스크 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| P0-0 | **라우트 골격 확정** — `[locale]`/`(site)`/`(legal)`/`admin` 디렉터리와 레이아웃 3층, next-intl 배선(EN 메시지 빈 상태) | `app/layout.tsx` `app/[locale]/layout.tsx` `app/[locale]/(site)/layout.tsx` `app/admin/layout.tsx` `i18n/**` `middleware.ts` | — | 테스트 선작성 → `/`·`/en`·`/admin` 200, admin이 공개 푸터를 상속하지 않음(DOM 부재 단언) | 뒤로 미루면 전 라우트 이동 + 발송 문자 링크 파손 |
| P0-1 | **계정·요금제 조달 + env 발급** (Supabase Pro, Vercel, Upstash, Turnstile, Solapi — 전부 대표자 이승묵 명의). 결제수단은 사장님이 직접 등록 | `docs/ops/accounts.md` `.env.example` | — | 각 서비스 대시보드 스크린샷 + env 키 13종 → 17종(메일 3종 추가) 목록 대조 | 미조달 시 P3·P4 게이트 통과 불가 |
| P0-2 | **프리뷰 환경 분리** — 별도 Supabase 프로젝트 + Vercel 프리뷰 env + `noindex` | `docs/ops/environments.md` `app/[locale]/layout.tsx` | P0-1 | 프리뷰 배포에서 `robots` noindex 헤더 확인, 프리뷰 DB가 운영과 다른 project ref임을 단언 | 운영 DB에 테스트 개인정보 유입 |
| P0-3 | **팔레트 교체 지점 단일화** — `styles/tokens.css`(원시) + `styles/semantic.css`(의미) 2층. 브랜드 실측 3색 반영, POINT는 `--gray`(보더·아이콘)와 `--gray-text`(본문 보조, 더 어두운 값) **분리** | `styles/tokens.css` `styles/semantic.css` | — | 테스트 선작성 → 토큰 누락 검출, **대비비 계산 테스트**(본문 4.5:1, UI 3:1), `#7B7A7A`가 본문 토큰에 쓰이지 않음 | AA 미달 색을 본문에 쓰면 푸터 전체가 위반 |
| P0-4 | **CLAUDE.md 개정** — §1-A 도메인, §3에 "실증 불가 수치 금지"·"'면허'가 아니라 '등록'" 추가, §4에 "semantic.css가 단일 교체 지점, 원시 토큰 직접 사용 금지", §2 `check-temp-values.sh` 게이트 승격 반영 | `CLAUDE.md` | P0-3 | 컨트롤러 검수. 게이트 변경과 문서 개정이 같은 커밋 | 문서와 하네스가 어긋나면 규칙이 죽는다 |
| P0-5 | **게이트 3종 선(先)설치** — `check-legal-disclosures.sh`(필수 문구 존재 + `면허` grep), `check-mockup-drift.sh`(목업 해시 + `public/brand`↔`mockups/assets/brand` 해시 비교), `check-temp-values.sh` exit 1 승격. **대상 파일 부재 시 exit 0, 생기는 순간부터 실패** | `scripts/*.sh` `.github/workflows/ci.yml` | P0-4 | 양성/음성 픽스처로 게이트 자체를 2회 실증 | 나중에 붙이면 이미 위반된 코드를 통과시킨다 |
| P0-6 | **사장님 액션 — 그누보드 백업** (DB + DATA, FTP로 내려받아 암호 폴더 보관) | `docs/ops/legacy-backup.md`(증적 기록) | — | 파일 목록·용량·보관 위치를 레저에 기록 | **카페24 자동백업 보관 7일** — 지금 안 받으면 복구 불가 |
| P0-7 | **발신번호 사전등록 착수** — 통신서비스 이용증명원 발급 안내 + Solapi 등록 | `docs/ops/sender-id.md` | P0-1 | 접수번호 확보 | 심사 리드타임 최대 3영업일 → P4 게이트 선행 |

**게이트**: `/`·`/en`·`/admin` 200 · 게이트 3종이 픽스처로 red/green 실증 · 백업 증적 기록 · env 17종 채워짐
**지금 배포하면**: 빈 껍데기 3라우트. 사장님에게 보여줄 것은 없다.

---

### P1 — 법정 원장과 스키마 (소급 불가한 것)

**목표**: 법정 문구가 코드에 단일 원장으로 존재하고, 동의·아웃박스·도시노선 스키마가 원격에 적용된다.

> **마이그레이션 번호는 생성 순서대로 부여한다.** 원격에 0003을 올린 뒤 0002를 추가하면 CLI 이력이 out-of-order가 되어 적용이 깨진다. 원격은 이미 0001까지 동기화돼 있다.

| ID | 태스크 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| P1-1 | **법정 원장 모듈** — 사업자정보, verbatim 2문구, 견적 산정 기준, 대금 지급, 취소·환불 4단계, 개인정보 4대 고지, 위탁사 목록, 국외이전 5항목 | `lib/legal/disclosures.ts` | P0-5 | 테스트 선작성 → **함수 export 0개** 단언, verbatim 2문구 **바이트 일치**, 금지어(`면허`) 0건 | 컨트롤러가 문안을 확정해 브리프에 전문으로 싣는다 — 서브에이전트에게 맡기면 창작한다 |
| P1-2 | **0002 — 도시 노선** `places` 테이블(코드·한글명·영문명·lat/lng·svg_x/svg_y) + `showcase_routes`를 FK로 전환 + 16행 시드 | `supabase/migrations/0002_places.sql` `lib/codes.ts` | P1-1 | 테스트 선작성 → **스펙 §13.2의 16쌍·가격·highlight를 픽스처로 박고 전량 비교**(행 수만 세지 않는다), 기존 5행 마이그레이션 경로 검증 | **원격은 라이브 DB다.** CHECK→FK 교체는 롤백 스크립트를 함께 만든다 |
| P1-3 | **0003 — 동의 기록** `privacy_consent_at`(NOT NULL), `privacy_policy_version`, `marketing_consent_at`, `retention_until` | `supabase/migrations/0003_consent.sql` `lib/types.ts` | P1-2 | 테스트 선작성 → **동의 없는 insert가 DB 레벨에서 실패**함을 실증(코드 경로 차단이 아니라 제약으로) | nullable로 두면 검증 자체가 불가능해진다 |
| P1-4 | **0004 — 통지 아웃박스** status에 `pending` 추가, `attempts`·`last_error`, 부분 유니크 인덱스 | `supabase/migrations/0004_outbox.sql` | P1-3 | 테스트 선작성 → 중복 sent 차단 + 실패건 재발송 허용을 동시에 실증 | 현 CHECK 2값으로는 아웃박스가 불가능 |
| P1-5 | **파기 배치** — `retention_until` 도래 행 삭제. **dry-run 기본값**, 확정건은 전자상거래법 보존기간으로 별도 계산 | `lib/retention/purge.ts` `app/api/cron/purge/route.ts` | P1-3 | 테스트 선작성 → **고정 시각 주입**으로 KST/UTC 경계, 확정 5년/미확정 1년 분기, 삭제 상한 검증 | 게시한 보유기간을 이행할 수단이 없으면 그 고지가 오픈 첫날부터 허위 표시 |
| P1-6 | **법정 페이지 3종** `/privacy`(필수 7항목: 처리목적·항목·보유기간·위탁·국외이전·권리행사 방법·파기 절차·안전성 확보조치·자동수집장치·권익침해 구제·변경 고지, **접수현황 마스킹 공개 고지 포함**), `/terms`(계약 성립 시기·청약철회·면책·준거법·관할·분쟁조정), `/guide` | `app/[locale]/(legal)/**` | P1-1, P0-0 | 테스트 선작성 → 조문↔문구↔화면위치 **매핑표**로 검증, browse 실측, **컨트롤러 사람 리뷰 서명** | grep으로 "섹션 존재"만 보면 법적 충분성을 전혀 보증하지 않는다 |

**게이트**: 원격 DB에 0002~0004 적용 + 롤백 리허설 1회 · 법정 3페이지 사람 리뷰 서명 · 파기 배치 dry-run 경계 테스트 통과
**지금 배포하면**: 법정 문서 3페이지가 열린다. 여전히 사장님이 볼 홈은 없다.

---

### P2 — 공개 사이트 수직 슬라이스 (처음으로 보여줄 것이 생긴다)

**목표**: 홈이 DB에서 노선을 읽어 렌더되고 프리뷰에 배포된다. 사장님 컨펌 루프가 여기서 시작된다.

| ID | 태스크 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| P2-1 | 읽기 쿼리 계층 — `getShowcaseRoutes` `getVehicles` `getNotices` `getActivePopup`. **서버액션 아님** | `lib/queries/*.ts` | P1-2 | 테스트 선작성 → RLS anon 권한으로만 동작함을 실증, `'use server'` 미포함 단언 | 서버액션에 두면 공개 POST RPC가 된다 |
| P2-2 | **KrMap 컴포넌트** — SVG(지도) 레이어와 HTML(라벨) 레이어 **분리**. 라벨 정책은 UIUX 결정 수령 전까지 **카드 리스트만**, 지도 라벨은 보류 | `components/KrMap/*.tsx` `lib/map-coords.ts` | P2-1 | 테스트 선작성 → routeGeometry 회귀 42건 유지, browse 실측 | 16라벨 겹침은 UIUX 미결정 — "무엇이 완성인지"가 없으면 서브에이전트가 못 끝낸다 |
| P2-3 | 홈 셸 + 헤더/푸터 — **법정 데이터 블록**(P1-1 원장 소비)과 **레이아웃 푸터**를 분리 | `app/[locale]/(site)/page.tsx` `components/layout/*.tsx` | P1-6, P0-3 | 테스트 선작성 → 사업자정보 8필드가 원장에서 옴을 단언, browse 실측 3폭 | 목업 확정 전 푸터를 굳히면 UIUX 변경 시 동시 재작업 |
| P2-4 | 홈 섹션 이식 (히어로 캐러셀·노선·차량·갤러리·공지·문의) — **목업 커밋 해시 고정** | `components/home/*.tsx` | P2-2, P2-3 | 테스트 선작성 → 해시 diff 재적용 절차 준수, browse 실측 + 목업 대조(**허용 오차·비교 도구 명시**) | 6섹션을 한 태스크에 묶으면 서브에이전트가 못 끝낸다 → **섹션당 1태스크로 분할 발행** |
| P2-5 | 에러 경로 — `not-found` / `error` 바운더리 | `app/[locale]/(site)/not-found.tsx` `error.tsx` | P2-3 | 테스트 선작성 → 강제 throw 시 바운더리 렌더, browse 실측 | 없으면 오류가 흰 화면으로 나간다 |

**게이트**: 프리뷰에서 홈 3폭 렌더 + 콘솔 0 + Lighthouse 모바일 90+(**측정 URL·스로틀·3회 중앙값 프로토콜 고정**)
**지금 배포하면**: **홈이 동작한다.** 사장님에게 링크를 보낼 수 있다. 접수는 아직 안 된다.

---

### P3 — 접수 (첫 공개 뮤테이션)

| ID | 태스크 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| P3-1 | 방어 4종 — zod · Upstash RL · Turnstile · 허니팟. **fail-closed** | `lib/guard/*.ts` | P0-1 | 테스트 선작성 → 각 방어 우회 시도 4종이 전부 거부, **프리뷰 실키 스모크**(연속 요청 429 / 위조 토큰 거부) 1회 | 전량 mock이면 실키 동작이 오픈까지 한 번도 검증되지 않는다 |
| P3-2 | 접수 순수 함수 — deps 주입, KST 벽시계 해석, `public_code` **비순차 생성** | `lib/reservations/create.ts` `lib/ports/*.ts` | P1-3 | 테스트 선작성 → TZ=UTC/Asia/Seoul 양쪽 날짜 경계, public_code 열거 불가 | 순차 코드는 열거 공격에 뚫린다 |
| P3-3 | 서버액션 래퍼 | `actions/reservation.ts` | P3-1, P3-2 | 테스트 선작성 → 래퍼가 얇음(로직 0), 동의 없는 payload 거부 | — |
| P3-4 | 견적 위저드 6단계 — 다중 경유지, 전화 검증, **동의 체크박스 2종(필수/선택, 사전선택 금지)**, 완료 verbatim. **접수 경로는 위저드 하나로 통일**(홈 위젯은 프리필만) | `app/[locale]/(site)/quote/**` `components/quote/*.tsx` | P3-3 | 테스트 선작성 → 동의 미체크 시 제출 차단, browse 실측 + **실패 경로 1건**(검증 에러 표시·재시도) | 접수 경로가 둘이면 동의 UI·검증이 두 벌 생긴다 → 목업 동작 축소를 사장님 고지 항목으로 승격 |
| P3-5 | 접수 현황 공개(마스킹) — 60초 캐시 | `lib/queries/recent.ts` `components/home/RecentFeed.tsx` | P3-2 | 테스트 선작성 → **응답에 원문 이름·전화가 포함되지 않음을 property test**, 캐시 TTL 실측 | 마스킹 누출은 되돌릴 수 없다 |

**게이트**: 프리뷰에서 실접수 1건이 DB 행 + `public_code`로 관측 · 방어 4종 실키 스모크 통과 · 동의 컬럼 채워짐
**지금 배포하면**: **접수가 된다.** 단 아무도 알림을 못 받는다 → **공개 배포 금지, 프리뷰 한정.**

---

### P4 — 통지

| ID | 태스크 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| P4-1 | 아웃박스 기록 → 발송 | `lib/notify/outbox.ts` | P1-4 | 테스트 선작성 → 기록 후 발송, 실패 시 `failed`+`last_error`, 재시도 멱등 | `after()` 실패가 조용히 사라지면 접수 유실 |
| P4-2 | Solapi 어댑터 (SMS/LMS/알림톡) | `lib/notify/solapi.ts` | P4-1, P0-7 | 테스트 선작성 → mock 경로 전량, **광고 판별 금지어 목록 파일**로 0건 검사(KO/EN) | — |
| P4-3 | 문자 문안 — **verbatim 2문구는 축약 금지 대상**. LMS 초과 시 다른 문장을 줄이고 `/guide` 링크를 덧붙인다 | `lib/notify/templates.ts` | P4-2, P1-1 | 테스트 선작성 → verbatim 바이트 일치, 길이 초과 시 verbatim 보존 확인 | 요약이 verbatim을 훼손하면 CLAUDE.md §3 위반 |
| P4-4 | 발송 실패 폴백 — 기존 `bestour2013@naver.com`으로 통지 | `lib/notify/fallback.ts` | P4-1 | 테스트 선작성 → 문자 실패 시 폴백 1회 발송 | 문자만 있으면 실패를 아무도 모른다 |

**게이트(2단 분리)**: ① **mock 경로 통과**(코드 완료 판정) ② **실발송 스모크**(발신번호 등록 완료 후, 실기기 수신 확인) — ②만 P0-7에 의존
**지금 배포하면**: 접수하면 사장님 폰에 문자가 온다.

---

### P5 — 관리자

| ID | 태스크 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| P5-1 | **인증 게이트** — Supabase Auth 이메일(`bestm@bestour.co.kr`), `requireAdmin()`, middleware에서 admin 경로 **포함**으로 전환 | `middleware.ts` `lib/auth/requireAdmin.ts` | P0-0 | 테스트 선작성 → 비로그인 `/admin/*` 전 경로 302, 세션 만료 처리. **인간 액션 체크리스트**(계정 생성·SMTP·비밀번호 정책)를 브리프에 첨부 | 현재 middleware가 admin을 **제외**하고 있다 — 지금 상태로는 무인증 |
| P5-2 | **`is_admin()` RLS** + 테이블별 admin 정책 + `createServiceClient()` 호출 0건 grep 게이트 | `supabase/migrations/0005_admin_rls.sql` `scripts/check-admin-no-service-role.sh` | P5-1 | 테스트 선작성 → 비관리자 세션의 쓰기가 **RLS에서** 거부됨을 실증(코드 경로가 아니라) | service role 위에 서면 RLS는 장식이 된다 |
| P5-3 | 예약 현황 탭 + 확정 처리 | `app/admin/reservations/**` `actions/admin/reservation.ts` | P5-2, P4-1 | 테스트 선작성 → 역방향 상태전이 거부, **동시 클릭 경합 테스트**, 감사 로그 기록, browse 실측 | 경합 미검증 시 이중 확정 |
| P5-4 | 팝업 관리 | `app/admin/popups/**` `actions/admin/popup.ts` | P5-2 | 테스트 선작성 + browse 실측 + 실패 경로 | 액션 파일을 탭별로 분리 — 한 파일에 몰면 SDD 직렬 병합 충돌 |
| P5-5 | 공지 관리 | `app/admin/notices/**` `actions/admin/notice.ts` | P5-2 | 상동 | 상동 |
| P5-6 | 대표 노선 관리 | `app/admin/routes/**` `actions/admin/route.ts` | P5-2, P1-2 | 상동 | 상동 |
| P5-7 | **운영 인계** — admin 사용 매뉴얼 + 사장님 실사용 리허설 | `docs/ops/admin-manual.md` | P5-3~P5-6 | 사장님이 매뉴얼만 보고 예약 1건 확정 성공 | 인계물 없이 넘기면 오픈 후 전화가 온다 |

**게이트**: 무인증 접근 0 · admin 경로 service role 0건 · 사장님 리허설 통과

---

### P6 — 잔여 화면·갤러리·데이터

| ID | 태스크 | 파일 | 의존 | 검증 |
|---|---|---|---|---|
| P6-1 | 갤러리 아키텍처 확정(컨트롤러) → `0006_gallery_albums.sql`(앨범·width/height/bytes/original_path) | `supabase/migrations/0006_*.sql` | P1-2 | 테스트 선작성 |
| P6-2 | 갤러리 업로드 — **브라우저 → signed URL 직업로드**, 서버는 변환만. HEIC 정책 확정 | `lib/storage/*.ts` `app/admin/gallery/**` | P6-1, P5-2 | 테스트 선작성 → 20MB 파일 경로 실증, browse 실측 |
| P6-3 | 서브페이지 5종(회사소개·차량·갤러리·공지·이용안내) | `app/[locale]/(site)/**` | P2-3 | 테스트 선작성 + browse 실측 |
| P6-4 | 레거시 공지·갤러리 적재 | `scripts/import-legacy.ts` | P0-6 | 적재 건수 대조. **카페24 로그인 의존** |
| P6-5 | 구 사이트 개인정보 파기 — 게시판·회원·백업본의 범위와 시점 | `docs/ops/legacy-purge.md` | P6-4 | 파기 증적 기록 |
| P6-6 | 실증 불가 수치 전역 제거 — `mockups/soul.md:84`는 **UIUX 세션에 요청**, 플랜·스펙은 이쪽에서 | `docs/superpowers/**` | P0-4 | `check-legal-disclosures.sh` green |

---

### P7 — 전환

| ID | 태스크 | 파일 | 의존 | 검증 |
|---|---|---|---|---|
| P7-1 | 301 리다이렉트 12건 — **목적지 표를 컨트롤러가 확정해 브리프에 싣는다**(사업 판단) | `next.config.ts` | — | 테스트 선작성 → 12건 전량 목적지 일치 |
| P7-2 | robots·sitemap·소유확인 메타 | `app/robots.ts` `app/sitemap.ts` `app/layout.tsx` | P6-3 | 테스트 선작성 → **sitemap URL 목록이 실제 라우트 목록과 1:1** |
| P7-3 | 인증서 사전발급 — Vercel Pre-generate SSL → TXT를 **카페24 DNS**에 → `curl --resolve` 200 | `docs/ops/dns-cutover-runbook.md` `scripts/verify-cert.sh` | P0-1 | 전환 전 200 확인 |
| P7-4 | TTL 선하향(D-1, 60초) → **A 레코드만** Vercel로. **MX·NS 불변** | 런북 | P7-3 | 전환 후 MX 응답 불변 확인, 메일 수·발신 실측 |
| P7-5 | 통신판매업 변경신고(호스트서버 소재지) D+15 이내 | `docs/ops/` | P7-4 | 신고 존재 확인 선행 |

---

## 4. 마이그레이션 목록

| 파일 | 내용 |
|---|---|
| `0001_init.sql` | **적용 완료**(원격 동기화). 수정 금지 |
| `0002_places.sql` | 도시 카탈로그 + `showcase_routes` FK 전환 + 16행 시드 + 롤백 스크립트 |
| `0003_consent.sql` | `privacy_consent_at`(NOT NULL) · `privacy_policy_version` · `marketing_consent_at` · `retention_until` |
| `0004_outbox.sql` | `status`에 `pending` · `attempts` · `last_error` · 부분 유니크 인덱스 |
| `0005_admin_rls.sql` | `is_admin()` + 테이블별 admin 정책 |
| `0006_gallery_albums.sql` | 앨범 + `width`/`height`/`bytes`/`original_path` |

---

## 5. 계약

```
lib/queries/*.ts        읽기 전용. RSC 직접 호출. 'use server' 금지
lib/<domain>/*.ts       순수 로직. deps 주입. Next 원시값 직접 호출 금지
lib/ports/*.ts          after / revalidateTag / cookies 래퍼
actions/*.ts            'use server' 얇은 래퍼. 뮤테이션만
lib/legal/disclosures.ts 상수만. 함수 export 0개
components/**           props 경계. 법정 한글 리터럴 금지
```

---

## 6. UIUX 세션과의 병행 규약

| | 소유 |
|---|---|
| UIUX | `mockups/**` (variant-08 · wizard-b · admin · soul.md · assets) |
| 구현 | `app/ lib/ components/ actions/ supabase/ tests/ scripts/ .claude/ CLAUDE.md next.config.ts middleware.ts docs/superpowers/**` |

1. **목업→코드는 커밋 해시 고정**으로 추종한다. 카피 대조 테스트는 만들지 않는다(ADR-8).
2. `public/brand/` ↔ `mockups/assets/brand/` 동기화는 `check-mockup-drift.sh`가 해시로 검출한다.
3. `mockups/soul.md`의 실증 불가 수치 제거는 **UIUX 세션에 요청**한다(§6.3 요청 목록). 구현 게이트가 남의 파일을 강제하지 않는다.
4. 드리프트 베이스라인 갱신은 UIUX 커밋 후처리 스크립트로 자동화한다 — 컨트롤러 직렬 병목을 만들지 않는다.

---

## 7. 미회신 항목의 `[TEMP]` 폴백

| 항목 | 폴백 | 차단하는 것 |
|---|---|---|
| 잔금 시기·지급수단 | "온라인 결제 없음 · 계약금 10만원 · 잔금과 지급 방법은 예약 확정 시 안내" | 오픈만 차단, 개발 무차단 |
| 예약 보유 기간 | `[TEMP]` 1년 가정 + 파기 배치는 그 값으로 동작 | 오픈만 차단 |
| 접수 문자 수신 번호 | `OWNER_PHONE` 미설정 시 발송 스킵 + 폴백 메일 | P4 ②게이트만 |
| 인사말·차량 소개·사진 | 섹션 자체를 숨기는 폴백 | 오픈만 차단 |
| 누적 운행 건수 | **숫자 없이 "2013년부터"** — 이게 기본안이고 되돌릴 필요 없다 | 무차단 |
| 가비아·카페24 로그인 | — | P6-4·P7만 |

---

## 8. 오픈 게이트 체크리스트

**개발 준비 완료**와 **오픈 가능**을 분리해 각각 서명한다.

*개발 준비 완료 (구현 세션 책임)*
- [ ] CI 전 잡 green (test · pricing · legal-disclosures · mockup-drift · db-test)
- [ ] `check-temp-values.sh` exit 0 또는 잔여 항목이 문서로 승인됨
- [ ] 무인증 `/admin/*` 접근 0 · admin 경로 service role 0건
- [ ] 방어 4종 실키 스모크 통과
- [ ] 파기 배치 dry-run 경계 테스트 통과
- [ ] 법정 3페이지 사람 리뷰 서명
- [ ] Lighthouse 모바일 90+ (프로토콜 고정 측정)

*오픈 가능 (사장님 의존)*
- [ ] 도메인 갱신 완료
- [ ] 발신번호 등록 완료 + 실기기 수신 확인
- [ ] 지급 방법·시기 확정 문구 반영
- [ ] 보유 기간 확정
- [ ] 그누보드 백업 증적 확보
- [ ] 사장님 admin 리허설 통과

---

## 9. 알려진 약점

1. **16노선 지도 라벨 정책이 UIUX 미결정**이다. P2-2는 카드 리스트까지만 하고 지도 라벨은 보류한다 — UIUX 결정이 늦으면 P2 게이트가 반쪽으로 통과한다.
2. **RLS 전환(ADR-2)의 실현 가능성이 미검증**이다. 집계 쿼리가 정책에 걸리면 `SECURITY DEFINER` 격리로 가는데, 그 범위가 얼마나 될지 P5-2 착수 전까지 모른다.
3. **공개 insert 경로는 여전히 service role**이다. RPC/insert 전용 정책으로 줄이는 선택지를 이번 계획에서 검토하지 않았다.
4. **일정 추정이 SDD 루프 경험치 기반**이라 근거가 약하다. P2 종료 시점에 실측으로 재추정한다.
5. **프리뷰용 별도 Supabase 프로젝트가 요금을 추가로 발생**시킬 수 있다. P0-1에서 확인한다.

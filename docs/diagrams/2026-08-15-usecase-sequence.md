# 베스트투어 — Use Case & Sequence Diagrams

플랜 v2 (docs/superpowers/plans/2026-08-15-bestour-implementation-master.md) 기준.
GitHub·Claude Artifact에서 mermaid로 렌더됩니다.

## 1. Use Case Diagram

```mermaid
flowchart LR
  visitor(["👤 방문자<br/>(단체 총무·외국인 고객)"])
  owner(["👤 사장님<br/>(관리자)"])
  solapi[["📨 Solapi<br/>(SMS·알림톡)"]]
  turnstile[["🛡 Turnstile"]]

  subgraph public["공개 사이트 (KO/EN)"]
    uc1(["예상가 확인<br/>(차량·노선·경유지·일정)"])
    uc2(["예약 걸기<br/>(이름+전화 필수)"])
    uc3(["예약 확인<br/>(이름+전화 조회)"])
    uc4(["실시간 견적현황 보기<br/>(마스킹·예시 라벨)"])
    uc5(["문의하기<br/>(전화·카카오톡·네이버 톡톡)"])
    uc6(["언어 전환 KO ↔ EN"])
    uc7(["이벤트 팝업 보기<br/>(오늘 하루 보지 않기)"])
  end

  subgraph admin["관리자 /admin"]
    ua1(["로그인<br/>(단일 관리자 계정)"])
    ua2(["예약 현황 관리<br/>(확정·완료·취소 — 상태 머신)"])
    ua3(["알림 재발송"])
    ua4(["이벤트 팝업 등록/중지"])
    ua5(["공지·갤러리 관리"])
  end

  visitor --> uc1 & uc2 & uc3 & uc4 & uc5 & uc6 & uc7
  uc1 -. "2박 이상" .-> ucq(["별도 견적 안내"])
  uc2 -. "include" .-> turnstile
  uc2 -. "접수 통지" .-> solapi
  owner --> ua1
  ua1 --> ua2 & ua3 & ua4 & ua5
  ua2 -. "확정 통지" .-> solapi
  ua4 -. "노출" .-> uc7
  solapi -. "SMS/알림톡" .-> visitor
  solapi -. "접수 SMS" .-> owner
```

## 2. Sequence — 예약 접수 (핵심 플로우)

```mermaid
sequenceDiagram
  autonumber
  actor V as 방문자
  participant W as 위저드/홈 위젯<br/>(Next.js)
  participant SA as createReservation<br/>(Server Action)
  participant TS as Turnstile
  participant RL as Upstash RateLimit
  participant P as lib/pricing.estimate()
  participant DB as Supabase (reservations)
  participant N as notify (after)
  participant S as Solapi

  V->>W: 차량·노선(경유지 0~5)·일정·인원 선택
  W->>W: estimate() 클라이언트 미리보기 (예상가 표시)
  V->>W: "예약 걸기" — 이름+전화(+이메일) 입력
  W->>SA: 폼 제출 (turnstileToken, 허니팟 포함)
  SA->>SA: 허니팟 검사 (채워졌으면 silent drop)
  SA->>TS: 토큰 검증
  TS-->>SA: ok / fail → bot_check_failed
  SA->>RL: ip 5회/분 확인
  RL-->>SA: ok / 초과 → rate_limited
  SA->>SA: zod 검증 → KST 벽시계 해석(Asia/Seoul) → nights 산출
  SA->>P: 서버 재계산 (클라이언트 금액 불신)
  alt nights ≥ 2
    P-->>SA: quote_required (가격 없이 접수)
  else
    P-->>SA: estimated + breakdown
  end
  SA->>DB: insert (public_code BT-YYMMDD-XXXX, price_breakdown 스냅샷)
  SA-->>W: { ok, publicCode, estPrice | 별도견적 }
  W-->>V: 완료 화면 "사장님 확정 후 연락드리며,<br/>확정된 예약만 결제 진행됩니다."
  Note over SA,N: 응답 전송 후 after() 실행 — 사용자는 기다리지 않음
  SA--)N: notifyReservationCreated
  N->>S: 사장님 SMS + 고객 SMS/알림톡
  S-->>N: 결과
  N->>DB: notifications_log 기록 (실패 시 status=failed)
```

## 3. Sequence — 사장님 확정 & 통지

```mermaid
sequenceDiagram
  autonumber
  actor O as 사장님
  participant A as /admin (Next.js)
  participant AU as Supabase Auth<br/>(@supabase/ssr 쿠키 세션)
  participant SA as updateReservationStatus
  participant DB as Supabase
  participant S as Solapi
  actor V as 고객

  O->>A: 로그인
  A->>AU: 이메일/비밀번호
  AU-->>A: 세션 쿠키 (관리자 UUID 확인)
  O->>A: 신규 예약 [확정] 클릭
  A->>SA: (id, 'confirmed')
  SA->>SA: 상태 머신 검증 (new→confirmed만 허용,<br/>done/cancelled에서 역전이 거부)
  SA->>DB: notifications_log에 event='confirmed' sent 존재?
  alt 이미 발송됨
    SA->>DB: 상태만 갱신 (중복 문자 방지)
  else 미발송
    SA->>DB: status=confirmed, confirmed_at
    SA->>S: 고객에게 확정 문자/알림톡
    S-->>V: "예약이 확정되었습니다 ..."
    SA->>DB: notifications_log 기록
  end
  SA-->>A: 갱신된 예약
  A-->>O: 뱃지 변경 + "고객에게 확정 문자를 발송했습니다"
  opt 발송 실패 시
    O->>A: [재발송] 클릭 → resendNotification
  end
```

## 4. Sequence — 이벤트 팝업 (등록 → 노출)

```mermaid
sequenceDiagram
  autonumber
  actor O as 사장님
  participant A as /admin/popups
  participant ST as Supabase Storage
  participant DB as popups 테이블
  actor V as 방문자
  participant H as 홈페이지

  O->>A: 제목·문구·사진·기간 입력 → [등록]
  A->>ST: 이미지 업로드 (popups 버킷)
  A->>DB: insert (starts_at~ends_at, active)
  A-->>O: 실시간 미리보기 (실제 팝업 컴포넌트 재사용)
  V->>H: 홈 진입
  H->>DB: 노출 기간 내 active 팝업 조회 (RLS 공개 읽기)
  alt 팝업 있음 + localStorage 미차단
    H-->>V: 모달 표시 (오늘 하루 보지 않기 지원)
    V->>H: "오늘 하루 보지 않기" → localStorage 기록
  end
  opt 중지
    O->>A: [노출 중지] → active=false → 즉시 미노출
  end
```

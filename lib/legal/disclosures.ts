// lib/legal/disclosures.ts — 법정 문구 단일 원장 (플랜 v4 P1-1 · ADR-5)
//
// 규칙
//   - 상수만 export 한다. 함수 export 0개 — scripts/check-legal-disclosures.sh 가 grep 으로 강제한다.
//   - 컴포넌트·페이지·i18n 은 법정 문구를 이 모듈에서만 가져온다. 다른 파일에 법정 문구를 쓰면 게이트 위반.
//   - 문안은 P1-1 브리프(.superpowers/sdd/2026-09-06-bestour-implementation-v4/P1-1-brief.md)에서
//     그대로 옮겼다. 윤문 금지 — 바꿔야 하면 브리프·스펙을 먼저 고치고 여기로 내려온다.
//   - 확인되지 않은 값은 줄 끝 TEMP 마커 주석(`CONST.field: 사유`) + scripts/gates/temp-allowlist.txt 등록.
//     값 자체가 미확정인 필드는 "" 로 둔다 — 지어내지 않는다. 소비자는 빈 값을 숨김 폴백으로 처리한다.
//   - source: 각 상수가 어디서 확정됐는지(스펙 §번호 / 사업자등록증 / 사장님 확인시트 ★번호 / 옛 사이트 bo_page).
//     배열 상수(PROCESSORS·OVERSEAS_TRANSFERS)는 객체가 아니라서 형제 상수 *_SOURCE 에 둔다.

// ── 운영사 ───────────────────────────────────────────────────────────────
export const COMPANY = {
  legalName: "합자회사 베스트투어",
  brandName: "베스트투어",
  brandNameEn: "Bestour",
  representative: "이승묵",
  representativeEn: "Lee SeungMuk",
  bizRegNo: "130-86-77328",
  mailOrderNo: "제 2020-고양일산동-1211호",
  mailOrderIssuer: "고양시", // [TEMP] COMPANY.mailOrderIssuer: 신고 기관명 — 신고증 원본 확인 전
  address: "경기도 고양시 일산동구 동국로 107(식사동)",
  branchAddress: "서울시 마포구 월드컵북로 23길 18",
  tel: "1566-6188",
  mobile: "010-2048-8585",
  fax: "0303-3443-5252",
  email: "bestour2013@naver.com", // [TEMP] COMPANY.email: P0-10 도메인 메일 개설 후 info@bestour.co.kr 로 교체
  bankAccount: "KB국민은행 690101-00-050894",
  bankHolder: "합자회사 베스트투어", // [TEMP] COMPANY.bankHolder: 예금주명 확인 전
  establishedYear: 2013,
  privacyOfficer: { name: "조선영", phone: "010-2047-8585" },
  hostingProvider: "Vercel Inc.",
  source: "사업자등록증 2021-12-14 / whois / 스펙 §13.1·§13.8 / 확인시트 ★3",
} as const;

// ── 관계사 (푸터 병기용) ─────────────────────────────────────────────────
export const RELATED_COMPANY = {
  legalName: "(주)베스트모빌리티",
  representative: "이승묵",
  bizRegNo: "342-88-03855", // 시트의 332-… 는 오기. 등록증 확대 판독으로 342 확정 (스펙 §13.8)
  address: "경기도 용인시 기흥구 용구대로 2439, 4층 2호 201호(마북동)",
  role: "관계사",
  note: "계약 · 결제 · 개인정보 처리의 주체는 합자회사 베스트투어입니다.",
  source: "사업자등록증 2026-08-18 / 스펙 §13.1",
} as const;

// ── verbatim — 한 바이트도 바꾸지 마라 (CLAUDE.md §3) ────────────────────
export const VERBATIM = {
  bookingNotice: "사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다.",
  showcaseNotice: "대표 노선 예시 견적 · 45인승 당일왕복 기준 · 실제 견적은 상담 후 확정",
  source: "CLAUDE.md §3",
} as const;

// ── 견적 산정 기준 — 전자상거래법 §13②3호 (가격 미결정 시 산정 방법 표시) ──
export const QUOTE_BASIS = {
  title: "견적 산정 기준",
  factors: ["차종", "탑승 인원", "운행 거리", "운행 시간", "운행 일수", "심야/주말 할증"],
  line: "견적 산정 기준 : 차종 · 탑승 인원 · 운행 거리 · 운행 시간 · 운행 일수 · 심야/주말 할증",
  source: "스펙 §13.10 / 전자상거래법 제13조 제2항 제3호",
} as const;

// ── 지급 방법·시기 ───────────────────────────────────────────────────────
export const PAYMENT = {
  onlinePayment: false,
  depositKrw: 100000,
  line: "대금 지급 : 온라인 결제 없음 · 계약금 10만원 · 잔금과 지급 방법은 예약 확정 시 안내",
  balanceTiming: "예약 확정 시 안내", // [TEMP] PAYMENT.balanceTiming: 사장님 미회신 — 잔금 시기·지급수단 상세
  source: "확인시트 C3 / 2차 회신 2026-09-06",
} as const;

// ── 취소·환불 (기준액 재확인 중) ─────────────────────────────────────────
export const CANCELLATION = {
  basis: "deposit", // [TEMP] CANCELLATION.basis: 사장님 재확인 중 — 기존 사이트는 '총 차량금액' 기준, 시트 답변은 기준 미명시. 컨트롤러 잠정: 계약금 기준
  tiers: [
    { when: "운행일 8일 전까지", refundPct: 100, label: "계약금 전액 환불" },
    { when: "운행일 7일 전 ~ 2일 전", refundPct: 80, label: "계약금의 80% 환불" },
    { when: "운행일 전날", refundPct: 50, label: "계약금의 50% 환불" },
    { when: "운행 당일", refundPct: 0, label: "환불 불가" },
  ],
  referenceTime: "기준 시각은 운행 출발 시각입니다.",
  depositNote: "계약금은 10만원이며, 잔금과 지급 방법은 예약 확정 시 안내드립니다.",
  source: "확인시트 ★1 / 스펙 §13.11·§13.12",
} as const;

// ── 개인정보 수집·이용 4대 고지 (PIPA §15②) ─────────────────────────────
export const PRIVACY_NOTICE = {
  title: "개인정보 수집·이용 안내",
  purpose: "전세버스 견적 상담 및 예약 접수·확정",
  items: ["이름", "휴대폰 번호", "운행 희망 일시", "출발지·도착지·경유지", "탑승 인원"],
  itemsLine: "이름, 휴대폰 번호, 운행 희망 일시, 출발지·도착지·경유지, 탑승 인원",
  retention: "접수일로부터 1년", // [TEMP] PRIVACY_NOTICE.retention: 확인시트 F3 미회신 — 1년 가정. 전자상거래법 보존 의무(계약 기록 5년)는 확정건에 별도 적용
  retentionDays: 365, // [TEMP] PRIVACY_NOTICE.retentionDays: 위 retention 문안의 숫자값(같은 가정) — lib/reservations/consent.ts 가 retention_until 계산에 읽는다. 문안과 함께 바꾼다
  refusal: "동의를 거부하실 수 있으며, 거부 시 견적 상담과 예약 접수가 제한됩니다.",
  consentLabel: "위 내용을 확인했으며 개인정보 수집·이용에 동의합니다. (필수)",
  marketingConsentLabel: "할인·이벤트 안내 문자 수신에 동의합니다. (선택)",
  publicFeedNotice: "접수 현황은 성명 일부(예: 한**)·차종·운행일만 마스킹하여 홈에 공개됩니다.",
  source: "스펙 §13.10 / 플랜 ADR-6 / UIUX 브리프 §3-②",
} as const;

// ── 처리위탁 (PIPA §26② 실명 공개, 별도 동의 불요) ──────────────────────
export const PROCESSORS = [
  { name: "주식회사 누리고(Solapi)", task: "문자·알림톡 발송", location: "대한민국" }, // [TEMP] PROCESSORS.Solapi.name: 법인명 — solapi.com 사업자정보에서 확인 후 교체
  { name: "Vercel Inc.", task: "웹 호스팅·서버 운영", location: "미국" },
  { name: "Supabase Inc.", task: "데이터베이스·인증·파일 저장", location: "" }, // [TEMP] PROCESSORS.Supabase.location: 프로젝트 리전 확인 전
  { name: "Upstash Inc.", task: "접수 폭주 방지(요청 제한)", location: "" }, // [TEMP] PROCESSORS.Upstash.location: 리전 확인 전
  { name: "Cloudflare Inc.", task: "봇 차단(Turnstile)·DNS", location: "미국" },
] as const;
export const PROCESSORS_SOURCE = "플랜 ADR-10 / 결정 메모 1-C" as const;

// ── 국외 이전 (PIPA §28조의8② 5항목 + 시행령 §31① "이전의 근거") ────────
export const OVERSEAS_TRANSFERS = [
  {
    recipient: "Vercel Inc.",
    contact: "privacy@vercel.com",
    country: "미국",
    timingMethod: "서비스 이용 시 네트워크를 통한 상시 전송",
    items: "접속 로그·요청 정보",
    purpose: "웹 호스팅",
    retention: "위탁 계약 종료 시까지",
    legalBasis: "정보주체와의 계약 이행을 위한 처리위탁",
  },
  {
    recipient: "Supabase Inc.",
    contact: "privacy@supabase.io",
    country: "", // [TEMP] OVERSEAS_TRANSFERS.Supabase.country: 프로젝트 리전 확인 전
    timingMethod: "서비스 이용 시 네트워크를 통한 상시 전송",
    items: "이름·휴대폰 번호·운행 정보",
    purpose: "데이터 저장·인증",
    retention: "위탁 계약 종료 시까지",
    legalBasis: "정보주체와의 계약 이행을 위한 처리위탁",
  },
  {
    recipient: "Upstash Inc.",
    contact: "", // [TEMP] OVERSEAS_TRANSFERS.Upstash.contact: 개인정보 연락처 확인 전 — 지어내지 않는다
    country: "", // [TEMP] OVERSEAS_TRANSFERS.Upstash.country: 리전 확인 전
    timingMethod: "서비스 이용 시 네트워크를 통한 상시 전송",
    items: "요청 식별자(IP 해시)",
    purpose: "요청 제한",
    retention: "위탁 계약 종료 시까지",
    legalBasis: "정보주체와의 계약 이행을 위한 처리위탁",
  },
  {
    recipient: "Cloudflare Inc.",
    contact: "privacy@cloudflare.com",
    country: "미국",
    timingMethod: "서비스 이용 시 네트워크를 통한 상시 전송",
    items: "접속 정보",
    purpose: "봇 차단",
    retention: "위탁 계약 종료 시까지",
    legalBasis: "정보주체와의 계약 이행을 위한 처리위탁",
  },
] as const;
export const OVERSEAS_TRANSFERS_SOURCE = "결정 메모 1-C / PIPA §28조의8" as const;

// ── 차량 보험 — 사장님 "기존 문구 그대로" (확인시트 ★2) ───────────────────
export const INSURANCE = {
  title: "차량 보험",
  body: "전세버스의 차량보험 가입은 각 손해보험회사와 전세버스 공제조합의 보험에 가입되어 있으며 유사시 보상조건은 동일합니다. 여러분께서 이용하실 회사의 차량에 대해서는 원하시는 경우 보험 서류를 받아 보실 수 있습니다.",
  source: "옛 사이트 page.php?bo_page=intro10 / 확인시트 ★2",
} as const;

// ── 소비자 불만·분쟁 처리 (전자상거래법 §13②8호) ────────────────────────
export const DISPUTE = {
  channel: "대표전화 1566-6188 또는 이메일로 접수",
  handling: "접수 후 영업일 기준 3일 이내 처리 결과를 안내드립니다.", // [TEMP] DISPUTE.handling: 처리 기한 사장님 확인 전
  mediation: "분쟁이 해결되지 않을 경우 한국소비자원(1372) 또는 전자거래분쟁조정위원회에 조정을 신청하실 수 있습니다.",
  source: "결정 메모 1-C",
} as const;

// ── 아동 ─────────────────────────────────────────────────────────────────
export const MINORS = {
  line: "만 14세 미만 아동은 법정대리인의 동의 없이 견적을 신청하실 수 없습니다.",
  source: "PIPA §22조의2 / 전자상거래법 §13③",
} as const;

// ── 법정 링크 ─────────────────────────────────────────────────────────────
export const LEGAL_LINKS = {
  privacy: "/privacy",
  terms: "/terms",
  guide: "/guide",
  ftcBizInfo: "https://www.ftc.go.kr/bizCommPop.do?wrkr_no=1308677328",
  source: "시행규칙 §7②",
} as const;

/**
 * 법정 문서 셸 — 이용약관·개인정보처리방침 등.
 * 실제 셸 마크업은 P1-6에서 채운다. 공개 (site) 셸과 분리해 둔다.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

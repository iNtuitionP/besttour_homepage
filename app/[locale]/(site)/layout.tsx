/**
 * 공개 셸 — 헤더/푸터가 들어갈 자리.
 * P0-0 범위는 골격뿐이므로 마크업·스타일은 만들지 않는다.
 */
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Header: P2-3 */}
      {children}
      {/* Footer: P2-3 */}
    </>
  );
}

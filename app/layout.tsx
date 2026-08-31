import type { Metadata } from "next";
import "../styles/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "베스트투어",
  description: "베스트투어 — 구축 중",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

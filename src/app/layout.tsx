import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "G2B Contract Lookup",
  description: "Local business-number lookup for G2B contract records.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

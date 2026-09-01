import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ballast",
  description: "A pooled counterparty for DreamDEX event contracts, so the book is never empty.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

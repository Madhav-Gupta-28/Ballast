import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import Nav from "@/components/Nav";

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Ballast — the counterparty that is always there",
  description:
    "A pooled market maker for DreamDEX event contracts on Somnia. One unit of collateral mints one YES and one NO, so holding both is riskless — and the book is never empty.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${mono.variable}`}>
      <body>
        <noscript>
          <style>{`.rise{opacity:1 !important;transform:none !important}`}</style>
        </noscript>
        <Providers>
          <div className="hazard" aria-hidden="true" />
          <Nav />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}

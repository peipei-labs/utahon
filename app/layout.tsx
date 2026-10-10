import type { Metadata, Viewport } from "next";
import {
  Cormorant_Garamond,
  Noto_Serif_JP,
  DM_Mono,
  Inter,
} from "next/font/google";
import { Providers } from "@/components/providers";
import { TtsFeedback } from "@/components/tts-feedback";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const notoSerifJp = Noto_Serif_JP({
  variable: "--font-noto-serif-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Utahon 歌本 · A songbook for learning Japanese through music",
  description:
    "从喜欢的歌入手学日语 — 歌词 / 罗马音 / 中文翻译 / 词性 四合一标注",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f1e8" },
    { media: "(prefers-color-scheme: dark)", color: "#141210" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${cormorant.variable} ${notoSerifJp.variable} ${dmMono.variable} ${inter.variable} antialiased`}
    >
      <body className="min-h-screen bg-paper text-ink font-sans">
        <Providers>
          {children}
          <TtsFeedback />
        </Providers>
      </body>
    </html>
  );
}

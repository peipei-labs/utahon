"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles, Tv, ListMusic, ArrowRight } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { VoicePicker } from "@/components/voice-picker";
import {
  Colophon,
  DesktopNav,
  Masthead,
  MobileTopBar,
  PageFrame,
  Smallcaps,
} from "@/components/editorial-shell";
import { TabBar } from "@/components/editorial-interactive";

export default function ImportHubPage() {
  return (
    <PageFrame>
      <MobileTopBar
        title="Import"
        right={
          <>
            <VoicePicker />
            <ThemeToggle />
          </>
        }
      />

      <div className="hidden md:block">
        <Masthead
          title="Import"
          sub="Pick a path to file songs into the library."
          right={
            <DesktopNav
              items={[
                { href: "/", label: "Library" },
                { href: "/vocabulary", label: "Vocabulary" },
                { href: "/import", label: "Import", active: true },
              ]}
              trailing={
                <span className="flex items-center gap-2 ml-3 pl-3 border-l border-rule">
                  <VoicePicker />
                  <ThemeToggle />
                </span>
              }
            />
          }
        />
      </div>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-7 md:mt-10 grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6"
      >
        <Link
          href="/import/share"
          className="md:col-span-2 group block border border-ink bg-paper-deep/50 hover:bg-paper-deep transition"
        >
          <div className="p-6 md:p-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Smallcaps tone="red">Daily · share</Smallcaps>
                <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-ink-mute border border-rule px-1.5 py-0.5">
                  TOP
                </span>
              </div>
              <Sparkles className="w-4 h-4 text-red" strokeWidth={1.5} />
            </div>
            <h2 className="mt-3 font-serif italic font-medium text-[28px] md:text-[36px] leading-[1.05] tracking-[-0.01em] text-ink">
              一首歌 · 一段分享
            </h2>
            <p className="mt-3 font-serif text-[14px] md:text-[15px] text-ink-soft leading-[1.6] max-w-[60ch]">
              粘贴 QQ / 网易云 / Apple / Spotify 等平台分享出来的纯文本，AI
              识别 → 校对歌名歌手 → 查找现成歌词 + Gemini 注音翻译入库。日常学一首新歌走这里。
            </p>
            <div className="mt-5 p-3.5 border border-rule bg-paper/60 font-mono text-[11px] tracking-tight text-ink-mute italic leading-[1.55] break-all">
              夏川椎菜 (なつかわ しいな)/HoneyWorks《#超絶かわいい (#超绝可爱)》https://c6.y.qq.com/... @QQ音乐
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <Smallcaps tone="soft">paste · review · file</Smallcaps>
              <span className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] uppercase text-red group-hover:text-red-soft transition">
                Open share
                <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
              </span>
            </div>
          </div>
        </Link>

        <Link
          href="/import/channel"
          className="group block border border-ink bg-paper-deep/30 hover:bg-paper-deep/60 transition"
        >
          <div className="p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <Smallcaps>Bulk · channel</Smallcaps>
              <Tv className="w-3.5 h-3.5 text-ink-soft" strokeWidth={1.5} />
            </div>
            <h3 className="mt-3 font-serif italic font-medium text-[22px] md:text-[26px] leading-tight text-ink">
              YouTube 频道
            </h3>
            <p className="mt-2 font-serif text-[13px] md:text-[14px] text-ink-soft leading-[1.55]">
              yt-dlp 抓频道全部视频 · 自动过滤非歌曲 · 一次几十-几百首
            </p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <Smallcaps tone="mute">@handle / channel-id / url</Smallcaps>
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-soft group-hover:text-ink transition">
                Open
                <ArrowRight className="w-3 h-3" strokeWidth={1.5} />
              </span>
            </div>
          </div>
        </Link>

        <Link
          href="/import/netease"
          className="group block border border-ink bg-paper-deep/30 hover:bg-paper-deep/60 transition"
        >
          <div className="p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <Smallcaps>Bulk · netease</Smallcaps>
              <ListMusic className="w-3.5 h-3.5 text-ink-soft" strokeWidth={1.5} />
            </div>
            <h3 className="mt-3 font-serif italic font-medium text-[22px] md:text-[26px] leading-tight text-ink">
              网易云歌单
            </h3>
            <p className="mt-2 font-serif text-[13px] md:text-[14px] text-ink-soft leading-[1.55]">
              公开歌单全量入库 · YouTube 没视频也占位 · 一次几十-几百首
            </p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <Smallcaps tone="mute">163.com / 163cn.tv / playlist-id</Smallcaps>
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-soft group-hover:text-ink transition">
                Open
                <ArrowRight className="w-3 h-3" strokeWidth={1.5} />
              </span>
            </div>
          </div>
        </Link>
      </motion.section>

      <section className="mt-10 md:mt-14 border-t border-rule pt-5">
        <Smallcaps>How Rin sees this</Smallcaps>
        <ul className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 font-serif text-[13px] md:text-[14px] text-ink-soft leading-[1.55]">
          <li className="flex gap-2">
            <span className="font-serif italic text-red font-medium shrink-0">01.</span>
            日常学一首新歌 → share
          </li>
          <li className="flex gap-2">
            <span className="font-serif italic text-red font-medium shrink-0">02.</span>
            一次性囤老歌 → channel / netease
          </li>
          <li className="flex gap-2">
            <span className="font-serif italic text-red font-medium shrink-0">03.</span>
            三种方式都会先找现成歌词，再生成读音和翻译
          </li>
        </ul>
      </section>

      <Colophon>
        <span>Import · hub</span>
        <span className="text-center">—— pick your path ——</span>
        <span className="hidden sm:inline text-right">share · channel · netease</span>
      </Colophon>

      <TabBar />
    </PageFrame>
  );
}

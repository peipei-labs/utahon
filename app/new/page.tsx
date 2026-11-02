"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import { LyricsLookup } from "@/components/lyrics-lookup";
import type { LyricsSourceMeta } from "@/types/lyrics-source";
import { LYRICS_SOURCE_NAMES } from "@/lib/lyrics-provenance";
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
import { TabBar, TextPill } from "@/components/editorial-interactive";

const DEMO_LYRICS = `うるさく鳴いた文字盤を見てた
きっときっと鏡越し 8時過ぎのにおい
しらけた顔 変わってなくてよかった`;

type State =
  | { kind: "idle" }
  | { kind: "analyzing" }
  | { kind: "error"; message: string };

export default function NewSongPage() {
  const router = useRouter();
  const [lyrics, setLyrics] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [lyricsSource, setLyricsSource] = useState<LyricsSourceMeta>();

  async function handleAnalyze() {
    if (!lyrics.trim()) return;
    setState({ kind: "analyzing" });
    try {
      const res = await fetch("/api/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lyrics, title, artist, youtubeUrl, lyricsSource }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setState({ kind: "error", message: data.error ?? "分析失败" });
        return;
      }
      router.push(`/song/${data.id}`);
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "网络错误",
      });
    }
  }

  return (
    <PageFrame>
      <MobileTopBar
        title="新建"
        right={
          <>
            <VoicePicker />
            <ThemeToggle />
          </>
        }
      />

      <div className="hidden md:block">
        <Masthead
          title="新建"
          sub="Paste Japanese lyrics — Rin will annotate."
          right={
            <DesktopNav
              items={[
                { href: "/", label: "Library", active: true },
                { href: "/vocabulary", label: "Vocabulary" },
                { href: "/import", label: "Import" },
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

      <AnimatePresence mode="wait">
        {state.kind === "idle" && (
          <motion.section
            key="form"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="mt-7 md:mt-10 grid md:grid-cols-[1fr_320px] gap-8 md:gap-12"
          >
            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-3">
                <LabeledInput label="Title" value={title} onChange={value => { setTitle(value); setLyricsSource(undefined); }} placeholder="歌名" />
                <LabeledInput label="Artist" value={artist} onChange={value => { setArtist(value); setLyricsSource(undefined); }} placeholder="歌手" />
              </div>

              <LyricsLookup title={title} artist={artist} onUse={candidate => {
                setLyrics(candidate.lyrics);
                setLyricsSource(candidate.source);
              }} />

              <LabeledInput
                label="YouTube URL"
                value={youtubeUrl}
                onChange={setYoutubeUrl}
                placeholder="https://youtube.com/watch?v=..."
                type="url"
              />

              <div>
                <Smallcaps>Lyrics</Smallcaps>
                <textarea
                  value={lyrics}
                  onChange={(e) => {
                    setLyrics(e.target.value);
                    setLyricsSource(current => current ? { ...current, edited: true } : { provider: "manual" });
                  }}
                  rows={12}
                  placeholder={`粘贴日文歌词(支持 LRC 或纯文本)\n\n${DEMO_LYRICS}`}
                  className="mt-1.5 block w-full font-serif-jp jp text-[17px] md:text-[18px] leading-[1.8] px-4 py-3.5 bg-paper-deep/40 border border-rule focus:border-ink outline-none text-ink placeholder:text-ink-mute resize-y min-h-[260px]"
                />
              </div>

              {lyricsSource && <p className="text-xs text-ink-soft">当前原文来源：{LYRICS_SOURCE_NAMES[lyricsSource.provider]}{lyricsSource.edited ? " · 已手工修改" : ""}</p>}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => { setLyrics(DEMO_LYRICS); setLyricsSource({ provider: "manual" }); }}
                  className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute hover:text-ink transition self-start sm:self-auto"
                >
                  use sample lyrics
                </button>
                <TextPill
                  onClick={handleAnalyze}
                  disabled={!lyrics.trim()}
                  tone="solid"
                  icon={<Sparkles className="w-3 h-3" strokeWidth={1.5} />}
                >
                  Analyze &amp; save
                </TextPill>
              </div>
            </div>

            <aside className="md:pl-8 md:border-l border-rule">
              <Smallcaps>Editor&rsquo;s note</Smallcaps>
              <p className="font-serif italic text-[14px] md:text-[15px] text-ink-soft mt-2 leading-[1.55]">
                先查找现成歌词或粘贴原文，Rin 再用 Gemini 标注汉字注音、罗马音、逐词词性、自然中文翻译。有可靠 LRC 时间戳时可按行播放。
              </p>
              <div className="mt-5 p-3.5 border border-rule bg-paper-deep/60 font-serif text-[13px] text-ink leading-[1.55]">
                <span className="font-serif italic text-red font-medium">Tip · </span>
                贴频道 URL 批量导入：
                <span className="font-mono text-[11px] ml-1">@handle</span> 即可。
              </div>
            </aside>
          </motion.section>
        )}

        {state.kind === "analyzing" && (
          <motion.section
            key="analyzing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-24 md:py-32 gap-4"
          >
            <Loader2 className="w-7 h-7 text-red animate-spin" strokeWidth={1.5} />
            <div className="font-serif italic text-[18px] md:text-[22px] text-ink">
              Rin 正在分析歌词喵～
            </div>
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">
              Gemini · furigana · romaji · pos · zh
            </div>
          </motion.section>
        )}

        {state.kind === "error" && (
          <motion.section
            key="err"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 border border-red p-5 bg-[color-mix(in_srgb,var(--red)_8%,transparent)]"
          >
            <Smallcaps tone="red">Error</Smallcaps>
            <p className="font-serif text-[15px] text-ink mt-2">
              {state.message}
            </p>
            <button
              type="button"
              onClick={() => setState({ kind: "idle" })}
              className="font-mono text-[10px] tracking-[0.18em] uppercase text-red hover:text-red-soft mt-4"
            >
              try again →
            </button>
          </motion.section>
        )}
      </AnimatePresence>

      <Colophon>
        <span>New · manual entry</span>
        <span className="text-center">—— 现成歌词 · gemini ——</span>
        <span className="hidden sm:inline text-right">UtaTen · 歌ネット · LRCLIB</span>
      </Colophon>

      <TabBar />
    </PageFrame>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <Smallcaps>{label}</Smallcaps>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 block w-full font-serif text-[16px] px-3 py-2 bg-transparent border border-rule focus:border-ink outline-none text-ink placeholder:text-ink-mute/70"
      />
    </label>
  );
}

"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Wand2,
  RotateCcw,
} from "lucide-react";
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
import type { ParsedShare } from "@/lib/share-parser";
import type { SongOutcome } from "@/lib/song-pipeline";
import { youtubeUrlFromShare } from "@/lib/song-source";

type PreviewData = {
  title: string;
  artist: string;
  originalArtist: string;
  sourceUrl: string;
  youtubeUrl: string;
  platform: string;
};

type State =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "preview"; data: PreviewData }
  | { kind: "ingesting"; data: PreviewData }
  | { kind: "done"; outcome: SongOutcome }
  | {
      kind: "error";
      message: string;
      back: "idle" | "preview";
      preview?: PreviewData;
    };

const EXAMPLE_TEXT = `夏川椎菜 (なつかわ しいな)/HoneyWorks《#超絶かわいい (#超绝可爱)》https://c6.y.qq.com/base/fcgi-bin/u?__=ZyoMoOddMgE1 @QQ音乐`;

export default function ShareImportPage() {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleParse() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setState({ kind: "parsing" });
    try {
      const res = await fetch("/api/import/share/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (data as { error?: string } | null)?.error ?? "AI 识别失败";
        setState({ kind: "error", message: msg, back: "idle" });
        return;
      }
      const parsed = data as ParsedShare;
      if (!parsed.title && !parsed.artist) {
        setState({
          kind: "error",
          message: "AI 没能识别出这段文本是音乐分享，主人确认一下输入？",
          back: "idle",
        });
        return;
      }
      setState({
        kind: "preview",
        data: {
          title: parsed.title,
          artist: parsed.artist,
          originalArtist: parsed.originalArtist,
          sourceUrl: parsed.sourceUrl,
          youtubeUrl: youtubeUrlFromShare(trimmed) || youtubeUrlFromShare(parsed.sourceUrl),
          platform: parsed.platform,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络错误";
      setState({ kind: "error", message: msg, back: "idle" });
    }
  }

  async function handleIngest(data: PreviewData) {
    setState({ kind: "ingesting", data });
    try {
      const res = await fetch("/api/import/share/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          artist: data.artist,
          sourceUrl: data.sourceUrl,
          youtubeUrl: data.youtubeUrl,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (body as { error?: string } | null)?.error ?? "导入失败";
        setState({
          kind: "error",
          message: msg,
          back: "preview",
          preview: data,
        });
        return;
      }
      const outcome = body as SongOutcome;
      if (outcome.kind === "fail") {
        setState({
          kind: "error",
          message: outcome.reason === "no_lyrics_no_video"
            ? "lrclib 没有找到歌名、歌手及版本匹配的歌词。请校对信息，或补充 YouTube 来源建立待转录歌曲。"
            : `导入未完成：${outcome.reason}`,
          back: "preview",
          preview: data,
        });
        return;
      }
      setState({ kind: "done", outcome });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络错误";
      setState({
        kind: "error",
        message: msg,
        back: "preview",
        preview: data,
      });
    }
  }

  function updatePreviewField<K extends keyof PreviewData>(
    key: K,
    value: PreviewData[K]
  ) {
    setState((s) =>
      s.kind === "preview" ? { ...s, data: { ...s.data, [key]: value } } : s
    );
  }

  return (
    <PageFrame>
      <MobileTopBar
        title="Share"
        right={
          <>
            <VoicePicker />
            <ThemeToggle />
          </>
        }
      />

      <div className="hidden md:block">
        <Masthead
          title="Share"
          sub="Daily · paste a share text to file."
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

      <div className="mt-4 flex items-center gap-3">
        <TextPill href="/import" tone="ghost">
          ← Import hub
        </TextPill>
      </div>

      <AnimatePresence mode="wait">
        {state.kind === "idle" && (
          <IdleSection
            text={text}
            setText={setText}
            onSubmit={handleParse}
            example={EXAMPLE_TEXT}
          />
        )}
        {state.kind === "parsing" && <ParsingSection />}
        {state.kind === "preview" && (
          <PreviewSection
            data={state.data}
            onChange={updatePreviewField}
            onConfirm={() => handleIngest(state.data)}
            onCancel={() => setState({ kind: "idle" })}
          />
        )}
        {state.kind === "ingesting" && (
          <IngestingSection data={state.data} />
        )}
        {state.kind === "done" && <DoneSection outcome={state.outcome} />}
        {state.kind === "error" && (
          <ErrorSection
            message={state.message}
            onBack={() => {
              if (state.back === "preview" && state.preview) {
                setState({ kind: "preview", data: state.preview });
              } else {
                setState({ kind: "idle" });
              }
            }}
            backLabel={
              state.back === "preview" ? "回到预览修改" : "重新粘贴"
            }
          />
        )}
      </AnimatePresence>

      <Colophon>
        <span>Import · share text</span>
        <span className="text-center">—— ai parse · lrclib · gemini ——</span>
        <span className="hidden sm:inline text-right">paste · review · file</span>
      </Colophon>

      <TabBar />
    </PageFrame>
  );
}

function IdleSection({
  text,
  setText,
  onSubmit,
  example,
}: {
  text: string;
  setText: (v: string) => void;
  onSubmit: () => void;
  example: string;
}) {
  return (
    <motion.section
      key="idle"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="grid md:grid-cols-[1.2fr_1fr] gap-8 md:gap-12 mt-5 md:mt-7"
    >
      <div>
        <Smallcaps>Source · share text</Smallcaps>
        <div className="mt-3 border border-ink bg-paper-deep/50">
          <textarea
            placeholder={`粘贴 QQ / 网易云 / Apple / Spotify 等平台的分享文本\n\n例如：\n${example}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="block w-full px-4 py-3.5 font-mono text-[13px] md:text-[14px] tracking-tight bg-transparent text-ink placeholder:text-ink-mute/60 outline-none border-b border-ink resize-y leading-[1.6]"
          />
          <div className="flex flex-col md:flex-row md:items-center justify-between px-4 py-2.5 gap-3 md:gap-4">
            <Smallcaps>ai · lrclib · gemini</Smallcaps>
            <TextPill
              onClick={onSubmit}
              tone="red"
              disabled={!text.trim()}
              icon={<Wand2 className="w-3 h-3" strokeWidth={1.5} />}
            >
              Identify with AI
            </TextPill>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setText(example)}
          className="mt-4 inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute hover:text-ink transition"
        >
          <Sparkles className="w-3 h-3" strokeWidth={1.5} />
          Try the example
        </button>
      </div>

      <aside className="md:pl-8 md:border-l border-rule">
        <Smallcaps>How Rin parses it</Smallcaps>
        <ul className="mt-3 space-y-3 font-serif text-[14px] md:text-[16px] text-ink leading-[1.55]">
          <li className="flex gap-3">
            <span className="font-serif italic text-red font-medium shrink-0">
              01.
            </span>
            Gemini 识别歌名、主唱、其他作者、来源平台
          </li>
          <li className="flex gap-3">
            <span className="font-serif italic text-red font-medium shrink-0">
              02.
            </span>
            主人在预览页校对（lrclib 搜不到时回来改一改）
          </li>
          <li className="flex gap-3">
            <span className="font-serif italic text-red font-medium shrink-0">
              03.
            </span>
            lrclib 拉歌词 · Gemini 注音 / 罗马音 / 翻译 / 词性 → 入库
          </li>
        </ul>
        <div className="mt-5 p-3.5 border border-rule bg-paper-deep/60 font-serif italic text-[13px] text-ink-soft leading-[1.5]">
          AI 识别及标注需要人工校对；耗时取决于歌词长度和模型服务。
        </div>
      </aside>
    </motion.section>
  );
}

function ParsingSection() {
  return (
    <motion.section
      key="parsing"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="mt-12 md:mt-20 flex flex-col items-center justify-center gap-4"
    >
      <Loader2 className="w-10 h-10 text-red animate-spin" strokeWidth={1.5} />
      <div className="font-serif italic text-[18px] md:text-[20px] text-ink text-center">
        Rin 正在请大模型识别喵～
      </div>
      <Smallcaps tone="soft">parsing share text · ~3s</Smallcaps>
    </motion.section>
  );
}

function PreviewSection({
  data,
  onChange,
  onConfirm,
  onCancel,
}: {
  data: PreviewData;
  onChange: <K extends keyof PreviewData>(
    key: K,
    value: PreviewData[K]
  ) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <motion.section
      key="preview"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="grid md:grid-cols-[1.2fr_1fr] gap-8 md:gap-12 mt-5 md:mt-7"
    >
      <div>
        <div className="flex items-center justify-between gap-3">
          <Smallcaps tone="red">Preview · review & edit</Smallcaps>
          {data.platform && (
            <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute border border-rule px-2 py-0.5">
              from {data.platform}
            </span>
          )}
        </div>

        <div className="mt-3 border border-ink bg-paper-deep/50 p-5 md:p-6 space-y-5">
          <PreviewField
            label="Title (歌名)"
            required
            value={data.title}
            onChange={(v) => onChange("title", v)}
            placeholder="歌名 · 必填"
            jp
          />
          <PreviewField
            label="Artist (主唱)"
            required
            value={data.artist}
            onChange={(v) => onChange("artist", v)}
            placeholder="主唱 · 必填 · lrclib 用此搜索"
            jp
          />
          <PreviewField
            label="YouTube 播放来源"
            value={data.youtubeUrl}
            onChange={(v) => onChange("youtubeUrl", v)}
            placeholder="可选 · YouTube URL 或 videoId"
            hint="其他音乐平台的分享链接不能内嵌播放。可在这里补充同一录音版本，或入库后再添加。"
          />
          <PreviewField
            label="Featured / Composer (合作者)"
            value={data.originalArtist}
            onChange={(v) => onChange("originalArtist", v)}
            placeholder="可选 · 留空"
            hint="ai parsed · informational · 入库以 lrclib 数据为准"
            jp
          />
          {data.sourceUrl && (
            <div>
              <Smallcaps>Source URL</Smallcaps>
              <div className="mt-1.5 font-mono text-[11px] text-ink-mute italic break-all">
                {data.sourceUrl}
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] uppercase text-ink-soft hover:text-ink transition"
          >
            <RotateCcw className="w-3 h-3" strokeWidth={1.5} />
            重新粘贴
          </button>
          <TextPill
            onClick={onConfirm}
            tone="red"
            disabled={!data.title.trim() || !data.artist.trim()}
            icon={<ArrowRight className="w-3 h-3" strokeWidth={1.5} />}
          >
            Confirm import
          </TextPill>
        </div>
      </div>

      <aside className="md:pl-8 md:border-l border-rule">
        <Smallcaps>Tips for hits</Smallcaps>
        <ul className="mt-3 space-y-3 font-serif text-[14px] text-ink leading-[1.55]">
          <li className="flex gap-3">
            <span className="font-serif italic text-red font-medium shrink-0">
              ·
            </span>
            <span>歌名用日文原文 / 罗马字（lrclib 多收日文）</span>
          </li>
          <li className="flex gap-3">
            <span className="font-serif italic text-red font-medium shrink-0">
              ·
            </span>
            <span>多人合唱取主唱（lrclib 通常按主唱建库）</span>
          </li>
          <li className="flex gap-3">
            <span className="font-serif italic text-red font-medium shrink-0">
              ·
            </span>
            <span>找不到时试试罗马字 / 日文交替</span>
          </li>
        </ul>
      </aside>
    </motion.section>
  );
}

function PreviewField({
  label,
  required,
  value,
  onChange,
  placeholder,
  hint,
  jp = false,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  jp?: boolean;
}) {
  return (
    <label className="block">
      <div className="flex items-center gap-2">
        <Smallcaps tone={required ? "ink" : "mute"}>{label}</Smallcaps>
        {required && (
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-red">
            required
          </span>
        )}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-1.5 block w-full px-3 py-2.5 bg-paper border border-rule focus:border-ink outline-none text-ink placeholder:text-ink-mute/60 ${
          jp
            ? "font-serif-jp jp text-[16px] md:text-[17px]"
            : "font-mono text-[13px]"
        }`}
      />
      {hint && (
        <div className="mt-1 font-mono text-[10px] tracking-tight italic text-ink-mute">
          {hint}
        </div>
      )}
    </label>
  );
}

function IngestingSection({ data }: { data: PreviewData }) {
  return (
    <motion.section
      key="ingesting"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="mt-12 md:mt-20 flex flex-col items-center justify-center gap-4 text-center"
    >
      <Loader2 className="w-10 h-10 text-red animate-spin" strokeWidth={1.5} />
      <div className="font-serif italic text-[18px] md:text-[20px] text-ink">
        Rin 正在帮 Peipei主人入库《
        <span className="font-serif-jp jp">{data.title}</span>》喵～
      </div>
      <Smallcaps tone="soft">lrclib · gemini · 请等待分析完成</Smallcaps>
    </motion.section>
  );
}

function DoneSection({ outcome }: { outcome: SongOutcome }) {
  return (
    <motion.section
      key="done"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-7 md:mt-10 max-w-2xl"
    >
      {outcome.kind === "ok" && (
        <div className="border border-ink bg-paper-deep/50 p-6 md:p-8">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-red" strokeWidth={1.5} />
            <Smallcaps tone="red">Filed</Smallcaps>
          </div>
          <h2 className="mt-3 font-serif-jp jp font-medium text-[24px] md:text-[32px] leading-tight text-ink">
            {outcome.songName}
          </h2>
          <div className="mt-2 font-serif italic text-[14px] md:text-[15px] text-ink-soft">
            {outcome.artistName} · {outcome.lines} lines ·{" "}
            {outcome.hasTimestamps ? "with timestamps" : "no timestamps"}
          </div>
          <div className="mt-6 flex items-center gap-3 flex-wrap">
            <TextPill
              href={`/song/${outcome.songId}`}
              tone="red"
              icon={<ArrowRight className="w-3 h-3" strokeWidth={1.5} />}
            >
              Open song
            </TextPill>
            <TextPill href="/import/share" tone="ghost">
              Import another
            </TextPill>
          </div>
        </div>
      )}
      {outcome.kind === "skip-existing" && (
        <div className="border border-rule bg-paper-deep/30 p-6 md:p-8">
          <Smallcaps>Already filed</Smallcaps>
          <h2 className="mt-3 font-serif italic font-medium text-[22px] md:text-[26px] text-ink">
            《{outcome.songName}》已经在库里了喵
          </h2>
          <div className="mt-2 font-serif italic text-[13px] md:text-[14px] text-ink-soft">
            {outcome.reason === "lrclib_id"
              ? "同一首歌词 · lrclib id 相同"
              : "同一个 youtube id"}
          </div>
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <TextPill href="/" tone="solid">
              Library
            </TextPill>
            <TextPill href="/import/share" tone="ghost">
              Import another
            </TextPill>
          </div>
        </div>
      )}
      {outcome.kind === "placeholder" && (
        <div className="border border-rule bg-paper-deep/30 p-6 md:p-8">
          <Smallcaps>Placeholder</Smallcaps>
          <h2 className="mt-3 font-serif italic font-medium text-[22px] md:text-[26px] text-ink">
            占位入库 · {outcome.songName}
          </h2>
          <div className="mt-5 flex items-center gap-3">
            <TextPill href={`/song/${outcome.songId}`} tone="red">
              Open
            </TextPill>
          </div>
        </div>
      )}
    </motion.section>
  );
}

function ErrorSection({
  message,
  onBack,
  backLabel,
}: {
  message: string;
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <motion.section
      key="error"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-7 md:mt-10 max-w-2xl"
    >
      <div className="border border-red p-5 md:p-6 flex items-start gap-3 bg-[color-mix(in_srgb,var(--red)_8%,transparent)]">
        <AlertTriangle
          className="w-5 h-5 text-red shrink-0 mt-0.5"
          strokeWidth={1.5}
        />
        <div className="min-w-0 flex-1">
          <div className="font-serif italic text-[15px] text-ink">
            出了点状况喵 (=•́ ω •̀=)
          </div>
          <div className="font-mono text-[11px] tracking-tight text-red-soft mt-1.5 break-all">
            {message}
          </div>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <TextPill onClick={onBack} tone="red">
          {backLabel}
        </TextPill>
        <TextPill href="/import" tone="ghost">
          ← Import hub
        </TextPill>
      </div>
    </motion.section>
  );
}

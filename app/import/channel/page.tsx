"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  Download,
  AlertTriangle,
  Mic,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { VoicePicker } from "@/components/voice-picker";
import type { IngestSummary, ProgressEvent } from "@/lib/ingest";
import {
  Colophon,
  DesktopNav,
  Masthead,
  MobileTopBar,
  PageFrame,
  Smallcaps,
} from "@/components/editorial-shell";
import { TabBar, TextPill } from "@/components/editorial-interactive";
import {
  LogBox,
  nowStamp,
  type LogEntry,
} from "@/components/import/progress-row";
import {
  StatsGrid,
  deriveFromEvents,
  type Derived,
} from "@/components/import/stat-card";
import { ResultSection, SkipLine } from "@/components/import/section";
import { streamSSE } from "@/lib/sse-client";

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; summary: IngestSummary }
  | { kind: "error"; message: string };

export default function ChannelImportPage() {
  const [channelUrl, setChannelUrl] = useState("");
  const [artistHint, setArtistHint] = useState("");
  const [limit, setLimit] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [log, setLog] = useState<LogEntry[]>([]);
  const progressListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = progressListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const derived = useMemo(() => deriveFromEvents(log), [log]);

  async function handleSubmit() {
    if (!channelUrl.trim()) return;
    setState({ kind: "running" });
    setLog([]);
    try {
      await streamSSE(
        "/api/ingest",
        {
          channelUrl: channelUrl.trim(),
          artistHint: artistHint.trim(),
          limit: limit ? Number(limit) : undefined,
        },
        {
          onEvent: (e) => {
            if (e.type === "progress") {
              setLog((prev) => [
                ...prev,
                { ...(e.data as ProgressEvent), ts: nowStamp() },
              ]);
            } else if (e.type === "done") {
              setState({ kind: "done", summary: e.data as IngestSummary });
            } else if (e.type === "error") {
              const d = e.data as { message?: string };
              setState({ kind: "error", message: d.message ?? "ingest 失败" });
            }
          },
        }
      );
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "网络错误",
      });
    }
  }

  const currentActive =
    derived.total !== null ? derived.total - derived.processed : null;

  return (
    <PageFrame>
      <MobileTopBar
        title="Channel"
        right={
          <>
            <VoicePicker />
            <ThemeToggle />
          </>
        }
      />

      <div className="hidden md:block">
        <Masthead
          title="Channel"
          sub="Bulk · YouTube channel ingest."
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
          <motion.section
            key="form"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="grid md:grid-cols-[1.1fr_1fr] gap-8 md:gap-12 mt-5 md:mt-7"
          >
            <div>
              <Smallcaps>Source · channel / url / id</Smallcaps>
              <div className="mt-3 border border-ink bg-paper-deep/50">
                <input
                  type="text"
                  placeholder="@akashimyu"
                  value={channelUrl}
                  onChange={(e) => setChannelUrl(e.target.value)}
                  className="block w-full px-4 py-3.5 font-mono text-[20px] md:text-[22px] tracking-tight bg-transparent text-ink placeholder:text-ink-mute/70 outline-none border-b border-ink"
                />
                <div className="flex flex-col md:flex-row md:items-center justify-between px-4 py-2.5 gap-3 md:gap-4">
                  <Smallcaps>
                    accepts · yt handles · full urls · BV-IDs · video ids
                  </Smallcaps>
                  <TextPill
                    onClick={handleSubmit}
                    tone="red"
                    disabled={!channelUrl.trim()}
                    icon={<Download className="w-3 h-3" strokeWidth={1.5} />}
                  >
                    Ingest
                  </TextPill>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
                <LabeledInput
                  label="Artist hint"
                  placeholder="用于搜索现成歌词"
                  value={artistHint}
                  onChange={setArtistHint}
                />
                <LabeledInput
                  label="Limit"
                  placeholder="最大视频数"
                  value={limit}
                  onChange={setLimit}
                  type="number"
                />
              </div>
            </div>

            <aside className="md:pl-8 md:border-l border-rule">
              <Smallcaps>How Rin files it</Smallcaps>
              <ul className="mt-3 space-y-3 font-serif text-[14px] md:text-[16px] text-ink leading-[1.55]">
                <li className="flex gap-3">
                  <span className="font-serif italic text-red font-medium shrink-0">
                    01.
                  </span>
                  yt-dlp 解析频道的所有视频
                </li>
                <li className="flex gap-3">
                  <span className="font-serif italic text-red font-medium shrink-0">
                    02.
                  </span>
                  先找现成歌词；未收录时可手工补充或转录
                </li>
                <li className="flex gap-3">
                  <span className="font-serif italic text-red font-medium shrink-0">
                    03.
                  </span>
                  Gemini 注音 / 罗马音 / 词性 / 翻译
                </li>
                <li className="flex gap-3">
                  <span className="font-serif italic text-red font-medium shrink-0">
                    04.
                  </span>
                  每首完成立即入库；断线续扫跳过已入库
                </li>
              </ul>
              <div className="mt-5 p-3.5 border border-rule bg-paper-deep/60 font-serif italic text-[13px] text-ink-soft leading-[1.5]">
                大频道要跑几分钟 · 保持页面开着呐～主 3.1 Lite (500 RPD) 过载自动降到 2.5 Lite (20 RPD)
              </div>
            </aside>
          </motion.section>
        )}

        {state.kind === "running" && (
          <motion.section
            key="running"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 md:mt-10"
          >
            <LiveRunning
              derived={derived}
              log={log}
              listRef={progressListRef}
              currentActive={currentActive}
            />
          </motion.section>
        )}

        {(state.kind === "done" || state.kind === "error") && (
          <motion.section
            key="result"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 md:mt-10 space-y-6"
          >
            {state.kind === "error" && (
              <div className="border border-red p-4 flex items-start gap-3 bg-[color-mix(in_srgb,var(--red)_8%,transparent)]">
                <AlertTriangle
                  className="w-5 h-5 text-red shrink-0 mt-0.5"
                  strokeWidth={1.5}
                />
                <div className="text-sm min-w-0">
                  <div className="font-serif italic text-[15px] text-ink">
                    连接中断 — 已入库的歌都保留了 (=^･ω･^=)
                  </div>
                  <div className="font-mono text-[10px] tracking-wide text-red-soft mt-1 break-all">
                    {state.message}
                  </div>
                  <div className="font-serif italic text-[12px] text-ink-mute mt-1">
                    💡 重跑同频道会自动跳过已入库 继续从断点往后扫
                  </div>
                </div>
              </div>
            )}

            <StatsGrid derived={derived} />

            <div className="grid md:grid-cols-[1.2fr_1fr] gap-8 md:gap-10">
              <div className="space-y-6">
                {derived.succeeded.length > 0 && (
                  <ResultSection
                    title={`Filed (${derived.succeeded.length})`}
                    icon={<CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.5} />}
                  >
                    {derived.succeeded.map((s) => (
                      <div
                        key={s.videoId}
                        className="flex items-baseline justify-between gap-3 py-2 border-b border-rule last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="font-serif-jp jp font-medium text-[15px] text-ink truncate">
                            {s.songName}
                          </div>
                          <div className="font-serif italic text-[12px] text-ink-soft">
                            {s.artistName} · {s.lines} lines ·{" "}
                            {s.hasTimestamps ? "with timestamps" : "no timestamps"}
                          </div>
                        </div>
                        <Link
                          href={`/song/${s.songId}`}
                          className="font-mono text-[10px] tracking-[0.18em] uppercase text-red hover:text-red-soft shrink-0"
                        >
                          open →
                        </Link>
                      </div>
                    ))}
                  </ResultSection>
                )}

                {derived.placeholders.length > 0 && (
                  <ResultSection
                    title={`Placeholders (${derived.placeholders.length})`}
                    icon={<Mic className="w-3.5 h-3.5" strokeWidth={1.5} />}
                    hint="暂未找到匹配歌词 · 已保留歌曲 · 去详情页补充原文或转录草稿"
                  >
                    {derived.placeholders.map((p) => (
                      <div
                        key={p.videoId}
                        className="flex items-baseline justify-between gap-3 py-2 border-b border-rule last:border-b-0"
                      >
                        <div className="font-serif-jp jp font-medium text-[15px] text-ink truncate min-w-0">
                          {p.songName}
                        </div>
                        <Link
                          href={`/song/${p.songId}`}
                          className="font-mono text-[10px] tracking-[0.18em] uppercase text-red hover:text-red-soft shrink-0"
                        >
                          transcribe →
                        </Link>
                      </div>
                    ))}
                  </ResultSection>
                )}

                {derived.failed.length > 0 && (
                  <ResultSection
                    title={`Failed (${derived.failed.length})`}
                    icon={<XCircle className="w-3.5 h-3.5" strokeWidth={1.5} />}
                  >
                    {derived.failed.map((f) => (
                      <div
                        key={f.videoId}
                        className="py-2 border-b border-rule last:border-b-0"
                      >
                        <div className="font-serif-jp jp font-medium text-[15px] text-ink truncate">
                          {f.songName}
                        </div>
                        <div className="font-mono text-[10px] tracking-wide text-red-soft break-all">
                          {f.reason}
                        </div>
                      </div>
                    ))}
                  </ResultSection>
                )}
              </div>

              <aside className="md:pl-8 md:border-l border-rule">
                <Smallcaps>Skips</Smallcaps>
                <ul className="mt-3 space-y-1.5 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute">
                  <SkipLine label="Non-song" n={derived.skippedNotSong.length} />
                  <SkipLine
                    label="Short (<60s)"
                    n={derived.skippedShort.length}
                  />
                  <SkipLine label="Already filed" n={derived.skippedExisting.length} />
                  <SkipLine label="Events total" n={log.length} />
                </ul>

                <div className="mt-6">
                  <Smallcaps>Transcription log</Smallcaps>
                  <LogBox log={log} className="mt-2 max-h-[240px]" />
                </div>

                <div className="mt-6 flex gap-2">
                  <TextPill
                    onClick={() => {
                      setState({ kind: "idle" });
                      setLog([]);
                    }}
                  >
                    Run again
                  </TextPill>
                  <TextPill href="/" tone="solid">
                    Back to library →
                  </TextPill>
                </div>
              </aside>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <Colophon>
        <span>Import · channel ingest</span>
        <span className="text-center">—— yt-dlp · 现成歌词 · gemini ——</span>
        <span className="hidden sm:inline text-right">SSE · auto-resume</span>
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
        className="mt-1.5 block w-full font-mono text-[13px] px-3 py-2 bg-transparent border border-rule focus:border-ink outline-none text-ink placeholder:text-ink-mute/70"
      />
    </label>
  );
}

function LiveRunning({
  derived,
  log,
  listRef,
  currentActive,
}: {
  derived: Derived;
  log: LogEntry[];
  listRef: React.RefObject<HTMLDivElement | null>;
  currentActive: number | null;
}) {
  return (
    <div className="grid md:grid-cols-[1.2fr_1fr] gap-8 md:gap-10">
      <div>
        <div className="flex items-baseline justify-between pb-2.5 border-b border-ink">
          <Smallcaps tone="ink">Queue · live</Smallcaps>
          <span className="font-mono text-[10px] tracking-[0.18em] text-red">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red mr-1 align-middle animate-pulse" />
            SSE
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-red animate-spin" strokeWidth={1.5} />
          <span className="font-serif italic text-[15px] md:text-[16px] text-ink">
            Rin 正在跑喵～已处理{" "}
            <span className="font-mono text-red tabular">{derived.processed}</span>
            {derived.total !== null && (
              <>
                {" / "}
                <span className="font-mono tabular">{derived.total}</span>
              </>
            )}
            {" · "}
            <span className="text-ink-soft">
              ✓{derived.succeeded.length} · 🎤{derived.placeholders.length} · ✗
              {derived.failed.length}
            </span>
          </span>
        </div>
        {currentActive !== null && currentActive > 0 && (
          <div className="mt-1 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute">
            ≈ {currentActive} queued
          </div>
        )}

        <StatsGrid derived={derived} />
      </div>

      <aside className="md:pl-8 md:border-l border-rule">
        <Smallcaps>Transcription log</Smallcaps>
        <LogBox
          log={log}
          className="mt-2 max-h-[60vh] md:max-h-[calc(100vh-260px)]"
          ref={listRef}
        />
      </aside>
    </div>
  );
}

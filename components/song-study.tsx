"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, FolderOpen, Guitar, Settings2, X, Play, Pause, Repeat2, Loader2, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildChordTimeline } from "@/lib/chord-timeline";
import type { SongFull } from "@/types/lyrics";
import { usePlayer } from "./player-context";
import { formatDuration } from "./editorial-shell";
import { EditorialPlayerPlate } from "./youtube-player";
import { LyricLine } from "./lyric-line";
import { InstrumentalChords } from "./instrumental-chords";
import { SongEditor } from "./song-editor";
import { PracticeStudio } from "./practice-studio";
import { SongInterpretationPanel, useSongInterpretation } from "./song-interpretation";
import { VoicePicker } from "./voice-picker";
import { ThemeToggle } from "./theme-toggle";
import { RetranscribeButton } from "./retranscribe-button";
import { DeleteSongButton } from "./delete-song-button";
import { usePractice } from "./practice-context";

const TOOLS = [
  { id: "interpretation", label: "解读", icon: BookOpen },
  { id: "practice", label: "练习", icon: Guitar },
  { id: "resources", label: "资料", icon: FolderOpen },
  { id: "settings", label: "设置", icon: Settings2 },
] as const;
export type StudyPanel = typeof TOOLS[number]["id"];

function PlaybackControls({ onPractice }: { onPractice: () => void }) {
  const player = usePlayer();
  const rates = [...new Set([...(player?.availableRates ?? [0.5, 0.75, 1]), player?.playbackRate ?? 1])].sort((a, b) => a - b);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <button type="button" disabled={!player?.available} onClick={player?.playing ? player.pause : player?.play}
        aria-label={player?.playing ? "暂停原曲" : "播放原曲"}
        className="flex size-11 shrink-0 items-center justify-center border border-ink bg-ink text-paper disabled:opacity-35">
        {player?.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
      <span className="font-mono text-[11px] tabular-nums text-ink-soft" aria-label="播放时间">
        {formatDuration(player?.currentTime)} / {formatDuration(player?.duration)}
      </span>
      <label className="ml-auto flex min-h-11 items-center gap-1.5 text-xs text-ink-soft md:ml-3">
        原曲
        <select aria-label="原曲倍速" value={player?.playbackRate ?? 1} disabled={!player?.available}
          onChange={event => player?.setPlaybackRate(Number(event.target.value))}
          className="min-h-11 bg-transparent px-1 text-ink disabled:opacity-40">
          {rates.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
      </label>
      <button type="button" aria-label={player?.loopEnabled ? "关闭循环" : player?.loopRange ? "开启循环" : "设置循环"}
        aria-pressed={Boolean(player?.loopEnabled)} disabled={!player?.available}
        onClick={() => player?.loopRange ? player.setLoopEnabled(!player.loopEnabled) : onPractice()}
        className={cn("flex size-11 shrink-0 items-center justify-center border disabled:opacity-35", player?.loopEnabled ? "border-red bg-red/5 text-red" : "border-rule text-ink-soft")}>
        <Repeat2 className="size-4" />
      </button>
    </div>
  );
}

export function SongStudy({ song, scoreSources, externalAudioLinks }: {
  song: SongFull;
  scoreSources: ReactNode;
  externalAudioLinks: ReactNode;
}) {
  const { practice } = usePractice();
  const [panel, setPanel] = useState<StudyPanel | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hasLyrics = song.analyzed.lines.length > 0;
  const scoreRows = useMemo(() => buildChordTimeline(song.analyzed.lines, practice.data.chords, song.durationSec),
    [song.analyzed.lines, practice.data.chords, song.durationSec]);
  const action = useSongInterpretation({ songId: song.id, updatedAt: song.updatedAt, interpretation: song.interpretation, hasLyrics });
  const isOpen = panel !== null;
  const sourceUrl = song.analyzed.youtubeUrl || song.analyzed.transcriptionSourceUrl ||
    ((song.analyzed.youtubeId || song.youtubeId) ? `https://www.youtube.com/watch?v=${song.analyzed.youtubeId || song.youtubeId}` : "");

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
    };
  }, [isOpen]);

  function openPanel(next: StudyPanel) {
    if (!isOpen) triggerRef.current = document.activeElement as HTMLElement | null;
    if (next !== panel) contentRef.current?.scrollTo({ top: 0 });
    setPanel(next);
    if (next === "interpretation" && !action.interpretation) void action.interpret();
  }

  function toolButtons(inDialog = false) {
    return TOOLS.map(({ id, label, icon: Icon }) => (
      <button key={id} type="button" onClick={() => openPanel(id)} aria-label={label}
        aria-haspopup={inDialog ? undefined : "dialog"} aria-pressed={panel === id}
        className={cn("relative flex min-h-11 min-w-11 flex-1 items-center justify-center gap-1.5 px-2 text-xs transition md:min-w-20 md:px-3",
          panel === id ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep hover:text-ink")}>
        {id === "interpretation" && action.busy ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Icon className="size-4 shrink-0" strokeWidth={1.6} />}
        <span className="whitespace-nowrap">{label}</span>
        {id === "interpretation" && !action.busy && (action.error || action.interpretation) ? (
          <span className={cn("size-1.5 shrink-0 rounded-full", action.error || action.interpretation?.stale ? "bg-red" : "bg-ink-mute")}
            aria-label={action.error ? "解读失败" : action.interpretation?.stale ? "解读待更新" : "已有解读"} />
        ) : null}
      </button>
    ));
  }

  return (
    <>
      <header className="mb-4">
        <div className="flex items-center justify-between gap-4 text-xs text-ink-soft">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 hover:text-red"><ArrowLeft className="size-4" />歌库</Link>
          <span className="font-mono text-[10px] tracking-[0.18em]">UTAHON / 歌曲学习</span>
        </div>
        <h1 className="jp break-words font-serif-jp text-[28px] font-medium leading-tight text-ink md:text-[38px]">{song.title}</h1>
        <p className="mt-2 text-xs text-ink-soft">{song.artist || "未知歌手"} · {song.linesCount} 行{song.durationSec > 0 ? ` · ${formatDuration(song.durationSec)}` : ""}</p>
      </header>

      <div className="mb-4 max-w-xl">
        <EditorialPlayerPlate compact emptyFallback={
          <button type="button" onClick={() => openPanel("resources")} className="w-full border border-dashed border-rule px-3 py-3 text-left text-sm text-ink-soft hover:border-ink">
            尚无可播放音频 · 打开资料添加
          </button>
        } />
      </div>

      <div className="sticky top-0 z-30 mb-5 border-y border-ink bg-paper pt-2 shadow-[0_4px_0_var(--paper)] md:flex md:items-center md:justify-between md:gap-6 md:py-2" aria-label="学习工具条">
        <PlaybackControls onPractice={() => openPanel("practice")} />
        <div className="mt-1 flex border-t border-rule md:mt-0 md:shrink-0 md:border-t-0 md:border-l" aria-label="歌曲工具">{toolButtons()}</div>
        <span role="status" className="sr-only">{action.busy ? "歌曲解读正在进行，可以继续学习" : action.error ? "歌曲解读失败，请打开解读查看" : ""}</span>
      </div>

      <section aria-label="歌词与和弦" className="mx-auto max-w-4xl">
        {scoreRows.map(row => row.kind === "lyrics"
          ? <LyricLine key={`line-${row.lineIndex}`} line={song.analyzed.lines[row.lineIndex]} index={row.lineIndex} chords={row.chords} />
          : <InstrumentalChords key={`gap-${row.startTime}-${row.endTime}`} label={row.label}
              startTime={row.startTime} endTime={row.endTime} chords={row.chords} />)}
        {!hasLyrics ? (
          <div className="py-8 text-center">
            <h2 className="font-serif text-xl">准备好歌词，就能开始学习</h2>
            <p className="my-3 text-sm text-ink-soft">查找现成歌词，或导入自己的歌词原文。</p>
            <button type="button" onClick={() => openPanel("resources")} className="min-h-11 border border-ink px-4 text-sm">添加歌词</button>
          </div>
        ) : null}
      </section>

      <dialog ref={dialogRef} aria-labelledby="study-panel-heading" onCancel={event => { event.preventDefault(); setPanel(null); }}
        onClose={() => setPanel(null)}
        onClick={event => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setPanel(null);
        }}
        className="fixed inset-x-0 bottom-0 top-auto m-0 h-[85dvh] max-h-[85dvh] w-full max-w-none overflow-hidden rounded-t-2xl border border-rule bg-paper p-0 text-ink shadow-2xl backdrop:bg-black/30 md:inset-y-0 md:left-auto md:right-0 md:h-dvh md:max-h-dvh md:w-[480px] md:rounded-none">
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 border-b border-rule px-4 pt-2 md:px-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="study-panel-heading" className="font-serif text-xl">{TOOLS.find(tool => tool.id === panel)?.label || "歌曲工具"}</h2>
              <button type="button" autoFocus aria-label="关闭面板" onClick={() => setPanel(null)} className="flex size-11 items-center justify-center hover:bg-paper-deep"><X className="size-5" /></button>
            </div>
            <div className="flex" aria-label="切换歌曲工具">{toolButtons(true)}</div>
          </div>
          <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-5">
            <div hidden={panel !== "interpretation"}>
              <SongInterpretationPanel action={action} hasLyrics={hasLyrics} />
              {!hasLyrics ? <button type="button" onClick={() => openPanel("resources")} className="mt-4 min-h-11 border border-rule px-3 text-sm">去添加歌词</button> : null}
            </div>
            <div hidden={panel !== "resources"} className="space-y-3">
              <details className="study-details">
                <summary>歌词与播放来源</summary>
                <SongEditor songId={song.id} lyrics={song.lyrics} title={song.title} artist={song.originalArtist || song.artist}
                  durationSec={song.durationSec || undefined} lyricsSource={song.analyzed.lyricsSource} youtubeUrl={song.analyzed.youtubeUrl} updatedAt={song.updatedAt} />
                {song.analyzed.transcriptionSourceUrl?.includes("bilibili.com") ? <p className="mt-3 text-xs text-ink-soft">来源为 Bilibili，可在音频分组中保存同版音频练习，或<a href={song.analyzed.transcriptionSourceUrl} target="_blank" rel="noopener noreferrer" className="underline">打开原视频</a>。</p> : null}
                <div className="mt-3">{externalAudioLinks}</div>
              </details>
              <details className="study-details"><summary>找现成乐谱</summary>{scoreSources}</details>
            </div>
            <PracticeStudio title={song.title} artist={song.artist} lines={song.analyzed.lines} sourceUrl={sourceUrl} songUpdatedAt={song.updatedAt} panel={panel} />
            <div hidden={panel !== "resources"} className="mt-3">
              <details className="study-details"><summary>重新转录与删除</summary>
                <div className="mt-3 flex flex-wrap gap-3">
                  <RetranscribeButton songId={song.id} updatedAt={song.updatedAt} currentSourceUrl={sourceUrl} hasPracticeAudio={practice.hasAudio} />
                  <DeleteSongButton songId={song.id} songTitle={song.title} />
                </div>
              </details>
            </div>
            <div hidden={panel !== "settings"}>
              <p className="mb-4 text-sm text-ink-soft">以下速度只用于日语朗读；原曲歌声速度在学习工具条调整。</p>
              <VoicePicker inline />
              <div className="mt-6 flex items-center justify-between border-t border-rule pt-4"><span className="text-sm">页面主题</span><ThemeToggle /></div>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}

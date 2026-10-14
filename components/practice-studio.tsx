"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  Download,
  Gauge,
  Guitar,
  Loader2,
  Pencil,
  Plus,
  Repeat2,
  Save,
  Scissors,
  Trash2,
  Upload,
} from "lucide-react";
import { TextPill } from "./editorial-interactive";
import { Smallcaps, formatDuration } from "./editorial-shell";
import { usePlayer } from "./player-context";
import { usePractice } from "./practice-context";
import {
  anchorChordsToLines,
  simplifyChordSymbol,
  transposeChord,
} from "@/lib/practice-schema";
import { cn } from "@/lib/utils";
import type { AnalyzedLine } from "@/types/lyrics";
import type { ChordEvent, PracticeDataV1, SongSection } from "@/types/practice";
import type { PracticeTrack } from "@/types/practice";

const PADDING_OPTIONS = [0, 0.5, 1, 2];
const MIXER_TRACKS: Array<{ track: PracticeTrack; label: string }> = [
  { track: "vocals", label: "人声" },
  { track: "drums", label: "鼓" },
  { track: "bass", label: "贝斯" },
  { track: "other", label: "其他" },
];
const SECTION_LABELS: Array<{ value: SongSection["label"]; label: string }> = [
  { value: "intro", label: "前奏" },
  { value: "verse", label: "主歌" },
  { value: "chorus", label: "副歌" },
  { value: "bridge", label: "桥段" },
  { value: "break", label: "间奏" },
  { value: "solo", label: "独奏" },
  { value: "outro", label: "尾奏" },
  { value: "custom", label: "自定" },
];

function seconds(value: number): string {
  return value.toFixed(2);
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function downloadText(name: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function chordProText(
  title: string,
  artist: string,
  lines: AnalyzedLine[],
  data: PracticeDataV1
): string {
  const header = [`{title: ${title}}`, `{artist: ${artist || "Unknown"}}`];
  if (data.capo > 0) header.push(`{capo: ${data.capo}}`);
  const body = lines.map((line, lineIndex) => {
    const chords = data.chords
      .filter((chord) => chord.lineIndex === lineIndex)
      .map((chord) => ({
        ...chord,
        symbol: transposeChord(
          data.chordDisplay === "simple" ? simplifyChordSymbol(chord.symbol) : chord.symbol,
          -data.capo
        ),
      }));
    if (chords.length === 0) return line.original;
    if (line.tokens.length === 0) {
      return `${chords.map((chord) => `[${chord.symbol}]`).join("")}${line.original}`;
    }
    const before = new Map<number, string[]>();
    for (const chord of chords) {
      const tokenIndex = Math.max(0, Math.min(line.tokens.length - 1, chord.tokenIndex ?? 0));
      before.set(tokenIndex, [...(before.get(tokenIndex) ?? []), chord.symbol]);
    }
    return line.tokens
      .map((token, tokenIndex) => `${(before.get(tokenIndex) ?? []).map((chord) => `[${chord}]`).join("")}${token.surface}`)
      .join("");
  });
  return [...header, "", ...body, ""].join("\n");
}

function NumericInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="font-mono text-[8px] tracking-[0.16em] uppercase text-ink-mute">{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={seconds(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full min-w-0 border border-rule bg-paper px-2 py-1.5 font-mono text-[11px] tabular outline-none focus:border-ink"
      />
    </label>
  );
}

export function PracticeStudio({
  title,
  artist,
  lines,
  sourceUrl,
  songUpdatedAt,
}: {
  title: string;
  artist: string;
  lines: AnalyzedLine[];
  sourceUrl: string;
  songUpdatedAt: number;
}) {
  const { practice, saving, saveData, uploadAudio, downloadSourceAudio, refreshPractice } = usePractice();
  const router = useRouter();
  const player = usePlayer();
  const fileInput = useRef<HTMLInputElement>(null);
  const commandInput = useRef<HTMLTextAreaElement>(null);
  const sourceRequest = useRef(false);
  const selectLocalAfterRefresh = useRef<number | null>(null);
  const [sourceDraft, setSourceDraft] = useState<{ base: string; value: string } | null>(null);
  const sourceInput = sourceDraft?.base === sourceUrl ? sourceDraft.value : sourceUrl;
  const [downloading, setDownloading] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const [draftState, setDraftState] = useState<{ data: PracticeDataV1; updatedAt: number } | null>(null);
  const draft = draftState?.data ?? practice.data;
  const hasNewResults = draftState !== null && practice.updatedAt !== draftState.updatedAt;
  const [editing, setEditing] = useState(false);
  const [loopStart, setLoopStart] = useState<number | null>(null);
  const [loopEnd, setLoopEnd] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const analysisCommand = `cd /Users/boring/Code/Workstation/utahon/audio-worker && uv run --no-sync python utahon_analyze.py --song '${practice.songId.replaceAll("'", "'\\''")}'`;

  useEffect(() => {
    if (selectLocalAfterRefresh.current !== null && songUpdatedAt !== selectLocalAfterRefresh.current) {
      selectLocalAfterRefresh.current = null;
      player?.selectSource("local");
    }
  }, [songUpdatedAt, player]);

  function setDraft(update: (current: PracticeDataV1) => PracticeDataV1): void {
    setDraftState((current) => ({
      data: update(current?.data ?? practice.data),
      updatedAt: current?.updatedAt ?? practice.updatedAt,
    }));
  }

  async function handleRefresh(): Promise<void> {
    if (draftState && !window.confirm("载入最新结果会放弃未保存的练习修改，继续吗？")) return;
    try {
      await refreshPractice();
      setDraftState((current) => current === draftState ? null : current);
      setError("");
      setNotice("已载入最新练习数据");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "刷新失败");
    }
  }

  const rates = useMemo(
    () => Array.from(new Set(player?.availableRates ?? [0.5, 0.75, 1])).sort((a, b) => a - b),
    [player?.availableRates]
  );

  function updateChord(id: string, patch: Partial<ChordEvent>): void {
    setDraft((current) => ({
      ...current,
      chords: current.chords.map((chord) =>
        chord.id === id ? { ...chord, ...patch, edited: true, source: "manual" } : chord
      ),
    }));
  }

  function updateSection(id: string, patch: Partial<SongSection>): void {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === id ? { ...section, ...patch, edited: true, source: "manual" } : section
      ),
    }));
  }

  async function handleSave(): Promise<void> {
    setNotice("");
    setError("");
    try {
      const anchored = { ...draft, chords: anchorChordsToLines(draft.chords, lines) };
      await saveData(anchored, draftState?.updatedAt ?? practice.updatedAt);
      setDraftState(null);
      setNotice("练习设置已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    }
  }

  async function handleUpload(file: File | undefined): Promise<void> {
    if (!file) return;
    if (draftState && !window.confirm("上传音频会放弃未保存的练习修改，继续吗？")) {
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setNotice("");
    setError("");
    try {
      await uploadAudio(file);
      player?.selectSource("local");
      selectLocalAfterRefresh.current = songUpdatedAt;
      setDraftState(null);
      setNotice("音频已保存，可以立即慢放和循环；如需和弦与分轨，请在 Mac 手工运行下方命令。");
      router.refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "音频上传失败");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleSourceDownload(): Promise<void> {
    if (sourceRequest.current || saving) return;
    if (!sourceInput.trim()) {
      setError("请填写这首歌的 YouTube 链接、视频 ID 或 BV 号；也可以上传音频。");
      setNotice("");
      return;
    }
    if (draftState && !window.confirm("取得新音频成功后会放弃未保存的练习修改，继续吗？失败时草稿仍会保留。")) return;
    const replaceExisting = Boolean(practice.hasAudio || practice.audioSha256);
    if (replaceExisting && !window.confirm("替换练习音频，并清除不再匹配的自动和弦和分轨；人工修改会尽量保留。请确认与歌词是同一录音版本，继续吗？")) return;
    sourceRequest.current = true;
    setDownloading(true);
    setNotice("");
    setError("");
    try {
      await downloadSourceAudio({
        sourceInput: sourceInput.trim(),
        songUpdatedAt,
        baseUpdatedAt: practice.updatedAt,
        replaceExisting,
      });
      player?.selectSource("local");
      selectLocalAfterRefresh.current = songUpdatedAt;
      setDraftState(null);
      setSourceDraft(null);
      setNotice("音频已保存，已切到练习音频，可以慢放和循环。再在 Mac 运行下方命令分析，和弦与分轨会自动同步回来。");
      router.refresh();
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "取得音频失败");
      router.refresh();
    } finally {
      sourceRequest.current = false;
      setDownloading(false);
    }
  }

  async function copyAnalysisCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(analysisCommand);
      setCopyNotice("已复制，在这台 Mac 的终端粘贴运行即可。");
    } catch {
      commandInput.current?.focus();
      commandInput.current?.select();
      setCopyNotice("浏览器未允许复制，已选中命令；请手动复制。");
    }
  }

  function markLoopEnd(): void {
    if (!player) return;
    const end = player.currentTime;
    setLoopEnd(end);
    if (loopStart !== null && end > loopStart) {
      player.setLoopRange({ startTime: loopStart, endTime: end });
      player.setLoopEnabled(true);
    }
  }

  function addChord(): void {
    const startTime = player?.currentTime ?? 0;
    const chord: ChordEvent = {
      id: createId("chord"),
      startTime,
      endTime: Math.min(player?.duration || startTime + 2, startTime + 2),
      symbol: "C",
      simplifiedSymbol: "C",
      source: "manual",
      edited: true,
    };
    setDraft((current) => ({
      ...current,
      chords: [...current.chords, chord].sort((a, b) => a.startTime - b.startTime),
    }));
  }

  function addSection(): void {
    const knownDuration = player?.duration ?? 0;
    const rawStart = player?.loopRange?.startTime ?? player?.currentTime ?? 0;
    const startTime = knownDuration > 0
      ? Math.min(rawStart, Math.max(0, knownDuration - 0.1))
      : rawStart;
    const maxEnd = knownDuration > 0 ? knownDuration : startTime + 20;
    const proposedEnd = player?.loopRange?.endTime ?? Math.min(maxEnd, startTime + 20);
    const endTime = Math.min(maxEnd, Math.max(startTime + 0.1, proposedEnd));
    const section: SongSection = {
      id: createId("section"),
      label: "custom",
      title: "练习段",
      startTime,
      endTime,
      source: "manual",
      edited: true,
    };
    setDraft((current) => ({
      ...current,
      sections: [...current.sections, section].sort((a, b) => a.startTime - b.startTime),
    }));
  }

  return (
    <section className="mt-8 md:mt-10 border-y border-ink py-5 md:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Smallcaps tone="red">Guitar practice</Smallcaps>
          <h2 className="font-serif italic text-[28px] md:text-[34px] leading-none text-ink mt-1.5">
            弹唱练习台
          </h2>
          <p className="font-serif text-[13px] md:text-[14px] text-ink-soft mt-2">
            从歌曲视频取得音频，或上传自己的版本；慢放不变调、划 A/B 循环，再按需生成和弦与分轨。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.m4a,.mp3,.wav,.flac,.ogg"
            className="hidden"
            onChange={(event) => void handleUpload(event.target.files?.[0])}
          />
          <TextPill
            onClick={() => fileInput.current?.click()}
            disabled={saving}
            icon={saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          >
            {practice.hasAudio ? "替换音频文件" : "上传音频文件"}
          </TextPill>
          <TextPill
            onClick={() => setEditing((value) => !value)}
            active={editing}
            icon={<Pencil className="w-3 h-3" />}
          >
            Edit
          </TextPill>
        </div>
      </div>

      <form
        className="mt-4 border border-rule bg-paper-deep/35 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSourceDownload();
        }}
      >
        <label htmlFor={`practice-source-${practice.songId}`} className="font-serif text-[15px] text-ink">
          从视频取得音频
        </label>
        <p className="mt-1 font-serif text-[13px] text-ink-soft leading-relaxed">
          {sourceUrl
            ? "已填入这首歌的来源，也可以换成同一录音版本的 YouTube / Bilibili 视频。"
            : "这首歌还没有视频来源。补充 YouTube / Bilibili 链接或视频 ID，即可取得音频，无需先下载到电脑。"}
          歌名或音乐平台分享链接不能直接用于下载；来源无法下载时仍可上传文件。
        </p>
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <input
            id={`practice-source-${practice.songId}`}
            value={sourceInput}
            onChange={(event) => setSourceDraft({ base: sourceUrl, value: event.target.value })}
            disabled={saving || downloading}
            placeholder="YouTube 链接 / 视频 ID / BV 号"
            autoComplete="off"
            className="w-full min-w-0 flex-1 border border-rule bg-paper px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-ink disabled:opacity-60"
          />
          <TextPill
            type="submit"
            tone="solid"
            disabled={saving || downloading}
            className="justify-center shrink-0"
            icon={downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          >
            {downloading ? "正在取得音频…" : "从视频取得音频"}
          </TextPill>
        </div>
        <p role="status" className="mt-2 font-serif text-[12px] text-ink-soft leading-relaxed">
          {downloading
            ? "VPS 正在下载并检查音频，完成后才替换旧文件。请稍候，不要重复提交；此步骤不会启动 Mac 分析。"
            : "取得音频 → 可立即慢放 / 循环 → 在 Mac 按需运行分析 → 和弦 / 分轨自动传回。请确认音频与歌词是同一版本。"}
        </p>
        {error || notice ? (
          <p role={error ? "alert" : "status"} className={cn("mt-2 font-serif text-[13px]", error ? "text-red" : "text-ink-soft")}>
            {error || notice}
          </p>
        ) : null}
      </form>

      {hasNewResults ? (
        <p role="status" className="mt-3 font-serif text-[13px] text-red">
          已有新的练习数据。你的未保存修改仍保留，不能直接覆盖新结果；请先导出 ChordPro 或记下修改，再载入最新结果。
        </p>
      ) : null}

      <div className="mt-5 grid lg:grid-cols-[1.15fr_0.85fr] gap-4">
        <div className="border border-rule bg-paper-deep/35 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="w-4 h-4 text-red" strokeWidth={1.5} />
            <Smallcaps tone="ink">Speed · pitch preserved</Smallcaps>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {rates.map((rate) => (
              <TextPill
                key={rate}
                size="sm"
                active={Math.abs((player?.playbackRate ?? 1) - rate) < 0.01}
                disabled={!player?.available}
                onClick={() => player?.setPlaybackRate(rate)}
              >
                {rate.toFixed(rate % 1 === 0 ? 0 : 2)}×
              </TextPill>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-5 mb-3">
            <Scissors className="w-4 h-4 text-red" strokeWidth={1.5} />
            <Smallcaps tone="ink">A/B loop</Smallcaps>
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <TextPill
              size="sm"
              disabled={!player?.available}
              onClick={() => {
                if (!player) return;
                setLoopStart(player.currentTime);
                setLoopEnd(null);
              }}
            >
              A · {loopStart === null ? "Set" : formatDuration(loopStart)}
            </TextPill>
            <TextPill size="sm" disabled={!player?.available || loopStart === null} onClick={markLoopEnd}>
              B · {loopEnd === null ? "Set" : formatDuration(loopEnd)}
            </TextPill>
            <TextPill
              size="sm"
              active={Boolean(player?.loopEnabled)}
              disabled={!player?.loopRange}
              onClick={() => player?.setLoopEnabled(!player.loopEnabled)}
              icon={<Repeat2 className="w-3 h-3" />}
            >
              Loop
            </TextPill>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 items-center">
            <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-mute mr-1">前后留白</span>
            {PADDING_OPTIONS.map((padding) => (
              <TextPill
                key={padding}
                size="sm"
                active={player?.paddingSec === padding}
                onClick={() => player?.setPaddingSec(padding)}
              >
                {padding}s
              </TextPill>
            ))}
          </div>
        </div>

        <div className="border border-rule p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Guitar className="w-4 h-4 text-red" strokeWidth={1.5} />
              <Smallcaps tone="ink">Practice sections</Smallcaps>
            </div>
            {draft.bpm ? <Smallcaps>{Math.round(draft.bpm)} BPM</Smallcaps> : null}
          </div>
          {draft.sections.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {draft.sections.map((section) => (
                <TextPill
                  key={section.id}
                  size="sm"
                  disabled={!player?.available}
                  active={player?.loopRange?.startTime === section.startTime && player?.loopRange?.endTime === section.endTime}
                  onClick={() => player?.playSegment(section.startTime, section.endTime, true)}
                  title={`${formatDuration(section.startTime)}–${formatDuration(section.endTime)}`}
                >
                  {section.title}
                </TextPill>
              ))}
            </div>
          ) : (
            <p className="font-serif italic text-[14px] text-ink-soft">还没有段落。可在编辑区用当前 A/B 范围新增。</p>
          )}
          <div className="mt-4 pt-3 border-t border-rule font-serif text-[12px] text-ink-soft leading-relaxed">
            {practice.status === "pending"
              ? "音频已就绪。服务器不会自动分析；请在 Mac 手工运行下方命令。"
              : practice.status === "failed"
                ? `上次分析失败：${practice.lastError}`
                : practice.status === "ready"
                  ? `分析完成 · ${practice.data.chords.length} 个和弦 · ${practice.data.sections.length} 个段落`
                  : practice.hasAudio
                    ? "音频可以练习；尚未分析和弦。"
                    : "YouTube 可以先慢放和循环；从视频取得音频或上传文件后，即可生成练习材料。"}
          </div>
          {practice.hasAudio ? (
            <div className="mt-3 text-[12px] text-ink-soft">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-serif text-[14px] text-ink">在 Mac 按需生成和弦与分轨</span>
                <TextPill size="sm" onClick={() => void copyAnalysisCommand()} icon={<Copy className="w-3 h-3" />}>复制命令</TextPill>
              </div>
              <p className="mt-2">在这台 Mac 的终端运行以下命令（首次使用需先按 README 安装依赖）。完成后自动同步到本页；未保存修改会保留。</p>
              <textarea
                ref={commandInput}
                readOnly
                rows={4}
                aria-label="Mac 分析命令"
                value={analysisCommand}
                spellCheck={false}
                className="mt-2 w-full min-w-0 resize-y border border-rule bg-paper p-2 font-mono text-[11px] break-all outline-none focus:border-ink"
              />
              {copyNotice ? <p role="status" className="mt-1">{copyNotice}</p> : null}
              <p className="mt-2">只生成和弦可追加 --phase chords。自动结果是待校对草稿，不是准确六线谱。</p>
            </div>
          ) : null}
          <button type="button" disabled={saving} onClick={() => void handleRefresh()} className="mt-3 text-[12px] underline underline-offset-4 disabled:opacity-50">
            载入最新练习数据
          </button>
        </div>
      </div>

      {player?.source === "local" && MIXER_TRACKS.every(({ track }) => practice.data.stems.includes(track)) ? (
        <div className="mt-4 border border-rule p-4">
          <div className="flex items-center gap-2 mb-3">
            <Smallcaps tone="ink">4-stem mixer</Smallcaps>
            <span className="font-serif italic text-[12px] text-ink-mute">分轨同步播放 · M 静音 · S 独听</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {MIXER_TRACKS.map(({ track, label }) => {
              const setting = player.trackMix[track];
              return (
                <div key={track} className="border border-rule bg-paper-deep/30 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-serif text-[15px] text-ink">{label}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => player.toggleTrackMute(track)}
                        className={cn(
                          "w-6 h-6 border font-mono text-[9px] transition",
                          setting.muted ? "bg-red text-paper border-red" : "border-rule text-ink-mute hover:border-ink"
                        )}
                        aria-label={`${setting.muted ? "取消静音" : "静音"}${label}`}
                      >
                        M
                      </button>
                      <button
                        type="button"
                        onClick={() => player.toggleTrackSolo(track)}
                        className={cn(
                          "w-6 h-6 border font-mono text-[9px] transition",
                          setting.solo ? "bg-ink text-paper border-ink" : "border-rule text-ink-mute hover:border-ink"
                        )}
                        aria-label={`${setting.solo ? "取消独听" : "独听"}${label}`}
                      >
                        S
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={setting.volume}
                      onChange={(event) => player.setTrackVolume(track, Number(event.target.value))}
                      className="w-full accent-[var(--red)]"
                      aria-label={`${label}音量`}
                    />
                    <span className="w-8 text-right font-mono text-[9px] tabular text-ink-mute">
                      {Math.round(setting.volume * 100)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {editing ? (
        <fieldset disabled={saving} className="mt-4 min-w-0 border border-ink p-4 md:p-5 disabled:opacity-70">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <Smallcaps tone="ink">Editable practice sheet</Smallcaps>
              <p className="font-serif text-[13px] text-ink-soft mt-1">Capo 会把谱面换成对应指法，播放音高不变。</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <label className="flex items-center gap-2 border border-rule px-2 py-1">
                <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-mute">Capo</span>
                <select
                  value={draft.capo}
                  onChange={(event) => setDraft((current) => ({ ...current, capo: Number(event.target.value) }))}
                  className="bg-transparent font-mono text-[11px] outline-none"
                >
                  {Array.from({ length: 13 }, (_, value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <TextPill
                size="sm"
                active={draft.chordDisplay === "simple"}
                onClick={() => setDraft((current) => ({ ...current, chordDisplay: "simple" }))}
              >
                Simple
              </TextPill>
              <TextPill
                size="sm"
                active={draft.chordDisplay === "full"}
                onClick={() => setDraft((current) => ({ ...current, chordDisplay: "full" }))}
              >
                Full
              </TextPill>
              <TextPill
                size="sm"
                icon={<Download className="w-3 h-3" />}
                onClick={() => downloadText(
                  `${title || "utahon"}.cho`,
                  chordProText(title, artist, lines, {
                    ...draft,
                    chords: anchorChordsToLines(draft.chords, lines),
                  })
                )}
              >
                ChordPro
              </TextPill>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-ink">
                <Smallcaps tone="ink">Chords · {draft.chords.length}</Smallcaps>
                <TextPill size="sm" onClick={addChord} icon={<Plus className="w-3 h-3" />}>Current time</TextPill>
              </div>
              <div className="max-h-[360px] scroll-y" style={{ overflowX: "auto" }}>
                {draft.chords.map((chord) => (
                  <div key={chord.id} className="grid grid-cols-[minmax(70px,1fr)_72px_72px_32px] gap-2 py-2 border-b border-rule items-end">
                    <label className="grid gap-1">
                      <span className="font-mono text-[8px] tracking-[0.16em] uppercase text-ink-mute">Chord</span>
                      <input
                        value={chord.symbol}
                        onChange={(event) => updateChord(chord.id, { symbol: event.target.value })}
                        className="min-w-0 border border-rule bg-paper px-2 py-1.5 font-serif text-[14px] outline-none focus:border-ink"
                      />
                    </label>
                    <NumericInput
                      value={chord.startTime}
                      onChange={(value) => updateChord(chord.id, {
                        startTime: value,
                        lineIndex: undefined,
                        tokenIndex: undefined,
                      })}
                      label="Start"
                    />
                    <NumericInput value={chord.endTime} onChange={(value) => updateChord(chord.id, { endTime: value })} label="End" />
                    <button
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, chords: current.chords.filter((item) => item.id !== chord.id) }))}
                      className="w-8 h-8 border border-rule text-ink-mute hover:text-red hover:border-red transition flex items-center justify-center"
                      aria-label={`删除 ${chord.symbol} 和弦`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {draft.chords.length === 0 ? <p className="font-serif italic text-[13px] text-ink-soft py-4">自动分析完成后会出现在这里，也可以从当前播放位置手动添加。</p> : null}
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-ink">
                <Smallcaps tone="ink">Sections · {draft.sections.length}</Smallcaps>
                <TextPill size="sm" onClick={addSection} icon={<Plus className="w-3 h-3" />}>A/B range</TextPill>
              </div>
              <div className="max-h-[360px] scroll-y" style={{ overflowX: "auto" }}>
                {draft.sections.map((section) => (
                  <div key={section.id} className="grid grid-cols-[88px_minmax(80px,1fr)_68px_68px_32px] gap-2 py-2 border-b border-rule items-end">
                    <label className="grid gap-1">
                      <span className="font-mono text-[8px] tracking-[0.16em] uppercase text-ink-mute">Type</span>
                      <select
                        value={section.label}
                        onChange={(event) => updateSection(section.id, { label: event.target.value as SongSection["label"] })}
                        className="h-8 min-w-0 border border-rule bg-paper px-1 font-mono text-[9px] outline-none focus:border-ink"
                      >
                        {section.label === "full" ? <option value="full">全曲</option> : null}
                        {SECTION_LABELS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1">
                      <span className="font-mono text-[8px] tracking-[0.16em] uppercase text-ink-mute">Title</span>
                      <input
                        value={section.title}
                        onChange={(event) => updateSection(section.id, { title: event.target.value })}
                        className="min-w-0 border border-rule bg-paper px-2 py-1.5 font-serif text-[13px] outline-none focus:border-ink"
                      />
                    </label>
                    <NumericInput value={section.startTime} onChange={(value) => updateSection(section.id, { startTime: value })} label="Start" />
                    <NumericInput value={section.endTime} onChange={(value) => updateSection(section.id, { endTime: value })} label="End" />
                    <button
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, sections: current.sections.filter((item) => item.id !== section.id) }))}
                      className="w-8 h-8 border border-rule text-ink-mute hover:text-red hover:border-red transition flex items-center justify-center"
                      aria-label={`删除 ${section.title} 段落`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-rule">
            <div className={cn("font-serif text-[13px]", error ? "text-red" : "text-ink-soft")}>
              {error || notice || "修改只会影响这首歌的练习谱。"}
            </div>
            <TextPill
              tone="solid"
              disabled={saving}
              onClick={() => void handleSave()}
              icon={saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            >
              Save sheet
            </TextPill>
          </div>
        </fieldset>
      ) : notice || error ? (
        <p className={cn("font-serif text-[13px] mt-3", error ? "text-red" : "text-ink-soft")}>{error || notice}</p>
      ) : null}
    </section>
  );
}

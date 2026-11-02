"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trash2,
  X,
  Loader2,
  CheckSquare,
  Square,
  ListFilter,
} from "lucide-react";
import type { SongMeta } from "@/types/lyrics";
import { cn } from "@/lib/utils";
import { Smallcaps, formatDuration, relativeAdded } from "./editorial-shell";
import { TextPill } from "./editorial-interactive";
import { SongThemeTags } from "./song-theme-tags";

const UNKNOWN_ARTIST = "未知";

type StatusFilter = "all" | "done" | "pending";
type SourceFilter = "all" | "manual" | "channel";

export function SongLibrary({
  songs,
  total,
  offset = 1,
  coverSongId,
}: {
  songs: SongMeta[];
  total: number;
  offset?: number;
  coverSongId?: string;
}) {
  const router = useRouter();
  const [artist, setArtist] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [, startTransition] = useTransition();

  const artistCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of songs) {
      const key = s.artist || UNKNOWN_ARTIST;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => {
      if (a[0] === UNKNOWN_ARTIST && b[0] !== UNKNOWN_ARTIST) return 1;
      if (b[0] === UNKNOWN_ARTIST && a[0] !== UNKNOWN_ARTIST) return -1;
      return b[1] - a[1];
    });
  }, [songs]);

  const doneCount = useMemo(
    () => songs.filter((s) => s.linesCount > 0).length,
    [songs]
  );
  const pendingCount = songs.length - doneCount;
  const manualCount = useMemo(
    () => songs.filter((s) => s.source === "manual").length,
    [songs]
  );
  const channelCount = songs.length - manualCount;

  const filtered = useMemo(() => {
    return songs.filter((s) => {
      const key = s.artist || UNKNOWN_ARTIST;
      if (artist !== null && key !== artist) return false;
      if (status === "done" && s.linesCount === 0) return false;
      if (status === "pending" && s.linesCount > 0) return false;
      if (source !== "all" && s.source !== source) return false;
      return true;
    });
  }, [songs, artist, status, source]);

  const listSongs = useMemo(
    () => (coverSongId ? filtered.filter((s) => s.id !== coverSongId) : filtered),
    [filtered, coverSongId]
  );

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const s of listSongs) next.add(s.id);
      return next;
    });
  }

  function invertVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const s of listSongs) {
        if (next.has(s.id)) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function bulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!confirm(`确定删除 ${ids.length} 首歌?`)) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/songs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ids }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error ?? `删除失败 HTTP ${res.status}`);
        return;
      }
      setSelectedIds(new Set());
      setSelectMode(false);
      startTransition(() => router.refresh());
    } catch (err) {
      alert(err instanceof Error ? err.message : "网络错误");
    } finally {
      setDeleting(false);
    }
  }

  const filteringActive =
    artist !== null || status !== "all" || source !== "all";

  const allChip = {
    key: "all",
    label: "All",
    count: songs.length,
    active: !filteringActive,
    click: () => {
      setArtist(null);
      setStatus("all");
      setSource("all");
    },
  };
  const statusChips: Array<{ key: string; label: string; count: number; active: boolean; click: () => void }> = [
    {
      key: "done",
      label: `Done`,
      count: doneCount,
      active: status === "done",
      click: () => setStatus(status === "done" ? "all" : "done"),
    },
    {
      key: "pending",
      label: `Pending`,
      count: pendingCount,
      active: status === "pending",
      click: () => setStatus(status === "pending" ? "all" : "pending"),
    },
    {
      key: "channel",
      label: `Channel`,
      count: channelCount,
      active: source === "channel",
      click: () => setSource(source === "channel" ? "all" : "channel"),
    },
    {
      key: "manual",
      label: `Manual`,
      count: manualCount,
      active: source === "manual",
      click: () => setSource(source === "manual" ? "all" : "manual"),
    },
  ];

  const knownArtists = artistCounts.filter(([name]) => name !== UNKNOWN_ARTIST);
  const unknownArtist = artistCounts.find(([name]) => name === UNKNOWN_ARTIST);
  const showArtistChips = artistCounts.length > 1;

  return (
    <section className="mt-14 md:mt-16">
      <div className="flex items-end justify-between gap-4 pb-2.5 border-b border-ink">
        <div>
          <Smallcaps tone="ink">Index · recent entries</Smallcaps>
          <div className="font-serif italic text-[22px] md:text-[28px] leading-[1.1] text-ink mt-0.5 md:mt-1">
            Filed by date
          </div>
        </div>
        <div className="flex items-center gap-2">
          {songs.length > 0 && (
            <TextPill
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              active={selectMode}
              icon={
                selectMode ? (
                  <X className="w-3 h-3" strokeWidth={1.5} />
                ) : (
                  <CheckSquare className="w-3 h-3" strokeWidth={1.5} />
                )
              }
            >
              {selectMode ? "Done" : "Manage"}
            </TextPill>
          )}
        </div>
      </div>

      {/* chip row — horizontal scroll on mobile
          顺序: All → 识别到的歌手(按数量倒序) → Done/Pending/Channel/Manual → 未知 */}
      <div className="flex gap-1.5 pt-3 overflow-x-auto no-scrollbar flex-nowrap">
        <FilterChip
          key={allChip.key}
          label={allChip.label}
          count={allChip.count}
          active={allChip.active}
          onClick={allChip.click}
        />
        {showArtistChips &&
          knownArtists.map(([name, n]) => (
            <FilterChip
              key={`artist-${name}`}
              label={name}
              count={n}
              active={artist === name}
              onClick={() => setArtist(artist === name ? null : name)}
              jp
            />
          ))}
        {statusChips.map((c) => (
          <FilterChip
            key={c.key}
            label={c.label}
            count={c.count}
            active={c.active}
            onClick={c.click}
          />
        ))}
        {showArtistChips && unknownArtist && (
          <FilterChip
            key={`artist-${unknownArtist[0]}`}
            label={unknownArtist[0]}
            count={unknownArtist[1]}
            active={artist === unknownArtist[0]}
            onClick={() =>
              setArtist(artist === unknownArtist[0] ? null : unknownArtist[0])
            }
            jp
          />
        )}
        {filteringActive && (
          <button
            type="button"
            onClick={() => {
              setArtist(null);
              setStatus("all");
              setSource("all");
            }}
            className="inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.16em] uppercase text-ink-mute hover:text-ink ml-1 whitespace-nowrap"
          >
            <ListFilter className="w-3 h-3" strokeWidth={1.5} /> Clear
          </button>
        )}
      </div>

      {songs.length === 0 || (listSongs.length === 0 && !filteringActive) ? (
        <EmptyIndex total={total} />
      ) : listSongs.length === 0 ? (
        <div className="py-10 text-center">
          <div className="font-serif italic text-[18px] text-ink-soft">
            当前筛选下没有歌曲喵～
          </div>
        </div>
      ) : (
        <ul className="mt-2 md:mt-4">
          {listSongs.map((s, i) => (
            <IndexRow
              key={s.id}
              song={s}
              num={offset + i}
              selectMode={selectMode}
              selected={selectedIds.has(s.id)}
              onToggle={toggleOne}
            />
          ))}
        </ul>
      )}

      <AnimatePresence>
        {selectMode && (
          <motion.div
            key="bulk-bar"
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="fixed left-0 right-0 bottom-16 md:bottom-6 z-40 flex justify-center px-4 pointer-events-none"
          >
            <div className="pointer-events-auto flex items-center gap-1 bg-ink text-paper border border-ink px-3 py-2 shadow-[8px_8px_0_0_var(--rule)]">
              <span className="font-mono text-[10px] tracking-[0.18em] uppercase pl-1 pr-2 whitespace-nowrap">
                Selected {selectedIds.size} / {listSongs.length}
              </span>
              <span className="w-px h-5 bg-paper/20" />
              <BarBtn onClick={selectAllVisible} ariaLabel="全选">
                <CheckSquare className="w-[14px] h-[14px]" strokeWidth={1.5} />
              </BarBtn>
              <BarBtn onClick={invertVisible} ariaLabel="反选">
                <Square className="w-[14px] h-[14px]" strokeWidth={1.5} />
              </BarBtn>
              <BarBtn
                onClick={bulkDelete}
                disabled={selectedIds.size === 0 || deleting}
                ariaLabel="删除"
                tone="red"
              >
                {deleting ? (
                  <Loader2 className="w-[14px] h-[14px] animate-spin" />
                ) : (
                  <Trash2 className="w-[14px] h-[14px]" strokeWidth={1.5} />
                )}
              </BarBtn>
              <span className="w-px h-5 bg-paper/20" />
              <BarBtn onClick={exitSelect} ariaLabel="取消">
                <X className="w-[14px] h-[14px]" strokeWidth={1.5} />
              </BarBtn>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  jp = false,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  jp?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-baseline gap-1.5 px-2.5 py-1 border whitespace-nowrap transition",
        "font-mono text-[9.5px] tracking-[0.14em] uppercase",
        active
          ? "bg-ink text-paper border-ink"
          : "border-rule text-ink-soft hover:border-ink hover:text-ink"
      )}
    >
      <span className={cn(jp && "jp normal-case tracking-normal font-serif-jp text-[12px] font-medium")}>
        {label}
      </span>
      <span className="tabular text-[9px] opacity-80">· {count}</span>
    </button>
  );
}

function IndexRow({
  song,
  num,
  selectMode,
  selected,
  onToggle,
}: {
  song: SongMeta;
  num: number;
  selectMode: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const pending = song.linesCount === 0;
  const content = (
    <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] md:grid-cols-[40px_minmax(0,1fr)_110px_90px_56px] gap-3 md:gap-5 items-baseline py-4 md:py-5 border-b border-rule">
      <div className="font-mono text-[10px] md:text-[11px] tracking-[0.08em] text-ink-mute tabular">
        {num.toString().padStart(2, "0")}.
      </div>
      <div className="min-w-0">
        <div className="font-serif-jp jp font-medium text-[17px] md:text-[22px] leading-[1.2] text-ink truncate">
          {song.title}
        </div>
        <div className="font-serif italic text-[12px] md:text-[14px] text-ink-soft mt-0.5 truncate">
          {song.artist}
          {song.originalArtist && song.originalArtist !== song.artist && (
            <span className="text-ink-mute"> · Orig. {song.originalArtist}</span>
          )}
          {pending && <span className="text-red"> · pending transcription</span>}
        </div>
        <SongThemeTags tags={song.themeTags} />
      </div>
      <div className="hidden md:block font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute">
        {song.source === "channel" ? "channel" : "manual"}
      </div>
      <div className="hidden md:block font-mono text-[11px] text-ink-mute text-right tabular">
        {song.linesCount} lines
      </div>
      <div className="font-mono text-[10px] md:text-[11px] text-ink-mute text-right tabular whitespace-nowrap">
        <span className="md:hidden">{song.linesCount}L · </span>
        {formatDuration(song.durationSec)}
      </div>
    </div>
  );

  if (selectMode) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggle(song.id)}
          className={cn(
            "block w-full text-left transition px-1 -mx-1",
            selected && "bg-paper-deep"
          )}
          aria-pressed={selected}
        >
          <div className="flex items-start gap-2">
            <div className="pt-4 md:pt-5">
              <span
                className={cn(
                  "inline-block w-[14px] h-[14px] border transition",
                  selected ? "bg-red border-red" : "border-rule"
                )}
              />
            </div>
            <div className="flex-1 min-w-0">{content}</div>
          </div>
        </button>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={`/song/${song.id}`}
        className="block transition hover:bg-paper-deep/60 -mx-2 px-2"
      >
        {content}
      </Link>
    </li>
  );
}

function EmptyIndex({ total }: { total: number }) {
  return (
    <div className="py-16 md:py-20 text-center">
      <div className="font-serif italic text-[22px] md:text-[26px] text-ink-soft">
        {total === 0
          ? "The songbook is still blank."
          : "Only one song so far — all on the cover."}
      </div>
      <div className="mt-2 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">
        start by pinning a song →
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <TextPill href="/new" tone="solid">
          + New song
        </TextPill>
        <TextPill href="/import">Batch import</TextPill>
      </div>
    </div>
  );
}

function BarBtn({
  children,
  onClick,
  disabled,
  tone = "default",
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "red";
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "w-8 h-8 flex items-center justify-center transition",
        "text-paper/80 hover:text-paper",
        tone === "red" && "hover:text-red-soft",
        disabled && "opacity-30 cursor-not-allowed hover:text-paper/80"
      )}
    >
      {children}
    </button>
  );
}

// Deprecated — kept for type-compatibility with old imports
export { relativeAdded };

"use client";

import { Music4, Repeat2 } from "lucide-react";
import type { ChordEvent } from "@/types/practice";
import { cn } from "@/lib/utils";
import { ChordStrip } from "./chord-strip";
import { formatDuration } from "./editorial-shell";
import { usePlayer } from "./player-context";

export function InstrumentalChords({ label, startTime, endTime, chords }: {
  label: string;
  startTime: number;
  endTime: number;
  chords: ChordEvent[];
}) {
  const player = usePlayer();
  const canPlay = Boolean(player?.available) && endTime > startTime;
  const looping = Boolean(player?.loopEnabled && player.loopRange?.startTime === startTime && player.loopRange.endTime === endTime);
  const timeRange = `${startTime === 0 ? "0:00" : formatDuration(startTime)}–${endTime === 0 ? "0:00" : formatDuration(endTime)}`;

  return (
    <section aria-label={label} className="min-w-0 border-b border-rule py-2 md:py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <h3 className="text-[13px] font-medium text-ink-soft">{label}</h3>
          <span className="font-mono text-[11px] tabular-nums text-ink-mute">{timeRange}</span>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" disabled={!canPlay} onClick={() => player?.playSegment(startTime, endTime)}
            aria-label={`播放${label}`} title={`播放${label}`}
            className="flex size-11 items-center justify-center text-ink-soft hover:text-red disabled:opacity-40">
            <Music4 className="size-4" strokeWidth={1.5} />
          </button>
          <button type="button" disabled={!canPlay} onClick={() => looping ? player?.setLoopEnabled(false) : player?.playSegment(startTime, endTime, true)}
            aria-label={`循环${label}`} title={`循环${label}`} aria-pressed={looping}
            className={cn("flex size-11 items-center justify-center hover:text-red disabled:opacity-40", looping ? "text-red" : "text-ink-soft")}>
            <Repeat2 className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <ChordStrip chords={chords} startTime={startTime} endTime={endTime} />
    </section>
  );
}

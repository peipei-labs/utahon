"use client";

import { useState } from "react";
import type { ChordEvent } from "@/types/practice";
import { simplifyChordSymbol, transposeChord } from "@/lib/practice-schema";
import { cn } from "@/lib/utils";
import { ChordDiagram } from "./chord-diagram";
import { usePlayer } from "./player-context";
import { usePractice } from "./practice-context";

export function ChordStrip({ chords, startTime, endTime }: {
  chords: ChordEvent[];
  startTime: number;
  endTime: number;
}) {
  const [openChordId, setOpenChordId] = useState<string | null>(null);
  const player = usePlayer();
  const { practice } = usePractice();
  if (chords.length === 0) return null;

  const inSegment = Boolean(player && player.currentTime >= startTime && player.currentTime < endTime);
  return (
    <div role="group" aria-label="和弦序列" className="relative flex flex-wrap gap-x-1 md:gap-x-3 gap-y-0 mb-1.5 min-h-6">
      {chords.map((chord) => {
        const sourceSymbol = practice.data.chordDisplay === "simple"
          ? simplifyChordSymbol(chord.symbol)
          : chord.symbol;
        const shape = transposeChord(sourceSymbol, -practice.data.capo);
        const active = Boolean(inSegment && player && player.currentTime >= chord.startTime && player.currentTime < chord.endTime);
        const continuation = chord.startTime < startTime ? " · 延续上一段" : "";
        const markerClass = cn(
          "inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 font-mono text-[12px] md:text-[13px] font-medium border-b transition px-0.5",
          active ? "text-red border-red" : "text-ink-soft border-rule"
        );

        if (shape === "N") {
          return (
            <span key={chord.id} title={`无和弦${continuation}`} aria-current={active ? "true" : undefined} className={markerClass}>
              N<span className="sr-only">（无和弦{continuation}）</span>
            </span>
          );
        }

        return (
          <span key={chord.id} className="md:relative">
            <button type="button" onClick={() => setOpenChordId(value => value === chord.id ? null : chord.id)}
              className={cn(markerClass, "hover:text-ink hover:border-ink")}
              title={`${shape}${continuation}`} aria-label={`查看 ${shape} 吉他指法${continuation}`}
              aria-expanded={openChordId === chord.id} aria-current={active ? "true" : undefined}>
              {shape}
            </button>
            {openChordId === chord.id ? (
              <span className="absolute left-0 top-full mt-2 z-30 bg-paper border border-ink shadow-[5px_5px_0_0_var(--rule)] p-2 text-ink">
                <ChordDiagram symbol={shape} />
                {practice.data.capo > 0 ? (
                  <span className="block font-mono text-[8px] tracking-[0.12em] uppercase text-ink-mute text-center pb-1">
                    Capo {practice.data.capo} · sounds {chord.symbol}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

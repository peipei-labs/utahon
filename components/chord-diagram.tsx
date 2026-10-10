"use client";

import guitarDb from "@tombatossals/chords-db/lib/guitar.json";
import { normalizeChordSymbol } from "@/lib/practice-schema";

type ChordPosition = {
  frets: number[];
  fingers: number[];
  baseFret: number;
  barres: number[];
};

type ChordDefinition = {
  key: string;
  suffix: string;
  positions: ChordPosition[];
};

const database = guitarDb as unknown as {
  chords: Record<string, ChordDefinition[]>;
};

function databaseKey(root: string): string {
  const enharmonic: Record<string, string> = {
    Db: "C#",
    "D#": "Eb",
    Gb: "F#",
    "G#": "Ab",
    "A#": "Bb",
  };
  return (enharmonic[root] ?? root).replace("#", "sharp");
}

function parseChord(symbol: string): { root: string; suffix: string } | null {
  let normalized: string;
  try {
    normalized = normalizeChordSymbol(symbol);
  } catch {
    return null;
  }
  if (normalized === "N") return null;
  const match = normalized.match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match) return null;
  const root = match[1];
  let suffix = match[2];
  if (!suffix || suffix === "maj") suffix = "major";
  else if (suffix === "m") suffix = "minor";
  return { root, suffix };
}

export function findPosition(symbol: string): ChordPosition | null {
  const parsed = parseChord(symbol);
  if (!parsed) return null;
  const choices = database.chords[databaseKey(parsed.root)] ?? [];
  const exact = choices.find((choice) => choice.suffix === parsed.suffix);
  return exact?.positions[0] ?? null;
}

export function ChordDiagram({ symbol }: { symbol: string }) {
  const position = findPosition(symbol);
  if (!position) {
    return (
      <div className="w-[132px] h-[154px] border border-dashed border-rule flex items-center justify-center text-center px-3 font-serif text-[13px] text-ink-soft">
        暂无这个和弦的指法图
      </div>
    );
  }
  const width = 132;
  const height = 154;
  const left = 20;
  const top = 32;
  const stringGap = 18;
  const fretGap = 22;
  const fretCount = 5;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${symbol} 吉他指法`}>
      <text x={width / 2} y="17" textAnchor="middle" fill="currentColor" fontSize="14" fontWeight="600">
        {symbol}
      </text>
      {position.baseFret > 1 ? (
        <text x="3" y={top + 15} fill="currentColor" fontSize="9">{position.baseFret}fr</text>
      ) : null}
      {Array.from({ length: 6 }, (_, index) => (
        <line
          key={`string-${index}`}
          x1={left + index * stringGap}
          y1={top}
          x2={left + index * stringGap}
          y2={top + fretCount * fretGap}
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.65"
        />
      ))}
      {Array.from({ length: fretCount + 1 }, (_, index) => (
        <line
          key={`fret-${index}`}
          x1={left}
          y1={top + index * fretGap}
          x2={left + 5 * stringGap}
          y2={top + index * fretGap}
          stroke="currentColor"
          strokeWidth={index === 0 && position.baseFret === 1 ? "3" : "1"}
          opacity="0.75"
        />
      ))}
      {position.barres.map((fret) => {
        const strings = position.frets
          .map((value, index) => ({ value, index }))
          .filter((item) => item.value === fret)
          .map((item) => item.index);
        if (strings.length < 2) return null;
        return (
          <line
            key={`barre-${fret}`}
            x1={left + Math.min(...strings) * stringGap}
            y1={top + (fret - 0.5) * fretGap}
            x2={left + Math.max(...strings) * stringGap}
            y2={top + (fret - 0.5) * fretGap}
            stroke="currentColor"
            strokeWidth="9"
            strokeLinecap="round"
          />
        );
      })}
      {position.frets.map((fret, index) => {
        const x = left + index * stringGap;
        if (fret < 0) {
          return <text key={`mark-${index}`} x={x} y={top - 8} textAnchor="middle" fill="currentColor" fontSize="12">×</text>;
        }
        if (fret === 0) {
          return <circle key={`mark-${index}`} cx={x} cy={top - 9} r="4" fill="none" stroke="currentColor" />;
        }
        if (position.barres.includes(fret)) return null;
        return (
          <g key={`mark-${index}`}>
            <circle cx={x} cy={top + (fret - 0.5) * fretGap} r="7" fill="currentColor" />
            {position.fingers[index] > 0 ? (
              <text x={x} y={top + (fret - 0.5) * fretGap + 3} textAnchor="middle" fill="var(--paper)" fontSize="8">
                {position.fingers[index]}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

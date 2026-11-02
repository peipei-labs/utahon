import type { AnalyzedLine } from "@/types/lyrics";
import type { ChordEvent } from "@/types/practice";

export type ChordTimelineRow =
  | { kind: "lyrics"; lineIndex: number; chords: ChordEvent[] }
  | { kind: "instrumental"; label: string; startTime: number; endTime: number; chords: ChordEvent[] };

function hasTiming(line: AnalyzedLine): boolean {
  return Number.isFinite(line.startTime) && Number.isFinite(line.endTime) &&
    line.startTime >= 0 && line.endTime > line.startTime;
}

export function buildChordTimeline(
  lines: readonly AnalyzedLine[],
  chords: readonly ChordEvent[],
  durationSec = 0,
): ChordTimelineRow[] {
  const orderedChords = [...chords].sort((a, b) => a.startTime - b.startTime);
  const timedLines = lines.map((line, index) => ({ line, index }))
    .filter(({ line }) => hasTiming(line)).sort((a, b) => a.line.startTime - b.line.startTime);
  const endTime = Math.max(0, durationSec, ...orderedChords.map(chord => chord.endTime), ...timedLines.map(({ line }) => line.endTime));
  const within = (start: number, end: number) => orderedChords.filter(chord =>
    chord.startTime < end && chord.endTime > start);

  if (timedLines.length === 0) {
    return [
      ...(orderedChords.length ? [{ kind: "instrumental" as const, label: "和弦时间轴", startTime: 0, endTime, chords: orderedChords }] : []),
      ...lines.map((_, lineIndex) => ({ kind: "lyrics" as const, lineIndex, chords: [] })),
    ];
  }

  const gaps = new Map<number, ChordTimelineRow>();
  const chordDisplayEnds = new Map<number, number>();
  const allLinesTimed = timedLines.length === lines.length;
  function addGap(beforeLine: number, start: number, end: number, label: string) {
    if (end <= start) return;
    const gapChords = within(start, end);
    if (gapChords.length) gaps.set(beforeLine, {
      kind: "instrumental", label: allLinesTimed ? label : "未对齐和弦",
      startTime: start, endTime: end, chords: gapChords,
    });
  }

  let coveredUntil = 0;
  let coveredBy = -1;
  timedLines.forEach(({ line, index }, position) => {
    const gapDuration = line.startTime - coveredUntil;
    if (allLinesTimed && coveredBy >= 0 && gapDuration > 0 && gapDuration < 2) {
      // Keep breathing-gap chords with the preceding line without extending its audio clip.
      chordDisplayEnds.set(coveredBy, line.startTime);
    } else {
      addGap(index, coveredUntil, line.startTime, position === 0 ? "前奏" : "间奏");
    }
    if (line.endTime > coveredUntil) {
      coveredUntil = line.endTime;
      coveredBy = index;
    }
  });
  addGap(lines.length, coveredUntil, endTime, "尾奏");

  const rows: ChordTimelineRow[] = [];
  lines.forEach((line, lineIndex) => {
    const gap = gaps.get(lineIndex);
    if (gap) rows.push(gap);
    rows.push({ kind: "lyrics", lineIndex, chords: hasTiming(line) ? within(line.startTime, chordDisplayEnds.get(lineIndex) ?? line.endTime) : [] });
  });
  const tail = gaps.get(lines.length);
  if (tail) rows.push(tail);
  return rows;
}

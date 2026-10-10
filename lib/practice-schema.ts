import type { AnalyzedLine } from "@/types/lyrics";
import {
  PRACTICE_DATA_VERSION,
  type ChordEvent,
  type PracticeDataV1,
  type PracticeSource,
  type PracticeTrack,
  type SongSection,
  type SongSectionLabel,
} from "@/types/practice";

const CHORD_RE = /^(?:N|[A-G](?:#|b)?(?::?[A-Za-z0-9()+#b-]{0,20})?(?:\/[A-G](?:#|b)?)?)$/;
const SECTION_LABELS = new Set<SongSectionLabel>([
  "full",
  "intro",
  "verse",
  "chorus",
  "bridge",
  "break",
  "solo",
  "outro",
  "custom",
]);
const PRACTICE_TRACKS = new Set<PracticeTrack>([
  "mix",
  "vocals",
  "drums",
  "bass",
  "other",
]);
const SOURCES = new Set<PracticeSource>(["auto", "manual"]);

function createId(): string {
  return globalThis.crypto.randomUUID();
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} 必须是有限数字`);
  }
  return value;
}

function timeValue(value: unknown, field: string, durationSec: number): number {
  const time = finiteNumber(value, field);
  const upper = durationSec > 0 ? durationSec + 0.5 : 24 * 60 * 60;
  if (time < 0 || time > upper) throw new Error(`${field} 超出音频范围`);
  return Math.round(time * 1000) / 1000;
}

function sourceValue(value: unknown): PracticeSource {
  if (!SOURCES.has(value as PracticeSource)) throw new Error("无效的数据来源");
  return value as PracticeSource;
}

function shortText(value: unknown, field: string, max = 80): string {
  if (typeof value !== "string") throw new Error(`${field} 必须是文本`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${field} 过长`);
  return text;
}

export function normalizeChordSymbol(value: string): string {
  const compact = value.trim().replace(/\s+/g, "").replace(":maj", "maj").replace(":min", "m");
  if (!CHORD_RE.test(compact)) throw new Error(`无法识别和弦：${value}`);
  return compact;
}

export function simplifyChordSymbol(value: string): string {
  const normalized = normalizeChordSymbol(value);
  if (normalized === "N") return normalized;
  const [main, bass] = normalized.split("/");
  const rootMatch = main.match(/^[A-G](?:#|b)?/);
  if (!rootMatch) return normalized;
  const root = rootMatch[0];
  const quality = main.slice(root.length).toLowerCase();
  let suffix = "";
  if (quality.startsWith("m") && !quality.startsWith("maj")) suffix = "m";
  if (/^(?:7|9|11|13|dom)/.test(quality)) suffix = "7";
  if (quality.includes("dim") || quality.includes("°")) suffix = "dim";
  if (quality.includes("aug") || quality.includes("+")) suffix = "aug";
  if (quality.includes("sus2")) suffix = "sus2";
  else if (quality.includes("sus")) suffix = "sus4";
  return `${root}${suffix}${bass ? `/${bass}` : ""}`;
}

const PREFERRED_NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const NOTE_INDEX: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

function transposeRoot(root: string, semitones: number): string {
  const index = NOTE_INDEX[root];
  if (index === undefined) return root;
  return PREFERRED_NOTES[(index + semitones + 120) % 12];
}

export function transposeChord(value: string, semitones: number): string {
  const normalized = normalizeChordSymbol(value);
  if (normalized === "N" || semitones % 12 === 0) return normalized;
  const [main, bass] = normalized.split("/");
  const rootMatch = main.match(/^[A-G](?:#|b)?/);
  if (!rootMatch) return normalized;
  const suffix = main.slice(rootMatch[0].length);
  const nextRoot = transposeRoot(rootMatch[0], semitones);
  return `${nextRoot}${suffix}${bass ? `/${transposeRoot(bass, semitones)}` : ""}`;
}

function validateChord(value: unknown, durationSec: number): ChordEvent {
  if (!value || typeof value !== "object") throw new Error("和弦事件格式错误");
  const raw = value as Record<string, unknown>;
  const startTime = timeValue(raw.startTime, "和弦开始时间", durationSec);
  const endTime = timeValue(raw.endTime, "和弦结束时间", durationSec);
  if (endTime <= startTime) throw new Error("和弦结束时间必须晚于开始时间");
  const symbol = normalizeChordSymbol(shortText(raw.symbol, "和弦", 32));
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 80) : createId();
  const event: ChordEvent = {
    id,
    startTime,
    endTime,
    symbol,
    simplifiedSymbol: simplifyChordSymbol(symbol),
    source: sourceValue(raw.source ?? "manual"),
    edited: Boolean(raw.edited),
  };
  if (typeof raw.confidence === "number" && Number.isFinite(raw.confidence)) {
    event.confidence = Math.max(0, Math.min(1, raw.confidence));
  }
  if (Number.isInteger(raw.lineIndex) && (raw.lineIndex as number) >= 0) {
    event.lineIndex = raw.lineIndex as number;
  }
  if (Number.isInteger(raw.tokenIndex) && (raw.tokenIndex as number) >= 0) {
    event.tokenIndex = raw.tokenIndex as number;
  }
  return event;
}

function validateSection(value: unknown, durationSec: number): SongSection {
  if (!value || typeof value !== "object") throw new Error("段落格式错误");
  const raw = value as Record<string, unknown>;
  const startTime = timeValue(raw.startTime, "段落开始时间", durationSec);
  const endTime = timeValue(raw.endTime, "段落结束时间", durationSec);
  if (endTime <= startTime) throw new Error("段落结束时间必须晚于开始时间");
  const label = raw.label as SongSectionLabel;
  if (!SECTION_LABELS.has(label)) throw new Error("段落标签无效");
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 80) : createId(),
    label,
    title: shortText(raw.title, "段落标题", 40) || label,
    startTime,
    endTime,
    source: sourceValue(raw.source ?? "manual"),
    edited: Boolean(raw.edited),
  };
}

export function validatePracticeData(value: unknown, durationSec = 0, repairStoredIds = false): PracticeDataV1 {
  if (!value || typeof value !== "object") throw new Error("练习数据格式错误");
  const raw = value as Record<string, unknown>;
  if (raw.version !== PRACTICE_DATA_VERSION) throw new Error("不支持的练习数据版本");
  if (!Array.isArray(raw.chords) || raw.chords.length > 4000) throw new Error("和弦列表无效");
  if (!Array.isArray(raw.sections) || raw.sections.length > 200) throw new Error("段落列表无效");
  const chords = raw.chords.map((item) => validateChord(item, durationSec)).sort((a, b) => a.startTime - b.startTime);
  const sections = raw.sections.map((item) => validateSection(item, durationSec)).sort((a, b) => a.startTime - b.startTime);
  for (const events of [chords, sections]) {
    const reserved = new Set(events.map((event) => event.id));
    const seen = new Set<string>();
    for (const [index, event] of events.entries()) {
      if (seen.has(event.id)) {
        if (!repairStoredIds) throw new Error("和弦或段落 ID 不能重复");
        let suffix = 0;
        do { event.id = `restored-${index}-${suffix++}`; } while (reserved.has(event.id));
        reserved.add(event.id);
      }
      seen.add(event.id);
    }
  }
  const beats = Array.isArray(raw.beats)
    ? raw.beats.slice(0, 100000).map((item) => timeValue(item, "节拍时间", durationSec))
    : [];
  const downbeats = Array.isArray(raw.downbeats)
    ? raw.downbeats.slice(0, 25000).map((item) => timeValue(item, "强拍时间", durationSec))
    : [];
  const bpm = raw.bpm == null ? null : finiteNumber(raw.bpm, "BPM");
  if (bpm !== null && (bpm < 20 || bpm > 400)) throw new Error("BPM 超出合理范围");
  const capo = Number.isInteger(raw.capo) ? (raw.capo as number) : 0;
  if (capo < 0 || capo > 12) throw new Error("Capo 必须在 0 到 12 之间");
  const chordDisplay = raw.chordDisplay === "full" ? "full" : "simple";
  const stems = Array.isArray(raw.stems)
    ? Array.from(new Set(raw.stems.filter((track): track is PracticeTrack => PRACTICE_TRACKS.has(track as PracticeTrack))))
    : [];
  const analyzers: Record<string, string> = {};
  if (raw.analyzers && typeof raw.analyzers === "object") {
    for (const [key, item] of Object.entries(raw.analyzers as Record<string, unknown>)) {
      if (/^[a-z0-9_-]{1,40}$/i.test(key) && typeof item === "string") analyzers[key] = item.slice(0, 80);
    }
  }
  return {
    version: PRACTICE_DATA_VERSION,
    chords,
    sections,
    bpm,
    beats,
    downbeats,
    capo,
    chordDisplay,
    stems,
    analyzers,
  };
}

export function anchorChordsToLines(chords: ChordEvent[], lines: AnalyzedLine[]): ChordEvent[] {
  if (lines.length === 0) return chords;
  return chords.map((chord) => {
    let lineIndex = lines.findIndex(
      (line) => chord.startTime >= line.startTime && chord.startTime < line.endTime
    );
    if (lineIndex < 0) {
      let smallestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < lines.length; index += 1) {
        const distance = Math.abs(lines[index].startTime - chord.startTime);
        if (distance < smallestDistance) {
          smallestDistance = distance;
          lineIndex = index;
        }
      }
    }
    const line = lines[lineIndex];
    const lineDuration = Math.max(line.endTime - line.startTime, 0.1);
    const tokenCount = Math.max(line.tokens.length, 1);
    const ratio = Math.max(0, Math.min(0.999, (chord.startTime - line.startTime) / lineDuration));
    return { ...chord, lineIndex, tokenIndex: Math.floor(ratio * tokenCount) };
  });
}

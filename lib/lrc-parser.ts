import type { ParsedLine } from "@/types/lyrics";

const TIMESTAMP_RE = /^\[(\d+):([0-5]\d)(?:\.(\d{1,3}))?\]/;

function toSeconds(mm: string, ss: string, cs?: string): number {
  const frac = cs ? Number(`0.${cs}`) : 0;
  return parseInt(mm) * 60 + parseInt(ss) + frac;
}

export function parseLRC(lrc: string): ParsedLine[] {
  const all: { time: number; text: string }[] = [];
  for (const raw of lrc.split("\n")) {
    let text = raw.trim();
    const times: number[] = [];
    let match: RegExpMatchArray | null;
    while ((match = text.match(TIMESTAMP_RE))) {
      times.push(toSeconds(match[1], match[2], match[3]));
      text = text.slice(match[0].length).trimStart();
    }
    for (const time of new Set(times)) all.push({ time, text: text.trim() });
  }
  all.sort((a, b) => a.time - b.time);

  const out: ParsedLine[] = [];
  for (let i = 0; i < all.length; i++) {
    if (!all[i].text) continue;
    const analyzable = /[぀-ヿ㐀-鿿]/.test(all[i].text);
    const next = all.slice(i + 1).find((line) => line.time > all[i].time);
    const end = next ? next.time : all[i].time + 4;
    out.push({ startTime: all[i].time, endTime: end, text: all[i].text, analyzable });
  }
  return out;
}

export function parsePlainLines(text: string): ParsedLine[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.map((t) => ({ startTime: 0, endTime: 0, text: t }));
}

export function hasLrcTimestamps(text: string): boolean {
  return text.split("\n").some((line) => TIMESTAMP_RE.test(line.trim()));
}

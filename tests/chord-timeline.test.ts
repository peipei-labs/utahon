import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { buildChordTimeline, type ChordTimelineRow } from "../lib/chord-timeline";
import { anchorChordsToLines } from "../lib/practice-schema";
import { getSong, updateSongLyrics } from "../lib/songs";
import type { AnalyzedLine, AnalyzedSong } from "../types/lyrics";
import { emptyPracticeData, type ChordEvent, type PracticeDataV1 } from "../types/practice";

const line = (startTime: number, endTime: number): AnalyzedLine => ({
  original: "歩こう", translation: "向前走", romaji: "arukou", tokens: [], startTime, endTime,
});
const chord = (id: string, startTime: number, endTime: number, symbol = "C"): ChordEvent => ({
  id, startTime, endTime, symbol, simplifiedSymbol: symbol, source: "auto", edited: false,
});
const ids = (row: ChordTimelineRow) => row.chords.map(chord => chord.id);
const display = (rows: ChordTimelineRow[]) => rows.map(row => ({
  kind: row.kind, label: row.kind === "instrumental" ? row.label : row.lineIndex, ids: ids(row),
}));

test("intro chords remain separate, and Bb continues into the first vocal line before D", () => {
  const lines = [line(17.47, 21.05), line(21.05, 25.21)];
  const chords = [chord("N", 0, 2.3, "N"), chord("Eb", 2.3, 3.3, "Eb"),
    chord("Bb", 15.44, 19.2, "Bb"), chord("D", 19.2, 21.06, "D"), chord("Gm", 21.06, 25.21, "Gm")];
  const before = structuredClone(chords);
  const result = buildChordTimeline(lines, chords, 25.21);
  assert.deepEqual(display(result), [
    { kind: "instrumental", label: "前奏", ids: ["N", "Eb", "Bb"] },
    { kind: "lyrics", label: 0, ids: ["Bb", "D"] },
    { kind: "lyrics", label: 1, ids: ["D", "Gm"] },
  ]);
  assert.deepEqual(chords, before, "display must not rewrite practice data");
});

test("interlude and outro cover all events, with half-open lyric boundaries", () => {
  const lines = [line(0, 4), line(8, 12)];
  const chords = [chord("tail", 12, 20), chord("middle", 4, 8), chord("second", 8, 12), chord("first", 0, 4)];
  const rows = buildChordTimeline(lines, chords, 20);
  assert.deepEqual(display(rows), [
    { kind: "lyrics", label: 0, ids: ["first"] },
    { kind: "instrumental", label: "间奏", ids: ["middle"] },
    { kind: "lyrics", label: 1, ids: ["second"] },
    { kind: "instrumental", label: "尾奏", ids: ["tail"] },
  ]);
  assert.deepEqual(new Set(rows.flatMap(ids)), new Set(chords.map(c => c.id)));
});

test("saved or imported nearest-line anchors do not move instrumental chords into lyrics", () => {
  const lines = [line(10, 15), line(20, 25)];
  const chords = [chord("intro", 0, 10), chord("verse", 10, 15), chord("gap", 15, 20), chord("outro", 25, 30)];
  const unanchored = buildChordTimeline(lines, chords, 30);
  const anchored = buildChordTimeline(lines, anchorChordsToLines(chords, lines), 30);
  assert.deepEqual(display(anchored), display(unanchored));
  assert.deepEqual(display(buildChordTimeline(lines, chords.map(c => ({ ...c, lineIndex: 99, tokenIndex: 99 })), 30)), display(unanchored));
});

test("breathing gaps preserve every chord without adding sections or extending playback times", () => {
  const lines = [line(1, 3), line(3.3, 5), line(7, 9)];
  const originalLines = structuredClone(lines);
  const chords = [chord("intro", 0, 1), chord("first", 1, 3), chord("breath", 3, 3.3),
    chord("second", 3.3, 5), chord("interlude", 5, 7), chord("third", 7, 9), chord("tail", 9, 9.5)];
  const rows = buildChordTimeline(lines, chords, 9.5);
  assert.deepEqual(display(rows), [
    { kind: "instrumental", label: "前奏", ids: ["intro"] },
    { kind: "lyrics", label: 0, ids: ["first", "breath"] },
    { kind: "lyrics", label: 1, ids: ["second"] },
    { kind: "instrumental", label: "间奏", ids: ["interlude"] },
    { kind: "lyrics", label: 2, ids: ["third"] },
    { kind: "instrumental", label: "尾奏", ids: ["tail"] },
  ]);
  assert.deepEqual(new Set(rows.flatMap(ids)), new Set(chords.map(c => c.id)));
  assert.deepEqual(lines, originalLines);
});

test("no timing uses a chord timeline instead of inventing a whole-song intro", () => {
  const chords = [chord("one", 3, 7), chord("two", 7, 10)];
  const rows = buildChordTimeline([line(0, 0), line(0, 0)], chords);
  assert.deepEqual(display(rows), [
    { kind: "instrumental", label: "和弦时间轴", ids: ["one", "two"] },
    { kind: "lyrics", label: 0, ids: [] },
    { kind: "lyrics", label: 1, ids: [] },
  ]);
  assert.equal(buildChordTimeline([], chords)[0].kind, "instrumental");
  assert.deepEqual(buildChordTimeline([], []), []);
});

test("partly untimed lyrics do not falsely identify gaps as instrumental sections", () => {
  const rows = buildChordTimeline([line(0, 0), line(10, 20)], [chord("intro", 0, 10), chord("verse", 10, 20)]);
  assert.equal(rows[1].kind, "instrumental");
  if (rows[1].kind === "instrumental") assert.equal(rows[1].label, "未对齐和弦");
});

test("silent gaps add no empty sections, and overlapping lyric windows do not create false gaps", () => {
  const rows = buildChordTimeline([line(2, 10), line(5, 8), line(10, 15)], [chord("held", 3, 12)]);
  assert.deepEqual(rows.map(row => row.kind), ["lyrics", "lyrics", "lyrics"]);
  assert.ok(rows.every(row => ids(row).includes("held")));
});

test("real lyric reanalysis can clear anchors without hiding any previously visible chord", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE songs (
      id TEXT PRIMARY KEY, title TEXT, artist TEXT, original_artist TEXT, lyrics TEXT,
      analyzed TEXT, lines_count INTEGER, youtube_url TEXT, youtube_id TEXT,
      source TEXT, duration_sec INTEGER, created_at INTEGER, updated_at INTEGER,
      interpretation_json TEXT NOT NULL DEFAULT ''
    ); CREATE TABLE song_practice (
      song_id TEXT PRIMARY KEY, audio_sha256 TEXT, practice_json TEXT, updated_at INTEGER
    )`);
    const analyzed: AnalyzedSong = { title: "Timeline regression", artist: "Fixture", youtubeUrl: "", youtubeId: "",
      lines: [line(17.47, 21.05), line(21.05, 25.21)] };
    const practice = { ...emptyPracticeData(30), chords: anchorChordsToLines([
      chord("intro", 0, 15.44), chord("Bb", 15.44, 19.2, "Bb"), chord("D", 19.2, 21.06, "D"), chord("tail", 25.21, 30),
    ], analyzed.lines) };
    db.prepare("INSERT INTO songs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')")
      .run("test", analyzed.title, analyzed.artist, analyzed.artist, "歩こう", JSON.stringify(analyzed), 2, "", "", "manual", 30, 1, 1);
    db.prepare("INSERT INTO song_practice VALUES (?, ?, ?, ?)").run("test", "a".repeat(64), JSON.stringify(practice), 1);
    const before = display(buildChordTimeline(analyzed.lines, practice.chords, 30));
    const updatedAnalysis = { ...analyzed, lines: analyzed.lines.map(l => ({ ...l, translation: "一起向前走" })) };
    assert.ok(updateSongLyrics("test", "歩こう", updatedAnalysis, 1, db));
    const saved = db.prepare("SELECT practice_json FROM song_practice WHERE song_id = ?").get("test") as { practice_json: string };
    const after = JSON.parse(saved.practice_json) as PracticeDataV1;
    assert.ok(after.chords.every(c => c.lineIndex === undefined));
    const song = getSong("test", db)!;
    assert.deepEqual(display(buildChordTimeline(song.analyzed.lines, after.chords, song.durationSec)), before);
    assert.deepEqual(new Set(buildChordTimeline(song.analyzed.lines, after.chords, 30).flatMap(ids)), new Set(practice.chords.map(c => c.id)));
  } finally {
    db.close();
  }
});

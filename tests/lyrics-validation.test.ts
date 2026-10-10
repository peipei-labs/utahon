import test from "node:test";
import assert from "node:assert/strict";
import { parseLRC, hasLrcTimestamps } from "../lib/lrc-parser";
import { validateAnalyzedLines } from "../lib/lyrics-validation";
import { selectMatchingTrack, fetchLrclibLyrics, type LrclibTrack } from "../lib/lrclib";

const input = parseLRC("[00:10]あ\n[00:20]い\n[00:30]う");
const annotated = (original: string) => ({
  original, translation: "示例", tokens: [{ surface: original, furigana: original, meaning: "示例", pos: "noun" }],
});

test("LRC accepts whole seconds, fractions and repeated timestamps without dropping lines", () => {
  const text = "[ar:Test]\n[00:10][00:20.50]君が好き\n[00:25.125]\n[00:30.1]あした";
  assert.equal(hasLrcTimestamps(text), true);
  assert.deepEqual(parseLRC(text).map(({ text, startTime, endTime }) => [text, startTime, endTime]), [
    ["君が好き", 10, 20.5], ["君が好き", 20.5, 25.125], ["あした", 30.1, 34.1],
  ]);
  assert.equal(hasLrcTimestamps("[00:70]あ"), false);
  assert.equal(hasLrcTimestamps("普通の歌詞"), false);
});

test("LRC simultaneous lines do not receive zero-length timing", () => {
  assert.deepEqual(parseLRC("[00:10]あ\n[00:10]い\n[00:20]う").map((line) => line.endTime), [20, 20, 24]);
});

test("mixed LRC never silently drops an untimed or invalid-timestamp lyric", () => {
  assert.throws(() => parseLRC("[00:10]あ\nい\n[00:30]う"), /时间标签/);
  assert.throws(() => parseLRC("[00:10]あ\n[00:70]い"), /时间标签/);
});

test("valid AI annotation keeps authoritative input timing", () => {
  const lines = validateAnalyzedLines({ lines: input.map((line) => annotated(line.text)) }, input);
  assert.deepEqual(lines.map((line) => line.startTime), [10, 20, 30]);
  assert.deepEqual(lines.map((line) => line.original), ["あ", "い", "う"]);
});

test("AI missing lines, reordered lines, changed text and incomplete tokens are rejected", () => {
  assert.throws(() => validateAnalyzedLines({ lines: [annotated("あ"), annotated("う")] }, input), /行数/);
  assert.throws(() => validateAnalyzedLines({ lines: [annotated("あ"), annotated("う"), annotated("い")] }, input), /順序|顺序/);
  assert.throws(() => validateAnalyzedLines({ lines: [annotated("あ"), annotated("え"), annotated("う")] }, input), /原文/);
  const malformed = input.map((line) => annotated(line.text));
  malformed[1].tokens[0].surface = "";
  assert.throws(() => validateAnalyzedLines({ lines: malformed }, input), /分词/);
  malformed[1].tokens[0].surface = "え";
  assert.throws(() => validateAnalyzedLines({ lines: malformed }, input), /还原/);
});

function track(patch: Partial<LrclibTrack> = {}): LrclibTrack {
  return { id: 1, trackName: "星の歌", artistName: "Rin", albumName: null, duration: 180,
    instrumental: false, plainLyrics: "あ", syncedLyrics: "[00:10]あ", ...patch };
}

test("LRCLIB rejects wrong title, artist, recording version and duration", () => {
  const query = { title: "星の歌", artist: "Rin", durationSec: 180 };
  const correct = track({ id: 5 });
  assert.equal(selectMatchingTrack([
    track({ trackName: "別の歌" }), track({ artistName: "Someone" }),
    track({ trackName: "星の歌 (Live)" }), track({ duration: 215 }), correct,
  ], query)?.id, 5);
  assert.equal(selectMatchingTrack([track({ trackName: "星の歌 (Live)" })], query), null);
  assert.equal(selectMatchingTrack([track(), track({ artistName: "Other" })], { title: "星の歌", artist: "" }), null);
  assert.equal(selectMatchingTrack([track(), track({ duration: 220 })], { title: "星の歌", artist: "Rin" }), null);
});

test("LRCLIB fallback does not accept the first unrelated search hit", async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requests.push(String(input));
    if (String(input).includes("/get?")) return new Response("{}", { status: 404 });
    return Response.json([track({ id: 1, artistName: "Wrong" }), track({ id: 2 })]);
  });
  const result = await fetchLrclibLyrics({ title: "星の歌", artist: "Rin", durationSec: 180 });
  assert.equal(result?.id, 2);
  assert.equal(requests.length, 2);
  assert.ok(requests[0].includes("duration=180"));
});

test("unknown duration cannot bypass recording ambiguity with a direct result", async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requests.push(String(input));
    return Response.json(String(input).includes("/get?") ? track() : [track(), track({ id: 2, duration: 220 })]);
  });
  assert.equal(await fetchLrclibLyrics({ title: "星の歌", artist: "Rin" }), null);
  assert.ok(requests.some((url) => url.includes("/search?")));
});

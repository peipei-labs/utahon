import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getSong, updateSongLyrics, updateSongSource } from "../lib/songs";
import { parsePlaybackSource, sourceFields, youtubeUrlFromShare } from "../lib/song-source";
import type { AnalyzedSong } from "../types/lyrics";

test("YouTube share URLs are preserved and unrelated platform links are not video IDs", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(youtubeUrlFromShare(`分享《测试》https://youtu.be/${id}?si=sample`), `https://www.youtube.com/watch?v=${id}`);
  assert.equal(parsePlaybackSource(`https://www.youtube.com/live/${id}`)?.id, id);
  assert.equal(youtubeUrlFromShare("https://open.spotify.com/track/test"), "");
  assert.equal(parsePlaybackSource(`https://notyoutube.example/watch?v=${id}`), null);
  const bv = parsePlaybackSource("BV1xx4y1m7rE")!;
  assert.equal(bv.kind, "bilibili");
  assert.deepEqual(sourceFields(bv), {
    youtubeUrl: "", youtubeId: "", transcriptionSourceUrl: "https://www.bilibili.com/video/BV1xx4y1m7rE/",
  });
});

test("source and lyrics changes compare versions atomically and keep player metadata in sync", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE songs (
      id TEXT PRIMARY KEY, title TEXT, artist TEXT, original_artist TEXT, lyrics TEXT,
      analyzed TEXT, lines_count INTEGER, youtube_url TEXT, youtube_id TEXT,
      source TEXT, duration_sec INTEGER, created_at INTEGER, updated_at INTEGER
    )`);
    const oldUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const analyzed: AnalyzedSong = { title: "测试", artist: "Rin", youtubeUrl: oldUrl,
      youtubeId: "dQw4w9WgXcQ", lines: [] };
    db.prepare("INSERT INTO songs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("test", "测试", "Rin", "Rin", "あ", JSON.stringify(analyzed), 0, oldUrl, "dQw4w9WgXcQ", "manual", 200, 1, 1);
    const newUrl = "https://www.youtube.com/watch?v=KNXrHFvX1Gs";
    assert.equal(updateSongSource("test", newUrl, 1, db), true);
    const updated = getSong("test", db)!;
    assert.equal(updated.youtubeId, "KNXrHFvX1Gs");
    assert.equal(updated.analyzed.youtubeUrl, newUrl);
    assert.equal(updated.durationSec, 0);
    assert.ok(updated.updatedAt > 1);
    assert.equal(updateSongLyrics("test", "い", analyzed, 1, db), false);
    assert.equal(getSong("test", db)!.lyrics, "あ");
    const bv = parsePlaybackSource("BV1xx4y1m7rE")!;
    assert.equal(updateSongLyrics("test", "う", { ...analyzed, ...sourceFields(bv) }, updated.updatedAt, db), true);
    const transcribed = getSong("test", db)!;
    assert.equal(transcribed.youtubeId, "");
    assert.equal(transcribed.analyzed.youtubeId, "");
    assert.equal(transcribed.analyzed.transcriptionSourceUrl, bv.url);
    assert.ok(transcribed.updatedAt > updated.updatedAt);
  } finally { db.close(); }
});

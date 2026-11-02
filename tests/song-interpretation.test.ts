import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { interpretationInputHash, parseStoredInterpretation, validateInterpretation } from "../lib/song-interpretation";
import type { AnalyzedSong } from "../types/lyrics";
import type { InterpretationContent, SongBackgroundSource, SongInterpretation } from "../types/song-interpretation";

function content(): InterpretationContent {
  return {
    summary: "在自己的节奏里，学会接纳不完美。", mainMessage: "可以理解为对急于获得答案的自我的安慰。",
    emotionalArc: "从焦急转向平静，结尾留下继续前行的空间。",
    tags: [{ tag: "人生", reason: "讨论选择与生活的节奏。" }, { tag: "自我接纳", reason: "允许自己暂时没有答案。" }],
    lyricEvidence: [{ lineNumbers: [1, 2], explanation: "前后两行从提问转为行动，形成情绪转折。" }],
    collection: { text: "没有取得作品集资料。", basis: "unknown", sourceIds: [] },
    era: { text: "未找到支持特定社会背景的资料。", basis: "unknown", sourceIds: [] },
    creation: { text: "可以理解为叙述者对自己的鼓励，不能推断歌手经历。", basis: "inference", sourceIds: [] },
  };
}
const analyzed: AnalyzedSong = { title: "纸上的道路", artist: "测试歌手", youtubeId: "", youtubeUrl: "",
  lines: ["朝の紙に道を描く", "小さな歩幅で進もう"].map((original, i) => ({ original, translation: "合成测试译文",
    romaji: "fixture", tokens: [], startTime: i * 10, endTime: i * 10 + 10 })) };
const songInput = { title: analyzed.title, artist: analyzed.artist, originalArtist: "", analyzed };
const source: SongBackgroundSource = { id: "apple-catalog", title: "测试作品集", url: "https://music.apple.com/jp/album/test/123",
  publisher: "Apple Music", excerpt: '{"collectionName":"测试作品集"}' };

test("interpretation validates existing line references, known themes and supplied sources only", () => {
  assert.deepEqual(validateInterpretation(content(), 2, []), content());
  const supported = content();
  supported.collection = { text: "目录列出所属作品集。", basis: "source", sourceIds: [source.id] };
  assert.deepEqual(validateInterpretation(supported, 2, [source]), supported);
  for (const patch of [
    { tags: [{ tag: "杜撰标签", reason: "测试" }] },
    { tags: [{ tag: "日常", reason: "不在当前标签白名单" }] },
    { tags: [content().tags[0], content().tags[0]] },
    { lyricEvidence: [{ lineNumbers: [0], explanation: "测试" }] },
    { lyricEvidence: [{ lineNumbers: [3], explanation: "测试" }] },
    { lyricEvidence: [{ lineNumbers: [1, 1], explanation: "测试" }] },
    { lyricEvidence: [{ lines: [1, 2], explanation: "字段名错误" }] },
    { collection: { text: "测试", basis: "source", sourceIds: [] } },
    { collection: { text: "测试", basis: "source", sourceIds: ["invented-source"] } },
    { collection: { text: "测试", basis: "unknown", sourceIds: [source.id] } },
    { summary: "x".repeat(301) }, { mainMessage: " " }, { emotionalArc: null },
  ]) assert.throws(() => validateInterpretation({ ...content(), ...patch }, 2, [source]), /格式不完整/);
});

test("interpretation fingerprint follows original lyrics and identity, not timing or annotations", () => {
  const hash = interpretationInputHash(songInput);
  assert.equal(interpretationInputHash({ ...songInput, analyzed: { ...analyzed,
    lines: analyzed.lines.map(line => ({ ...line, translation: "另一种翻译", startTime: 42 })) } }), hash);
  assert.notEqual(interpretationInputHash({ ...songInput, analyzed: { ...analyzed,
    lines: analyzed.lines.map(line => ({ ...line, original: `${line.original}&` })) } }), hash);
  assert.notEqual(interpretationInputHash({ ...songInput, title: "另一首" }), hash);
  assert.notEqual(interpretationInputHash({ ...songInput, originalArtist: "另一个原唱" }), hash);
});

test("stored results require valid metadata and safe source links", () => {
  const result: SongInterpretation = { ...content(), version: 1, generatedAt: Date.now(), model: "test-model",
    inputHash: interpretationInputHash(songInput), stale: false, sources: [source], backgroundNotes: [] };
  assert.deepEqual(parseStoredInterpretation(JSON.stringify(result)), result);
  for (const patch of [
    { inputHash: "wrong" }, { version: 2 }, { generatedAt: -1 }, { stale: "false" },
    { sources: [{ ...source, url: "javascript:alert(1)" }] },
    { sources: [{ ...source, url: "https://user:secret@example.com" }] },
  ]) assert.equal(parseStoredInterpretation(JSON.stringify({ ...result, ...patch })), undefined);
  assert.equal(parseStoredInterpretation("{broken"), undefined);
});

test("one-click route preserves existing work, rejects races and invalidates outdated themes", async (t) => {
  const originalCwd = process.cwd();
  const root = mkdtempSync(path.join(tmpdir(), "utahon-interpretation-test-"));
  const env = { base: process.env.AI_GATEWAY_BASE_URL, key: process.env.AI_GATEWAY_API_KEY,
    model: process.env.GEMINI_ANALYZE_MODEL, override: process.env.GEMINI_INTERPRET_MODEL };
  process.chdir(root);
  process.env.AI_GATEWAY_BASE_URL = "https://offline-test.invalid";
  process.env.AI_GATEWAY_API_KEY = "offline-test";
  process.env.GEMINI_ANALYZE_MODEL = "fixture-analysis-model";
  delete process.env.GEMINI_INTERPRET_MODEL;
  let close: (() => void) | undefined;
  try {
    const { createSong, getSong, listSongs, updateSongLyrics } = await import("../lib/songs");
    const { getDb } = await import("../lib/db");
    close = () => getDb().close();
    const { POST } = await import("../app/api/songs/[id]/interpretation/route");
    const id = createSong({ ...songInput, lyrics: analyzed.lines.map(line => line.original).join("\n") });
    const initial = getSong(id)!;
    getDb().prepare("INSERT INTO song_practice (song_id,audio_sha256,status,practice_json,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, "a".repeat(64), "ready", JSON.stringify({ chords: [{ id: "one", chord: "C", lineIndex: 0 }] }), 1, 1);
    const practice = getDb().prepare("SELECT * FROM song_practice WHERE song_id = ?").get(id);
    let mode: "valid" | "invalid" | "truncated" | "timeout" | "race" = "valid";
    let calls = 0;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "itunes.apple.com") return Response.json({ results: [] });
      if (url.hostname === "ja.wikipedia.org") return new Response("unavailable", { status: 403 });
      assert.equal(url.hostname, "offline-test.invalid", "tests cannot call an external model");
      assert.match(url.pathname, /fixture-analysis-model:generateContent$/);
      const body = JSON.parse(init!.body as string);
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      const prompt = body.contents[0].parts[0].text as string;
      assert.ok(prompt.includes(analyzed.lines[0].original));
      assert.match(prompt, /不能把自己的解读当成作者亲口确认的意图/);
      assert.match(prompt, /恋爱、失恋、人生、成长/);
      assert.match(prompt, /"lineNumbers":\[1\]/);
      calls++;
      if (mode === "timeout") throw new DOMException("timed out", "AbortError");
      if (mode === "race") {
        const current = getSong(id)!;
        assert.equal(updateSongLyrics(id, current.lyrics, { ...current.analyzed,
          lines: current.analyzed.lines.map(line => ({ ...line, startTime: 1 })) }, current.updatedAt), true);
      }
      return Response.json({ candidates: [{ finishReason: mode === "truncated" ? "MAX_TOKENS" : "STOP",
        content: { role: "model", parts: [{ text: JSON.stringify(mode === "invalid" ? { summary: "不完整" } : content()) }] } }] });
    });
    const send = (updatedAt = getSong(id)!.updatedAt, target = id) => POST(new Request("http://localhost/api/test", {
      method: "POST", body: JSON.stringify({ updatedAt }),
    }), { params: Promise.resolve({ id: target }) });
    assert.equal(calls, 0, "reading songs never automatically runs AI");
    assert.equal((await send(initial.updatedAt - 1)).status, 409);
    assert.equal((await send(initial.updatedAt, "missing")).status, 404);
    const emptyId = createSong({ title: "空歌", artist: "测试", lyrics: "", analyzed: { ...analyzed, lines: [] } });
    assert.equal((await send(getSong(emptyId)!.updatedAt, emptyId)).status, 400);
    assert.equal(calls, 0);
    const response = await send();
    assert.equal(response.status, 200);
    const returned = await response.json();
    const saved = getSong(id)!;
    assert.equal(returned.updatedAt, saved.updatedAt);
    assert.deepEqual(saved.analyzed, initial.analyzed);
    assert.equal(saved.lyrics, initial.lyrics);
    assert.deepEqual(getDb().prepare("SELECT * FROM song_practice WHERE song_id = ?").get(id), practice);
    assert.deepEqual(saved.interpretation?.sources, []);
    assert.ok(saved.interpretation?.backgroundNotes.some(note => note.includes("403")));
    assert.equal(saved.interpretation?.model, "fixture-analysis-model");
    assert.deepEqual(listSongs().find(song => song.id === id)?.themeTags, ["人生", "自我接纳"]);
    for (const failure of ["invalid", "truncated", "timeout"] as const) {
      mode = failure;
      assert.equal((await send()).status, failure === "timeout" ? 504 : 502);
      assert.deepEqual(getSong(id), saved, `${failure} must preserve the last result and lyrics`);
    }
    mode = "race";
    assert.equal((await send()).status, 409);
    const timed = getSong(id)!;
    assert.deepEqual(timed.interpretation, saved.interpretation, "a timing-only change keeps interpretation current");
    assert.deepEqual(timed.themeTags, saved.themeTags);
    const changed = { ...timed.analyzed, lines: timed.analyzed.lines.map(line => ({ ...line, original: `${line.original}&` })) };
    assert.equal(updateSongLyrics(id, "changed", changed, timed.updatedAt), true);
    assert.equal(getSong(id)!.interpretation?.stale, true);
    assert.equal(listSongs().find(song => song.id === id)?.themeTags, undefined);
    assert.equal(getSong(id)!.themeTags, undefined);
    assert.equal(getSong(id)!.interpretation?.summary, saved.interpretation?.summary);
    mode = "valid";
    assert.equal((await send()).status, 200);
    assert.equal(getSong(id)!.interpretation?.stale, false);
    assert.deepEqual(listSongs().find(song => song.id === id)?.themeTags, saved.themeTags);
  } finally {
    close?.();
    process.chdir(originalCwd);
    for (const [key, value] of Object.entries({ AI_GATEWAY_BASE_URL: env.base, AI_GATEWAY_API_KEY: env.key,
      GEMINI_ANALYZE_MODEL: env.model, GEMINI_INTERPRET_MODEL: env.override })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

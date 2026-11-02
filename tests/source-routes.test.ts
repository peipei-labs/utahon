import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import childProcess, { type ChildProcess } from "node:child_process";

test("isolated song routes preserve share sources, reject invalid analysis and avoid stale saves", async (t) => {
  const originalCwd = process.cwd();
  const temporaryCwd = mkdtempSync(path.join(tmpdir(), "utahon-source-tests-"));
  const oldBase = process.env.AI_GATEWAY_BASE_URL;
  const oldKey = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_BASE_URL = "https://offline-test.invalid";
  process.env.AI_GATEWAY_API_KEY = "offline-test";
  process.chdir(temporaryCwd);
  let closeDatabase: (() => void) | undefined;
  try {
    const { createSong, getSong, updateSongSource } = await import("../lib/songs");
    const { getDb } = await import("../lib/db");
    const { resolveTranscriptionSource } = await import("../lib/song-source");
    closeDatabase = () => getDb().close();
    const { POST: editLyrics } = await import("../app/api/songs/[id]/lyrics/route");
    const { POST: retranscribe } = await import("../app/api/songs/[id]/retranscribe/route");
    const { getPractice, setPracticeAudio, practiceTrackPath } = await import("../lib/practice");
    const { PUT: editPractice } = await import("../app/api/songs/[id]/practice/route");
    const { PATCH: editSource } = await import("../app/api/songs/[id]/route");
    const { POST: ingestShare } = await import("../app/api/import/share/ingest/route");
    const { POST: searchLyrics } = await import("../app/api/lyrics/search/route");
    const { POST: newSong } = await import("../app/api/songs/route");
    const { NextRequest } = await import("next/server");
    let mode: "invalid" | "valid" | "race" = "invalid";
    let lyricsUnavailable = false;
    let modelCalls = 0;
    const duringAnalysis = () => {
      assert.equal(updateSongSource(id, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", initial.updatedAt), true);
    };
    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://utaten.com/") || url.startsWith("https://www.uta-net.com/")) {
        return lyricsUnavailable ? new Response("temporarily unavailable", { status: 503 })
          : new Response("<html><body><p>該当する歌詞がありません</p></body></html>");
      }
      if (url.includes("lrclib.net/api/get")) return new Response("{}", { status: 404 });
      if (url.includes("lrclib.net/api/search")) return Response.json([]);
      assert.ok(url.startsWith("https://offline-test.invalid/"), "no external request is permitted");
      modelCalls++;
      if (mode === "race") duringAnalysis();
      const lines = mode === "invalid" ? [] : [{ original: "い", translation: "示例",
        tokens: [{ surface: "い", furigana: "い", meaning: "示例", pos: "noun" }] }];
      const isAudio = typeof init?.body === "string" && init.body.includes('"inlineData"');
      return Response.json({ candidates: [{ finishReason: "STOP", content: {
        role: "model", parts: [{ text: isAudio ? "[00:10]い" : `\`\`\`json\n${JSON.stringify({ lines })}\n\`\`\`` }],
      } }] });
    });
    const id = createSong({ title: "测试", artist: "Rin", lyrics: "あ",
      analyzed: { title: "测试", artist: "Rin", youtubeUrl: "", youtubeId: "", lines: [] } });
    const ctx = { params: Promise.resolve({ id }) };
    const initial = getSong(id)!;
    const mixed = await editLyrics(new Request("http://localhost/api/test", { method: "POST",
      body: JSON.stringify({ lyrics: "[00:10]あ\nい\n[00:30]う", updatedAt: initial.updatedAt }),
    }), ctx);
    assert.equal(mixed.status, 502);
    assert.match((await mixed.json()).error, /时间标签/);
    assert.deepEqual(getSong(id), initial);
    const lyricsSource = { provider: "utaten", url: "https://utaten.com/lyric/test123/", fetchedAt: 1700000000000 };
    const body = { lyrics: "[00:10]い", lyricsSource, updatedAt: initial.updatedAt };
    const request = () => new Request("http://localhost/api/test", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const failed = await editLyrics(request(), ctx);
    assert.equal(failed.status, 502);
    assert.equal(getSong(id)!.lyrics, "あ");
    assert.equal(getSong(id)!.updatedAt, initial.updatedAt);

    mode = "race";
    const conflict = await editLyrics(request(), ctx);
    assert.equal(conflict.status, 409);
    assert.equal(getSong(id)!.lyrics, "あ");
    const current = getSong(id)!;
    assert.equal(current.youtubeId, "dQw4w9WgXcQ");

    mode = "valid";
    body.updatedAt = current.updatedAt;
    body.lyrics = "[la:ja]\n[00:10]い";
    const saved = await editLyrics(request(), ctx);
    assert.equal(saved.status, 200);
    assert.equal(getSong(id)!.lyrics, body.lyrics);
    assert.equal(getSong(id)!.analyzed.lines[0].startTime, 10);
    assert.deepEqual(getSong(id)!.analyzed.lyricsSource, lyricsSource);
    const unchanged = await editLyrics(new Request("http://localhost/api/test", { method: "POST",
      body: JSON.stringify({ lyrics: body.lyrics, updatedAt: getSong(id)!.updatedAt }),
    }), ctx);
    assert.equal(unchanged.status, 200);
    assert.deepEqual(getSong(id)!.analyzed.lyricsSource, lyricsSource, "reanalyzing retains provenance");
    const manualEdit = await editLyrics(new Request("http://localhost/api/test", { method: "POST",
      body: JSON.stringify({ lyrics: "[00:11]い", updatedAt: getSong(id)!.updatedAt }),
    }), ctx);
    assert.equal(manualEdit.status, 200);
    assert.deepEqual(getSong(id)!.analyzed.lyricsSource, { ...lyricsSource, edited: true });
    const invalidSource = await editLyrics(new Request("http://localhost/api/test", { method: "POST",
      body: JSON.stringify({ lyrics: "い", updatedAt: getSong(id)!.updatedAt,
        lyricsSource: { provider: "utaten", url: "javascript:alert(1)" } }),
    }), ctx);
    assert.equal(invalidSource.status, 400);
    const created = await newSong(new NextRequest("http://localhost/api/songs", { method: "POST",
      body: JSON.stringify({ title: "新建示例", artist: "Rin", lyrics: "い", lyricsSource }),
    }));
    assert.equal(created.status, 201);
    assert.deepEqual(getSong((await created.json()).id)!.analyzed.lyricsSource, lyricsSource);
    const sourceConflict = await editSource(new NextRequest("http://localhost/api/test", {
      method: "PATCH", body: JSON.stringify({ youtubeUrl: "KNXrHFvX1Gs", updatedAt: initial.updatedAt }),
    }), ctx);
    assert.equal(sourceConflict.status, 409);

    const imported = await ingestShare(new Request("http://localhost/api/import/share/ingest", {
      method: "POST", body: JSON.stringify({ title: "新歌", artist: "Rin", sourceUrl: "https://youtu.be/KNXrHFvX1Gs/?si=sample" }),
    }));
    assert.equal(imported.status, 200);
    const outcome = await imported.json() as { kind: string; songId: string };
    assert.equal(outcome.kind, "placeholder");
    assert.equal(getSong(outcome.songId)!.youtubeId, "KNXrHFvX1Gs");
    assert.equal(getSong(outcome.songId)!.artist, "Rin");

    const beforeLookup = modelCalls;
    const lookup = () => new Request("http://localhost/api/lyrics/search", { method: "POST",
      body: JSON.stringify({ title: "示例曲", artist: "Rin" }),
    });
    assert.equal((await (await searchLyrics(lookup())).json()).kind, "not-found");
    lyricsUnavailable = true;
    assert.equal((await (await searchLyrics(lookup())).json()).kind, "unavailable");
    assert.equal(modelCalls, beforeLookup, "search never sends lyric text to a model");
    const inaccessible = await ingestShare(new Request("http://localhost/api/import/share/ingest", {
      method: "POST", body: JSON.stringify({ title: "另一个示例", artist: "Rin", sourceUrl: "https://youtu.be/abcdefghijk" }),
    }));
    const inaccessibleResult = await inaccessible.json();
    assert.equal(inaccessibleResult.kind, "fail", "upstream failure must not create a no-lyrics placeholder");
    assert.match(inaccessibleResult.reason, /无法访问/);
    assert.equal(inaccessibleResult.songId, undefined);
    lyricsUnavailable = false;
    const badLookup = await searchLyrics(new Request("http://localhost/api/lyrics/search", { method: "POST",
      body: JSON.stringify({ title: [], artist: "Rin" }),
    }));
    assert.equal(badLookup.status, 400);

    const bvUrl = "https://www.bilibili.com/video/BV1xx4y1m7rE/";
    const bvId = createSong({ title: "BV 歌曲", artist: "Rin", lyrics: "あ",
      analyzed: { title: "BV 歌曲", artist: "Rin", youtubeUrl: "", youtubeId: "",
        transcriptionSourceUrl: bvUrl, lines: [] } });
    const bvSaved = await editLyrics(new Request("http://localhost/api/test", { method: "POST",
      body: JSON.stringify({ lyrics: "[00:10]い", updatedAt: getSong(bvId)!.updatedAt }),
    }), { params: Promise.resolve({ id: bvId }) });
    assert.equal(bvSaved.status, 200);
    const bvEdited = getSong(bvId)!;
    assert.equal(bvEdited.analyzed.transcriptionSourceUrl, bvUrl);
    assert.equal(resolveTranscriptionSource("", bvEdited)?.url, bvUrl);
    assert.equal(resolveTranscriptionSource("", bvEdited)?.kind, "bilibili");
    assert.equal(bvEdited.youtubeId, "");

    const downloads: string[] = [];
    let downloadFails = false;
    t.mock.method(childProcess, "spawn", (_command: string, args: readonly string[]) => {
      downloads.push(args[args.length - 1]);
      writeFileSync(args[args.indexOf("-o") + 1], "offline audio fixture");
      const child = Object.assign(new EventEmitter(), { stderr: new PassThrough() });
      queueMicrotask(() => child.emit("close", downloadFails ? 1 : 0));
      return child as unknown as ChildProcess;
    });
    const sha = "a".repeat(64);
    const audioPath = practiceTrackPath(bvId, sha, "mix");
    mkdirSync(path.dirname(audioPath), { recursive: true });
    writeFileSync(audioPath, "offline audio fixture");
    setPracticeAudio(bvId, sha, 20);
    const bvContext = { params: Promise.resolve({ id: bvId }) };
    const bvRequest = (confirmed: boolean) => new Request("http://localhost/api/test", { method: "POST",
      body: JSON.stringify({ sourceInput: "", updatedAt: getSong(bvId)!.updatedAt, confirmLocalAudioSource: confirmed }),
    });
    const unconfirmed = await retranscribe(bvRequest(false), bvContext);
    assert.equal(unconfirmed.status, 400);
    assert.equal(downloads.length, 0);
    const confirmed = await retranscribe(bvRequest(true), bvContext);
    assert.equal(confirmed.status, 200);
    assert.deepEqual(downloads, [bvUrl]);
    assert.equal(getSong(bvId)!.analyzed.transcriptionSourceUrl, bvUrl);
    assert.equal(getSong(bvId)!.analyzed.lyricsSource?.provider, "audio");
    assert.equal(getSong(bvId)!.youtubeId, "");
    for (const [operation, sourceInput] of [
      ["source", "https://youtu.be/KNXrHFvX1Gs/"], ["source", ""],
      ["retranscribe", "https://youtu.be/dQw4w9WgXcQ/?si=sample"], ["retranscribe", bvUrl],
    ]) {
      await t.test(`${operation} ${sourceInput || "clear"} retains practice duration and bounds`, async () => {
        const beforeSong = getSong(bvId)!;
        const beforePractice = getPractice(bvId)!;
        const endpoint = "http://localhost/api/test";
        const changed = operation === "source"
          ? await editSource(new NextRequest(endpoint, { method: "PATCH",
            body: JSON.stringify({ youtubeUrl: sourceInput, updatedAt: beforeSong.updatedAt }),
          }), bvContext)
          : await retranscribe(new Request(endpoint, { method: "POST",
            body: JSON.stringify({ sourceInput, updatedAt: beforeSong.updatedAt, confirmLocalAudioSource: true }),
          }), bvContext);
        assert.equal(changed.status, 200);
        assert.equal(getSong(bvId)!.durationSec, 20);
        assert.ok(getSong(bvId)!.updatedAt > beforeSong.updatedAt);
        assert.deepEqual(getPractice(bvId), beforePractice);
        assert.equal(readFileSync(audioPath, "utf8"), "offline audio fixture");
        const invalid = { ...beforePractice.data, sections: [{ ...beforePractice.data.sections[0], startTime: 21, endTime: 25 }] };
        const rejected = await editPractice(new Request(endpoint, { method: "PUT",
          body: JSON.stringify({ data: invalid, baseUpdatedAt: beforePractice.updatedAt }),
        }), bvContext);
        assert.equal(rejected.status, 400);
        assert.match((await rejected.json()).error, /超出音频范围/);
        assert.deepEqual(getPractice(bvId), beforePractice);
        const currentSong = getSong(bvId)!;
        const stale = await editSource(new NextRequest(endpoint, { method: "PATCH",
          body: JSON.stringify({ youtubeUrl: "dQw4w9WgXcQ", updatedAt: beforeSong.updatedAt }),
        }), bvContext);
        assert.equal(stale.status, 409);
        assert.deepEqual(getSong(bvId), currentSong);
      });
    }
    downloadFails = true;
    const fetchesBefore = t.mock.method(globalThis, "fetch", () => { throw new Error("Failed downloads must not call AI"); });
    for (const sourceInput of [bvUrl, "dQw4w9WgXcQ"]) {
      const before = getSong(bvId)!;
      const failure = await retranscribe(new Request("http://localhost/api/test", { method: "POST",
        body: JSON.stringify({ sourceInput, updatedAt: before.updatedAt, confirmLocalAudioSource: true }),
      }), bvContext);
      assert.equal(failure.status, 502);
      assert.match((await failure.json()).error, /来源暂时无法下载/);
      assert.deepEqual(getSong(bvId), before);
    }
    assert.equal(fetchesBefore.mock.callCount(), 0);
  } finally {
    closeDatabase?.();
    process.chdir(originalCwd);
    if (oldBase === undefined) delete process.env.AI_GATEWAY_BASE_URL;
    else process.env.AI_GATEWAY_BASE_URL = oldBase;
    if (oldKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = oldKey;
    rmSync(temporaryCwd, { recursive: true, force: true });
  }
});

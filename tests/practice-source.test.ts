import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess, { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

test("source practice route downloads without AI and atomically preserves existing work", async (t) => {
  const previousCwd = process.cwd();
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "utahon-practice-source-test-"));
  process.chdir(fixtureRoot);
  const { getDb } = await import("../lib/db");
  const { createSong, getSong, updateSongSource } = await import("../lib/songs");
  const { getPractice, setPracticeAudio, practiceTrackPath, importPracticeData, savePracticeData } = await import("../lib/practice");
  const { POST } = await import("../app/api/songs/[id]/practice/source/route");
  const db = getDb();
  let mode: "success" | "fail" | "long" | "large" | "timeout" = "success";
  const audio = "normalized audio";
  let duringDownload: (() => void) | undefined;
  const downloads: string[] = [];
  const downloadDirs: string[] = [];
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  t.mock.method(globalThis, "fetch", () => { throw new Error("AI and network calls are forbidden"); });
  t.mock.method(childProcess, "spawn", (command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
      kill() { queueMicrotask(() => child.emit("close", null)); return true; },
    });
    if (command === "uv") {
      const output = args[args.indexOf("-o") + 1];
      downloads.push(args.at(-1)!);
      downloadDirs.push(path.dirname(output));
      writeFileSync(output, "downloaded audio");
      duringDownload?.();
      if (mode === "timeout") {
        queueMicrotask(() => t.mock.timers.tick(70_001));
        return child as unknown as ChildProcess;
      }
    } else if (command === "ffmpeg") {
      writeFileSync(args.at(-1)!, mode === "large" ? Buffer.alloc(100 * 1024 * 1024 + 1) : audio);
    } else {
      assert.equal(command, "ffprobe");
    }
    queueMicrotask(() => {
      if (command === "ffprobe") child.stdout.write(JSON.stringify({ streams: [{ codec_type: "audio" }],
        format: { duration: mode === "long" ? "7201" : "20" } }));
      child.emit("close", mode === "fail" && command === "uv" ? 1 : 0);
    });
    return child as unknown as ChildProcess;
  });
  const makeSong = (source = "https://www.youtube.com/watch?v=dQw4w9WgXcQ") => createSong({
    title: "测试", artist: "Rin", lyrics: "[00:04.50]あ", durationSec: 20,
    analyzed: { title: "测试", artist: "Rin", youtubeUrl: source, youtubeId: "",
      lines: [{ original: "あ", translation: "示例", romaji: "a", tokens: [], startTime: 4.5, endTime: 10 }] },
  });
  const bodyFor = (id: string) => ({ songUpdatedAt: getSong(id)!.updatedAt, baseUpdatedAt: getPractice(id)!.updatedAt });
  const call = (id: string, body: unknown) => POST(new Request("http://localhost/api/test", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
  const installExisting = (id: string, text = "old audio") => {
    const sha256 = hash(text);
    const target = practiceTrackPath(id, sha256, "mix");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
    return setPracticeAudio(id, sha256, 20);
  };
  const assertClean = () => {
    for (const directory of downloadDirs) assert.ok(!existsSync(directory), `temporary audio retained: ${directory}`);
    const root = path.join(fixtureRoot, "data/practice");
    if (existsSync(root)) for (const song of readdirSync(root)) {
      assert.ok(readdirSync(path.join(root, song)).every((name) => !name.startsWith(".source-")));
    }
  };
  try {
    await t.test("existing YouTube source becomes pending audio with lyrics and timing unchanged", async () => {
      const id = makeSong();
      const before = getSong(id)!;
      const response = await call(id, bodyFor(id));
      assert.equal(response.status, 201);
      const practice = getPractice(id)!;
      assert.equal(practice.status, "pending");
      assert.equal(practice.hasAudio, true);
      assert.equal(practice.audioSha256, hash(audio));
      assert.equal(downloads.at(-1), before.analyzed.youtubeUrl);
      assert.deepEqual(getSong(id)!.analyzed.lines, before.analyzed.lines);
      assert.equal(getSong(id)!.lyrics, before.lyrics);
      assert.ok(getSong(id)!.updatedAt > before.updatedAt);
      assertClean();
    });
    await t.test("explicit BV source is saved only with successfully downloaded audio", async () => {
      const id = makeSong();
      const response = await call(id, { ...bodyFor(id), sourceInput: "BV1xx4y1m7rE" });
      assert.equal(response.status, 201);
      const song = getSong(id)!;
      assert.equal(song.youtubeId, "");
      assert.equal(song.analyzed.youtubeUrl, "");
      assert.equal(song.analyzed.transcriptionSourceUrl, "https://www.bilibili.com/video/BV1xx4y1m7rE/");
      assert.equal(downloads.at(-1), song.analyzed.transcriptionSourceUrl);
      assertClean();
    });
    await t.test("missing/unsafe source, invalid versions and missing song never download", async () => {
      const id = makeSong("");
      const count = downloads.length;
      for (const sourceInput of ["", "https://127.0.0.1/private", "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ", "file:///etc/passwd"]) {
        assert.equal((await call(id, { ...bodyFor(id), sourceInput })).status, 400);
      }
      assert.equal((await call(id, { sourceInput: "dQw4w9WgXcQ" })).status, 400);
      assert.equal((await call("missing-song", { songUpdatedAt: 0, baseUpdatedAt: 0 })).status, 404);
      assert.equal(downloads.length, count);
    });
    await t.test("an already stale song or practice version is rejected before downloading", async () => {
      const id = makeSong();
      const count = downloads.length;
      const request = bodyFor(id);
      assert.equal((await call(id, { ...request, songUpdatedAt: request.songUpdatedAt - 1 })).status, 409);
      assert.equal((await call(id, { ...request, baseUpdatedAt: 1 })).status, 409);
      assert.equal(downloads.length, count);
    });
    await t.test("replacing an existing audio requires explicit confirmation and archives the old file", async () => {
      const id = makeSong();
      const previous = installExisting(id);
      const oldPath = practiceTrackPath(id, previous.audioSha256, "mix");
      assert.equal((await call(id, bodyFor(id))).status, 409);
      assert.equal(readFileSync(oldPath, "utf8"), "old audio");
      assert.equal((await call(id, { ...bodyFor(id), replaceExisting: true })).status, 201);
      assert.ok(!existsSync(oldPath));
      const archived = readdirSync(path.join(fixtureRoot, "data/trash")).find((name) => name.includes(id));
      assert.ok(archived);
      assert.equal(readFileSync(path.join(fixtureRoot, "data/trash", archived, "mix.m4a"), "utf8"), "old audio");
      assertClean();
    });
    await t.test("a pre-existing damaged same-hash directory is never overwritten", async () => {
      const id = makeSong();
      const previous = installExisting(id);
      const target = practiceTrackPath(id, hash(audio), "mix");
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, "preserve this damaged copy");
      const response = await call(id, { ...bodyFor(id), replaceExisting: true });
      assert.equal(response.status, 502);
      assert.equal(readFileSync(target, "utf8"), "preserve this damaged copy");
      assert.deepEqual(getPractice(id), previous);
      assertClean();
    });
    await t.test("same audio preserves ready analysis and existing stem files", async () => {
      const id = makeSong();
      const previous = installExisting(id, audio);
      const ready = importPracticeData(id, previous.audioSha256, previous.updatedAt, { ...previous.data, capo: 4 });
      const stemPath = practiceTrackPath(id, ready.audioSha256, "vocals");
      mkdirSync(path.dirname(stemPath), { recursive: true });
      writeFileSync(stemPath, "keep stem");
      assert.equal((await call(id, { ...bodyFor(id), replaceExisting: true })).status, 200);
      assert.deepEqual(getPractice(id), ready);
      assert.equal(readFileSync(stemPath, "utf8"), "keep stem");
      assertClean();
    });
    await t.test("failed, oversized and overlong downloads do not change existing source or audio", async () => {
      const id = makeSong();
      const previous = installExisting(id);
      const song = getSong(id)!;
      for (const failure of ["fail", "long", "large"] as const) {
        mode = failure;
        const response = await call(id, { ...bodyFor(id), sourceInput: "BV1xx4y1m7rE", replaceExisting: true });
        assert.ok(response.status === 400 || response.status === 502);
        assert.deepEqual(getPractice(id), previous);
        assert.deepEqual(getSong(id), song);
        assert.equal(readFileSync(practiceTrackPath(id, previous.audioSha256, "mix"), "utf8"), "old audio");
        assertClean();
      }
      mode = "success";
    });
    await t.test("timeout returns 504, preserving original audio and cleaning downloaded data", async () => {
      const id = makeSong();
      const previous = installExisting(id);
      t.mock.timers.enable({ apis: ["setTimeout"] });
      mode = "timeout";
      try {
        assert.equal((await call(id, { ...bodyFor(id), replaceExisting: true })).status, 504);
        assert.deepEqual(getPractice(id), previous);
        assertClean();
      } finally {
        mode = "success";
        t.mock.timers.reset();
      }
    });
    await t.test("source edits and practice edits during download win over the stale request", async () => {
      for (const race of ["source", "practice", "upload", "import"] as const) {
        const id = makeSong();
        const previous = installExisting(id);
        const initialSong = getSong(id)!;
        duringDownload = () => {
          if (race === "source") updateSongSource(id, "https://www.youtube.com/watch?v=KNXrHFvX1Gs", initialSong.updatedAt);
          if (race === "practice") savePracticeData(id, { ...previous.data, capo: 3 }, previous.updatedAt);
          if (race === "upload") installExisting(id, "new upload");
          if (race === "import") importPracticeData(id, previous.audioSha256, previous.updatedAt, { ...previous.data, capo: 2 });
        };
        const response = await call(id, { songUpdatedAt: initialSong.updatedAt, baseUpdatedAt: previous.updatedAt, replaceExisting: true });
        duringDownload = undefined;
        assert.equal(response.status, 409, race);
        assert.notEqual(getPractice(id)!.audioSha256, hash(audio));
        assert.equal(readFileSync(practiceTrackPath(id, previous.audioSha256, "mix"), "utf8"), "old audio");
        assertClean();
      }
    });
    await t.test("audio updates never move the song version backwards", () => {
      const id = makeSong();
      const future = Date.now() + 100_000;
      db.prepare("UPDATE songs SET updated_at = ? WHERE id = ?").run(future, id);
      installExisting(id);
      assert.ok(getSong(id)!.updatedAt > future);
    });
  } finally {
    db.close();
    process.chdir(previousCwd);
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

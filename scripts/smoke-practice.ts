import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { getDb } from "@/lib/db";
import { importPracticeData, setPracticeFailure } from "@/lib/practice";
import { createSong } from "@/lib/songs";
import type { PracticeRecord } from "@/types/practice";

const baseUrl = process.env.UTAHON_SMOKE_URL || "http://127.0.0.1:3107";
const STEMS = ["vocals", "drums", "bass", "other"] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function jsonResponse(response: Response): Promise<PracticeRecord> {
  const body = await response.json();
  assert(response.ok, `HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body as PracticeRecord;
}

async function main(): Promise<void> {
  const songId = createSong({
    title: "Practice smoke test",
    artist: "Utahon",
    lyrics: "[00:00.00]テスト",
    durationSec: 6,
    analyzed: {
      title: "Practice smoke test",
      artist: "Utahon",
      youtubeUrl: "",
      youtubeId: "",
      lines: [
        {
          original: "テスト",
          translation: "测试",
          romaji: "tesuto",
          tokens: [],
          startTime: 0,
          endTime: 6,
        },
      ],
    },
  });
  const tempDir = path.join(process.cwd(), ".tmp", `practice-smoke-${process.pid}`);
  const audioPath = path.join(tempDir, "test.wav");
  const replacementPath = path.join(tempDir, "replacement.wav");
  const incoming = path.join(process.cwd(), "data", "incoming", `smoke-${process.pid}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const generated = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=261.63:duration=6",
        "-ar",
        "44100",
        "-ac",
        "2",
        audioPath,
      ],
      { stdio: "inherit" }
    );
    assert(generated.status === 0, "无法生成测试音频");

    let practice = await jsonResponse(
      await fetch(`${baseUrl}/api/songs/${songId}/practice/audio`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: fs.readFileSync(audioPath),
      })
    );
    assert(practice.hasAudio && practice.status === "pending", "上传后状态不正确");
    assert(/^[a-f0-9]{64}$/.test(practice.audioSha256), "音频 SHA-256 无效");

    const range = await fetch(`${baseUrl}/api/songs/${songId}/practice/audio/mix`, {
      headers: { Range: "bytes=0-99" },
    });
    assert(range.status === 206, "Range 请求没有返回 206");
    assert((await range.arrayBuffer()).byteLength === 100, "Range 长度不正确");

    practice.data.chords = [
      {
        id: "smoke-c",
        startTime: 0,
        endTime: 3,
        symbol: "C:maj7",
        simplifiedSymbol: "C",
        source: "auto",
        edited: false,
      },
      {
        id: "smoke-g",
        startTime: 3,
        endTime: 6,
        symbol: "G:7",
        simplifiedSymbol: "G7",
        source: "auto",
        edited: false,
      },
    ];
    practice = await jsonResponse(
      await fetch(`${baseUrl}/api/songs/${songId}/practice`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: practice.data, baseUpdatedAt: practice.updatedAt }),
      })
    );
    assert(practice.data.chords[0].symbol === "Cmaj7", "和弦规范化失败");

    fs.mkdirSync(incoming, { recursive: true });
    const files: Record<string, { name: string; sha256: string }> = {};
    for (const stem of STEMS) {
      const stemPath = path.join(incoming, `${stem}.m4a`);
      const encoded = spawnSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          audioPath,
          "-c:a",
          "aac",
          "-b:a",
          "64k",
          stemPath,
        ],
        { stdio: "inherit" }
      );
      assert(encoded.status === 0, `无法生成 ${stem} 测试分轨`);
      files[stem] = { name: path.basename(stemPath), sha256: sha256(stemPath) };
    }
    fs.writeFileSync(
      path.join(incoming, "manifest.json"),
      JSON.stringify({
        version: 1,
        songId,
        audioSha256: practice.audioSha256,
        baseUpdatedAt: practice.updatedAt,
        generatedAt: new Date().toISOString(),
        data: { ...practice.data, stems: [...STEMS], analyzers: { smoke: "1" } },
        files,
      })
    );
    const imported = spawnSync(
      "npm",
      ["run", "practice:import", "--", path.relative(process.cwd(), incoming)],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    assert(imported.status === 0, imported.stderr || imported.stdout || "分析包导入失败");

    const finalRecord = await jsonResponse(
      await fetch(`${baseUrl}/api/songs/${songId}/practice`, { cache: "no-store" })
    );
    assert(finalRecord.status === "ready", "导入后状态不是 ready");
    assert(finalRecord.data.chords.every((chord) => chord.lineIndex === 0), "和弦没有对齐歌词行");
    assert(finalRecord.data.stems.length === 4, "四轨声明没有保存");
    let staleImportRejected = false;
    try {
      importPracticeData(
        songId,
        finalRecord.audioSha256,
        finalRecord.updatedAt - 1,
        finalRecord.data
      );
    } catch {
      staleImportRejected = true;
    }
    assert(staleImportRejected, "过期分析包没有被并发版本检查拒绝");
    const stemRange = await fetch(`${baseUrl}/api/songs/${songId}/practice/audio/vocals`, {
      headers: { Range: "bytes=0-63" },
    });
    assert(stemRange.status === 206, "分轨 Range 请求没有返回 206");
    assert((await stemRange.arrayBuffer()).byteLength === 64, "分轨 Range 长度不正确");

    const replacement = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=329.63:duration=5",
        "-ar",
        "44100",
        "-ac",
        "2",
        replacementPath,
      ],
      { stdio: "inherit" }
    );
    assert(replacement.status === 0, "无法生成替换音频");
    const replaced = await jsonResponse(
      await fetch(`${baseUrl}/api/songs/${songId}/practice/audio`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: fs.readFileSync(replacementPath),
      })
    );
    assert(replaced.status === "pending", "替换音频后没有重新进入 pending");
    assert(replaced.data.stems.length === 0, "替换音频后仍声明旧分轨");
    assert(replaced.data.chords.length === 0, "替换音频后仍保留未编辑的旧和弦");
    assert(
      !setPracticeFailure(songId, finalRecord.audioSha256, finalRecord.updatedAt, "旧任务失败"),
      "旧音频任务错误地覆盖了新音频状态"
    );
    console.log(
      JSON.stringify({
        ok: true,
        upload: "normalized",
        range: "206/100-bytes",
        chords: finalRecord.data.chords.length,
        import: finalRecord.status,
        stems: finalRecord.data.stems.length,
        replaceReset: true,
        concurrencyLock: true,
      })
    );
  } finally {
    getDb().prepare("DELETE FROM songs WHERE id = ?").run(songId);
    fs.rmSync(path.join(process.cwd(), "data", "practice", songId), { recursive: true, force: true });
    const trashRoot = path.join(process.cwd(), "data", "trash");
    if (fs.existsSync(trashRoot)) {
      for (const name of fs.readdirSync(trashRoot)) {
        if (name.includes(songId)) {
          fs.rmSync(path.join(trashRoot, name), { recursive: true, force: true });
        }
      }
    }
    fs.rmSync(incoming, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

void main();

import fs from "fs";
import path from "path";
import { getDb } from "./db";
import { validatePracticeData } from "./practice-schema";
import {
  emptyPracticeData,
  type PracticeDataV1,
  type PracticeRecord,
  type PracticeStatus,
  type PracticeTrack,
} from "@/types/practice";

export const PRACTICE_ROOT = path.join(process.cwd(), "data", "practice");
const PRACTICE_TRASH = path.join(process.cwd(), "data", "trash");
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_SHA256 = /^[a-f0-9]{64}$/;

type PracticeRow = {
  song_id: string;
  audio_sha256: string;
  status: PracticeStatus;
  practice_json: string;
  last_error: string;
  updated_at: number;
};

type SongDurationRow = { duration_sec: number };

function nextUpdatedAt(previous: number): number {
  return Math.max(Date.now(), previous + 1);
}

export function assertSafeSongId(songId: string): void {
  if (!SAFE_ID.test(songId)) throw new Error("歌曲 ID 无效");
}

export function assertSafeSha256(sha256: string): void {
  if (!SAFE_SHA256.test(sha256)) throw new Error("音频 SHA-256 无效");
}

function songDuration(songId: string): number | null {
  const row = getDb()
    .prepare("SELECT duration_sec FROM songs WHERE id = ?")
    .get(songId) as SongDurationRow | undefined;
  return row ? Math.max(0, row.duration_sec) : null;
}

export function songExists(songId: string): boolean {
  assertSafeSongId(songId);
  return songDuration(songId) !== null;
}

function parsePracticeJson(raw: string, durationSec: number): PracticeDataV1 {
  if (!raw) return emptyPracticeData(durationSec);
  try {
    return validatePracticeData(JSON.parse(raw), durationSec);
  } catch (error) {
    console.error("[utahon] invalid song_practice JSON:", error);
    return emptyPracticeData(durationSec);
  }
}

export function getPractice(songId: string): PracticeRecord | null {
  assertSafeSongId(songId);
  const durationSec = songDuration(songId);
  if (durationSec === null) return null;
  const row = getDb()
    .prepare(
      `SELECT song_id, audio_sha256, status, practice_json, last_error, updated_at
       FROM song_practice WHERE song_id = ?`
    )
    .get(songId) as PracticeRow | undefined;
  if (!row) {
    return {
      songId,
      audioSha256: "",
      status: "none",
      lastError: "",
      data: emptyPracticeData(durationSec),
      hasAudio: false,
      updatedAt: 0,
    };
  }
  const hasAudio = Boolean(
    row.audio_sha256 &&
      fs.existsSync(practiceTrackPath(songId, row.audio_sha256, "mix"))
  );
  return {
    songId: row.song_id,
    audioSha256: row.audio_sha256,
    status: row.status,
    lastError: row.last_error,
    data: parsePracticeJson(row.practice_json, durationSec),
    hasAudio,
    updatedAt: row.updated_at,
  };
}

export function setPracticeAudio(songId: string, sha256: string, durationSec: number): PracticeRecord {
  return getDb().transaction(() => setPracticeAudioInTransaction(songId, sha256, durationSec)).immediate();
}

function setPracticeAudioInTransaction(songId: string, sha256: string, durationSec: number): PracticeRecord {
  assertSafeSongId(songId);
  assertSafeSha256(sha256);
  const current = getPractice(songId);
  if (!current) throw new Error("歌曲不存在");
  const song = getDb().prepare("SELECT updated_at FROM songs WHERE id = ?").get(songId) as { updated_at: number };
  const now = nextUpdatedAt(Math.max(current.updatedAt, song.updated_at));
  let data = current.data;
  if (current.audioSha256 !== sha256) {
    data = emptyPracticeData(durationSec);
    data.capo = current.data.capo;
    data.chordDisplay = current.data.chordDisplay;
    data.chords = current.data.chords.filter(
      (chord) =>
        (chord.edited || chord.source === "manual") &&
        chord.startTime >= 0 &&
        chord.endTime <= durationSec
    );
    data.sections.push(
      ...current.data.sections.filter(
        (section) =>
          section.label !== "full" &&
          (section.edited || section.source === "manual") &&
          section.startTime >= 0 &&
          section.endTime <= durationSec
      )
    );
  }
  getDb()
    .prepare(
      `INSERT INTO song_practice
         (song_id, audio_sha256, status, practice_json, last_error, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, '', ?, ?)
       ON CONFLICT(song_id) DO UPDATE SET
         audio_sha256 = excluded.audio_sha256,
         status = 'pending',
         practice_json = excluded.practice_json,
         last_error = '',
         updated_at = excluded.updated_at`
    )
    .run(songId, sha256, JSON.stringify(data), now, now);
  getDb()
    .prepare("UPDATE songs SET duration_sec = ?, updated_at = ? WHERE id = ?")
    .run(Math.max(0, Math.round(durationSec)), now, songId);
  return getPractice(songId)!;
}

export class PracticeConflictError extends Error {
  constructor() {
    super("练习数据已更新，本次修改尚未保存。请先保留需要的修改，再载入最新分析结果。");
    this.name = "PracticeConflictError";
  }
}

export function savePracticeData(songId: string, value: unknown, expectedUpdatedAt: number): PracticeRecord {
  if (!Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt < 0) {
    throw new Error("缺少有效的练习数据版本，请刷新页面后重试");
  }
  const current = getPractice(songId);
  if (!current) throw new Error("歌曲不存在");
  if (current.updatedAt !== expectedUpdatedAt) throw new PracticeConflictError();
  const durationSec = songDuration(songId) ?? 0;
  const data = validatePracticeData(value, durationSec);
  const now = nextUpdatedAt(current.updatedAt);
  const result = expectedUpdatedAt === 0
    ? getDb().prepare(
        `INSERT INTO song_practice
           (song_id, audio_sha256, status, practice_json, last_error, created_at, updated_at)
         VALUES (?, '', 'none', ?, '', ?, ?) ON CONFLICT(song_id) DO NOTHING`
      ).run(songId, JSON.stringify(data), now, now)
    : getDb().prepare(
        `UPDATE song_practice SET practice_json = ?, updated_at = ?
         WHERE song_id = ? AND updated_at = ?`
      ).run(JSON.stringify(data), now, songId, expectedUpdatedAt);
  if (result.changes !== 1) throw new PracticeConflictError();
  return getPractice(songId)!;
}

export function importPracticeData(
  songId: string,
  sha256: string,
  expectedUpdatedAt: number,
  value: unknown
): PracticeRecord {
  assertSafeSha256(sha256);
  const current = getPractice(songId);
  if (!current) throw new Error("歌曲不存在");
  if (current.audioSha256 !== sha256) throw new Error("分析包对应的音频已经不是当前版本");
  const durationSec = songDuration(songId) ?? 0;
  const data = validatePracticeData(value, durationSec);
  const now = nextUpdatedAt(current.updatedAt);
  const result = getDb()
    .prepare(
      `UPDATE song_practice
       SET status = 'ready', practice_json = ?, last_error = '', updated_at = ?
       WHERE song_id = ? AND audio_sha256 = ? AND updated_at = ?`
    )
    .run(JSON.stringify(data), now, songId, sha256, expectedUpdatedAt);
  if (result.changes !== 1) {
    throw new Error("分析期间练习谱已在网页中修改；为避免覆盖新内容，请重新运行分析");
  }
  return getPractice(songId)!;
}

export function setPracticeFailure(
  songId: string,
  sha256: string,
  expectedUpdatedAt: number,
  message: string
): boolean {
  assertSafeSongId(songId);
  assertSafeSha256(sha256);
  const text = message.trim().slice(0, 1000);
  const result = getDb()
    .prepare(
      `UPDATE song_practice SET status = 'failed', last_error = ?, updated_at = ?
       WHERE song_id = ? AND audio_sha256 = ? AND updated_at = ?`
    )
    .run(text, nextUpdatedAt(expectedUpdatedAt), songId, sha256, expectedUpdatedAt);
  return result.changes === 1;
}

export function practiceVersionDir(songId: string, sha256: string): string {
  assertSafeSongId(songId);
  assertSafeSha256(sha256);
  return path.join(PRACTICE_ROOT, songId, sha256);
}

export function practiceTrackPath(
  songId: string,
  sha256: string,
  track: PracticeTrack
): string {
  const fileName = track === "mix" ? "mix.m4a" : path.join("stems", `${track}.m4a`);
  return path.join(practiceVersionDir(songId, sha256), fileName);
}

export function trashPracticeFiles(songId: string): void {
  assertSafeSongId(songId);
  const source = path.join(PRACTICE_ROOT, songId);
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(PRACTICE_TRASH, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.renameSync(source, path.join(PRACTICE_TRASH, `${stamp}-${songId}`));
}

export function trashPracticeVersion(songId: string, sha256: string): void {
  const source = practiceVersionDir(songId, sha256);
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(PRACTICE_TRASH, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.renameSync(source, path.join(PRACTICE_TRASH, `${stamp}-${songId}-${sha256.slice(0, 12)}`));
}

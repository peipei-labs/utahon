import { randomUUID } from "crypto";
import { getDb } from "./db";
import { extractYoutubeId } from "./youtube";
import { trashPracticeFiles } from "./practice";
import type Database from "better-sqlite3";
import type { AnalyzedSong, SongMeta, SongFull, SongSource } from "@/types/lyrics";

type SongListRow = {
  id: string;
  title: string;
  artist: string;
  original_artist: string;
  lines_count: number;
  created_at: number;
  youtube_id: string;
  source: SongSource;
  duration_sec: number;
};

function archiveDeletedPractice(songId: string): void {
  try {
    trashPracticeFiles(songId);
  } catch (error) {
    console.error(`[utahon] failed to archive practice files for deleted song ${songId}:`, error);
  }
}

type SongDetailRow = SongListRow & {
  lyrics: string;
  analyzed: string;
  youtube_url: string;
  updated_at: number;
};

function parseAnalyzed(raw: string, id: string): AnalyzedSong | null {
  try {
    return JSON.parse(raw) as AnalyzedSong;
  } catch (e) {
    console.error(`[utahon] corrupt analyzed JSON for song id=${id}:`, e);
    return null;
  }
}

export function createSong(data: {
  title: string;
  artist: string;
  originalArtist?: string;
  lyrics: string;
  analyzed: AnalyzedSong;
  youtubeUrl?: string;
  lrclibId?: number;
  source?: SongSource;
  durationSec?: number | null;
}): string {
  const id = randomUUID();
  const now = Date.now();
  const title = data.title?.trim() || "未命名";
  const artist = data.artist?.trim() || "未知";
  const originalArtist = data.originalArtist?.trim() ?? "";
  const linesCount = data.analyzed.lines.length;
  const youtubeUrl = data.youtubeUrl?.trim() ?? data.analyzed.youtubeUrl ?? "";
  const youtubeId = extractYoutubeId(youtubeUrl);
  const lrclibId = data.lrclibId ?? 0;
  const source: SongSource = data.source ?? "manual";
  const durationSec = Math.max(0, Math.round(data.durationSec ?? 0));

  getDb()
    .prepare(
      `INSERT INTO songs
         (id, title, artist, original_artist, lyrics, analyzed, lines_count,
          youtube_url, youtube_id, lrclib_id, source, duration_sec,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      title,
      artist,
      originalArtist,
      data.lyrics,
      JSON.stringify(data.analyzed),
      linesCount,
      youtubeUrl,
      youtubeId,
      lrclibId,
      source,
      durationSec,
      now,
      now
    );
  return id;
}

export function listSongs(): SongMeta[] {
  const rows = getDb()
    .prepare(
      `SELECT id, title, artist, original_artist, lines_count, created_at,
              youtube_id, source, duration_sec
       FROM songs
       ORDER BY created_at DESC`
    )
    .all() as SongListRow[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    originalArtist: r.original_artist,
    linesCount: r.lines_count,
    createdAt: r.created_at,
    youtubeId: r.youtube_id,
    source: r.source,
    durationSec: r.duration_sec,
  }));
}

export function getSong(id: string, database: Database.Database = getDb()): SongFull | null {
  const row = database
    .prepare(
      `SELECT id, title, artist, original_artist, lyrics, analyzed, lines_count,
              youtube_url, youtube_id, source, duration_sec, created_at, updated_at
       FROM songs WHERE id = ?`
    )
    .get(id) as SongDetailRow | undefined;

  if (!row) return null;
  const analyzed = parseAnalyzed(row.analyzed, row.id);
  if (!analyzed) return null;

  analyzed.youtubeUrl = row.youtube_url;
  analyzed.youtubeId = row.youtube_id;

  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    originalArtist: row.original_artist,
    lyrics: row.lyrics,
    linesCount: row.lines_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    youtubeId: row.youtube_id,
    source: row.source,
    durationSec: row.duration_sec,
    analyzed,
  };
}

export function deleteSong(id: string): boolean {
  const result = getDb().prepare(`DELETE FROM songs WHERE id = ?`).run(id);
  if (result.changes > 0) archiveDeletedPractice(id);
  return result.changes > 0;
}

export function deleteSongs(ids: string[]): number {
  if (ids.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM songs WHERE id = ?`);
  const tx = db.transaction((batch: string[]) => {
    const deleted: string[] = [];
    for (const id of batch) {
      const r = stmt.run(id);
      if (r.changes > 0) deleted.push(id);
    }
    return deleted;
  });
  const deleted = tx(ids);
  for (const id of deleted) archiveDeletedPractice(id);
  return deleted.length;
}

export function updateSongLyrics(
  id: string,
  lyrics: string,
  analyzed: AnalyzedSong,
  expectedUpdatedAt: number,
  database: Database.Database = getDb()
): boolean {
  const youtubeUrl = analyzed.youtubeUrl;
  const youtubeId = extractYoutubeId(youtubeUrl);
  const result = database
    .prepare(
      `UPDATE songs
         SET lyrics = ?, analyzed = ?, lines_count = ?, updated_at = ?,
             duration_sec = CASE WHEN youtube_url = ? OR EXISTS (
               SELECT 1 FROM song_practice
               WHERE song_id = songs.id AND audio_sha256 != ''
             ) THEN duration_sec ELSE 0 END,
             youtube_url = ?, youtube_id = ?
         WHERE id = ? AND updated_at = ?`
    )
    .run(
      lyrics, JSON.stringify({ ...analyzed, youtubeId }), analyzed.lines.length,
      Math.max(Date.now(), expectedUpdatedAt + 1), youtubeUrl, youtubeUrl, youtubeId,
      id, expectedUpdatedAt
    );
  return result.changes > 0;
}

export function updateSongSource(
  id: string,
  youtubeUrl: string,
  expectedUpdatedAt: number,
  database: Database.Database = getDb()
): boolean {
  const song = getSong(id, database);
  if (!song || song.updatedAt !== expectedUpdatedAt) return false;
  return updateSongLyrics(id, song.lyrics, {
    ...song.analyzed, youtubeUrl, youtubeId: extractYoutubeId(youtubeUrl),
  }, expectedUpdatedAt, database);
}

export function existsByYoutubeId(youtubeId: string): boolean {
  if (!youtubeId) return false;
  const row = getDb()
    .prepare(`SELECT 1 FROM songs WHERE youtube_id = ? LIMIT 1`)
    .get(youtubeId);
  return Boolean(row);
}

export function existsByLrclibId(lrclibId: number): boolean {
  if (!lrclibId || lrclibId <= 0) return false;
  const row = getDb()
    .prepare(`SELECT 1 FROM songs WHERE lrclib_id = ? LIMIT 1`)
    .get(lrclibId);
  return Boolean(row);
}

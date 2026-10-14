import { fetchLrclibLyrics } from "./lrclib";
import { analyzeLyrics } from "./analyze-pipeline";
import { createSong, existsByYoutubeId, existsByLrclibId } from "./songs";
import { extractYoutubeId } from "./youtube";
import type { AnalyzedSong, SongSource } from "@/types/lyrics";

export type VideoRef = {
  id: string;
  url: string;
  uploader?: string;
  duration?: number | null;
};

export type SongInput = {
  title: string;
  artist: string;
  video: VideoRef | null;
  source: SongSource;
};

export type SongOutcome =
  | {
      kind: "ok";
      songId: string;
      songName: string;
      artistName: string;
      originalArtist: string;
      lines: number;
      hasTimestamps: boolean;
    }
  | {
      kind: "placeholder";
      songId: string;
      songName: string;
    }
  | {
      kind: "skip-existing";
      songName: string;
      reason: "youtube_id" | "lrclib_id";
    }
  | { kind: "fail"; songName: string; reason: string };

const TOPIC_SUFFIX = /\s+-\s+Topic\s*$/i;

function stripTopic(raw: string): string {
  return raw.trim().replace(TOPIC_SUFFIX, "").trim();
}

export async function processSong(input: SongInput): Promise<SongOutcome> {
  const songName = input.title.trim() || "未命名";
  const youtubeUrl = input.video ? input.video.url : "";

  if (input.video && existsByYoutubeId(input.video.id)) {
    return { kind: "skip-existing", songName, reason: "youtube_id" };
  }

  try {
    const lrclib = await fetchLrclibLyrics({
      title: songName,
      artist: input.artist,
      durationSec: input.video?.duration,
    });

    if (lrclib && existsByLrclibId(lrclib.id)) {
      return { kind: "skip-existing", songName, reason: "lrclib_id" };
    }

    if (!lrclib) {
      if (!input.video) {
        return { kind: "fail", songName, reason: "no_lyrics_no_video" };
      }
      const emptyAnalyzed: AnalyzedSong = {
        title: songName,
        artist: input.artist,
        youtubeUrl,
        youtubeId: extractYoutubeId(youtubeUrl),
        lines: [],
      };
      const songId = createSong({
        title: songName,
        artist: input.artist,
        lyrics: "",
        analyzed: emptyAnalyzed,
        youtubeUrl,
        source: input.source,
        durationSec: input.video.duration ?? null,
      });
      return { kind: "placeholder", songId, songName };
    }

    const providedArtist = input.artist.trim();
    const rawUploader = input.video?.uploader?.trim() || "";
    const cleaned = stripTopic(rawUploader);
    const displayArtist =
      input.source === "netease" || input.source === "share"
        ? providedArtist || cleaned || rawUploader || lrclib.artistName
        : rawUploader || lrclib.artistName;

    const analyzed = await analyzeLyrics({
      lyrics: lrclib.lyrics,
      title: songName,
      artist: displayArtist,
      youtubeUrl,
    });
    analyzed.originalArtist = lrclib.artistName;

    const songId = createSong({
      title: songName,
      artist: displayArtist,
      originalArtist: lrclib.artistName,
      lyrics: lrclib.lyrics,
      analyzed,
      youtubeUrl,
      lrclibId: lrclib.id,
      source: input.source,
      durationSec: input.video?.duration ?? null,
    });

    return {
      kind: "ok",
      songId,
      songName,
      artistName: displayArtist,
      originalArtist: lrclib.artistName,
      lines: analyzed.lines.length,
      hasTimestamps: lrclib.hasTimestamps,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: "fail", songName, reason };
  }
}

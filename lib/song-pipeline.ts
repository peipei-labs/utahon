import { searchLyrics } from "./lyrics-sources";
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
    const lookup = await searchLyrics({
      title: songName,
      artist: input.artist,
      durationSec: input.video?.duration ?? undefined,
    });

    if (lookup.kind === "unavailable") {
      return { kind: "fail", songName, reason: "歌词来源暂时无法访问，不能判断没有歌词；请稍后重试或手工提供原文" };
    }
    const found = lookup.kind === "found" ? lookup.candidate : null;
    if (found?.lrclibId && found.source.provider === "lrclib" && existsByLrclibId(found.lrclibId)) {
      return { kind: "skip-existing", songName, reason: "lrclib_id" };
    }

    if (!found) {
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
        ? providedArtist || cleaned || rawUploader || found.artistName
        : rawUploader || found.artistName;

    const analyzed = await analyzeLyrics({
      lyrics: found.lyrics,
      title: songName,
      artist: displayArtist,
      youtubeUrl,
    });
    analyzed.originalArtist = found.artistName;
    analyzed.lyricsSource = found.source;

    const songId = createSong({
      title: songName,
      artist: displayArtist,
      originalArtist: found.artistName,
      lyrics: found.lyrics,
      analyzed,
      youtubeUrl,
      lrclibId: found.source.provider === "lrclib" ? found.lrclibId : undefined,
      source: input.source,
      durationSec: input.video?.duration ?? null,
    });

    return {
      kind: "ok",
      songId,
      songName,
      artistName: displayArtist,
      originalArtist: found.artistName,
      lines: analyzed.lines.length,
      hasTimestamps: found.hasTimestamps,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: "fail", songName, reason };
  }
}

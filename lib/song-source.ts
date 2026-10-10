import type { SourceRef } from "./source";
import type { SongFull } from "@/types/lyrics";

export function parsePlaybackSource(input: string): SourceRef | null {
  const value = input.trim();
  if (/^BV[A-Za-z0-9]{10}$/.test(value)) {
    return { kind: "bilibili", id: value, url: `https://www.bilibili.com/video/${value}/` };
  }
  let id = /^[A-Za-z0-9_-]{11}$/.test(value) ? value : "";
  if (!id) {
    let url: URL;
    try { url = new URL(value); } catch { return null; }
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (["www.bilibili.com", "bilibili.com", "m.bilibili.com"].includes(host)) {
      const bv = url.pathname.match(/^\/video\/(BV[A-Za-z0-9]{10})(?:\/|$)/)?.[1];
      return bv ? { kind: "bilibili", id: bv, url: `https://www.bilibili.com/video/${bv}/` } : null;
    }
    if (host === "youtu.be" || host === "www.youtu.be") id = url.pathname.slice(1);
    else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      id = url.pathname === "/watch"
        ? url.searchParams.get("v") ?? ""
        : url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] ?? "";
    }
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id)
    ? { kind: "youtube", id, url: `https://www.youtube.com/watch?v=${id}` }
    : null;
}

export function youtubeUrlFromShare(text: string): string {
  const direct = parsePlaybackSource(text);
  if (direct?.kind === "youtube") return direct.url;
  for (const url of text.match(/https?:\/\/[^\s<>「」『』《》]+/g) ?? []) {
    const parsed = parsePlaybackSource(url.replace(/[).,，。！!？?]+$/, ""));
    if (parsed?.kind === "youtube") return parsed.url;
  }
  return "";
}

export function sourceFields(source: SourceRef) {
  return {
    youtubeUrl: source.kind === "youtube" ? source.url : "",
    youtubeId: source.kind === "youtube" ? source.id : "",
    transcriptionSourceUrl: source.url,
  };
}

export function resolveTranscriptionSource(input: string, song: Pick<SongFull, "analyzed" | "youtubeId">): SourceRef | null {
  const sourceUrl = input.trim() || song.analyzed.youtubeUrl || song.analyzed.transcriptionSourceUrl ||
    (song.youtubeId ? `https://www.youtube.com/watch?v=${song.youtubeId}` : "");
  return parsePlaybackSource(sourceUrl);
}

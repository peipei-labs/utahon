import type { LyricsSourceMeta } from "@/types/lyrics-source";

export const LYRICS_SOURCE_NAMES = {
  utaten: "UtaTen",
  "uta-net": "歌ネット",
  lrclib: "LRCLIB",
  manual: "手工录入",
  audio: "音频转录草稿",
} as const;

function sourceUrl(value: unknown, provider: LyricsSourceMeta["provider"]): string | undefined {
  if (typeof value !== "string" || value.length > 1000) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    const valid = provider === "utaten" ? url.hostname === "utaten.com" && /^\/lyric\/[a-zA-Z0-9]+\/?$/.test(url.pathname)
      : provider === "uta-net" ? url.hostname === "www.uta-net.com" && /^\/song\/\d+\/?$/.test(url.pathname)
      : provider === "lrclib" ? url.hostname === "lrclib.net"
      : provider === "audio" ? ["www.youtube.com", "www.bilibili.com"].includes(url.hostname)
      : false;
    return valid ? url.href : undefined;
  } catch { return undefined; }
}

export function parseLyricsSource(value: unknown): LyricsSourceMeta | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  if (typeof data.provider !== "string" || !Object.hasOwn(LYRICS_SOURCE_NAMES, data.provider)) return undefined;
  const provider = data.provider as LyricsSourceMeta["provider"];
  const url = sourceUrl(data.url, provider);
  if (data.url !== undefined && !url) return undefined;
  if (["utaten", "uta-net", "lrclib"].includes(provider) && !url) return undefined;
  const timingUrl = sourceUrl(data.timingUrl, "lrclib");
  return {
    provider,
    ...(url ? { url } : {}),
    ...(typeof data.fetchedAt === "number" && Number.isSafeInteger(data.fetchedAt) && data.fetchedAt > 0 ? { fetchedAt: data.fetchedAt } : {}),
    ...(data.timingProvider === "lrclib" && timingUrl ? { timingProvider: "lrclib", timingUrl } : {}),
    ...(data.edited === true ? { edited: true } : {}),
  };
}

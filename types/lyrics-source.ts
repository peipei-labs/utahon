export type LyricsProvider = "utaten" | "uta-net" | "lrclib";

export type LyricsSourceMeta = {
  provider: LyricsProvider | "manual" | "audio";
  url?: string;
  fetchedAt?: number;
  timingProvider?: "lrclib";
  timingUrl?: string;
  edited?: boolean;
};

export type LyricsCandidate = {
  trackName: string;
  artistName: string;
  lyrics: string;
  hasTimestamps: boolean;
  source: LyricsSourceMeta;
  lrclibId?: number;
};

export type LyricsSearchAttempt = {
  provider: LyricsProvider;
  status: "found" | "not-found" | "unavailable";
  message?: string;
};

export type LyricsSearchResult =
  | { kind: "found"; candidate: LyricsCandidate; attempts: LyricsSearchAttempt[] }
  | { kind: "not-found" | "unavailable"; attempts: LyricsSearchAttempt[] };

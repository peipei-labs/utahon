const LRCLIB_BASE = "https://lrclib.net/api";
const USER_AGENT = "utahon (https://github.com/peipei-personal/utahon)";

export type LrclibTrack = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

export type LrclibResult = {
  id: number;
  trackName: string;
  artistName: string;
  duration: number;
  lyrics: string;
  hasTimestamps: boolean;
};

export async function fetchLrclibLyrics(params: {
  title: string;
  artist: string;
  durationSec?: number | null;
}): Promise<LrclibResult | null> {
  const title = params.title.trim();
  const artist = params.artist.trim();
  if (!title) return null;

  if (artist && params.durationSec && params.durationSec > 0) {
    const direct = await tryGet(title, artist, params.durationSec);
    const matched = selectMatchingTrack(direct ? [direct] : [], params);
    if (matched) return pickLyrics(matched);
  }

  const q = artist ? `${artist} ${title}` : title;
  const list = await trySearch(q);
  const matched = selectMatchingTrack(list, params);
  return matched ? pickLyrics(matched) : null;
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function selectMatchingTrack(
  tracks: LrclibTrack[],
  params: { title: string; artist: string; durationSec?: number | null }
): LrclibTrack | null {
  const title = normalizeName(params.title);
  const artist = normalizeName(params.artist);
  const duration = params.durationSec && params.durationSec > 0 ? params.durationSec : null;
  const candidates = tracks.filter((track) =>
    normalizeName(track.trackName) === title &&
    (!artist || normalizeName(track.artistName) === artist) &&
    !track.instrumental && Boolean(track.syncedLyrics?.trim() || track.plainLyrics?.trim()) &&
    (!duration || Math.abs(track.duration - duration) <= 2)
  );
  if (!candidates.length) return null;
  if (!artist && new Set(candidates.map((track) => normalizeName(track.artistName))).size > 1) {
    return null;
  }
  if (!duration && Math.max(...candidates.map((track) => track.duration)) -
      Math.min(...candidates.map((track) => track.duration)) > 2) {
    return null;
  }
  return candidates.sort((a, b) => {
    if (duration) {
      const distance = Math.abs(a.duration - duration) - Math.abs(b.duration - duration);
      if (distance) return distance;
    }
    return Number(Boolean(b.syncedLyrics?.trim())) - Number(Boolean(a.syncedLyrics?.trim()));
  })[0];
}

async function tryGet(
  trackName: string,
  artistName: string,
  durationSec?: number | null
): Promise<LrclibTrack | null> {
  const url = new URL(`${LRCLIB_BASE}/get`);
  url.searchParams.set("track_name", trackName);
  url.searchParams.set("artist_name", artistName);
  if (durationSec && durationSec > 0) url.searchParams.set("duration", String(durationSec));

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lrclib 服务返回错误 (${res.status})`);
  return (await res.json()) as LrclibTrack;
}

async function trySearch(q: string): Promise<LrclibTrack[]> {
  const url = new URL(`${LRCLIB_BASE}/search`);
  url.searchParams.set("q", q);

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`lrclib 搜索失败 (${res.status})`);
  return (await res.json()) as LrclibTrack[];
}

function pickLyrics(track: LrclibTrack): LrclibResult | null {
  const base = {
    id: track.id,
    trackName: track.trackName,
    artistName: track.artistName,
    duration: track.duration,
  };
  if (track.syncedLyrics && track.syncedLyrics.trim()) {
    return { ...base, lyrics: track.syncedLyrics, hasTimestamps: true };
  }
  if (track.plainLyrics && track.plainLyrics.trim()) {
    return { ...base, lyrics: track.plainLyrics, hasTimestamps: false };
  }
  return null;
}

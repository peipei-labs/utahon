import type { SongBackground, SongBackgroundSource } from "../types/song-interpretation";

type Params = { title: string; artist: string; durationSec?: number | null };
type JsonObject = Record<string, unknown>;
const TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_EXCERPT = 6_000;
const USER_AGENT = "Utahon/1.0 (https://github.com/peipei-labs/utahon)";
class BackgroundError extends Error {}

function object(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function name(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").toLowerCase().replace(/\s+/gu, "") : "";
}

function allowedRequest(url: URL, host: string): boolean {
  return url.protocol === "https:" && url.hostname === host && !url.port && !url.username && !url.password && !url.hash &&
    (host === "itunes.apple.com" ? /^\/(?:search|lookup)$/.test(url.pathname) : url.pathname === "/w/api.php");
}

async function request(url: URL, signal: AbortSignal): Promise<unknown> {
  const host = url.hostname;
  if (!["itunes.apple.com", "ja.wikipedia.org"].includes(host)) throw new BackgroundError("不支持的来源地址");
  for (let redirect = 0; redirect <= 2; redirect++) {
    if (!allowedRequest(url, host)) throw new BackgroundError("来源跳转到了不支持的地址");
    const response = await fetch(url, { signal, redirect: "manual", cache: "no-store", headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirect === 2) throw new BackgroundError("来源跳转异常");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new BackgroundError(`HTTP ${response.status}`); }
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new BackgroundError("响应超过大小限制");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new BackgroundError("来源返回空数据");
    const decoder = new TextDecoder();
    let text = "";
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new BackgroundError("响应超过大小限制");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    try { return JSON.parse(text); } catch { throw new BackgroundError("来源未返回有效 JSON"); }
  }
  throw new BackgroundError("来源跳转异常");
}

function failure(error: unknown, signal: AbortSignal): string {
  return signal.aborted ? "请求超时" : error instanceof BackgroundError ? error.message : "暂时无法连接";
}

async function collect(label: string, work: (signal: AbortSignal) => Promise<SongBackground>): Promise<SongBackground> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await work(controller.signal); }
  catch (error) { return { sources: [], notes: [`${label}资料不足：${failure(error, controller.signal)}。`] }; }
  finally { clearTimeout(timer); }
}

function results(data: unknown): JsonObject[] {
  if (!object(data) || !Array.isArray(data.results) || !data.results.every(object)) throw new BackgroundError("目录响应结构异常");
  return data.results;
}

function matches(track: JsonObject, params: Params): boolean {
  return track.wrapperType === "track" && track.kind === "song" &&
    name(track.trackName) === name(params.title) && name(track.artistName) === name(params.artist) &&
    Number.isSafeInteger(track.trackId) && Number(track.trackId) > 0 &&
    Number.isSafeInteger(track.collectionId) && Number(track.collectionId) > 0 &&
    (!(params.durationSec && Number.isFinite(params.durationSec) && params.durationSec > 0) ||
      (typeof track.trackTimeMillis === "number" && Math.abs(track.trackTimeMillis / 1000 - params.durationSec) <= 3));
}

function displayUrl(value: unknown, host: string, path: RegExp): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === host && !url.port && !url.username && !url.password && path.test(url.pathname)) return url.toString();
  } catch { /* Missing or invalid provider URLs are not replaced with invented links. */ }
}

function fields(record: JsonObject, keys: string[]): JsonObject {
  const result: JsonObject = {};
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") result[key] = value.slice(0, 240);
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
  }
  return result;
}

async function apple(params: Params, signal: AbortSignal): Promise<SongBackground> {
  const searchUrl = new URL("https://itunes.apple.com/search");
  for (const [key, value] of Object.entries({ term: `${params.title} ${params.artist}`, country: "jp", media: "music", entity: "song", lang: "ja_jp", limit: "25" })) searchUrl.searchParams.set(key, value);
  const found = results(await request(searchUrl, signal)).filter((track) => matches(track, params));
  if (!found.length) return { sources: [], notes: ["Apple 日本目录资料不足：未找到歌名、歌手和时长均匹配的歌曲。"] };
  const selected = { ...found[0] };
  const notes = ["Apple 日期仅代表该目录版本的发行信息，不能据此认定首次发行或创作年份。"];
  if (new Set(found.map((track) => `${track.collectionId}:${track.releaseDate}`)).size > 1) {
    notes.push("Apple 目录存在多个匹配的专辑或发行日期；保留目录列出的版本信息，未按最早日期推定原始发行。");
  }
  let album: JsonObject | undefined;
  let tracks: JsonObject[] = [];
  try {
    const lookupUrl = new URL("https://itunes.apple.com/lookup");
    for (const [key, value] of Object.entries({ id: String(selected.collectionId), entity: "song", country: "jp", lang: "ja_jp" })) lookupUrl.searchParams.set(key, value);
    const entries = results(await request(lookupUrl, signal));
    album = entries.find((item) => item.wrapperType === "collection" && item.collectionId === selected.collectionId);
    const confirmed = entries.find((item) => item.trackId === selected.trackId && item.collectionId === selected.collectionId && matches(item, params));
    if (!album || !confirmed) { album = undefined; throw new BackgroundError("专辑与歌曲的关联未能复核"); }
    tracks = entries.filter((item) => item.wrapperType === "track" && item.kind === "song" && item.collectionId === selected.collectionId && typeof item.trackName === "string");
    if (confirmed.releaseDate !== selected.releaseDate) notes.push("Apple 搜索与专辑详情的歌曲发行日期不同，保留两处原始字段，不推断首次发行日期。");
    Object.assign(selected, confirmed);
  } catch (error) {
    notes.push(`Apple 专辑详情资料不足：${failure(error, signal)}；仅保留已取得的歌曲目录信息。`);
  }
  const albumPath = new RegExp(`/album/[^/]+/${selected.collectionId}/?$`);
  const url = displayUrl(album?.collectionViewUrl, "music.apple.com", albumPath) || displayUrl(selected.collectionViewUrl, "music.apple.com", albumPath);
  if (!url) throw new BackgroundError("目录未提供可核验的 Apple Music 链接");
  const metadata = {
    track: fields(selected, ["trackId", "trackName", "artistName", "collectionId", "collectionName", "releaseDate", "discNumber", "trackNumber", "trackCount", "trackTimeMillis", "primaryGenreName"]),
    collection: album ? fields(album, ["collectionId", "collectionName", "artistName", "releaseDate", "trackCount", "copyright"]) : undefined,
    matchingReleases: found.slice(0, 5).map((item) => fields(item, ["trackId", "collectionId", "collectionName", "releaseDate"])),
    albumTracks: tracks.slice(0, 30).map((item) => fields(item, ["discNumber", "trackNumber", "trackName"])),
  };
  let shortened = found.length > 5 || tracks.length > 30;
  while (JSON.stringify(metadata).length > MAX_EXCERPT && metadata.albumTracks.length) { metadata.albumTracks.pop(); shortened = true; }
  while (JSON.stringify(metadata).length > MAX_EXCERPT && metadata.matchingReleases.length > 1) { metadata.matchingReleases.pop(); shortened = true; }
  if (shortened) notes.push("Apple 目录摘录按长度限制仅保留部分版本或专辑曲目。");
  const source: SongBackgroundSource = { id: "apple-catalog", title: `${String(selected.artistName).slice(0, 240)} · ${String(album?.collectionName || selected.collectionName).slice(0, 240)}`,
    url, publisher: "Apple Music / iTunes 日本目录", excerpt: JSON.stringify(metadata) };
  return { sources: [source], notes };
}

async function wikipedia(artist: string, signal: AbortSignal): Promise<SongBackground> {
  const url = new URL("https://ja.wikipedia.org/w/api.php");
  for (const [key, value] of Object.entries({ action: "query", format: "json", formatversion: "2", titles: artist,
    prop: "extracts|pageprops|info", inprop: "url", explaintext: "1", exchars: "4000" })) url.searchParams.set(key, value);
  const data = await request(url, signal);
  if (!object(data) || !object(data.query) || !Array.isArray(data.query.pages)) throw new BackgroundError("页面响应结构异常");
  const pages = data.query.pages;
  const page = pages.length === 1 && object(pages[0]) ? pages[0] : undefined;
  if (!page || page.missing !== undefined || page.invalid !== undefined || page.ns !== 0 || name(page.title) !== name(artist)) {
    return { sources: [], notes: ["日本维基百科资料不足：没有可确认的同名歌手页面，未采用模糊搜索结果。"] };
  }
  if (object(page.pageprops) && Object.hasOwn(page.pageprops, "disambiguation")) {
    return { sources: [], notes: ["日本维基百科资料不足：同名页面是消歧义页，未选择其中某个人物。"] };
  }
  if (typeof page.extract !== "string" || !page.extract.trim()) return { sources: [], notes: ["日本维基百科资料不足：歌手页面没有可用正文。"] };
  const sourceUrl = displayUrl(page.fullurl, "ja.wikipedia.org", /^\/wiki\/[^/]+/);
  if (!sourceUrl) throw new BackgroundError("页面未提供可核验的百科链接");
  return { sources: [{ id: "wikipedia-artist", title: String(page.title).slice(0, 240), url: sourceUrl, publisher: "日本語版ウィキペディア", excerpt: page.extract.trim().slice(0, 4000) }],
    notes: ["百科资料介绍歌手或乐队，不能据此认定歌词叙述者的经历或该曲的创作动机。"] };
}

export async function fetchSongBackground(params: Params): Promise<SongBackground> {
  params = { ...params, title: params.title.trim(), artist: params.artist.trim() };
  if (!params.title || !params.artist) return { sources: [], notes: ["背景资料不足：需要明确的歌名和歌手，未猜测歌曲身份。"] };
  const results = await Promise.all([
    collect("Apple 日本目录", (signal) => apple(params, signal)),
    collect("日本维基百科", (signal) => wikipedia(params.artist, signal)),
  ]);
  return { sources: results.flatMap((result) => result.sources), notes: results.flatMap((result) => result.notes) };
}

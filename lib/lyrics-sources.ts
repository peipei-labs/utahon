import { load, type CheerioAPI } from "cheerio";
import { parseLRC } from "./lrc-parser";
import { selectMatchingTrack, type LrclibTrack } from "./lrclib";
import type { LyricsCandidate, LyricsProvider, LyricsSearchAttempt, LyricsSearchResult } from "../types/lyrics-source";

type SearchParams = { title: string; artist: string; durationSec?: number | null; sourceUrl?: string };
type ProviderResult = { attempt: LyricsSearchAttempt; candidate?: LyricsCandidate };
type PageProvider = Exclude<LyricsProvider, "lrclib">;
const ORIGINS = { utaten: "https://utaten.com", "uta-net": "https://www.uta-net.com", lrclib: "https://lrclib.net" };
const MAX_BYTES = 2 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 12_000;
const USER_AGENT = "Utahon/1.0 (https://github.com/peipei-labs/utahon)";
class SourceError extends Error {}

function normalizeName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
}

function matches(title: string, artist: string, params: SearchParams): boolean {
  return normalizeName(title) === normalizeName(params.title) && normalizeName(artist) === normalizeName(params.artist);
}

function allowedUrl(url: URL, provider: LyricsProvider): boolean {
  if (url.origin !== ORIGINS[provider] || url.username || url.password || url.hash) return false;
  if (provider === "utaten") return /^\/lyric\/[a-zA-Z0-9]+\/$/.test(url.pathname) || /^\/search(?:\/.*)?$/.test(url.pathname);
  if (provider === "uta-net") return /^\/song\/\d+\/$/.test(url.pathname) || /^\/search2?\/$/.test(url.pathname);
  return /^\/api\/(search|get|(?:get\/\d+))$/.test(url.pathname);
}

function sourcePage(value: string): { provider: PageProvider; url: URL } {
  let url: URL;
  try { url = new URL(value); } catch { throw new SourceError("歌词来源链接格式无效"); }
  for (const provider of ["utaten", "uta-net"] as const) {
    if (allowedUrl(url, provider) && !url.search && /^\/(?:lyric\/[a-zA-Z0-9]+|song\/\d+)\/$/.test(url.pathname)) {
      return { provider, url };
    }
  }
  throw new SourceError("歌词来源链接仅支持 UtaTen 或歌ネット的 HTTPS 歌词详情页");
}

export function validateLyricsSourceUrl(value: string): void {
  sourcePage(value);
}

async function request(url: URL, provider: LyricsProvider, signal: AbortSignal): Promise<{ text: string; url: string } | null> {
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!allowedUrl(url, provider)) throw new SourceError("来源跳转到了不支持的地址");
    const response = await fetch(url, { redirect: "manual", signal, cache: "no-store", headers: { "User-Agent": USER_AGENT } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new SourceError("来源页面跳转异常");
      url = new URL(location, url);
      continue;
    }
    if (response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw new SourceError(`来源服务返回 HTTP ${response.status}`); }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
      await response.body?.cancel();
      throw new SourceError("来源响应超出大小限制");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new SourceError("来源返回了空页面");
    const decoder = new TextDecoder();
    let text = "";
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new SourceError("来源响应超出大小限制");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (!text.trim()) throw new SourceError("来源返回了空页面");
    return { text, url: url.toString() };
  }
  throw new SourceError("来源页面跳转异常");
}

function pageHtml(html: string): CheerioAPI {
  const $ = load(html);
  const title = $("title").text();
  if (/just a moment|access denied|captcha|robot check|アクセス制限|認証が必要/i.test(title) ||
      $("#challenge-form, #cf-challenge-running, form[action*='captcha']").length) {
    throw new SourceError("来源要求验证码或限制访问");
  }
  return $;
}

function lyricText($: CheerioAPI, selector: string): string {
  const body = $(selector).first().clone();
  body.find("rt, rp, .rt, script, style").remove();
  function visit(node: ReturnType<typeof body.contents>[number]): string {
    if (node.type === "text") return node.data.replace(/\r?\n[ \t]*/g, "");
    if (node.type === "tag" && node.name === "br") return "\n";
    if ("children" in node) return node.children.map(visit).join("");
    return "";
  }
  return body.contents().toArray().map(visit).join("").replace(/^\n+|\n+$/g, "");
}

function parsePage(provider: PageProvider, html: string, url: string, params: SearchParams): LyricsCandidate | null {
  const $ = pageHtml(html);
  const titleNode = $(provider === "utaten" ? ".newLyricTitle__main" : "h2[itemprop='name']").first().clone();
  titleNode.find(".newLyricTitle_afterTxt").remove();
  let trackName = titleNode.text().trim();
  let artistName = $(provider === "utaten" ? ".newLyricWork__name a" : "[itemprop='byArtist'] [itemprop='name']").first().text().trim();
  const lyrics = lyricText($, provider === "utaten" ? ".lyricBody .hiragana" : "#kashi_area");
  if (provider === "uta-net" && (!trackName || !artistName)) {
    const pageTitle = $("meta[property='og:title']").attr("content") || $("title").text();
    if (!/\s歌詞\s*-\s*歌ネット\s*$/.test(pageTitle)) throw new SourceError("来源页面结构已变化，无法确认歌名和歌手");
    if (normalizeName(pageTitle.replace(/\s歌詞\s*-\s*歌ネット\s*$/, "")) !== normalizeName(`${params.artist} ${params.title}`)) return null;
    trackName = params.title;
    artistName = params.artist;
  }
  if (!trackName || !artistName || !lyrics.trim()) throw new SourceError("来源页面结构已变化，无法确认完整歌词");
  if (!matches(trackName, artistName, params)) return null;
  return { trackName, artistName, lyrics, hasTimestamps: false, source: { provider, url, fetchedAt: Date.now() } };
}

function searchUrl(provider: PageProvider, params: SearchParams): URL {
  if (provider === "utaten") {
    // The site's combined title/artist search currently redirects to an empty page.
    const fields = { title: "", artist_name: params.artist, sub_title: "", lyricist: "", composer: "", beginning: "", body: "", tag: "", sort: "popular_sort_asc", page: "1" };
    return new URL(`${ORIGINS.utaten}/search/=/${Object.entries(fields).map(([key, value]) => `${key}=${encodeURIComponent(value)}/`).join("")}`);
  }
  const url = new URL("/search/", ORIGINS[provider]);
  url.searchParams.set("Aselect", "2");
  url.searchParams.set("Keyword", params.title);
  url.searchParams.set("Bselect", "3");
  return url;
}

function resultLinks(provider: PageProvider, html: string, params: SearchParams): { links: string[]; next?: string } {
  const $ = pageHtml(html);
  if (/該当する[^。]*?(?:ありません|見つかりません)|歌詞が見つかりませんでした|検索結果[^。]*?0\s*件|該当件数[^。]*?0\s*件/.test($("body").text())) return { links: [] };
  const links: string[] = [];
  const rows = provider === "utaten" ? $(".searchResult__title").closest("tr") : $("a[href^='/song/']").closest("tr");
  for (const row of rows.toArray()) {
    const link = $(row).find(provider === "utaten" ? ".searchResult__title a" : "a[href^='/song/']").first();
    const artist = $(row).find(provider === "utaten" ? ".searchResult__artist > p > a" : "a[href^='/artist/']").first().text().trim();
    if (!link.text().trim() || !artist || !link.attr("href")) throw new SourceError("来源搜索页面结构已变化，无法确认歌名和歌手");
    if (matches(link.text().trim(), artist, params)) {
      const href = link.attr("href");
      if (href) {
        const target = sourcePage(new URL(href, ORIGINS[provider]).toString());
        if (target.provider === provider) links.push(target.url.toString());
      }
    }
  }
  if (!rows.length) {
    throw new SourceError("来源搜索页面结构已变化，无法确认搜索结果");
  }
  return { links: [...new Set(links)], next: $("link[rel='next'], a[rel='next']").first().attr("href") };
}

async function pageLyrics(provider: PageProvider, params: SearchParams, signal: AbortSignal, direct?: URL): Promise<LyricsCandidate | null> {
  if (direct) {
    const page = await request(direct, provider, signal);
    if (!page) throw new SourceError("指定歌词页不存在或暂不可用");
    const candidate = parsePage(provider, page.text, page.url, params);
    if (!candidate) throw new SourceError("指定歌词页的歌名或歌手与当前歌曲不一致");
    return candidate;
  }
  let url = searchUrl(provider, params);
  for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
    const search = await request(url, provider, signal);
    if (!search) throw new SourceError("来源搜索入口暂不可用");
    const { links, next } = resultLinks(provider, search.text, params);
    if (links.length > 1) throw new SourceError("找到多个同名版本，请指定歌词详情页链接");
    if (links.length) {
      const page = await request(new URL(links[0]), provider, signal);
      if (!page) throw new SourceError("搜索结果的歌词页面暂不可用");
      return parsePage(provider, page.text, page.url, params);
    }
    if (!next) return null;
    url = new URL(next, search.url);
  }
  throw new SourceError("搜索结果较多，请指定歌词详情页链接");
}

function isTrack(value: unknown): value is LrclibTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Partial<LrclibTrack>;
  return Number.isInteger(track.id) && typeof track.trackName === "string" && typeof track.artistName === "string" &&
    typeof track.duration === "number" && Number.isFinite(track.duration) && typeof track.instrumental === "boolean" &&
    (track.plainLyrics === null || typeof track.plainLyrics === "string") && (track.syncedLyrics === null || typeof track.syncedLyrics === "string");
}

async function lrclibLyrics(params: SearchParams, signal: AbortSignal): Promise<LyricsCandidate | null> {
  const url = new URL("/api/search", ORIGINS.lrclib);
  url.searchParams.set("track_name", params.title);
  if (params.artist) url.searchParams.set("artist_name", params.artist);
  const response = await request(url, "lrclib", signal);
  if (!response) throw new SourceError("LRCLIB 搜索入口暂不可用");
  let tracks: unknown;
  try { tracks = JSON.parse(response.text); } catch { throw new SourceError("LRCLIB 返回了无效数据"); }
  if (!Array.isArray(tracks) || !tracks.every(isTrack)) throw new SourceError("LRCLIB 返回了无效数据");
  const matched = selectMatchingTrack(tracks.filter((track) =>
    normalizeName(track.trackName) === normalizeName(params.title) &&
    (!params.artist || normalizeName(track.artistName) === normalizeName(params.artist))
  ), params);
  if (!matched) return null;
  const plain: LyricsCandidate = {
    trackName: matched.trackName, artistName: matched.artistName,
    lyrics: matched.plainLyrics?.trim() ? matched.plainLyrics : "", hasTimestamps: false, lrclibId: matched.id,
    source: { provider: "lrclib", url: `${ORIGINS.lrclib}/api/get/${matched.id}`, fetchedAt: Date.now() },
  };
  if (matched.syncedLyrics?.trim()) {
    try {
      if (parseLRC(matched.syncedLyrics).length) {
        const timed = { ...plain, lyrics: matched.syncedLyrics, hasTimestamps: true };
        return plain.lyrics ? addTiming(plain, timed) : timed;
      }
    } catch { /* Invalid timestamps must not replace usable plain lyrics. */ }
  }
  if (!plain.lyrics) throw new SourceError("LRCLIB 的时间歌词格式无效");
  return plain;
}

function addTiming(original: LyricsCandidate, timed: LyricsCandidate): LyricsCandidate {
  if (!timed.hasTimestamps) return original;
  let lines;
  try {
    lines = timed.lyrics.split(/\r?\n/).flatMap((raw) => {
      if (/^\[offset:/i.test(raw) && !/^\[offset:[+-]?0\]$/i.test(raw)) throw new SourceError("不支持时间偏移");
      const parsed = parseLRC(raw);
      const text = raw.replace(/^(?:\[\d+:[0-5]\d(?:\.\d{1,3})?\])+/, "");
      return parsed.map((line) => ({ ...line, text }));
    }).sort((a, b) => a.startTime - b.startTime);
  } catch { return original; }
  const originalLines = original.lyrics.split("\n");
  const textLines = originalLines.filter((line) => line.trim());
  if (textLines.length !== lines.length || textLines.some((line, index) => line !== lines[index].text)) return original;
  let index = 0;
  const lyrics = originalLines.map((line) => {
    if (!line.trim()) return line;
    const milliseconds = Math.round(lines[index++].startTime * 1000);
    const minutes = Math.floor(milliseconds / 60_000).toString().padStart(2, "0");
    const seconds = ((milliseconds % 60_000) / 1000).toFixed(3).padStart(6, "0");
    return `[${minutes}:${seconds}]${line}`;
  }).join("\n");
  return { ...original, lyrics, hasTimestamps: true, lrclibId: timed.lrclibId,
    source: { ...original.source, timingProvider: "lrclib", timingUrl: timed.source.url } };
}

async function attempt(provider: LyricsProvider, work: (signal: AbortSignal) => Promise<LyricsCandidate | null>): Promise<ProviderResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const candidate = await work(controller.signal);
    return { attempt: { provider, status: candidate ? "found" : "not-found" }, ...(candidate ? { candidate } : {}) };
  } catch (error) {
    return { attempt: { provider, status: "unavailable", message: controller.signal.aborted ? "来源请求超时，请稍后重试" :
      error instanceof SourceError ? error.message : "暂时无法连接歌词来源" } };
  } finally { clearTimeout(timeout); }
}

export async function searchLyrics(params: SearchParams): Promise<LyricsSearchResult> {
  params = { ...params, title: params.title.trim(), artist: params.artist.trim() };
  if (!params.title) throw new SourceError("请填写歌名");
  const direct = params.sourceUrl ? sourcePage(params.sourceUrl) : undefined;
  if (!params.artist) {
    if (direct) throw new SourceError("使用指定歌词页时请填写歌手，以免导入同名歌曲的歌词");
    const result = await attempt("lrclib", (signal) => lrclibLyrics(params, signal));
    const attempts = [result.attempt];
    return result.candidate ? { kind: "found", candidate: result.candidate, attempts } :
      { kind: result.attempt.status === "unavailable" ? "unavailable" : "not-found", attempts };
  }
  if (direct) {
    const [page, timing] = await Promise.all([
      attempt(direct.provider, (signal) => pageLyrics(direct.provider, params, signal, direct.url)),
      attempt("lrclib", (signal) => lrclibLyrics(params, signal)),
    ]);
    const attempts = [page.attempt, timing.attempt];
    if (!page.candidate) return { kind: "unavailable", attempts };
    return { kind: "found", candidate: timing.candidate ? addTiming(page.candidate, timing.candidate) : page.candidate, attempts };
  }
  const results = await Promise.all([
    attempt("utaten", (signal) => pageLyrics("utaten", params, signal)),
    attempt("uta-net", (signal) => pageLyrics("uta-net", params, signal)),
    attempt("lrclib", (signal) => lrclibLyrics(params, signal)),
  ]);
  const attempts = results.map((result) => result.attempt);
  const candidate = results.find((result) => result.candidate)?.candidate;
  if (!candidate) return { kind: attempts.some((result) => result.status === "unavailable") ? "unavailable" : "not-found", attempts };
  const timed = results[2].candidate;
  return { kind: "found", candidate: candidate.source.provider !== "lrclib" && timed ? addTiming(candidate, timed) : candidate, attempts };
}

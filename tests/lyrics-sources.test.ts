import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { searchLyrics, validateLyricsSourceUrl } from "../lib/lyrics-sources";

const query = { title: "紙の星＆月", artist: "光の庭", durationSec: 120 };
const utatenUrl = "https://utaten.com/lyric/test123/";
const utaNetUrl = "https://www.uta-net.com/song/123/";
const empty = "<html><body><p>該当する歌詞がありません</p></body></html>";
const plain = "紙の星＆月　ふわり  ゆく\n同じ道を\n\n同じ道を";
const markup = "\n  <span class='ruby'><span class='rb'>紙</span><span class='rt'>かみ</span></span>の星＆月　ふわり  ゆく<br>\n同じ道を<br><br>\n同じ道を\n  ";
const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

function page(provider: "utaten" | "uta-net", title = query.title, artist = query.artist, body = markup) {
  if (provider === "utaten") return `<h2 class="newLyricTitle__main">${escapeHtml(title)} <span class="newLyricTitle_afterTxt">歌詞</span></h2>
    <div class="newLyricWork__name"><a>${escapeHtml(artist)}</a></div>
    <div class="lyricBody"><div class="hiragana">${body}</div><div class="romaji">incorrect romanization</div></div>`;
  return `<title>${escapeHtml(artist)} ${escapeHtml(title)} 歌詞 - 歌ネット</title>
    <div id="kashi_area">${body}</div><aside>Unrelated recommendation</aside>`;
}

function listing(provider: "utaten" | "uta-net", entries = [{ title: query.title, artist: query.artist, url: provider === "utaten" ? utatenUrl : utaNetUrl }], next?: string) {
  return `${next ? `<link rel="next" href="${next}">` : ""}<table>${entries.map((entry) => provider === "utaten"
    ? `<tr><td class="searchResult__title"><a href="${new URL(entry.url).pathname}">${escapeHtml(entry.title)}</a></td><td class="searchResult__artist"><p><a>${escapeHtml(entry.artist)}</a></p></td></tr>`
    : `<tr><td><a href="${new URL(entry.url).pathname}">${escapeHtml(entry.title)}</a></td><td><a href="/artist/1/">${escapeHtml(entry.artist)}</a></td></tr>`).join("")}</table>`;
}

function lrc(patch: Record<string, unknown> = {}) {
  return { id: 77, trackName: query.title, artistName: query.artist, albumName: null, duration: 120,
    instrumental: false, plainLyrics: plain, syncedLyrics: null, ...patch };
}

function network(t: TestContext, handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const requests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal);
    return handler(url, init);
  });
  return requests;
}

test("UtaTen general search checks title and artist and preserves ruby base, symbols, spaces and repeated lines", async (t) => {
  const requests = network(t, (url) => {
    if (url.hostname === "lrclib.net") return Response.json([]);
    if (url.hostname === "www.uta-net.com") return html(empty);
    if (url.pathname.startsWith("/search/")) return html(listing("utaten", [
      { title: query.title, artist: "別の歌手", url: "https://utaten.com/lyric/wrong1/" },
      { title: `${query.title} (Live)`, artist: query.artist, url: "https://utaten.com/lyric/wrong2/" },
      { title: query.title, artist: query.artist, url: utatenUrl },
    ]));
    return html(page("utaten"));
  });
  const result = await searchLyrics(query);
  assert.equal(result.kind, "found");
  if (result.kind !== "found") return;
  assert.equal(result.candidate.lyrics, plain);
  assert.equal(result.candidate.source.provider, "utaten");
  assert.equal(result.candidate.source.url, utatenUrl);
  assert.ok(result.candidate.source.fetchedAt);
  assert.equal(result.candidate.hasTimestamps, false);
  assert.ok(requests[0].pathname.includes(`artist_name=${encodeURIComponent(query.artist)}`));
  assert.equal(requests.filter((url) => url.pathname.startsWith("/lyric/")).length, 1);
});

test("Uta-Net is the second original-text source and removes native ruby readings", async (t) => {
  network(t, (url) => {
    if (url.hostname === "lrclib.net") return Response.json([]);
    if (url.hostname === "utaten.com") return html(empty);
    return html(url.pathname.startsWith("/search") ? listing("uta-net") : page("uta-net", query.title, query.artist,
      "<ruby>紙<rp>(</rp><rt>かみ</rt><rp>)</rp></ruby>&amp;月<br>何度も<br>何度も"));
  });
  const result = await searchLyrics(query);
  assert.equal(result.kind, "found");
  if (result.kind !== "found") return;
  assert.equal(result.candidate.lyrics, "紙&月\n何度も\n何度も");
  assert.equal(result.candidate.source.url, utaNetUrl);
});

test("403 and 503 remain unavailable, but an explicit empty search is not-found", async (t) => {
  network(t, (url) => url.hostname === "utaten.com" ? html(empty) : new Response("blocked", { status: url.hostname === "lrclib.net" ? 503 : 403 }));
  const result = await searchLyrics(query);
  assert.equal(result.kind, "unavailable");
  assert.deepEqual(result.attempts.map((a) => a.status), ["not-found", "unavailable", "unavailable"]);
  assert.match(result.attempts[1].message!, /403/);
  assert.match(result.attempts[2].message!, /503/);
});

test("one successful source is usable while failures stay in diagnostics", async (t) => {
  network(t, (url) => url.hostname === "utaten.com" ? html(page("utaten")) : new Response("unavailable", { status: 503 }));
  const result = await searchLyrics({ ...query, sourceUrl: utatenUrl });
  assert.equal(result.kind, "found");
  assert.deepEqual(result.attempts.map((a) => a.status), ["found", "unavailable"]);
});

test("all explicit empty searches yield not-found", async (t) => {
  network(t, (url) => url.hostname === "lrclib.net" ? Response.json([]) : html(empty));
  assert.equal((await searchLyrics(query)).kind, "not-found");
});

test("empty bodies, changed markup and captcha pages are unavailable instead of not-found", async (t) => {
  network(t, (url) => url.hostname === "utaten.com" ? html("") : url.hostname === "www.uta-net.com"
    ? html("<title>Just a moment...</title><form id='challenge-form'></form>") : Response.json({ changed: true }));
  const result = await searchLyrics(query);
  assert.equal(result.kind, "unavailable");
  assert.ok(result.attempts.every((a) => a.status === "unavailable"));
  assert.match(result.attempts[1].message!, /验证码/);
});

test("strict matching rejects wrong artist, version, punctuation and LRCLIB duration", async (t) => {
  network(t, (url) => {
    if (url.hostname === "lrclib.net") return Response.json([
      lrc({ artistName: "別の歌手" }), lrc({ trackName: `${query.title} Remix` }), lrc({ trackName: "紙の星月" }), lrc({ duration: 160 }),
    ]);
    return html(listing(url.hostname === "utaten.com" ? "utaten" : "uta-net", [{ title: `${query.title} Live`, artist: query.artist, url: url.hostname === "utaten.com" ? utatenUrl : utaNetUrl }]));
  });
  assert.equal((await searchLyrics(query)).kind, "not-found");
});

test("search rows with missing artist metadata cannot become a false not-found", async (t) => {
  network(t, (url) => url.hostname === "lrclib.net" ? Response.json([]) : url.hostname === "www.uta-net.com" ? html(empty)
    : html(`<table><tr><td class="searchResult__title"><a href="/lyric/test123/">${query.title}</a></td></tr></table>`));
  const result = await searchLyrics(query);
  assert.equal(result.kind, "unavailable");
  assert.match(result.attempts[0].message!, /结构已变化/);
});

test("explicit Uta-Net page is authoritative and no other original-text provider is requested", async (t) => {
  const requests = network(t, (url) => url.hostname === "lrclib.net" ? Response.json([lrc()]) : html(page("uta-net")));
  const result = await searchLyrics({ ...query, sourceUrl: utaNetUrl });
  assert.equal(result.kind, "found");
  if (result.kind === "found") assert.equal(result.candidate.source.provider, "uta-net");
  assert.equal(requests.some((url) => url.hostname === "utaten.com"), false);
});

test("a mismatched explicit page is rejected without silently using an LRCLIB match", async (t) => {
  network(t, (url) => url.hostname === "lrclib.net" ? Response.json([lrc()]) : html(page("utaten", query.title, "別の歌手")));
  const result = await searchLyrics({ ...query, sourceUrl: utatenUrl });
  assert.equal(result.kind, "unavailable");
  assert.match(result.attempts[0].message!, /不一致/);
});

test("matching LRC timestamps attach to original lines including repeats without changing text", async (t) => {
  network(t, (url) => url.hostname === "lrclib.net"
    ? Response.json([lrc({ syncedLyrics: "[00:01.250]紙の星＆月　ふわり  ゆく\n[00:02][00:03]同じ道を" })]) : html(page("utaten")));
  const result = await searchLyrics({ ...query, sourceUrl: utatenUrl });
  assert.equal(result.kind, "found");
  if (result.kind !== "found") return;
  assert.equal(result.candidate.hasTimestamps, true);
  assert.equal(result.candidate.lyrics, "[00:01.250]紙の星＆月　ふわり  ゆく\n[00:02.000]同じ道を\n\n[00:03.000]同じ道を");
  assert.equal(result.candidate.lyrics.replace(/\[\d+:\d+\.\d+\]/g, ""), plain);
  assert.equal(result.candidate.source.provider, "utaten");
  assert.equal(result.candidate.source.timingProvider, "lrclib");
});

test("LRC text differences, missing repeats, spaces and offsets never rewrite the page", async (t) => {
  for (const syncedLyrics of [
    "[00:01]紙の星&月　ふわり  ゆく\n[00:02][00:03]同じ道を",
    "[00:01]紙の星＆月　ふわり  ゆく\n[00:02]同じ道を",
    "[00:01]紙の星＆月　ふわり  ゆく \n[00:02][00:03]同じ道を",
    "[offset:100]\n[00:01]紙の星＆月　ふわり  ゆく\n[00:02][00:03]同じ道を",
  ]) {
    network(t, (url) => url.hostname === "lrclib.net" ? Response.json([lrc({ syncedLyrics })]) : html(page("utaten")));
    const result = await searchLyrics({ ...query, sourceUrl: utatenUrl });
    assert.equal(result.kind, "found");
    if (result.kind !== "found") continue;
    assert.equal(result.candidate.lyrics, plain);
    assert.equal(result.candidate.hasTimestamps, false);
    assert.equal(result.candidate.source.timingProvider, undefined);
  }
});

test("LRCLIB preserves complete plain lyrics when its synced version is only partial", async (t) => {
  network(t, (url) => url.hostname === "lrclib.net" ? Response.json([lrc({ syncedLyrics: "[00:02]紙の星" })]) : html(empty));
  const result = await searchLyrics(query);
  assert.equal(result.kind, "found");
  if (result.kind !== "found") return;
  assert.equal(result.candidate.source.provider, "lrclib");
  assert.equal(result.candidate.lrclibId, 77);
  assert.equal(result.candidate.lyrics, plain);
  assert.equal(result.candidate.hasTimestamps, false);
});

test("LRCLIB adds matching complete timing without changing its plain lyrics", async (t) => {
  network(t, (url) => url.hostname === "lrclib.net"
    ? Response.json([lrc({ syncedLyrics: "[00:01.250]紙の星＆月　ふわり  ゆく\n[00:02][00:03]同じ道を" })]) : html(empty));
  const result = await searchLyrics(query);
  assert.equal(result.kind, "found");
  if (result.kind !== "found") return;
  assert.equal(result.candidate.hasTimestamps, true);
  assert.equal(result.candidate.lyrics.replace(/\[\d+:\d+\.\d+\]/g, ""), plain);
});

test("LRCLIB accepts valid standalone synced lyrics when no plain version exists", async (t) => {
  const syncedLyrics = "[00:02]紙の星\n[00:05]同じ道を";
  network(t, (url) => url.hostname === "lrclib.net" ? Response.json([lrc({ plainLyrics: null, syncedLyrics })]) : html(empty));
  const result = await searchLyrics(query);
  assert.equal(result.kind, "found");
  if (result.kind !== "found") return;
  assert.equal(result.candidate.lyrics, syncedLyrics);
  assert.equal(result.candidate.hasTimestamps, true);
});

test("title-only channel imports use only LRCLIB and accept a unique matching artist", async (t) => {
  const requests = network(t, () => Response.json([lrc({ trackName: "紙の星月" }), lrc({ id: 78 })]));
  const result = await searchLyrics({ title: query.title, artist: "  " });
  assert.equal(result.kind, "found");
  if (result.kind !== "found") return;
  assert.equal(result.candidate.lrclibId, 78);
  assert.equal(result.candidate.artistName, query.artist);
  assert.deepEqual(result.attempts, [{ provider: "lrclib", status: "found" }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].hostname, "lrclib.net");
  assert.equal(requests[0].searchParams.get("track_name"), query.title);
  assert.equal(requests[0].searchParams.has("artist_name"), false);
});

test("title-only channel imports reject same-title artists and ambiguous recording lengths", async (t) => {
  for (const tracks of [[lrc(), lrc({ id: 78, artistName: "別の歌手" })], [lrc(), lrc({ id: 78, duration: 150 })]]) {
    const requests = network(t, () => Response.json(tracks));
    const result = await searchLyrics({ title: query.title, artist: "" });
    assert.equal(result.kind, "not-found");
    assert.deepEqual(result.attempts, [{ provider: "lrclib", status: "not-found" }]);
    assert.equal(requests.length, 1);
  }
});

test("source URLs and redirects are limited to known HTTPS lyric sites", async (t) => {
  for (const url of ["http://utaten.com/lyric/test123/", "https://utaten.com.evil.test/lyric/test123/", "https://user:pass@utaten.com/lyric/test123/", "https://utaten.com/search/", `${utatenUrl}?next=evil`, `${utatenUrl}#fragment`]) {
    assert.throws(() => validateLyricsSourceUrl(url));
  }
  const requests = network(t, (url) => url.hostname === "lrclib.net" ? Response.json([]) : new Response(null, { status: 302, headers: { location: "https://example.com/private" } }));
  const result = await searchLyrics({ ...query, sourceUrl: utatenUrl });
  assert.equal(result.kind, "unavailable");
  assert.match(result.attempts[0].message!, /不支持的地址/);
  assert.equal(requests.length, 2);
});

test("response size limits and request timeouts are reported and cancelled", async (t) => {
  network(t, (url) => url.hostname === "lrclib.net" ? Response.json([]) : new Response("small", { headers: { "content-length": String(2 * 1024 * 1024 + 1) } }));
  const oversized = await searchLyrics({ ...query, sourceUrl: utatenUrl });
  assert.equal(oversized.kind, "unavailable");
  assert.match(oversized.attempts[0].message!, /大小限制/);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let aborted = 0;
  network(t, (_url, init) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => {
    aborted++;
    reject(new Error("private network diagnostic"));
  })));
  const pending = searchLyrics(query);
  t.mock.timers.tick(12_000);
  const timedOut = await pending;
  assert.equal(aborted, 3);
  assert.equal(timedOut.kind, "unavailable");
  assert.ok(timedOut.attempts.every((a) => a.message?.includes("超时")));
});

test("unfinished paginated searches are unavailable, not a claimed complete miss", async (t) => {
  network(t, (url) => url.hostname === "lrclib.net" ? Response.json([]) : url.hostname === "www.uta-net.com" ? html(empty)
    : html(listing("utaten", [{ title: "另一首歌", artist: query.artist, url: utatenUrl }], "/search/=/page=2/")));
  const result = await searchLyrics(query);
  assert.equal(result.kind, "unavailable");
  assert.match(result.attempts[0].message!, /搜索结果较多/);
});

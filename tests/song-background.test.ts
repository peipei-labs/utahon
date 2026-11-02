import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { fetchSongBackground } from "../lib/song-background";

const query = { title: "月の手紙 & 空", artist: "紙舟", durationSec: 123 };
const albumUrl = "https://music.apple.com/jp/album/paper-stars/200";
const wikiUrl = "https://ja.wikipedia.org/wiki/%E7%B4%99%E8%88%9F";

function track(patch: Record<string, unknown> = {}) {
  return { wrapperType: "track", kind: "song", trackId: 201, trackName: query.title, artistName: query.artist,
    collectionId: 200, collectionName: "Paper Stars", collectionViewUrl: albumUrl,
    releaseDate: "2018-05-20T12:00:00Z", trackTimeMillis: 123000, trackNumber: 2, trackCount: 3, ...patch };
}

function album(patch: Record<string, unknown> = {}) {
  return { wrapperType: "collection", collectionId: 200, collectionName: "Paper Stars", artistName: query.artist,
    collectionViewUrl: albumUrl, releaseDate: "2018-05-20T07:00:00Z", trackCount: 3, copyright: "Fixture label", ...patch };
}

function wiki(patch: Record<string, unknown> = {}) {
  return { query: { pages: [{ pageid: 5, ns: 0, title: query.artist, fullurl: wikiUrl, pageprops: {},
    extract: "紙舟はテスト用の架空の音楽グループ。2012年に結成された。", ...patch }] } };
}

const list = (results: unknown[]) => Response.json({ resultCount: results.length, results });
const missingWiki = () => Response.json(wiki({ missing: true }));

function network(t: TestContext, handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const requests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal);
    assert.ok(["itunes.apple.com", "ja.wikipedia.org"].includes(url.hostname));
    return handler(url, init);
  });
  return requests;
}

test("exact Apple song and artist match leads to lookup of the returned album id", async (t) => {
  const requests = network(t, (url) => {
    if (url.hostname === "ja.wikipedia.org") return Response.json(wiki());
    if (url.pathname === "/search") return list([
      track({ artistName: "別の歌手" }), track({ trackName: `${query.title} (Live)` }),
      track({ trackName: "月の手紙空" }), track({ trackTimeMillis: 127000 }), track(),
    ]);
    assert.equal(url.searchParams.get("id"), "200");
    return list([album(), track(), track({ trackId: 202, trackName: "窓の景色", trackNumber: 3 })]);
  });
  const result = await fetchSongBackground(query);
  assert.deepEqual(result.sources.map((source) => source.id), ["apple-catalog", "wikipedia-artist"]);
  const apple = result.sources[0];
  assert.equal(apple.url, albumUrl);
  const metadata = JSON.parse(apple.excerpt);
  assert.equal(metadata.track.trackNumber, 2);
  assert.equal(metadata.collection.collectionName, "Paper Stars");
  assert.deepEqual(metadata.albumTracks.map((item: { trackName: string }) => item.trackName), [query.title, "窓の景色"]);
  assert.equal(result.sources[1].url, wikiUrl);
  assert.ok(result.notes.some((note) => note.includes("叙述者")));
  const wikiRequest = requests.find((url) => url.hostname === "ja.wikipedia.org")!;
  assert.equal(wikiRequest.searchParams.get("titles"), query.artist);
  assert.equal(wikiRequest.searchParams.has("list"), false, "do not use fuzzy search");
  assert.equal(wikiRequest.searchParams.get("prop"), "extracts|pageprops|info");
  assert.equal(wikiRequest.searchParams.get("exchars"), "4000");
  assert.equal(wikiRequest.searchParams.has("exintro"), false);
});

test("duration tolerance is three seconds and unmatched versions do not cause an album lookup", async (t) => {
  for (const [milliseconds, expected] of [[126000, true], [126001, false]] as const) {
    const requests = network(t, (url) => url.hostname === "ja.wikipedia.org" ? missingWiki()
      : url.pathname === "/search" ? list([track({ trackTimeMillis: milliseconds })])
        : list([album(), track({ trackTimeMillis: milliseconds })]));
    const result = await fetchSongBackground(query);
    assert.equal(result.sources.some((source) => source.id === "apple-catalog"), expected);
    assert.equal(requests.some((url) => url.pathname === "/lookup"), expected);
  }
});

test("multiple matching releases retain catalog dates without choosing the oldest as the original", async (t) => {
  network(t, (url) => url.hostname === "ja.wikipedia.org" ? missingWiki() : url.pathname === "/search"
    ? list([track(), track({ trackId: 101, collectionId: 100, collectionName: "Earlier Collection", releaseDate: "2001-01-01T00:00:00Z" })])
    : list([album(), track()]));
  const result = await fetchSongBackground(query);
  const metadata = JSON.parse(result.sources[0].excerpt);
  assert.equal(metadata.track.collectionId, 200);
  assert.equal(metadata.matchingReleases[0].releaseDate, "2018-05-20T12:00:00Z");
  assert.equal(metadata.matchingReleases[1].releaseDate, "2001-01-01T00:00:00Z");
  assert.ok(result.notes.some((note) => note.includes("多个匹配")));
  assert.ok(result.notes.some((note) => note.includes("不能据此认定首次发行")));
});

test("search and lookup date disagreements retain both source fields", async (t) => {
  network(t, (url) => url.hostname === "ja.wikipedia.org" ? missingWiki() : url.pathname === "/search"
    ? list([track()]) : list([album(), track({ releaseDate: "2020-01-01T00:00:00Z" })]));
  const result = await fetchSongBackground(query);
  const metadata = JSON.parse(result.sources[0].excerpt);
  assert.equal(metadata.track.releaseDate, "2020-01-01T00:00:00Z");
  assert.equal(metadata.matchingReleases[0].releaseDate, "2018-05-20T12:00:00Z");
  assert.ok(result.notes.some((note) => note.includes("两处原始字段")));
});

test("failed or inconsistent album lookup preserves usable search metadata", async (t) => {
  for (const lookup of [() => new Response("unavailable", { status: 503 }), () => list([album({ collectionId: 900 }), track({ artistName: "另一歌手" })])]) {
    network(t, (url) => url.hostname === "ja.wikipedia.org" ? missingWiki() : url.pathname === "/search" ? list([track()]) : lookup());
    const result = await fetchSongBackground(query);
    assert.equal(result.sources[0].id, "apple-catalog");
    const metadata = JSON.parse(result.sources[0].excerpt);
    assert.equal(metadata.collection, undefined);
    assert.deepEqual(metadata.albumTracks, []);
    assert.ok(result.notes.some((note) => note.includes("专辑详情资料不足")));
  }
});

test("missing identities skip background requests instead of guessing an artist", async (t) => {
  const requests = network(t, () => { throw new Error("must not fetch"); });
  const result = await fetchSongBackground({ title: query.title, artist: " " });
  assert.deepEqual(result.sources, []);
  assert.equal(requests.length, 0);
});

test("Wikipedia missing, wrong-title and disambiguation pages are insufficient background", async (t) => {
  for (const patch of [{ missing: true }, { title: "紙舟 (別人)" }, { pageprops: { disambiguation: "" } }]) {
    network(t, (url) => url.hostname === "ja.wikipedia.org" ? Response.json(wiki(patch)) : list([]));
    const result = await fetchSongBackground(query);
    assert.deepEqual(result.sources, []);
    assert.ok(result.notes.some((note) => note.includes("日本维基百科资料不足")));
  }
});

test("Wikipedia 403 is noted without hiding a usable Apple catalog source", async (t) => {
  network(t, (url) => url.hostname === "ja.wikipedia.org" ? new Response("blocked", { status: 403 })
    : url.pathname === "/search" ? list([track()]) : list([album(), track()]));
  const result = await fetchSongBackground(query);
  assert.deepEqual(result.sources.map((source) => source.id), ["apple-catalog"]);
  assert.ok(result.notes.some((note) => note.includes("403")));
});

test("provider display links are validated and not replaced with invented URLs", async (t) => {
  network(t, (url) => url.hostname === "ja.wikipedia.org" ? Response.json(wiki({ fullurl: "https://attacker.example/wiki/Paper" }))
    : url.pathname === "/search" ? list([track({ collectionViewUrl: "https://attacker.example/album/paper/200" })])
      : list([album({ collectionViewUrl: undefined }), track({ collectionViewUrl: undefined })]));
  const result = await fetchSongBackground(query);
  assert.deepEqual(result.sources, []);
  assert.ok(result.notes.every((note) => note.includes("资料不足")));
});

test("cross-host redirects are rejected without fetching the destination", async (t) => {
  const requests = network(t, () => new Response(null, { status: 302, headers: { location: "https://attacker.example/private" } }));
  const result = await fetchSongBackground(query);
  assert.equal(requests.length, 2);
  assert.deepEqual(result.sources, []);
  assert.ok(result.notes.every((note) => note.includes("不支持的地址")));
});

test("response sizes are bounded with and without a Content-Length header", async (t) => {
  network(t, (url) => url.hostname === "ja.wikipedia.org"
    ? new Response("small", { headers: { "content-length": String(1024 * 1024 + 1) } })
    : new Response(new Uint8Array(1024 * 1024 + 1)));
  const result = await fetchSongBackground(query);
  assert.deepEqual(result.sources, []);
  assert.ok(result.notes.every((note) => note.includes("大小限制")));
});

test("both providers abort after eight seconds and return notes rather than throwing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let aborted = 0;
  network(t, (_url, init) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => {
    aborted++;
    reject(new Error("untrusted diagnostic"));
  })));
  const pending = fetchSongBackground(query);
  t.mock.timers.tick(8_000);
  const result = await pending;
  assert.equal(aborted, 2);
  assert.deepEqual(result.sources, []);
  assert.ok(result.notes.every((note) => note.includes("超时")));
});

test("excerpts remain bounded valid metadata and limited encyclopedia text", async (t) => {
  network(t, (url) => url.hostname === "ja.wikipedia.org" ? Response.json(wiki({ extract: "架空の資料。".repeat(2000) }))
    : url.pathname === "/search" ? list([track()])
      : list([album(), track(), ...Array.from({ length: 100 }, (_, index) => track({ trackId: index + 300, trackName: "架空の曲名".repeat(60), trackNumber: index + 3 }))]));
  const result = await fetchSongBackground(query);
  assert.ok(result.sources[0].excerpt.length <= 6000);
  assert.ok(JSON.parse(result.sources[0].excerpt).albumTracks.length <= 30);
  assert.ok(result.sources[1].excerpt.length <= 4000);
  assert.ok(result.notes.some((note) => note.includes("部分版本或专辑曲目")));
});

test("malformed JSON and provider error messages stay bounded and do not reach model context", async (t) => {
  network(t, (url) => {
    if (url.hostname === "itunes.apple.com") return new Response("<html>challenge</html>");
    throw new Error("private diagnostics that must not escape");
  });
  const result = await fetchSongBackground(query);
  assert.deepEqual(result.sources, []);
  assert.ok(result.notes.some((note) => note.includes("有效 JSON")));
  assert.ok(!JSON.stringify(result).includes("private diagnostics"));
});

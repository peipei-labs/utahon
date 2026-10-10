import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as voices from "../lib/tts-voices";
import * as tts from "../lib/tts";

function loadWithMocks(path: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const output = { exports: {} as Record<string, (...args: never[]) => unknown> };
  const require = createRequire(import.meta.url);
  runInNewContext(compiled, {
    exports: output.exports,
    module: output,
    require: (id: string) => id in mocks ? mocks[id] : require(id),
    Buffer, process, setTimeout, clearTimeout, Response, Uint8Array,
    ...globals,
  });
  return output.exports;
}

test("only lightweight Edge voices are enabled; all retired voices are rejected", async () => {
  assert.deepEqual(voices.SERVER_VOICES.map((v) => v.name), ["ja-JP-NanamiNeural", "ja-JP-KeitaNeural"]);
  for (const voice of ["voicevox-0", "voicevox-3", "ja-JP-AoiNeural", "ja-JP-MayuNeural", "ja-JP-ShioriNeural"]) {
    assert.equal(voices.isServerVoice(voice), false);
    assert.equal(voices.isRetiredServerVoice(voice), true);
  }
});

test("server uses Edge even with stale Azure/VOICEVOX configuration, caches audio and rejects retired voices", async () => {
  let requests = 0;
  class FakeCommunicate {
    async *stream() { requests++; yield { type: "audio", data: Buffer.from("test-mp3") }; }
  }
  const server = loadWithMocks("../lib/tts-server.ts", {
    "server-only": {}, "./tts-voices": voices, "edge-tts-universal": { Communicate: FakeCommunicate },
  }, {
    process: { env: { AZURE_SPEECH_KEY: "test", AZURE_SPEECH_REGION: "test", VOICEVOX_URL: "http://disabled.test" } },
    fetch: () => { throw new Error("disabled provider called"); },
  }) as unknown as typeof import("../lib/tts-server");
  const first = await server.synthesizeAudio("こんにちは", voices.DEFAULT_SERVER_VOICE);
  assert.equal(first.contentType, "audio/mpeg");
  assert.equal(first.buf.toString(), "test-mp3");
  await server.synthesizeAudio("こんにちは", voices.DEFAULT_SERVER_VOICE);
  assert.equal(requests, 1);
  await assert.rejects(server.synthesizeAudio("こんにちは", "voicevox-0"), /停用/);
  await assert.rejects(server.synthesizeAudio("こんにちは", "ja-JP-AoiNeural"), /停用/);
  assert.equal(requests, 1);
});

test("server synthesis is bounded when the upstream stream never answers", async () => {
  class HangingCommunicate { async *stream() { await new Promise(() => {}); } }
  const server = loadWithMocks("../lib/tts-server.ts", {
    "server-only": {}, "./tts-voices": voices, "edge-tts-universal": { Communicate: HangingCommunicate },
  }, { setTimeout: (callback: () => void) => setTimeout(callback, 5) }) as unknown as typeof import("../lib/tts-server");
  await assert.rejects(server.synthesizeAudio("timeout", voices.DEFAULT_SERVER_VOICE), /超时/);
});

test("API rejects retired voices without synthesis and returns readable, non-secret errors", async () => {
  let requests = 0;
  const route = loadWithMocks("../app/api/tts/route.ts", {
    "@/lib/tts-voices": voices,
    "@/lib/tts-server": {
      isKnownServerVoice: voices.isServerVoice,
      synthesizeAudio: async () => { requests++; throw new Error("upstream details must not reach browser"); },
    },
  }) as unknown as typeof import("../app/api/tts/route");
  const get = (voice: string) => route.GET({ nextUrl: new URL(`http://localhost/api/tts?text=test&voice=${voice}`) } as never);
  const retired = await get("voicevox-0");
  assert.equal(retired.status, 400);
  assert.equal(requests, 0);
  const failed = await get(voices.DEFAULT_SERVER_VOICE);
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /在线发音暂时不可用/);
  assert.equal(requests, 1);
});

function browserHarness(options: { localVoice?: boolean; audioFailure?: boolean; speechFailure?: boolean } = {}) {
  const original = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const storage = new Map<string, string>();
  const japanese = { name: "Test Japanese", lang: "ja-JP", localService: true } as SpeechSynthesisVoice;
  let spoken = 0;
  let played = 0;
  let cancelled = 0;
  const synthesis = {
    cancel: () => { cancelled++; },
    getVoices: () => options.localVoice ? [japanese] : [],
    speak: (utterance: SpeechSynthesisUtterance) => {
      spoken++;
      queueMicrotask(() => {
        if (options.speechFailure) utterance.onerror?.({} as SpeechSynthesisErrorEvent);
        else utterance.onend?.({} as SpeechSynthesisEvent);
      });
    },
  };
  set("window", { speechSynthesis: synthesis });
  set("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  set("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
  set("Audio", class {
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = "";
    pause() {}
    play() {
      played++;
      if (options.audioFailure) return Promise.reject(new Error("blocked"));
      queueMicrotask(() => this.onended?.());
      return Promise.resolve();
    }
  });
  const initialFetch = globalThis.fetch;
  return {
    storage,
    counts: () => ({ spoken, played, cancelled }),
    restore: () => {
      tts.abortCurrent();
      tts.clearTtsNotice();
      globalThis.fetch = initialFetch;
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test("old VOICEVOX/Azure selections migrate to Nanami; a new browser defaults to Nanami", () => {
  const browser = browserHarness();
  try {
    assert.equal(tts.getSelectedVoiceName(), voices.DEFAULT_SERVER_VOICE);
    for (const retired of ["voicevox-0", "voicevox-10", "ja-JP-AoiNeural"]) {
      browser.storage.set("utahon-voice", retired);
      assert.equal(tts.getSelectedVoiceName(), voices.DEFAULT_SERVER_VOICE);
      assert.equal(browser.storage.get("utahon-voice"), voices.DEFAULT_SERVER_VOICE);
    }
    tts.setSelectedVoiceName(null);
    assert.equal(tts.getSelectedVoiceName(), null);
  } finally { browser.restore(); }
});

test("successful audio actually invokes playback and resolves without an error notice", async () => {
  const browser = browserHarness();
  try {
    globalThis.fetch = async () => new Response(new Blob(["mp3"], { type: "audio/mpeg" }));
    await tts.speak("こんにちは").promise;
    assert.equal(browser.counts().played, 1);
    assert.equal(tts.getTtsNotice(), null);
  } finally { browser.restore(); }
});

test("HTTP failure is visible and never becomes an unhandled rejected handle", async () => {
  const browser = browserHarness();
  try {
    globalThis.fetch = async () => Response.json({ error: "在线发音暂时不可用" }, { status: 502 });
    await assert.doesNotReject(tts.speak("こんにちは").promise);
    assert.deepEqual(tts.getTtsNotice(), { kind: "error", message: "在线发音暂时不可用" });
    assert.equal(browser.counts().played, 0);
  } finally { browser.restore(); }
});

test("online failure falls back only to a local Japanese voice and tells the user", async () => {
  const browser = browserHarness({ localVoice: true });
  try {
    globalThis.fetch = async () => { throw new TypeError("network"); };
    await tts.speak("こんにちは").promise;
    assert.equal(browser.counts().spoken, 1);
    assert.equal(tts.getTtsNotice()?.kind, "info");
    assert.match(tts.getTtsNotice()!.message, /已改用本机日语音色/);
  } finally { browser.restore(); }
});

test("blocked playback and browser synthesis errors are visible", async () => {
  const browser = browserHarness({ audioFailure: true, localVoice: true, speechFailure: true });
  try {
    globalThis.fetch = async () => new Response(new Blob(["mp3"]));
    await tts.speak("こんにちは").promise;
    assert.equal(browser.counts().played, 1);
    assert.equal(browser.counts().spoken, 1);
    assert.equal(tts.getTtsNotice()?.kind, "error");
    assert.match(tts.getTtsNotice()!.message, /本机日语发音失败/);
  } finally { browser.restore(); }
});

test("cancelling a pending request settles the handle without a failure notice", async () => {
  const browser = browserHarness();
  try {
    globalThis.fetch = async (_input, init) => new Promise((_, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    const handle = tts.speak("こんにちは");
    handle.abort();
    await assert.doesNotReject(handle.promise);
    assert.equal(tts.getTtsNotice(), null);
  } finally { browser.restore(); }
});

test("explicit browser selection without Japanese voices produces guidance", async () => {
  const browser = browserHarness();
  try {
    tts.setSelectedVoiceName(null);
    await tts.speak("こんにちは").promise;
    assert.match(tts.getTtsNotice()!.message, /没有可用的日语音色/);
  } finally { browser.restore(); }
});

test("notice subscription updates once and can be dismissed", async () => {
  const browser = browserHarness();
  let updates = 0;
  const unsubscribe = tts.subscribeTtsNotice(() => { updates++; });
  try {
    globalThis.fetch = async () => Response.json({ error: "test failure" }, { status: 502 });
    await tts.speak("こんにちは").promise;
    assert.equal(updates, 2);
    tts.clearTtsNotice();
    assert.equal(updates, 3);
    assert.equal(tts.getTtsNotice(), null);
    unsubscribe();
    tts.clearTtsNotice();
    assert.equal(updates, 3);
  } finally { unsubscribe(); browser.restore(); }
});

test("disabled browser storage does not prevent pronunciation", async () => {
  const browser = browserHarness();
  try {
    globalThis.localStorage.getItem = () => { throw new Error("storage blocked"); };
    globalThis.localStorage.setItem = () => { throw new Error("storage blocked"); };
    assert.doesNotThrow(() => tts.setSelectedVoiceName(voices.DEFAULT_SERVER_VOICE));
    globalThis.fetch = async () => new Response(new Blob(["mp3"]));
    await assert.doesNotReject(tts.speak("こんにちは").promise);
    assert.equal(browser.counts().played, 1);
    assert.equal(tts.getTtsNotice(), null);
  } finally { browser.restore(); }
});

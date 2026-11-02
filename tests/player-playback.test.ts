import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { PlayerContextValue } from "../components/player-context";
import { emptyPracticeData, type PracticeTrack } from "../types/practice";

type Node = { type: unknown; props: Record<string, unknown> };
type Hook = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Internal = {
  setLocalAudio: (track: PracticeTrack, audio: unknown) => void;
  setYoutubePlayer: (player: unknown) => void;
  releaseYoutubePlayer: () => void;
};
const compiled = ts.transpileModule(readFileSync(new URL("../components/youtube-player.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function harness(hasAudio = true, stems: PracticeTrack[] = []) {
  const contexts = new Map<unknown, unknown>();
  const playerContext = { Provider: {} };
  let internalContext: { Provider: object };
  const providerHooks: Hook[] = [];
  const mediaHooks: Hook[] = [];
  let hooks = providerHooks;
  let cursor = 0;
  const effects: Array<{ hook: Hook; effect: () => (() => void) | void }> = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const practice = { songId: "song", hasAudio, audioSha256: "audio-v1", data: { ...emptyPracticeData(30), stems } };
  const props = { songId: "song", songTitle: "Song", videoId: "video-id", durationSec: 30, children: null };
  const nextHook = () => hooks[cursor++] ?? (hooks[cursor - 1] = {});
  const changed = (hook: Hook, deps: unknown[]) => !hook.deps || deps.some((value, index) => !Object.is(value, hook.deps![index]));
  const memo = (fn: () => unknown, deps: unknown[]) => {
    const hook = nextHook();
    if (changed(hook, deps)) { hook.value = fn(); hook.deps = deps; }
    return hook.value;
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => {
    if (Object.hasOwn(props, "value")) contexts.set(type, props.value);
    return { type, props };
  };
  const output = { exports: {} as {
    SongPlayerProvider: (props: unknown) => Node;
    EditorialPlayerPlate: (props: unknown) => Node;
  } };
  runInNewContext(compiled, {
    exports: output.exports, module: output, Error, Promise,
    window: {
      setTimeout: (fn: () => void) => { timers.set(++nextTimer, fn); return nextTimer; },
      clearTimeout: (id: number) => timers.delete(id),
      setInterval: () => ++nextTimer, clearInterval: () => undefined,
    },
    require: (name: string) => {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react") return {
        createContext: () => (internalContext = { Provider: {} }),
        useContext: (ctx: { Provider: unknown }) => contexts.get(ctx.Provider),
        useMemo: memo,
        useCallback: (fn: unknown, deps: unknown[]) => memo(() => fn, deps),
        useEffectEvent: (fn: unknown) => fn,
        useRef: (initial: unknown) => {
          const hook = nextHook();
          if (!Object.hasOwn(hook, "value")) hook.value = { current: initial };
          return hook.value;
        },
        useState: (initial: unknown) => {
          const hook = nextHook();
          if (!Object.hasOwn(hook, "value")) hook.value = initial;
          return [hook.value, (next: unknown) => {
            hook.value = typeof next === "function" ? next(hook.value) : next;
          }];
        },
        useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
          const hook = nextHook();
          if (changed(hook, deps)) {
            hook.deps = deps;
            if (hooks === providerHooks) effects.push({ hook, effect });
          }
        },
      };
      if (name === "./practice-context") return { usePractice: () => ({ practice }) };
      if (name === "./player-context") return { PlayerContext: playerContext };
      if (name === "./song-info-context") return { SongInfoProvider: "song-info" };
      if (name === "./editorial-shell") return { formatDuration: String };
      if (name === "@/lib/utils") return { cn: (...args: unknown[]) => args.filter(Boolean).join(" ") };
      if (name === "lucide-react") return { Play: "play", Pause: "pause", AudioLines: "audio-lines" };
      if (name === "react-youtube") return { __esModule: true, default: "youtube" };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => {
    hooks = providerHooks; cursor = 0;
    output.exports.SongPlayerProvider(props);
    return contexts.get(playerContext.Provider) as PlayerContextValue;
  };
  const flush = () => {
    const pending = effects.splice(0);
    for (const { hook } of pending) hook.cleanup?.();
    for (const { hook, effect } of pending) hook.cleanup = effect() || undefined;
    const callbacks = [...timers.values()]; timers.clear();
    for (const fn of callbacks) fn();
    return render();
  };
  const plate = () => output.exports.EditorialPlayerPlate({});
  const media = () => {
    const child = nodes(plate()).find((node) => typeof node.type === "function");
    assert.ok(child);
    hooks = mediaHooks; cursor = 0;
    return (child.type as (props: unknown) => Node)(child.props);
  };
  render();
  flush();
  return { render, flush, plate, media, practice, props,
    get internal() { return contexts.get(internalContext.Provider) as Internal; } };
}

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}

function pending() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function audio(playResult: () => Promise<void> = () => Promise.resolve()) {
  return { currentTime: 0, duration: 30, paused: true, ended: false, playbackRate: 1, preservesPitch: true,
    playCalls: 0, pauseCalls: 0,
    play() { this.playCalls++; this.paused = false; return playResult(); },
    pause() { this.pauseCalls++; this.paused = true; },
  };
}

function youtube() {
  return { playCalls: 0, pauseCalls: 0,
    playVideo() { this.playCalls++; }, pauseVideo() { this.pauseCalls++; },
    getDuration: () => 30, getAvailablePlaybackRates: () => [0.5, 1],
    setPlaybackRate: () => undefined, getIframe: () => ({ isConnected: true }),
  };
}

test("saved practice audio is the default and explicit source changes pause and reset without autoplay", async () => {
  const h = harness();
  const local = audio();
  h.internal.setLocalAudio("mix", local);
  assert.equal(h.render().source, "local");
  h.render().play(); await settle();
  h.render().seekTo(12);
  h.render().selectSource("youtube");
  const selected = h.render();
  assert.equal(selected.source, "youtube");
  assert.equal(selected.playing, false);
  const remote = youtube(); h.internal.setYoutubePlayer(remote);
  h.flush();
  assert.equal(h.render().currentTime, 0);
  assert.equal(remote.playCalls, 0);
  h.render().selectSource("local"); h.render(); h.flush();
  assert.equal(local.playCalls, 1, "switching back must require another click");
  assert.equal(h.render().source, "local");
});

test("local play starts every stem in the click stack and waits for all playback promises", async () => {
  const h = harness(true, ["vocals", "drums", "bass", "other"]);
  const first = pending(); const last = pending();
  const tracks = [audio(() => first.promise), audio(), audio(), audio(() => last.promise)];
  ["vocals", "drums", "bass", "other"].forEach((track, index) => h.internal.setLocalAudio(track as PracticeTrack, tracks[index]));
  h.render().play();
  assert.ok(tracks.every((track) => track.playCalls === 1), "do not defer play() past the user gesture");
  assert.equal(h.render().playing, false);
  first.resolve(); await settle(); assert.equal(h.render().playing, false);
  last.resolve(); await settle(); assert.equal(h.render().playing, true);
});

test("a rejected stem stops all audio and exposes an actionable error", async () => {
  const h = harness(true, ["vocals", "drums", "bass", "other"]);
  const failure = pending();
  const tracks = [audio(), audio(() => failure.promise), audio(), audio()];
  ["vocals", "drums", "bass", "other"].forEach((track, index) => h.internal.setLocalAudio(track as PracticeTrack, tracks[index]));
  h.render().play();
  failure.reject(Object.assign(new Error("private media URL"), { name: "NotAllowedError" }));
  await settle();
  assert.equal(h.render().playing, false);
  assert.ok(tracks.every((track) => track.paused && track.pauseCalls === 1));
  assert.match(h.render().playbackError!, /再次点击播放/);
  assert.doesNotMatch(h.render().playbackError!, /private/);
  assert.ok(nodes(h.plate()).some((node) => node.props.role === "alert"));
});

test("missing audio and a synchronous play exception both remain stopped", async () => {
  const h = harness();
  h.render().play();
  assert.equal(h.render().playing, false);
  assert.match(h.render().playbackError!, /尚未加载/);
  const broken = audio(() => { throw new Error("unsupported"); });
  h.internal.setLocalAudio("mix", broken);
  h.render().play(); await settle();
  assert.equal(h.render().playing, false);
  assert.equal(broken.paused, true);
  assert.match(h.render().playbackError!, /播放失败/);
});

test("late rejection from a cancelled local request does not pause a newer play", async () => {
  const h = harness(); const old = pending();
  let attempt = 0;
  const local = audio(() => ++attempt === 1 ? old.promise : Promise.resolve());
  h.internal.setLocalAudio("mix", local);
  h.render().play(); h.render().pause(); h.render().play(); await settle();
  const pauses = local.pauseCalls;
  old.reject(new Error("late abort")); await settle();
  assert.equal(h.render().playing, true);
  assert.equal(h.render().playbackError, null);
  assert.equal(local.pauseCalls, pauses);
});

test("late playback success after pause cannot restore the playing flag", async () => {
  const h = harness(); const old = pending();
  h.internal.setLocalAudio("mix", audio(() => old.promise));
  h.render().play(); h.render().pause(); old.resolve(); await settle();
  assert.equal(h.render().playing, false);
});

test("YouTube requires readiness and events; late local rejection cannot stop the selected source", async () => {
  const h = harness(); const old = pending();
  h.internal.setLocalAudio("mix", audio(() => old.promise));
  h.render().play(); h.render().selectSource("youtube"); h.render(); h.flush();
  h.internal.setLocalAudio("mix", null);
  h.render().play();
  assert.equal(h.render().playing, false);
  assert.match(h.render().playbackError!, /YouTube 尚未加载/);
  const remote = youtube();
  const element = nodes(h.media()).find((node) => node.type === "youtube")!;
  const event = (name: string, data = 0) => (element.props[name] as (e: unknown) => void)({ target: remote, data });
  event("onReady");
  h.render().play();
  assert.equal(remote.playCalls, 1);
  assert.equal(h.render().playing, false, "playVideo() itself is not playback confirmation");
  event("onStateChange", 1);
  assert.equal(h.render().playing, true);
  const pauses = remote.pauseCalls;
  old.reject(new Error("old source aborted")); await settle();
  assert.equal(remote.pauseCalls, pauses);
  assert.equal(h.render().playing, true);
  event("onError");
  assert.equal(h.render().playing, false);
  assert.match(h.render().playbackError!, /YouTube 播放失败/);
  event("onStateChange", 1);
  assert.equal(h.render().playing, false, "discard events from a released iframe");
});

test("media onError stops playing tracks; detached media errors are ignored", async () => {
  const h = harness(); const local = audio();
  h.internal.setLocalAudio("mix", local);
  h.render().play(); await settle();
  const element = nodes(h.media()).find((node) => node.type === "audio")!;
  const onError = element.props.onError as (event: unknown) => void;
  onError({ currentTarget: local });
  assert.equal(h.render().playing, false);
  assert.equal(local.paused, true);
  assert.match(h.render().playbackError!, /加载失败/);
  const replacement = audio(); h.internal.setLocalAudio("mix", replacement);
  h.render().play(); await settle();
  onError({ currentTarget: local });
  assert.equal(h.render().playing, true);
  assert.equal(h.render().playbackError, null);
});

test("newly saved audio changes the default source without resuming the old YouTube play", () => {
  const h = harness(false);
  const remote = youtube(); h.internal.setYoutubePlayer(remote);
  const element = nodes(h.media()).find((node) => node.type === "youtube")!;
  (element.props.onStateChange as (event: unknown) => void)({ target: remote, data: 1 });
  assert.equal(h.render().playing, true);
  h.practice.hasAudio = true; h.practice.audioSha256 = "saved-audio";
  h.render();
  const local = audio(); h.internal.setLocalAudio("mix", local);
  // Only the provider's effects are relevant; mounting the iframe is handled by react-youtube.
  h.flush();
  assert.equal(h.render().source, "local");
  assert.equal(local.playCalls, 0);
  assert.equal(h.render().playing, false);
});

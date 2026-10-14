import { DEFAULT_SERVER_VOICE, isRetiredServerVoice, isServerVoice } from "./tts-voices";

const VOICE_KEY = "utahon-voice";
const RATE_KEY_PREFIX = "utahon-voice-rate:";
const BROWSER_VOICE_KEY = "__browser__";

export const DEFAULT_RATE = 0.85;
export const VALID_RATES = [0.6, 0.75, 0.85, 1.0, 1.25, 1.5] as const;
export type ValidRate = (typeof VALID_RATES)[number];

export function getSelectedVoiceName(): string | null {
  if (typeof window === "undefined") return null;
  let stored: string | null = null;
  try { stored = localStorage.getItem(VOICE_KEY); } catch {}
  if (stored === BROWSER_VOICE_KEY) return null;
  if (!stored) return DEFAULT_SERVER_VOICE;
  if (isRetiredServerVoice(stored)) {
    setSelectedVoiceName(DEFAULT_SERVER_VOICE);
    return DEFAULT_SERVER_VOICE;
  }
  return stored;
}

export function setSelectedVoiceName(name: string | null): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(VOICE_KEY, name ?? BROWSER_VOICE_KEY); } catch {}
}

export function clampRate(n: number): ValidRate {
  if (!Number.isFinite(n)) return DEFAULT_RATE;
  // 选最接近合法档位的值，越界值落到边界档
  let best: ValidRate = DEFAULT_RATE;
  let bestDiff = Infinity;
  for (const r of VALID_RATES) {
    const diff = Math.abs(r - n);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best;
}

function rateKey(voiceName: string | null): string {
  return `${RATE_KEY_PREFIX}${voiceName ?? BROWSER_VOICE_KEY}`;
}

export function getSelectedRate(voiceName: string | null): ValidRate {
  if (typeof window === "undefined") return DEFAULT_RATE;
  let raw: string | null = null;
  try { raw = localStorage.getItem(rateKey(voiceName)); } catch {}
  if (raw === null) return DEFAULT_RATE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_RATE;
  // 严格匹配档位，不再 fuzzy clamp（防止存了 0.7 被读成 0.75 引起 stepper 视觉跳动）
  return (VALID_RATES as readonly number[]).includes(parsed)
    ? (parsed as ValidRate)
    : DEFAULT_RATE;
}

export function setSelectedRate(voiceName: string | null, rate: number): void {
  if (typeof window === "undefined") return;
  const safe = clampRate(rate);
  try { localStorage.setItem(rateKey(voiceName), String(safe)); } catch {}
}

export function listJapaneseVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang === "ja-JP" || v.lang.toLowerCase().startsWith("ja"));
}

export function hasBrowserJapaneseVoice(): boolean {
  return listJapaneseVoices().length > 0;
}

let currentController: AbortController | null = null;

export type TtsNotice = { message: string; kind: "error" | "info" };
let notice: TtsNotice | null = null;
const noticeListeners = new Set<() => void>();

export function subscribeTtsNotice(listener: () => void): () => void {
  noticeListeners.add(listener);
  return () => { noticeListeners.delete(listener); };
}

export function getTtsNotice(): TtsNotice | null { return notice; }
export function getServerTtsNotice(): null { return null; }
export function clearTtsNotice(): void { publishNotice(null); }

function publishNotice(next: TtsNotice | null): void {
  notice = next;
  for (const listener of noticeListeners) listener();
}

/** 取消当前正在进行的 TTS 请求（含 fetch + 播放） */
export function abortCurrent(): void {
  stopAll();
}

function stopAll(): void {
  if (typeof window === "undefined") return;
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export function buildServerTtsUrl(
  text: string,
  voice: string,
  rate = 0.85
): string {
  const params = new URLSearchParams({
    text,
    voice,
    rate: String(rate),
  });
  return `/api/tts?${params.toString()}`;
}

export type SpeakHandle = {
  /** Always settles; failures are shown by TtsFeedback. */
  promise: Promise<void>;
  abort: () => void;
};

export function speak(text: string, rate?: number): SpeakHandle {
  if (typeof window === "undefined" || !text.trim()) {
    return { promise: Promise.resolve(), abort: () => {} };
  }

  stopAll();
  clearTtsNotice();
  const selectedName = getSelectedVoiceName();
  const effectiveRate = rate !== undefined ? clampRate(rate) : getSelectedRate(selectedName);
  const controller = new AbortController();
  currentController = controller;

  const promise = (async () => {
    try {
      if (isServerVoice(selectedName)) {
        try {
          await playServer(text, selectedName!, effectiveRate, controller.signal);
        } catch (err) {
          if (controller.signal.aborted) return;
          const fallback = listJapaneseVoices().find((voice) => voice.localService);
          if (!fallback) throw err;
          publishNotice({ kind: "info", message: `在线发音失败，已改用本机日语音色：${fallback.name}` });
          await playBrowser(text, effectiveRate, fallback, controller.signal);
        }
      } else {
        const voices = listJapaneseVoices();
        const voice = voices.find((v) => v.name === selectedName) ?? voices[0];
        if (!voice) throw new Error("浏览器没有可用的日语音色，请在音色菜单选择 Nanami 或 Keita");
        await playBrowser(text, effectiveRate, voice, controller.signal);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        publishNotice({ kind: "error", message: err instanceof Error ? err.message : "发音失败，请重试或切换音色" });
      }
    } finally {
      if (currentController === controller) currentController = null;
    }
  })();

  return { promise, abort: () => controller.abort() };
}

async function playServer(text: string, voice: string, rate: number, signal: AbortSignal): Promise<void> {
  const timeout = AbortSignal.timeout(20_000);
  let blob: Blob;
  try {
    const res = await fetch(buildServerTtsUrl(text, voice, rate), {
      signal: AbortSignal.any([signal, timeout]),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(typeof body?.error === "string" ? body.error : `在线发音失败（HTTP ${res.status}），请重试或切换音色`);
    }
    blob = await res.blob();
    if (!blob.size) throw new Error("在线发音返回空音频，请重试或切换音色");
  } catch (err) {
    if (timeout.aborted) throw new Error("在线发音请求超时，请稍后重试或选择本机日语音色");
    if (err instanceof TypeError) throw new Error("无法连接在线发音服务，请检查网络或选择本机日语音色");
    throw err;
  }
  if (signal.aborted) return;
  const blobUrl = URL.createObjectURL(blob);
  const audio = new Audio(blobUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.src = "";
        if (error) reject(error); else resolve();
      };
      const abort = () => finish();
      const timer = setTimeout(() => finish(new Error("发音播放超时，请重试")), 180_000);
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error("音频无法播放，请重试或切换音色"));
      signal.addEventListener("abort", abort, { once: true });
      audio.play().catch(() => finish(new Error("浏览器未允许播放音频，请再次点击朗读")));
    });
  } finally { URL.revokeObjectURL(blobUrl); }
}

function playBrowser(text: string, rate: number, voice: SpeechSynthesisVoice, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = rate;
    utterance.voice = voice;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      utterance.onend = null;
      utterance.onerror = null;
      if (error) reject(error); else resolve();
    };
    const abort = () => {
      finish();
      window.speechSynthesis.cancel();
    };
    const timer = setTimeout(() => {
      finish(new Error("本机发音超时，请重试或切换音色"));
      window.speechSynthesis.cancel();
    }, 180_000);
    utterance.onend = () => finish();
    utterance.onerror = () => finish(new Error("本机日语发音失败，请切换音色后重试"));
    signal.addEventListener("abort", abort, { once: true });
    try { window.speechSynthesis.speak(utterance); }
    catch { finish(new Error("浏览器无法发音，请切换到 Nanami 或 Keita")); }
  });
}

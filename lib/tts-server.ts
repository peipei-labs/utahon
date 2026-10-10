import "server-only";
import { Communicate } from "edge-tts-universal";
import { createHash } from "node:crypto";
import { isServerVoice } from "./tts-voices";

const CACHE_MAX_BYTES = 16 * 1024 * 1024;
const CACHE_MAX_ENTRIES = 300;

type CacheEntry = { buf: Buffer };
const cache = new Map<string, CacheEntry>();
let cacheBytes = 0;

function cacheKey(text: string, voice: string, rate: number): string {
  return createHash("sha256")
    .update(`${voice}|${rate}|${text}`)
    .digest("hex")
    .slice(0, 32);
}

function cacheGet(key: string): Buffer | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit.buf;
}

function cacheSet(key: string, buf: Buffer): void {
  while (
    (cacheBytes + buf.byteLength > CACHE_MAX_BYTES ||
      cache.size >= CACHE_MAX_ENTRIES) &&
    cache.size > 0
  ) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    const old = cache.get(oldestKey);
    if (old) cacheBytes -= old.buf.byteLength;
    cache.delete(oldestKey);
  }
  cache.set(key, { buf });
  cacheBytes += buf.byteLength;
}

function rateToPercent(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

async function synthesizeMp3Internal(
  text: string,
  voice: string,
  rate: number
): Promise<Buffer> {
  const communicate = new Communicate(text, {
    voice,
    rate: rateToPercent(rate),
    connectionTimeout: 10_000,
  });
  const chunks: Buffer[] = [];
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stream = communicate.stream();
  const collect = async () => {
    for await (const chunk of stream) {
      if (expired) break;
      if (chunk.type === "audio" && chunk.data) chunks.push(Buffer.from(chunk.data));
    }
    const buf = Buffer.concat(chunks);
    if (buf.byteLength === 0) throw new Error("在线发音未返回音频，请稍后重试或选择本机日语音色");
    return buf;
  };
  try {
    return await Promise.race([
      collect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error("在线发音请求超时（15 秒），请稍后重试或选择本机日语音色"));
        }, 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (expired) void stream.return().catch(() => {});
  }
}

export function isKnownServerVoice(name: string): boolean {
  return isServerVoice(name);
}

export type SynthesisResult = { buf: Buffer; contentType: string };

// 同 cacheKey 并发请求复用同一个 Promise，避免 thundering herd
const inflight = new Map<string, Promise<SynthesisResult>>();

export async function synthesizeAudio(
  text: string,
  voice: string,
  rate = 0.85
): Promise<SynthesisResult> {
  if (!isKnownServerVoice(voice)) throw new Error("此在线音色已停用，请选择 Nanami 或 Keita");
  const key = cacheKey(text, voice, rate);
  const cached = cacheGet(key);
  if (cached) {
    return { buf: cached, contentType: "audio/mpeg" };
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const contentType = "audio/mpeg";

  const promise: Promise<SynthesisResult> = (async () => {
    const buf = await synthesizeMp3Internal(text, voice, rate);
    cacheSet(key, buf);
    return { buf, contentType };
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

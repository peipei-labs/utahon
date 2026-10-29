import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
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
  return new Promise((resolve, reject) => {
    const cwd = process.cwd();
    const python = join(cwd, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const proc = spawn(python, [join(cwd, "scripts", "synthesize-tts.py")], {
      cwd,
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error, buf?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(buf!);
    };
    const fail = () => finish(new Error("在线发音暂时不可用，请稍后重试或选择本机日语音色"));
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(new Error("在线发音请求超时（15 秒），请稍后重试或选择本机日语音色"));
    }, 15_000);
    proc.stdout.on("data", (chunk: Buffer) => { if (!settled) chunks.push(chunk); });
    proc.stderr.resume();
    proc.on("error", fail);
    proc.stdin.on("error", () => {
      proc.kill("SIGKILL");
      fail();
    });
    proc.on("close", (code) => {
      if (code !== 0) return fail();
      const buf = Buffer.concat(chunks);
      if (buf.byteLength === 0) {
        finish(new Error("在线发音未返回音频，请稍后重试或选择本机日语音色"));
      } else {
        finish(undefined, buf);
      }
    });
    proc.stdin.end(JSON.stringify({ text, voice, rate: rateToPercent(rate) }));
  });
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

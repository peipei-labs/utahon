import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
  getGeminiModel,
  isGeminiTimeoutError,
} from "@/lib/gemini-client";
import { detectSource, type SourceKind } from "./source";

const TRANSCRIBE_MODEL =
  process.env.GEMINI_TRANSCRIBE_MODEL ??
  process.env.GEMINI_MODEL ??
  "gemini-3.6-flash";
const TRANSCRIBE_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL ?? "gemini-2.5-flash-lite";
const HAS_TRANSCRIBE_FALLBACK =
  TRANSCRIBE_MODEL !== TRANSCRIBE_FALLBACK_MODEL;

const YOUTUBE_COOKIES_PATH = process.env.YOUTUBE_COOKIES_PATH ?? "";
const BILIBILI_COOKIES_PATH = process.env.BILIBILI_COOKIES_PATH ?? "";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const TRANSCRIBE_PROMPT = `请把这段日语歌曲的歌词转录为 LRC 格式 严格要求：

1. 只输出 LRC 文本 不要任何解释/前言/Markdown 代码块
2. 每行格式 [mm:ss.xx]歌词文本 时间戳必须对应实际唱歌的开始时刻
3. 跳过纯音乐前奏/间奏/尾奏 不要输出空行
4. 同一句歌词不要拆成两行 但每次重复唱都要输出
5. 优先使用汉字（如「鳴いた」而不是「ないた」）
6. 一行一句 不要标点符号干扰时间戳

示例输出：
[00:08.30]最初の歌詞
[00:11.50]次の歌詞
[00:14.80]また次の歌詞`;

function buildYtDlpArgs(
  kind: SourceKind,
  outputPath: string,
  resolvedUrl: string,
  extraArgs: string[] = []
): string[] {
  const args = ["run", "yt-dlp"];
  if (kind === "youtube") args.push("--js-runtimes", `node:${process.execPath}`);
  if (kind === "youtube" && YOUTUBE_COOKIES_PATH) {
    args.push("--cookies", YOUTUBE_COOKIES_PATH);
  } else if (kind === "bilibili") {
    if (BILIBILI_COOKIES_PATH) {
      args.push("--cookies", BILIBILI_COOKIES_PATH);
    }
    args.push("--user-agent", BROWSER_UA, "--referer", "https://www.bilibili.com/");
  }
  const formatSpec =
    kind === "bilibili"
      ? "bestaudio[ext=m4a]/bestaudio/best"
      : "140/bestaudio[ext=m4a]/bestaudio";
  args.push("-f", formatSpec, ...extraArgs, "-o", outputPath, resolvedUrl);
  return args;
}

export class AudioDownloadError extends Error {
  constructor(message: string, public readonly reason: "failed" | "timeout" | "limit" = "failed") {
    super(message);
    this.name = "AudioDownloadError";
  }
}

export type DownloadAudioOptions = {
  maxBytes?: number;
  maxDurationSec?: number;
  timeoutMs?: number;
};

function runYtDlp(args: string[], timeoutMs?: number, maxBytes?: number, outputPath?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("uv", args, {
      shell: false,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });
    let failure: AudioDownloadError | null = null;
    const stop = (error: AudioDownloadError) => {
      if (failure) return;
      failure = error;
      try {
        if (proc.pid && process.platform !== "win32") process.kill(-proc.pid, "SIGKILL");
        else proc.kill("SIGKILL");
      } catch {
        proc.kill("SIGKILL");
      }
    };
    const timeout = timeoutMs === undefined ? undefined : setTimeout(
      () => stop(new AudioDownloadError("音频下载超时，请稍后重试或上传音频文件", "timeout")),
      timeoutMs
    );
    const sizeCheck = maxBytes && outputPath ? setInterval(async () => {
      try {
        const entries = await fs.readdir(path.dirname(outputPath), { withFileTypes: true });
        let total = 0;
        for (const entry of entries) {
          if (entry.isFile()) total += (await fs.stat(path.join(path.dirname(outputPath), entry.name))).size;
        }
        if (total > maxBytes) stop(new AudioDownloadError("音频超过 100 MiB 上限，请上传较短音频", "limit"));
      } catch {
        // The output directory may have just been cleaned after the process exited.
      }
    }, 250) : undefined;
    const clear = () => {
      clearTimeout(timeout);
      clearInterval(sizeCheck);
    };
    proc.stdout?.resume();
    proc.stderr.resume();
    proc.on("error", (err) => {
      clear();
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new AudioDownloadError("下载工具不可用，请上传音频文件"));
      } else {
        reject(new AudioDownloadError("音频下载失败，请上传音频文件"));
      }
    });
    proc.on("close", (code) => {
      clear();
      if (failure) {
        reject(failure);
      } else if (code !== 0) {
        reject(new AudioDownloadError("来源暂时无法下载，可能需要登录或受平台限制；可改为上传音频文件"));
      } else {
        resolve();
      }
    });
  });
}

export async function downloadAudio(sourceUrl: string, options: DownloadAudioOptions = {}): Promise<string> {
  const src = detectSource(sourceUrl);
  const kind: SourceKind = src?.kind ?? "youtube";
  const resolvedUrl = src?.url ?? sourceUrl;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "utahon-audio-"));
  const outputPath = path.join(tmpDir, "audio.m4a");

  const deadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs;
  const limits = ["--no-playlist", "--no-progress", "--socket-timeout", "15", "--retries", "1", "--fragment-retries", "1"];
  if (options.maxBytes) limits.push("--max-filesize", String(options.maxBytes));
  if (options.maxDurationSec) limits.push("--match-filters", `duration <= ${options.maxDurationSec}`);
  const run = (extra: string[] = []) => {
    const remaining = deadline === undefined ? undefined : deadline - Date.now();
    if (remaining !== undefined && remaining <= 0) {
      throw new AudioDownloadError("音频下载超时，请稍后重试或上传音频文件", "timeout");
    }
    return runYtDlp(buildYtDlpArgs(kind, outputPath, resolvedUrl, [...limits, ...extra]), remaining, options.maxBytes, outputPath);
  };

  try {
    try {
      await run();
    } catch (firstErr) {
      if (kind !== "youtube" || (firstErr instanceof AudioDownloadError && firstErr.reason !== "failed")) {
        throw firstErr;
      }
      await run(["--extractor-args", "youtube:player_client=ios"]);
    }
    try {
      const stat = await fs.stat(outputPath);
      if (stat.size === 0) throw new AudioDownloadError("下载的音频为空，请上传音频文件");
      if (options.maxBytes && stat.size > options.maxBytes) {
        throw new AudioDownloadError("音频超过 100 MiB 上限，请上传较短音频", "limit");
      }
      return outputPath;
    } catch (statErr) {
      if ((statErr as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AudioDownloadError("来源没有提供可下载音频，或超过大小/时长限制；可改为上传音频文件");
      }
      throw statErr;
    }
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    throw error;
  }
}

export async function transcribeAudio(audioPath: string): Promise<string> {
  const audioBuffer = await fs.readFile(audioPath);
  if (audioBuffer.length > 18 * 1024 * 1024) {
    throw new Error(
      `音频过大 ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB inlineData 上限 ~20MB`
    );
  }
  const base64 = audioBuffer.toString("base64");

  const runWithModel = (modelId: string) =>
    getGeminiModel(
      {
        model: modelId,
        generationConfig: {
          temperature: 0.1,
        },
      },
      240_000
    ).generateContent([
      {
        inlineData: {
          mimeType: "audio/mp4",
          data: base64,
        },
      },
      { text: TRANSCRIBE_PROMPT },
    ]);

  let result;
  try {
    result = await runWithModel(TRANSCRIBE_MODEL);
  } catch (err) {
    if (isGeminiTimeoutError(err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    const retryable =
      /\b(429|500|502|503|504)\b|overloaded|UNAVAILABLE|ETIMEDOUT|fetch failed/i.test(
        msg
      );
    if (!HAS_TRANSCRIBE_FALLBACK || !retryable) throw err;
    console.warn(
      `[transcribe] ${TRANSCRIBE_MODEL} 失败，降级到 ${TRANSCRIBE_FALLBACK_MODEL}`
    );
    result = await runWithModel(TRANSCRIBE_FALLBACK_MODEL);
  }

  const text = result.response.text().trim();
  if (!text) throw new Error("Gemini 返回空文本");
  return stripCodeFence(text);
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:lrc|text)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

export async function transcribeYoutube(sourceUrl: string): Promise<string> {
  const audioPath = await downloadAudio(sourceUrl);
  try {
    return await transcribeAudio(audioPath);
  } finally {
    try {
      await fs.rm(path.dirname(audioPath), { recursive: true, force: true });
    } catch {
      // ignore cleanup errors — temp dir
    }
  }
}

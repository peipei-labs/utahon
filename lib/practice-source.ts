import fs from "fs";
import { copyFile, mkdir, mkdtemp, rm, stat } from "fs/promises";
import path from "path";
import { getDb } from "./db";
import { getSong } from "./songs";
import { resolveTranscriptionSource, sourceFields } from "./song-source";
import { AudioDownloadError, downloadAudio } from "./transcribe";
import { MAX_AUDIO_UPLOAD_BYTES, normalizePracticeAudio, probeAudio, sha256File } from "./practice-audio";
import { assertSafeSongId, getPractice, practiceVersionDir, setPracticeAudio, trashPracticeVersion } from "./practice";
import type { PracticeRecord } from "@/types/practice";

export class PracticeSourceError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PracticeSourceError";
  }
}

type SourceRequest = {
  sourceInput: string;
  songUpdatedAt: number;
  baseUpdatedAt: number;
  replaceExisting: boolean;
};

function parseRequest(value: unknown): SourceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PracticeSourceError("请求格式无效", 400);
  }
  const body = value as Record<string, unknown>;
  if ((body.sourceInput !== undefined && typeof body.sourceInput !== "string") ||
      (typeof body.sourceInput === "string" && body.sourceInput.length > 2048) ||
      (body.replaceExisting !== undefined && typeof body.replaceExisting !== "boolean")) {
    throw new PracticeSourceError("来源或替换确认格式无效", 400);
  }
  for (const key of ["songUpdatedAt", "baseUpdatedAt"]) {
    if (!Number.isSafeInteger(body[key]) || (body[key] as number) < 0) {
      throw new PracticeSourceError("缺少有效的歌曲或练习版本，请刷新页面后重试", 400);
    }
  }
  return {
    sourceInput: (body.sourceInput as string | undefined)?.trim() ?? "",
    songUpdatedAt: body.songUpdatedAt as number,
    baseUpdatedAt: body.baseUpdatedAt as number,
    replaceExisting: body.replaceExisting === true,
  };
}

function currentState(songId: string, request: SourceRequest) {
  const song = getSong(songId);
  const practice = getPractice(songId);
  if (!song || !practice) throw new PracticeSourceError("歌曲不存在", 404);
  if (song.updatedAt !== request.songUpdatedAt || practice.updatedAt !== request.baseUpdatedAt) {
    throw new PracticeSourceError("歌曲来源或练习数据已更新，本次下载未保存。请刷新后重试", 409);
  }
  if ((practice.hasAudio || practice.audioSha256) && !request.replaceExisting) {
    throw new PracticeSourceError("已有练习音频，请先确认替换；原音频将保留在回收目录", 409);
  }
  return { song, practice };
}

export async function preparePracticeSource(
  songId: string,
  value: unknown
): Promise<{ record: PracticeRecord; reused: boolean }> {
  try { assertSafeSongId(songId); } catch { throw new PracticeSourceError("歌曲 ID 无效", 400); }
  const request = parseRequest(value);
  const database = getDb();
  const initial = database.transaction(() => currentState(songId, request)).immediate();
  const source = resolveTranscriptionSource(request.sourceInput, initial.song);
  if (!source) {
    throw new PracticeSourceError("请补充 YouTube 链接/视频 ID 或 B站链接/BV号；也可以直接上传音频", 400);
  }

  let downloaded = "";
  let stagedDir = "";
  let installedDir = "";
  try {
    downloaded = await downloadAudio(source.url, {
      maxBytes: MAX_AUDIO_UPLOAD_BYTES,
      maxDurationSec: 2 * 60 * 60,
      timeoutMs: 70_000,
    });
    await probeAudio(downloaded);
    const normalized = path.join(path.dirname(downloaded), "mix.m4a");
    await normalizePracticeAudio(downloaded, normalized);
    if ((await stat(normalized)).size > MAX_AUDIO_UPLOAD_BYTES) {
      throw new PracticeSourceError("转换后音频超过 100 MiB，请上传较短音频", 400);
    }
    const { durationSec } = await probeAudio(normalized);
    const sha256 = await sha256File(normalized);
    const targetDir = practiceVersionDir(songId, sha256);
    const mixPath = path.join(targetDir, "mix.m4a");
    if (fs.existsSync(targetDir)) {
      if (!fs.existsSync(mixPath) || await sha256File(mixPath) !== sha256) {
        throw new PracticeSourceError("已保存的同版音频文件不完整，本次下载未覆盖它；请检查原文件或上传另一音频", 502);
      }
    }
    await mkdir(path.dirname(targetDir), { recursive: true });
    stagedDir = await mkdtemp(path.join(path.dirname(targetDir), ".source-"));
    await copyFile(normalized, path.join(stagedDir, "mix.m4a"));
    let reused = false;
    let previousSha256 = "";
    const record = database.transaction(() => {
      const { song, practice } = currentState(songId, request);
      previousSha256 = practice.audioSha256;
      if (!fs.existsSync(targetDir)) {
        fs.renameSync(stagedDir, targetDir);
        installedDir = targetDir;
      } else if (!fs.existsSync(mixPath)) {
        throw new PracticeSourceError("音频文件在下载期间发生变化，请刷新后重试", 409);
      }
      reused = practice.audioSha256 === sha256 && practice.hasAudio;
      const next = reused ? practice : setPracticeAudio(songId, sha256, durationSec);
      const updatedAt = Math.max(Date.now(), song.updatedAt + 1, next.updatedAt + 1);
      const fields = sourceFields(source);
      database.prepare(`UPDATE songs SET youtube_url = ?, youtube_id = ?, analyzed = ?,
        duration_sec = ?, updated_at = ? WHERE id = ?`).run(
        fields.youtubeUrl, fields.youtubeId, JSON.stringify({ ...song.analyzed, ...fields }),
        Math.round(durationSec), updatedAt, songId
      );
      return next;
    }).immediate();
    installedDir = "";
    if (previousSha256 && previousSha256 !== sha256) {
      try { trashPracticeVersion(songId, previousSha256); }
      catch { console.error("[utahon] previous practice audio retained in place because archiving failed"); }
    }
    return { record, reused };
  } catch (error) {
    if (installedDir) fs.renameSync(installedDir, stagedDir);
    if (error instanceof PracticeSourceError) throw error;
    if (error instanceof AudioDownloadError) {
      throw new PracticeSourceError(error.message, error.reason === "timeout" ? 504 : error.reason === "limit" ? 400 : 502);
    }
    throw new PracticeSourceError("音频下载或转换失败，原有练习音频未更改；请换一个来源或上传音频文件", 502);
  } finally {
    if (downloaded) await rm(path.dirname(downloaded), { recursive: true, force: true });
    if (stagedDir) await rm(stagedDir, { recursive: true, force: true });
  }
}

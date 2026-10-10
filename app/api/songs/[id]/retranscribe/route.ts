import { transcribeYoutube } from "@/lib/transcribe";
import { analyzeLyrics } from "@/lib/analyze-pipeline";
import { isGeminiTimeoutError } from "@/lib/gemini-client";
import { getSong, updateSongLyrics } from "@/lib/songs";
import { getPractice } from "@/lib/practice";
import { resolveTranscriptionSource, sourceFields } from "@/lib/song-source";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const song = getSong(id);
  if (!song) {
    return Response.json({ error: "歌曲不存在" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as
    | { sourceInput?: unknown; updatedAt?: unknown; confirmLocalAudioSource?: unknown }
    | null;
  if (!Number.isSafeInteger(body?.updatedAt)) {
    return Response.json({ error: "缺少歌曲版本，请刷新页面后重试" }, { status: 400 });
  }
  if (body?.updatedAt !== song.updatedAt) {
    return Response.json({ error: "歌曲已更新，请刷新后重试；未覆盖已有内容" }, { status: 409 });
  }
  const sourceInput = typeof body.sourceInput === "string" ? body.sourceInput.trim() : "";

  const source = resolveTranscriptionSource(sourceInput, song);
  if (!source) {
    return Response.json(
      { error: "没有可识别的转录来源，请提供 BV 号 / YouTube videoId / 完整 URL" },
      { status: 400 }
    );
  }
  if (source.kind === "bilibili" && getPractice(id)?.hasAudio && body.confirmLocalAudioSource !== true) {
    return Response.json({
      error: "BV 无法内嵌播放，现有上传音频不会自动替换。请确认上传音频与该 BV 是同一录音版本后再转录；否则先替换音频。",
    }, { status: 400 });
  }

  try {
    const lrc = await transcribeYoutube(source.url);
    const analyzed = await analyzeLyrics({
      lyrics: lrc,
      title: song.title,
      artist: song.artist,
      youtubeUrl: source.kind === "youtube" ? source.url : "",
    });
    Object.assign(analyzed, sourceFields(source), { originalArtist: song.originalArtist });
    const ok = updateSongLyrics(id, lrc, analyzed, song.updatedAt);
    if (!ok) {
      return Response.json({ error: "转录期间歌曲已被修改，请刷新后重试；未覆盖已有内容" }, { status: 409 });
    }
    return Response.json({
      ok: true,
      lines: analyzed.lines.length,
    });
  } catch (err) {
    console.error("[retranscribe]", err);
    const msg = err instanceof Error ? err.message : "转录失败";
    let status = 500;

    if (isGeminiTimeoutError(err)) {
      status = 504;
    } else if (msg.toLowerCase().includes("quota") || msg.includes("429")) {
      status = 429;
    } else if (msg.startsWith("[yt-dlp]")) {
      const lower = msg.toLowerCase();
      if (lower.includes("uv 未找到")) status = 500;
      else if (lower.includes("sign in") || lower.includes("bot")) status = 403;
      else if (lower.includes("cookies")) status = 401;
      else if (lower.includes("unavailable")) status = 404;
      else status = 502;
    }

    return Response.json({ error: msg }, { status });
  }
}

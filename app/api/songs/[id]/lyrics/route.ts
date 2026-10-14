import { analyzeLyrics } from "@/lib/analyze-pipeline";
import { isGeminiTimeoutError } from "@/lib/gemini-client";
import { getSong, updateSongLyrics } from "@/lib/songs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const song = getSong(id);
  if (!song) return Response.json({ error: "歌曲不存在" }, { status: 404 });
  const body = await req.json().catch(() => null) as { lyrics?: unknown; updatedAt?: unknown } | null;
  if (typeof body?.lyrics !== "string" || !body.lyrics.trim() || body.lyrics.length > 100_000 ||
      !Number.isSafeInteger(body.updatedAt)) {
    return Response.json({ error: "请输入有效歌词（最多 100000 字符），并提供当前歌曲版本" }, { status: 400 });
  }
  if (body.updatedAt !== song.updatedAt) {
    return Response.json({ error: "歌曲已更新，请刷新后重新编辑；未覆盖已有内容" }, { status: 409 });
  }
  try {
    const analyzed = await analyzeLyrics({
      lyrics: body.lyrics,
      title: song.title,
      artist: song.artist,
      youtubeUrl: song.analyzed.youtubeUrl,
    });
    analyzed.originalArtist = song.originalArtist;
    analyzed.transcriptionSourceUrl = song.analyzed.transcriptionSourceUrl;
    if (!updateSongLyrics(id, body.lyrics, analyzed, song.updatedAt)) {
      return Response.json({ error: "分析期间歌曲已被修改，请刷新后重试；未覆盖已有内容" }, { status: 409 });
    }
    return Response.json({ ok: true, lines: analyzed.lines.length });
  } catch (error) {
    console.error("[lyrics/edit]", error);
    const message = error instanceof Error && /^(AI |未检测到)/.test(error.message)
      ? error.message : "歌词重新分析失败，原歌词未改动，请稍后重试";
    return Response.json({ error: message }, { status: isGeminiTimeoutError(error) ? 504 : 502 });
  }
}

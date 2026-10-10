import { NextRequest } from "next/server";
import { getSong, deleteSong, updateSongSource } from "@/lib/songs";
import { parsePlaybackSource } from "@/lib/song-source";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const song = getSong(id);
  if (!song) {
    return Response.json({ error: "歌曲不存在" }, { status: 404 });
  }
  return Response.json(song);
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const ok = deleteSong(id);
  if (!ok) {
    return Response.json({ error: "歌曲不存在" }, { status: 404 });
  }
  return Response.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const song = getSong(id);
  if (!song) return Response.json({ error: "歌曲不存在" }, { status: 404 });
  const body = await req.json().catch(() => null) as { youtubeUrl?: unknown; updatedAt?: unknown } | null;
  if (typeof body?.youtubeUrl !== "string" || !Number.isSafeInteger(body.updatedAt)) {
    return Response.json({ error: "请提供 YouTube 来源与歌曲版本，刷新后重试" }, { status: 400 });
  }
  const input = body.youtubeUrl.trim();
  const source = parsePlaybackSource(input);
  if (input && source?.kind !== "youtube") {
    return Response.json({ error: "播放器只支持 YouTube 链接或 videoId；BV 仅能用于音频转录" }, { status: 400 });
  }
  if (!updateSongSource(id, source?.url ?? "", body.updatedAt as number)) {
    return Response.json({ error: "歌曲已在其他页面更新，请刷新后重新编辑；未覆盖已有内容" }, { status: 409 });
  }
  return Response.json({ ok: true, song: getSong(id) });
}

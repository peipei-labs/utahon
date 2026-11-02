import { getSong, saveSongInterpretation } from "@/lib/songs";
import { createSongInterpretation } from "@/lib/song-interpretation";
import { isGeminiTimeoutError } from "@/lib/gemini-client";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const song = getSong(id);
  if (!song) return Response.json({ error: "歌曲不存在" }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || !Number.isSafeInteger(body.updatedAt)) return Response.json({ error: "请刷新歌曲页面后再开始解读" }, { status: 400 });
  if (body.updatedAt !== song.updatedAt) return Response.json({ error: "歌曲已更新，请刷新后再解读；已有结果未改动" }, { status: 409 });
  if (!song.analyzed.lines.length) return Response.json({ error: "请先补充歌词，再开始歌曲解读" }, { status: 400 });
  try {
    const interpretation = await createSongInterpretation(song);
    if (!saveSongInterpretation(id, interpretation, song.updatedAt)) {
      return Response.json({ error: "解读期间歌曲已更新，请刷新后重试；未覆盖新内容" }, { status: 409 });
    }
    return Response.json({ interpretation, updatedAt: getSong(id)!.updatedAt });
  } catch (error) {
    const timeout = isGeminiTimeoutError(error);
    return Response.json({ error: timeout ? "歌曲解读等待超时，请稍后重试；已有结果仍保留" :
      "歌曲解读未完成，请稍后重试；已有歌词和解读仍保留" }, { status: timeout ? 504 : 502 });
  }
}

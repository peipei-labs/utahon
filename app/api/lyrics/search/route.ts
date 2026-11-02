import { searchLyrics, validateLyricsSourceUrl } from "@/lib/lyrics-sources";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !body.title.trim() || body.title.length > 300 ||
      typeof body.artist !== "string" || !body.artist.trim() || body.artist.length > 300 ||
      (body.sourceUrl !== undefined && (typeof body.sourceUrl !== "string" || body.sourceUrl.length > 1000)) ||
      (body.durationSec !== undefined && (typeof body.durationSec !== "number" || !Number.isFinite(body.durationSec) || body.durationSec < 0 || body.durationSec > 7200))) {
    return Response.json({ error: "请输入有效的歌名、歌手和可选歌词页链接" }, { status: 400 });
  }
  if (body.sourceUrl?.trim()) {
    try { validateLyricsSourceUrl(body.sourceUrl.trim()); }
    catch { return Response.json({ error: "请提供 UtaTen 或歌ネット的 HTTPS 歌词详情页链接" }, { status: 400 }); }
  }
  try {
    return Response.json(await searchLyrics({ title: body.title.trim(), artist: body.artist.trim(),
      durationSec: body.durationSec, sourceUrl: body.sourceUrl?.trim() || undefined }));
  } catch {
    return Response.json({ error: "查找现成歌词失败，未修改已有内容；请检查链接或稍后重试" }, { status: 502 });
  }
}

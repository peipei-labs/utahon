import { NextRequest } from "next/server";
import { analyzeLyrics } from "@/lib/analyze-pipeline";
import { isGeminiTimeoutError } from "@/lib/gemini-client";
import { createSong, listSongs } from "@/lib/songs";
import { parseLyricsSource } from "@/lib/lyrics-provenance";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return Response.json(listSongs());
}

export async function POST(request: NextRequest) {
  let body: {
    lyrics: string;
    title?: string;
    artist?: string;
    youtubeUrl?: string;
    lyricsSource?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体不是有效 JSON" }, { status: 400 });
  }

  if (!body || typeof body.lyrics !== "string" || !body.lyrics.trim() || body.lyrics.length > 100_000) {
    return Response.json({ error: "请输入有效歌词（最多 100000 字符）" }, { status: 400 });
  }

  const lyricsSource = parseLyricsSource(body.lyricsSource);
  if (body.lyricsSource !== undefined && !lyricsSource) {
    return Response.json({ error: "歌词来源信息无效，请重新查找或手工录入" }, { status: 400 });
  }

  try {
    const analyzed = await analyzeLyrics({
      lyrics: body.lyrics,
      title: body.title,
      artist: body.artist,
      youtubeUrl: body.youtubeUrl,
    });
    analyzed.lyricsSource = lyricsSource ?? { provider: "manual" };
    const id = createSong({
      title: analyzed.title,
      artist: analyzed.artist,
      lyrics: body.lyrics,
      analyzed,
      youtubeUrl: analyzed.youtubeUrl,
      source: "manual",
    });
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "分析失败";
    let status = 502;
    if (isGeminiTimeoutError(err)) status = 504;
    else if (msg.includes("未检测到") || msg.includes("歌词为空"))
      status = 400;
    else if (
      msg.includes("GOOGLE_AI_API_KEY") ||
      msg.includes("AI_GATEWAY_")
    ) {
      status = 500;
    } else if (msg.toLowerCase().includes("quota") || msg.includes("429")) {
      status = 429;
    }
    return Response.json({ error: msg }, { status });
  }
}

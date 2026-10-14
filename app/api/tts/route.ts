import { NextRequest } from "next/server";
import { isKnownServerVoice, synthesizeAudio } from "@/lib/tts-server";
import { DEFAULT_SERVER_VOICE, isRetiredServerVoice } from "@/lib/tts-voices";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_TEXT_LEN = 400;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const text = (sp.get("text") ?? "").trim();
  if (!text) {
    return Response.json({ error: "text 不能为空" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LEN) {
    return Response.json({ error: "text 过长" }, { status: 400 });
  }

  const voice = sp.get("voice") ?? DEFAULT_SERVER_VOICE;
  if (isRetiredServerVoice(voice)) {
    return Response.json({ error: "此在线音色已停用，请选择 Nanami 或 Keita" }, { status: 400 });
  }
  if (!isKnownServerVoice(voice)) {
    return Response.json({ error: "voice 不合法" }, { status: 400 });
  }

  let rate = 0.85;
  const rateParam = sp.get("rate");
  if (rateParam !== null) {
    const n = Number(rateParam);
    if (!Number.isFinite(n) || n < 0.3 || n > 2) {
      return Response.json({ error: "rate 超出范围 (0.3-2)" }, { status: 400 });
    }
    rate = n;
  }

  try {
    const { buf, contentType } = await synthesizeAudio(text, voice, rate);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    const msg = err instanceof Error && err.message.startsWith("在线发音")
      ? err.message
      : "在线发音暂时不可用，请稍后重试或选择本机日语音色";
    return Response.json({ error: msg }, { status: 502 });
  }
}

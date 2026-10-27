import { PracticeSourceError, preparePracticeSource } from "@/lib/practice-source";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "请求必须是有效 JSON" }, { status: 400 }); }
  try {
    const { record, reused } = await preparePracticeSource(id, body);
    return Response.json(record, { status: reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof PracticeSourceError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "准备练习音频失败，请稍后重试或上传音频文件" }, { status: 502 });
  }
}

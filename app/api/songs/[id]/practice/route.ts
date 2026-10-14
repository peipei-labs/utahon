import { getPractice, PracticeConflictError, savePracticeData } from "@/lib/practice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  try {
    const record = getPractice(id);
    if (!record) return Response.json({ error: "歌曲不存在" }, { status: 404 });
    return Response.json(record, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取练习数据失败";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { id } = await params;
  let body: { data?: unknown; baseUpdatedAt?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体不是有效 JSON" }, { status: 400 });
  }
  try {
    const record = savePracticeData(id, body.data, body.baseUpdatedAt as number);
    return Response.json(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存练习数据失败";
    const status = error instanceof PracticeConflictError ? 409 : message === "歌曲不存在" ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}

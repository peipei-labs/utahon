import { NextRequest, NextResponse } from "next/server";
import { createSession, isLoginConfigured, isSameOriginRequest, safeReturnPath, SESSION_COOKIE, SESSION_SECONDS, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请从本站登录页面重试" }, { status: 403 });
  }
  if (!isLoginConfigured()) return NextResponse.json({ error: "登录暂时不可用，请稍后重试" }, { status: 503 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  if (!await verifyPassword(body?.password)) {
    return NextResponse.json({ error: "密码不正确，请重试" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const response = NextResponse.json({ next: safeReturnPath(body?.next) }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, createSession(), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS,
  });
  return response;
}

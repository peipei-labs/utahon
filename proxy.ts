import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/login" || path === "/api/auth/login" || path === "/api/auth/logout") return NextResponse.next();
  if (verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "请先输入密码登录" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${path}${request.nextUrl.search}`);
  const response = NextResponse.redirect(login);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static/|favicon.ico$).*)"] };

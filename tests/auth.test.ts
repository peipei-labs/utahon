import "next/dist/server/node-environment-baseline";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { randomBytes, scryptSync } from "node:crypto";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch as doesProxyMatch } from "next/dist/experimental/testing/server/middleware-testing-utils";
import { createSession, verifySession, verifyPassword, safeReturnPath, SESSION_COOKIE, SESSION_SECONDS } from "../lib/auth";
import { proxy, config } from "../proxy";
import { POST as login } from "../app/api/auth/login/route";
import { POST as logout } from "../app/api/auth/logout/route";

const password = "synthetic-test-password";
const original = { hash: process.env.UTAHON_PASSWORD_HASH, secret: process.env.UTAHON_SESSION_SECRET };
beforeEach(() => {
  const salt = randomBytes(16).toString("hex");
  process.env.UTAHON_PASSWORD_HASH = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  process.env.UTAHON_SESSION_SECRET = randomBytes(32).toString("hex");
});
afterEach(() => {
  if (original.hash === undefined) delete process.env.UTAHON_PASSWORD_HASH;
  else process.env.UTAHON_PASSWORD_HASH = original.hash;
  if (original.secret === undefined) delete process.env.UTAHON_SESSION_SECRET;
  else process.env.UTAHON_SESSION_SECRET = original.secret;
});
const post = (path: string, body: unknown, origin = "https://utahon.test") => new NextRequest(`https://utahon.test${path}`, {
  method: "POST", headers: { host: "utahon.test", origin, "content-type": "application/json" }, body: JSON.stringify(body),
});

test("password and signed sessions reject wrong, expired, tampered and old-password credentials", async () => {
  assert.equal(await verifyPassword(password), true);
  for (const invalid of ["wrong", "", null, {}, "a".repeat(257)]) assert.equal(await verifyPassword(invalid), false);
  const now = Date.now();
  const token = createSession(now);
  assert.equal(verifySession(token, now), true);
  assert.equal(verifySession(token, now + SESSION_SECONDS * 1000), false);
  assert.equal(verifySession(token.slice(0, -1) + (token.endsWith("0") ? "1" : "0")), false);
  process.env.UTAHON_PASSWORD_HASH = "a".repeat(32) + ":" + "b".repeat(128);
  assert.equal(verifySession(token), false);
});

test("missing configuration fails closed", async () => {
  delete process.env.UTAHON_PASSWORD_HASH;
  assert.equal(verifySession(createSessionForInvalidConfig()), false);
  assert.equal(await verifyPassword(password), false);
  assert.throws(() => createSession());
  assert.equal((await login(post("/api/auth/login", { password }))).status, 503);
});

function createSessionForInvalidConfig() { return `${Math.floor(Date.now() / 1000) + 1000}.${"a".repeat(32)}.${"b".repeat(64)}`; }

test("pages, data, media and Next image requests require a valid session", () => {
  for (const path of ["/", "/song/example", "/api/songs", "/api/tts?text=test", "/api/songs/example/practice/audio/mix", "/_next/image?url=%2Fapi%2Fsongs", "/_next/data/test/song/example.json"]) {
    assert.equal(doesProxyMatch({ config, nextConfig: {}, url: path }), true);
    const anonymous = proxy(new NextRequest(`https://utahon.test${path}`));
    assert.equal(anonymous.status, path.startsWith("/api/") ? 401 : 307);
    const allowed = proxy(new NextRequest(`https://utahon.test${path}`, { headers: { cookie: `${SESSION_COOKIE}=${createSession()}` } }));
    assert.equal(allowed.headers.get("x-middleware-next"), "1");
    assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(doesProxyMatch({ config, nextConfig: {}, url: "/_next/static/chunks/app.js" }), false);
  assert.equal(proxy(new NextRequest("https://utahon.test/login")).headers.get("x-middleware-next"), "1");
});

test("login sets an HttpOnly cookie, rejects cross-origin requests and logout expires it", async () => {
  assert.equal((await login(post("/api/auth/login", { password: "wrong" }))).status, 401);
  for (const origin of ["https://other.test", "null", "invalid"]) {
    assert.equal((await login(post("/api/auth/login", { password }, origin))).status, 403);
    assert.equal((await logout(post("/api/auth/logout", {}, origin))).status, 403);
  }
  const response = await login(post("/api/auth/login", { password, next: "/song/example" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { next: "/song/example" });
  assert.equal(verifySession(response.cookies.get(SESSION_COOKIE)?.value), true);
  assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
  assert.match(response.headers.get("set-cookie")!, /SameSite=lax/i);
  assert.match((await logout(post("/api/auth/logout", {}))).headers.get("set-cookie")!, /Max-Age=0/i);
});

test("login return paths stay on this site and avoid authentication loops", () => {
  for (const path of ["https://other.test", "//other.test", "/\\other.test", "/login", "/api/auth/logout", "\r\nLocation: other"]) assert.equal(safeReturnPath(path), "/");
  assert.equal(safeReturnPath("/song/example?line=2"), "/song/example?line=2");
});

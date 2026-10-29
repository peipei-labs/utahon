import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

export const SESSION_COOKIE = "utahon_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const deriveKey = promisify(scrypt);

function settings() {
  const hash = process.env.UTAHON_PASSWORD_HASH ?? "";
  const secret = process.env.UTAHON_SESSION_SECRET ?? "";
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash) || secret.length < 32) return null;
  return { hash, secret };
}

export function isLoginConfigured(): boolean {
  return settings() !== null;
}

export async function verifyPassword(password: unknown): Promise<boolean> {
  const config = settings();
  if (!config || typeof password !== "string" || password.length > 256 || !password) return false;
  const [salt, expected] = config.hash.split(":");
  const actual = await deriveKey(password, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}

function signature(payload: string, config: NonNullable<ReturnType<typeof settings>>) {
  return createHmac("sha256", config.secret).update(`${config.hash}|${payload}`).digest("hex");
}

export function createSession(now = Date.now()): string {
  const config = settings();
  if (!config) throw new Error("登录尚未配置");
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(16).toString("hex")}`;
  return `${payload}.${signature(payload, config)}`;
}

export function verifySession(token: string | undefined, now = Date.now()): boolean {
  const config = settings();
  if (!config || !token || !/^\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expires, nonce, supplied] = token.split(".");
  if (Number(expires) <= Math.floor(now / 1000)) return false;
  return timingSafeEqual(Buffer.from(signature(`${expires}.${nonce}`, config), "hex"), Buffer.from(supplied, "hex"));
}

export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return "/";
  const path = new URL(value, "https://utahon.invalid");
  if (path.origin !== "https://utahon.invalid" || path.pathname === "/login" || path.pathname.startsWith("/api/auth/")) return "/";
  return `${path.pathname}${path.search}${path.hash}`;
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

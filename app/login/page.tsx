"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = new URLSearchParams(window.location.search).get("next") ?? "/";
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, next }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "登录失败，请重试");
      window.location.assign(result.next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接失败，请重试");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-16">
      <section className="w-full max-w-sm">
        <p className="font-mono text-[10px] tracking-[0.24em] uppercase text-ink-soft">A private songbook</p>
        <h1 className="font-serif-jp text-5xl tracking-tight mt-4">Utahon <span className="text-red">歌本</span></h1>
        <p className="text-sm text-ink-soft mt-4 leading-relaxed">从喜欢的歌入手，慢慢听懂日语。</p>
        <div className="border-t border-rule mt-8 pt-7">
          <form onSubmit={login}>
            <label htmlFor="password" className="flex items-center gap-2 text-sm mb-3"><LockKeyhole size={15} />访问密码</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256}
              value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy}
              className="w-full rounded-sm border border-rule bg-paper px-4 py-3 text-base outline-none focus:border-ink focus:ring-1 focus:ring-ink disabled:opacity-50" />
            <p aria-live="polite" role={error ? "alert" : undefined} className="min-h-6 mt-3 text-sm text-red">{error}</p>
            <button type="submit" disabled={busy} className="w-full mt-2 flex items-center justify-center gap-3 rounded-sm bg-ink px-4 py-3 text-paper text-sm hover:opacity-85 disabled:opacity-50">
              {busy ? "正在登录…" : "进入歌本"}<ArrowRight size={16} />
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

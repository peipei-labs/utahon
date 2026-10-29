"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return <button type="button" disabled={busy} title={failed ? "退出失败，请重试" : "退出登录"} aria-label={failed ? "退出失败，请重试" : "退出登录"}
    className="p-2 text-ink-soft hover:text-ink disabled:opacity-50" onClick={async () => {
      setBusy(true);
      try {
        const result = await fetch("/api/auth/logout", { method: "POST" });
        if (!result.ok) throw new Error("logout");
        window.location.assign("/login");
      } catch { setFailed(true); setBusy(false); }
    }}><LogOut size={16} /></button>;
}

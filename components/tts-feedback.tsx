"use client";

import { useSyncExternalStore } from "react";
import { clearTtsNotice, getServerTtsNotice, getTtsNotice, subscribeTtsNotice } from "@/lib/tts";

export function TtsFeedback() {
  const notice = useSyncExternalStore(subscribeTtsNotice, getTtsNotice, getServerTtsNotice);
  if (!notice) return null;
  return (
    <div role={notice.kind === "error" ? "alert" : "status"}
      className="fixed bottom-4 left-4 right-4 z-[100] mx-auto flex max-w-xl items-start gap-3 border border-ink bg-paper p-4 text-sm text-ink shadow-[4px_4px_0_0_var(--rule)]">
      <p className="flex-1">{notice.message}</p>
      <button type="button" aria-label="关闭发音提示" onClick={clearTtsNotice}
        className="shrink-0 underline underline-offset-4">关闭</button>
    </div>
  );
}

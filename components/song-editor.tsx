"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TextPill } from "./editorial-interactive";

export function SongEditor({ songId, lyrics, youtubeUrl, updatedAt }: {
  songId: string;
  lyrics: string;
  youtubeUrl: string;
  updatedAt: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"lyrics" | "source" | null>(null);
  const [draftLyrics, setDraftLyrics] = useState(lyrics);
  const [draftSource, setDraftSource] = useState(youtubeUrl);
  const [draftVersion, setDraftVersion] = useState(updatedAt);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function begin(nextMode: "lyrics" | "source") {
    if (!mode) {
      setDraftLyrics(lyrics);
      setDraftSource(youtubeUrl);
      setDraftVersion(updatedAt);
    }
    setMode(nextMode);
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!mode || busy || pending) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/songs/${songId}${mode === "lyrics" ? "/lyrics" : ""}`, {
        method: mode === "lyrics" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "lyrics"
          ? { lyrics: draftLyrics, updatedAt: draftVersion }
          : { youtubeUrl: draftSource, updatedAt: draftVersion }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || `保存失败 (${response.status})`);
      setMode(null);
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，原数据未改动");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 border border-rule p-4 bg-paper-deep/30" aria-label="歌曲维护">
      <p className="text-sm text-ink-soft leading-relaxed">
        歌词、读音和翻译可能由 AI 生成，未经人工逐句校对。格式检查不能保证内容准确；发现错误请纠正歌词后重新分析。
      </p>
      <div className="flex flex-wrap gap-2 mt-3">
        <TextPill disabled={busy || pending} onClick={() => begin("lyrics")}>
          纠错歌词
        </TextPill>
        <TextPill disabled={busy || pending} onClick={() => begin("source")}>
          {youtubeUrl ? "修改播放来源" : "补充播放来源"}
        </TextPill>
      </div>
      {mode && (
        <form onSubmit={save} className="mt-4 space-y-3">
          {draftVersion !== updatedAt && <p role="status" className="text-sm text-red">歌曲已更新，当前草稿仍保留。请先复制需要的内容，再取消并重新打开编辑。</p>}
          {mode === "lyrics" ? (
            <>
              <label className="block text-sm text-ink">
                歌词原文 / LRC
                <textarea
                  value={draftLyrics} onChange={(event) => setDraftLyrics(event.target.value)}
                  rows={12} required disabled={busy || pending} maxLength={100000}
                  className="block w-full mt-2 p-3 bg-paper border border-rule text-ink font-mono text-sm"
                />
              </label>
              <p className="text-xs text-ink-soft">保留 [分:秒] 时间标签可继续跟随播放；普通文本没有定位时间。保存会调用 AI 重新生成读音和翻译，成功后才替换旧内容。</p>
            </>
          ) : (
            <>
              <label className="block text-sm text-ink">
                YouTube 播放来源
                <input value={draftSource} onChange={(event) => setDraftSource(event.target.value)}
                  disabled={busy || pending} placeholder="YouTube URL 或 videoId；留空移除关联"
                  className="block w-full mt-2 p-3 bg-paper border border-rule text-ink text-sm" />
              </label>
              <p className="text-xs text-ink-soft">请选同一录音版本。这里只修改播放来源，不会自动调整歌词时间；换版本后请重新转录或手动校对。BV 仅用于音频转录，不支持内嵌播放。</p>
            </>
          )}
          {error && <p role="alert" className="text-sm text-red break-words">{error}</p>}
          <div className="flex gap-3 items-center">
            <button type="submit" disabled={busy || pending}
              className="border border-ink px-3 py-2 text-sm disabled:opacity-50">
              {busy || pending ? (mode === "lyrics" ? "重新分析中…" : "保存中…") : (mode === "lyrics" ? "重新分析并保存" : "保存来源")}
            </button>
            <button type="button" disabled={busy || pending} onClick={() => setMode(null)} className="text-sm text-ink-soft">取消</button>
          </div>
        </form>
      )}
    </section>
  );
}

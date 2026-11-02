"use client";

import { useEffect, useRef, useState } from "react";
import { LYRICS_SOURCE_NAMES } from "@/lib/lyrics-provenance";
import type { LyricsCandidate, LyricsSearchResult } from "@/types/lyrics-source";

export function LyricsLookup({ title, artist, durationSec, disabled, onUse }: {
  title: string;
  artist: string;
  durationSec?: number;
  disabled?: boolean;
  onUse: (candidate: LyricsCandidate) => void;
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [state, setState] = useState<{ key: string; loading?: boolean; result?: LyricsSearchResult; error?: string }>();
  const requestRef = useRef<AbortController | null>(null);
  const key = JSON.stringify([title.trim(), artist.trim(), durationSec, sourceUrl.trim()]);
  const visible = state?.key === key ? state : undefined;
  const candidate = visible?.result?.kind === "found" ? visible.result.candidate : undefined;
  useEffect(() => () => requestRef.current?.abort(), []);

  async function search() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ key, loading: true });
    try {
      const response = await fetch("/api/lyrics/search", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ title, artist, durationSec, sourceUrl: sourceUrl.trim() || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `查找失败 (${response.status})`);
      if (!controller.signal.aborted) setState({ key, result });
    } catch (error) {
      if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : "无法连接歌词服务" });
    }
  }

  return (
    <div className="space-y-3 border border-rule p-3" aria-label="查找现成歌词">
      <p className="text-sm text-ink-soft">优先查找 UtaTen、歌ネット，再用 LRCLIB 补充歌词或时间轴。</p>
      <details>
        <summary className="cursor-pointer text-xs text-ink-soft">已有歌词页面链接</summary>
        <input aria-label="歌词页面链接" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)}
          disabled={disabled || visible?.loading} placeholder="UtaTen / 歌ネット 歌词页 URL（可选）"
          className="mt-2 w-full border border-rule bg-paper p-2 text-sm text-ink" />
      </details>
      <button type="button" disabled={disabled || visible?.loading || !title.trim() || !artist.trim()}
        onClick={search} className="border border-ink px-3 py-2 text-sm text-ink disabled:opacity-50">
        {visible?.loading ? "正在查找现成歌词…" : "查找现成歌词"}
      </button>
      {(!title.trim() || !artist.trim()) && <p className="text-xs text-ink-soft">先填写歌名和歌手，以免取得其他版本。</p>}
      {visible?.error && <p role="alert" className="text-sm text-red">{visible.error}</p>}
      {visible?.result?.kind === "not-found" && <p role="status" className="text-sm text-ink-soft">这些来源暂未找到歌名、歌手匹配的歌词。可补充准确歌词页链接，或手工粘贴原文；音频转录仅作为最后的草稿来源。</p>}
      {visible?.result?.kind === "unavailable" && <p role="alert" className="text-sm text-red">部分来源暂时无法访问，不能据此判断没有歌词。请稍后重试，或补充歌词页链接。</p>}
      {candidate && (
        <div className="space-y-2">
          <p className="text-sm text-ink break-words">{candidate.trackName} · {candidate.artistName}</p>
          <p className="text-xs text-ink-soft">
            来源：<a href={candidate.source.url} target="_blank" rel="noopener noreferrer" className="underline">{LYRICS_SOURCE_NAMES[candidate.source.provider]}</a>
            {candidate.hasTimestamps ? " · 附时间轴，请核对录音版本" : " · 纯文本，暂不能逐句定位播放"}
          </p>
          <details>
            <summary className="cursor-pointer text-sm text-ink">预览歌词</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm text-ink">{candidate.lyrics}</pre>
          </details>
          <button type="button" disabled={disabled} onClick={() => onUse(candidate)}
            className="border border-ink px-3 py-2 text-sm text-ink disabled:opacity-50">填入编辑框</button>
          <p className="text-xs text-ink-soft">填入会替换编辑框里的内容，确认保存前不会修改已存歌曲。</p>
        </div>
      )}
      {visible?.result && (
        <details className="text-xs text-ink-soft">
          <summary className="cursor-pointer">各来源查询结果</summary>
          <ul className="mt-2 space-y-1">
            {visible.result.attempts.map((attempt, index) => (
              <li key={`${attempt.provider}-${index}`}>{LYRICS_SOURCE_NAMES[attempt.provider]}：{attempt.status === "found" ? "已找到" : attempt.status === "not-found" ? "未找到匹配歌词" : "暂时无法访问"}{attempt.message ? `（${attempt.message}）` : ""}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

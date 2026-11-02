"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2 } from "lucide-react";
import type { InterpretationContext, SongInterpretation } from "@/types/song-interpretation";
import { SongThemeTags } from "./song-theme-tags";

export function SongInterpretationPanel({ songId, updatedAt, interpretation, hasLyrics }: {
  songId: string;
  updatedAt: number;
  interpretation?: SongInterpretation;
  hasLyrics: boolean;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState("");
  const busy = loading || refreshing;

  async function interpret() {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/songs/${songId}/interpretation`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updatedAt }), signal: AbortSignal.timeout(150_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "解读未完成，请稍后重试");
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "TimeoutError"
        ? "等待较久，请刷新查看是否已完成；已有结果仍保留"
        : cause instanceof Error ? cause.message : "连接失败，请稍后重试；已有结果仍保留");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="interpretation-heading" className="mt-6 border border-rule p-4 md:p-6 bg-paper-deep/30 min-w-0 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="interpretation-heading" className="font-serif text-xl text-ink flex items-center gap-2">
            <BookOpen className="w-4 h-4" aria-hidden="true" />歌曲解读
          </h2>
          <p className="text-xs text-ink-soft mt-1">读懂主题、情绪，以及作品背后的背景。</p>
        </div>
        <button type="button" onClick={interpret} disabled={busy || !hasLyrics}
          className="inline-flex items-center justify-center gap-2 border border-ink bg-ink text-paper px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-80 transition">
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {busy ? "正在解读…" : interpretation ? "重新解读" : "一键解读"}
        </button>
      </div>
      <p className="text-xs text-ink-mute leading-relaxed mt-3">
        基于当前保存的歌词，由 AI 结合可查到的作品与艺人资料分析。歌词错漏会影响解读，结果不代表作者亲自确认的意图。
      </p>
      {!hasLyrics && <p className="mt-3 text-sm text-ink-soft">先添加歌词，即可开始解读。</p>}
      {busy && <p role="status" className="mt-3 text-sm text-ink-soft">正在查找背景资料并分析歌词，可能需要一两分钟…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red">{error}</p>}
      {interpretation && (
        <div className="mt-5 border-t border-rule pt-5">
          {interpretation.stale && <p className="text-sm text-red mb-3">歌词已变化，以下是旧版本的解读；请重新解读以更新主题标签。</p>}
          <p className="font-serif text-lg md:text-xl leading-relaxed text-ink">{interpretation.summary}</p>
          <SongThemeTags tags={interpretation.tags.map(item => item.tag)} />
          <div className="mt-5 grid md:grid-cols-2 gap-5 md:gap-8 text-sm leading-7 text-ink-soft">
            <div><h3 className="font-medium text-ink mb-1">主要想表达什么</h3><p className="whitespace-pre-line">{interpretation.mainMessage}</p></div>
            <div><h3 className="font-medium text-ink mb-1">情绪如何变化</h3><p className="whitespace-pre-line">{interpretation.emotionalArc}</p></div>
          </div>
          <details className="mt-5 border-t border-rule pt-3">
            <summary className="cursor-pointer text-sm text-ink py-1">查看歌词依据、作品与时代背景</summary>
            <div className="mt-4 space-y-5 text-sm leading-7 text-ink-soft">
              <div>
                <h3 className="font-medium text-ink">歌词依据</h3>
                <ul className="mt-2 space-y-2">
                  {interpretation.lyricEvidence.map((item, index) => <li key={index}>
                    <span className="text-ink">第 {item.lineNumbers.join("、")} 行 · </span>{item.explanation}
                  </li>)}
                </ul>
              </div>
              <ContextBlock title="作品集" value={interpretation.collection} result={interpretation} />
              <ContextBlock title="时代背景" value={interpretation.era} result={interpretation} />
              <ContextBlock title="创作背景" value={interpretation.creation} result={interpretation} />
              <div>
                <h3 className="font-medium text-ink">为什么贴这些标签</h3>
                {interpretation.tags.map(item => <p key={item.tag}><span className="text-ink">{item.tag} · </span>{item.reason}</p>)}
              </div>
              <div className="border-t border-rule pt-3">
                <h3 className="font-medium text-ink">参考资料</h3>
                {interpretation.sources.length === 0 && <p>本次未取得背景资料，解读仅依据当前歌词。</p>}
                <ul>
                  {interpretation.sources.map(source => <li key={source.id}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{source.title}</a>
                    <span className="text-xs text-ink-mute"> · {source.publisher}</span>
                  </li>)}
                </ul>
                {interpretation.backgroundNotes.map((note, index) => <p key={index} className="text-xs text-ink-mute mt-1">{note}</p>)}
                <p className="text-xs text-ink-mute mt-3">{new Date(interpretation.generatedAt).toISOString().slice(0, 10)} · {interpretation.model}</p>
              </div>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

function ContextBlock({ title, value, result }: { title: string; value: InterpretationContext; result: SongInterpretation }) {
  return (
    <div>
      <h3 className="font-medium text-ink">{title}<span className="text-xs font-normal text-ink-mute ml-2">
        {value.basis === "source" ? "资料支持" : value.basis === "inference" ? "文本解读 / 推测" : "资料不足"}
      </span></h3>
      <p className="whitespace-pre-line">{value.text}</p>
      {value.sourceIds.map(id => {
        const source = result.sources.find(source => source.id === id);
        return source ? <a key={id} href={source.url} target="_blank" rel="noopener noreferrer"
          className="inline-block mr-3 text-xs underline underline-offset-2">{source.title}</a> : null;
      })}
    </div>
  );
}

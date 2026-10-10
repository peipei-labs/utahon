"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mic, Loader2, Copy, ChevronDown, ChevronRight } from "lucide-react";
import { TextPill } from "./editorial-interactive";
import { parsePlaybackSource } from "@/lib/song-source";

export function RetranscribeButton({
  songId,
  updatedAt,
  currentSourceUrl,
  hasPracticeAudio,
}: {
  songId: string;
  updatedAt: number;
  currentSourceUrl: string;
  hasPracticeAudio: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    const input = window.prompt(
      "贴 BV 号 / YouTube videoId / 完整 URL\n留空使用当前来源。成功后替换现有歌词与时间轴；失败不改原数据。\nBV 可用于转录，但页面不能内嵌播放 Bilibili。\nAI 可能听错，完成后请逐句校对。",
      ""
    );
    if (input === null) return;
    const source = parsePlaybackSource(input.trim() || currentSourceUrl);
    const confirmLocalAudioSource = source?.kind === "bilibili" && hasPracticeAudio;
    if (confirmLocalAudioSource && !window.confirm(
      "BV 无法在页面内嵌播放，已有上传音频不会自动替换。\n请确认当前上传音频与该 BV 是同一录音版本，再继续转录。\n如果不是，请取消并先上传对应音频。"
    )) return;
    setBusy(true);
    setError(null);
    setExpanded(false);
    try {
      const res = await fetch(`/api/songs/${songId}/retranscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceInput: input.trim(), updatedAt, confirmLocalAudioSource }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "转录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TextPill
        onClick={handleClick}
        disabled={busy || isPending}
        title="用 Gemini 多模态从音频重转(覆盖现有歌词)"
        icon={
          busy ? (
            <Loader2 className="w-3 h-3 animate-spin" strokeWidth={1.5} />
          ) : (
            <Mic className="w-3 h-3" strokeWidth={1.5} />
          )
        }
      >
        {busy ? "转录中" : "音频转录"}
      </TextPill>
      {error && (
        <div className="flex flex-col gap-0.5 max-w-sm">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-0.5 font-mono text-[10px] tracking-wide text-red hover:opacity-70"
              title={expanded ? "折叠错误" : "展开完整错误"}
            >
              {expanded ? (
                <ChevronDown className="w-3 h-3 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 flex-shrink-0" />
              )}
              {expanded ? "错误详情" : error.slice(0, 60) + (error.length > 60 ? "…" : "")}
            </button>
            <button
              onClick={async () => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  try {
                    await navigator.clipboard.writeText(error);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                    return;
                  } catch {
                    // 权限拒绝或写入失败 → 落到下面的手动复制兜底
                  }
                }
                window.prompt("当前环境不支持自动复制 请手动 Ctrl+C", error);
              }}
              className="text-red hover:opacity-70"
              title="复制完整错误"
            >
              <Copy className="w-3 h-3" />
            </button>
            {copied && (
              <span className="font-mono text-[10px] text-green-600">已复制</span>
            )}
          </div>
          {expanded && (
            <pre className="font-mono text-[10px] text-red whitespace-pre-wrap break-all bg-red-50 rounded p-1 max-h-40 overflow-y-auto">
              {error}
            </pre>
          )}
        </div>
      )}
    </>
  );
}

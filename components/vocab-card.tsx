"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, Volume2, Loader2 } from "lucide-react";
import type { VocabEntry } from "@/lib/vocabulary";
import { cn } from "@/lib/utils";
import { useTtsToggle } from "@/lib/use-tts-toggle";
import {
  LevelPips,
  Smallcaps,
  relativeAdded,
  stalenessLevel,
} from "./editorial-shell";

function hasKanji(text: string): boolean {
  return /[㐀-鿿]/.test(text);
}

export function VocabCard({ entry }: { entry: VocabEntry }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { speaking, toggle } = useTtsToggle();

  const showFurigana =
    hasKanji(entry.surface) &&
    entry.furigana &&
    entry.furigana !== entry.surface;

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`从词汇本移除「${entry.surface}」？`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/vocabulary/${entry.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHidden(true);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  if (hidden) return null;

  const decorativeLevel = stalenessLevel(entry.createdAt);

  return (
    <article className="group relative py-5 md:py-6 border-b border-rule">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <span className="font-serif-jp jp text-[26px] md:text-[30px] font-medium text-ink leading-none">
            {entry.surface}
          </span>
          {showFurigana && (
            <span className="font-serif-jp jp text-[12px] md:text-[14px] text-ink-mute leading-none">
              {entry.furigana}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <LevelPips level={decorativeLevel} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle(entry.surface);
            }}
            aria-label={speaking ? "停止朗读" : "朗读"}
            className="w-6 h-6 flex items-center justify-center text-ink-mute hover:text-ink transition"
          >
            {speaking ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            )}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            aria-label="从词汇本移除"
            className={cn(
              "w-6 h-6 flex items-center justify-center text-ink-mute transition",
              "hover:text-red",
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-60"
            )}
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {entry.romaji && (
        <div className="font-serif italic text-[13px] md:text-[14px] text-red-soft mt-1">
          {entry.romaji}
        </div>
      )}

      <div className="flex items-baseline gap-2 mt-2.5 font-serif text-[15px] md:text-[16px] text-ink">
        {entry.pos && (
          <Smallcaps tone="mute">{entry.pos}</Smallcaps>
        )}
        {entry.pos && <span className="text-ink-mute">·</span>}
        <span className="break-words">{entry.meaning || "—"}</span>
      </div>

      {(entry.sourceSongTitle || entry.createdAt) && (
        <div className="mt-3 flex items-baseline gap-2 font-serif italic text-[12px] text-ink-mute border-l-2 border-[color-mix(in_srgb,var(--red)_40%,transparent)] pl-2.5">
          {entry.sourceSongTitle ? (
            <>
              <span>collected from</span>
              {entry.sourceSongId ? (
                <Link
                  href={`/song/${entry.sourceSongId}`}
                  className="font-serif-jp jp not-italic text-ink hover:text-red transition"
                >
                  {entry.sourceSongTitle}
                </Link>
              ) : (
                <span className="font-serif-jp jp not-italic text-ink-soft">
                  {entry.sourceSongTitle}
                </span>
              )}
              <span>·</span>
            </>
          ) : null}
          <span>{relativeAdded(entry.createdAt)}</span>
        </div>
      )}

      {error && (
        <p className="mt-2 font-mono text-[10px] tracking-wide text-red">
          {error}
        </p>
      )}
    </article>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Volume2, Copy, Check, Music4, Star, Loader2, X } from "lucide-react";
import type { AnalyzedLine, Token } from "@/types/lyrics";
import type { ChordEvent } from "@/types/practice";
import { cn } from "@/lib/utils";
import { useTtsToggle } from "@/lib/use-tts-toggle";
import { usePlayer } from "./player-context";
import { useSongInfo } from "./song-info-context";
import { Smallcaps } from "./editorial-shell";
import { ChordStrip } from "./chord-strip";

type StarState = "idle" | "saving" | "saved" | "err";

function hasKanji(text: string): boolean {
  return /[㐀-鿿]/.test(text);
}

function isSymbolOnly(text: string): boolean {
  return text.length > 0 && /^[\s\p{P}\p{S}]+$/u.test(text);
}

function TokenChip({
  token,
  open,
  onToggle,
}: {
  token: Token;
  open: boolean;
  onToggle: () => void;
}) {
  const [starState, setStarState] = useState<StarState>("idle");
  const { speaking, toggle } = useTtsToggle();
  const songInfo = useSongInfo();
  const pos = (token.pos ?? "").toLowerCase();
  const isSymbol = pos === "symbol" || isSymbolOnly(token.surface);
  const isMuted = pos === "particle" || pos === "auxiliary";
  const showFurigana =
    hasKanji(token.surface) && token.furigana && token.furigana !== token.surface;

  if (isSymbol) {
    return <span className="align-baseline whitespace-pre">{token.surface}</span>;
  }

  async function handleStar(e: React.MouseEvent) {
    e.stopPropagation();
    if (starState === "saving" || starState === "saved") return;
    setStarState("saving");
    try {
      const res = await fetch("/api/vocabulary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface: token.surface,
          furigana: token.furigana,
          romaji: token.romaji,
          meaning: token.meaning,
          pos: token.pos,
          sourceSongId: songInfo?.songId ?? null,
          sourceSongTitle: songInfo?.songTitle ?? "",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStarState("saved");
    } catch {
      setStarState("err");
      setTimeout(() => setStarState("idle"), 2000);
    }
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "px-[2px] py-[1px] align-baseline transition-colors cursor-pointer touch-manipulation",
          "hover:bg-[color-mix(in_srgb,var(--red)_14%,transparent)]",
          open && "bg-[color-mix(in_srgb,var(--red)_18%,transparent)]",
          isMuted && "text-ink-soft"
        )}
      >
        {showFurigana ? (
          <ruby>
            {token.surface}
            <rt>{token.furigana}</rt>
          </ruby>
        ) : (
          <span>{token.surface}</span>
        )}
      </button>

      {open && (
        <motion.span
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20",
            "min-w-[12rem] w-max max-w-[calc(100vw-2rem)] sm:max-w-[20rem]",
            "p-3 bg-paper text-ink border border-ink shadow-[6px_6px_0_0_var(--rule)]",
            "text-left text-sm font-normal whitespace-normal font-sans"
          )}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-serif-jp jp text-[22px] font-medium text-ink truncate">
                {token.surface}
              </span>
              {token.furigana && (
                <span className="font-serif-jp jp text-[11px] text-ink-mute shrink-0">
                  {token.furigana}
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(token.surface);
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
                onClick={handleStar}
                disabled={starState === "saving"}
                aria-label={
                  starState === "saved"
                    ? "已收藏"
                    : starState === "err"
                    ? "收藏失败"
                    : "收藏到词汇本"
                }
                className={cn(
                  "w-6 h-6 flex items-center justify-center transition",
                  starState === "saved"
                    ? "text-red"
                    : starState === "err"
                    ? "text-red-soft"
                    : "text-ink-mute hover:text-red"
                )}
              >
                {starState === "saving" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Star
                    className="w-3.5 h-3.5"
                    strokeWidth={1.5}
                    fill={starState === "saved" ? "currentColor" : "none"}
                  />
                )}
              </button>
            </div>
          </div>

          {token.romaji && (
            <div className="font-serif italic text-[12px] text-red-soft mt-1">
              {token.romaji}
            </div>
          )}

          {token.meaning && (
            <div className="font-serif text-[14px] text-ink mt-2 border-t border-rule pt-2">
              {token.meaning}
            </div>
          )}

          {token.pos && (
            <div className="mt-2 inline-block border border-rule font-mono text-[9px] tracking-[0.14em] uppercase text-ink-soft px-1.5 py-0.5">
              {token.pos}
            </div>
          )}
        </motion.span>
      )}
    </span>
  );
}

export function LyricLine({
  line,
  index,
  chords,
}: {
  line: AnalyzedLine;
  index: number;
  chords: ChordEvent[];
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [openToken, setOpenToken] = useState<number | null>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const { speaking, toggle } = useTtsToggle();
  const player = usePlayer();
  const canPlaySegment = Boolean(player?.available) && line.endTime - line.startTime > 0.3;

  useEffect(() => {
    if (openToken === null) return;
    function handlePointerDown(event: MouseEvent) {
      if (lineRef.current && !lineRef.current.contains(event.target as Node)) {
        setOpenToken(null);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenToken(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openToken]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(line.original);
      setCopyState("copied");
    } catch {
      // clipboard may be unavailable over http
      setCopyState("error");
    }
  }

  return (
    <motion.div
      ref={lineRef}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.015, duration: 0.22 }}
      className="group relative grid grid-cols-[24px_minmax(0,1fr)] md:grid-cols-[40px_minmax(0,1fr)] gap-x-2 gap-y-1 md:gap-5 py-4 md:py-5 md:pr-24 border-b border-rule last:border-b-0"
    >
      <div className="pt-3 md:pt-3.5">
        <Smallcaps>
          {String(index + 1).padStart(2, "0")}
        </Smallcaps>
      </div>

      <div className="min-w-0">
        <ChordStrip chords={chords} startTime={line.startTime} endTime={line.endTime} />
        <div className="font-serif-jp jp text-[22px] md:text-[28px] leading-[1.55] text-ink font-medium break-words">
          {line.tokens.length > 0 ? (
            line.tokens.map((t, i) => (
              <TokenChip
                key={i}
                token={t}
                open={openToken === i}
                onToggle={() => setOpenToken(openToken === i ? null : i)}
              />
            ))
          ) : (
            <span>{line.original}</span>
          )}
        </div>
        {line.romaji && (
          <div className="font-serif italic text-[13px] md:text-[15px] text-ink-soft mt-1.5 break-words">
            {line.romaji}
          </div>
        )}
        {line.translation && (
          <div className="font-serif text-[14px] md:text-[16px] text-ink mt-1 break-words">
            {line.translation}
          </div>
        )}
      </div>

      <div
        className={cn(
          "col-start-2 flex gap-1 mt-1 md:mt-0 md:absolute md:top-5 md:right-0",
          "opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100",
          "transition-opacity duration-200"
        )}
      >
        {canPlaySegment && (
          <button
            type="button"
            onClick={() => player?.playSegment(line.startTime, line.endTime)}
            aria-label="播放原唱片段"
            className="w-11 h-11 md:w-7 md:h-7 flex items-center justify-center text-ink-soft hover:text-red transition"
          >
            <Music4 className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        )}
        <button
          type="button"
          onClick={() => toggle(line.original)}
          aria-label={speaking ? "停止朗读" : "朗读本行"}
          className="w-11 h-11 md:w-7 md:h-7 flex items-center justify-center text-ink-soft hover:text-ink transition"
        >
          {speaking ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Volume2 className="w-3.5 h-3.5" strokeWidth={1.5} />
          )}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={
            copyState === "error"
              ? "复制失败"
              : copyState === "copied"
              ? "已复制"
              : "复制原文"
          }
          className="w-11 h-11 md:w-7 md:h-7 flex items-center justify-center text-ink-soft hover:text-ink transition"
        >
          {copyState === "copied" ? (
            <Check className="w-3.5 h-3.5 text-red" strokeWidth={1.5} />
          ) : copyState === "error" ? (
            <X className="w-3.5 h-3.5 text-red-soft" strokeWidth={1.5} />
          ) : (
            <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
          )}
        </button>
      </div>
    </motion.div>
  );
}

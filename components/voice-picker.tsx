"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2, Check, Loader2, Minus, Plus } from "lucide-react";
import {
  getSelectedVoiceName,
  setSelectedVoiceName,
  getSelectedRate,
  setSelectedRate,
  listJapaneseVoices,
  speak,
  VALID_RATES,
  type SpeakHandle,
  type ValidRate,
} from "@/lib/tts";
import { SERVER_VOICES } from "@/lib/tts-voices";
import { cn } from "@/lib/utils";
import { IconButton } from "./editorial-interactive";
import { Smallcaps } from "./editorial-shell";

const PREVIEW_TEXT = "こんにちは、音色のプレビューです。";

function formatRate(r: ValidRate): string {
  return Number.isInteger(r * 10) ? `${r.toFixed(1)}x` : `${r.toFixed(2)}x`;
}

export function VoicePicker() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(listJapaneseVoices);
  const [selected, setSelected] = useState<string | null>(getSelectedVoiceName);
  const [rate, setRate] = useState<ValidRate>(() => getSelectedRate(getSelectedVoiceName()));
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const previewHandleRef = useRef<SpeakHandle | null>(null);

  useEffect(() => {
    function load() {
      setVoices(listJapaneseVoices());
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", load);
    }
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.removeEventListener("voiceschanged", load);
      }
      // unmount 时取消进行中的 preview，避免 setState on unmounted
      previewHandleRef.current?.abort();
      previewHandleRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function pick(name: string | null) {
    setSelectedVoiceName(name);
    setSelected(name);
    // 切到目标 voice 时同步加载该 voice 的持久化 rate（首次为 DEFAULT_RATE）
    const nextRate = getSelectedRate(name);
    setRate(nextRate);
    setPreviewing(true);
    const handle = speak(PREVIEW_TEXT, nextRate);
    previewHandleRef.current = handle;
    handle.promise.finally(() => {
      // 仅当当前 handle 仍是本次启动的 → 关闭 spinner，防止旧 promise 覆盖新 preview
      if (previewHandleRef.current === handle) {
        setPreviewing(false);
      }
    });
  }

  function changeRate(next: ValidRate) {
    setSelectedRate(selected, next);
    setRate(next);
    setPreviewing(true);
    // 显式传 next 避免依赖 setState 异步导致 preview 用旧值
    const handle = speak(PREVIEW_TEXT, next);
    previewHandleRef.current = handle;
    handle.promise.finally(() => {
      if (previewHandleRef.current === handle) {
        setPreviewing(false);
      }
    });
  }

  const noBrowserVoice = voices.length === 0;

  return (
    <div ref={ref} className="relative">
      <IconButton
        aria-label="选择音色"
        title="选择音色"
        active={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Volume2 className="w-[14px] h-[14px]" strokeWidth={1.5} />
      </IconButton>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "absolute right-0 top-full mt-2 z-30",
              "w-72 max-w-[calc(100vw-2rem)] p-3",
              "bg-paper text-ink border border-ink shadow-[6px_6px_0_0_var(--rule)]"
            )}
          >
            <div className="flex items-center justify-between pb-2 border-b border-rule">
              <Smallcaps tone="ink">日语音色</Smallcaps>
              <Smallcaps>
                {noBrowserVoice
                  ? "浏览器无日语 · 用在线"
                  : `${voices.length} 本地可用`}
              </Smallcaps>
            </div>
            <div className="max-h-80 overflow-y-auto mt-1 scroll-y">
              <VoiceItem
                label="浏览器日语音色（自动选择）"
                onClick={() => pick(null)}
                active={!selected}
              />
              {voices.map((v) => (
                <VoiceItem
                  key={v.name}
                  label={v.name}
                  sub={v.localService === false ? "在线 · 高音质" : undefined}
                  onClick={() => pick(v.name)}
                  active={selected === v.name}
                />
              ))}

              <div className="mt-2 pt-2 border-t border-rule">
                <Smallcaps tone="ink">
                  在线 · Edge TTS
                </Smallcaps>
              </div>
              {SERVER_VOICES.map((v) => (
                <VoiceItem
                  key={v.name}
                  label={v.label}
                  sub={v.hint}
                  onClick={() => pick(v.name)}
                  active={selected === v.name}
                />
              ))}

            </div>
            <div className="pt-2 mt-1 border-t border-rule flex items-center justify-between gap-2">
              <Smallcaps tone="ink">速度</Smallcaps>
              <RateStepper rate={rate} onChange={changeRate} />
            </div>
            <div className="pt-1.5 mt-1 flex items-center gap-1.5">
              {previewing && <Loader2 className="w-3 h-3 animate-spin text-ink-mute" />}
              <Smallcaps>{previewing ? "合成中…" : "选中后立即播放预览句"}</Smallcaps>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RateStepper({
  rate,
  onChange,
}: {
  rate: ValidRate;
  onChange: (next: ValidRate) => void;
}) {
  const idx = VALID_RATES.indexOf(rate);
  const atMin = idx <= 0;
  const atMax = idx >= VALID_RATES.length - 1;
  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        aria-label="降低速度"
        title="降低速度"
        onClick={() => {
          if (!atMin) onChange(VALID_RATES[idx - 1]);
        }}
        disabled={atMin}
      >
        <Minus className="w-[14px] h-[14px]" strokeWidth={1.5} />
      </IconButton>
      <Smallcaps
        tone="ink"
        className="min-w-[3rem] text-center tabular"
      >
        {formatRate(rate)}
      </Smallcaps>
      <IconButton
        aria-label="提高速度"
        title="提高速度"
        onClick={() => {
          if (!atMax) onChange(VALID_RATES[idx + 1]);
        }}
        disabled={atMax}
      >
        <Plus className="w-[14px] h-[14px]" strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}

function VoiceItem({
  label,
  sub,
  onClick,
  active,
}: {
  label: string;
  sub?: string;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full px-2 py-2 text-left flex items-center justify-between gap-2 transition border-l-2",
        active
          ? "border-red bg-paper-deep"
          : "border-transparent hover:border-rule hover:bg-paper-deep/60"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="font-serif text-[14px] text-ink truncate">{label}</div>
        {sub && (
          <div className="font-mono text-[9px] tracking-wider uppercase text-ink-mute">
            {sub}
          </div>
        )}
      </div>
      {active && <Check className="w-3.5 h-3.5 text-red shrink-0" />}
    </button>
  );
}

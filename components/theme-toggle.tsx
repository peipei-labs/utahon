"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const PAPER_THEMES = [
  { id: "light", label: "生成", swatch: "#f5f1e8" },
  { id: "shironeri", label: "白練", swatch: "#f7f6f2" },
  { id: "koke", label: "苔色", swatch: "#eef0ea" },
  { id: "dark", label: "夜色", swatch: "#141210" },
] as const;

const subscribe = () => () => {};

function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}

export function ThemeToggle() {
  const mounted = useMounted();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="主题配色"
      className="flex items-center gap-1 md:gap-1.5"
    >
      {PAPER_THEMES.map((t) => {
        const active = mounted && resolvedTheme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            aria-label={`切换到${t.label}主题`}
            aria-pressed={active}
            title={t.label}
            onClick={() => setTheme(t.id)}
            style={{ backgroundColor: t.swatch }}
            className={cn(
              "w-4 h-4 md:w-[18px] md:h-[18px] rounded-full border transition shrink-0 cursor-pointer",
              active
                ? "border-ink ring-1 ring-ink ring-offset-2 ring-offset-paper"
                : "border-rule hover:border-ink-mute"
            )}
          />
        );
      })}
    </div>
  );
}

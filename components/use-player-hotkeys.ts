"use client";

import { useEffect, useRef } from "react";
import { usePlayer } from "./player-context";

const SEEK_STEP_SEC = 5;

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], button, a, dialog[open]'
    )
  );
}

export function usePlayerHotkeys(): void {
  const player = usePlayer();
  const playerRef = useRef(player);
  const loopStartRef = useRef<number | null>(null);

  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const current = playerRef.current;
      if (!current?.available) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Holding a toggle key (Space/L/A/B) must not re-trigger on key
      // auto-repeat; arrows keep repeat for continuous seeking.
      if (
        event.repeat &&
        event.code !== "ArrowLeft" &&
        event.code !== "ArrowRight"
      )
        return;
      if (isInteractiveTarget(event.target)) return;

      switch (event.code) {
        case "Space":
          event.preventDefault();
          if (current.playing) current.pause();
          else current.play();
          break;
        case "ArrowLeft":
          event.preventDefault();
          current.seekTo(current.currentTime - SEEK_STEP_SEC);
          break;
        case "ArrowRight":
          event.preventDefault();
          current.seekTo(current.currentTime + SEEK_STEP_SEC);
          break;
        case "KeyL":
          if (current.loopRange) current.setLoopEnabled(!current.loopEnabled);
          break;
        case "KeyA":
          loopStartRef.current = current.currentTime;
          break;
        case "KeyB": {
          const start = loopStartRef.current;
          if (start !== null && current.currentTime > start) {
            current.setLoopRange({
              startTime: start,
              endTime: current.currentTime,
            });
            current.setLoopEnabled(true);
          }
          break;
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}

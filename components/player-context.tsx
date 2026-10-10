"use client";

import { createContext, useContext } from "react";
import type { PracticeTrack } from "@/types/practice";

export type TrackMixSetting = {
  volume: number;
  muted: boolean;
  solo: boolean;
};

export type PlayerContextValue = {
  available: boolean;
  source: "local" | "youtube";
  availableSources: Array<"local" | "youtube">;
  selectSource: (source: "local" | "youtube") => void;
  currentTime: number;
  duration: number;
  playbackRate: number;
  availableRates: number[];
  playing: boolean;
  loopRange: { startTime: number; endTime: number } | null;
  loopEnabled: boolean;
  paddingSec: number;
  trackMix: Record<PracticeTrack, TrackMixSetting>;
  play: () => void;
  pause: () => void;
  seekTo: (time: number) => void;
  playSegment: (startTime: number, endTime: number, loop?: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setLoopRange: (range: { startTime: number; endTime: number } | null) => void;
  setLoopEnabled: (enabled: boolean) => void;
  setPaddingSec: (padding: number) => void;
  setTrackVolume: (track: PracticeTrack, volume: number) => void;
  toggleTrackMute: (track: PracticeTrack) => void;
  toggleTrackSolo: (track: PracticeTrack) => void;
};

export const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue | null {
  return useContext(PlayerContext);
}

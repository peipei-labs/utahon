"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import YouTube, { type YouTubeEvent, type YouTubePlayer } from "react-youtube";
import { AudioLines, Pause, Play } from "lucide-react";
import { PlayerContext, type PlayerContextValue } from "./player-context";
import { SongInfoProvider } from "./song-info-context";
import { usePractice } from "./practice-context";
import { formatDuration } from "./editorial-shell";
import { cn } from "@/lib/utils";
import type { PracticeTrack } from "@/types/practice";

const STEM_TRACKS: PracticeTrack[] = ["vocals", "drums", "bass", "other"];
const LOCAL_RATES = [0.25, 0.5, 0.6, 0.75, 0.8, 0.9, 1];
const DEFAULT_TRACK_MIX: PlayerContextValue["trackMix"] = {
  mix: { volume: 1, muted: false, solo: false },
  vocals: { volume: 1, muted: false, solo: false },
  drums: { volume: 1, muted: false, solo: false },
  bass: { volume: 1, muted: false, solo: false },
  other: { volume: 1, muted: false, solo: false },
};

type InternalCtx = {
  setYoutubePlayer: (player: YouTubePlayer | null) => void;
  releaseYoutubePlayer: () => void;
  setLocalAudio: (track: PracticeTrack, element: HTMLAudioElement | null) => void;
  reportPlaybackRate: (rate: number) => void;
  setPlaying: (playing: boolean) => void;
  handlePlaybackEnded: () => void;
  durationSec: number;
  videoId: string;
  source: "local" | "youtube";
  tracks: PracticeTrack[];
};

const PlayerPlateCtx = createContext<InternalCtx | null>(null);

function clampTime(value: number, duration: number): number {
  return Math.max(0, Math.min(value, duration > 0 ? duration : Number.MAX_SAFE_INTEGER));
}

export function clampPlaybackRate(rate: number): number {
  return Number.isFinite(rate) ? Math.max(0.25, Math.min(2, rate)) : 1;
}

function setElementVolume(element: HTMLAudioElement, volume: number): void {
  element.volume = volume;
}

export function SongPlayerProvider({
  songId,
  songTitle,
  videoId,
  durationSec,
  children,
}: {
  songId: string;
  songTitle: string;
  videoId: string;
  durationSec: number;
  children: ReactNode;
}) {
  const { practice } = usePractice();
  const [sourceChoice, setSourceChoice] = useState<{ videoId: string; source: "local" | "youtube" } | null>(null);
  const source = !practice.hasAudio ? "youtube" : !videoId ? "local"
    : sourceChoice?.videoId === videoId ? sourceChoice.source : "youtube";
  const availableSources = useMemo<Array<"local" | "youtube">>(
    () => [...(videoId ? ["youtube" as const] : []), ...(practice.hasAudio ? ["local" as const] : [])],
    [practice.hasAudio, videoId]
  );
  const stemSet = new Set(practice.data.stems);
  const hasFourStems = STEM_TRACKS.every((track) => stemSet.has(track));
  const tracks = useMemo<PracticeTrack[]>(
    () => (source === "local" ? (hasFourStems ? STEM_TRACKS : ["mix"]) : []),
    [hasFourStems, source]
  );
  const youtubeRef = useRef<YouTubePlayer | null>(null);
  const audioRefs = useRef(new Map<PracticeTrack, HTMLAudioElement>());
  const activeRangeRef = useRef<{ startTime: number; endTime: number } | null>(null);
  const loopEnabledRef = useRef(false);
  const paddingRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSec);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [availableRates, setAvailableRates] = useState<number[]>(LOCAL_RATES);
  const [playing, setPlaying] = useState(false);
  const [loopRange, setLoopRangeState] = useState<{ startTime: number; endTime: number } | null>(null);
  const [loopEnabled, setLoopEnabledState] = useState(false);
  const [paddingSec, setPaddingSecState] = useState(0);
  const [trackMix, setTrackMix] = useState(DEFAULT_TRACK_MIX);
  const available = source === "local" || Boolean(videoId);

  useEffect(() => {
    activeRangeRef.current = loopRange;
  }, [loopRange]);

  useEffect(() => {
    loopEnabledRef.current = loopEnabled;
  }, [loopEnabled]);

  useEffect(() => {
    paddingRef.current = paddingSec;
  }, [paddingSec]);

  const localElements = useCallback(() => Array.from(audioRefs.current.values()), []);

  const seekTo = useCallback(
    (time: number) => {
      const target = clampTime(time, duration);
      if (source === "local") {
        for (const audio of localElements()) audio.currentTime = target;
      } else {
        youtubeRef.current?.seekTo(target, true);
      }
      setCurrentTime(target);
    },
    [duration, localElements, source]
  );

  const play = useCallback(() => {
    if (source === "local") {
      for (const audio of localElements()) void audio.play();
    } else {
      youtubeRef.current?.playVideo();
    }
    setPlaying(true);
  }, [localElements, source]);

  const pause = useCallback(() => {
    if (source === "local") {
      for (const audio of localElements()) audio.pause();
    } else {
      youtubeRef.current?.pauseVideo();
    }
    setPlaying(false);
  }, [localElements, source]);

  const selectSource = useCallback((nextSource: "local" | "youtube") => {
    pause();
    setSourceChoice({ videoId, source: nextSource });
  }, [pause, videoId]);

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const safeRate = clampPlaybackRate(rate);
      if (source === "local") {
        for (const audio of localElements()) {
          audio.playbackRate = safeRate;
          audio.preservesPitch = true;
        }
      } else {
        youtubeRef.current?.setPlaybackRate(safeRate);
      }
      setPlaybackRateState(safeRate);
    },
    [localElements, source]
  );

  const setLoopRange = useCallback((range: { startTime: number; endTime: number } | null) => {
    activeRangeRef.current = range;
    setLoopRangeState(range);
  }, []);

  const setLoopEnabled = useCallback((enabled: boolean) => {
    loopEnabledRef.current = enabled;
    setLoopEnabledState(enabled);
  }, []);

  const setPaddingSec = useCallback((padding: number) => {
    const safe = [0, 0.5, 1, 2].includes(padding) ? padding : 0;
    paddingRef.current = safe;
    setPaddingSecState(safe);
  }, []);

  const setTrackVolume = useCallback((track: PracticeTrack, volume: number) => {
    const safeVolume = Math.max(0, Math.min(1, volume));
    setTrackMix((current) => ({
      ...current,
      [track]: { ...current[track], volume: safeVolume },
    }));
  }, []);

  const toggleTrackMute = useCallback((track: PracticeTrack) => {
    setTrackMix((current) => ({
      ...current,
      [track]: { ...current[track], muted: !current[track].muted },
    }));
  }, []);

  const toggleTrackSolo = useCallback((track: PracticeTrack) => {
    setTrackMix((current) => ({
      ...current,
      [track]: { ...current[track], solo: !current[track].solo },
    }));
  }, []);

  const playSegment = useCallback(
    (startTime: number, endTime: number, loop = false) => {
      if (endTime <= startTime) return;
      const range = { startTime, endTime };
      activeRangeRef.current = range;
      loopEnabledRef.current = loop;
      setLoopRangeState(range);
      setLoopEnabledState(loop);
      seekTo(Math.max(0, startTime - paddingRef.current));
      play();
    },
    [play, seekTo]
  );

  const handlePlaybackEnded = useCallback(() => {
    const range = activeRangeRef.current;
    if (range && loopEnabledRef.current) {
      seekTo(Math.max(0, range.startTime - paddingRef.current));
      play();
    } else {
      activeRangeRef.current = null;
      setLoopRangeState(null);
      pause();
    }
  }, [pause, play, seekTo]);

  const setYoutubePlayer = useCallback(
    (player: YouTubePlayer | null) => {
      youtubeRef.current = player;
      if (!player) return;
      const rates = player.getAvailablePlaybackRates?.() as number[] | undefined;
      setAvailableRates(rates?.length ? rates : [0.5, 0.75, 1]);
      const playerDuration = Number(player.getDuration?.() ?? 0);
      if (playerDuration > 0) setDuration(playerDuration);
      player.setPlaybackRate(playbackRate);
    },
    [playbackRate]
  );

  const reportPlaybackRate = useCallback((rate: number) => {
    if (Number.isFinite(rate) && rate > 0) setPlaybackRateState(rate);
  }, []);

  const releaseYoutubePlayer = useCallback(() => {
    youtubeRef.current = null;
  }, []);

  const setLocalAudio = useCallback(
    (track: PracticeTrack, element: HTMLAudioElement | null) => {
      if (element) {
        element.playbackRate = playbackRate;
        element.preservesPitch = true;
        audioRefs.current.set(track, element);
      } else {
        audioRefs.current.delete(track);
      }
    },
    [playbackRate]
  );

  useEffect(() => {
    const anySolo = tracks.some((track) => trackMix[track].solo);
    for (const [track, audio] of audioRefs.current) {
      const setting = trackMix[track];
      setElementVolume(audio, setting.muted || (anySolo && !setting.solo) ? 0 : setting.volume);
    }
  }, [trackMix, tracks]);

  const restoreTrackPlayback = useEffectEvent(() => {
    if (source !== "local") return;
    for (const audio of localElements()) {
      audio.currentTime = currentTime;
      if (playing) void audio.play().catch(() => pause());
    }
  });
  useEffect(() => { restoreTrackPlayback(); }, [tracks]);

  useEffect(() => {
    const youtube = youtubeRef.current;
    if (youtube?.getIframe?.()?.isConnected) youtube.pauseVideo();
    for (const audio of localElements()) {
      audio.pause();
      audio.currentTime = 0;
    }
    activeRangeRef.current = null;
    loopEnabledRef.current = false;
    const reset = window.setTimeout(() => {
      setAvailableRates(source === "local" ? LOCAL_RATES : [0.5, 0.75, 1]);
      setCurrentTime(0);
      setDuration(durationSec);
      setPlaying(false);
      setLoopRangeState(null);
      setLoopEnabledState(false);
    }, 0);
    return () => window.clearTimeout(reset);
  }, [durationSec, localElements, practice.audioSha256, source, videoId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      let time = 0;
      let nextDuration = duration;
      if (source === "local") {
        const primary = audioRefs.current.get(tracks[0]);
        if (!primary) return;
        time = primary.currentTime;
        if (Number.isFinite(primary.duration) && primary.duration > 0) nextDuration = primary.duration;
        for (const [track, audio] of audioRefs.current) {
          if (track === tracks[0] || audio.paused) continue;
          if (Math.abs(audio.currentTime - time) > 0.04) audio.currentTime = time;
        }
      } else {
        const player = youtubeRef.current;
        if (!player) return;
        time = Number(player.getCurrentTime?.() ?? 0);
        const playerDuration = Number(player.getDuration?.() ?? 0);
        if (playerDuration > 0) nextDuration = playerDuration;
      }
      setCurrentTime((previous) => (Math.abs(previous - time) >= 0.04 ? time : previous));
      if (nextDuration !== duration && nextDuration > 0) setDuration(nextDuration);

      const range = activeRangeRef.current;
      if (!range || !playing) return;
      const end = Math.min(nextDuration || Number.MAX_SAFE_INTEGER, range.endTime + paddingRef.current);
      if (time < end - 0.04) return;
      if (loopEnabledRef.current) {
        seekTo(Math.max(0, range.startTime - paddingRef.current));
        play();
      } else {
        activeRangeRef.current = null;
        setLoopRangeState(null);
        pause();
      }
    }, 80);
    return () => window.clearInterval(interval);
  }, [duration, pause, play, playing, seekTo, source, tracks]);

  const playerValue = useMemo<PlayerContextValue>(
    () => ({
      available,
      source,
      availableSources,
      selectSource,
      currentTime,
      duration,
      playbackRate,
      availableRates,
      playing,
      loopRange,
      loopEnabled,
      paddingSec,
      trackMix,
      play,
      pause,
      seekTo,
      playSegment,
      setPlaybackRate,
      setLoopRange,
      setLoopEnabled,
      setPaddingSec,
      setTrackVolume,
      toggleTrackMute,
      toggleTrackSolo,
    }),
    [
      available,
      availableSources,
      availableRates,
      currentTime,
      duration,
      loopEnabled,
      loopRange,
      paddingSec,
      pause,
      play,
      playing,
      playSegment,
      playbackRate,
      seekTo,
      selectSource,
      setLoopEnabled,
      setLoopRange,
      setPaddingSec,
      setPlaybackRate,
      setTrackVolume,
      source,
      toggleTrackMute,
      toggleTrackSolo,
      trackMix,
    ]
  );

  const internalValue = useMemo<InternalCtx>(
    () => ({
      setYoutubePlayer,
      releaseYoutubePlayer,
      setLocalAudio,
      reportPlaybackRate,
      setPlaying,
      handlePlaybackEnded,
      durationSec: duration,
      videoId,
      source,
      tracks,
    }),
    [duration, handlePlaybackEnded, releaseYoutubePlayer, reportPlaybackRate, setLocalAudio, setYoutubePlayer, source, tracks, videoId]
  );

  return (
    <PlayerContext.Provider value={playerValue}>
      <SongInfoProvider songId={songId} songTitle={songTitle}>
        <PlayerPlateCtx.Provider value={internalValue}>{children}</PlayerPlateCtx.Provider>
      </SongInfoProvider>
    </PlayerContext.Provider>
  );
}

export function EditorialPlayerPlate({
  className,
  compact = false,
  emptyFallback = null,
}: {
  className?: string;
  compact?: boolean;
  emptyFallback?: ReactNode;
}) {
  const ctx = useContext(PlayerPlateCtx);
  const player = useContext(PlayerContext);
  if (!ctx || !player) return null;
  if (!player.available) return emptyFallback;
  return (
    <div className={className}>
      {player.availableSources.length > 1 ? (
        <div className="mb-2">
          <div className="flex gap-2" aria-label="播放来源">
            {player.availableSources.map((source) => (
              <button key={source} type="button" aria-pressed={source === player.source}
                onClick={() => player.selectSource(source)}
                className={cn("border px-2 py-1 text-[12px]", source === player.source ? "border-ink bg-ink text-paper" : "border-rule text-ink-soft")}>
                {source === "youtube" ? "YouTube" : "练习音频"}
              </button>
            ))}
          </div>
          {player.source === "local" ? (
            <p className="mt-1 text-[11px] text-ink-soft">正在播放已保存的练习音频；请确认它与当前歌词是同一版本。</p>
          ) : null}
        </div>
      ) : null}
      {ctx.source === "local" ? (
        <LocalPracticePlate compact={compact} ctx={ctx} player={player} />
      ) : (
        <YoutubePlate compact={compact} ctx={ctx} player={player} />
      )}
    </div>
  );
}

function LocalPracticePlate({
  className,
  compact,
  ctx,
  player,
}: {
  className?: string;
  compact: boolean;
  ctx: InternalCtx;
  player: PlayerContextValue;
}) {
  const { practice } = usePractice();
  const progress = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;
  return (
    <div className={cn("w-full", className)}>
      {ctx.tracks.map((track) => (
        <audio
          key={`${practice.audioSha256}-${track}`}
          ref={(element) => ctx.setLocalAudio(track, element)}
          src={`/api/songs/${practice.songId}/practice/audio/${track}?v=${practice.audioSha256}`}
          preload={track === ctx.tracks[0] ? "metadata" : "auto"}
          onPlay={() => { if (track === ctx.tracks[0]) ctx.setPlaying(true); }}
          onPause={(event) => {
            if (track === ctx.tracks[0] && event.currentTarget.paused && !event.currentTarget.ended) {
              ctx.setPlaying(false);
            }
          }}
          onEnded={(event) => {
            if (track === ctx.tracks[0] && event.currentTarget.ended) ctx.handlePlaybackEnded();
          }}
        />
      ))}
      <div className="relative aspect-video bg-ink border border-ink overflow-hidden text-paper p-5 flex flex-col justify-between">
        <div className="absolute inset-0 opacity-[0.16]" style={{
          backgroundImage: "linear-gradient(135deg, transparent 48%, rgba(255,255,255,.2) 49%, transparent 50%)",
          backgroundSize: "18px 18px",
        }} />
        <div className="relative flex items-center justify-between font-mono text-[9px] tracking-[0.2em] uppercase opacity-75">
          <span>Practice audio</span>
          <span>{ctx.tracks.length > 1 ? "4 stems" : "original mix"}</span>
        </div>
        <div className="relative flex items-center gap-4">
          <button
            type="button"
            onClick={player.playing ? player.pause : player.play}
            className="w-14 h-14 rounded-full border border-paper flex items-center justify-center hover:bg-paper/10 transition"
            aria-label={player.playing ? "暂停练习音频" : "播放练习音频"}
          >
            {player.playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>
          <div>
            <AudioLines className="w-5 h-5 mb-2 opacity-75" />
            <div className="font-serif italic text-[20px] leading-none">弹唱练习</div>
            <div className="font-mono text-[9px] tracking-[0.14em] uppercase mt-2 opacity-65">
              pitch preserved · {player.playbackRate.toFixed(2)}×
            </div>
          </div>
        </div>
        <button
          type="button"
          className="relative h-7 w-full flex items-center"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            player.seekTo(((event.clientX - rect.left) / rect.width) * player.duration);
          }}
          aria-label="跳转练习音频"
        >
          <span className="absolute inset-x-0 h-px bg-paper/30" />
          <span className="absolute left-0 h-px bg-paper" style={{ width: `${progress}%` }} />
          <span className="absolute w-2 h-2 rounded-full bg-paper -translate-x-1/2" style={{ left: `${progress}%` }} />
        </button>
      </div>
      {!compact ? <PlayerClock player={player} /> : null}
    </div>
  );
}

function YoutubePlate({
  className,
  compact,
  ctx,
  player,
}: {
  className?: string;
  compact: boolean;
  ctx: InternalCtx;
  player: PlayerContextValue;
}) {
  const [ready, setReadyState] = useState(false);
  const [playerKey, setPlayerKey] = useState(0);
  const retryCount = useRef(0);
  const readyRef = useRef(false);
  const lastReloadAtRef = useRef(0);
  const { releaseYoutubePlayer } = ctx;

  useEffect(() => () => releaseYoutubePlayer(), [releaseYoutubePlayer]);

  const setReady = useCallback((value: boolean) => {
    readyRef.current = value;
    setReadyState(value);
  }, []);

  const reload = useCallback(() => {
    ctx.setYoutubePlayer(null);
    setReady(false);
    setPlayerKey((value) => value + 1);
  }, [ctx, setReady]);

  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  useEffect(() => {
    const PROBE_INTERVAL_MS = 5000;
    const PROBE_TIMEOUT_MS = 3000;
    const PROBE_THROTTLE_MS = 3000;
    const RELOAD_COOLDOWN_MS = 20000;
    let lastProbeAt = 0;
    let cancelled = false;
    let inFlight: AbortController | null = null;

    const probe = () => {
      if (readyRef.current) return;
      const now = Date.now();
      if (now - lastProbeAt < PROBE_THROTTLE_MS) return;
      lastProbeAt = now;
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      fetch("https://www.youtube.com/iframe_api", {
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal,
      })
        .then(() => {
          if (cancelled || readyRef.current) return;
          if (Date.now() - lastReloadAtRef.current < RELOAD_COOLDOWN_MS) return;
          lastReloadAtRef.current = Date.now();
          retryCount.current = 0;
          reloadRef.current();
        })
        .catch(() => undefined)
        .finally(() => {
          window.clearTimeout(timeoutId);
          if (inFlight === controller) inFlight = null;
        });
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") probe();
    };
    window.addEventListener("online", probe);
    window.addEventListener("focus", probe);
    window.addEventListener("pageshow", probe);
    document.addEventListener("visibilitychange", handleVisibility);
    const interval = window.setInterval(probe, PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      inFlight?.abort();
      window.removeEventListener("online", probe);
      window.removeEventListener("focus", probe);
      window.removeEventListener("pageshow", probe);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return (
    <div className={cn("w-full", className)}>
      <div className="relative aspect-video bg-ink border border-ink overflow-hidden">
        <YouTube
          key={playerKey}
          videoId={ctx.videoId}
          className="w-full h-full relative z-[1]"
          iframeClassName="w-full h-full"
          opts={{
            width: "100%",
            height: "100%",
            playerVars: { controls: 1, modestbranding: 1, rel: 0, playsinline: 1, cc_load_policy: 0 },
          }}
          onReady={(event: YouTubeEvent) => {
            retryCount.current = 0;
            ctx.setYoutubePlayer(event.target);
            setReady(true);
          }}
          onStateChange={(event: YouTubeEvent) => {
            if (event.data === 0) ctx.handlePlaybackEnded();
            else ctx.setPlaying(event.data === 1);
          }}
          onPlaybackRateChange={(event: YouTubeEvent) => ctx.reportPlaybackRate(Number(event.data))}
          onError={() => {
            if (retryCount.current < 2) {
              retryCount.current += 1;
              reload();
            } else {
              ctx.setYoutubePlayer(null);
              setReady(false);
            }
          }}
        />
        {!ready ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-paper z-[2]">
            <button
              type="button"
              onClick={() => {
                retryCount.current = 0;
                lastReloadAtRef.current = Date.now();
                reload();
              }}
              className="w-11 h-11 border border-paper rounded-full flex items-center justify-center hover:bg-paper/10 transition"
              aria-label="重新加载播放器"
            >
              <Play className="w-4 h-4 ml-0.5" />
            </button>
            <div className="font-mono text-[10px] tracking-[0.2em] uppercase opacity-80">YT · {ctx.videoId}</div>
          </div>
        ) : null}
      </div>
      {!compact ? <PlayerClock player={player} /> : null}
    </div>
  );
}

function PlayerClock({ player }: { player: PlayerContextValue }) {
  return (
    <div className="flex justify-between items-center font-mono text-[10px] tracking-[0.08em] text-ink-mute mt-1.5 tabular">
      <span>{formatDuration(player.currentTime)}</span>
      <span className="text-rule flex-1 text-center">━━━━━━━━━━━━</span>
      <span>{formatDuration(player.duration)}</span>
    </div>
  );
}

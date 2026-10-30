import Link from "next/link";
import { notFound } from "next/navigation";
import { Mic } from "lucide-react";
import { getSong } from "@/lib/songs";
import { getPractice } from "@/lib/practice";
import { LyricLine } from "@/components/lyric-line";
import { ThemeToggle } from "@/components/theme-toggle";
import { VoicePicker } from "@/components/voice-picker";
import { DeleteSongButton } from "@/components/delete-song-button";
import { RetranscribeButton } from "@/components/retranscribe-button";
import { SongEditor } from "@/components/song-editor";
import {
  SongPlayerProvider,
  EditorialPlayerPlate,
} from "@/components/youtube-player";
import {
  Colophon,
  DesktopNav,
  Masthead,
  MobileTopBar,
  PageFrame,
  Smallcaps,
  formatDuration,
} from "@/components/editorial-shell";
import { TabBar, TextPill } from "@/components/editorial-interactive";
import { PracticeProvider } from "@/components/practice-context";
import { PracticeStudio } from "@/components/practice-studio";
import { ScoreSources } from "@/components/score-sources";

export const dynamic = "force-dynamic";

export default async function SongPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const song = getSong(id);
  if (!song) notFound();
  const practice = getPractice(id);
  if (!practice) notFound();

  const videoId = song.analyzed.youtubeId || song.youtubeId || "";
  const isEmpty = song.analyzed.lines.length === 0;
  const songYear = new Date(song.createdAt).getFullYear();

  return (
    <PageFrame>
      <MobileTopBar
        title="歌本"
        right={
          <>
            <VoicePicker />
            <ThemeToggle />
          </>
        }
      />

      <div className="hidden md:block">
        <Masthead
          title="歌本"
          sub="Song · annotated line by line."
          right={
            <DesktopNav
              items={[
                { href: "/", label: "Library", active: true },
                { href: "/vocabulary", label: "Vocabulary" },
                { href: "/import", label: "Import" },
              ]}
              trailing={
                <span className="flex items-center gap-2 ml-3 pl-3 border-l border-rule">
                  <VoicePicker />
                  <ThemeToggle />
                </span>
              }
            />
          }
        />
      </div>

      <div className="flex justify-between items-center py-2.5 md:py-3 border-b border-rule gap-3">
        <Link
          href="/"
          className="font-mono text-[10px] md:text-[11px] tracking-[0.18em] uppercase text-ink-soft hover:text-ink transition shrink-0"
        >
          ← {` `}Utahon / Library
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <RetranscribeButton songId={song.id} updatedAt={song.updatedAt}
            currentSourceUrl={song.analyzed.youtubeUrl || song.analyzed.transcriptionSourceUrl || ""}
            hasPracticeAudio={practice.hasAudio} />
          <DeleteSongButton songId={song.id} songTitle={song.title} />
        </div>
      </div>

      <PracticeProvider initialPractice={practice}>
        <SongPlayerProvider
          songId={song.id}
          songTitle={song.title}
          videoId={videoId}
          durationSec={song.durationSec}
        >
        {/* cover */}
        <section className="grid md:grid-cols-[1fr_340px] gap-7 md:gap-12 mt-7 md:mt-10">
          <div className="min-w-0">
            <Smallcaps>
              Song · {song.artist || "Unknown"} · {songYear}
            </Smallcaps>
            <h1 className="jp font-serif-jp font-medium text-[40px] md:text-[62px] leading-[1.08] tracking-[-0.005em] mt-2 md:mt-3 text-ink break-words">
              {song.title}
            </h1>
            {song.analyzed.lines[0]?.translation && (
              <div className="font-serif italic text-[17px] md:text-[22px] text-ink-soft mt-2 md:mt-3">
                &ldquo;{song.analyzed.lines[0].translation}&rdquo;
              </div>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-4 md:mt-5 font-mono text-[10px] md:text-[11px] tracking-[0.14em] uppercase text-ink-soft">
              <span>{song.artist || "Unknown"}</span>
              {song.originalArtist &&
                song.originalArtist !== song.artist && (
                  <>
                    <span>·</span>
                    <span>Orig. {song.originalArtist}</span>
                  </>
                )}
              <span>·</span>
              <span>{song.linesCount} lines</span>
              {song.durationSec > 0 && (
                <>
                  <span>·</span>
                  <span>{formatDuration(song.durationSec)}</span>
                </>
              )}
            </div>
          </div>

          <div className="md:sticky md:top-5 md:self-start flex flex-col gap-4">
            <EditorialPlayerPlate
              emptyFallback={
                <div className="p-4 border border-dashed border-rule text-center">
                  <Smallcaps>No video attached</Smallcaps>
                  <div className="font-serif italic text-[14px] text-ink-soft mt-2 leading-[1.5]">
                    没有可内嵌播放的 YouTube 来源。可在下方练习台从 YouTube / Bilibili 视频取得音频，或上传音频文件。
                  </div>
                  <div className="mt-3">
                    <ExternalAudioLinks
                      title={song.title}
                      artist={song.artist}
                    />
                  </div>
                </div>
              }
            />
            <aside className="hidden md:block p-4 border border-rule bg-paper-deep/60">
              <Smallcaps>Editor&rsquo;s note</Smallcaps>
              <p className="font-serif italic text-[14px] text-ink-soft mt-1.5 leading-[1.55]">
                Rin 将罗马音、中文、词性三层合一标注。点任一词可查看释义或一键收藏到词汇本。
              </p>
            </aside>
          </div>
        </section>

        <SongEditor key={song.id} songId={song.id} lyrics={song.lyrics}
          youtubeUrl={song.analyzed.youtubeUrl} updatedAt={song.updatedAt} />
        {song.analyzed.transcriptionSourceUrl?.includes("bilibili.com") && (
          <p className="mt-2 text-sm text-ink-soft">
            当前来源为 Bilibili，不能在此内嵌视频；可在下方「从视频取得音频」保存同版音频练习，或前往
            {" "}<a href={song.analyzed.transcriptionSourceUrl} target="_blank" rel="noopener noreferrer" className="underline">原视频</a>。
          </p>
        )}

        <ScoreSources song={{ title: song.title, artist: song.artist, originalArtist: song.originalArtist }} />

        <PracticeStudio
          title={song.title}
          artist={song.artist}
          lines={song.analyzed.lines}
          sourceUrl={song.analyzed.youtubeUrl || song.analyzed.transcriptionSourceUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "")}
          songUpdatedAt={song.updatedAt}
        />

        {/* lyrics */}
        {isEmpty ? (
          <EmptyLyrics hasYoutube={Boolean(videoId)} />
        ) : (
          <section className="grid md:grid-cols-[180px_1fr] gap-6 md:gap-10 mt-10 md:mt-14">
            <aside className="md:sticky md:top-6 md:self-start hidden md:block">
              <Smallcaps tone="ink">Lyrics</Smallcaps>
              <div className="font-serif italic text-[28px] leading-[1.08] text-ink mt-2">
                Annotated
                <br />
                line by line
              </div>
              <div className="mt-6 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute leading-[1.75]">
                Tap any word
                <br />
                to reveal meaning
                <br />
                · save to vocab
              </div>
            </aside>
            <div>
              <div className="md:hidden flex items-baseline justify-between pb-2.5 mb-2 border-b border-ink">
                <Smallcaps tone="ink">Lyrics · annotated</Smallcaps>
                <span className="font-serif italic text-[12px] text-ink-soft">
                  tap · hold to save
                </span>
              </div>
              {song.analyzed.lines.map((line, i) => (
                <LyricLine key={i} line={line} index={i} />
              ))}
            </div>
          </section>
        )}
        </SongPlayerProvider>
      </PracticeProvider>

      <Colophon>
        <span>Song · {song.artist || "Unknown"}</span>
        <span className="text-center">
          —— {song.linesCount} lines ——
        </span>
        <span className="hidden sm:inline text-right">
          lrclib · gemini · yt-dlp
        </span>
      </Colophon>

      <TabBar />
    </PageFrame>
  );
}

function ExternalAudioLinks({
  title,
  artist,
}: {
  title: string;
  artist: string;
}) {
  const q = encodeURIComponent([artist, title].filter(Boolean).join(" ").trim());
  const links = [
    { label: "QQ 音乐", url: `https://y.qq.com/n/ryqq/search?w=${q}` },
    { label: "网易云", url: `https://music.163.com/#/search/m/?s=${q}` },
    { label: "Apple", url: `https://music.apple.com/search?term=${q}` },
    { label: "Spotify", url: `https://open.spotify.com/search/${q}` },
  ];
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 border border-rule px-2.5 py-1 font-mono text-[9px] tracking-[0.18em] uppercase text-ink-soft hover:border-ink hover:text-ink transition whitespace-nowrap"
        >
          🎵 {l.label}
        </a>
      ))}
    </div>
  );
}

function EmptyLyrics({ hasYoutube }: { hasYoutube: boolean }) {
  return (
    <section className="mt-10 md:mt-14 border border-rule bg-paper-deep/40 p-8 md:p-12 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 border border-ink mb-4">
        <Mic className="w-5 h-5 text-red" strokeWidth={1.5} />
      </div>
      <div className="font-serif italic text-[24px] md:text-[30px] leading-[1.15] text-ink">
        还没有歌词的说
      </div>
      <p className="font-serif text-[14px] md:text-[15px] text-ink-soft mt-3 max-w-md mx-auto leading-[1.55]">
        {hasYoutube
          ? "尚无匹配歌词。可用上方「音频转录」听音生成草稿，或在「纠错歌词」粘贴已核对的歌词。"
          : "可在「纠错歌词」直接粘贴歌词，或点击「音频转录」提供 YouTube / BV 来源，不用重新建档。"}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <TextPill href="/new" tone="solid">
          New song
        </TextPill>
        <TextPill href="/import">Batch import</TextPill>
      </div>
      <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-6">
        AI 转录可能听错，完成后请人工校对
      </div>
    </section>
  );
}

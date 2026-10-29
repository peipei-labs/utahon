import Link from "next/link";
import { Plus } from "lucide-react";
import type { SongFull } from "@/types/lyrics";
import { listSongs, getSong } from "@/lib/songs";
import {
  Masthead,
  MobileTopBar,
  PageFrame,
  Smallcaps,
  DesktopNav,
  Colophon,
  formatDuration,
} from "@/components/editorial-shell";
import { TabBar, TextPill } from "@/components/editorial-interactive";
import { ThemeToggle } from "@/components/theme-toggle";
import { VoicePicker } from "@/components/voice-picker";
import { SongLibrary } from "@/components/song-library";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const songs = listSongs();
  const featuredMeta = songs[0] ?? null;
  const featured = featuredMeta ? getSong(featuredMeta.id) : null;
  const totalLines = songs.reduce((s, x) => s + x.linesCount, 0);

  return (
    <PageFrame>
      <MobileTopBar
        title="歌本"
        right={
          <>
            <VoicePicker />
            <ThemeToggle />
            <LogoutButton />
          </>
        }
      />

      <div className="hidden md:block">
        <Masthead
          title="歌本"
          sub="A songbook for learning Japanese through music."
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
                  <LogoutButton />
                  <TextPill
                    href="/new"
                    tone="solid"
                    icon={<Plus className="w-3 h-3" strokeWidth={1.5} />}
                  >
                    New
                  </TextPill>
                </span>
              }
            />
          }
        />
      </div>

      <div className="flex flex-wrap justify-between gap-2 py-2.5 md:py-3 border-b border-rule">
        <Smallcaps>
          {songs.length} songs · {totalLines} lines
        </Smallcaps>
        <Smallcaps className="hidden sm:inline">
          Filed by date · archived by artist
        </Smallcaps>
      </div>

      {featured ? <FeaturedBlock song={featured} /> : <EmptyHome />}

      {songs.length > 0 && (
        <SongLibrary songs={songs} total={songs.length} offset={2} coverSongId={featuredMeta?.id} />
      )}

      <Colophon>
        <span>Utahon · a private songbook</span>
        <span className="text-center">
          —— p.{songs.length.toString().padStart(2, "0")} ——
        </span>
        <span className="hidden sm:inline text-right">
          lrclib · gemini · yt-dlp
        </span>
      </Colophon>

      <TabBar />
    </PageFrame>
  );
}

function FeaturedBlock({ song }: { song: SongFull }) {
  const firstLine = song.analyzed.lines[0];
  const romaji = firstLine?.romaji;
  const foreword = song.analyzed.lines
    .slice(0, 3)
    .map((l) => l.translation?.trim() ?? "")
    .filter(Boolean)
    .join("")
    .replace(/[。.]{2,}/g, "。");

  return (
    <section className="grid md:grid-cols-[1.1fr_1fr] gap-7 md:gap-10 mt-8 md:mt-10">
      <Link href={`/song/${song.id}`} className="block group">
        <Smallcaps>This week · No. 01</Smallcaps>
        <h1 className="jp font-serif-jp font-medium text-[38px] md:text-[60px] leading-[1.08] tracking-[-0.005em] mt-3 md:mt-3.5 text-ink group-hover:text-red transition-colors">
          {song.title}
        </h1>
        {romaji && (
          <div className="font-serif italic text-[16px] md:text-[20px] text-ink-soft mt-2">
            {romaji}
          </div>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 md:gap-x-4 mt-4 md:mt-5 font-mono text-[10px] md:text-[11px] tracking-[0.14em] uppercase text-ink-soft">
          <span>{song.artist || "Unknown"}</span>
          {song.originalArtist && song.originalArtist !== song.artist && (
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
      </Link>

      <aside className="md:pl-7 md:border-l border-rule">
        <Smallcaps>Foreword · from the translation</Smallcaps>
        {foreword ? (
          <p className="font-serif text-[17px] md:text-[22px] leading-[1.45] mt-3 text-ink">
            <span className="font-serif italic text-[48px] md:text-[56px] font-medium text-red float-left leading-[0.88] mr-2 mt-1">
              {foreword.charAt(0)}
            </span>
            {foreword.slice(1)}
          </p>
        ) : (
          <p className="font-serif italic text-[15px] md:text-[17px] leading-[1.5] mt-3 text-ink-mute">
            译文还没有生成——去详情页用 🎤 重转 或 粘贴歌词后重新分析喵～
          </p>
        )}
        <div className="font-serif italic text-[12px] md:text-[13px] text-ink-mute border-t border-rule pt-2.5 mt-5">
          — transcribed from lrclib · annotated by Gemini
        </div>
      </aside>
    </section>
  );
}

function EmptyHome() {
  return (
    <section className="mt-14 md:mt-20 text-center border-y border-rule py-14 md:py-20">
      <Smallcaps>Fresh volume · nothing filed yet</Smallcaps>
      <div className="font-serif italic text-[30px] md:text-[44px] leading-[1.1] text-ink mt-4">
        A songbook for learning
        <br />
        Japanese through music.
      </div>
      <div className="mt-4 font-serif italic text-[15px] md:text-[17px] text-ink-soft">
        Paste a song URL and Rin will file it for you.
      </div>
      <div className="flex justify-center gap-2 mt-7">
        <TextPill href="/new" tone="solid">
          + New song
        </TextPill>
        <TextPill href="/import">Batch import</TextPill>
      </div>
    </section>
  );
}

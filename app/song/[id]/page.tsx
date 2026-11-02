import { notFound } from "next/navigation";
import { getSong } from "@/lib/songs";
import { getPractice } from "@/lib/practice";
import { SongPlayerProvider } from "@/components/youtube-player";
import { PageFrame } from "@/components/editorial-shell";
import { TabBar } from "@/components/editorial-interactive";
import { PracticeProvider } from "@/components/practice-context";
import { ScoreSources } from "@/components/score-sources";
import { SongStudy } from "@/components/song-study";

export const dynamic = "force-dynamic";

export default async function SongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const song = getSong(id);
  if (!song) notFound();
  const practice = getPractice(id);
  if (!practice) notFound();
  return (
    <PageFrame>
      <PracticeProvider initialPractice={practice}>
        <SongPlayerProvider songId={song.id} songTitle={song.title}
          videoId={song.analyzed.youtubeId || song.youtubeId || ""} durationSec={song.durationSec}>
          <SongStudy key={song.id} song={song}
            scoreSources={<ScoreSources song={{ title: song.title, artist: song.artist, originalArtist: song.originalArtist }} />}
            externalAudioLinks={<ExternalAudioLinks title={song.title} artist={song.artist} />} />
        </SongPlayerProvider>
      </PracticeProvider>
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

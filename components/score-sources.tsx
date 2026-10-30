import { ArrowUpRight, BookOpen } from "lucide-react";
import { SCORE_SOURCES, getScoreCollection, type ScoreSong } from "@/lib/score-sources";
import { Smallcaps } from "./editorial-shell";

export function ScoreSources({ song }: { song: ScoreSong }) {
  const collection = getScoreCollection(song);
  const scores = collection?.scores ?? [];
  const searchSong = collection
    ? { title: collection.title, artist: collection.artist }
    : song;

  return (
    <section id="score-sources" aria-labelledby="score-sources-heading" className="mt-6 border border-rule bg-paper-deep/40 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Smallcaps>Score sources</Smallcaps>
          <h2 id="score-sources-heading" className="mt-1 flex items-center gap-2 font-serif text-[20px] text-ink">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            找现成乐谱
          </h2>
          <p className="mt-1 font-serif text-[13px] leading-relaxed text-ink-soft">
            免费谱源备选：先核对歌手、编配和段落，再选适合自己的练习版本。
          </p>
        </div>
        {collection?.listeningUrl ? (
          <a href={collection.listeningUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-ink-soft underline underline-offset-4 hover:text-red">
            QQ 音乐原曲 ↗
          </a>
        ) : null}
      </div>

      {scores.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {scores.map((score) => (
            <article key={score.url} className="min-w-0 border border-rule bg-paper p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Smallcaps tone="red">已核对 · 免费阅谱</Smallcaps>
                <span className="font-mono text-[10px] text-ink-mute">{score.checkedOn}</span>
              </div>
              <a href={score.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 font-serif text-[17px] text-ink underline decoration-rule underline-offset-4 hover:text-red">
                {score.title}<ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </a>
              <p className="mt-1 text-[11px] text-ink-mute">{SCORE_SOURCES.find((source) => source.id === score.sourceId)?.name} · {collection?.artist}</p>
              <p className="mt-2 font-serif text-[13px] leading-relaxed text-ink-soft">{score.description}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 font-serif text-[13px] text-ink-soft">还没有核对到这首歌的免费谱，可以用下面的入口搜索。</p>
      )}

      <details open={scores.length === 0} className="mt-4 border-t border-rule pt-3">
        <summary className="cursor-pointer text-[13px] text-ink hover:text-red">到备选网站搜索《{searchSong.title}》</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {SCORE_SOURCES.map((source) => (
            <div key={source.id} className="min-w-0">
              <a href={source.search(searchSong)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-serif text-[15px] text-ink underline decoration-rule underline-offset-4 hover:text-red">
                {source.name}<ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </a>
              <p className="mt-1 text-[11px] text-ink-mute">{source.format}</p>
              <p className="mt-1 font-serif text-[12px] leading-relaxed text-ink-soft">{source.access}</p>
            </div>
          ))}
        </div>
      </details>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-mute">链接在新标签页打开。原站看谱不会自动导入下方练习台；搜索结果仍需核对是否为同一首歌。</p>
    </section>
  );
}

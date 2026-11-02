import type { SongThemeTag } from "@/types/song-interpretation";

export function SongThemeTags({ tags }: { tags?: SongThemeTag[] }) {
  if (!tags?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-3" aria-label="歌曲主题">
      {tags.map(tag => (
        <span key={tag} className="border border-rule bg-paper-deep/60 px-2 py-0.5 text-[11px] text-ink-soft">
          {tag}
        </span>
      ))}
    </div>
  );
}

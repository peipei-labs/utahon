"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteSongRequest } from "@/lib/delete-song";
import { IconButton } from "./editorial-interactive";

export function DeleteSongButton({
  songId,
  songTitle,
}: {
  songId: string;
  songTitle: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(false), 3000);
    return () => window.clearTimeout(timer);
  }, [error]);

  async function handleDelete() {
    if (!confirm(`删除《${songTitle}》?`)) return;
    setDeleting(true);
    setError(false);
    const ok = await deleteSongRequest(songId);
    if (ok) {
      router.push("/");
      router.refresh();
    } else {
      setDeleting(false);
      setError(true);
    }
  }

  return (
    <span className="relative inline-flex">
      <IconButton
        aria-label="删除歌曲"
        title="删除歌曲"
        tone="red"
        onClick={handleDelete}
        disabled={deleting}
      >
        <Trash2 className="w-[14px] h-[14px]" strokeWidth={1.5} />
      </IconButton>
      {error ? (
        <span
          role="alert"
          className="absolute right-0 top-full z-20 mt-1 whitespace-nowrap border border-rule bg-paper px-2 py-1 font-serif text-[12px] text-red"
        >
          删除失败，请重试
        </span>
      ) : null}
    </span>
  );
}

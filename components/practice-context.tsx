"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PracticeDataV1, PracticeRecord } from "@/types/practice";

type PracticeContextValue = {
  practice: PracticeRecord;
  saving: boolean;
  saveData: (data: PracticeDataV1, baseUpdatedAt: number) => Promise<PracticeRecord>;
  uploadAudio: (file: File) => Promise<PracticeRecord>;
  downloadSourceAudio: (input: {
    sourceInput?: string;
    songUpdatedAt: number;
    baseUpdatedAt: number;
    replaceExisting: boolean;
  }) => Promise<PracticeRecord>;
  refreshPractice: () => Promise<PracticeRecord>;
};

const PracticeContext = createContext<PracticeContextValue | null>(null);

async function parseResponse(response: Response): Promise<PracticeRecord> {
  const body = (await response.json().catch(() => ({
    error: `服务器未返回有效结果（HTTP ${response.status}），请稍后载入最新练习数据确认。`,
  }))) as PracticeRecord | { error?: string };
  if (!response.ok) {
    throw new Error("error" in body && body.error ? body.error : `HTTP ${response.status}`);
  }
  if (!("songId" in body)) throw new Error(body.error || "服务器返回的练习数据无效");
  return body as PracticeRecord;
}

export function PracticeProvider({
  initialPractice,
  children,
}: {
  initialPractice: PracticeRecord;
  children: ReactNode;
}) {
  const [practice, setPractice] = useState(initialPractice);
  const [saving, setSaving] = useState(false);

  const refreshPractice = useCallback(async () => {
    const response = await fetch(`/api/songs/${practice.songId}/practice`, { cache: "no-store" });
    const next = await parseResponse(response);
    setPractice((current) => next.updatedAt > current.updatedAt ? next : current);
    return next;
  }, [practice.songId]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshPractice().catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    const interval = practice.status === "pending" ? window.setInterval(refresh, 5000) : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [practice.status, refreshPractice]);

  const saveData = useCallback(
    async (data: PracticeDataV1, baseUpdatedAt: number) => {
      setSaving(true);
      try {
        const response = await fetch(`/api/songs/${practice.songId}/practice`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data, baseUpdatedAt }),
        });
        if (response.status === 409) await refreshPractice().catch(() => undefined);
        const next = await parseResponse(response);
        setPractice((current) => next.updatedAt >= current.updatedAt ? next : current);
        return next;
      } finally {
        setSaving(false);
      }
    },
    [practice.songId, refreshPractice]
  );

  const uploadAudio = useCallback(
    async (file: File) => {
      setSaving(true);
      try {
        const response = await fetch(`/api/songs/${practice.songId}/practice/audio`, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        const next = await parseResponse(response);
        setPractice((current) => next.updatedAt >= current.updatedAt ? next : current);
        return next;
      } finally {
        setSaving(false);
      }
    },
    [practice.songId]
  );

  const downloadSourceAudio = useCallback(
    async (input: {
      sourceInput?: string;
      songUpdatedAt: number;
      baseUpdatedAt: number;
      replaceExisting: boolean;
    }) => {
      setSaving(true);
      try {
        const response = await fetch(`/api/songs/${practice.songId}/practice/source`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (response.status === 409) await refreshPractice().catch(() => undefined);
        const next = await parseResponse(response);
        setPractice((current) => next.updatedAt >= current.updatedAt ? next : current);
        return next;
      } finally {
        setSaving(false);
      }
    },
    [practice.songId, refreshPractice]
  );

  const value = useMemo(
    () => ({ practice, saving, saveData, uploadAudio, downloadSourceAudio, refreshPractice }),
    [practice, saveData, saving, uploadAudio, downloadSourceAudio, refreshPractice]
  );
  return <PracticeContext.Provider value={value}>{children}</PracticeContext.Provider>;
}

export function usePractice(): PracticeContextValue {
  const context = useContext(PracticeContext);
  if (!context) throw new Error("usePractice must be used inside PracticeProvider");
  return context;
}

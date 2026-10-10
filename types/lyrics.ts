export type ParsedLine = {
  startTime: number;
  endTime: number;
  text: string;
  analyzable?: boolean;
};

export type Token = {
  surface: string;
  furigana: string;
  romaji: string;
  meaning: string;
  pos: string;
};

export type AnalyzedLine = {
  original: string;
  translation: string;
  romaji: string;
  tokens: Token[];
  startTime: number;
  endTime: number;
};

export type AnalyzedSong = {
  title: string;
  artist: string;
  originalArtist?: string;
  youtubeUrl: string;
  youtubeId: string;
  transcriptionSourceUrl?: string;
  lines: AnalyzedLine[];
};

export type SongSource = "manual" | "channel" | "netease" | "share";

export type SongMeta = {
  id: string;
  title: string;
  artist: string;
  originalArtist: string;
  linesCount: number;
  createdAt: number;
  youtubeId: string;
  source: SongSource;
  durationSec: number;
};

export type SongFull = SongMeta & {
  lyrics: string;
  analyzed: AnalyzedSong;
  updatedAt: number;
};

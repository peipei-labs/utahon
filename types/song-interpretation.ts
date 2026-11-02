export const SONG_THEME_TAGS = ["恋爱", "失恋", "人生", "成长", "梦想", "友情", "亲情", "孤独", "自我接纳", "告别", "社会", "治愈", "希望"] as const;
export type SongThemeTag = typeof SONG_THEME_TAGS[number];

export type SongBackgroundSource = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  excerpt: string;
};

export type SongBackground = {
  sources: SongBackgroundSource[];
  notes: string[];
};

export type InterpretationContext = {
  text: string;
  basis: "source" | "inference" | "unknown";
  sourceIds: string[];
};

export type InterpretationContent = {
  summary: string;
  mainMessage: string;
  emotionalArc: string;
  tags: { tag: SongThemeTag; reason: string }[];
  lyricEvidence: { lineNumbers: number[]; explanation: string }[];
  collection: InterpretationContext;
  era: InterpretationContext;
  creation: InterpretationContext;
};

export type SongInterpretation = InterpretationContent & {
  version: 1;
  generatedAt: number;
  model: string;
  inputHash: string;
  stale: boolean;
  sources: SongBackgroundSource[];
  backgroundNotes: string[];
};

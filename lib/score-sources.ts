export type ScoreSong = {
  title: string;
  artist: string;
  originalArtist?: string;
};

type ScoreSource = {
  id: string;
  name: string;
  format: string;
  access: string;
  search: (song: ScoreSong) => string;
};

export const SCORE_SOURCES: ScoreSource[] = [
  {
    id: "songsterr",
    name: "Songsterr",
    format: "吉他 / 贝斯六线谱",
    access: "可免费在线阅谱和合成试听；变速、下载等部分功能需会员。",
    search: (song) => `https://www.songsterr.com/?${new URLSearchParams({
      pattern: [song.title, song.originalArtist || song.artist].filter(Boolean).join(" "),
      inst: "guitar",
    })}`,
  },
  {
    id: "everyonepiano",
    name: "人人钢琴网",
    format: "钢琴五线谱 / 双手简谱",
    access: "公开谱图可免费查看；一键 PDF、MIDI 等下载可能需 VIP。搜索可能要求验证。",
    search: (song) => `https://www.everyonepiano.cn/Music-search/?${new URLSearchParams({
      word: song.title,
      come: "web",
    })}`,
  },
  {
    id: "ufret",
    name: "U-FRET",
    format: "日语歌曲和弦 / 弹唱谱",
    access: "可免费查看公开和弦谱；会员功能另计。",
    search: (song) => `https://www.ufret.jp/search.php?${new URLSearchParams({ key: song.title })}`,
  },
];

type VerifiedScore = {
  sourceId: string;
  title: string;
  url: string;
  description: string;
  checkedOn: string;
};

type ScoreCollection = {
  title: string;
  artist: string;
  titleAliases: string[];
  artistAliases: string[];
  listeningUrl?: string;
  scores: VerifiedScore[];
};

const SCORE_COLLECTIONS: ScoreCollection[] = [
  {
    title: "Cry For Me",
    artist: "Michita feat. Ami",
    titleAliases: ["Cry For Me", "Cry For Me (feat. Ami)", "Cry For Me (feat. 愛海)"],
    artistAliases: ["Michita", "ミチタ", "Ami", "愛海", "Michita feat. Ami", "Michita feat. 愛海", "Michita, Ami"],
    scores: [
      {
        sourceId: "songsterr",
        title: "指弹六线谱",
        url: "https://www.songsterr.com/a/wsa/michita-cry-for-me-feat-cry-for-me-tab-s1385463",
        description: "已查看至第 114 小节结尾，合成试听可用。4/4、90 BPM、Capo 3；指弹编配。",
        checkedOn: "2026-10-29",
      },
      {
        sourceId: "everyonepiano",
        title: "钢琴改编谱 · 化身无",
        url: "https://www.everyonepiano.cn/Stave-17868.html",
        description: "六页谱图可免费查看，共 92 小节，4/4、92 BPM。可参考和声，段落长度与原录音不同。",
        checkedOn: "2026-10-29",
      },
    ],
  },
  {
    title: "スロー&スロー",
    artist: "MINT mate box",
    titleAliases: ["スロー&スロー", "Slow & Slow", "スロー&スロー (Slow & Slow)"],
    artistAliases: ["MINT mate box"],
    listeningUrl: "https://c6.y.qq.com/base/fcgi-bin/u?__=Qb1OVZvuqAb2",
    scores: [],
  },
];

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

export function getScoreCollection(song: ScoreSong): ScoreCollection | undefined {
  const title = normalized(song.title);
  const artists = [song.artist, song.originalArtist || ""].map(normalized).filter(Boolean);
  return SCORE_COLLECTIONS.find((collection) =>
    collection.titleAliases.some((alias) => normalized(alias) === title)
    && collection.artistAliases.some((alias) => artists.includes(normalized(alias)))
  );
}

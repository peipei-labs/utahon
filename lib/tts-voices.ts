export type ServerVoice = {
  name: string;
  label: string;
  hint: string;
};

export const SERVER_VOICES: ServerVoice[] = [
  { name: "ja-JP-NanamiNeural", label: "Nanami", hint: "女声 · 明亮亲切" },
  { name: "ja-JP-KeitaNeural",  label: "Keita",  hint: "男声 · 温和友好" },
];

export const DEFAULT_SERVER_VOICE = "ja-JP-NanamiNeural";

const SERVER_VOICE_SET = new Set(SERVER_VOICES.map((v) => v.name));

export function isServerVoice(name: string | null | undefined): boolean {
  return !!name && SERVER_VOICE_SET.has(name);
}

export function isRetiredServerVoice(name: string): boolean {
  return name.startsWith("voicevox-") ||
    ["ja-JP-AoiNeural", "ja-JP-MayuNeural", "ja-JP-ShioriNeural"].includes(name);
}

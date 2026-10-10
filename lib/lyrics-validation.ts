import type { AnalyzedLine, ParsedLine } from "@/types/lyrics";

const POS = new Set([
  "noun", "verb", "adjective", "adverb", "expression", "particle",
  "auxiliary", "symbol", "other",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateAnalyzedLines(
  value: unknown,
  input: ParsedLine[]
): AnalyzedLine[] {
  if (!record(value) || !Array.isArray(value.lines) || value.lines.length !== input.length) {
    throw new Error("AI 标注行数与原歌词不一致，未保存结果，请重试或检查歌词");
  }
  return value.lines.map((line: unknown, index) => {
    const fail = (reason: string): never => {
      throw new Error(`AI 第 ${index + 1} 行标注异常（${reason}），未保存结果`);
    };
    if (!record(line)) return fail("格式无效");
    if (line.original !== input[index].text) return fail("原文或顺序发生变化");
    if (typeof line.translation !== "string" || !Array.isArray(line.tokens) || !line.tokens.length) {
      return fail("缺少翻译或分词");
    }
    const tokens = line.tokens.map((token: unknown) => {
      if (!record(token) || typeof token.surface !== "string" || !token.surface ||
          typeof token.furigana !== "string" || typeof token.meaning !== "string" ||
          typeof token.pos !== "string" || !POS.has(token.pos)) {
        return fail("分词格式无效");
      }
      return {
        surface: token.surface, furigana: token.furigana,
        meaning: token.meaning, pos: token.pos, romaji: "",
      };
    });
    if (tokens.map((token) => token.surface).join("") !== input[index].text) {
      return fail("分词未完整还原原文");
    }
    return {
      original: input[index].text,
      translation: line.translation,
      tokens,
      romaji: "",
      startTime: input[index].startTime,
      endTime: input[index].endTime,
    };
  });
}

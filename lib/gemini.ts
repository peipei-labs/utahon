import { SchemaType, type Schema } from "@google/generative-ai";
import { getGeminiModel } from "@/lib/gemini-client";
import type { ParsedLine, AnalyzedLine } from "@/types/lyrics";
import { validateAnalyzedLines } from "./lyrics-validation";
import { parseModelJson } from "./model-json";

const PRIMARY_MODEL =
  process.env.GEMINI_ANALYZE_MODEL ??
  process.env.GEMINI_MODEL ??
  "gemini-3.1-flash-lite";
const FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL ?? "gemini-2.5-flash-lite";
const HAS_FALLBACK = PRIMARY_MODEL !== FALLBACK_MODEL;

let downgraded = false;

const RESPONSE_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    lines: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          original: { type: SchemaType.STRING },
          translation: { type: SchemaType.STRING },
          tokens: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                surface: { type: SchemaType.STRING },
                furigana: { type: SchemaType.STRING },
                meaning: { type: SchemaType.STRING },
                pos: { type: SchemaType.STRING },
              },
              required: ["surface", "furigana", "meaning", "pos"],
            },
          },
        },
        required: ["original", "translation", "tokens"],
      },
    },
  },
  required: ["lines"],
};

const SYSTEM_PROMPT = `你是日语歌词翻译与学习助手。翻译目标"信达雅"：准确（信）、通顺（达）、有美感（雅）。

响应只能是一个合法 JSON 对象，结构严格为：
{"lines":[{"original":"原文","translation":"中文翻译","tokens":[{"surface":"原文中的词","furigana":"かな","meaning":"中文释义","pos":"noun"}]}]}
不要问候、前言、解释、Markdown、代码框或项目列表。lines 必须与输入逐行一一对应，保持行数与顺序，重复行也不得合并。输入行号仅用于区分，original 不包含行号。

输入为一首日语歌的全部歌词行（按行分隔，每行一句）。请对每一行返回：
1. original：原文（照抄）
2. translation：简体中文翻译，按以下原则：
   - 这是「歌词」不是「散文/对白」，优先保留原文意象（如「桜」译"樱花"而非"花瓣"）
   - 先在心里把握全曲的情感基调和叙事脉络，再逐句翻译，避免割裂
   - 同一意象/关键词在不同段落保持一致译法，形成呼应
   - 抒情句留白克制，叙事句平实自然，不强求押韵或字数对齐
   - 不要逐字直译，但也不要过度添油加醋脱离原意
3. tokens：该行的**完整分词序列**（非常重要：把 tokens 按顺序拼回来必须等于 original），每个 token 含：
   - surface：该词在句中的原形（含汉字如有）
   - furigana：该词的平假名读音（纯符号/标点可留空字符串）
   - meaning：中文释义（简短，一个词或短语；助词/标点可留空字符串）
   - pos：词性，限定为 noun / verb / adjective / adverb / expression / particle / auxiliary / symbol / other

规则（必须严格遵守）：
- **tokens 必须覆盖 original 的每一个字符**，按原顺序输出；包括助词（は・が・を・に・で・の・と・も・へ・から・まで 等）、句末语气词（よ・ね・な・か 等）、だ・です・ます、标点空格等
- 助词 pos 标 particle；だ・です・ます・れる・られる 等助动词 pos 标 auxiliary；标点/空格 pos 标 symbol
- 实词（名词、动词、形容词、副词、惯用表达）正常给出 meaning；**助词/助动词/标点的 meaning 可填空字符串**，但 token 本身不能省略
- 复合词（如「歩き回る」）作为单个 token 处理
- furigana 只含平假名；纯符号/标点 furigana 留空
- 自检：把 tokens 的 surface 按顺序拼接必须字符级等于 original`;

async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /\b(429|500|502|503|504)\b|ECONNRESET|ETIMEDOUT|fetch failed|overloaded/i.test(
        msg
      );
      if (!retryable || attempt === maxRetries) throw err;
      const delayMs = 2 ** attempt * 1500;
      console.warn(
        `[gemini] retry ${attempt + 1}/${maxRetries} after ${delayMs}ms (${msg.slice(0, 120)})`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

function isOverloadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|503)\b|overloaded|UNAVAILABLE/i.test(msg);
}

function runWithModel(modelId: string, prompt: string) {
  const model = getGeminiModel({
    model: modelId,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.3,
    },
  });
  return callWithRetry(() => model.generateContent(prompt));
}

export type AnalyzeContext = {
  title?: string;
  artist?: string;
};

function formatContext(ctx?: AnalyzeContext): string {
  if (!ctx) return "";
  const lines: string[] = [];
  if (ctx.title) lines.push(`- 歌名：${ctx.title}`);
  if (ctx.artist) lines.push(`- 歌手：${ctx.artist}`);
  if (lines.length === 0) return "";
  return `歌曲信息：\n${lines.join("\n")}\n\n`;
}

export async function analyzeLines(
  lines: ParsedLine[],
  ctx?: AnalyzeContext
): Promise<AnalyzedLine[]> {
  const joinedLyrics = lines.map((l, i) => `${i + 1}. ${l.text}`).join("\n");
  const prompt = `${SYSTEM_PROMPT}\n\n${formatContext(ctx)}歌词：\n${joinedLyrics}`;

  const activeModel = downgraded ? FALLBACK_MODEL : PRIMARY_MODEL;
  let result;
  try {
    result = await runWithModel(activeModel, prompt);
  } catch (err) {
    if (!downgraded && HAS_FALLBACK && isOverloadError(err)) {
      console.warn(
        `[gemini] primary ${PRIMARY_MODEL} overload 降级到 ${FALLBACK_MODEL}`
      );
      downgraded = true;
      result = await runWithModel(FALLBACK_MODEL, prompt);
    } else {
      throw err;
    }
  }
  const raw = result.response.text();
  const parsed = parseModelJson(raw, result.response.candidates?.[0]?.finishReason);
  return validateAnalyzedLines(parsed, lines);
}

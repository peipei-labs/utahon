export function parseModelJson(text: string, finishReason?: string): unknown {
  if (finishReason && finishReason !== "STOP") {
    throw new Error("AI 输出未完整结束，请重试；未保存本次结果");
  }
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  try {
    return JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    throw new Error("AI 输出不是完整 JSON，请重试；未保存本次结果");
  }
}

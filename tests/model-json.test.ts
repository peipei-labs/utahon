import assert from "node:assert/strict";
import test from "node:test";
import { parseModelJson } from "../lib/model-json";
import { validateParsedShare } from "../lib/share-parser";

test("accepts raw JSON and a complete JSON fence from the gateway", () => {
  const expected = { title: "練習", artist: "Test", originalArtist: "", sourceUrl: "", platform: "other" };
  const json = JSON.stringify(expected);
  assert.deepEqual(parseModelJson(json, "STOP"), expected);
  assert.deepEqual(parseModelJson(`\n\`\`\`json\n${json}\n\`\`\`\n`, "STOP"), expected);
  assert.deepEqual(validateParsedShare(parseModelJson(json)), expected);
});

test("does not accept truncated, blocked or prose-wrapped output", () => {
  assert.throws(() => parseModelJson('{"title":', "MAX_TOKENS"), /未完整结束/);
  assert.throws(() => parseModelJson('{}', "SAFETY"), /未完整结束/);
  assert.throws(() => parseModelJson('```json\n{}'), /完整 JSON/);
  assert.throws(() => parseModelJson('Here is the result: {}'), /完整 JSON/);
});

test("rejects missing or non-string share fields", () => {
  assert.throws(() => validateParsedShare(null), /格式异常/);
  assert.throws(() => validateParsedShare([]), /格式异常/);
  assert.throws(() => validateParsedShare({ title: 5 }), /字段不完整/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { emptyPracticeData, type PracticeRecord } from "../types/practice";

test("practice provider uses the newest server or client version without remounting", async () => {
  const compiled = ts.transpileModule(readFileSync(new URL("../components/practice-context.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const values: unknown[] = [];
  let cursor = 0;
  let response: PracticeRecord;
  type Context = { practice: PracticeRecord; refreshPractice: () => Promise<PracticeRecord> };
  const output = { exports: {} as { PracticeProvider: (props: { initialPractice: PracticeRecord; children: null }) => Context } };
  runInNewContext(compiled, {
    exports: output.exports, module: output, Error,
    fetch: async () => ({ ok: true, json: async () => response }),
    require: (name: string) => {
      if (name === "react/jsx-runtime") return { jsx: (_type: unknown, props: { value: Context }) => props.value };
      assert.equal(name, "react");
      return {
        createContext: () => ({ Provider: "provider" }), useEffect: () => undefined,
        useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
        useState: (initial: unknown) => {
          const index = cursor++;
          if (!(index in values)) values[index] = initial;
          return [values[index], (next: unknown) => {
            values[index] = typeof next === "function" ? next(values[index]) : next;
          }];
        },
      };
    },
  });
  const record = (updatedAt: number): PracticeRecord => ({ songId: "fixture", audioSha256: "", status: "ready",
    lastError: "", data: emptyPracticeData(20), hasAudio: false, updatedAt });
  const render = (initialPractice: PracticeRecord) => {
    cursor = 0;
    return output.exports.PracticeProvider({ initialPractice, children: null });
  };
  const first = record(1);
  const refreshed = record(3);
  assert.equal(render(first).practice, first);
  assert.equal(render(refreshed).practice, refreshed);
  response = record(2);
  await render(refreshed).refreshPractice();
  assert.equal(render(refreshed).practice, refreshed, "late client response must not undo newer server props");
  response = record(4);
  await render(refreshed).refreshPractice();
  assert.equal(render(refreshed).practice, response, "newer client state must survive stale server props");
});

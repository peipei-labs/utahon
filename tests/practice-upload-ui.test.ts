import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("practice-studio.tsx",
  readFileSync(new URL("../components/practice-studio.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler: ts.FunctionDeclaration | undefined;
function findHandler(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "handleUpload") handler = node;
  else ts.forEachChild(node, findHandler);
}
findHandler(source);
assert.ok(handler, "upload handler must exist");
const compiled = ts.transpileModule(`export ${handler.getText(source)}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const failure of [false, true]) {
  test(`upload ${failure ? "failure preserves state without refreshing" : "success refreshes the song version only after saving"}`, async () => {
    const events: string[] = [];
    let finish!: () => void;
    const pending = new Promise<void>((resolve, reject) => {
      finish = () => failure ? reject(new Error("upload failed")) : resolve();
    });
    const fileInput = { current: { value: "chosen.wav" } };
    const selectLocalAfterRefresh = { current: null as number | null };
    const output = { exports: {} as { handleUpload: (file?: File) => Promise<void> } };
    let error = "";
    runInNewContext(compiled, {
      exports: output.exports, module: output, Error,
      draftState: null, fileInput, selectLocalAfterRefresh, songUpdatedAt: 123,
      uploadAudio: () => pending,
      player: { selectSource: (value: string) => events.push(value) },
      router: { refresh: () => events.push("refresh") },
      setDraftState: () => events.push("clear-draft"),
      setNotice: () => undefined,
      setError: (value: string) => { error = value; },
    });
    await output.exports.handleUpload();
    assert.deepEqual(events, []);
    const running = output.exports.handleUpload(new File(["audio"], "chosen.wav"));
    assert.deepEqual(events, [], "pending uploads must not refresh or clear drafts");
    finish();
    await running;
    assert.deepEqual(events, failure ? [] : ["local", "clear-draft", "refresh"]);
    assert.equal(selectLocalAfterRefresh.current, failure ? null : 123);
    assert.equal(fileInput.current.value, "");
    assert.equal(error, failure ? "upload failed" : "");
  });
}

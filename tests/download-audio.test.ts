import assert from "node:assert/strict";
import test from "node:test";
import childProcess, { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { AudioDownloadError, downloadAudio } from "../lib/transcribe";

test("bounded downloads use one video, safe errors and clean temporary files", async (t) => {
  let mode: "success" | "fail" | "large" | "timeout" = "success";
  const outputs: string[] = [];
  const calls: string[][] = [];
  let killed = 0;
  t.mock.method(childProcess, "spawn", (command: string, args: string[]) => {
    assert.equal(command, "uv");
    calls.push(args);
    const output = args[args.indexOf("-o") + 1];
    outputs.push(output);
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
      kill() { killed++; queueMicrotask(() => child.emit("close", null)); return true; },
    });
    writeFileSync(output, mode === "large" ? "x".repeat(20) : "audio");
    if (mode !== "timeout") queueMicrotask(() => {
      child.stderr.write("secret-cookie=never-expose-this");
      child.emit("close", mode === "fail" ? 1 : 0);
    });
    return child as unknown as ChildProcess;
  });
  t.mock.method(globalThis, "fetch", () => { throw new Error("Network forbidden in unit tests"); });

  await t.test("successful YouTube and BV downloads pass bounds and no-playlist", async () => {
    for (const source of ["dQw4w9WgXcQ", "BV1xx4y1m7rE"]) {
      const result = await downloadAudio(source, { maxBytes: 10, maxDurationSec: 7200, timeoutMs: 1000 });
      assert.ok(existsSync(result));
      const args = calls.at(-1)!;
      assert.ok(args.includes("--no-playlist"));
      assert.equal(args.includes("--js-runtimes"), source === "dQw4w9WgXcQ");
      if (source === "dQw4w9WgXcQ") assert.equal(args[args.indexOf("--js-runtimes") + 1], `node:${process.execPath}`);
      assert.equal(args[args.indexOf("--max-filesize") + 1], "10");
      assert.equal(args[args.indexOf("--match-filters") + 1], "duration <= 7200");
      await rm(path.dirname(result), { recursive: true });
    }
  });
  await t.test("failed YouTube attempts share a deadline and do not leak stderr", async () => {
    mode = "fail";
    const before = calls.length;
    await assert.rejects(downloadAudio("dQw4w9WgXcQ", { timeoutMs: 1000 }), (error: unknown) => {
      assert.ok(error instanceof AudioDownloadError);
      assert.equal(error.reason, "failed");
      assert.doesNotMatch(error.message, /secret-cookie|never-expose/);
      return true;
    });
    assert.equal(calls.length, before + 2);
    assert.equal(outputs.at(-1), outputs.at(-2));
    assert.ok(!existsSync(path.dirname(outputs.at(-1)!)));
  });
  await t.test("oversized downloads are rejected and removed", async () => {
    mode = "large";
    await assert.rejects(downloadAudio("dQw4w9WgXcQ", { maxBytes: 10, timeoutMs: 1000 }),
      (error: unknown) => error instanceof AudioDownloadError && error.reason === "limit");
    assert.ok(!existsSync(path.dirname(outputs.at(-1)!)));
  });
  await t.test("timeout kills download without a second attempt and removes its files", async () => {
    mode = "timeout";
    const before = calls.length;
    await assert.rejects(downloadAudio("dQw4w9WgXcQ", { timeoutMs: 10 }),
      (error: unknown) => error instanceof AudioDownloadError && error.reason === "timeout");
    assert.equal(calls.length, before + 1);
    assert.equal(killed, 1);
    assert.ok(!existsSync(path.dirname(outputs.at(-1)!)));
  });
});

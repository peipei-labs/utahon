import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("practice saves use an atomic base version in an isolated database", async (t) => {
  const originalCwd = process.cwd();
  const testRoot = await mkdtemp(path.join(os.tmpdir(), "utahon-practice-test-"));
  process.chdir(testRoot);
  const { getDb } = await import("../lib/db");
  const { getPractice, savePracticeData, setPracticeAudio, importPracticeData, PracticeConflictError } = await import("../lib/practice");
  const { PUT } = await import("../app/api/songs/[id]/practice/route");
  const { emptyPracticeData } = await import("../types/practice");
  const db = getDb();
  const id = "practice-save-fixture";
  db.prepare(`INSERT INTO songs (id, title, artist, lyrics, analyzed, created_at, updated_at, duration_sec)
              VALUES (?, 'fixture', 'fixture', '', '{"lines":[]}', 1, 1, 20)`).run(id);

  try {
    await t.test("first save and subsequent fresh edit succeed", () => {
      const first = savePracticeData(id, emptyPracticeData(20), 0);
      assert.ok(first.updatedAt > 0);
      const second = savePracticeData(id, { ...first.data, capo: 2 }, first.updatedAt);
      assert.equal(second.data.capo, 2);
      assert.ok(second.updatedAt > first.updatedAt);
      assert.throws(() => savePracticeData(id, first.data, 0), PracticeConflictError);
    });

    await t.test("an imported worker result survives a stale page save", async () => {
      const pending = setPracticeAudio(id, "a".repeat(64), 20);
      const result = importPracticeData(id, pending.audioSha256, pending.updatedAt, {
        ...pending.data,
        stems: ["vocals", "drums", "bass", "other"],
        chords: [{ id: "auto-1", startTime: 0, endTime: 4, symbol: "Eb", source: "auto", edited: false }],
      });
      const response = await PUT(new Request("http://localhost/api/practice", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { ...pending.data, capo: 5 }, baseUpdatedAt: pending.updatedAt }),
      }), { params: Promise.resolve({ id }) });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /尚未保存/);
      assert.deepEqual(getPractice(id), result);
    });

    await t.test("old API clients cannot save without a version", async () => {
      const response = await PUT(new Request("http://localhost/api/practice", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: emptyPracticeData(20) }),
      }), { params: Promise.resolve({ id }) });
      assert.equal(response.status, 400);
    });

    await t.test("the SQL version guard catches updates after the initial read", () => {
      const before = getPractice(id)!;
      const racingData = {
        ...before.data,
        get version() {
          db.prepare("UPDATE song_practice SET updated_at = updated_at + 1 WHERE song_id = ?").run(id);
          return 1 as const;
        },
        capo: 9,
      };
      assert.throws(() => savePracticeData(id, racingData, before.updatedAt), PracticeConflictError);
      const after = getPractice(id)!;
      assert.equal(after.updatedAt, before.updatedAt + 1);
      assert.deepEqual(after.data, before.data);
    });

    await t.test("a concurrent first save does not overwrite the winning insert", () => {
      const otherId = "concurrent-first-save";
      db.prepare(`INSERT INTO songs (id, title, artist, lyrics, analyzed, created_at, updated_at, duration_sec)
                  VALUES (?, 'fixture', 'fixture', '', '{"lines":[]}', 1, 1, 20)`).run(otherId);
      const winner = { ...emptyPracticeData(20), capo: 2 };
      const racingData = {
        ...emptyPracticeData(20),
        get version() {
          db.prepare(`INSERT INTO song_practice (song_id, practice_json, created_at, updated_at) VALUES (?, ?, 1, 42)`)
            .run(otherId, JSON.stringify(winner));
          return 1 as const;
        },
        capo: 9,
      };
      assert.throws(() => savePracticeData(otherId, racingData, 0), PracticeConflictError);
      assert.equal(getPractice(otherId)!.updatedAt, 42);
      assert.deepEqual(getPractice(otherId)!.data, winner);
    });

    await t.test("a worker import cannot overwrite a newer manual edit", () => {
      const before = getPractice(id)!;
      const saved = savePracticeData(id, { ...before.data, capo: 3 }, before.updatedAt);
      assert.throws(() => importPracticeData(id, before.audioSha256, before.updatedAt, emptyPracticeData(20)), /避免覆盖/);
      assert.deepEqual(getPractice(id), saved);
    });

    await t.test("replacement and legacy duplicate IDs preserve all manual content", () => {
      const before = getPractice(id)!;
      const manual = { ...emptyPracticeData(20), capo: 3 };
      manual.chords = [{ id: "manual-chord", startTime: 1, endTime: 3, symbol: "C",
        simplifiedSymbol: "C", source: "manual", edited: true }];
      manual.sections[0] = { ...manual.sections[0], label: "verse", edited: true };
      savePracticeData(id, manual, before.updatedAt);
      const replaced = setPracticeAudio(id, "b".repeat(64), 20);
      assert.equal(replaced.data.capo, 3);
      assert.equal(replaced.data.chords.length, 1);
      assert.equal(replaced.data.sections.length, 2);
      assert.equal(replaced.data.sections.find((section) => section.label === "verse")!.id, manual.sections[0].id);
      assert.equal(new Set(replaced.data.sections.map((section) => section.id)).size, 2);
      const legacy = { ...manual, chords: [manual.chords[0], { ...manual.chords[0], startTime: 4, endTime: 6 }],
        sections: [...emptyPracticeData(20).sections, ...manual.sections] };
      db.prepare("UPDATE song_practice SET practice_json = ? WHERE song_id = ?").run(JSON.stringify(legacy), id);
      const restored = getPractice(id)!;
      assert.deepEqual(getPractice(id)!.data, restored.data, "read repair uses stable IDs");
      assert.equal(restored.data.capo, 3);
      assert.equal(restored.data.chords.length, 2);
      assert.equal(restored.data.sections.length, 2);
      const saved = savePracticeData(id, restored.data, restored.updatedAt);
      assert.deepEqual(saved.data, restored.data);
    });
  } finally {
    db.close();
    process.chdir(originalCwd);
    await rm(testRoot, { recursive: true, force: true });
  }
});

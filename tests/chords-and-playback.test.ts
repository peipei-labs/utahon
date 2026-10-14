import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChordDiagram, findPosition } from "../components/chord-diagram";
import { clampPlaybackRate } from "../components/youtube-player";
import { transposeChord, validatePracticeData } from "../lib/practice-schema";
import { emptyPracticeData } from "../types/practice";

test("flat and enharmonic roots use the database's real keys", () => {
  for (const [flat, sharp] of [["Eb", "D#"], ["Ab", "G#"], ["Bb", "A#"]]) {
    assert.ok(findPosition(flat), flat);
    assert.deepEqual(findPosition(flat), findPosition(sharp));
  }
  assert.ok(findPosition(transposeChord("F", -2)));
  assert.ok(findPosition("Db"));
  assert.ok(findPosition("Gb"));
});

test("unsupported full chords never impersonate major or minor chords", () => {
  assert.equal(findPosition("Cmaj7/E"), null);
  assert.equal(findPosition("Cunknown"), null);
  assert.ok(findPosition("Cmaj7"));
  assert.deepEqual(findPosition("C:maj"), findPosition("C"));
  assert.ok(findPosition("C/E"));
  assert.notDeepEqual(findPosition("Cmaj7"), findPosition("Cm"));
  const markup = renderToStaticMarkup(createElement(ChordDiagram, { symbol: "Cmaj7/E" }));
  assert.match(markup, /暂无这个和弦的指法图/);
  assert.doesNotMatch(markup, /<svg/);
});

test("practice validation rejects duplicate keys that would couple edits", () => {
  const data = emptyPracticeData(20);
  const chord = { id: "reused", startTime: 0, endTime: 2, symbol: "C", source: "auto", edited: false };
  assert.throws(() => validatePracticeData({ ...data, chords: [chord, { ...chord, startTime: 4, endTime: 8 }] }, 20), /和弦 ID 不能重复/);
  assert.throws(() => validatePracticeData({ ...data, sections: [...data.sections, ...data.sections] }, 20), /段落 ID 不能重复/);
});

test("the advertised quarter speed is not silently raised to half speed", () => {
  assert.equal(clampPlaybackRate(0.25), 0.25);
  assert.equal(clampPlaybackRate(0.75), 0.75);
  assert.equal(clampPlaybackRate(0), 0.25);
  assert.equal(clampPlaybackRate(4), 2);
  assert.equal(clampPlaybackRate(Number.NaN), 1);
});

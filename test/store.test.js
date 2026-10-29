import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  loadRecording,
  saveRecording,
  isRecording,
  listRecordings,
  relPath,
  resolveRecording,
  slugify,
  humanSize,
  humanDuration,
} from "../src/store.js";
import { makeTempDir } from "./helpers.js";

function sample() {
  return {
    version: 1,
    tool: "flashback",
    entry: "app.js",
    cwd: "/tmp/app",
    files: { "app.js": { source: "x\n", lang: "js" } },
    steps: [
      { file: "app.js", line: 1, fn: "<anonymous>", t: 1, stack: [], watches: [] },
    ],
    output: [],
    exit: { reason: "exit" },
  };
}

test("save and load roundtrip", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "a.fb.json");
  saveRecording(sample(), file);
  const loaded = loadRecording(file);
  assert.equal(loaded.entry, "app.js");
  assert.equal(loaded.steps.length, 1);
  assert.ok(isRecording(loaded));
});

test("loadRecording rejects other JSON", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "bad.fb.json");
  fs.writeFileSync(file, JSON.stringify({ hello: "world" }));
  assert.throws(() => loadRecording(file), /not a flashback recording/);
});

test("listRecordings sorts newest first", async () => {
  const dir = makeTempDir();
  saveRecording(sample(), path.join(dir, "old.fb.json"));
  await new Promise((r) => setTimeout(r, 20));
  saveRecording(sample(), path.join(dir, "new.fb.json"));
  const list = listRecordings(dir);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, "new.fb.json");
});

test("resolveRecording finds the newest or an explicit file", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "one.fb.json");
  saveRecording(sample(), file);
  assert.equal(resolveRecording(undefined, { cwd: dir, dir }), file);
  assert.equal(resolveRecording("one.fb.json", { cwd: dir, dir }), file);
  assert.throws(() => resolveRecording(undefined, { cwd: dir, dir: path.join(dir, "nope") }), /no recordings/);
});

test("path helpers normalize separators", () => {
  assert.equal(relPath("/a/b", "/a/b/c/d.js"), "c/d.js");
  assert.equal(slugify("My Cool App!"), "my-cool-app");
  assert.equal(humanSize(2048), "2.0 kB");
  assert.equal(humanDuration(1500), "1.5s");
});

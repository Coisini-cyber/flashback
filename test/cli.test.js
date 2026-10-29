import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { saveRecording } from "../src/store.js";
import { makeTempDir, root } from "./helpers.js";

const run = promisify(execFile);
const bin = path.join(root, "bin", "flashback.js");

function sample(line) {
  return {
    version: 1,
    tool: "flashback",
    entry: "app.js",
    cwd: "/tmp/app",
    files: { "app.js": { source: "const a = 1;\nconst b = 2;\n", lang: "js" } },
    steps: [
      {
        file: "app.js",
        line,
        column: 1,
        fn: "<anonymous>",
        t: 5,
        stack: [
          {
            file: "app.js",
            line,
            fn: "<anonymous>",
            scopes: [{ type: "local", vars: [{ name: "a", value: { t: "number", v: 1 } }] }],
          },
        ],
        watches: [],
      },
    ],
    output: [],
    exit: { reason: "exit" },
  };
}

test("--version prints a version", async () => {
  const { stdout } = await run(process.execPath, [bin, "--version"]);
  assert.match(stdout, /^flashback \d+\.\d+\.\d+/);
});

test("--help explains the commands", async () => {
  const { stdout } = await run(process.execPath, [bin, "help"]);
  assert.match(stdout, /flashback run/);
  assert.match(stdout, /flashback replay/);
});

test("show prints a step", async () => {
  const dir = makeTempDir();
  const file = path.join(dir, "trace.fb.json");
  saveRecording(sample(2), file);
  const { stdout } = await run(process.execPath, [bin, "show", file], { env: { ...process.env, NO_COLOR: "1" } });
  assert.match(stdout, /app\.js:2/);
  assert.match(stdout, /a = 1/);
});

test("diff exits 1 when runs diverge", async () => {
  const dir = makeTempDir();
  const a = path.join(dir, "a.fb.json");
  const b = path.join(dir, "b.fb.json");
  saveRecording(sample(1), a);
  saveRecording(sample(2), b);
  await assert.rejects(
    run(process.execPath, [bin, "diff", a, b], { env: { ...process.env, NO_COLOR: "1" } }),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stdout, /divergence/);
      return true;
    },
  );
});

test("explain summarizes a recording", async () => {
  const dir = makeTempDir();
  const file = path.join(dir, "trace.fb.json");
  saveRecording(sample(1), file);
  const { stdout } = await run(process.execPath, [bin, "explain", file], { env: { ...process.env, NO_COLOR: "1" } });
  assert.match(stdout, /steps/);
  assert.match(stdout, /hot lines/);
});

test("export accepts -o and writes a player", async () => {
  const dir = makeTempDir();
  const file = path.join(dir, "trace.fb.json");
  const out = path.join(dir, "trace.html");
  saveRecording(sample(2), file);
  await run(process.execPath, [bin, "export", file, "-o", out]);
  assert.ok(fs.existsSync(out));
  assert.match(fs.readFileSync(out, "utf8"), /const DATA = \{/);
});

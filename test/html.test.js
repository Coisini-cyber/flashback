import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exportHtml } from "../src/ui/html.js";
import { makeTempDir } from "./helpers.js";

function recording() {
  return {
    version: 1,
    tool: "flashback",
    entry: "demo.js",
    cwd: "/tmp",
    files: {
      "demo.js": { source: "const x = 1;\nconsole.log(x);\n", lang: "js" },
    },
    steps: [
      { file: "demo.js", line: 1, column: 1, fn: "<anonymous>", t: 5, stack: [{ file: "demo.js", line: 1, fn: "<anonymous>", scopes: [] }], watches: [] },
      {
        file: "demo.js",
        line: 2,
        column: 1,
        fn: "<anonymous>",
        t: 9,
        stack: [
          {
            file: "demo.js",
            line: 2,
            fn: "<anonymous>",
            scopes: [{ type: "local", vars: [{ name: "x", value: { t: "number", v: 1 } }] }],
          },
        ],
        watches: [],
      },
    ],
    output: [{ step: 1, stream: "stdout", text: "1\n" }],
    exit: { reason: "exit" },
  };
}

test("exportHtml writes a self-contained player", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "trace.html");
  exportHtml(recording(), file);
  const html = fs.readFileSync(file, "utf8");
  assert.match(html, /<!doctype html>/);
  assert.match(html, /const DATA = \{/);
  assert.match(html, /class="code"/);
  assert.ok(!html.includes("__DATA__"));
  assert.ok(!html.includes("__STEP__"));
  assert.ok(!html.includes("__COUNT__"));
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
});

test("exportHtml opens on the last step by default", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "trace.html");
  exportHtml(recording(), file);
  const html = fs.readFileSync(file, "utf8");
  assert.match(html, /const state = \{ i: 1,/);
});

test("exportHtml can pin a specific step", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "trace.html");
  exportHtml(recording(), file, { step: 0 });
  assert.match(fs.readFileSync(file, "utf8"), /const state = \{ i: 0,/);
});

test("exportHtml escapes closing script tags in recorded source", () => {
  const rec = recording();
  rec.files["demo.js"].source = 'const html = "</script><script>alert(1)</script>";\n';
  const dir = makeTempDir();
  const file = path.join(dir, "trace.html");
  exportHtml(rec, file);
  const html = fs.readFileSync(file, "utf8");
  assert.ok(html.includes("\\u003c/script>"));
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
});

test("the embedded client script parses", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "trace.html");
  exportHtml(recording(), file);
  const html = fs.readFileSync(file, "utf8");
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  assert.doesNotThrow(() => new Function(script));
});

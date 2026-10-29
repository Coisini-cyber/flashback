import test from "node:test";
import assert from "node:assert/strict";
import { Screen, charWidth, textWidth } from "../src/ui/screen.js";
import { renderView } from "../src/ui/view.js";
import { tokenizeLine } from "../src/ui/syntax.js";

function demoRecording() {
  const source = [
    "function add(a, b) {",
    "  const sum = a + b;",
    "  return sum;",
    "}",
    "",
    "add(1, 2);",
  ].join("\n");
  const mk = (line, fn, vars) => ({
    file: "demo.js",
    line,
    column: 1,
    fn,
    t: 10,
    stack: [
      {
        file: "demo.js",
        line,
        fn,
        scopes: [{ type: "local", name: fn, vars: vars.map(([name, value]) => ({ name, value })) }],
      },
    ],
    watches: [],
  });
  return {
    tool: "flashback",
    entry: "demo.js",
    files: { "demo.js": { source, lang: "js" } },
    steps: [
      mk(2, "add", [["a", { t: "number", v: 1 }], ["b", { t: "number", v: 2 }]]),
      mk(3, "add", [["a", { t: "number", v: 1 }], ["sum", { t: "number", v: 3 }]]),
    ],
    output: [{ step: 1, stream: "stdout", text: "hello\n" }],
    exit: { reason: "exit" },
  };
}

test("charWidth handles ascii, cjk and combining marks", () => {
  assert.equal(charWidth("a"), 1);
  assert.equal(charWidth("中"), 2);
  assert.equal(charWidth("😀"), 2);
  assert.equal(charWidth("\u0301"), 0);
  assert.equal(textWidth("a中b"), 4);
});

test("Screen draws text, wide characters and boxes", () => {
  const screen = new Screen(10, 3).clear();
  screen.text(0, 0, "a中b", { fg: "#ff0000" });
  screen.box(0, 1, 10, 2, { title: "hi" });
  const text = screen.toText();
  assert.ok(text.startsWith("a中"));
  assert.equal(screen.cell(1, 0).ch, "中");
  assert.match(text, /hi/);
  const ansi = screen.toAnsi();
  assert.ok(ansi.includes("38;2;255;0;0"));
});

test("Screen clips text at the edge without splitting wide chars", () => {
  const screen = new Screen(4, 1).clear();
  screen.text(0, 0, "ab中", null);
  assert.equal(screen.toText(), "ab中 ");
});

test("syntax tokenizer tags keywords, strings, numbers and comments", () => {
  const tokens = tokenizeLine('const x = "hi" + 42; // ok');
  const types = tokens.map((t) => t.type);
  assert.ok(types.includes("kw"));
  assert.ok(types.includes("str"));
  assert.ok(types.includes("num"));
  assert.ok(types.includes("com"));
});

test("renderView shows source, values, stack and timeline", () => {
  const rec = demoRecording();
  const screen = renderView(rec, { index: 1, frame: 0 }, { width: 90, height: 24 });
  const text = screen.toText();
  assert.match(text, /flashback/);
  assert.match(text, /demo\.js/);
  assert.match(text, /sum/);
  assert.match(text, /add/);
  assert.match(text, /2\/2/);
  assert.match(text, /line 3/);
});

test("renderView marks a crash in the header", () => {
  const rec = demoRecording();
  rec.exit = { reason: "exception", description: { t: "error", d: "TypeError: nope" } };
  const text = renderView(rec, { index: 1, frame: 0 }, { width: 90, height: 24 }).toText();
  assert.match(text, /TypeError/);
});

test("renderView survives tiny terminals", () => {
  const rec = demoRecording();
  const screen = renderView(rec, { index: 0, frame: 0 }, { width: 40, height: 12 });
  assert.equal(screen.height, 12);
  assert.equal(screen.width, 40);
});

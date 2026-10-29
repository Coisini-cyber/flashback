import test from "node:test";
import assert from "node:assert/strict";
import { diffRecordings, explainRecording, showStep, summarize } from "../src/report.js";

function rec(steps, exit = { reason: "exit" }) {
  return {
    tool: "flashback",
    entry: "demo.js",
    cwd: "/tmp",
    files: { "demo.js": { source: steps.map((s) => `line ${s.line}`).join("\n"), lang: "js" } },
    steps,
    output: [],
    exit,
  };
}

function step(line, fn, vars = {}, extra = {}) {
  return {
    file: "demo.js",
    line,
    column: 1,
    fn,
    t: line * 10,
    stack: [
      {
        file: "demo.js",
        line,
        fn,
        scopes: [{ type: "local", name: fn, vars: Object.entries(vars).map(([name, value]) => ({ name, value })) }],
      },
    ],
    watches: [],
    ...extra,
  };
}

test("diff reports identical execution paths", () => {
  const a = rec([step(1, "main"), step(2, "main")]);
  const b = rec([step(1, "main"), step(2, "main")]);
  const result = diffRecordings(a, b, { color: false });
  assert.equal(result.identical, true);
  assert.match(result.text, /identical/);
});

test("diff finds the first divergence and the state that differs", () => {
  const a = rec([step(1, "main"), step(2, "main", { total: { t: "number", v: 126 } }), step(3, "main")]);
  const b = rec([step(1, "main"), step(2, "main", { total: { t: "number", v: 120 } }), step(3, "main")]);
  const result = diffRecordings(a, b, { color: false });
  assert.equal(result.identical, false);
  assert.equal(result.prefix, 1);
  assert.match(result.text, /step 2/);
  assert.match(result.text, /126 → 120/);
});

test("diff handles a run that stopped early", () => {
  const a = rec([step(1, "main"), step(2, "main")]);
  const b = rec([step(1, "main")]);
  const result = diffRecordings(a, b, { color: false });
  assert.equal(result.identical, false);
  assert.match(result.text, /ran out of steps/);
});

test("summarize counts steps, files and crash info", () => {
  const r = rec([step(1, "main"), step(2, "main")], {
    reason: "exception",
    description: { t: "error", d: "TypeError: boom" },
  });
  r.steps[1].exception = { t: "error", d: "TypeError: boom" };
  const s = summarize(r);
  assert.equal(s.steps, 2);
  assert.equal(s.files, 1);
  assert.equal(s.reason, "exception");
  assert.equal(s.duration, 20);
});

test("explain prints hot lines and changed variables", () => {
  const r = rec([
    step(1, "main", { x: { t: "number", v: 0 } }),
    step(2, "main", { x: { t: "number", v: 1 } }),
    step(3, "main", { x: { t: "number", v: 2 } }),
  ]);
  const text = explainRecording(r, { color: false });
  assert.match(text, /hot lines/);
  assert.match(text, /variables that changed most/);
  assert.match(text, /2\s+x/);
});

test("showStep renders state, stack and watches", () => {
  const r = rec([step(1, "main", { a: { t: "number", v: 1 } })]);
  r.steps[0].stack.push({ file: "demo.js", line: 9, fn: "caller", scopes: [] });
  r.steps[0].watches = [{ expr: "a * 2", value: { t: "number", v: 2 } }];
  const text = showStep(r, 0, { color: false });
  assert.match(text, /demo\.js:1/);
  assert.match(text, /a = 1/);
  assert.match(text, /a \* 2 = 2/);
  assert.match(text, /stack/);
});

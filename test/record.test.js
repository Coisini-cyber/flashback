import test from "node:test";
import assert from "node:assert/strict";
import { recordFixture, recordExample } from "./helpers.js";

test("records a straight-line program line by line", async () => {
  const { recording, file } = await recordExample("binary-search.js");
  assert.ok(recording.steps.length > 15, `expected many steps, got ${recording.steps.length}`);
  assert.equal(recording.exit.reason, "exit");
  assert.ok(recording.files["examples/binary-search.js"].source.includes("function binarySearch"));
  const fnNames = new Set(recording.steps.map((s) => s.fn));
  assert.ok(fnNames.has("binarySearch"));
  for (const step of recording.steps) {
    assert.ok(step.file, "every step has a file");
    assert.ok(step.line > 0, "every step has a line");
    assert.ok(Array.isArray(step.stack) && step.stack.length > 0);
  }
  assert.ok(file.endsWith(".fb.json"));
  assert.ok(recording.steps.some((s) => s.stack[0].scopes?.some((scope) => scope.vars.some((v) => v.name === "lo"))));
});

test("captures the exact state at an uncaught crash", async () => {
  const { recording } = await recordExample("checkout.js");
  assert.equal(recording.exit.reason, "exception");
  assert.match(recording.exit.description.d, /TypeError/);
  const last = recording.steps.at(-1);
  assert.equal(last.file, "examples/checkout.js");
  assert.equal(last.line, 6);
  const order = last.stack[0].scopes.flatMap((s) => s.vars).find((v) => v.name === "order");
  assert.ok(order, "the local order object is captured");
  assert.equal(order.value.t, "object");
  assert.ok(order.value.p.some(([key]) => key === "lineItems"), "shows the field that caused the crash");
});

test("--break starts recording at the requested line", async () => {
  const { recording } = await recordExample("binary-search.js", {
    breakAt: { file: "examples/binary-search.js", line: 9 },
  });
  assert.equal(recording.steps[0].line, 9);
  assert.equal(recording.steps[0].fn, "binarySearch");
});

test("watches are evaluated at every step", async () => {
  const { recording } = await recordExample("binary-search.js", {
    breakAt: { file: "examples/binary-search.js", line: 9 },
    watches: ["lo", "hi"],
  });
  const inside = recording.steps.find((s) => s.fn === "binarySearch");
  assert.ok(inside.watches.length === 2);
  assert.equal(inside.watches[0].expr, "lo");
  assert.equal(inside.watches[0].value.t, "number");
});

test("follows async/await continuations", async () => {
  const { recording } = await recordFixture("async.js");
  assert.ok(recording.steps.length >= 10);
  assert.ok(recording.steps.some((s) => s.fn === "loadUser"));
  assert.ok(recording.steps.some((s) => s.line === 6), "steps into the post-await continuation");
  assert.equal(recording.exit.reason, "exit");
});

test("the same program produces the same execution path", async () => {
  const a = (await recordExample("binary-search.js", { noCache: true })).recording;
  const b = (await recordExample("binary-search.js", { noCache: true })).recording;
  const pathOf = (r) => r.steps.map((s) => `${s.file}:${s.line}`).join("\n");
  assert.equal(pathOf(a), pathOf(b));
});

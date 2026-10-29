import test from "node:test";
import assert from "node:assert/strict";
import { encodeValue, formatValue, sameValue, truncate } from "../src/value.js";

test("formatValue renders primitives like a debugger", () => {
  assert.equal(formatValue({ t: "string", v: "hi" }), '"hi"');
  assert.equal(formatValue({ t: "number", v: 42 }), "42");
  assert.equal(formatValue({ t: "boolean", v: false }), "false");
  assert.equal(formatValue({ t: "null" }), "null");
  assert.equal(formatValue({ t: "undefined" }), "undefined");
  assert.equal(formatValue({ t: "function", d: "function add(a, b) { }" }), "ƒ add()");
  assert.equal(formatValue({ t: "symbol", d: "Symbol(id)" }), "Symbol(id)");
});

test("formatValue summarizes objects and arrays", () => {
  assert.equal(
    formatValue({ t: "array", c: "Array", d: "Array(3)", p: [["0", "1"], ["1", "2"], ["2", "3"]] }),
    "[ 1, 2, 3 ]",
  );
  assert.equal(
    formatValue({ t: "object", c: "Object", d: "Object", p: [["a", "1"], ["b", '"x"']] }),
    "{ a: 1, b: \"x\" }",
  );
  assert.equal(
    formatValue({ t: "object", c: "Object", p: [["a", "1"]], o: 4 }),
    "{ a: 1, +4 }",
  );
});

test("formatValue truncates long values", () => {
  const long = "x".repeat(500);
  const text = formatValue({ t: "string", v: long }, { max: 40 });
  assert.ok(text.length <= 41);
  assert.ok(text.endsWith("…"));
});

test("encodeValue keeps previews compact and lossy", () => {
  const encoded = encodeValue({
    type: "object",
    subtype: "array",
    className: "Array",
    description: "Array(3)",
    preview: {
      type: "object",
      subtype: "array",
      properties: [
        { name: "0", type: "number", value: "1" },
        { name: "1", type: "object", description: "Object" },
        { name: "2", type: "string", value: "hello" },
      ],
    },
  });
  assert.equal(encoded.t, "array");
  assert.equal(encoded.p[2][1], '"hello"');
});

test("encodeValue handles unserializable numbers and long strings", () => {
  assert.equal(encodeValue({ type: "number", unserializableValue: "NaN" }).v, "NaN");
  const big = encodeValue({ type: "string", value: "y".repeat(400) });
  assert.ok(big.v.length <= 240);
});

test("sameValue compares rendered values", () => {
  assert.ok(sameValue({ t: "number", v: 1 }, { t: "number", v: 1 }));
  assert.ok(!sameValue({ t: "number", v: 1 }, { t: "number", v: 2 }));
  assert.ok(!sameValue({ t: "undefined" }, { t: "null" }));
});

test("truncate preserves short strings", () => {
  assert.equal(truncate("abc"), "abc");
  assert.equal(truncate("abcdef", 5), "abcd…");
});

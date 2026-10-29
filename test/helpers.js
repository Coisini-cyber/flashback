import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { record } from "../src/record.js";

const root = path.resolve(import.meta.dirname, "..");

export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "flashback-test-"));
}

const cache = new Map();

export async function recordFixture(fixture, options = {}) {
  const { noCache, ...recordOptions } = options;
  const key = `${fixture}:${JSON.stringify(recordOptions)}`;
  if (!noCache && cache.has(key)) return cache.get(key);
  const dir = makeTempDir();
  const promise = record({
    script: path.join("test", "fixtures", fixture),
    cwd: root,
    dir,
    maxSteps: 500,
    stallMs: 5000,
    idleMs: 800,
    ...recordOptions,
  });
  cache.set(key, promise);
  return promise;
}

export async function recordExample(name, options = {}) {
  const { noCache, ...recordOptions } = options;
  const key = `example:${name}:${JSON.stringify(recordOptions)}`;
  if (!noCache && cache.has(key)) return cache.get(key);
  const dir = makeTempDir();
  const promise = record({
    script: path.join("examples", name),
    cwd: root,
    dir,
    maxSteps: 500,
    stallMs: 5000,
    idleMs: 800,
    ...recordOptions,
  });
  cache.set(key, promise);
  return promise;
}

export { root };

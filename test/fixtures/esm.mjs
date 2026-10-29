import { readFileSync } from "node:fs";

export function slug(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const source = readFileSync(new URL(import.meta.url), "utf8");
const title = slug("Hello ESM World");

console.log(title, source.length > 0, title.length);

import fs from "node:fs";
import path from "node:path";
import { record } from "../src/record.js";
import { loadRecording } from "../src/store.js";
import { exportHtml } from "../src/ui/html.js";
import { renderView } from "../src/ui/view.js";
import { screenToSvg } from "./ansi-svg.js";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);
fs.mkdirSync("docs", { recursive: true });
fs.mkdirSync("examples", { recursive: true });

async function recordExample(script, out) {
  const result = await record({
    script,
    cwd: root,
    out,
    maxSteps: 600,
    stallMs: 10_000,
    idleMs: 1200,
    onProgress: () => {},
  });
  process.stderr.write(`${out}: ${result.recording.steps.length} steps (${result.reason})\n`);
  return result.recording;
}

const search = await recordExample("examples/binary-search.js", "examples/binary-search.fb.json");
const checkout = await recordExample("examples/checkout.js", "examples/checkout.fb.json");

exportHtml(search, path.join(root, "examples/binary-search.html"));
exportHtml(checkout, path.join(root, "examples/checkout.html"));
process.stderr.write("exported HTML players\n");

function findLoopState(rec) {
  let best = null;
  for (let i = 0; i < rec.steps.length; i++) {
    const step = rec.steps[i];
    const frame = step.stack?.[0];
    const vars = new Map((frame?.scopes ?? []).flatMap((s) => s.vars).map((v) => [v.name, v.value]));
    if (vars.get("lo")?.v === 7 && vars.get("hi")?.v === 7) {
      best = i;
      break;
    }
  }
  if (best === null) best = rec.steps.findIndex((s) => s.fn === "binarySearch" && s.line === 10);
  return Math.max(0, best);
}

const searchIndex = findLoopState(search);
const screen = renderView(search, { index: searchIndex, frame: 0 }, { width: 100, height: 30 });
fs.writeFileSync(
  path.join(root, "docs/demo.svg"),
  screenToSvg(screen, {
    title: "flashback — examples/binary-search.js",
    subtitle: "step backwards through a recorded run",
  }),
);

const crashIndex = checkout.steps.length - 1;
const crashScreen = renderView(checkout, { index: crashIndex, frame: 0 }, { width: 100, height: 26 });
fs.writeFileSync(
  path.join(root, "docs/crash.svg"),
  screenToSvg(crashScreen, {
    title: "flashback — examples/checkout.js",
    subtitle: "the crash, with the state that caused it",
  }),
);

process.stderr.write(`demo frames: search step ${searchIndex + 1}/${search.steps.length}, crash step ${crashIndex + 1}/${checkout.steps.length}\n`);

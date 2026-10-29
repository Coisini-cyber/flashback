import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Recorder } from "./record.js";
import {
  defaultDir,
  loadRecording,
  listRecordings,
  humanDuration,
  humanSize,
  resolveRecording,
} from "./store.js";
import {
  diffRecordings,
  explainRecording,
  formatExit,
  listTable,
  showStep,
  summarize,
} from "./report.js";

const VERSION = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
).version;

const COLORS = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== "dumb";

function fail(message) {
  process.stderr.write(`flashback: ${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv, spec) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (/^-[A-Za-z]$/.test(arg)) arg = `--${arg.slice(1)}`;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const def = spec[name];
    if (!def) throw new Error(`unknown option --${name}`);
    if (def.type === "boolean") {
      flags[name] = inline === undefined ? true : inline !== "false";
    } else if (def.type === "list") {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`--${name} needs a value`);
      (flags[name] ??= []).push(value);
    } else {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`--${name} needs a value`);
      flags[name] = value;
    }
  }
  return { positionals, flags };
}

function intFlag(value, fallback, { min = 0 } = {}) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) throw new Error(`expected a number >= ${min}, got ${value}`);
  return Math.floor(n);
}

function parseBreak(value) {
  const match = /^(.*):(\d+)$/.exec(value);
  if (!match) throw new Error(`--break expects file:line (for example src/app.js:42)`);
  return { file: match[1], line: Number(match[2]) };
}

const HELP = `flashback — time-travel debugging for Node.js

  Record a run, then step backwards through it.

USAGE
  flashback run <script> [args...] [options]     record a run
  flashback replay [recording]                  open the time-travel TUI
  flashback export [recording] [-o out.html]    build a shareable HTML replay
  flashback show [recording] [--step N]         print one step as text
  flashback explain [recording]                 summarize a recording
  flashback diff <a> <b>                        compare two runs, find divergence
  flashback ls                                 list recordings in .flashback/
  flashback help

RUN OPTIONS
  --break <file:line>    start recording at a breakpoint instead of the first line
  --max-steps <n>        stop after n steps (default 3000)
  --watch <expr>         evaluate an expression at every step (repeatable)
  --out <file>           where to write the recording
  --include <dir>        only record files under this directory (default: cwd)
  --all                  record files outside the working directory too
  --cwd <dir>            working directory for the target process
  --stall <ms>           abort after this much time without a step (default 30000)
  --no-replay            do not open the TUI after recording
  --quiet                no live progress line

EXAMPLES
  flashback run examples/crash.js
  flashback run server.js --break src/handler.js:12
  flashback run app.js --watch "user.id" -- --port 3000
  flashback export .flashback/latest.fb.json -o bug.html
`;

export async function main(argv) {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "run":
      case "record":
        return await cmdRun(rest);
      case "replay":
      case "r":
        return await cmdReplay(rest);
      case "export":
        return await cmdExport(rest);
      case "show":
        return cmdShow(rest);
      case "explain":
        return cmdExplain(rest);
      case "diff":
        return cmdDiff(rest);
      case "ls":
      case "list":
        return cmdList(rest);
      case "help":
      case "--help":
      case "-h":
        process.stdout.write(HELP);
        return;
      case "version":
      case "--version":
      case "-v":
        process.stdout.write(`flashback ${VERSION}\n`);
        return;
      case undefined:
        process.stdout.write(HELP);
        return;
      default:
        fail(`unknown command "${command}". Run \`flashback help\`.`);
        return;
    }
  } catch (err) {
    fail(err?.message ?? String(err));
  }
}

async function cmdRun(argv) {
  const { positionals, flags } = parseArgs(argv, {
    "break": { type: "string" },
    "max-steps": { type: "string" },
    "watch": { type: "list" },
    "out": { type: "string" },
    "cwd": { type: "string" },
    "include": { type: "string" },
    "dir": { type: "string" },
    "all": { type: "boolean" },
    "no-replay": { type: "boolean" },
    "quiet": { type: "boolean" },
    "stall": { type: "string" },
  });
  const script = positionals[0];
  if (!script) throw new Error("usage: flashback run <script> [args...] (see `flashback help`)");

  const cwd = path.resolve(flags.cwd ? path.resolve(flags.cwd) : process.cwd());
  const recorder = new Recorder({
    script,
    args: positionals.slice(1),
    cwd,
    breakAt: flags.break ? parseBreak(flags.break) : null,
    maxSteps: intFlag(flags["max-steps"], 3000, { min: 1 }),
    watches: flags.watch ?? [],
    includeDir: flags.include ?? null,
    all: Boolean(flags.all),
    out: flags.out ?? null,
    dir: flags.dir ? path.resolve(cwd, flags.dir) : defaultDir(cwd),
    stallMs: intFlag(flags.stall, 30_000, { min: 100 }),
    onOutput: (text) => process.stdout.write(text),
    onProgress: flags.quiet || !process.stderr.isTTY ? null : createProgress(),
  });

  const onSigint = () => {
    recorder.stop("interrupted");
  };
  process.on("SIGINT", onSigint);
  try {
    await recorder.start();
  } catch (err) {
    process.off("SIGINT", onSigint);
    throw err;
  }
  const { recording, file } = await recorder.done;
  process.off("SIGINT", onSigint);
  clearProgress();

  const s = summarize(recording);
  const summary = [
    `recorded ${s.steps} steps in ${humanDuration(s.duration)} · ${humanSize(file && fs.existsSync(file) ? fs.statSync(file).size : 0)}`,
    s.reason === "exception" ? `crashed: ${s.exception?.d ?? "uncaught exception"}` : formatExit(s),
    file,
  ];
  process.stderr.write(
    `${COLORS ? "\x1b[35m◆\x1b[0m" : "*"} ${summary[0]}\n  ${summary[1]}\n  ${file}\n`,
  );
  if (flags.break && !recorder.hitBreakpoint) {
    process.stderr.write(`  ! breakpoint ${flags.break} was never hit\n`);
  }
  if (s.steps === 0) {
    process.stderr.write("  ! nothing was recorded\n");
    return;
  }
  if (!file) {
    process.stderr.write("  ! the recording could not be saved\n");
    process.exitCode = 1;
    return;
  }
  const autoReplay = process.stdout.isTTY && !flags["no-replay"] && process.stdin.isTTY;
  if (autoReplay) {
    const { replay } = await import("./ui/tui.js");
    await replay(file, { recording });
  } else {
    process.stderr.write(`  replay: flashback replay ${path.relative(cwd, file)}\n`);
  }
}

function createProgress() {
  let last = 0;
  return (info) => {
    const now = Date.now();
    if (now - last < 80) return;
    last = now;
    if (info.phase !== "record") return;
    const loc = info.file ? ` ${info.file}:${info.line}` : "";
    process.stderr.write(`\r\x1b[2K recording… ${info.steps} steps${loc}`);
  };
}

function clearProgress() {
  if (process.stderr.isTTY) process.stderr.write("\r\x1b[2K");
}

async function cmdReplay(argv) {
  const { positionals, flags } = parseArgs(argv, { "step": { type: "string" }, "no-color": { type: "boolean" } });
  const file = resolveRecording(positionals[0]);
  const recording = loadRecording(file);
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    const index = flags.step ? intFlag(flags.step, 1, { min: 1 }) - 1 : recording.steps.length - 1;
    process.stdout.write(showStep(recording, index, { color: COLORS }) + "\n");
    process.stderr.write("(not a TTY — printing the final step; use `flashback show --step N`)\n");
    return;
  }
  const { replay } = await import("./ui/tui.js");
  await replay(file, { recording, startStep: flags.step ? intFlag(flags.step, 1, { min: 1 }) - 1 : 0 });
}

async function cmdExport(argv) {
  const { positionals, flags } = parseArgs(argv, {
    "out": { type: "string" },
    "o": { type: "string" },
    "step": { type: "string" },
    "open": { type: "boolean" },
  });
  const file = resolveRecording(positionals[0]);
  const recording = loadRecording(file);
  const output = path.resolve(flags.out ?? flags.o ?? file.replace(/\.fb\.json$/, "") + ".html");
  const { exportHtml } = await import("./ui/html.js");
  exportHtml(recording, output, { step: flags.step ? intFlag(flags.step, 1, { min: 1 }) - 1 : undefined });
  process.stderr.write(`exported ${recording.steps.length} steps → ${output}\n`);
  if (flags.open) {
    const { spawn } = await import("node:child_process");
    const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", output] : [output];
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  }
}

function cmdShow(argv) {
  const { positionals, flags } = parseArgs(argv, { "step": { type: "string" }, "json": { type: "boolean" } });
  const file = resolveRecording(positionals[0]);
  const recording = loadRecording(file);
  const index = flags.step ? intFlag(flags.step, 1, { min: 1 }) - 1 : recording.steps.length - 1;
  if (index < 0 || index >= recording.steps.length) throw new Error(`step ${index + 1} does not exist`);
  if (flags.json) {
    process.stdout.write(JSON.stringify(recording.steps[index], null, 2) + "\n");
    return;
  }
  process.stdout.write(showStep(recording, index, { color: COLORS }) + "\n");
}

function cmdExplain(argv) {
  const { positionals } = parseArgs(argv, {});
  const file = resolveRecording(positionals[0]);
  const recording = loadRecording(file);
  process.stdout.write(explainRecording(recording, { color: COLORS }) + "\n");
}

function cmdDiff(argv) {
  const { positionals } = parseArgs(argv, { json: { type: "boolean" } });
  if (positionals.length < 2) throw new Error("usage: flashback diff <recording-a> <recording-b>");
  const a = loadRecording(resolveRecording(positionals[0]));
  const b = loadRecording(resolveRecording(positionals[1]));
  const result = diffRecordings(a, b, { color: COLORS });
  process.stdout.write(result.text + "\n");
  if (!result.identical) process.exitCode = 1;
}

function cmdList(argv) {
  parseArgs(argv, {});
  const dir = defaultDir();
  const items = listRecordings(dir).map((item) => {
    try {
      const rec = loadRecording(item.file);
      return { ...item, steps: rec.steps.length, entry: rec.entry };
    } catch {
      return item;
    }
  });
  process.stdout.write(listTable(items, { color: COLORS }) + "\n");
  if (items.length) process.stdout.write(`\n  ${items.length} recording${items.length === 1 ? "" : "s"} in ${dir}\n`);
}

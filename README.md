# flashback

**Time-travel debugging for Node.js.** Record a run once, then step **backwards** through every line, variable and call frame. Share the whole execution as one self-contained HTML file.

<p>
  <a href="https://github.com/Coisini-cyber/flashback/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/Coisini-cyber/flashback/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22-3c873a">
  <img alt="dependencies" src="https://img.shields.io/badge/runtime%20dependencies-0-3c873a">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
</p>

<img src="docs/demo.svg" alt="flashback replaying a binary search, showing lo changing from 6 to 7 on the line that exits the loop" width="100%">

`console.log` is write-only. A live debugger is live-only — the moment you need to inspect is already gone. `flashback` records the execution first, so you can move through it in both directions afterwards, and hand the exact trace to someone else.

**Live demo:** [open a crash replay](https://coisini-cyber.github.io/flashback/checkout.html) · [step backwards through a binary search](https://coisini-cyber.github.io/flashback/search.html)

```
$ flashback run examples/checkout.js

  ✖ crashed: TypeError: Cannot read properties of undefined (reading 'reduce')
  recorded 5 steps · .flashback/2026-10-29T04-52-17-checkout-js.fb.json

$ flashback replay
```

<img src="docs/crash.svg" alt="flashback showing the crash site with the order object that caused it" width="100%">

The stack says `order.items is undefined`. The recording says why: the payload called the field `lineItems`. No re-run, no extra logs.

## Install

Requires **Node.js 22+** (it uses the built-in WebSocket client). There are **zero runtime dependencies**.

```bash
git clone https://github.com/Coisini-cyber/flashback
cd flashback
npm link          # puts `flashback` on your PATH
```

Without installing:

```bash
node bin/flashback.js run examples/binary-search.js
```

## Quick start

```bash
flashback run app.js                 # record, then open the replay TUI
flashback run app.js --no-replay     # just record
flashback replay                     # open the newest recording
flashback export -o bug.html         # shareable player, opens at the last step
flashback explain                    # text summary of the newest recording
```

Record a server without recording its startup:

```bash
flashback run server.js --break src/handler.js:42
```

When the breakpoint is hit, every line after it is recorded. Stop with `Ctrl+C` — the trace is saved before the process is killed.

Watch an expression over time:

```bash
flashback run worker.js --watch "queue.length" --watch "job.id"
```

## What you get

- **Step backwards.** `←`/`→` moves one step, `Shift` moves ten. Every step carries its locals, closure variables, `this`, watches and call stack.
- **Crash archaeology.** Uncaught exceptions are recorded at the throw site (or at the last frame before V8 unwinds), with the exact state that caused them.
- **A shareable trace.** `flashback export` writes a single HTML file with a source viewer, a state pane, a timeline and keyboard controls. It works offline and can be attached to a bug report or a PR.

<img src="docs/replay.png" alt="The exported HTML player showing the crash, the order object and the call stack" width="100%">

- **Run diffing.** `flashback diff before.fb.json after.fb.json` finds the first step where two runs diverge and prints the variable that changed. Exit code `1` on divergence makes it usable in CI.
- **Watches.** Expressions are evaluated on every step and stored in the trace, so you can see a value evolve after the fact.
- **Local and private.** No network, no telemetry, no LLM calls. Recordings are plain JSON on your disk.

## Commands

| Command | What it does |
| --- | --- |
| `flashback run <script> [args...]` | Record a run. `--break file:line`, `--max-steps n`, `--watch expr`, `--include dir`, `--all`, `--out file` |
| `flashback replay [recording]` | Open the time-travel TUI (newest recording by default) |
| `flashback export [recording] -o out.html` | Build a self-contained HTML player |
| `flashback show [recording] --step N` | Print one step as text (`--json` for scripts) |
| `flashback explain [recording]` | Hot lines, variable churn, functions by step count, crash site |
| `flashback diff <a> <b>` | Compare two runs; exit `1` if they diverge |
| `flashback ls` | List recordings in `.flashback/` |

Pass arguments to the target after `--`:

```bash
flashback run app.js -- --port 3000 --verbose
```

### Replay keys

| Key | Action |
| --- | --- |
| `←` `→` / `h` `l` | previous / next step |
| `Shift` + arrows / `H` `L` | jump 10 steps |
| `↑` `↓` / `j` `k` | select a call frame |
| `space` | play / pause |
| `g` | go to a step number |
| `/` | search the source and jump to the first matching step |
| `o` | console output up to the current step |
| `e` | export the HTML player next to the recording |
| `?` | help |
| `q` | quit |

## How it works

`flashback` spawns the target with `--inspect-brk` on a private loopback port, attaches over the Chrome DevTools Protocol using Node's built-in `WebSocket`, and single-steps the debugger.

- Node internals and `node_modules` are blackboxed, so a step only stops in your code. Frames that still slip through are stepped out of automatically.
- On every pause, scopes are read with `Runtime.getProperties` and stored as bounded previews: strings are truncated, object previews keep the first twelve properties, and only the top three frames get scopes. A recording stays small enough to email.
- The recorder starts at the first statement of the entry file, or at `--break`, instead of stepping through Node's module bootstrap.
- When execution returns to the event loop and nothing pauses again, the run is considered finished. Uncaught exceptions are also captured through `Runtime.exceptionThrown`, because some errors thrown inside native methods never produce a debugger pause.

Recordings are JSON: sources, steps, scopes, watches and stdout. The TUI and the HTML player are two views over the same file.

## Limits (read this before recording a 10-million-iteration loop)

- **Speed.** A step costs a few milliseconds. `--max-steps` defaults to 3000 for a reason. Use `--break` to record only the interesting region.
- **Snapshots are previews, not a heap dump.** Nested objects are shown one level deep; long strings are cut. Use `--watch` for a precise value.
- **Async work that waits longer than the idle window (~1.2s) ends the recording.** Await continuations are fine; a `setTimeout(…, 5000)` scheduled at the end is not.
- **Node 22+ on the same machine.** No remote debugging, no worker threads, no TypeScript source maps yet.
- This is a debugging aid, not a profiler and not a production recorder.

## Why not just…

| | `console.log` | `node --inspect` | `flashback` |
| --- | --- | --- | --- |
| Inspect a value after the fact | no | no | yes |
| Step backwards | no | no | yes |
| Works on a crash | partial | until it exits | yes, trace is kept |
| Share the exact run | paste logs | screen share | one HTML file |
| Setup | edit code | attach at the right moment | one command |

## Development

```bash
npm test          # unit + integration tests (spawns real Node processes)
npm run demo      # regenerate examples/*.fb.json, the HTML players and docs/*.svg
```

The test suite records real fixtures and asserts on execution paths, crash state, watches, async continuations and the exported HTML.

## License

MIT

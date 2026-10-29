import { formatValue } from "./value.js";
import { humanDuration, humanSize } from "./store.js";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";

export function paint(enabled = true) {
  const wrap = (code) => (text) => (enabled ? `${code}${text}${RESET}` : String(text));
  return {
    dim: wrap(DIM),
    bold: wrap(BOLD),
    red: wrap(RED),
    green: wrap(GREEN),
    yellow: wrap(YELLOW),
    blue: wrap(BLUE),
    magenta: wrap(MAGENTA),
    cyan: wrap(CYAN),
  };
}

export function flattenVars(step, frameIndex = 0) {
  const out = new Map();
  const frame = step?.stack?.[frameIndex];
  for (const scope of frame?.scopes ?? []) {
    for (const v of scope.vars) out.set(v.name, v.value);
  }
  return out;
}

function changes(before, after) {
  const added = [];
  const changed = [];
  const removed = [];
  for (const [name, value] of after) {
    if (!before.has(name)) added.push([name, value]);
    else if (formatValue(before.get(name), { max: 10_000 }) !== formatValue(value, { max: 10_000 })) {
      changed.push([name, before.get(name), value]);
    }
  }
  for (const name of before.keys()) if (!after.has(name)) removed.push(name);
  return { added, changed, removed };
}

export function summarize(rec) {
  const steps = rec.steps ?? [];
  const last = steps.at(-1);
  const duration = last ? last.t : 0;
  const outputBytes = (rec.output ?? []).reduce((n, o) => n + o.text.length, 0);
  return {
    steps: steps.length,
    files: Object.keys(rec.files ?? {}).length,
    duration,
    outputLines: (rec.output ?? []).length,
    outputBytes,
    reason: rec.exit?.reason ?? "unknown",
    exception: rec.exit?.description ?? last?.exception ?? null,
    last,
  };
}

export function formatExit(summary) {
  switch (summary.reason) {
    case "exception":
      return `crashed: ${summary.exception?.d ?? "uncaught exception"}`;
    case "max-steps":
      return "stopped at the step limit";
    case "exit":
      return "process exited";
    case "interrupted":
      return "interrupted";
    case "timeout":
      return "timed out";
    case "error":
      return "recorder error";
    default:
      return summary.reason;
  }
}

export function showStep(rec, index, { color = true } = {}) {
  const c = paint(color);
  const step = rec.steps[index];
  if (!step) return "no such step";
  const lines = [];
  const head = [
    c.bold(`${step.file}:${step.line}`),
    c.cyan(step.fn),
    c.dim(`step ${index + 1}/${rec.steps.length}`),
    c.dim(`+${step.t}ms`),
  ].join("  ");
  lines.push(head);
  if (step.exception) lines.push(c.red(`  ✖ ${formatValue(step.exception, { max: 400 })}`));

  const prev = index > 0 ? rec.steps[index - 1] : null;
  const before = prev ? flattenVars(prev, 0) : new Map();
  const frame = step.stack?.[0];
  if (frame?.scopes?.length) {
    for (const scope of frame.scopes) {
      lines.push(c.dim(`  ${scope.type}`));
      for (const v of scope.vars) {
        const isNew = !before.has(v.name);
        const changed = !isNew && formatValue(before.get(v.name), { max: 10_000 }) !== formatValue(v.value, { max: 10_000 });
        const marker = changed ? c.yellow("•") : isNew ? c.green("+") : " ";
        const rendered = c.cyan(v.name) + " = " + formatValue(v.value, { max: 200 });
        const was = changed ? c.dim(`   (was ${formatValue(before.get(v.name), { max: 80 })})`) : "";
        lines.push(`   ${marker} ${rendered}${was}`);
      }
    }
  }
  if (step.watches?.length) {
    lines.push(c.dim("  watches"));
    for (const w of step.watches) {
      lines.push(`    ${c.cyan(w.expr)} = ${w.error ? c.red(w.error) : formatValue(w.value)}`);
    }
  }
  if (step.stack?.length > 1) {
    lines.push(c.dim("  stack"));
    for (const [i, frame] of step.stack.entries()) {
      lines.push(c.dim(`   ${i === 0 ? "▸" : " "} ${frame.fn}  ${frame.file}:${frame.line}`));
    }
  }
  return lines.join("\n");
}

export function explainRecording(rec, { color = true } = {}) {
  const c = paint(color);
  const s = summarize(rec);
  const lines = [];
  lines.push(c.bold(`flashback ${c.magenta("◆")} ${rec.entry}`));
  lines.push(
    `  ${c.cyan(String(s.steps))} steps  ${c.dim("·")}  ${s.files} files  ${c.dim("·")}  ${humanDuration(s.duration)} recorded  ${c.dim("·")}  ${humanSize(JSON.stringify(rec).length)}`,
  );
  lines.push(`  ${s.reason === "exception" ? c.red("✖ " + formatExit(s)) : c.dim(formatExit(s))}`);
  lines.push("");

  const hot = new Map();
  for (const step of rec.steps) {
    const key = `${step.file}:${step.line}`;
    const entry = hot.get(key) ?? { step, count: 0 };
    entry.count++;
    hot.set(key, entry);
  }
  const top = [...hot.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8);
  if (top.length) {
    lines.push(c.dim("  hot lines"));
    const max = top[0][1].count;
    for (const [key, { step, count }] of top) {
      const bar = "█".repeat(Math.max(1, Math.round((count / max) * 18)));
      lines.push(`   ${c.yellow(bar)} ${String(count).padStart(4)}  ${c.bold(key)}  ${c.dim(step.fn)}`);
    }
    lines.push("");
  }

  const churn = new Map();
  const prevByName = new Map();
  for (const step of rec.steps) {
    const current = flattenVars(step, 0);
    for (const [name, value] of current) {
      const prev = prevByName.get(name);
      if (prev && formatValue(prev, { max: 10_000 }) !== formatValue(value, { max: 10_000 })) {
        churn.set(name, (churn.get(name) ?? 0) + 1);
      }
    }
    prevByName.clear();
    for (const [name, value] of current) prevByName.set(name, value);
  }
  const churnTop = [...churn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (churnTop.length) {
    lines.push(c.dim("  variables that changed most"));
    const max = churnTop[0][1];
    for (const [name, count] of churnTop) {
      const bar = "░".repeat(Math.max(1, Math.round((count / max) * 18)));
      lines.push(`   ${c.blue(bar)} ${String(count).padStart(4)}  ${c.cyan(name)}`);
    }
    lines.push("");
  }

  const fns = new Map();
  for (const step of rec.steps) fns.set(step.fn, (fns.get(step.fn) ?? 0) + 1);
  const fnTop = [...fns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (fnTop.length) {
    lines.push(c.dim("  functions by steps"));
    for (const [fn, count] of fnTop) lines.push(`   ${String(count).padStart(4)}  ${c.cyan(fn)}`);
    lines.push("");
  }

  if (rec.exit?.reason === "exception" && s.last) {
    lines.push(c.red("  crash site"));
    lines.push(`   ${c.bold(`${s.last.file}:${s.last.line}`)}  ${c.dim(s.last.fn)}`);
  }
  return lines.join("\n");
}

function stepKey(step) {
  return `${step.file}:${step.line}`;
}

function firstStateDivergence(A, B) {
  const count = Math.min(A.length, B.length);
  for (let i = 0; i < count; i++) {
    const va = flattenVars(A[i], 0);
    const vb = flattenVars(B[i], 0);
    const d = changes(va, vb);
    if (d.changed.length || d.added.length || d.removed.length) return i;
  }
  return -1;
}

export function diffRecordings(a, b, { color = true } = {}) {
  const c = paint(color);
  const A = a.steps ?? [];
  const B = b.steps ?? [];
  let prefix = 0;
  while (prefix < A.length && prefix < B.length && stepKey(A[prefix]) === stepKey(B[prefix])) prefix++;
  let samePath = false;
  if (prefix === A.length && prefix === B.length) {
    const stateIndex = firstStateDivergence(A, B);
    if (stateIndex === -1) {
      return {
        identical: true,
        text: c.green(`✓ identical execution path and state (${A.length} steps)`),
        prefix,
        indexA: -1,
        indexB: -1,
      };
    }
    prefix = stateIndex;
    samePath = true;
  }
  let suffix = 0;
  while (
    suffix < A.length - prefix &&
    suffix < B.length - prefix &&
    stepKey(A[A.length - 1 - suffix]) === stepKey(B[B.length - 1 - suffix])
  ) {
    suffix++;
  }
  const indexA = prefix;
  const indexB = prefix;
  const sa = A[indexA];
  const sb = B[indexB];
  const lines = [];
  lines.push(c.bold(samePath ? "state divergence" : "execution divergence"));
  lines.push(`  first difference at step ${prefix + 1}`);
  if (sa) lines.push(`  ${c.magenta("A")} ${c.bold(`${sa.file}:${sa.line}`)}  ${c.dim(sa.fn)}  ${c.dim(`(${A.length} steps)`)}`);
  else lines.push(`  ${c.magenta("A")} ${c.dim("ran out of steps")}`);
  if (sb) lines.push(`  ${c.cyan("B")} ${c.bold(`${sb.file}:${sb.line}`)}  ${c.dim(sb.fn)}  ${c.dim(`(${B.length} steps)`)}`);
  else lines.push(`  ${c.cyan("B")} ${c.dim("ran out of steps")}`);

  if (sa && sb) {
    const varsA = flattenVars(sa, 0);
    const varsB = flattenVars(sb, 0);
    const d = changes(varsA, varsB);
    if (d.changed.length || d.added.length || d.removed.length) {
      lines.push("");
      lines.push(c.dim("  state at divergence"));
      for (const [name, before, after] of d.changed) {
        lines.push(`   ${c.yellow("~")} ${c.cyan(name)}: ${formatValue(before, { max: 60 })} ${c.dim("→")} ${formatValue(after, { max: 60 })}`);
      }
      for (const [name, value] of d.added) {
        lines.push(`   ${c.green("+")} ${c.cyan(name)} = ${formatValue(value, { max: 80 })}`);
      }
      for (const name of d.removed) {
        lines.push(`   ${c.red("-")} ${c.cyan(name)}`);
      }
    }
    const prevA = indexA > 0 ? A[indexA - 1] : null;
    const prevB = indexB > 0 ? B[indexB - 1] : null;
    if (prevA && prevB) {
      lines.push("");
      lines.push(c.dim(`  last common step: ${prevA.file}:${prevA.line} ${prevA.fn}`));
    }
  }
  if (suffix) lines.push("", c.dim(`  ${suffix} identical steps after the divergence`));
  return { identical: false, text: lines.join("\n"), prefix, indexA, indexB };
}

export function listTable(items, { color = true } = {}) {
  const c = paint(color);
  if (!items.length) return c.dim("no recordings yet — run `flashback run <script>`");
  const lines = [];
  lines.push(c.dim("  RECORDING                              STEPS   SIZE     AGE"));
  for (const item of items) {
    const age = Math.round((Date.now() - item.mtime) / 1000);
    const ageText = age < 60 ? `${age}s` : age < 3600 ? `${Math.round(age / 60)}m` : `${Math.round(age / 3600)}h`;
    lines.push(
      `  ${c.cyan(item.name.padEnd(38))} ${String(item.steps ?? "?").padStart(5)}   ${humanSize(item.size).padStart(7)}  ${ageText.padStart(4)}`,
    );
  }
  return lines.join("\n");
}

import { Screen, textWidth } from "./screen.js";
import { tokenizeLine, SYNTAX_COLORS } from "./syntax.js";
import { formatValue } from "../value.js";

export const PALETTE = {
  bg: "#0d1117",
  panel: "#0d1117",
  header: "#161b22",
  border: "#2a313c",
  text: "#d7deeb",
  dim: "#6e7681",
  faint: "#3d444d",
  accent: "#c678dd",
  blue: "#61afef",
  green: "#98c379",
  red: "#e06c75",
  amber: "#e5c07b",
  current: "#1b2433",
  selected: "#22304a",
  cyan: "#56b6c2",
};

const VALUE_COLORS = {
  string: PALETTE.green,
  number: PALETTE.amber,
  boolean: PALETTE.amber,
  undefined: PALETTE.dim,
  null: PALETTE.dim,
  function: PALETTE.blue,
  symbol: PALETTE.cyan,
  error: PALETTE.red,
  object: PALETTE.text,
  array: PALETTE.text,
};

export function fit(text, width) {
  const s = String(text ?? "");
  if (width <= 0) return "";
  let out = "";
  let w = 0;
  for (const char of s) {
    const cw = textWidth(char);
    if (w + cw > width) return out + (width > 1 ? "…" : "");
    out += char;
    w += cw;
  }
  return out;
}

function pad(text, width) {
  const clipped = fit(text, width);
  const remaining = width - textWidth(clipped);
  return clipped + " ".repeat(Math.max(0, remaining));
}

function shortPath(rel) {
  const parts = rel.split("/");
  if (parts.length <= 2) return rel;
  return parts.slice(-2).join("/");
}

function errorBadge(rec) {
  if (rec.exit?.reason !== "exception") return null;
  const desc = rec.exit.description;
  const text = desc?.d ?? "uncaught exception";
  const name = desc?.c ?? /^(\w*Error)/.exec(text)?.[1] ?? "error";
  return name;
}

function stateOf(rec, index, frameIndex) {
  const step = rec.steps[index];
  if (!step) return { step: null, frame: null, scopes: [], changed: new Map() };
  const prev = index > 0 ? rec.steps[index - 1] : null;
  const frame = step.stack?.[Math.min(frameIndex, (step.stack?.length ?? 1) - 1)] ?? step.stack?.[0] ?? null;
  const prevFrame = prev?.stack?.[Math.min(frameIndex, (prev.stack?.length ?? 1) - 1)] ?? null;
  const previous = new Map();
  if (prevFrame && prevFrame.fn === frame?.fn) {
    for (const scope of prevFrame.scopes ?? []) {
      for (const v of scope.vars) previous.set(v.name, v.value);
    }
  }
  const changed = new Map();
  for (const scope of frame?.scopes ?? []) {
    for (const v of scope.vars) {
      if (!previous.has(v.name)) continue;
      if (formatValue(previous.get(v.name), { max: 10_000 }) !== formatValue(v.value, { max: 10_000 })) {
        changed.set(v.name, previous.get(v.name));
      }
    }
  }
  return { step, frame, scopes: frame?.scopes ?? [], changed };
}

function drawHeader(screen, rec, index, frameIndex) {
  const { width } = screen;
  screen.fill(0, 0, width, 1, { bg: PALETTE.header });
  let x = 1;
  x += screen.text(x, 0, "◆", { fg: PALETTE.accent, bg: PALETTE.header, bold: true });
  x += screen.text(x, 0, " flashback", { fg: PALETTE.text, bg: PALETTE.header, bold: true });
  x += screen.text(x, 0, "  ", { bg: PALETTE.header });
  x += screen.text(x, 0, shortPath(rec.entry), { fg: PALETTE.dim, bg: PALETTE.header });

  const badge = errorBadge(rec);
  const right = badge
    ? `✖ ${badge}  ·  step ${index + 1}/${rec.steps.length} `
    : `step ${index + 1}/${rec.steps.length}  ·  frame ${frameIndex + 1}/${Math.max(1, rec.steps[index]?.stack?.length ?? 1)} `;
  const rightWidth = textWidth(right);
  if (rightWidth < width - x - 2) {
    screen.text(width - rightWidth - 1, 0, right, {
      fg: badge ? PALETTE.red : PALETTE.dim,
      bg: PALETTE.header,
      bold: Boolean(badge),
    });
  }
  screen.hline(0, 1, width, { fg: PALETTE.border });
}

function drawSource(screen, rec, step, { x, y, w, h }) {
  const file = rec.files?.[step.file];
  if (!file) {
    screen.text(x + 1, y, "source not recorded", { fg: PALETTE.dim });
    return;
  }
  const lines = file.source.split(/\r?\n/);
  const digits = String(lines.length).length;
  const gutter = digits + 2;
  const headerY = y;
  screen.text(x + 1, headerY, shortPath(step.file), { fg: PALETTE.text, bold: true });
  screen.text(x + 1 + textWidth(shortPath(step.file)) + 1, headerY, `line ${step.line}`, {
    fg: PALETTE.faint,
  });

  const top = y + 1;
  const rows = h - 1;
  if (rows <= 0) return;
  const center = Math.floor(rows / 2);
  let start = Math.max(0, step.line - 1 - center);
  if (start + rows > lines.length) start = Math.max(0, lines.length - rows);

  for (let i = 0; i < rows; i++) {
    const lineNo = start + i + 1;
    if (lineNo > lines.length) break;
    const row = top + i;
    const isCurrent = lineNo === step.line;
    if (isCurrent) screen.fill(x, row, w, 1, { bg: PALETTE.current });
    const numText = String(lineNo).padStart(digits);
    const marker = isCurrent ? "▶" : " ";
    screen.text(x, row, marker, { fg: isCurrent ? PALETTE.accent : PALETTE.faint, bg: isCurrent ? PALETTE.current : null });
    screen.text(x + 2, row, numText, {
      fg: isCurrent ? PALETTE.text : PALETTE.faint,
      bg: isCurrent ? PALETTE.current : null,
    });
    const codeX = x + 2 + gutter;
    const maxCode = w - (codeX - x) - 1;
    let cx = codeX;
    for (const token of tokenizeLine(lines[lineNo - 1] ?? "")) {
      if (cx >= x + w - 1) break;
      cx += screen.text(cx, row, token.text, {
        fg: SYNTAX_COLORS[token.type] ?? PALETTE.text,
        bg: isCurrent ? PALETTE.current : null,
        bold: token.type === "kw",
      }, { maxWidth: x + w - 1 - cx });
    }
    if (isCurrent) {
      // Fill the remainder of the highlighted line.
      screen.fill(cx, row, Math.max(0, x + w - cx), 1, { bg: PALETTE.current });
    }
  }
}

function drawVars(screen, state, { x, y, w, h }) {
  const { scopes, changed } = state;
  if (!scopes.length) {
    const msg = state.frame
      ? (state.frame === 0 && state.step?.fn === "<anonymous>"
        ? "top-level frame — no local variables"
        : "no locals captured for this frame")
      : "no state";
    screen.text(x + 1, y, msg, { fg: PALETTE.faint, italic: true });
    return;
  }
  let row = y;
  const limit = y + h;
  for (const scope of scopes) {
    if (row >= limit) break;
    screen.text(x + 1, row, scope.type, { fg: PALETTE.faint });
    if (scope.name && scope.name !== scope.type) {
      screen.text(x + 1 + scope.type.length + 1, row, `· ${scope.name}`, { fg: PALETTE.faint });
    }
    row++;
    for (const v of scope.vars) {
      if (row >= limit - 1) {
        screen.text(x + 2, row, `… ${scope.vars.length} vars`, { fg: PALETTE.faint });
        return;
      }
      const isChanged = changed.has(v.name);
      screen.text(x + 1, row, isChanged ? "•" : " ", {
        fg: isChanged ? PALETTE.amber : PALETTE.faint,
        bold: isChanged,
      });
      const nameWidth = Math.min(18, Math.max(6, textWidth(v.name) + 1));
      screen.text(x + 2, row, fit(v.name, nameWidth), { fg: PALETTE.blue });
      screen.text(x + 3 + nameWidth, row, "=", { fg: PALETTE.faint });
      const valueX = x + 5 + nameWidth;
      const maxValue = Math.max(4, x + w - valueX - 1);
      const valueText = formatValue(v.value, { max: maxValue });
      const drawn = screen.text(valueX, row, valueText, {
        fg: VALUE_COLORS[v.value?.t] ?? PALETTE.text,
        bold: isChanged,
      });
      if (isChanged) {
        const was = `  was ${formatValue(changed.get(v.name), { max: 18 })}`;
        const room = x + w - (valueX + drawn) - 1;
        if (room > 6) screen.text(valueX + drawn, row, fit(was, room), { fg: PALETTE.faint });
      }
      row++;
    }
    row++;
  }
}

function drawWatches(screen, state, { x, y, w, h }) {
  const watches = state.step?.watches ?? [];
  if (!watches.length || h <= 0) return;
  let row = y;
  screen.text(x + 1, row, "watch", { fg: PALETTE.faint });
  row++;
  for (const watch of watches) {
    if (row >= y + h) return;
    screen.text(x + 1, row, fit(watch.expr, Math.max(6, Math.floor(w * 0.45))), { fg: PALETTE.cyan });
    screen.text(x + 2 + Math.floor(w * 0.45), row, "=", { fg: PALETTE.faint });
    const text = watch.error ? watch.error : formatValue(watch.value, { max: Math.floor(w * 0.45) });
    screen.text(x + 4 + Math.floor(w * 0.45), row, text, {
      fg: watch.error ? PALETTE.red : PALETTE.text,
    });
    row++;
  }
}

function drawStack(screen, rec, state, frameIndex, { x, y, w, h }) {
  if (h <= 1) return;
  screen.text(x + 1, y, "stack", { fg: PALETTE.faint });
  const frames = state.step?.stack ?? [];
  const rows = Math.min(frames.length, h - 1);
  for (let i = 0; i < rows; i++) {
    const frame = frames[i];
    const row = y + 1 + i;
    const selected = i === frameIndex;
    if (selected) screen.fill(x, row, w, 1, { bg: PALETTE.selected });
    screen.text(x + 1, row, selected ? "▸ " : "  ", { fg: selected ? PALETTE.accent : PALETTE.faint, bg: selected ? PALETTE.selected : null });
    const fn = fit(frame.fn, Math.max(6, Math.floor(w * 0.42)));
    screen.text(x + 3, row, fn, {
      fg: selected ? PALETTE.text : PALETTE.dim,
      bg: selected ? PALETTE.selected : null,
      bold: selected,
    });
    const loc = `${shortPath(frame.file)}:${frame.line}`;
    const shortLoc = `${frame.file.split("/").pop()}:${frame.line}`;
    const locX = x + w - 1 - textWidth(loc);
    const shortX = x + w - 1 - textWidth(shortLoc);
    if (locX > x + 3 + textWidth(fn)) {
      screen.text(locX, row, loc, {
        fg: selected ? PALETTE.cyan : PALETTE.faint,
        bg: selected ? PALETTE.selected : null,
      });
    } else if (shortX > x + 3 + textWidth(fn)) {
      screen.text(shortX, row, shortLoc, {
        fg: selected ? PALETTE.cyan : PALETTE.faint,
        bg: selected ? PALETTE.selected : null,
      });
    }
  }
}

function drawTimeline(screen, rec, index, y) {
  const { width } = screen;
  screen.fill(0, y, width, 1, { bg: PALETTE.header });
  const label = ` ${String(index + 1).padStart(String(rec.steps.length).length)}/${rec.steps.length} `;
  screen.text(1, y, label, { fg: PALETTE.text, bg: PALETTE.header, bold: true });
  const barX = 3 + textWidth(label);
  const barW = Math.max(10, width - barX - 18);
  const filled = Math.round(((index + 1) / rec.steps.length) * barW);
  for (let i = 0; i < barW; i++) {
    const stepIndex = Math.floor((i / barW) * rec.steps.length);
    const step = rec.steps[stepIndex];
    let fg = PALETTE.faint;
    if (step?.exception) fg = PALETTE.red;
    else if (i < filled) fg = PALETTE.accent;
    screen.put(barX + i, y, i < filled ? "█" : "░", { fg, bg: PALETTE.header });
  }
  const time = `+${rec.steps[index]?.t ?? 0}ms `;
  screen.text(width - textWidth(time) - 1, y, time, { fg: PALETTE.dim, bg: PALETTE.header });
}

function drawFooter(screen, state, y) {
  const { width } = screen;
  screen.fill(0, y, width, 1, {});
  const hint = state.message
    ? state.message
    : "←/→ step  ⇧ ±10  ↑/↓ frame  space play  g goto  / find  o output  e export  ? help  q quit";
  screen.text(1, y, fit(hint, width - 2), {
    fg: state.message ? PALETTE.green : PALETTE.faint,
  });
}

function drawHelp(screen, width, height) {
  const lines = [
    ["← →  /  h l", "previous / next step"],
    ["⇧← ⇧→ / H L", "jump 10 steps"],
    ["↑ ↓  /  j k", "select call frame"],
    ["home / end", "first / last step"],
    ["space", "play / pause"],
    ["g", "go to step number"],
    ["/", "search source, jump to match"],
    ["o", "console output up to this step"],
    ["e", "export a shareable HTML replay"],
    ["?", "close this help"],
    ["q", "quit"],
  ];
  const w = Math.min(64, width - 6);
  const h = lines.length + 5;
  const x = Math.floor((width - w) / 2);
  const y = Math.floor((height - h) / 2);
  screen.box(x, y, w, h, { style: { fg: PALETTE.border }, title: "keys", titleStyle: { fg: PALETTE.accent } });
  screen.fill(x + 1, y + 1, w - 2, h - 2, { bg: PALETTE.header });
  screen.text(x + 2, y + 1, "move through time", { fg: PALETTE.text, bold: true, bg: PALETTE.header });
  lines.forEach(([key, action], i) => {
    screen.text(x + 2, y + 3 + i, pad(key, 16), { fg: PALETTE.cyan, bg: PALETTE.header });
    screen.text(x + 18, y + 3 + i, action, { fg: PALETTE.dim, bg: PALETTE.header });
  });
}

function drawOutput(screen, rec, index, width, height) {
  const outputs = (rec.output ?? []).filter((o) => o.step <= index);
  const text = outputs.map((o) => o.text.replace(/\r/g, "")).join("").replace(/\n$/, "");
  const lines = text ? text.split("\n") : ["(no output yet)"];
  const w = Math.min(Math.max(40, ...lines.map((l) => textWidth(l) + 4)), width - 4);
  const h = Math.min(lines.length + 4, height - 4);
  const x = Math.floor((width - w) / 2);
  const y = Math.floor((height - h) / 2);
  screen.box(x, y, w, h, { style: { fg: PALETTE.border }, title: "stdout", titleStyle: { fg: PALETTE.accent } });
  screen.fill(x + 1, y + 1, w - 2, h - 2, { bg: PALETTE.header });
  const visible = lines.slice(Math.max(0, lines.length - (h - 3)));
  visible.forEach((line, i) => {
    screen.text(x + 2, y + 2 + i, fit(line, w - 4), { fg: PALETTE.text, bg: PALETTE.header });
  });
}

function drawPrompt(screen, state, width, y) {
  screen.fill(0, y, width, 1, { bg: PALETTE.header });
  screen.text(1, y, state.overlay.prompt, { fg: PALETTE.accent, bg: PALETTE.header, bold: true });
  const x = 2 + textWidth(state.overlay.prompt);
  screen.text(x, y, state.overlay.value, { fg: PALETTE.text, bg: PALETTE.header });
  screen.put(x + textWidth(state.overlay.value), y, "█", { fg: PALETTE.text, bg: PALETTE.header });
}

export function renderView(rec, state, { width, height }) {
  const screen = new Screen(width, height).clear({ bg: PALETTE.bg, fg: PALETTE.text });
  const index = Math.max(0, Math.min(state.index ?? 0, rec.steps.length - 1));
  const frameIndex = state.frame ?? 0;
  const current = stateOf(rec, index, frameIndex);

  drawHeader(screen, rec, index, frameIndex);

  const bodyTop = 2;
  const bodyBottom = height - 2;
  const bodyHeight = bodyBottom - bodyTop;
  const leftWidth = Math.max(24, Math.min(Math.floor(width * 0.58), width - 26));
  const rightX = leftWidth + 1;
  const rightWidth = width - rightX;

  drawSource(screen, rec, current.step ?? {}, {
    x: 0,
    y: bodyTop,
    w: leftWidth,
    h: bodyHeight,
  });

  screen.hline(leftWidth, bodyTop, 1, { fg: PALETTE.border });
  for (let y = bodyTop; y < bodyBottom; y++) {
    screen.put(leftWidth, y, "│", { fg: PALETTE.border });
  }

  const stackHeight = Math.min((current.step?.stack?.length ?? 0) + 1, 7);
  const watchHeight = current.step?.watches?.length ? current.step.watches.length + 1 : 0;
  const varsHeight = Math.max(3, bodyHeight - stackHeight - watchHeight - 1);
  drawVars(screen, current, { x: rightX, y: bodyTop, w: rightWidth, h: varsHeight });
  drawWatches(screen, current, {
    x: rightX,
    y: bodyTop + varsHeight,
    w: rightWidth,
    h: watchHeight,
  });
  drawStack(screen, rec, current, frameIndex, {
    x: rightX,
    y: bodyTop + varsHeight + watchHeight,
    w: rightWidth,
    h: stackHeight,
  });

  drawTimeline(screen, rec, index, height - 2);
  drawFooter(screen, state, height - 1);

  if (state.overlay?.type === "help") drawHelp(screen, width, height);
  if (state.overlay?.type === "output") drawOutput(screen, rec, index, width, height);
  if (state.overlay?.type === "prompt") drawPrompt(screen, state, width, height - 1);

  return screen;
}

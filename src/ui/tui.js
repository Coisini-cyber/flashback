import path from "node:path";
import { loadRecording } from "../store.js";
import { renderView } from "./view.js";

const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR = "\x1b[2J\x1b[H";

function sourceHas(rec, step, needle) {
  const file = rec.files?.[step?.file];
  if (!file) return false;
  const line = file.source.split(/\r?\n/)[step.line - 1] ?? "";
  return line.toLowerCase().includes(needle);
}

export async function replay(file, options = {}) {
  const rec = options.recording ?? loadRecording(file);
  if (!rec.steps.length) {
    process.stderr.write("this recording has no steps\n");
    return;
  }
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdout.isTTY || !stdin.isTTY) {
    throw new Error("replay needs an interactive terminal");
  }

  const state = {
    index: Math.min(Math.max(0, options.startStep ?? 0), rec.steps.length - 1),
    frame: 0,
    overlay: null,
    message: null,
    playing: false,
  };
  let messageTimer = null;
  let playTimer = null;

  const size = () => ({
    width: Math.max(20, stdout.columns ?? 100),
    height: Math.max(10, stdout.rows ?? 30),
  });

  const draw = () => {
    const { width, height } = size();
    if (width < 40 || height < 12) {
      stdout.write(CLEAR + "terminal too small for flashback\n");
      return;
    }
    const screen = renderView(rec, state, { width, height });
    stdout.write("\x1b[H" + screen.toAnsi());
  };

  const setMessage = (text) => {
    state.message = text;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      state.message = null;
      draw();
    }, 3500);
    draw();
  };

  const clampFrame = () => {
    const count = rec.steps[state.index]?.stack?.length ?? 1;
    state.frame = Math.max(0, Math.min(state.frame, count - 1));
  };

  const go = (delta) => {
    state.index = Math.max(0, Math.min(rec.steps.length - 1, state.index + delta));
    clampFrame();
    draw();
  };

  const stopPlay = () => {
    clearInterval(playTimer);
    playTimer = null;
    state.playing = false;
  };

  const togglePlay = () => {
    if (state.playing) {
      stopPlay();
      draw();
      return;
    }
    if (state.index >= rec.steps.length - 1) state.index = 0;
    state.playing = true;
    playTimer = setInterval(() => {
      if (state.index >= rec.steps.length - 1) {
        stopPlay();
        draw();
        return;
      }
      state.index++;
      clampFrame();
      draw();
    }, 220);
    draw();
  };

  const find = (needle) => {
    if (!needle) return;
    const query = needle.toLowerCase();
    for (let offset = 1; offset <= rec.steps.length; offset++) {
      const index = (state.index + offset) % rec.steps.length;
      if (sourceHas(rec, rec.steps[index], query)) {
        state.index = index;
        clampFrame();
        setMessage(`found "${needle}" at step ${index + 1}`);
        return;
      }
    }
    setMessage(`no match for "${needle}"`);
  };

  const exportReplay = async () => {
    try {
      const { exportHtml } = await import("./html.js");
      const out = path.resolve(file.replace(/\.fb\.json$/, "") + ".html");
      exportHtml(rec, out, { step: state.index });
      setMessage(`exported → ${path.basename(out)}`);
    } catch (err) {
      setMessage(`export failed: ${err.message}`);
    }
  };

  const closeOverlay = () => {
    state.overlay = null;
    draw();
  };

  const handlePrompt = (key) => {
    const overlay = state.overlay;
    if (key === "\x1b" || key === "\x03") return closeOverlay();
    if (key === "\r" || key === "\n") {
      const value = overlay.value.trim();
      const action = overlay.action;
      state.overlay = null;
      if (action === "goto") {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 1) {
          state.index = Math.min(rec.steps.length - 1, Math.floor(n) - 1);
          clampFrame();
          draw();
        } else {
          setMessage("enter a step number");
        }
      } else if (action === "search") {
        find(value);
      }
      return;
    }
    if (key === "\x7f" || key === "\b") {
      overlay.value = overlay.value.slice(0, -1);
      draw();
      return;
    }
    if (key === " " || /^[\x20-\x7e]$/.test(key)) {
      overlay.value += key;
      draw();
    }
  };

  const onKey = (key) => {
    if (state.overlay?.type === "prompt") return handlePrompt(key);
    if (state.overlay?.type === "help" || state.overlay?.type === "output") {
      if (key === "?" || key === "o" || key === "\x1b") closeOverlay();
      else if (key === "q" || key === "\x03") quit();
      return;
    }
    switch (key) {
      case "\x03":
      case "q":
        return quit();
      case "\x1b[D":
      case "\x00K":
      case "h":
      case "p":
        return go(-1);
      case "\x1b[C":
      case "\x00M":
      case "l":
      case "n":
        return go(1);
      case "\x1b[1;2D":
      case "H":
        return go(-10);
      case "\x1b[1;2C":
      case "L":
        return go(10);
      case "\x1b[5~":
        return go(-25);
      case "\x1b[6~":
        return go(25);
      case "\x1b[H":
      case "\x00G":
      case "g":
        if (key === "g") {
          state.overlay = { type: "prompt", prompt: "goto step › ", value: "", action: "goto" };
          return draw();
        }
        state.index = 0;
        clampFrame();
        return draw();
      case "\x1b[F":
      case "\x00O":
      case "G":
        state.index = rec.steps.length - 1;
        clampFrame();
        return draw();
      case "\x1b[A":
      case "\x00H":
      case "k":
        state.frame = Math.max(0, state.frame - 1);
        return draw();
      case "\x1b[B":
      case "\x00P":
      case "j":
        state.frame += 1;
        clampFrame();
        return draw();
      case " ":
        return togglePlay();
      case "?":
        state.overlay = { type: "help" };
        return draw();
      case "o":
        state.overlay = { type: "output" };
        return draw();
      case "e":
        return void exportReplay();
      case "/":
        state.overlay = { type: "prompt", prompt: "search › ", value: "", action: "search" };
        return draw();
      default:
        return;
    }
  };

  const cleanup = () => {
    stopPlay();
    clearTimeout(messageTimer);
    stdin.off("data", onData);
    stdout.off("resize", draw);
    process.off("SIGINT", onSigint);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
    stdout.write(SHOW_CURSOR + ALT_OFF);
  };

  let quitting = false;
  let resolveExit;
  const done = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const quit = () => {
    if (quitting) return;
    quitting = true;
    cleanup();
    resolveExit();
  };

  const onSigint = () => {
    cleanup();
    process.exit(130);
  };

  const onData = (chunk) => {
    const text = chunk.toString("utf8");
    // A single chunk can contain several keys (for example a paste or a
    // fast arrow-key burst). Split escape sequences from plain characters.
    const keys = text.match(/\x1b\[[0-9;]*[A-Za-z~]|\x1b\x00[A-Z]|\x00[A-Z]|\x1b|[\s\S]/g) ?? [];
    for (const key of keys) {
      if (quitting) return;
      onKey(key);
    }
  };

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdout.write(ALT_ON + HIDE_CURSOR + CLEAR);
  stdin.on("data", onData);
  stdout.on("resize", draw);
  process.on("SIGINT", onSigint);
  draw();
  await done;
}

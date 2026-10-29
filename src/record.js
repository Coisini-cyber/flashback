import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CDP, CDPError } from "./cdp.js";
import { encodeValue } from "./value.js";
import { makeRecordingPath, relPath, saveRecording, toPosix } from "./store.js";

const SCOPE_TYPES = new Set(["local", "block", "closure", "catch", "with"]);
const MAX_VARS_PER_SCOPE = 120;
const MAX_STACK_FRAMES = 14;
const FRAMES_WITH_SCOPES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeFile(url) {
  if (!url || !url.startsWith("file:")) return null;
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

function isUserFile(file, { includeDir, all }) {
  if (!file) return false;
  if (file.split(/[\\/]/).includes("node_modules")) return false;
  if (all || !includeDir) return true;
  const rel = path.relative(includeDir, file);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill();
  } catch {}
  if (process.platform === "win32") {
    setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        }).unref();
      } catch {}
    }, 600).unref();
  }
}

export class Recorder {
  #resolveDone;

  constructor(options = {}) {
    this.options = {
      script: null,
      args: [],
      cwd: process.cwd(),
      breakAt: null,
      maxSteps: 3000,
      watches: [],
      includeDir: null,
      all: false,
      stallMs: 30_000,
      idleMs: 1200,
      maxWallMs: 10 * 60_000,
      ...options,
    };
    this.steps = [];
    this.output = [];
    this.sources = new Map();
    this.finished = false;
    this.phase = "init";
    this.hitBreakpoint = false;
    this.t0 = Date.now();
    this.child = null;
    this.cdp = null;
    this.finishReason = null;
    this.error = null;
    this.scriptIds = new Map();
    this.#resolveDone = null;
    this.done = new Promise((resolve) => {
      this.#resolveDone = resolve;
    });
  }

  #log(message) {
    this.options.onProgress?.(message);
  }

  #debug(...args) {
    if (process.env.FLASHBACK_DEBUG) process.stderr.write(`[flashback] ${args.join(" ")}\n`);
  }

  #includeDir() {
    if (this.options.all) return null;
    if (this.options.includeDir) return path.resolve(this.options.cwd, this.options.includeDir);
    return this.options.cwd;
  }

  async start() {
    const opts = this.options;
    const scriptPath = path.resolve(opts.cwd, opts.script);
    if (!fs.existsSync(scriptPath)) throw new Error(`script not found: ${scriptPath}`);
    if (opts.breakAt) {
      opts.breakAt.file = path.resolve(opts.cwd, opts.breakAt.file);
      if (!fs.existsSync(opts.breakAt.file)) throw new Error(`breakpoint file not found: ${opts.breakAt.file}`);
    }

    this.recording = {
      version: 1,
      tool: "flashback",
      createdAt: new Date().toISOString(),
      node: process.version,
      cwd: opts.cwd,
      entry: relPath(opts.cwd, scriptPath),
      args: opts.args,
      breakAt: opts.breakAt
        ? { file: relPath(opts.cwd, opts.breakAt.file), line: opts.breakAt.line }
        : null,
      watches: opts.watches,
      files: {},
      steps: this.steps,
      output: this.output,
      exit: null,
    };

    const child = spawn(process.execPath, ["--inspect-brk=127.0.0.1:0", scriptPath, ...opts.args], {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, FLASHBACK: "1" },
    });
    this.child = child;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      this.output.push({ step: this.steps.length, stream: "stdout", text });
      opts.onOutput?.(text, "stdout");
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      if (/Debugger listening on|For help, see:|Debugger attached|Waiting for the debugger/.test(text)) {
        const cleaned = text
          .split(/\r?\n/)
          .filter((line) => !/Debugger listening on|For help, see:|Debugger attached|Waiting for the debugger/.test(line))
          .join("\n");
        if (!cleaned.trim()) return;
        this.output.push({ step: this.steps.length, stream: "stderr", text: cleaned });
        opts.onOutput?.(cleaned, "stderr");
        return;
      }
      this.output.push({ step: this.steps.length, stream: "stderr", text });
      opts.onOutput?.(text, "stderr");
    });

    const wsUrl = await this.#waitForDebuggerUrl(child);
    this.cdp = await CDP.connect(wsUrl);
    this.#wire();
    await this.#configure();
    this.#armTimers();
    await this.cdp.send("Runtime.runIfWaitingForDebugger").catch(() => {});
    this.#log({ phase: "record", steps: 0 });
    return this;
  }

  #waitForDebuggerUrl(child) {
    return new Promise((resolve, reject) => {
      let buf = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        killTree(child);
        reject(new Error(`timed out waiting for the Node inspector.\n${buf.slice(-2000)}`));
      }, 12_000);
      const onData = (chunk) => {
        buf += chunk.toString();
        const match = /Debugger listening on (ws:\/\/[^\s]+)/.exec(buf);
        if (match && !settled) {
          settled = true;
          clearTimeout(timer);
          child.stderr.off("data", onData);
          resolve(match[1]);
        }
      };
      child.stderr.on("data", onData);
      child.once("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`process exited with code ${code} before the debugger attached.\n${buf.slice(-2000)}`));
      });
    });
  }

  async #configure() {
    const cdp = this.cdp;
    await cdp.send("Debugger.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Debugger.setAsyncCallStackDepth", { maxDepth: 32 });
    await cdp.send("Debugger.setPauseOnExceptions", { state: "uncaught" });
    await cdp.send("Debugger.setBlackboxPatterns", {
      patterns: ["^node:", "node_modules", "^internal/"],
    });
    if (this.options.breakAt) {
      const bp = this.options.breakAt;
      const target = fs.existsSync(bp.file) ? fs.realpathSync(bp.file) : bp.file;
      const result = await cdp.send("Debugger.setBreakpointByUrl", {
        url: pathToFileURL(target).href,
        lineNumber: Math.max(0, bp.line - 1),
        columnNumber: 0,
      });
      this.breakpointId = result.breakpointId;
    }
  }

  #wire() {
    const cdp = this.cdp;
    cdp.on("Debugger.scriptParsed", (p) => {
      if (!p.url) return;
      this.scriptIds.set(p.scriptId, p.url);
    });
    const queue = [];
    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;
      try {
        while (queue.length) {
          if (this.finished) break;
          const params = queue.shift();
          await this.#onPaused(params).catch((err) => {
            if (!this.finished) {
              this.error = err;
              this.#finish("error", { message: err?.message ?? String(err) });
            }
          });
        }
      } finally {
        draining = false;
      }
    };
    cdp.on("Debugger.paused", (params) => {
      queue.push(params);
      void drain();
    });
    cdp.on("__close", () => {
      if (!this.finished) this.#finish("disconnect", {});
    });
    cdp.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails ?? {};
      if (this.phase !== "recording") return;
      const crash = {
        description: details.exception
          ? encodeValue(details.exception)
          : { t: "error", d: details.text ?? "uncaught exception" },
        file: details.url ? relPath(this.options.cwd, normalizeFile(details.url) ?? details.url) : null,
        line: details.lineNumber !== undefined ? details.lineNumber + 1 : null,
        column: details.columnNumber !== undefined ? details.columnNumber + 1 : null,
      };
      this.crash = crash;
      this.#debug("exceptionThrown", crash.file, crash.line, crash.description?.d);
      clearTimeout(this.crashTimer);
      // Give the debugger a beat to pause at the throw site. Some exceptions
      // (for example a TypeError inside a native method) never produce a pause,
      // but the event still tells us exactly where the program died.
      this.crashTimer = setTimeout(() => {
        if (this.finished) return;
        if (this.steps.length && !this.steps.at(-1).exception) this.steps.at(-1).exception = crash.description;
        this.#finish("exception", { description: crash.description });
      }, 150);
      this.crashTimer.unref?.();
    });
    this.child.once("exit", (code, signal) => {
      this.#debug("child exit", code, signal, "finished=" + this.finished);
      if (this.finished) return;
      this.#finish("exit", { code, signal });
    });
  }

  #armTimers() {
    const wall = setTimeout(() => {
      if (!this.finished) this.#finish("timeout", { message: "maximum recording time reached" });
    }, this.options.maxWallMs);
    wall.unref?.();
    this.wallTimer = wall;
    this.#resetStall();
  }

  #resetStall() {
    clearTimeout(this.stallTimer);
    const timer = setTimeout(() => {
      if (!this.finished) this.#finish("timeout", { message: "no debugger activity" });
    }, this.options.stallMs);
    timer.unref?.();
    this.stallTimer = timer;
  }

  #armIdle() {
    clearTimeout(this.idleTimer);
    const timer = setTimeout(() => {
      if (!this.finished) this.#finish("exit", { message: "execution went idle" });
    }, this.options.idleMs);
    timer.unref?.();
    this.idleTimer = timer;
  }

  async #onPaused(params) {
    if (this.finished) return;
    clearTimeout(this.idleTimer);
    this.#resetStall();
    const top = params.callFrames[0];
    if (!top) {
      await this.cdp.send("Debugger.resume").catch(() => {});
      return;
    }
    const file = normalizeFile(top.url || this.scriptIds.get(top.location.scriptId));
    this.#debug(
      "pause",
      params.reason,
      file ? relPath(this.options.cwd, file) : `<${top.url || "no-url"}>`,
      top.location.lineNumber + 1,
      "depth=" + params.callFrames.length,
      "phase=" + this.phase,
    );
    const isUser = isUserFile(file, { includeDir: this.#includeDir(), all: this.options.all });

    const isExceptionPause = params.reason === "exception" || params.reason === "promiseRejection";

    if (params.reason === "Break on start") {
      if (this.options.breakAt) {
        this.phase = "waiting-break";
        await this.cdp.send("Debugger.resume").catch(() => {});
      } else {
        this.phase = "boot";
        await this.cdp.send("Debugger.stepInto").catch(() => {});
      }
      return;
    }

    if (this.phase === "boot") {
      if (isUser) {
        this.phase = "recording";
      } else {
        // We are walking through Node's module bootstrap towards the entry
        // file. Do not step out: there is no user frame to return to yet.
        await this.cdp.send("Debugger.stepInto").catch(() => {});
        return;
      }
    }

    if (this.phase === "waiting-break") {
      const hit = params.hitBreakpoints?.includes(this.breakpointId);
      if (hit) {
        this.hitBreakpoint = true;
        this.phase = "recording";
      } else if (isExceptionPause) {
        this.phase = "recording";
        this.hitBreakpoint = true;
        await this.#capture(params, { isException: true });
        this.#finish("exception", { description: this.steps.at(-1)?.exception ?? null });
        return;
      } else {
        await this.cdp.send("Debugger.resume").catch(() => {});
        return;
      }
    }

    if (isExceptionPause) {
      clearTimeout(this.crashTimer);
      let description;
      if (isUser) {
        const step = await this.#capture(params, { isException: true });
        description = step?.exception;
      } else {
        description = params.data
          ? encodeValue(params.data)
          : this.crash?.description ?? { t: "error", d: "uncaught exception" };
        if (this.steps.length && !this.steps.at(-1).exception) this.steps.at(-1).exception = description;
      }
      this.#finish("exception", { description: description ?? this.crash?.description ?? null });
      return;
    }

    if (!isUser) {
      this.#debug("  -> stepOut (non-user frame)");
      await this.#stepOutOrInto(params);
      return;
    }

    const step = await this.#capture(params);
    this.#log({ phase: "record", steps: this.steps.length, file: step?.file, line: step?.line });
    if (this.steps.length >= this.options.maxSteps) {
      this.#finish("max-steps", {});
      return;
    }
    // Returning to the exact same line means the previous step command walked
    // into a native call and came right back (process.exit is the classic
    // case). Step over it instead of ping-ponging until the stall timer fires.
    const key = `${step?.file}:${step?.line}`;
    const repeated = key === this.lastStepKey;
    this.lastStepKey = key;
    const command = repeated ? "Debugger.stepOver" : "Debugger.stepInto";
    if (repeated) this.#armIdle();
    await this.cdp.send(command).catch((err) => {
      if (err instanceof CDPError && err.code === "ECLOSED") return;
    });
  }

  async #stepOutOrInto(params) {
    const includeDir = this.#includeDir();
    const hasUserFrame = params.callFrames.some((frame) => {
      const file = normalizeFile(frame.url || this.scriptIds.get(frame.location.scriptId));
      return isUserFile(file, { includeDir, all: this.options.all });
    });
    if (!hasUserFrame) {
      // The user code returned; we are inside the loader or process teardown.
      // Resuming lets Node run any pending async work. If nothing pauses again,
      // the run is over (the inspector keeps the process alive, so we cannot
      // simply wait for it to exit).
      await this.cdp.send("Debugger.resume").catch((err) => {
        this.#debug("  resume failed:", err?.message);
      });
      if (this.phase === "recording") this.#armIdle();
      return;
    }
    try {
      await this.cdp.send("Debugger.stepOut");
    } catch (err) {
      if (err instanceof CDPError && err.code === "ECLOSED") return;
      await this.cdp.send("Debugger.stepInto").catch(() => {});
    }
  }

  async #capture(params, { isException = false } = {}) {
    const top = params.callFrames[0];
    const file = normalizeFile(top.url || this.scriptIds.get(top.location.scriptId));
    if (!file) return null;
    const rel = relPath(this.options.cwd, file);
    await this.#ensureSource(file, top.location.scriptId);

    const userFrames = [];
    for (const frame of params.callFrames) {
      const f = normalizeFile(frame.url || this.scriptIds.get(frame.location.scriptId));
      if (!isUserFile(f, {
        includeDir: this.#includeDir(),
        all: this.options.all,
      })) continue;
      userFrames.push({ frame, file: f });
      if (userFrames.length >= MAX_STACK_FRAMES) break;
    }

    const t = Date.now() - this.t0;
    const scopeJobs = userFrames.slice(0, FRAMES_WITH_SCOPES).map((entry) =>
      this.#readScopes(entry.frame).catch(() => []),
    );
    const watchJobs = (this.options.watches ?? []).map((expr) =>
      this.#evaluateWatch(top.callFrameId, expr),
    );
    const [scopeResults, watchResults] = await Promise.all([
      Promise.all(scopeJobs),
      Promise.all(watchJobs),
    ]);

    const stack = userFrames.map((entry, index) => ({
      file: relPath(this.options.cwd, entry.file),
      line: entry.frame.location.lineNumber + 1,
      column: entry.frame.location.columnNumber + 1,
      fn: entry.frame.functionName || "<anonymous>",
      ...(index < FRAMES_WITH_SCOPES ? { scopes: scopeResults[index] } : {}),
    }));

    const step = {
      file: rel,
      line: top.location.lineNumber + 1,
      column: top.location.columnNumber + 1,
      fn: top.functionName || "<anonymous>",
      t,
      stack,
      watches: watchResults,
    };
    if (isException || params.reason === "exception" || params.reason === "promiseRejection") {
      step.exception = params.data ? encodeValue(params.data) : { t: "error", d: "uncaught exception" };
    }
    this.steps.push(step);
    this.recording.files[rel] = this.sources.get(file);
    return step;
  }

  async #readScopes(frame) {
    const jobs = [];
    for (const scope of frame.scopeChain) {
      if (!SCOPE_TYPES.has(scope.type) || !scope.object.objectId) continue;
      jobs.push(
        this.#readProps(scope.object.objectId).then((vars) => ({
          type: scope.type,
          name: scope.name || scope.type,
          vars,
        })),
      );
    }
    if (frame.this?.objectId) {
      jobs.push(
        this.#readProps(frame.this.objectId).then((vars) => ({
          type: "this",
          name: "this",
          vars,
        })),
      );
    }
    const scopes = await Promise.all(jobs);
    return scopes.filter((scope) => scope.vars.length > 0);
  }

  async #readProps(objectId) {
    const { result } = await this.cdp.send("Runtime.getProperties", {
      objectId,
      ownProperties: true,
      generatePreview: true,
      nonIndexedPropertiesOnly: false,
    });
    const vars = [];
    for (const prop of result) {
      if (!prop.value || prop.symbol) continue;
      if (prop.name.startsWith("[[")) continue;
      vars.push({ name: prop.name, value: encodeValue(prop.value) });
      if (vars.length >= MAX_VARS_PER_SCOPE) break;
    }
    return vars;
  }

  async #evaluateWatch(callFrameId, expression) {
    try {
      const { result, exceptionDetails } = await this.cdp.send("Debugger.evaluateOnCallFrame", {
        callFrameId,
        expression,
        silent: true,
        generatePreview: true,
        throwOnSideEffect: false,
      });
      if (exceptionDetails) {
        const text = exceptionDetails.exception?.description ?? exceptionDetails.text ?? "evaluation failed";
        if (/is not defined/.test(text)) return { expr: expression, unavailable: true };
        return { expr: expression, error: text.split("\n")[0] };
      }
      return { expr: expression, value: encodeValue(result) };
    } catch (err) {
      return { expr: expression, error: err?.message ?? String(err) };
    }
  }

  async #ensureSource(file, scriptId) {
    if (this.sources.has(file)) return;
    let source = null;
    try {
      const result = await this.cdp.send("Debugger.getScriptSource", { scriptId });
      source = result.scriptSource;
    } catch {
      try {
        source = fs.readFileSync(file, "utf8");
      } catch {
        source = "";
      }
    }
    this.sources.set(file, { source, lang: toPosix(file).split(".").pop() || "txt" });
  }

  stop(reason = "interrupted") {
    this.#finish(reason, {});
  }

  async #finish(reason, extra) {
    if (this.finished) return;
    this.finished = true;
    if (this.crash && reason === "exit") {
      reason = "exception";
      extra = { description: this.crash.description };
    }
    this.#debug("finish", reason, JSON.stringify(extra), "exitCode=" + this.child?.exitCode);
    clearTimeout(this.stallTimer);
    clearTimeout(this.idleTimer);
    clearTimeout(this.crashTimer);
    clearTimeout(this.wallTimer);
    this.finishReason = reason;
    this.recording.exit = { reason, ...extra };

    for (const [file, source] of this.sources) {
      this.recording.files[relPath(this.options.cwd, file)] = source;
    }
    // Sources referenced only from stack frames still get a slot.
    for (const step of this.steps) {
      for (const frame of step.stack ?? []) {
        if (!this.recording.files[frame.file]) {
          const abs = path.resolve(this.options.cwd, frame.file);
          let source = "";
          try {
            source = fs.readFileSync(abs, "utf8");
          } catch {}
          this.recording.files[frame.file] = { source, lang: toPosix(frame.file).split(".").pop() || "txt" };
        }
      }
    }

    try {
      this.cdp?.close();
    } catch {}
    killTree(this.child);

    let file = null;
    if (!this.options.dryRun) {
      file = this.options.out
        ? path.resolve(this.options.cwd, this.options.out)
        : makeRecordingPath(this.options.dir ?? path.join(this.options.cwd, ".flashback"), path.basename(this.options.script));
      try {
        saveRecording(this.recording, file);
      } catch (err) {
        this.error = err;
        this.#resolveDone({ recording: this.recording, file: null, reason: "error", error: err });
        return;
      }
    }
    this.#resolveDone({ recording: this.recording, file, reason });
    await sleep(0);
  }
}

export async function record(options) {
  const recorder = new Recorder(options);
  try {
    await recorder.start();
  } catch (err) {
    try {
      recorder.cdp?.close();
    } catch {}
    killTree(recorder.child);
    throw err;
  }
  return recorder.done;
}

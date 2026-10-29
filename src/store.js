import fs from "node:fs";
import path from "node:path";

export const RECORDING_EXT = ".fb.json";

export function defaultDir(cwd = process.cwd()) {
  return path.join(cwd, ".flashback");
}

export function toPosix(p) {
  return p.split(path.sep).join("/");
}

export function relPath(cwd, file) {
  const rel = path.relative(cwd, file);
  return toPosix(rel || path.basename(file));
}

export function absPath(cwd, file) {
  if (path.isAbsolute(file)) return file;
  return path.resolve(cwd, file);
}

export function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "recording"
  );
}

export function makeRecordingPath(dir, scriptName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  return path.join(dir, `${stamp}-${slugify(scriptName)}${RECORDING_EXT}`);
}

export function saveRecording(recording, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(recording));
  fs.renameSync(tmp, file);
  return file;
}

export function isRecording(value) {
  return Boolean(value && value.tool === "flashback" && Array.isArray(value.steps));
}

export function loadRecording(file) {
  const raw = fs.readFileSync(file, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
  if (!isRecording(data)) throw new Error(`${file} is not a flashback recording`);
  if (!data.cwd) data.cwd = path.dirname(file);
  return data;
}

export function listRecordings(dir = defaultDir()) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(RECORDING_EXT))
    .map((name) => {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      return { file, name, mtime: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

export function resolveRecording(target, { cwd = process.cwd(), dir = defaultDir(cwd) } = {}) {
  if (target) {
    const candidate = path.isAbsolute(target) ? target : path.resolve(cwd, target);
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(`${candidate}${RECORDING_EXT}`)) return `${candidate}${RECORDING_EXT}`;
    throw new Error(`no recording found at ${target}`);
  }
  const all = listRecordings(dir);
  if (all.length === 0) {
    throw new Error(`no recordings in ${dir}. Run \`flashback run <script>\` first.`);
  }
  return all[0].file;
}

export function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function humanDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

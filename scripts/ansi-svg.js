const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

const CELL_W = 8.6;
const CELL_H = 20;
const PAD = 16;
const CHROME = 34;

function runsForRow(screen, y) {
  const runs = [];
  let current = null;
  for (let x = 0; x < screen.width; x++) {
    const cell = screen.grid[y][x];
    const ch = cell && cell.ch !== "" ? cell.ch : " ";
    const style = cell?.style ?? null;
    const key = `${style?.fg ?? ""}|${style?.bg ?? ""}|${style?.bold ? 1 : 0}|${style?.dim ? 1 : 0}|${style?.italic ? 1 : 0}`;
    if (!current || current.key !== key) {
      current = { key, style, x, text: "" };
      runs.push(current);
    }
    current.text += ch;
  }
  return runs.filter((r) => r.text.trim().length > 0);
}

export function screenToSvg(screen, { title = "flashback", subtitle = "" } = {}) {
  const width = screen.width * CELL_W + PAD * 2;
  const height = screen.height * CELL_H + PAD * 2 + CHROME;
  const bgRects = [];
  for (let y = 0; y < screen.height; y++) {
    let start = -1;
    let color = null;
    for (let x = 0; x <= screen.width; x++) {
      const bg = x < screen.width ? screen.grid[y][x]?.style?.bg ?? null : null;
      if (bg !== color) {
        if (color && start >= 0) {
          bgRects.push(
            `<rect x="${PAD + start * CELL_W}" y="${CHROME + PAD + y * CELL_H}" width="${(x - start) * CELL_W}" height="${CELL_H}" fill="${color}"/>`,
          );
        }
        color = bg;
        start = x;
      }
    }
  }

  const lines = [];
  for (let y = 0; y < screen.height; y++) {
    const runs = runsForRow(screen, y);
    if (!runs.length) continue;
    const tspans = runs
      .map((run) => {
        const style = run.style ?? {};
        const attrs = [
          `fill="${style.fg ?? "#d7deeb"}"`,
          style.bold ? 'font-weight="700"' : "",
          style.italic ? 'font-style="italic"' : "",
          style.dim ? 'fill-opacity="0.62"' : "",
        ]
          .filter(Boolean)
          .join(" ");
        const x = PAD + run.x * CELL_W;
        return `<text x="${x}" y="${CHROME + PAD + y * CELL_H + 14.5}" ${attrs} xml:space="preserve">${esc(run.text)}</text>`;
      })
      .join("");
    lines.push(tspans);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'SFMono-Regular', 'Cascadia Mono', Consolas, 'Liberation Mono', monospace" font-size="14">
  <defs>
    <clipPath id="window"><rect x="0" y="0" width="${width}" height="${height}" rx="12"/></clipPath>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#c678dd" stop-opacity=".55"/>
      <stop offset=".55" stop-color="#61afef" stop-opacity=".35"/>
      <stop offset="1" stop-color="#56b6c2" stop-opacity=".1"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#window)">
    <rect width="${width}" height="${height}" fill="#0d1117"/>
    <rect width="${width}" height="${CHROME}" fill="#161b22"/>
    <rect y="${CHROME - 1}" width="${width}" height="1" fill="url(#glow)"/>
    <circle cx="20" cy="${CHROME / 2}" r="5.5" fill="#ff5f57"/>
    <circle cx="38" cy="${CHROME / 2}" r="5.5" fill="#febc2e"/>
    <circle cx="56" cy="${CHROME / 2}" r="5.5" fill="#28c840"/>
    <text x="${width / 2}" y="${CHROME / 2 + 4}" fill="#7d8590" font-size="11.5" text-anchor="middle">${esc(title)}</text>
    ${subtitle ? `<text x="${width - 16}" y="${CHROME / 2 + 4}" fill="#4b5563" font-size="11" text-anchor="end">${esc(subtitle)}</text>` : ""}
    ${bgRects.join("\n    ")}
    ${lines.join("\n    ")}
  </g>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="none" stroke="#2a313c"/>
</svg>
`;
}

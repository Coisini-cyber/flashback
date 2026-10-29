const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

export function charWidth(char) {
  const cp = char.codePointAt(0);
  if (cp === undefined) return 0;
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp >= 0x300 && cp <= 0x36f) return 0;
  if (cp === 0x200b || cp === 0x200d || cp === 0xfeff) return 0;
  for (const [start, end] of WIDE_RANGES) {
    if (cp >= start && cp <= end) return 2;
  }
  return 1;
}

export function textWidth(text) {
  let width = 0;
  for (const char of String(text)) width += charWidth(char);
  return width;
}

const RESET = "\x1b[0m";

function colorToRgb(color) {
  if (!color) return null;
  if (Array.isArray(color)) return color;
  const hex = color.replace("#", "");
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function sgr(style) {
  if (!style) return RESET;
  const parts = [0];
  if (style.bold) parts.push(1);
  if (style.dim) parts.push(2);
  if (style.italic) parts.push(3);
  if (style.underline) parts.push(4);
  if (style.reverse) parts.push(7);
  const fg = colorToRgb(style.fg);
  const bg = colorToRgb(style.bg);
  if (fg) parts.push(`38;2;${fg[0]};${fg[1]};${fg[2]}`);
  if (bg) parts.push(`48;2;${bg[0]};${bg[1]};${bg[2]}`);
  return `\x1b[${parts.join(";")}m`;
}

function styleKey(style) {
  if (!style) return "";
  return `${style.fg ?? ""}|${style.bg ?? ""}|${style.bold ? 1 : 0}${style.dim ? 1 : 0}${style.italic ? 1 : 0}${style.underline ? 1 : 0}${style.reverse ? 1 : 0}`;
}

export class Screen {
  constructor(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.grid = Array.from({ length: this.height }, () => new Array(this.width).fill(null));
  }

  clear(style = null) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) this.grid[y][x] = { ch: " ", style };
    }
    return this;
  }

  put(x, y, ch, style = null) {
    if (y < 0 || y >= this.height || x < 0 || x >= this.width) return;
    this.grid[y][x] = { ch, style };
  }

  fill(x, y, w, h, style = null) {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        if (row >= 0 && row < this.height && col >= 0 && col < this.width) {
          this.grid[row][col] = { ch: " ", style };
        }
      }
    }
    return this;
  }

  text(x, y, text, style = null, { maxWidth = Infinity } = {}) {
    let cursor = x;
    const limit = Math.min(this.width, x + maxWidth);
    for (const char of String(text)) {
      const w = charWidth(char);
      if (w === 0) continue;
      if (cursor + w > limit) break;
      this.put(cursor, y, char, style);
      if (w === 2) this.put(cursor + 1, y, "", style);
      cursor += w;
    }
    return cursor - x;
  }

  hline(x, y, w, style = null, char = "─") {
    for (let i = 0; i < w; i++) this.put(x + i, y, char, style);
  }

  box(x, y, w, h, { style = null, title = null, titleStyle = null, border = "round" } = {}) {
    if (w < 2 || h < 2) return;
    const chars =
      border === "round"
        ? { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" }
        : { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" };
    this.put(x, y, chars.tl, style);
    this.put(x + w - 1, y, chars.tr, style);
    this.put(x, y + h - 1, chars.bl, style);
    this.put(x + w - 1, y + h - 1, chars.br, style);
    for (let i = 1; i < w - 1; i++) {
      this.put(x + i, y, chars.h, style);
      this.put(x + i, y + h - 1, chars.h, style);
    }
    for (let i = 1; i < h - 1; i++) {
      this.put(x, y + i, chars.v, style);
      this.put(x + w - 1, y + i, chars.v, style);
    }
    if (title) this.text(x + 2, y, ` ${title} `, titleStyle ?? style, { maxWidth: w - 4 });
    return this;
  }

  toAnsi() {
    const rows = [];
    const bgDefault = null;
    for (let y = 0; y < this.height; y++) {
      let line = "";
      let current = "";
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid[y][x];
        if (!cell) {
          line += " ";
          continue;
        }
        if (cell.ch === "") continue;
        const style = cell.style;
        const key = styleKey(style);
        if (key !== current) {
          line += sgr(style);
          current = key;
        }
        line += cell.ch;
      }
      if (current !== "") line += RESET;
      rows.push(line);
    }
    return rows.map((row) => row + RESET).join("\r\n");
  }

  toText() {
    return this.grid
      .map((row) =>
        row
          .map((cell) => (cell && cell.ch !== "" ? cell.ch : cell ? " " : " "))
          .join(""),
      )
      .join("\n");
  }

  /** Debug helper: expose the colour of each cell for tests. */
  cell(x, y) {
    return this.grid[y]?.[x] ?? null;
  }
}

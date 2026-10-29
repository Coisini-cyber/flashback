const KEYWORDS = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "enum", "export", "extends",
  "false", "finally", "for", "from", "function", "get", "if", "implements",
  "import", "in", "instanceof", "interface", "let", "new", "null", "of", "return",
  "set", "static", "super", "switch", "this", "throw", "true", "try", "type",
  "typeof", "undefined", "var", "void", "while", "with", "yield", "satisfies",
  "namespace", "declare", "readonly", "public", "private", "protected", "abstract",
  "keyof", "infer", "asserts", "is",
]);

export const SYNTAX_COLORS = {
  kw: "#c678dd",
  str: "#98c379",
  num: "#d19a66",
  com: "#5c6370",
  fn: "#61afef",
  type: "#e5c07b",
  punct: "#8b93a7",
  plain: "#d7deeb",
  prop: "#e06c75",
};

const TOKEN =
  /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.]|=>|[=+\-*/%<>!&|?:]+)/g;

export function tokenizeLine(line) {
  const out = [];
  let last = 0;
  TOKEN.lastIndex = 0;
  let match;
  while ((match = TOKEN.exec(line)) !== null) {
    if (match.index > last) out.push({ text: line.slice(last, match.index), type: "plain" });
    const [text, comment, blockComment, string, number, word, punct] = match;
    if (comment || blockComment) {
      out.push({ text, type: "com" });
    } else if (string) {
      out.push({ text, type: "str" });
    } else if (number) {
      out.push({ text, type: "num" });
    } else if (word) {
      const after = line.slice(match.index + text.length);
      let type = "plain";
      if (KEYWORDS.has(word)) type = "kw";
      else if (/^\s*\(/.test(after)) type = "fn";
      else if (/^[A-Z]/.test(word)) type = "type";
      out.push({ text, type });
    } else if (punct) {
      out.push({ text, type: "punct" });
    } else {
      out.push({ text, type: "plain" });
    }
    last = match.index + text.length;
  }
  if (last < line.length) out.push({ text: line.slice(last), type: "plain" });
  return out;
}

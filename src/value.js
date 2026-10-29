const MAX_STRING = 240;
const MAX_PROPS = 12;

export function truncate(text, max = MAX_STRING) {
  const s = String(text);
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * Compact, JSON-safe snapshot of a CDP RemoteObject.
 * We deliberately keep this lossy: previews only, bounded strings, bounded
 * property counts. A recording must stay small enough to email.
 */
export function encodeValue(remote) {
  if (!remote || typeof remote !== "object") return { t: "undefined" };
  const type = remote.type ?? "unknown";
  if (type === "object" || type === "function" || type === "symbol") {
    const out = { t: remote.subtype || type };
    if (remote.className) out.c = remote.className;
    out.d = truncate(remote.description ?? remote.className ?? type, 200);
    const props = remote.preview?.properties;
    if (props && props.length) {
      out.p = props.slice(0, MAX_PROPS).map((p) => {
        if (p.type === "string") return [p.name, truncate(JSON.stringify(p.value ?? ""), 80)];
        if (p.type === "object") return [p.name, truncate(p.description ?? "object", 48)];
        return [p.name, truncate(String(p.value ?? p.description ?? p.type), 48)];
      });
      if (props.length > MAX_PROPS) out.o = props.length - MAX_PROPS;
    }
    return out;
  }
  if (remote.unserializableValue !== undefined) return { t: type, v: remote.unserializableValue };
  if (type === "string") return { t: type, v: truncate(remote.value ?? "") };
  if (type === "undefined") return { t: type };
  return { t: type, v: remote.value ?? remote.description ?? null };
}

export function isExpandable(value) {
  return Boolean(value && (value.t === "object" || value.t === "array" || value.t === "map" || value.t === "set" || value.t === "error" || value.t === "function" || value.c));
}

/** One-line human-readable rendering used by the TUI, CLI and HTML player. */
export function formatValue(value, { max = 120 } = {}) {
  if (!value) return "undefined";
  switch (value.t) {
    case "string":
      return truncate(JSON.stringify(value.v ?? ""), max);
    case "number":
    case "bigint":
      return String(value.v);
    case "boolean":
      return value.v ? "true" : "false";
    case "undefined":
      return "undefined";
    case "null":
      return "null";
    case "symbol":
      return truncate(value.d ?? "Symbol()", max);
    case "function": {
      const name = /\bfunction\s+([\w$]+)/.exec(value.d ?? "")?.[1];
      return name ? `ƒ ${name}()` : "ƒ ()";
    }
    case "error":
      return truncate(value.d ?? "Error", max);
    default:
      break;
  }
  const cls = value.c && value.c !== "Object" && value.c !== "Array" ? value.c : "";
  const open = value.t === "array" ? "[" : cls ? `${cls} {` : "{";
  const close = value.t === "array" ? "]" : "}";
  if (!value.p || value.p.length === 0) {
    const desc = value.d ?? `${open}${close}`;
    return truncate(desc, max);
  }
  const inner = value.p.map(([k, v]) => (value.t === "array" ? v : `${k}: ${v}`)).join(", ");
  const more = value.o ? `, +${value.o}` : "";
  const text = `${open} ${inner}${more} ${close}`;
  return truncate(text.replace(/\s+/g, " "), max);
}

export function sameValue(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.t !== b.t) return false;
  return formatValue(a, { max: 10_000 }) === formatValue(b, { max: 10_000 });
}

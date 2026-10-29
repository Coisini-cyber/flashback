export class CDPError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CDPError";
    this.code = code;
  }
}

/**
 * A tiny Chrome DevTools Protocol client over Node's built-in WebSocket.
 * No dependencies, no port scanning: Node prints the exact ws:// URL for us.
 */
export class CDP {
  #ws;
  #seq = 0;
  #pending = new Map();
  #listeners = new Map();
  #closed = false;

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener("message", (event) => this.#onMessage(event));
    ws.addEventListener("close", () => this.#onClose());
    ws.addEventListener("error", () => this.#onClose());
  }

  static async connect(url, { timeout = 10_000 } = {}) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(new CDPError(`timed out connecting to ${url}`, "ETIMEDOUT"));
      }, timeout);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new CDPError(`failed to connect to ${url}: ${event.message ?? "socket error"}`, "ECONNECT"));
      });
    });
    return new CDP(ws);
  }

  #onMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.id && this.#pending.has(msg.id)) {
      const { resolve, reject } = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (msg.error) reject(new CDPError(msg.error.message, msg.error.code));
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      const handlers = this.#listeners.get(msg.method);
      if (handlers) for (const fn of handlers) fn(msg.params);
    }
  }

  #onClose() {
    if (this.#closed) return;
    this.#closed = true;
    for (const { reject } of this.#pending.values()) {
      reject(new CDPError("debugger connection closed", "ECLOSED"));
    }
    this.#pending.clear();
    const handlers = this.#listeners.get("__close");
    if (handlers) for (const fn of handlers) fn();
  }

  get closed() {
    return this.#closed || this.#ws.readyState !== 1;
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new CDPError("debugger connection closed", "ECLOSED"));
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.#ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        this.#pending.delete(id);
        reject(err);
      }
    });
  }

  on(method, fn) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, new Set());
    this.#listeners.get(method).add(fn);
    return () => this.#listeners.get(method)?.delete(fn);
  }

  close() {
    try {
      this.#ws.close();
    } catch {}
    this.#onClose();
  }
}

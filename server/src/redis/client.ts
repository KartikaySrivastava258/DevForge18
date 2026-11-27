/**
 * A minimal Redis client over node:net / node:tls (RESP2), for the shared rate limits (ADR 0010).
 *
 * It sends commands as RESP arrays of bulk strings and parses the five RESP2 reply types. It supports
 * redis:// and rediss:// URLs with an optional user, password and database number, one connection that is
 * opened lazily and re-opened after a failure, and short connect and command timeouts. It deliberately
 * does not support Pub/Sub, transactions spanning calls, cluster redirects or RESP3: the rate limiter
 * needs EVAL and DEL only. A timed-out command closes the connection, because a late reply would
 * otherwise be matched to the next command.
 */
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

export type RespValue = string | number | null | RespValue[];

export class RedisReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisReplyError";
  }
}

/** Encode a command as a RESP array of bulk strings. */
export function encodeCommand(args: (string | number)[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const b = Buffer.from(String(arg), "utf8");
    parts.push(Buffer.from(`$${b.length}\r\n`), b, Buffer.from("\r\n"));
  }
  return Buffer.concat(parts);
}

type Parsed = { value: RespValue | RedisReplyError; next: number } | undefined;

/** Parse one reply starting at `start`; undefined when the buffer does not yet hold a complete reply. */
export function parseReply(buf: Buffer, start = 0): Parsed {
  if (start >= buf.length) return undefined;
  const eol = buf.indexOf("\r\n", start);
  if (eol === -1) return undefined;
  const type = String.fromCharCode(buf[start] ?? 0);
  const line = buf.toString("utf8", start + 1, eol);
  const after = eol + 2;
  switch (type) {
    case "+":
      return { value: line, next: after };
    case "-":
      return { value: new RedisReplyError(line), next: after };
    case ":":
      return { value: Number(line), next: after };
    case "$": {
      const len = Number(line);
      if (len === -1) return { value: null, next: after };
      if (!Number.isInteger(len) || len < 0) throw new Error(`RESP: bad bulk length ${line}`);
      if (buf.length < after + len + 2) return undefined;
      return { value: buf.toString("utf8", after, after + len), next: after + len + 2 };
    }
    case "*": {
      const count = Number(line);
      if (count === -1) return { value: null, next: after };
      if (!Number.isInteger(count) || count < 0) throw new Error(`RESP: bad array length ${line}`);
      const items: RespValue[] = [];
      let next = after;
      for (let i = 0; i < count; i++) {
        const item = parseReply(buf, next);
        if (!item) return undefined;
        // An error inside an array (e.g. from a script) is returned as its message.
        items.push(item.value instanceof RedisReplyError ? item.value.message : item.value);
        next = item.next;
      }
      return { value: items, next };
    }
    default:
      throw new Error(`RESP: unexpected reply type ${JSON.stringify(type)}`);
  }
}

export interface RedisClientOptions {
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
}

interface Pending {
  resolve: (v: RespValue) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** Anything that can run a Redis command; the rate limiter depends on this, so tests can fake it. */
export interface RedisCommander {
  command(args: (string | number)[]): Promise<RespValue>;
  close(): void;
}

const MAX_BUFFERED_BYTES = 1024 * 1024;

export class RedisClient implements RedisCommander {
  private readonly url: URL;
  private readonly connectTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private socket: Socket | undefined;
  private connecting: Promise<Socket> | undefined;
  private buffer: Buffer = Buffer.alloc(0);
  private readonly pending: Pending[] = [];
  private closed = false;

  constructor(url: string, options: RedisClientOptions = {}) {
    this.url = new URL(url);
    if (this.url.protocol !== "redis:" && this.url.protocol !== "rediss:") throw new Error("Redis URL must start with redis:// or rediss://");
    this.connectTimeoutMs = options.connectTimeoutMs ?? 1000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 500;
  }

  /** host:port, for logs (never the password). */
  get address(): string {
    return `${this.url.hostname}:${this.url.port || "6379"}`;
  }

  async command(args: (string | number)[]): Promise<RespValue> {
    if (this.closed) throw new Error("Redis client is closed");
    const socket = await this.connection();
    return this.send(socket, args);
  }

  close(): void {
    this.closed = true;
    this.fail(new Error("Redis client closed"));
  }

  private send(socket: Socket, args: (string | number)[]): Promise<RespValue> {
    return new Promise<RespValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        // The reply may still arrive later and would be taken for the next command's: start over.
        this.fail(new Error(`Redis command timed out after ${this.commandTimeoutMs} ms`));
      }, this.commandTimeoutMs);
      this.pending.push({ resolve, reject, timer });
      socket.write(encodeCommand(args));
    });
  }

  private connection(): Promise<Socket> {
    if (this.socket) return Promise.resolve(this.socket);
    this.connecting ??= this.open().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private open(): Promise<Socket> {
    const host = this.url.hostname.replace(/^\[|\]$/g, "");
    const port = Number(this.url.port || 6379);
    return new Promise<Socket>((resolve, reject) => {
      const socket =
        this.url.protocol === "rediss:" ? tlsConnect({ host, port, servername: host }) : netConnect({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Redis connect timed out after ${this.connectTimeoutMs} ms`));
      }, this.connectTimeoutMs);
      const onError = (err: Error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      };
      socket.once("error", onError);
      socket.once(this.url.protocol === "rediss:" ? "secureConnect" : "connect", () => {
        clearTimeout(timer);
        socket.off("error", onError);
        if (this.closed) {
          socket.destroy();
          reject(new Error("Redis client closed"));
          return;
        }
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 30_000);
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        socket.on("data", (chunk: Buffer) => this.onData(chunk));
        // Events of an old, already replaced connection must not tear down the current one.
        socket.on("error", (err) => {
          if (this.socket === socket) this.fail(err);
        });
        socket.on("close", () => {
          if (this.socket === socket) this.fail(new Error("Redis connection closed"));
        });
        const setup: Promise<RespValue>[] = [];
        const user = decodeURIComponent(this.url.username);
        const password = decodeURIComponent(this.url.password);
        if (password) setup.push(this.send(socket, user ? ["AUTH", user, password] : ["AUTH", password]));
        const db = this.url.pathname.replace(/^\//, "");
        if (db) setup.push(this.send(socket, ["SELECT", Number(db)]));
        Promise.all(setup).then(
          () => resolve(socket),
          (err: Error) => {
            this.fail(err);
            reject(err);
          },
        );
      });
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    let offset = 0;
    try {
      for (;;) {
        const reply = parseReply(this.buffer, offset);
        if (!reply) break;
        offset = reply.next;
        const waiter = this.pending.shift();
        if (!waiter) throw new Error("RESP: reply without a request");
        clearTimeout(waiter.timer);
        if (reply.value instanceof RedisReplyError) waiter.reject(reply.value);
        else waiter.resolve(reply.value);
      }
    } catch (err) {
      this.fail(err as Error);
      return;
    }
    this.buffer = this.buffer.subarray(offset);
    if (this.buffer.length > MAX_BUFFERED_BYTES) this.fail(new Error("RESP: reply too large"));
  }

  /** Drop the connection and fail every waiting command; the next command reconnects. */
  private fail(err: Error): void {
    const socket = this.socket;
    this.socket = undefined;
    this.buffer = Buffer.alloc(0);
    socket?.removeAllListeners("data");
    socket?.destroy();
    for (const waiter of this.pending.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }
}

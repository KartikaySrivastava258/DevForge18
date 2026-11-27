// A minimal Redis client (enough RESP, Redis's wire protocol, for this app) so the API needs no npm packages.
// Each call opens a connection to REDIS_HOST:REDIS_PORT, sends one command and resolves with the reply.
const net = require("node:net");

function encode(args) {
  return `*${args.length}\r\n` + args.map((a) => { const s = String(a); return `$${Buffer.byteLength(s)}\r\n${s}\r\n`; }).join("");
}

// Returns [value, nextIndex], or null while the reply is still incomplete.
function parse(buf, i = 0) {
  const end = buf.indexOf("\r\n", i);
  if (end < 0) return null;
  const type = String.fromCharCode(buf[i]);
  const line = buf.toString("utf8", i + 1, end);
  if (type === "+") return [line, end + 2];
  if (type === "-") return [new Error(line), end + 2];
  if (type === ":") return [Number(line), end + 2];
  if (type === "$") {
    const n = Number(line);
    if (n < 0) return [null, end + 2];
    if (buf.length < end + 2 + n + 2) return null;
    return [buf.toString("utf8", end + 2, end + 2 + n), end + 2 + n + 2];
  }
  if (type === "*") {
    const n = Number(line);
    if (n < 0) return [null, end + 2];
    const items = [];
    let j = end + 2;
    for (let k = 0; k < n; k++) {
      const r = parse(buf, j);
      if (!r) return null;
      items.push(r[0]);
      j = r[1];
    }
    return [items, j];
  }
  throw new Error(`unexpected reply from Redis: ${line}`);
}

function command(args, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(process.env.REDIS_PORT || 6379), process.env.REDIS_HOST || "localhost");
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Redis did not answer in time")); }, timeoutMs);
    socket.on("connect", () => socket.write(encode(args)));
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const r = parse(buf);
      if (!r) return;
      clearTimeout(timer);
      socket.end();
      if (r[0] instanceof Error) reject(r[0]); else resolve(r[0]);
    });
    socket.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

module.exports = { command };

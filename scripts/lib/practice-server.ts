/**
 * Starts a real DevForge server (in-memory database, current content) in a
 * child process, for lessons that practise HTTP against DevForge's own API —
 * the Postman track. Lessons call it "$API", just as a Postman environment
 * supplies {{baseUrl}}; learners set API=http://localhost:8080 for their copy.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

export interface PracticeServer {
  url: string;
  close: () => Promise<void>;
}

/** port 0 = any free port; Nginx lessons use 8080, the address learners proxy to. */
export function startPracticeServer(contentRoot: string, port = 0): Promise<PracticeServer> {
  const child = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", join(import.meta.dirname, "practice-server-main.ts"), contentRoot, String(port)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`practice server did not start: ${err}`));
    }, 15_000);
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (!out.includes("\n")) reject(new Error(`practice server exited (${code}): ${err}`));
    });
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      const line = out.split("\n")[0];
      if (!out.includes("\n") || !line) return;
      clearTimeout(timer);
      const { url } = JSON.parse(line) as { url: string };
      resolve({
        url,
        close: () =>
          new Promise<void>((done) => {
            if (child.exitCode !== null) return done();
            child.once("exit", () => done());
            child.kill("SIGTERM");
          }),
      });
    });
  });
}

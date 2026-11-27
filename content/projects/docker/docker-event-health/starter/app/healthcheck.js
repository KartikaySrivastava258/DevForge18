// Health check for the worker: healthy (exit 0) if the worker reached Redis within the last 5 seconds,
// unhealthy (exit 1) otherwise. Run it inside the worker container: node healthcheck.js
const fs = require("node:fs");
const file = process.env.HEARTBEAT_FILE || "/tmp/worker-heartbeat";
try {
  const age = Date.now() - Number(fs.readFileSync(file, "utf8"));
  if (age < 5000) process.exit(0);
  console.log(`last heartbeat ${Math.round(age / 1000)} s ago`);
} catch (err) {
  console.log(`no heartbeat yet (${err.code})`);
}
process.exit(1);

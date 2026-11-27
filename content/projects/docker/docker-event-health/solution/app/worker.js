// Event worker: takes events from the Redis list "events:queue", processes them, and marks them processed.
// After every successful round trip to Redis it writes the current time to HEARTBEAT_FILE
// (default /tmp/worker-heartbeat); healthcheck.js reads that file. On SIGTERM it finishes the event in hand and
// exits with code 0.
const fs = require("node:fs");
const os = require("node:os");
const { command } = require("./redis.js");

const HEARTBEAT_FILE = process.env.HEARTBEAT_FILE || "/tmp/worker-heartbeat";
const name = os.hostname();
let stopping = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function heartbeat() {
  try { fs.writeFileSync(HEARTBEAT_FILE, String(Date.now())); }
  catch (err) { console.error(`cannot write ${HEARTBEAT_FILE}: ${err.code}`); }
}

async function processEvent(event) {
  console.log(`processing ${event.type} ${event.id}`);
  await sleep(300); // stands in for real work: sending a confirmation, updating a booking
  await command(["HSET", `event:${event.id}`, "status", "processed", "processed_by", name]);
}

async function main() {
  console.log(`worker ${name} started`);
  while (!stopping) {
    try {
      // Wait up to 1 second for an event, so the heartbeat stays fresh and SIGTERM is noticed quickly.
      const reply = await command(["BRPOP", "events:queue", 1], 3000);
      heartbeat();
      if (reply) await processEvent(JSON.parse(reply[1]));
    } catch (err) {
      console.error(`redis error: ${err.code || err.message}; retrying`);
      await sleep(1000);
    }
  }
  console.log("SIGTERM handled: no event left half-done, exiting");
  process.exit(0);
}

process.on("SIGTERM", () => { stopping = true; });
main();

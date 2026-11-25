/**
 * Create a user with a chosen role. This is the only way to create the first
 * administrator — DevForge never ships default credentials.
 *
 *   npm run user:create -- --email you@college.edu --name "Your Name" --role admin
 *
 * The password is read from the DEVFORGE_NEW_PASSWORD environment variable if
 * set (useful in automation), otherwise prompted for without echoing.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { recordAudit } from "../server/src/auth/audit.ts";
import { hashPassword, passwordProblem } from "../server/src/auth/password.ts";
import { findUserByEmail, insertUser, ROLES, type Role } from "../server/src/auth/users.ts";
import { loadConfig } from "../server/src/config.ts";
import { migrate, openDatabase } from "../server/src/db/database.ts";

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolvePw, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("No terminal available; set DEVFORGE_NEW_PASSWORD instead."));
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolvePw(value);
        }
        if (ch === "\u0003") process.exit(130); // Ctrl+C
        if (ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "student" } },
});
const email = values.email?.trim();
const name = values.name?.trim();
const role = values.role as Role;
if (!email || !name || !ROLES.includes(role)) {
  console.error('Usage: npm run user:create -- --email <email> --name "<name>" --role <student|faculty|admin>');
  process.exit(2);
}

const config = loadConfig();
const db = openDatabase(resolve(config.databasePath));
migrate(db);
if (findUserByEmail(db, email)) {
  console.error(`A user with email ${email} already exists.`);
  process.exit(1);
}
const password = process.env.DEVFORGE_NEW_PASSWORD ?? (await readHidden("Password (min. 10 characters): "));
const problem = passwordProblem(password, email);
if (problem) {
  console.error(problem);
  process.exit(1);
}
const user = insertUser(db, { email, displayName: name, passwordHash: await hashPassword(password, config.passwordHashLogN), role });
recordAudit(db, { actorUserId: null, action: "user.created_by_cli", targetType: "user", targetId: user.id, metadata: { role } });
console.log(`Created ${role} account for ${user.email}.`);
db.close();

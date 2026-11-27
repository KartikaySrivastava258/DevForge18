import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, STRONG_PASSWORD, startTestServer, type TestServer } from "./helpers.ts";

let server: TestServer;
const as: Record<string, Client> = {};
before(async () => {
  server = await startTestServer();
  for (const who of ["student", "faculty", "admin"] as const) {
    await server.createUser(`${who}@example.edu`, STRONG_PASSWORD, who);
    as[who] = new Client(server.url);
    await as[who].post("/api/auth/login", { email: `${who}@example.edu`, password: STRONG_PASSWORD });
  }
});
after(() => server.close());

const userId = (email: string) => (server.db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;
const setStatus = (client: Client, email: string, disabled: boolean) =>
  client.request("PATCH", `/api/admin/users/${userId(email)}/status`, { disabled });

describe("disabling and re-enabling accounts", () => {
  it("is admin-only and needs the CSRF header", async () => {
    assert.equal((await setStatus(as.student!, "faculty@example.edu", true)).status, 403);
    assert.equal((await setStatus(as.faculty!, "student@example.edu", true)).status, 403);
    assert.equal((await new Client(server.url).request("PATCH", `/api/admin/users/${userId("student@example.edu")}/status`, { disabled: true })).status, 401);
    const noCsrf = await as.admin!.request("PATCH", `/api/admin/users/${userId("student@example.edu")}/status`, { disabled: true }, { "x-devforge-csrf": "" });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.json.error.code, "csrf_failed");
  });

  it("validates the body and the user id", async () => {
    assert.equal((await as.admin!.request("PATCH", `/api/admin/users/${userId("student@example.edu")}/status`, { disabled: "yes" })).status, 400);
    assert.equal((await as.admin!.request("PATCH", "/api/admin/users/no-such-user/status", { disabled: true })).status, 404);
  });

  it("disables an account: its live session stops working at once, it cannot sign in, and the change is audited", async () => {
    assert.equal((await as.student!.get("/api/me/progress")).status, 200);
    const res = await setStatus(as.admin!, "student@example.edu", true);
    assert.equal(res.status, 200);
    assert.ok(res.json.user.disabledAt);
    assert.equal((await as.student!.get("/api/me/progress")).status, 401, "the existing session is rejected");
    const sessions = server.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(userId("student@example.edu")) as { n: number };
    assert.equal(sessions.n, 0, "sessions are deleted");
    const again = new Client(server.url);
    assert.equal((await again.post("/api/auth/login", { email: "student@example.edu", password: STRONG_PASSWORD })).status, 401);

    const list = await as.admin!.get("/api/admin/users?role=student");
    assert.ok(list.json.users[0].disabledAt);
    const audit = await as.admin!.get("/api/admin/audit");
    const event = audit.json.events.find((e: { action: string }) => e.action === "user.disabled");
    assert.equal(event.target_id, userId("student@example.edu"));
    assert.equal(event.actor_name, "admin");
  });

  it("re-enables an account so it can sign in again", async () => {
    const res = await setStatus(as.admin!, "student@example.edu", false);
    assert.equal(res.status, 200);
    assert.equal(res.json.user.disabledAt, null);
    const client = new Client(server.url);
    assert.equal((await client.post("/api/auth/login", { email: "student@example.edu", password: STRONG_PASSWORD })).status, 200);
    const audit = await as.admin!.get("/api/admin/audit");
    assert.ok(audit.json.events.some((e: { action: string }) => e.action === "user.enabled"));
  });

  it("refuses to disable your own account, and the last-admin rule counts only active admins", async () => {
    const self = await setStatus(as.admin!, "admin@example.edu", true);
    assert.equal(self.status, 409);
    assert.equal(self.json.error.code, "cannot_disable_self");

    // A second admin may not disable the only other *active* admin once they are the last one.
    await server.createUser("admin2@example.edu", STRONG_PASSWORD, "admin");
    const admin2 = new Client(server.url);
    await admin2.post("/api/auth/login", { email: "admin2@example.edu", password: STRONG_PASSWORD });
    assert.equal((await setStatus(admin2, "admin@example.edu", true)).status, 200);
    const last = await setStatus(as.faculty!, "admin2@example.edu", true);
    assert.equal(last.status, 403, "faculty still cannot");
    // admin2 is now the only active admin; demoting them is refused too.
    const demote = await admin2.request("PATCH", `/api/admin/users/${userId("admin2@example.edu")}/role`, { role: "faculty" });
    assert.equal(demote.status, 409);
    assert.equal(demote.json.error.code, "last_admin");
    assert.equal((await setStatus(admin2, "admin@example.edu", false)).status, 200);
  });
});

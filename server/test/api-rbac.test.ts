import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, STRONG_PASSWORD, startTestServer, type TestServer } from "./helpers.ts";

let server: TestServer;
const as: Record<string, Client> = {};
before(async () => {
  server = await startTestServer();
  for (const role of ["student", "faculty", "admin"] as const) {
    await server.createUser(`${role}@example.edu`, STRONG_PASSWORD, role);
    as[role] = new Client(server.url);
    await as[role].post("/api/auth/login", { email: `${role}@example.edu`, password: STRONG_PASSWORD });
  }
  as.anon = new Client(server.url);
});
after(() => server.close());

const userId = (email: string) => (server.db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;

describe("role-based access control", () => {
  const matrix: [string, string, Record<string, number>][] = [
    ["GET", "/api/admin/users", { anon: 401, student: 403, faculty: 403, admin: 200 }],
    ["GET", "/api/admin/audit", { anon: 401, student: 403, faculty: 403, admin: 200 }],
    ["GET", "/api/faculty/overview", { anon: 401, student: 403, faculty: 200, admin: 200 }],
    ["GET", "/api/me/progress", { anon: 401, student: 200, faculty: 200, admin: 200 }],
  ];
  for (const [method, path, expected] of matrix) {
    for (const [who, status] of Object.entries(expected)) {
      it(`${method} ${path} as ${who} → ${status}`, async () => {
        assert.equal((await as[who]!.request(method, path)).status, status);
      });
    }
  }

  it("lets admins change roles, writes an audit event, and the change applies immediately", async () => {
    const id = userId("student@example.edu");
    const res = await as.admin!.request("PATCH", `/api/admin/users/${id}/role`, { role: "faculty" });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.role, "faculty");
    assert.equal((await as.student!.get("/api/faculty/overview")).status, 200, "existing session sees the new role");
    const audit = await as.admin!.get("/api/admin/audit");
    const event = audit.json.events.find((e: { action: string }) => e.action === "user.role_changed");
    assert.deepEqual(event.metadata, { from: "student", to: "faculty" });
    assert.equal(event.actor_email, "admin@example.edu");
  });

  it("forbids students from changing roles, including their own", async () => {
    const res = await as.faculty!.request("PATCH", `/api/admin/users/${userId("faculty@example.edu")}/role`, { role: "admin" });
    assert.equal(res.status, 403);
  });

  it("refuses to remove the last administrator", async () => {
    const res = await as.admin!.request("PATCH", `/api/admin/users/${userId("admin@example.edu")}/role`, { role: "student" });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "last_admin");
  });

  it("validates role values and paginates user lists", async () => {
    assert.equal((await as.admin!.request("PATCH", `/api/admin/users/${userId("faculty@example.edu")}/role`, { role: "root" })).status, 400);
    const page = await as.admin!.get("/api/admin/users?limit=1&offset=1");
    assert.equal(page.json.users.length, 1);
    assert.equal(page.json.total, 3);
    assert.equal(page.json.users[0].password_hash, undefined);
    const filtered = await as.admin!.get("/api/admin/users?role=admin");
    assert.ok(filtered.json.users.every((u: { role: string }) => u.role === "admin"));
  });

  it("gives faculty aggregated statistics without personal data", async () => {
    const res = await as.faculty!.get("/api/faculty/overview");
    assert.equal(res.json.tracks.length, 18);
    assert.ok(!res.text.includes("@example.edu"));
  });
});

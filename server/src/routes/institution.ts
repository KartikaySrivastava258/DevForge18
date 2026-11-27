/**
 * Institutional features (REMAINING_WORK.md §6.3): cohorts with join codes, assignments with due dates,
 * project/capstone submissions, faculty review against rubrics (including learners' architecture decision
 * records), opt-in public portfolios and certificates issued only at an assessment threshold.
 *
 * Privacy rules: a learner's progress is visible to the faculty of a cohort the learner joined (the join
 * screen says so) and to administrators — nobody else. Public pages (portfolio, certificate verification)
 * show the display name only, never the e-mail address.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { recordAudit } from "../auth/audit.ts";
import { verifyPassword } from "../auth/password.ts";
import { deleteUserSessions } from "../auth/sessions.ts";
import { countActiveAdmins } from "../auth/users.ts";
import type { UserRecord } from "../auth/users.ts";
import { transaction, type Db } from "../db/database.ts";
import { noContent, ok, readJson, type RequestContext } from "../http/context.ts";
import { forbidden, HttpError, notFound, unauthorized } from "../http/errors.ts";
import type { Router } from "../http/router.ts";
import type { ContentStore } from "../content/store.ts";
import { sessionCookieName, type AppDeps } from "./deps.ts";
import { serializeCookie } from "../http/cookies.ts";

export const ASSIGNMENT_KINDS = ["lesson", "lab", "quiz", "project", "capstone", "architecture"] as const;
type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];
const LEVELS = ["excellent", "good", "needs_work"] as const;

/** Rubric for learners' architecture decision records (the content rubrics cover projects and capstones). */
export const DECISION_RUBRIC = [
  { criterion: "Context", excellent: "Requirements, constraints and assumptions are explicit and specific to the situation.", good: "The situation is described, with some constraints.", needs_work: "No real context; the decision could apply anywhere." },
  { criterion: "Options considered", excellent: "At least two real alternatives, each judged against the same forces.", good: "An alternative is mentioned with a reason for rejecting it.", needs_work: "Only one option is described." },
  { criterion: "Decision and reasons", excellent: "The decision follows from the context and the trade-offs, in the learner's own words.", good: "The decision is clear and has reasons.", needs_work: "The decision is unclear or unjustified." },
  { criterion: "Consequences", excellent: "Costs, risks and how they will be noticed are stated honestly, including what becomes harder.", good: "Some consequences are listed.", needs_work: "Only benefits are listed." },
] as const;

// Join codes: 10 characters from an alphabet without look-alikes (32^10 ≈ 10^15 combinations).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newJoinCode(): string {
  const bytes = randomBytes(10);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

const CohortBody = z.object({ name: z.string().trim().min(3).max(120), description: z.string().trim().max(2000).default("") });
const JoinBody = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/, "Enter the 10-character code from your teacher.") });
const AssignmentBody = z.object({
  kind: z.enum(ASSIGNMENT_KINDS),
  itemId: z.string().min(1).max(120),
  dueAt: z.iso.datetime({ offset: true }),
  instructions: z.string().trim().max(4000).default(""),
});
const SubmissionBody = z.object({
  repositoryUrl: z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(500),
  notes: z.string().trim().max(4000).default(""),
});
const ReviewBody = z.object({
  scores: z.record(z.string().min(1).max(200), z.enum(LEVELS)),
  feedback: z.string().trim().min(1).max(8000),
  outcome: z.enum(["accepted", "changes_requested"]),
});
const DeleteAccountBody = z.object({ password: z.string().min(1).max(1024), confirm: z.literal("delete my account") });
const PortfolioBody = z.object({
  isPublic: z.boolean(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "Use 3–40 lowercase letters, digits and hyphens."),
  headline: z.string().trim().max(200).default(""),
});

interface CohortRow { id: string; name: string; description: string; join_code: string; created_at: string }
interface MemberRow { user_id: string; role: "learner" | "faculty"; joined_at: string; display_name: string; email: string }
interface AssignmentRow { id: string; cohort_id: string; kind: AssignmentKind; item_id: string; instructions: string; due_at: string; created_at: string }
interface SubmissionRow { id: string; user_id: string; kind: "project" | "capstone"; item_id: string; repository_url: string; notes: string; status: "submitted" | "accepted" | "changes_requested"; submitted_at: string }
interface ReviewRow { id: string; target_type: "submission" | "decision"; target_id: string; reviewer_user_id: string | null; scores: string; feedback: string; outcome: "accepted" | "changes_requested"; created_at: string; reviewer_name?: string | null }
interface DecisionRow { id: number; user_id: string; architecture_id: string; title: string; context: string; decision: string; consequences: string; status: "draft" | "submitted"; updated_at: string }

const isStaff = (u: UserRecord) => u.role === "faculty" || u.role === "admin";
const requireUser = (ctx: RequestContext): UserRecord => {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
};

/** Title and link of anything that can be assigned, or undefined when it does not exist. */
export function describeItem(content: ContentStore, kind: AssignmentKind, id: string): { title: string; track: string | null; href: string } | undefined {
  switch (kind) {
    case "lesson": { const l = content.getLesson(id); return l && { title: l.title, track: l.track, href: `/tracks/${l.track}/lessons/${l.id}` }; }
    case "lab": { const l = content.getLab(id); return l && { title: l.title, track: l.track, href: `/tracks/${l.track}/labs/${l.id}` }; }
    case "quiz": { const t = content.getTrack(id); return t && content.getQuiz(id) ? { title: `${t.short_title} quiz`, track: t.slug, href: `/tracks/${t.slug}/quiz` } : undefined; }
    case "project": { const p = content.getProject(id); return p && { title: p.title, track: p.track, href: `/tracks/${p.track}/projects/${p.id}` }; }
    case "capstone": { const c = content.getCapstone(id); return c && { title: `Project ${c.letter} — ${c.title}`, track: null, href: `/capstones/${c.id}` }; }
    case "architecture": { const a = content.getArchitecture(id); return a && { title: a.title, track: null, href: `/architecture/${a.id}` }; }
  }
}

function rubricFor(content: ContentStore, targetType: "submission" | "decision", kind: string, itemId: string) {
  if (targetType === "decision") return DECISION_RUBRIC.map((r) => ({ ...r }));
  const item = kind === "project" ? content.getProject(itemId) : content.getCapstone(itemId);
  return item ? item.rubric : [];
}

const reviewToApi = (r: ReviewRow) => ({
  id: r.id, scores: JSON.parse(r.scores) as Record<string, string>, feedback: r.feedback, outcome: r.outcome,
  reviewer: r.reviewer_name ?? null, createdAt: r.created_at,
});

function latestReview(db: Db, type: "submission" | "decision", id: string): ReviewRow | undefined {
  return db.prepare(
    `SELECT r.*, u.display_name AS reviewer_name FROM reviews r LEFT JOIN users u ON u.id = r.reviewer_user_id
     WHERE r.target_type = ? AND r.target_id = ? ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`,
  ).get(type, id) as unknown as ReviewRow | undefined;
}

/** Status of one assignment for one learner, derived from their own progress records. */
export function assignmentStatus(db: Db, userId: string, a: Pick<AssignmentRow, "kind" | "item_id" | "due_at">): { state: "not_started" | "in_progress" | "done"; completedAt: string | null; detail: string | null; late: boolean } {
  const done = (at: string | null, detail: string | null = null) => ({ state: "done" as const, completedAt: at, detail, late: !!at && at > a.due_at });
  const none = { state: "not_started" as const, completedAt: null, detail: null, late: false };
  switch (a.kind) {
    case "lesson": {
      const r = db.prepare("SELECT status, completed_at FROM lesson_progress WHERE user_id = ? AND lesson_id = ?").get(userId, a.item_id) as { status: string; completed_at: string | null } | undefined;
      if (!r) return none;
      return r.status === "completed" ? done(r.completed_at) : { ...none, state: "in_progress" };
    }
    case "lab": {
      const r = db.prepare("SELECT evidence, completed_at FROM lab_progress WHERE user_id = ? AND lab_id = ?").get(userId, a.item_id) as { evidence: string; completed_at: string } | undefined;
      return r ? done(r.completed_at, r.evidence) : none;
    }
    case "quiz": {
      const passed = db.prepare("SELECT MIN(attempted_at) AS at FROM quiz_attempts WHERE user_id = ? AND track_slug = ? AND passed = 1").get(userId, a.item_id) as { at: string | null };
      if (passed.at) return done(passed.at, "passed");
      const tried = db.prepare("SELECT COUNT(*) AS n FROM quiz_attempts WHERE user_id = ? AND track_slug = ?").get(userId, a.item_id) as { n: number };
      return tried.n ? { ...none, state: "in_progress", detail: "not passed yet" } : none;
    }
    case "project":
    case "capstone": {
      const s = db.prepare("SELECT status, submitted_at FROM submissions WHERE user_id = ? AND kind = ? AND item_id = ?").get(userId, a.kind, a.item_id) as { status: string; submitted_at: string } | undefined;
      if (!s) return none;
      return s.status === "changes_requested" ? { ...none, state: "in_progress", detail: "changes requested" } : done(s.submitted_at, s.status);
    }
    case "architecture": {
      const d = db.prepare("SELECT id, status, updated_at FROM architecture_decisions WHERE user_id = ? AND architecture_id = ?").get(userId, a.item_id) as { id: number; status: string; updated_at: string } | undefined;
      if (!d) return none;
      if (d.status !== "submitted") return { ...none, state: "in_progress", detail: "draft" };
      const review = latestReview(db, "decision", String(d.id));
      if (review && review.created_at >= d.updated_at && review.outcome === "changes_requested") return { ...none, state: "in_progress", detail: "changes requested" };
      return done(d.updated_at, review && review.created_at >= d.updated_at ? review.outcome : "submitted");
    }
  }
}

/**
 * Track certificate threshold: the track quiz passed, and every lab of the track that the server can verify
 * (simulation and read-through labs) verified. A track with no server-verifiable lab (Git: both labs are local)
 * uses its simulations' challenges instead, which the server also verifies by replay. Self-reported work never counts.
 */
export function certificateEligibility(db: Db, content: ContentStore, userId: string, track: string) {
  const quiz = content.getQuiz(track);
  const best = db.prepare("SELECT MAX(score) AS best, MAX(passed) AS passed FROM quiz_attempts WHERE user_id = ? AND track_slug = ?").get(userId, track) as { best: number | null; passed: number | null };
  const verifiable = content.labsFor(track).filter((l) => l.mode !== "local");
  let practice: { id: string; title: string; verified: boolean }[];
  if (verifiable.length) {
    const verified = new Set(
      (db.prepare("SELECT lab_id FROM lab_progress WHERE user_id = ? AND track_slug = ? AND evidence = 'verified'").all(userId, track) as { lab_id: string }[]).map((r) => r.lab_id),
    );
    practice = verifiable.map((l) => ({ id: l.id, title: l.title, verified: verified.has(l.id) }));
  } else {
    const done = new Set(
      (db.prepare("SELECT simulation_id || '/' || challenge_id AS k FROM simulation_progress WHERE user_id = ? AND track_slug = ?").all(userId, track) as { k: string }[]).map((r) => r.k),
    );
    practice = content.simulationsFor(track).flatMap((sim) =>
      sim.challenges.map((c) => ({ id: `${sim.id}/${c.id}`, title: `${sim.title}: ${c.title}`, verified: done.has(`${sim.id}/${c.id}`) })),
    );
  }
  const quizPassed = best.passed === 1;
  return {
    track,
    quiz: quiz ? { id: quiz.id, passed: quizPassed, bestScore: best.best } : null,
    labs: practice,
    eligible: !!quiz && quizPassed && practice.length > 0 && practice.every((l) => l.verified),
  };
}

export function registerInstitutionRoutes(router: Router, { db, content, config, limiters }: AppDeps): void {
  const membership = (cohortId: string, userId: string) =>
    db.prepare("SELECT role FROM cohort_members WHERE cohort_id = ? AND user_id = ?").get(cohortId, userId) as { role: "learner" | "faculty" } | undefined;
  const getCohort = (id: string) => db.prepare("SELECT * FROM cohorts WHERE id = ?").get(id) as unknown as CohortRow | undefined;
  /** The cohort, if the user teaches it (faculty member) or is an administrator. */
  const taughtCohort = (id: string, user: UserRecord): CohortRow => {
    const cohort = getCohort(id);
    if (!cohort) throw notFound("Cohort");
    if (user.role !== "admin" && membership(id, user.id)?.role !== "faculty") throw forbidden();
    return cohort;
  };
  /** May this reviewer see and review this learner's work? Admins always; faculty when they teach a cohort the learner is in. */
  const teaches = (reviewer: UserRecord, learnerId: string): boolean =>
    reviewer.role === "admin" ||
    (isStaff(reviewer) &&
      !!db.prepare(
        `SELECT 1 FROM cohort_members f JOIN cohort_members l ON l.cohort_id = f.cohort_id
         WHERE f.user_id = ? AND f.role = 'faculty' AND l.user_id = ? AND l.role = 'learner' LIMIT 1`,
      ).get(reviewer.id, learnerId));

  const assignmentToApi = (a: AssignmentRow) => ({
    id: a.id, kind: a.kind, itemId: a.item_id, instructions: a.instructions, dueAt: a.due_at, createdAt: a.created_at,
    item: describeItem(content, a.kind, a.item_id) ?? { title: `${a.item_id} (no longer available)`, track: null, href: null },
  });

  // ---- Cohorts ----------------------------------------------------------------------------------------

  router.post(
    "/api/cohorts",
    async (ctx) => {
      const user = requireUser(ctx);
      const body = await readJson(ctx, CohortBody);
      const id = randomUUID();
      const now = new Date().toISOString();
      transaction(db, () => {
        db.prepare("INSERT INTO cohorts (id, name, description, join_code, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, body.name, body.description, newJoinCode(), user.id, now);
        db.prepare("INSERT INTO cohort_members (cohort_id, user_id, role, joined_at) VALUES (?, ?, 'faculty', ?)").run(id, user.id, now);
        recordAudit(db, { actorUserId: user.id, action: "cohort.created", targetType: "cohort", targetId: id });
      });
      const c = getCohort(id) as CohortRow;
      return ok({ cohort: { id: c.id, name: c.name, description: c.description, joinCode: c.join_code, role: "faculty" } }, 201);
    },
    { auth: ["faculty", "admin"] },
  );

  router.get(
    "/api/cohorts",
    (ctx) => {
      const user = requireUser(ctx);
      const rows = db.prepare(
        `SELECT c.id, c.name, c.description, c.join_code, m.role,
           (SELECT COUNT(*) FROM cohort_members x WHERE x.cohort_id = c.id AND x.role = 'learner') AS learners,
           (SELECT COUNT(*) FROM assignments a WHERE a.cohort_id = c.id) AS assignments
         FROM cohorts c JOIN cohort_members m ON m.cohort_id = c.id AND m.user_id = ? ORDER BY c.created_at DESC`,
      ).all(user.id) as { id: string; name: string; description: string; join_code: string; role: "learner" | "faculty"; learners: number; assignments: number }[];
      return ok({
        cohorts: rows.map((r) => ({ id: r.id, name: r.name, description: r.description, role: r.role, learners: r.learners, assignments: r.assignments, joinCode: r.role === "faculty" ? r.join_code : undefined })),
      });
    },
    { auth: "user" },
  );

  router.post(
    "/api/cohorts/join",
    async (ctx) => {
      const user = requireUser(ctx);
      const { code } = await readJson(ctx, JoinBody);
      const cohort = db.prepare("SELECT * FROM cohorts WHERE join_code = ?").get(code) as unknown as CohortRow | undefined;
      if (!cohort) throw new HttpError(404, "unknown_code", "No cohort has that code. Check it with your teacher.");
      const role = isStaff(user) ? "faculty" : "learner";
      const existing = membership(cohort.id, user.id);
      if (!existing) {
        db.prepare("INSERT INTO cohort_members (cohort_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)").run(cohort.id, user.id, role, new Date().toISOString());
        recordAudit(db, { actorUserId: user.id, action: "cohort.joined", targetType: "cohort", targetId: cohort.id, metadata: { role } });
      }
      return ok({ cohort: { id: cohort.id, name: cohort.name, role: existing?.role ?? role } });
    },
    { auth: "user" },
  );

  router.get(
    "/api/cohorts/:id",
    (ctx) => {
      const user = requireUser(ctx);
      const cohort = getCohort(ctx.params.id ?? "");
      if (!cohort) throw notFound("Cohort");
      const role = membership(cohort.id, user.id)?.role ?? (user.role === "admin" ? "faculty" : undefined);
      if (!role) throw notFound("Cohort");
      const assignments = (db.prepare("SELECT * FROM assignments WHERE cohort_id = ? ORDER BY due_at, created_at").all(cohort.id) as unknown as AssignmentRow[]);
      const base = { id: cohort.id, name: cohort.name, description: cohort.description, role };
      if (role === "learner") {
        return ok({ cohort: base, assignments: assignments.map((a) => ({ ...assignmentToApi(a), status: assignmentStatus(db, user.id, a) })) });
      }
      const members = db.prepare(
        `SELECT m.user_id, m.role, m.joined_at, u.display_name, u.email FROM cohort_members m JOIN users u ON u.id = m.user_id
         WHERE m.cohort_id = ? ORDER BY m.role DESC, u.display_name COLLATE NOCASE`,
      ).all(cohort.id) as unknown as MemberRow[];
      const learners = members.filter((m) => m.role === "learner").map((m) => {
        const lessons = (db.prepare("SELECT COUNT(*) AS n FROM lesson_progress WHERE user_id = ? AND status = 'completed'").get(m.user_id) as { n: number }).n;
        const labsVerified = (db.prepare("SELECT COUNT(*) AS n FROM lab_progress WHERE user_id = ? AND evidence = 'verified'").get(m.user_id) as { n: number }).n;
        const quizzesPassed = (db.prepare("SELECT COUNT(DISTINCT track_slug) AS n FROM quiz_attempts WHERE user_id = ? AND passed = 1").get(m.user_id) as { n: number }).n;
        const statuses = assignments.map((a) => ({ assignmentId: a.id, ...assignmentStatus(db, m.user_id, a) }));
        return { userId: m.user_id, name: m.display_name, email: m.email, joinedAt: m.joined_at, lessonsCompleted: lessons, labsVerified, quizzesPassed, assignments: statuses };
      });
      return ok({
        cohort: { ...base, joinCode: cohort.join_code },
        faculty: members.filter((m) => m.role === "faculty").map((m) => ({ userId: m.user_id, name: m.display_name })),
        learners,
        assignments: assignments.map(assignmentToApi),
      });
    },
    { auth: "user" },
  );

  router.post(
    "/api/cohorts/:id/code",
    (ctx) => {
      const user = requireUser(ctx);
      const cohort = taughtCohort(ctx.params.id ?? "", user);
      const code = newJoinCode();
      db.prepare("UPDATE cohorts SET join_code = ? WHERE id = ?").run(code, cohort.id);
      recordAudit(db, { actorUserId: user.id, action: "cohort.code_changed", targetType: "cohort", targetId: cohort.id });
      return ok({ joinCode: code });
    },
    { auth: ["faculty", "admin"] },
  );

  router.delete(
    "/api/cohorts/:id/members/:userId",
    (ctx) => {
      const user = requireUser(ctx);
      const cohort = getCohort(ctx.params.id ?? "");
      if (!cohort) throw notFound("Cohort");
      const target = ctx.params.userId ?? "";
      if (target !== user.id) taughtCohort(cohort.id, user); // leaving is always allowed; removing others needs to teach the cohort
      const member = membership(cohort.id, target);
      if (!member) throw notFound("Member");
      if (member.role === "faculty") {
        const faculty = (db.prepare("SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id = ? AND role = 'faculty'").get(cohort.id) as { n: number }).n;
        if (faculty <= 1) throw new HttpError(409, "last_faculty", "A cohort needs at least one teacher. Add another before leaving.");
      }
      db.prepare("DELETE FROM cohort_members WHERE cohort_id = ? AND user_id = ?").run(cohort.id, target);
      recordAudit(db, { actorUserId: user.id, action: target === user.id ? "cohort.left" : "cohort.member_removed", targetType: "cohort", targetId: cohort.id, metadata: { userId: target } });
      return noContent();
    },
    { auth: "user" },
  );

  // ---- Assignments ------------------------------------------------------------------------------------

  router.get(
    "/api/assignable",
    () => {
      const items: { kind: AssignmentKind; id: string; title: string; track: string | null }[] = [];
      for (const t of content.listTracks()) {
        for (const l of content.lessonsFor(t.slug)) items.push({ kind: "lesson", id: l.id, title: l.title, track: t.slug });
        for (const l of content.labsFor(t.slug)) items.push({ kind: "lab", id: l.id, title: l.title, track: t.slug });
        if (content.getQuiz(t.slug)) items.push({ kind: "quiz", id: t.slug, title: `${t.short_title} quiz`, track: t.slug });
        for (const p of content.projectsFor(t.slug)) items.push({ kind: "project", id: p.id, title: p.title, track: t.slug });
      }
      for (const c of content.listCapstones()) items.push({ kind: "capstone", id: c.id, title: `Project ${c.letter} — ${c.title}`, track: null });
      for (const a of content.listArchitectures()) items.push({ kind: "architecture", id: a.id, title: a.title, track: null });
      return ok({ items });
    },
    { auth: ["faculty", "admin"] },
  );

  router.post(
    "/api/cohorts/:id/assignments",
    async (ctx) => {
      const user = requireUser(ctx);
      const cohort = taughtCohort(ctx.params.id ?? "", user);
      const body = await readJson(ctx, AssignmentBody);
      if (!describeItem(content, body.kind, body.itemId)) throw new HttpError(400, "unknown_item", `There is no ${body.kind} with the id "${body.itemId}".`);
      const dup = db.prepare("SELECT 1 FROM assignments WHERE cohort_id = ? AND kind = ? AND item_id = ?").get(cohort.id, body.kind, body.itemId);
      if (dup) throw new HttpError(409, "already_assigned", "This item is already assigned to the cohort.");
      const id = randomUUID();
      const dueAt = new Date(body.dueAt).toISOString();
      db.prepare("INSERT INTO assignments (id, cohort_id, kind, item_id, instructions, due_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        id, cohort.id, body.kind, body.itemId, body.instructions, dueAt, user.id, new Date().toISOString(),
      );
      recordAudit(db, { actorUserId: user.id, action: "assignment.created", targetType: "cohort", targetId: cohort.id, metadata: { kind: body.kind, itemId: body.itemId } });
      return ok({ assignment: assignmentToApi(db.prepare("SELECT * FROM assignments WHERE id = ?").get(id) as unknown as AssignmentRow) }, 201);
    },
    { auth: ["faculty", "admin"] },
  );

  router.delete(
    "/api/cohorts/:id/assignments/:assignmentId",
    (ctx) => {
      const user = requireUser(ctx);
      const cohort = taughtCohort(ctx.params.id ?? "", user);
      const r = db.prepare("DELETE FROM assignments WHERE id = ? AND cohort_id = ?").run(ctx.params.assignmentId ?? "", cohort.id);
      if (r.changes === 0) throw notFound("Assignment");
      recordAudit(db, { actorUserId: user.id, action: "assignment.deleted", targetType: "cohort", targetId: cohort.id, metadata: { assignmentId: ctx.params.assignmentId } });
      return noContent();
    },
    { auth: ["faculty", "admin"] },
  );

  router.get(
    "/api/me/assignments",
    (ctx) => {
      const user = requireUser(ctx);
      const rows = db.prepare(
        `SELECT a.*, c.name AS cohort_name FROM assignments a JOIN cohort_members m ON m.cohort_id = a.cohort_id AND m.user_id = ? AND m.role = 'learner'
         JOIN cohorts c ON c.id = a.cohort_id ORDER BY a.due_at, a.created_at`,
      ).all(user.id) as unknown as (AssignmentRow & { cohort_name: string })[];
      return ok({ assignments: rows.map((a) => ({ ...assignmentToApi(a), cohort: { id: a.cohort_id, name: a.cohort_name }, status: assignmentStatus(db, user.id, a) })) });
    },
    { auth: "user" },
  );

  // ---- Submissions ------------------------------------------------------------------------------------

  const submissionToApi = (s: SubmissionRow) => {
    const review = latestReview(db, "submission", s.id);
    return {
      id: s.id, kind: s.kind, itemId: s.item_id, repositoryUrl: s.repository_url, notes: s.notes, status: s.status, submittedAt: s.submitted_at,
      item: describeItem(content, s.kind, s.item_id) ?? null,
      review: review && review.created_at >= s.submitted_at ? reviewToApi(review) : null,
    };
  };

  router.get(
    "/api/me/submissions",
    (ctx) => {
      const user = requireUser(ctx);
      const rows = db.prepare("SELECT * FROM submissions WHERE user_id = ? ORDER BY submitted_at DESC").all(user.id) as unknown as SubmissionRow[];
      return ok({ submissions: rows.map(submissionToApi) });
    },
    { auth: "user" },
  );

  router.get(
    "/api/me/submissions/:kind/:itemId",
    (ctx) => {
      const user = requireUser(ctx);
      const row = db.prepare("SELECT * FROM submissions WHERE user_id = ? AND kind = ? AND item_id = ?").get(user.id, ctx.params.kind ?? "", ctx.params.itemId ?? "") as unknown as SubmissionRow | undefined;
      return ok({ submission: row ? submissionToApi(row) : null });
    },
    { auth: "user" },
  );

  router.put(
    "/api/me/submissions/:kind/:itemId",
    async (ctx) => {
      const user = requireUser(ctx);
      const kind = ctx.params.kind;
      if (kind !== "project" && kind !== "capstone") throw notFound("Submission type");
      const itemId = ctx.params.itemId ?? "";
      if (!describeItem(content, kind, itemId)) throw notFound(kind === "project" ? "Project" : "Capstone");
      const body = await readJson(ctx, SubmissionBody);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO submissions (id, user_id, kind, item_id, repository_url, notes, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?)
         ON CONFLICT (user_id, kind, item_id) DO UPDATE SET repository_url = excluded.repository_url, notes = excluded.notes, status = 'submitted', submitted_at = excluded.submitted_at`,
      ).run(randomUUID(), user.id, kind, itemId, body.repositoryUrl, body.notes, now);
      const row = db.prepare("SELECT * FROM submissions WHERE user_id = ? AND kind = ? AND item_id = ?").get(user.id, kind, itemId) as unknown as SubmissionRow;
      return ok({ submission: submissionToApi(row) });
    },
    { auth: "user" },
  );

  // ---- Reviews ----------------------------------------------------------------------------------------

  /** The thing under review, with its owner, or 404. */
  const reviewTarget = (type: string, id: string) => {
    if (type === "submission") {
      const s = db.prepare("SELECT * FROM submissions WHERE id = ?").get(id) as unknown as SubmissionRow | undefined;
      if (!s) throw notFound("Submission");
      return { type: "submission" as const, ownerId: s.user_id, kind: s.kind, itemId: s.item_id, updatedAt: s.submitted_at, row: s };
    }
    if (type === "decision") {
      const d = db.prepare("SELECT * FROM architecture_decisions WHERE id = ? AND status = 'submitted'").get(Number(id) || -1) as unknown as DecisionRow | undefined;
      if (!d) throw notFound("Decision record");
      return { type: "decision" as const, ownerId: d.user_id, kind: "architecture", itemId: d.architecture_id, updatedAt: d.updated_at, row: d };
    }
    throw notFound("Review target");
  };

  router.get(
    "/api/reviews",
    (ctx) => {
      const user = requireUser(ctx);
      // Work of learners in cohorts this user teaches (administrators: everyone), newest first.
      const scope = user.role === "admin"
        ? "1 = 1"
        : `x.user_id IN (SELECT l.user_id FROM cohort_members f JOIN cohort_members l ON l.cohort_id = f.cohort_id AND l.role = 'learner'
                           WHERE f.user_id = @me AND f.role = 'faculty')`;
      const subs = db.prepare(`SELECT x.*, u.display_name FROM submissions x JOIN users u ON u.id = x.user_id WHERE ${scope} ORDER BY x.submitted_at DESC LIMIT 200`)
        .all(user.role === "admin" ? {} : { me: user.id }) as unknown as (SubmissionRow & { display_name: string })[];
      const decs = db.prepare(`SELECT x.*, u.display_name FROM architecture_decisions x JOIN users u ON u.id = x.user_id WHERE x.status = 'submitted' AND ${scope} ORDER BY x.updated_at DESC LIMIT 200`)
        .all(user.role === "admin" ? {} : { me: user.id }) as unknown as (DecisionRow & { display_name: string })[];
      const items = [
        ...subs.map((s) => {
          const r = latestReview(db, "submission", s.id);
          return { type: "submission" as const, id: s.id, kind: s.kind, learner: s.display_name, item: describeItem(content, s.kind, s.item_id) ?? null, updatedAt: s.submitted_at, reviewed: !!r && r.created_at >= s.submitted_at, outcome: r && r.created_at >= s.submitted_at ? r.outcome : null };
        }),
        ...decs.map((d) => {
          const r = latestReview(db, "decision", String(d.id));
          return { type: "decision" as const, id: String(d.id), kind: "architecture" as const, learner: d.display_name, item: describeItem(content, "architecture", d.architecture_id) ?? null, updatedAt: d.updated_at, reviewed: !!r && r.created_at >= d.updated_at, outcome: r && r.created_at >= d.updated_at ? r.outcome : null };
        }),
      ].sort((a, b) => Number(a.reviewed) - Number(b.reviewed) || b.updatedAt.localeCompare(a.updatedAt));
      return ok({ items });
    },
    { auth: ["faculty", "admin"] },
  );

  router.get(
    "/api/reviews/:type/:id",
    (ctx) => {
      const user = requireUser(ctx);
      const t = reviewTarget(ctx.params.type ?? "", ctx.params.id ?? "");
      if (!teaches(user, t.ownerId)) throw forbidden();
      const learner = db.prepare("SELECT display_name FROM users WHERE id = ?").get(t.ownerId) as { display_name: string } | undefined;
      const history = (db.prepare(
        `SELECT r.*, u.display_name AS reviewer_name FROM reviews r LEFT JOIN users u ON u.id = r.reviewer_user_id
         WHERE r.target_type = ? AND r.target_id = ? ORDER BY r.created_at DESC`,
      ).all(t.type, ctx.params.id ?? "") as unknown as ReviewRow[]).map(reviewToApi);
      const work = t.type === "submission"
        ? { repositoryUrl: t.row.repository_url, notes: t.row.notes, status: t.row.status }
        : { title: t.row.title, context: t.row.context, decision: t.row.decision, consequences: t.row.consequences };
      return ok({
        target: { type: t.type, id: ctx.params.id, kind: t.kind, learner: learner?.display_name ?? "", item: describeItem(content, t.kind as AssignmentKind, t.itemId) ?? null, updatedAt: t.updatedAt, work },
        rubric: rubricFor(content, t.type, t.kind, t.itemId),
        reviews: history,
      });
    },
    { auth: ["faculty", "admin"] },
  );

  router.post(
    "/api/reviews/:type/:id",
    async (ctx) => {
      const user = requireUser(ctx);
      const t = reviewTarget(ctx.params.type ?? "", ctx.params.id ?? "");
      if (!teaches(user, t.ownerId)) throw forbidden();
      if (t.ownerId === user.id) throw new HttpError(409, "own_work", "You cannot review your own work.");
      const body = await readJson(ctx, ReviewBody);
      const rubric = rubricFor(content, t.type, t.kind, t.itemId);
      const expected = rubric.map((r) => r.criterion);
      const missing = expected.filter((c) => !(c in body.scores));
      const extra = Object.keys(body.scores).filter((c) => !expected.includes(c));
      if (missing.length || extra.length) {
        throw new HttpError(400, "rubric_mismatch", `Score every rubric criterion once.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${extra.length ? ` Not in the rubric: ${extra.join(", ")}.` : ""}`);
      }
      const id = randomUUID();
      transaction(db, () => {
        db.prepare("INSERT INTO reviews (id, target_type, target_id, reviewer_user_id, scores, feedback, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
          id, t.type, ctx.params.id ?? "", user.id, JSON.stringify(body.scores), body.feedback, body.outcome, new Date().toISOString(),
        );
        if (t.type === "submission") db.prepare("UPDATE submissions SET status = ? WHERE id = ?").run(body.outcome, t.row.id);
        recordAudit(db, { actorUserId: user.id, action: "review.created", targetType: t.type, targetId: ctx.params.id ?? "", metadata: { outcome: body.outcome } });
      });
      const row = db.prepare("SELECT r.*, u.display_name AS reviewer_name FROM reviews r LEFT JOIN users u ON u.id = r.reviewer_user_id WHERE r.id = ?").get(id) as unknown as ReviewRow;
      return ok({ review: reviewToApi(row) }, 201);
    },
    { auth: ["faculty", "admin"] },
  );

  /** The latest review of the learner's own submitted decision record, for the architecture page. */
  router.get(
    "/api/me/decisions/:architectureId/review",
    (ctx) => {
      const user = requireUser(ctx);
      const d = db.prepare("SELECT id, updated_at FROM architecture_decisions WHERE user_id = ? AND architecture_id = ?").get(user.id, ctx.params.architectureId ?? "") as { id: number; updated_at: string } | undefined;
      const r = d ? latestReview(db, "decision", String(d.id)) : undefined;
      return ok({ review: r ? { ...reviewToApi(r), current: r.created_at >= (d?.updated_at ?? "") } : null, rubric: DECISION_RUBRIC });
    },
    { auth: "user" },
  );

  // ---- Portfolio --------------------------------------------------------------------------------------

  router.get(
    "/api/me/portfolio",
    (ctx) => {
      const user = requireUser(ctx);
      const p = db.prepare("SELECT slug, headline, is_public FROM portfolios WHERE user_id = ?").get(user.id) as { slug: string; headline: string; is_public: number } | undefined;
      return ok({ portfolio: p ? { slug: p.slug, headline: p.headline, isPublic: p.is_public === 1 } : null });
    },
    { auth: "user" },
  );

  router.put(
    "/api/me/portfolio",
    async (ctx) => {
      const user = requireUser(ctx);
      const body = await readJson(ctx, PortfolioBody);
      const taken = db.prepare("SELECT user_id FROM portfolios WHERE slug = ?").get(body.slug) as { user_id: string } | undefined;
      if (taken && taken.user_id !== user.id) throw new HttpError(409, "slug_taken", "That address is taken. Choose another.");
      db.prepare(
        `INSERT INTO portfolios (user_id, slug, headline, is_public, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET slug = excluded.slug, headline = excluded.headline, is_public = excluded.is_public, updated_at = excluded.updated_at`,
      ).run(user.id, body.slug, body.headline, body.isPublic ? 1 : 0, new Date().toISOString());
      recordAudit(db, { actorUserId: user.id, action: body.isPublic ? "portfolio.published" : "portfolio.private", targetType: "user", targetId: user.id });
      return ok({ portfolio: { slug: body.slug, headline: body.headline, isPublic: body.isPublic } });
    },
    { auth: "user" },
  );

  /** Public portfolio: display name, headline, accepted projects and capstones, valid certificates. Private ones are 404. */
  router.get("/api/portfolio/:slug", (ctx) => {
    const p = db.prepare(
      "SELECT p.user_id, p.headline, u.display_name FROM portfolios p JOIN users u ON u.id = p.user_id WHERE p.slug = ? AND p.is_public = 1 AND u.disabled_at IS NULL",
    ).get(ctx.params.slug ?? "") as { user_id: string; headline: string; display_name: string } | undefined;
    if (!p) throw notFound("Portfolio");
    const work = (db.prepare("SELECT * FROM submissions WHERE user_id = ? AND status = 'accepted' ORDER BY submitted_at DESC").all(p.user_id) as unknown as SubmissionRow[])
      .map((s) => ({ kind: s.kind, item: describeItem(content, s.kind, s.item_id) ?? null, repositoryUrl: s.repository_url, acceptedAt: latestReview(db, "submission", s.id)?.created_at ?? s.submitted_at }))
      .filter((w) => w.item);
    const certificates = (db.prepare("SELECT id, track_slug, issued_at FROM certificates WHERE user_id = ? AND revoked_at IS NULL ORDER BY issued_at").all(p.user_id) as { id: string; track_slug: string; issued_at: string }[])
      .map((c) => ({ id: c.id, track: c.track_slug, trackTitle: content.getTrack(c.track_slug)?.title ?? c.track_slug, issuedAt: c.issued_at }));
    return ok({ portfolio: { name: p.display_name, headline: p.headline, work, certificates } });
  });

  // ---- Certificates -----------------------------------------------------------------------------------

  router.get(
    "/api/me/certificates",
    (ctx) => {
      const user = requireUser(ctx);
      const issued = new Map((db.prepare("SELECT id, track_slug, issued_at, revoked_at FROM certificates WHERE user_id = ?").all(user.id) as { id: string; track_slug: string; issued_at: string; revoked_at: string | null }[]).map((c) => [c.track_slug, c]));
      return ok({
        tracks: content.listTracks().map((t) => {
          const c = issued.get(t.slug);
          return { ...certificateEligibility(db, content, user.id, t.slug), title: t.title, shortTitle: t.short_title, certificate: c ? { id: c.id, issuedAt: c.issued_at, revoked: !!c.revoked_at } : null };
        }),
      });
    },
    { auth: "user" },
  );

  router.post(
    "/api/me/certificates/:track",
    (ctx) => {
      const user = requireUser(ctx);
      const track = content.getTrack(ctx.params.track ?? "");
      if (!track) throw notFound("Track");
      const existing = db.prepare("SELECT id, revoked_at FROM certificates WHERE user_id = ? AND track_slug = ?").get(user.id, track.slug) as { id: string; revoked_at: string | null } | undefined;
      if (existing && !existing.revoked_at) return ok({ certificate: { id: existing.id } });
      if (existing?.revoked_at) throw new HttpError(409, "revoked", "This certificate was revoked. Ask an administrator.");
      const e = certificateEligibility(db, content, user.id, track.slug);
      if (!e.eligible) throw new HttpError(409, "not_eligible", "Pass the track quiz and complete the track's server-verified practice first.");
      const id = randomBytes(16).toString("hex");
      db.prepare("INSERT INTO certificates (id, user_id, track_slug, holder_name, evidence, issued_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        id, user.id, track.slug, user.display_name, JSON.stringify({ quiz: e.quiz, labs: e.labs }), new Date().toISOString(),
      );
      recordAudit(db, { actorUserId: user.id, action: "certificate.issued", targetType: "certificate", targetId: id, metadata: { track: track.slug } });
      return ok({ certificate: { id } }, 201);
    },
    { auth: "user" },
  );

  /** Public verification of a certificate by its id. */
  router.get("/api/certificates/:id", (ctx) => {
    const c = db.prepare("SELECT * FROM certificates WHERE id = ?").get(ctx.params.id ?? "") as { id: string; track_slug: string; holder_name: string; evidence: string; issued_at: string; revoked_at: string | null } | undefined;
    if (!c) throw notFound("Certificate");
    const evidence = JSON.parse(c.evidence) as { quiz: { bestScore: number | null } | null; labs: { title: string }[] };
    return ok({
      certificate: {
        id: c.id, holder: c.holder_name, track: c.track_slug, trackTitle: content.getTrack(c.track_slug)?.title ?? c.track_slug,
        issuedAt: c.issued_at, revokedAt: c.revoked_at,
        criteria: { quizBestScore: evidence.quiz?.bestScore ?? null, verifiedLabs: evidence.labs.map((l) => l.title) },
      },
    });
  });

  router.post(
    "/api/certificates/:id/revoke",
    (ctx) => {
      const user = requireUser(ctx);
      const r = db.prepare("UPDATE certificates SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(new Date().toISOString(), ctx.params.id ?? "");
      if (r.changes === 0) throw notFound("Certificate");
      recordAudit(db, { actorUserId: user.id, action: "certificate.revoked", targetType: "certificate", targetId: ctx.params.id ?? "" });
      return noContent();
    },
    { auth: ["admin"] },
  );

  // ---- Privacy controls: export and delete your own data ----------------------------------------------

  /** Everything stored about the signed-in user, as one JSON download. */
  router.get(
    "/api/me/export",
    (ctx) => {
      const user = requireUser(ctx);
      const all = (sql: string) => db.prepare(sql).all(user.id) as Record<string, unknown>[];
      const data = {
        exportedAt: new Date().toISOString(),
        account: { id: user.id, email: user.email, displayName: user.display_name, role: user.role, createdAt: user.created_at },
        lessonProgress: all("SELECT lesson_id, track_slug, status, attempts, best_score, started_at, completed_at, updated_at FROM lesson_progress WHERE user_id = ?"),
        labProgress: all("SELECT lab_id, track_slug, evidence, completed_at FROM lab_progress WHERE user_id = ?"),
        simulationProgress: all("SELECT simulation_id, challenge_id, track_slug, actions, completed_at FROM simulation_progress WHERE user_id = ?"),
        quizAttempts: all("SELECT quiz_id, track_slug, score, passed, attempted_at FROM quiz_attempts WHERE user_id = ?"),
        bookmarks: all("SELECT item_type, item_id, created_at FROM bookmarks WHERE user_id = ?"),
        architectureDecisions: all("SELECT architecture_id, title, context, decision, consequences, status, created_at, updated_at FROM architecture_decisions WHERE user_id = ?"),
        submissions: all("SELECT kind, item_id, repository_url, notes, status, submitted_at FROM submissions WHERE user_id = ?"),
        reviewsReceived: all(
          `SELECT r.target_type, r.scores, r.feedback, r.outcome, r.created_at FROM reviews r
           WHERE (r.target_type = 'submission' AND r.target_id IN (SELECT id FROM submissions WHERE user_id = ?1))
              OR (r.target_type = 'decision' AND r.target_id IN (SELECT CAST(id AS TEXT) FROM architecture_decisions WHERE user_id = ?1))`,
        ),
        cohorts: all("SELECT c.name, m.role, m.joined_at FROM cohort_members m JOIN cohorts c ON c.id = m.cohort_id WHERE m.user_id = ?"),
        portfolio: all("SELECT slug, headline, is_public, updated_at FROM portfolios WHERE user_id = ?")[0] ?? null,
        certificates: all("SELECT id, track_slug, issued_at, revoked_at FROM certificates WHERE user_id = ?"),
      };
      return { status: 200, body: data, headers: { "content-disposition": 'attachment; filename="devforge-my-data.json"' } };
    },
    { auth: "user" },
  );

  /** Delete the signed-in account and everything that belongs to it, after re-entering the password. */
  router.post(
    "/api/me/delete",
    async (ctx) => {
      const user = requireUser(ctx);
      const body = await readJson(ctx, DeleteAccountBody);
      if (!(await limiters.loginFailuresByEmail.hit(`delete:${user.id}`)).allowed) throw new HttpError(429, "rate_limited", "Too many attempts. Try again later.");
      const check = await verifyPassword(body.password, user.password_hash, config.passwordHashLogN);
      if (!check.ok) throw new HttpError(403, "wrong_password", "That password is not correct.");
      transaction(db, () => {
        if (user.role === "admin" && countActiveAdmins(db) <= 1) throw new HttpError(409, "last_admin", "You are the last administrator. Make someone else an administrator first.");
        // Reviews are keyed by text ids, not foreign keys: remove the ones about this user's work explicitly.
        db.prepare("DELETE FROM reviews WHERE target_type = 'submission' AND target_id IN (SELECT id FROM submissions WHERE user_id = ?)").run(user.id);
        db.prepare("DELETE FROM reviews WHERE target_type = 'decision' AND target_id IN (SELECT CAST(id AS TEXT) FROM architecture_decisions WHERE user_id = ?)").run(user.id);
        deleteUserSessions(db, user.id);
        db.prepare("DELETE FROM users WHERE id = ?").run(user.id); // every other table cascades or sets NULL
        recordAudit(db, { actorUserId: null, action: "user.deleted_own_account", targetType: "user", targetId: user.id });
      });
      ctx.setCookies.push(serializeCookie(sessionCookieName(config.cookieSecure), "", { maxAgeSeconds: 0, secure: config.cookieSecure }));
      return noContent();
    },
    { auth: "user" },
  );
}

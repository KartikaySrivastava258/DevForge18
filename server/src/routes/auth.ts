import { z } from "zod/v4";
import { recordAudit } from "../auth/audit.ts";
import { hashPassword, passwordProblem, verifyPassword } from "../auth/password.ts";
import { createSession, deleteSession } from "../auth/sessions.ts";
import { findUserByEmail, insertUser, normaliseEmail, toPublicUser, updatePasswordHash, type UserRecord } from "../auth/users.ts";
import { ok, noContent, readJson, type RequestContext } from "../http/context.ts";
import { serializeCookie } from "../http/cookies.ts";
import { HttpError } from "../http/errors.ts";
import type { Router } from "../http/router.ts";
import { sessionCookieName, type AppDeps } from "./deps.ts";

const displayName = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(80, "Use at most 80 characters.")
  .refine((v) => !/[\u0000-\u001f\u007f<>]/.test(v), "Name contains characters that are not allowed.");

const RegisterBody = z.object({
  email: z.string().trim().max(254).email("Enter a valid email address."),
  displayName,
  password: z.string().max(200),
});

const LoginBody = z.object({
  email: z.string().trim().max(254).email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password.").max(200),
});

export function registerAuthRoutes(router: Router, deps: AppDeps): void {
  const { config, db, limiters } = deps;
  const cookieName = sessionCookieName(config.cookieSecure);
  let dummyHash: Promise<string> | undefined;

  const startSession = (ctx: RequestContext, user: UserRecord): void => {
    if (ctx.sessionToken) deleteSession(db, ctx.sessionToken); // prevent session fixation
    const { token } = createSession(db, user.id, config.sessionTtlHours, ctx.req.headers["user-agent"]);
    ctx.setCookies.push(
      serializeCookie(cookieName, token, {
        maxAgeSeconds: config.sessionTtlHours * 3600,
        secure: config.cookieSecure,
        sameSite: "Lax",
      }),
    );
  };

  const tooMany = (retryAfterSeconds: number) =>
    new HttpError(429, "rate_limited", `Too many attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`, {
      retryAfterSeconds,
    });

  router.post("/api/auth/register", async (ctx) => {
    const limit = limiters.register.hit(`register:${ctx.ip}`);
    if (!limit.allowed) throw tooMany(limit.retryAfterSeconds);

    const body = await readJson(ctx, RegisterBody);
    const problem = passwordProblem(body.password, body.email);
    if (problem) throw new HttpError(400, "validation_failed", "Some fields are invalid.", [{ field: "password", message: problem }]);
    if (findUserByEmail(db, body.email)) {
      throw new HttpError(409, "email_taken", "An account with this email already exists. Try signing in.");
    }
    const passwordHash = await hashPassword(body.password, config.passwordHashLogN);
    let user: UserRecord;
    try {
      user = insertUser(db, { email: body.email, displayName: body.displayName, passwordHash, role: "student" });
    } catch (err) {
      // A concurrent registration with the same email loses the UNIQUE race.
      if (String(err).includes("UNIQUE")) throw new HttpError(409, "email_taken", "An account with this email already exists. Try signing in.");
      throw err;
    }
    recordAudit(db, { actorUserId: user.id, action: "user.registered", targetType: "user", targetId: user.id });
    startSession(ctx, user);
    return ok({ user: toPublicUser(user) }, 201);
  });

  router.post("/api/auth/login", async (ctx) => {
    const ipLimit = limiters.loginByIp.hit(`login-ip:${ctx.ip}`);
    if (!ipLimit.allowed) throw tooMany(ipLimit.retryAfterSeconds);

    const body = await readJson(ctx, LoginBody);
    const emailKey = `login-email:${normaliseEmail(body.email)}`;
    const user = findUserByEmail(db, body.email);

    // Always run one scrypt verification so response time does not reveal whether the account exists.
    dummyHash ??= hashPassword("not-a-real-password-for-timing", config.passwordHashLogN);
    const verification = await verifyPassword(body.password, user?.password_hash ?? (await dummyHash), config.passwordHashLogN);

    if (!user || !verification.ok || user.disabled_at) {
      const failures = limiters.loginFailuresByEmail.hit(emailKey);
      if (!failures.allowed) throw tooMany(failures.retryAfterSeconds);
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
    }
    limiters.loginFailuresByEmail.reset(emailKey);
    if (verification.needsRehash) updatePasswordHash(db, user.id, await hashPassword(body.password, config.passwordHashLogN));
    recordAudit(db, { actorUserId: user.id, action: "user.login", targetType: "user", targetId: user.id });
    startSession(ctx, user);
    return ok({ user: toPublicUser(user) });
  });

  router.post("/api/auth/logout", (ctx) => {
    if (ctx.sessionToken) deleteSession(db, ctx.sessionToken);
    ctx.setCookies.push(serializeCookie(cookieName, "", { maxAgeSeconds: 0, secure: config.cookieSecure }));
    return noContent();
  });

  router.get("/api/auth/me", (ctx) => ok({ user: ctx.user ? toPublicUser(ctx.user) : null }));
}

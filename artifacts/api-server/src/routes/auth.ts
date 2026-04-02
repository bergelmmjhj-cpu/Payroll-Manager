import { Router, type IRouter } from "express";
import passport from "passport";
import { db, authUsersTable, workersTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function isSafeRedirectPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

router.get("/auth/google", (req, res, next): void => {
  const beginGoogleAuth = (): void => {
    passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
  };

  const redirect = typeof req.query.redirect === "string" ? req.query.redirect : undefined;
  logger.info(
    {
      sessionId: req.sessionID,
      requestedRedirect: redirect,
      existingReturnTo: (req.session as any)?.returnTo,
      path: req.path,
    },
    "oauth_start_request",
  );

  if (isSafeRedirectPath(redirect)) {
    const session = req.session as any;
    session.returnTo = redirect;
    session.save((err: unknown) => {
      if (err) {
        logger.error({ err, sessionId: req.sessionID, redirect }, "oauth_start_session_save_failed");
        next(err);
        return;
      }

      logger.info(
        { sessionId: req.sessionID, savedReturnTo: session.returnTo, path: req.path },
        "oauth_start_session_saved",
      );

      beginGoogleAuth();
    });
    return;
  }

  logger.info(
    { sessionId: req.sessionID, requestedRedirect: redirect, path: req.path },
    "oauth_start_without_return_to",
  );

  beginGoogleAuth();
});

router.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login?error=auth_failed" }),
  (req, res): void => {
    const session = req.session as any;
    const returnTo = isSafeRedirectPath(session?.returnTo) ? session.returnTo : undefined;

    const user = req.user as any;
    const isWorker = !!user?.workerId && !user?.isAdmin;

    const finalTarget = returnTo ?? (isWorker ? "/timecard" : "/");

    logger.info(
      {
        sessionId: req.sessionID,
        sessionReturnTo: session?.returnTo,
        resolvedReturnTo: returnTo,
        userId: user?.id,
        userRole: user?.role,
        userIsAdmin: user?.isAdmin,
        userWorkerId: user?.workerId,
        finalTarget,
      },
      "oauth_callback_resolved_redirect",
    );

    if (session?.returnTo) {
      delete session.returnTo;
    }

    session.save((err: unknown) => {
      if (err) {
        logger.error({ err, sessionId: req.sessionID }, "oauth_callback_session_cleanup_failed");
      }
      res.redirect(finalTarget);
    });
  },
);

router.get("/auth/me", (req, res): void => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = req.user as any;
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    googleId: user.googleId,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    role: user.role ?? (user.isAdmin ? "admin" : "worker"),
    workerId: user.workerId ?? null,
  });
});

router.post("/auth/logout", (req, res): void => {
  req.logout(() => {
    res.json({ message: "Logged out successfully" });
  });
});

router.get("/auth/worker-match", async (req, res): Promise<void> => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = req.user as any;
  const [match] = await db
    .select({ id: workersTable.id, name: workersTable.name, email: workersTable.email })
    .from(workersTable)
    .where(eq(workersTable.email, user.email))
    .limit(1);

  res.json(match ?? null);
});

router.post("/auth/link-worker", async (req, res): Promise<void> => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const actor = req.user as any;
  if (!actor.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const authUserId = parseInt(String(req.body.authUserId), 10);
  const workerId   = parseInt(String(req.body.workerId), 10);

  if (!authUserId || !workerId) {
    res.status(400).json({ error: "authUserId and workerId are required" });
    return;
  }

  const [worker] = await db
    .select({ id: workersTable.id })
    .from(workersTable)
    .where(eq(workersTable.id, workerId))
    .limit(1);
  if (!worker) { res.status(404).json({ error: "Worker not found" }); return; }

  const [alreadyClaimed] = await db
    .select({ id: authUsersTable.id })
    .from(authUsersTable)
    .where(and(eq(authUsersTable.workerId, workerId), ne(authUsersTable.id, authUserId)))
    .limit(1);
  if (alreadyClaimed) {
    res.status(409).json({ error: "This worker is already linked to another account" });
    return;
  }

  const [updated] = await db
    .update(authUsersTable)
    .set({ workerId, isAdmin: false, role: "worker" })
    .where(eq(authUsersTable.id, authUserId))
    .returning();

  res.json(updated);
});

export default router;

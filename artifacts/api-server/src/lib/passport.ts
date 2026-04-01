import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db, authUsersTable, workersTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { logger } from "./logger";

const replitDomain = process.env.REPLIT_DEV_DOMAIN;
const replitDomains = process.env.REPLIT_DOMAINS?.split(",")[0];
const localPort = process.env.PORT ?? "8080";
const appOrigin = process.env.APP_ORIGIN
  ?? process.env.FRONTEND_URL
  ?? (replitDomain
    ? `https://${replitDomain}`
    : replitDomains
      ? `https://${replitDomains}`
      : `http://localhost:${localPort}`);

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!googleClientId) {
  throw new Error("GOOGLE_CLIENT_ID must be set before starting the API server.");
}

if (!googleClientSecret) {
  throw new Error("GOOGLE_CLIENT_SECRET must be set before starting the API server.");
}

const callbackUrl =
  process.env.GOOGLE_CALLBACK_URL ??
  `${appOrigin}/api/auth/google/callback`;

passport.use(
  new GoogleStrategy(
    {
      clientID: googleClientId,
      clientSecret: googleClientSecret,
      callbackURL: callbackUrl,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value ?? "";
        const name = profile.displayName ?? email;
        const avatarUrl = profile.photos?.[0]?.value ?? null;

        const existing = await db
          .select()
          .from(authUsersTable)
          .where(eq(authUsersTable.googleId, profile.id))
          .limit(1);

        if (existing.length > 0) {
          const [user] = await db
            .update(authUsersTable)
            .set({ name, avatarUrl, email })
            .where(eq(authUsersTable.googleId, profile.id))
            .returning();

          // Try auto-link on re-login if not yet linked
          if (!user.workerId) {
            const [matchingWorker] = await db
              .select()
              .from(workersTable)
              .where(eq(workersTable.email, email))
              .limit(1);

            if (matchingWorker) {
              const [alreadyClaimed] = await db
                .select({ id: authUsersTable.id })
                .from(authUsersTable)
                .where(
                  and(
                    eq(authUsersTable.workerId, matchingWorker.id),
                    ne(authUsersTable.id, user.id),
                  ),
                )
                .limit(1);

              if (!alreadyClaimed) {
                const [linked] = await db
                  .update(authUsersTable)
                  .set({ workerId: matchingWorker.id, isAdmin: false, role: "worker" })
                  .where(eq(authUsersTable.id, user.id))
                  .returning();
                return done(null, linked);
              }
            }
          }

          return done(null, user);
        }

        const [user] = await db
          .insert(authUsersTable)
          .values({ googleId: profile.id, email, name, avatarUrl })
          .returning();

        // Auto-link: if email matches an existing worker that is not yet claimed,
        // link this auth account to that worker and demote from admin.
        if (!user.workerId) {
          const [matchingWorker] = await db
            .select()
            .from(workersTable)
            .where(eq(workersTable.email, email))
            .limit(1);

          if (matchingWorker) {
            const [alreadyClaimed] = await db
              .select({ id: authUsersTable.id })
              .from(authUsersTable)
              .where(
                and(
                  eq(authUsersTable.workerId, matchingWorker.id),
                  ne(authUsersTable.id, user.id),
                ),
              )
              .limit(1);

            if (!alreadyClaimed) {
              const [linked] = await db
                .update(authUsersTable)
                .set({ workerId: matchingWorker.id, isAdmin: false, role: "worker" })
                .where(eq(authUsersTable.id, user.id))
                .returning();
              return done(null, linked);
            }
            // Ambiguous: two Google accounts competing for the same worker.
            // Leave for admin to resolve via POST /api/auth/link-worker.
            logger.warn(
              { workerId: matchingWorker.id, authUserId: user.id },
              "Worker email already claimed by another auth account – skipping auto-link",
            );
          }
        }

        return done(null, user);
      } catch (err) {
        logger.error({ err }, "Passport Google strategy error");
        return done(err as Error);
      }
    },
  ),
);

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: number, done) => {
  try {
    const [user] = await db
      .select()
      .from(authUsersTable)
      .where(eq(authUsersTable.id, id))
      .limit(1);

    done(null, user ?? null);
  } catch (err) {
    done(err);
  }
});

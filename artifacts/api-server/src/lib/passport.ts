import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db, authUsersTable, workersTable } from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
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
        const rawEmail = profile.emails?.[0]?.value ?? "";
        const normalizedEmail = rawEmail.trim().toLowerCase();
        const name = profile.displayName ?? normalizedEmail;
        const avatarUrl = profile.photos?.[0]?.value ?? null;

        logger.info(
          { googleId: profile.id, rawEmail, normalizedEmail },
          "passport_google_profile_received",
        );

        const existing = await db
          .select()
          .from(authUsersTable)
          .where(eq(authUsersTable.googleId, profile.id))
          .limit(1);

        if (existing.length > 0) {
          logger.info({ authUserId: existing[0].id, normalizedEmail }, "passport_existing_google_user");

          const [user] = await db
            .update(authUsersTable)
            .set({ name, avatarUrl, email: normalizedEmail })
            .where(eq(authUsersTable.googleId, profile.id))
            .returning();

          // Try auto-link on re-login if not yet linked
          if (!user.workerId) {
            const [matchingWorker] = await db
              .select()
              .from(workersTable)
              .where(sql`lower(${workersTable.email}) = ${normalizedEmail}`)
              .limit(1);

            logger.info(
              {
                authUserId: user.id,
                normalizedEmail,
                matchingWorkerId: matchingWorker?.id,
              },
              "passport_relogin_worker_match",
            );

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
                logger.info(
                  { authUserId: user.id, workerId: matchingWorker.id },
                  "passport_relogin_worker_autolinked",
                );
                return done(null, linked);
              }

              logger.warn(
                { authUserId: user.id, workerId: matchingWorker.id, claimedByAuthUserId: alreadyClaimed.id },
                "passport_relogin_worker_already_claimed",
              );
            }

            if (!matchingWorker) {
              logger.info({ authUserId: user.id, normalizedEmail }, "passport_relogin_no_worker_match");
            }
          }

          logger.info(
            { authUserId: user.id, workerId: user.workerId, isAdmin: user.isAdmin, role: user.role },
            "passport_relogin_no_link_change",
          );
          return done(null, user);
        }

        const [user] = await db
          .insert(authUsersTable)
          .values({ googleId: profile.id, email: normalizedEmail, name, avatarUrl })
          .returning();

        logger.info({ authUserId: user.id, normalizedEmail }, "passport_new_google_user_created");

        // Auto-link: if email matches an existing worker that is not yet claimed,
        // link this auth account to that worker and demote from admin.
        if (!user.workerId) {
          const [matchingWorker] = await db
            .select()
            .from(workersTable)
            .where(sql`lower(${workersTable.email}) = ${normalizedEmail}`)
            .limit(1);

          logger.info(
            { authUserId: user.id, normalizedEmail, matchingWorkerId: matchingWorker?.id },
            "passport_new_user_worker_match",
          );

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
              logger.info(
                { authUserId: user.id, workerId: matchingWorker.id },
                "passport_new_user_worker_autolinked",
              );
              return done(null, linked);
            }
            // Ambiguous: two Google accounts competing for the same worker.
            // Leave for admin to resolve via POST /api/auth/link-worker.
            logger.warn(
              {
                workerId: matchingWorker.id,
                authUserId: user.id,
                claimedByAuthUserId: alreadyClaimed.id,
                normalizedEmail,
              },
              "Worker email already claimed by another auth account – skipping auto-link",
            );
          } else {
            logger.info({ authUserId: user.id, normalizedEmail }, "passport_new_user_no_worker_match");
          }
        }

        logger.info(
          { authUserId: user.id, workerId: user.workerId, isAdmin: user.isAdmin, role: user.role },
          "passport_new_user_no_link_change",
        );
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

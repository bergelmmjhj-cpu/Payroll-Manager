import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db, authUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const replitDomain = process.env.REPLIT_DEV_DOMAIN;
const replitDomains = process.env.REPLIT_DOMAINS?.split(",")[0];
const baseUrl = replitDomain
? `https://${replitDomain}`
: replitDomains
? `https://${replitDomains}`
: (process.env.FRONTEND_URL ?? "http://localhost:80");

// ✅ FIXED: use GOOGLE_CALLBACK_URL if provided
const callbackUrl =
process.env.GOOGLE_CALLBACK_URL ??
`${baseUrl}/api/auth/google/callback`;

passport.use(
new GoogleStrategy(
{
clientID: process.env.GOOGLE_CLIENT_ID!,
clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
callbackURL: callbackUrl,
},
async (_accessToken, _refreshToken, profile, done) => {
try {
const email = profile.emails?.[0]?.value ?? "";
const name = profile.displayName ?? email;
const avatarUrl = profile.photos?.[0]?.value ?? null;

```
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
      return done(null, user);
    }

    const [user] = await db
      .insert(authUsersTable)
      .values({ googleId: profile.id, email, name, avatarUrl })
      .returning();

    return done(null, user);
  } catch (err) {
    logger.error({ err }, "Passport Google strategy error");
    return done(err as Error);
  }
},
```

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

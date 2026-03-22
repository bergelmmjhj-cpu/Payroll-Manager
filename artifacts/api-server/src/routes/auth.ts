import { Router, type IRouter } from "express";
import passport from "passport";

const router: IRouter = Router();

const replitDomain = process.env.REPLIT_DEV_DOMAIN;
const replitDomains = process.env.REPLIT_DOMAINS?.split(",")[0];
const FRONTEND_URL = replitDomain
  ? `https://${replitDomain}`
  : replitDomains
    ? `https://${replitDomains}`
    : (process.env.FRONTEND_URL ?? "");

router.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login?error=auth_failed" }),
  (_req, res): void => {
    res.redirect(`${FRONTEND_URL}/`);
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
  });
});

router.post("/auth/logout", (req, res): void => {
  req.logout(() => {
    res.json({ message: "Logged out successfully" });
  });
});

export default router;

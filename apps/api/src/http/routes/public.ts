import { Router, type CookieOptions } from "express";
import rateLimit from "express-rate-limit";
import { catalogQuerySchema, demoLoginSchema, idParam, loginSchema } from "@enroll/shared";
import { requireAuth } from "../middleware.js";
import type { Services } from "../services.js";
import { SESSION_COOKIE } from "../../services/AuthService.js";

export function publicRoutes(s: Services, loginLimit: number): Router {
  const r = Router();
  const cookieOpts: CookieOptions = {
    httpOnly: true, // JavaScript on the page can never read the session token
    secure: s.config.cookieSecure,
    sameSite: "lax", // not sent on cross-site POST/PUT/DELETE: the CSRF defence
    path: "/",
  };
  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: loginLimit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Please wait a few minutes and try again." } },
  });

  r.get("/health", (_req, res) => { res.json({ ok: true, time: new Date().toISOString() }); });

  r.post("/auth/login", limiter, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const { user, token } = await s.auth.login(email, password);
    res.cookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: 8 * 3600_000 }).json({ user });
  });
  r.post("/auth/demo-login", limiter, async (req, res) => {
    const { email } = demoLoginSchema.parse(req.body);
    const { user, token } = await s.auth.demoLogin(email);
    res.cookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: 8 * 3600_000 }).json({ user });
  });
  r.post("/auth/logout", (_req, res) => { res.clearCookie(SESSION_COOKIE, cookieOpts).json({ ok: true }); });
  r.get("/auth/me", requireAuth, (req, res) => { res.json({ user: req.user }); });
  r.get("/auth/demo-accounts", async (_req, res) => { res.json({ accounts: await s.auth.demoAccounts() }); });

  // Everything below needs a signed-in user.
  r.use(requireAuth);
  r.get("/meta", async (_req, res) => { res.json(await s.admin.meta()); });
  r.get("/terms", async (_req, res) => { res.json({ terms: await s.admin.terms() }); });
  r.get("/announcements", async (_req, res) => { res.json({ announcements: await s.admin.announcements() }); });

  r.get("/courses", async (req, res) => {
    const q = catalogQuerySchema.parse(req.query);
    res.json(await s.portal.catalog(req.user!.studentId, q));
  });
  r.get("/courses/:id", async (req, res) => {
    res.json(await s.portal.courseDetail(idParam.parse(req.params.id), req.user!.studentId));
  });

  // Notifications work for every role; every query is scoped to the signed-in user's id.
  r.get("/me/notifications", async (req, res) => { res.json(await s.portal.notifications(req.user!.id)); });
  r.patch("/notifications/:id/read", async (req, res) => {
    await s.portal.markNotificationRead(idParam.parse(req.params.id), req.user!.id);
    res.json({ ok: true });
  });
  r.post("/notifications/read-all", async (req, res) => {
    await s.portal.markAllNotificationsRead(req.user!.id);
    res.json({ ok: true });
  });
  return r;
}

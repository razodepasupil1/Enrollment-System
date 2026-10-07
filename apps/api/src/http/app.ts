import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { loadConfig, type Config } from "../config.js";
import { getPool, type Pool } from "../db/pool.js";
import { authenticate, errorHandler, noStore } from "./middleware.js";
import { publicRoutes } from "./routes/public.js";
import { staffRoutes } from "./routes/staff.js";
import { studentRoutes } from "./routes/student.js";
import { buildServices, type Services } from "./services.js";

export interface AppOptions {
  pool?: Pool;
  config?: Config;
  clock?: () => Date;
  /** Max sign-in attempts per IP per 15 minutes. */
  loginLimit?: number;
}

/**
 * Builds the Express app WITHOUT calling listen(): server.ts listens locally, Vercel imports it as a
 * serverless handler, and the tests drive it with Supertest. All three get identical behaviour.
 */
export function createApp(opts: AppOptions = {}): Express & { services: Services } {
  const config = opts.config ?? loadConfig();
  const services = buildServices(opts.pool ?? getPool(), config, opts.clock);
  const app = express() as Express & { services: Services };
  app.services = services;

  // Behind Vercel's proxy the real client IP is in X-Forwarded-For; needed for per-IP rate limiting.
  if (config.nodeEnv === "production") app.set("trust proxy", 1);
  app.use(helmet());
  if (config.clientOrigin) app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(noStore);
  api.use(authenticate(services.auth));
  api.use(publicRoutes(services, opts.loginLimit ?? 20));
  api.use(studentRoutes(services));
  api.use(staffRoutes(services));
  api.use((_req, res) => { res.status(404).json({ error: { code: "NOT_FOUND", message: "No such endpoint." } }); });

  app.use("/api", api);
  app.use(errorHandler);
  return app;
}

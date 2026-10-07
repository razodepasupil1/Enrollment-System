import dotenv from "dotenv";

// Local dev reads .env; on Vercel the variables come from the project settings and no file exists.
dotenv.config({ path: [".env", "../../.env"], quiet: true });

export interface Config {
  databaseUrl: string;
  dbSsl: boolean;
  /** PEM text of the database's CA certificate, for providers (like Aiven) that sign with their own CA. */
  dbSslCa: string | null;
  poolLimit: number;
  jwtSecret: string;
  cookieSecure: boolean;
  clientOrigin: string | null;
  demoMode: boolean;
  nodeEnv: string;
  port: number;
  gradingPolicy: string;
}

const bool = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined || v === "" ? fallback : ["1", "true", "yes"].includes(v.toLowerCase());

/** Fails fast in production if secrets are missing instead of silently using dev defaults. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? "development";
  const prod = nodeEnv === "production";

  const databaseUrl = env.DATABASE_URL ?? (prod ? "" : "mysql://enroll:enroll_pw@127.0.0.1:3307/enrollment_dev");
  if (!databaseUrl) throw new Error("DATABASE_URL is required in production.");

  const jwtSecret = env.JWT_SECRET ?? (prod ? "" : "dev-only-secret-change-me-dev-only-secret");
  if (prod && jwtSecret.length < 32) throw new Error("JWT_SECRET must be set to at least 32 characters in production.");

  return {
    databaseUrl,
    dbSsl: bool(env.DB_SSL, false),
    // Env vars are one line, so a PEM is supplied with literal \n sequences; turn them back into newlines.
    dbSslCa: env.DB_SSL_CA ? env.DB_SSL_CA.replace(/\\n/g, "\n") : null,
    poolLimit: Math.min(5, Math.max(1, Number(env.DB_POOL_LIMIT ?? 5))),
    jwtSecret,
    cookieSecure: bool(env.COOKIE_SECURE, prod),
    clientOrigin: env.CLIENT_ORIGIN || null,
    demoMode: bool(env.DEMO_MODE, false),
    nodeEnv,
    port: Number(env.PORT ?? 4000),
    gradingPolicy: env.GRADING_POLICY ?? "four-point",
  };
}

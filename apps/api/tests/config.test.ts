import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { connectionOptions } from "../src/db/pool.js";

const base = { DATABASE_URL: "mysql://u:p%40ss@db.example.com:3306/app" } as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("fails fast in production when secrets are missing or weak", () => {
    expect(() => loadConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, NODE_ENV: "production", JWT_SECRET: "short" })).toThrow(/32/);
  });

  it("production defaults are safe: secure cookies on, demo mode off", () => {
    const c = loadConfig({ ...base, NODE_ENV: "production", JWT_SECRET: "x".repeat(40) });
    expect(c.cookieSecure).toBe(true);
    expect(c.demoMode).toBe(false);
  });

  it("clamps the pool size so serverless instances cannot exhaust a small hosted database", () => {
    expect(loadConfig({ ...base, DB_POOL_LIMIT: "500" }).poolLimit).toBe(5);
    expect(loadConfig({ ...base, DB_POOL_LIMIT: "0" }).poolLimit).toBe(1);
  });
});

describe("TLS to the database", () => {
  it("is off locally and on (with certificate checking) when DB_SSL=true", () => {
    expect(connectionOptions(loadConfig(base)).ssl).toBeUndefined();
    const ssl = connectionOptions(loadConfig({ ...base, DB_SSL: "true" })).ssl as { rejectUnauthorized: boolean; minVersion: string };
    expect(ssl).toMatchObject({ rejectUnauthorized: true, minVersion: "TLSv1.2" });
  });

  it("accepts a provider's private CA certificate without ever disabling verification", () => {
    const pem = "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----";
    const ssl = connectionOptions(loadConfig({ ...base, DB_SSL: "true", DB_SSL_CA: pem })).ssl as { rejectUnauthorized: boolean; ca: string };
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toBe("-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----"); // literal \n became real newlines
  });

  it("decodes URL-encoded credentials", () => {
    expect(connectionOptions(loadConfig(base)).password).toBe("p@ss");
  });
});

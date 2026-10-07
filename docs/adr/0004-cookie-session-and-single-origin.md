# ADR 0004: httpOnly cookie session, one origin

**Status:** accepted

## Decision
Login sets a signed JWT in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). No token is ever put in
`localStorage` or readable by page JavaScript. The user is re-read from the database on every request, so a
deleted account or changed role takes effect immediately. The web project proxies `/api/*` to the API project, so
the browser only ever talks to one origin.

## Consequences
- An XSS bug cannot exfiltrate the session.
- `SameSite=Lax` blocks cross-site POST/PUT/DELETE from carrying the cookie, which is the CSRF defence.
- One origin means no CORS configuration; `CLIENT_ORIGIN` exists only for a split-origin setup.
- The cost is one extra query per authenticated request.
- Login rate limiting is per server instance on serverless, so it is a speed bump, not a global limit.

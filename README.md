# Course Enrollment System

A registrar-style portal where students enroll in and drop courses, built around three OOP classes
(`Student`, `Course`, `Enrollment`) and a rule engine that decides what is allowed. A student can enroll,
drop, and view enrolled courses; every course has a code, title, and capacity and can never be over-enrolled;
an enrollment links exactly one student to exactly one course.

Beyond the required behaviour it has waitlists with automatic promotion, prerequisites and corequisites,
schedule-conflict and unit-limit checks, grades and GPA, an admin console, and a **Rush Simulator** that fires
dozens of simultaneous enrollments at one course to demonstrate that no seat is ever oversold.

## What it does

**Students** browse a filterable catalog where every course shows its seats as a strip of pips (filled means
taken, dots after them are people waiting), add courses to a cart that checks each one live and explains exactly
why a course is blocked, then enroll in all of them at once with a per-course result report. They get a weekly
timetable (with `.ics` export), their transcript and GPA, degree progress, a "what can I take next?" list,
overload requests, and a printable certificate of registration. Dropping asks first and says whether the result
is a clean drop or a **W** on the transcript.

**Instructors** see their classes, rosters with waitlist order, and enter grades.

**Registrars (admins)** manage courses (capacity, meetings, prerequisites), students, instructors, and terms;
place and clear holds; decide overload requests; send announcements; override rules with a mandatory reason;
see analytics; export CSV; read the audit log; and run the Rush Simulator.

| Tier | Features |
|---|---|
| Required | Enroll, drop (with confirm), view enrolled courses, course code/title/capacity, over-enrollment prevention, one student per enrollment, many-to-many, prerequisites, grade input |
| Expected | Roles, terms with registration windows and add/drop deadlines, catalog search/filter/sort/pagination (filters live in the URL), cart with live dry-run and partial-success submit, rule engine with human-readable errors, waitlist with auto-promotion and notifications, DROPPED vs WITHDRAWN, weekly timetable and `.ics`, grades/GPA/standing/printable transcript, certificate of registration, holds, notification bell, audit log, admin console, instructor view, analytics dashboard |
| Differentiators | Rush Simulator, degree progress, "What can I take next?", overload request workflow, schedule suggester, command palette (Ctrl/Cmd+K), near-real-time seat counts (polling), accessibility pass |

## Tech stack

| Concern | Choice |
|---|---|
| Monorepo | pnpm workspaces: `apps/web`, `apps/api`, `packages/shared` |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Radix primitives, TanStack Query, React Router, react-hook-form + zod, Recharts, Sonner, cmdk, lucide-react |
| Backend | Node, Express 5, TypeScript, `mysql2/promise`, zod, `jsonwebtoken`, `bcryptjs`, helmet, express-rate-limit |
| Database | MySQL 8 (InnoDB) |
| Hosting | Vercel (static frontend and the API as a serverless function) |
| Tests | Vitest, Supertest, Testing Library (jsdom) |

## Quick start (local)

You need Node 20+ (22 recommended), pnpm, and MySQL 8.

```bash
pnpm install
cp .env.example .env            # the defaults work for local development

# MySQL 8 with the right databases and user (or use your own MySQL and run docker/init.sql against it):
docker compose up -d

pnpm db:reset                   # create the tables and load the demo data
pnpm dev                        # web on http://localhost:5173, API on http://localhost:4000
```

Open http://localhost:5173. With `DEMO_MODE=true` the sign-in page lists one-click demo accounts. Every demo
account uses the password `Demo#1234`:

| Account | Why it is interesting |
|---|---|
| `ana.reyes@student.test` | Main demo student: try CS201 (prerequisite error) and PHYS101 (schedule conflict) |
| `ben.cruz@student.test` | Enrolled in the full class CS240 |
| `faye.gomez@student.test` | #1 on the CS240 waitlist; promoted when someone drops |
| `dan.garcia@student.test` | At the unit limit (9 of 9) |
| `hana.ignacio@student.test` | Has a financial hold |
| `ivan.jimenez@student.test` | Has a pending overload request |
| `karl.lim@student.test` | Enrolled in a course past its drop deadline (dropping gives a W) |
| `lia.mendoza@student.test` | Empty schedule |
| `instructor@school.test` | Computer Science instructor |
| `admin@school.test` | Registrar |

### Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Web and API together (Vite proxies `/api` to the API, like production) |
| `pnpm typecheck` | TypeScript across every package |
| `pnpm test` | All tests, one package at a time (they share one `*_test` database) |
| `pnpm build` | Type-checks, bundles the API, builds the frontend |
| `pnpm lint` | Same as typecheck (the type system is the linter here) |
| `pnpm contrast` | WCAG contrast check of every colour pair, both themes |
| `pnpm db:migrate` | Apply new migrations |
| `pnpm db:seed` | **Wipe all data** and load the demo dataset |
| `pnpm db:reset` | Drop every table, migrate, seed |

Tests use a separate database. They `TRUNCATE` tables, so they refuse to run unless the database name ends in
`_test` (default `enrollment_test`, set `TEST_DATABASE_URL` to change it).

## Environment variables

Documented in [`.env.example`](.env.example).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `mysql://user:password@host:3306/database` |
| `DB_SSL` | `true` for hosted databases (certificate checking stays on) |
| `DB_SSL_CA` | PEM of the provider's CA as one line with literal `\n`, for providers with a private CA |
| `DB_POOL_LIMIT` | Connections per server instance, clamped 1 to 5 |
| `JWT_SECRET` | 32+ random characters (required in production) |
| `COOKIE_SECURE` | `true` in production (defaults to true when `NODE_ENV=production`) |
| `CLIENT_ORIGIN` | Only if the browser calls the API from a different origin (normally empty) |
| `DEMO_MODE` | One-click demo logins and the Rush Simulator. **Off by default**, see the warning below |
| `GRADING_POLICY` | `four-point` (0.0 to 4.0, higher is better) or `five-point` (1.0 to 5.0, lower is better) |

## Deploying to Vercel

Two Vercel projects from this one repo. The browser sees a single origin: the web project serves the app and
proxies `/api/*` to the API project, so the session cookie is first-party and no CORS setup is needed.

### 1. A hosted MySQL 8 database

Any MySQL 8 works. Free options researched on 4 Oct 2026 from the providers' own documentation. **Free tiers
change; check the current terms before you rely on one.**

- **Aiven for MySQL (free plan)**: a real MySQL service: 1 CPU, 1 GB RAM, 1 GB disk, `max_connections` 76, no
  time limit and no credit card; one free service per type per organization, and idle free services may be
  shut down. Aiven signs its certificates with its own CA, so download the CA certificate from the service page
  and set `DB_SSL=true` and `DB_SSL_CA`. Docs: https://aiven.io/docs/products/mysql/concepts/mysql-free-tier.
  **This is the safest choice for this project because it is real MySQL, the engine the tests ran on.**
- **TiDB Cloud Starter**: a monthly free quota (5 GiB row storage, 5 GiB columnar storage, 50 million request
  units), up to five free instances per organization, no credit card; once the quota is used, new connections are
  refused until the monthly reset. It is MySQL-**compatible**, not MySQL. This project uses stored generated
  columns, CHECK constraints, and `READ COMMITTED` row locks, and **has only been tested on MySQL 8.0**. Docs:
  https://docs.pingcap.com/tidbcloud/select-cluster-tier.

Load the schema and demo data once, from your own machine:

```bash
export DATABASE_URL='mysql://USER:PASSWORD@HOST:PORT/DATABASE'
export DB_SSL=true DB_SSL_CA='-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'
pnpm db:migrate && pnpm db:seed
```

> `db:seed` **deletes every row** before loading the demo data. Run it only on a fresh database.

### 2. The API project

New Vercel project, **Root Directory `apps/api`**. Vercel reads `apps/api/vercel.json` (build command, catch-all
rewrite, function entry). Set these environment variables: `DATABASE_URL`, `DB_SSL=true`, `DB_SSL_CA` (if
needed), `JWT_SECRET` (`openssl rand -base64 48`), and `DEMO_MODE`. Deploy, then open
`https://YOUR-API.vercel.app/api/health`: you should see `{"ok":true,...}`.

The API is bundled into one self-contained file (`dist/app.cjs`) by `pnpm build:vercel`, and `api/index.js`
re-exports it. See [ADR 0003](docs/adr/0003-bundle-the-api-for-vercel.md) for why.

### 3. The web project

Put the API's host into `apps/web/vercel.json` (replace `REPLACE-WITH-YOUR-API-PROJECT`), commit, then create
a second Vercel project with **Root Directory `apps/web`** (framework Vite). No environment variables are
needed. Test through the web project's URL: `/api/health`, sign in, enroll, drop.

> **Verification status:** the bundle and the entry stub were run locally with plain Node, from an empty
> directory with no `node_modules`, against MySQL. I could not run an actual Vercel deployment from the build
> environment, so the first deploy may need small adjustments to the project settings.

### Turn the demo features off afterwards

`DEMO_MODE=true` makes every demo account sign-in-able with a known password, including the admin. That is
fine for a classroom demo with fake data. For anything else set `DEMO_MODE=false` (the default); the demo login
and the Rush Simulator are then refused by the server.

## Project structure

```
apps/
  api/
    api/index.js            Vercel entry (re-exports the bundle)
    src/
      app.ts, server.ts     app factory (no listen) / local server
      domain/               Student, Course, Enrollment, Term, grading policies. No framework imports
      rules/                EnrollmentRule interface, 10 rule classes, RuleEngine
      services/             EnrollmentService (transactions), Portal/Admin/Instructor/Auth services
      repositories/         SQL only, parameterized
      http/                 middleware, routes, error mapping
      db/                   pool, transactions, migrations/*.sql, migrate/seed/reset
      errors/               DomainError hierarchy
    tests/                  unit, rule, service, concurrency, API, demo-script tests
  web/
    src/                    components, pages (student / staff), lib (API client, hooks, state)
    tests/                  smoke + interaction tests against the real API
packages/shared/            zod request schemas + DTO types used by BOTH api and web
docs/                       class diagram, ERD, demo script, oral defense, ADRs, rubric checklist
```

Layering: a dependency may only point downward, `http -> services -> (rules, repositories) -> domain`.
Controllers hold no business rules; repositories hold no business rules; the domain imports no Express or mysql2.

## Business rules

All enforced server-side by the rule engine; the UI only displays the result. The engine runs **every** rule and
reports every violation at once.

| Rule | Code | Effect |
|---|---|---|
| Student status | `STUDENT_INACTIVE` | Block if the student is not active |
| Term match | `TERM_NOT_CURRENT` | Block unless the course is in the current term |
| Registration window | `REGISTRATION_NOT_OPEN`, `REGISTRATION_CLOSED` | Block outside the window, including per-class-standing priority openings |
| Hold | `HOLD_ACTIVE` | Block, once per active hold, with the reason |
| Duplicate | `ALREADY_ENROLLED`, `ALREADY_WAITLISTED`, `ALREADY_PASSED` | Block (a failed course may be retaken) |
| Capacity | `COURSE_FULL` | Warn: the student is waitlisted instead of blocked |
| Prerequisite | `PREREQUISITE_NOT_MET` | Block, naming what is missing and whether it is in progress or below the minimum grade |
| Corequisite | `COREQUISITE_MISSING` | Block unless taken the same term or submitted in the same cart |
| Schedule conflict | `SCHEDULE_CONFLICT` | Block (warn if only against a waitlisted class), naming the course and time |
| Unit limit | `UNIT_LIMIT_EXCEEDED` | Block unless an approved overload covers it |

## Testing

257 tests, all passing: 210 backend (12 files) and 47 frontend.

- **Domain and rules:** every rule has pass and fail cases; the `Enrollment` state machine including illegal
  transitions; `Course.conflictsWith` edge cases (back-to-back, overlap, different days); GPA under both grading
  strategies.
- **Services (real MySQL):** enroll, full to waitlist, duplicate, prerequisite, conflict, unit limit, hold, closed
  window, drop before and after the deadline, waitlist promotion (including skipping students who no longer
  qualify), batch cart, override, grading, authorization.
- **Concurrency (real MySQL):** capacity + 10 simultaneous enrolls give exactly `capacity` enrolled and 10
  waitlisted with consistent audit rows; a double-click creates one enrollment; the unit limit holds under a
  race; simultaneous drops promote exactly the earliest waitlisted students. These tests were checked by
  *removing the row locks* and confirming they fail loudly (19 students seated in a 15-seat course).
- **API (Supertest):** auth and cookie flags, rate limiting, role fencing, validation, catalog filters, SQL text
  in the search box, the demo flows, CSV formula neutralisation, the Rush Simulator.
- **Frontend (jsdom, real API and database, no mocks):** every page for every role, and the main flows.
- **Demo script:** `apps/api/tests/demo-script.test.ts` executes [docs/demo-script.md](docs/demo-script.md) step
  by step on a fresh seed.

## Known limitations

- **The interface has not been seen in a real browser.** It was built and tested in jsdom against the real API,
  type-checked, built for production, and its colours were checked numerically for WCAG AA contrast. Nobody has
  looked at the rendered pages, tried it on a phone, or used it with a screen reader. Expect to polish layout.
- **Rate limiting is per server instance.** On serverless each instance counts separately, so the login limit is
  a speed bump, not a global guarantee.
- **Seat counts refresh by polling every 15 seconds** (Vercel functions do not hold WebSocket connections).
- **Grades can be entered once.** There is no grade-correction workflow.
- **Academic-standing thresholds** (Dean's List, probation) are constructor parameters of the grading policy, not
  yet editable in the admin UI.
- **Cart overlaps between two cart items** are reported by the schedule suggester and on submit, not in each
  item's live check (which looks at the cart for corequisites only).
- **The audit log screen filters by action only** (the API also filters by student and course).
- **No password change, password reset, or email.** Notifications are in-app only.
- **The Rush Simulator is capped at 60 students** to keep a run short on a small connection pool. A 40-student run
  took about 0.4 seconds against a local database; a hosted database adds latency to every query, and I have not
  measured it on Vercel.
- **Time zones:** timestamps are UTC; class meeting times are wall-clock numbers with no zone, and `.ics` events
  use floating local time.
- **Everything was tested on MySQL 8.0** only.

# Contributing

## Branches and commits
- `main` is protected. Nothing is pushed to it directly.
- Branch names: `feat/<area>-<short-name>`, for example `feat/rules-corequisite`.
- Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`.
- **Commit your own work under your own name.** Do not commit on someone else's behalf.

## Pull requests
- One pull request per feature, small enough to review in one sitting.
- A reviewer from **another** member's area approves before merge.
- Before opening one: `pnpm typecheck && pnpm test && pnpm build` must pass.
- Say in the description *why*, and how you checked it works.

## Ground rules from the project brief
- **Never enforce business rules only in the UI.** The server decides; the UI displays.
- Never put secrets in the repository. `.env` is ignored; ship `.env.example` only.
- Keep code explainable: small files, clear names, comments that say *why*. Avoid abstractions the group cannot
  defend orally.
- Tests that touch the database run only against a database whose name ends in `_test`.

## Ownership (default group of four)

| Member | Owns |
|---|---|
| A: Domain and rules | `apps/api/src/domain/`, `rules/`, domain unit tests, class diagram |
| B: Data and backend | migrations, seed, repositories, services and transactions, concurrency tests, ERD |
| C: Student frontend | design system, shell, catalog, cart, schedule, enrollments, transcript |
| D: Admin, DevOps, docs | admin and instructor screens, analytics, Rush Simulator UI, Vercel setup, README, demo script |

Ownership means *you are the first person asked about it*, not that nobody else may touch it.

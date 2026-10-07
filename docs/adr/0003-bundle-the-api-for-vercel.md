# ADR 0003: Bundle the API into one file for Vercel

**Status:** accepted

## Context
The API imports `@enroll/shared`, a workspace package whose entry point is TypeScript *source*. Vercel's function
builder compiles the TypeScript it is pointed at, but a `.ts` file inside a linked package is not guaranteed to be
compiled, and a failure would only appear at deploy time. Vercel now also offers zero-configuration Express, which
bundles the app, but relies on its own entry-file detection.

## Decision
`pnpm build:vercel` bundles `src/app.ts` and everything it imports (Express, mysql2, the shared package) with
esbuild into `dist/app.cjs`, whose `module.exports` is the Express app. `api/index.js` is a three-line ESM stub
that re-exports it, and `vercel.json` rewrites every path to that function.

## Verification
The bundle was run from an empty directory with **no `node_modules`** against a real MySQL, and the entry stub
was loaded with plain Node: `/api/health`, login, and a catalog query all work.

## Consequences
- The deployable artifact does not depend on Vercel compiling our TypeScript or resolving workspace links.
- Source maps and stack traces point into the bundle.
- An actual Vercel deployment could not be run from the build environment, so the Vercel-specific settings
  (Root Directory, environment variables) are documented but unverified.

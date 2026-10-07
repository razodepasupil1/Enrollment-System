// Vercel function entry (this package is "type": "module", so ESM syntax here).
// `pnpm build:vercel` bundles the whole API, including the @enroll/shared workspace package,
// into dist/app.cjs, whose module.exports IS the Express app (a (req, res) handler).
// Bundling avoids relying on Vercel to compile TypeScript that lives inside a workspace package.
import app from "../dist/app.cjs";

export default app;

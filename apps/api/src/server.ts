import { loadConfig } from "./config.js";
import { closePool } from "./db/pool.js";
import app from "./app.js";

const { port, nodeEnv, demoMode } = loadConfig();
const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}/api (${nodeEnv}${demoMode ? ", DEMO_MODE" : ""})`);
});

// Close the pool cleanly on Ctrl+C so MySQL does not keep half-open connections.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => server.close(() => void closePool().then(() => process.exit(0))));
}

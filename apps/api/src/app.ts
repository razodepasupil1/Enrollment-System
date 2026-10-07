import { createApp } from "./http/app.js";

// A single shared instance; the connection pool inside is created lazily on first use.
const app = createApp();
export default app;
export { createApp };

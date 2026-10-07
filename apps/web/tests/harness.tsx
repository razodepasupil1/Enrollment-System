import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import request from "supertest";
import { MemoryRouter } from "react-router-dom";
import { createApp } from "../../api/src/http/app";
import { getPool } from "../../api/src/db/pool";
import { DEMO_PASSWORD, seedDatabase } from "../../api/src/db/seed";
import { App } from "../src/App";
import { makeQueryClient } from "../src/lib/queryClient";
import { TermProvider } from "../src/lib/state";

export { DEMO_PASSWORD };
export const api = createApp({ loginLimit: 10_000 });

/** Wipes and re-seeds the real test database, so every test starts from the same demo data. */
export const reseed = () => seedDatabase(getPool());

/**
 * Routes the app's fetch() straight into the real Express app (no network, no mocks). A supertest
 * agent keeps the httpOnly session cookie, exactly like a browser would.
 */
export function connectBrowser() {
  const agent = request.agent(api);
  localStorage.clear();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const method = (init?.method ?? "GET").toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
    let req = agent[method](url);
    if (init?.body) req = req.set("Content-Type", "application/json").send(String(init.body));
    const res = await req;
    return new Response(res.status === 204 ? null : res.text, { status: res.status, headers: { "Content-Type": String(res.headers["content-type"] ?? "application/json") } });
  }) as typeof fetch;
  return {
    agent,
    signIn: async (email: string) => { await agent.post("/api/auth/login").send({ email, password: DEMO_PASSWORD }).expect(200); },
  };
}

export function renderApp(path: string) {
  const qc = makeQueryClient();
  qc.setDefaultOptions({ queries: { retry: false, staleTime: 0, gcTime: 0 } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <TermProvider><App /></TermProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

import type { ApiErrorBody, ViolationDTO } from "@enroll/shared";

/** Every failed request becomes one of these, carrying the server's stable `code` (switch on it, not the message). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The full list of rule violations behind a rejected enrollment, when the server sent them. */
  get violations(): ViolationDTO[] {
    const v = (this.details as { violations?: ViolationDTO[] } | undefined)?.violations;
    return Array.isArray(v) ? v : [];
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

/**
 * The browser talks to ONE origin: in dev Vite proxies /api, in production Vercel rewrites it.
 * The session lives in an httpOnly cookie, so no token is ever read or stored by this code.
 */
export async function api<T>(path: string, { method = "GET", body }: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Cannot reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, data?.error.code ?? "UNKNOWN", data?.error.message ?? `Request failed (${res.status}).`, data?.error.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong.");

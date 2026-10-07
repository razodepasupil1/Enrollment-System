import type { NextFunction, Request, Response } from "express";
import type { Role, UserDTO } from "@enroll/shared";
import { DomainError, ForbiddenError, UnauthorizedError } from "../errors/index.js";
import { SESSION_COOKIE, type AuthService } from "../services/AuthService.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by authenticate() from the signed session cookie; never from client-supplied ids. */
      user?: UserDTO;
    }
  }
}

/** Reads the httpOnly cookie, verifies it, and attaches the (freshly loaded) user. Anonymous requests pass through. */
export const authenticate = (auth: AuthService) => async (req: Request, _res: Response, next: NextFunction) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  const user = await auth.authenticate(token);
  if (user) req.user = user;
  next();
};

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new UnauthorizedError();
  next();
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw new UnauthorizedError();
  if (!roles.includes(req.user.role)) throw new ForbiddenError();
  next();
};

/** A signed-in student, with the student id taken from the session (never from the request). */
export function studentId(req: Request): number {
  const id = req.user?.studentId;
  if (!id) throw new ForbiddenError("This page is for students.");
  return id;
}

/** API responses are private and change often; never let a browser or proxy cache them. */
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  next();
}

const MYSQL_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  ER_DUP_ENTRY: { status: 409, code: "DUPLICATE", message: "That value is already in use." },
  ER_NO_REFERENCED_ROW_2: { status: 400, code: "REFERENCE_NOT_FOUND", message: "A referenced record does not exist." },
  ER_ROW_IS_REFERENCED_2: { status: 409, code: "IN_USE", message: "This record is in use and cannot be removed." },
  ER_CHECK_CONSTRAINT_VIOLATED: { status: 400, code: "CONSTRAINT_VIOLATED", message: "A value is outside its allowed range." },
  ER_LOCK_DEADLOCK: { status: 503, code: "BUSY", message: "The system is very busy right now. Please try again." },
  ER_LOCK_WAIT_TIMEOUT: { status: 503, code: "BUSY", message: "The system is very busy right now. Please try again." },
};

/** Maps every failure to { error: { code, message, details? } }. Unknown errors never leak their message. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const e = err as { name?: string; code?: string; type?: string; issues?: unknown; status?: number };

  if (err instanceof DomainError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    return;
  }
  if (e.name === "ZodError") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Some fields are invalid.", details: { issues: e.issues } } });
    return;
  }
  if (e.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "The request body is not valid JSON." } });
    return;
  }
  if (e.type === "entity.too.large") {
    res.status(413).json({ error: { code: "TOO_LARGE", message: "The request body is too large." } });
    return;
  }
  const mapped = e.code ? MYSQL_ERRORS[e.code] : undefined;
  if (mapped) {
    res.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message } });
    return;
  }
  if (process.env.NODE_ENV !== "test") console.error(`[${req.method} ${req.path}]`, err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on our side." } });
}

import type { Violation } from "../domain/types.js";

/**
 * Base class for every expected failure. The HTTP error middleware maps these
 * to a status + stable `code` so the UI can switch on `code`, never on message text.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 422,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown when the rule engine blocks an action. Carries EVERY violation, not just the first. */
export class RuleViolationError extends DomainError {
  constructor(
    code: string,
    status: number,
    readonly violations: readonly Violation[],
  ) {
    const blocking = violations.filter((v) => v.severity === "block");
    const primary = blocking[0] ?? violations[0];
    const extra = blocking.length - 1;
    const message =
      (primary?.message ?? "Enrollment rejected.") +
      (extra > 0 ? ` (and ${extra} more issue${extra === 1 ? "" : "s"})` : "");
    super(code, message, status, { violations });
  }
}

export class AlreadyEnrolledError extends RuleViolationError {
  constructor(code: string, violations: readonly Violation[]) { super(code, 409, violations); }
}
export class CourseFullError extends RuleViolationError {
  constructor(violations: readonly Violation[]) { super("COURSE_FULL", 409, violations); }
}
export class PrerequisiteNotMetError extends RuleViolationError {
  constructor(violations: readonly Violation[]) { super("PREREQUISITE_NOT_MET", 422, violations); }
}
export class CorequisiteMissingError extends RuleViolationError {
  constructor(violations: readonly Violation[]) { super("COREQUISITE_MISSING", 422, violations); }
}
export class ScheduleConflictError extends RuleViolationError {
  constructor(violations: readonly Violation[]) { super("SCHEDULE_CONFLICT", 409, violations); }
}
export class UnitLimitExceededError extends RuleViolationError {
  constructor(violations: readonly Violation[]) { super("UNIT_LIMIT_EXCEEDED", 422, violations); }
}
export class HoldActiveError extends RuleViolationError {
  constructor(violations: readonly Violation[]) { super("HOLD_ACTIVE", 422, violations); }
}
export class RegistrationWindowError extends RuleViolationError {
  constructor(code: string, violations: readonly Violation[]) { super(code, 422, violations); }
}
/** Fallback for blockers without a dedicated subclass (inactive student, term not current). */
export class EnrollmentRejectedError extends RuleViolationError {
  constructor(code: string, violations: readonly Violation[]) { super(code, 422, violations); }
}

/** Picks the most specific error class for the first blocking violation. */
export function errorFromViolations(violations: readonly Violation[]): RuleViolationError {
  const primary = violations.find((v) => v.severity === "block") ?? violations[0];
  const code = primary?.code ?? "ENROLLMENT_REJECTED";
  switch (code) {
    case "ALREADY_ENROLLED":
    case "ALREADY_WAITLISTED":
    case "ALREADY_PASSED":
      return new AlreadyEnrolledError(code, violations);
    case "COURSE_FULL": return new CourseFullError(violations);
    case "PREREQUISITE_NOT_MET": return new PrerequisiteNotMetError(violations);
    case "COREQUISITE_MISSING": return new CorequisiteMissingError(violations);
    case "SCHEDULE_CONFLICT": return new ScheduleConflictError(violations);
    case "UNIT_LIMIT_EXCEEDED": return new UnitLimitExceededError(violations);
    case "HOLD_ACTIVE": return new HoldActiveError(violations);
    case "REGISTRATION_NOT_OPEN":
    case "REGISTRATION_CLOSED":
      return new RegistrationWindowError(code, violations);
    default: return new EnrollmentRejectedError(code, violations);
  }
}

export class IllegalTransitionError extends DomainError {
  constructor(from: string, action: string) {
    super("ILLEGAL_TRANSITION", `Cannot ${action} an enrollment that is ${from}.`, 409);
  }
}
export class DeadlinePassedError extends DomainError {
  constructor(message: string) { super("DEADLINE_PASSED", message, 422); }
}
export class InvalidGradeError extends DomainError {
  constructor(message: string) { super("INVALID_GRADE", message, 422); }
}
export class NotFoundError extends DomainError {
  constructor(what: string) { super("NOT_FOUND", `${what} not found.`, 404); }
}
export class ForbiddenError extends DomainError {
  constructor(message = "You do not have access to this resource.") { super("FORBIDDEN", message, 403); }
}
export class UnauthorizedError extends DomainError {
  constructor(message = "Please sign in.") { super("UNAUTHORIZED", message, 401); }
}
export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) { super("VALIDATION_ERROR", message, 400, details); }
}
/** The request is well-formed but conflicts with the current state of the data (HTTP 409). */
export class ConflictError extends DomainError {
  constructor(message: string) { super("CONFLICT", message, 409); }
}
/** A domain object was constructed with impossible data (e.g. negative capacity). */
export class InvariantError extends DomainError {
  constructor(message: string) { super("INVARIANT_VIOLATION", message, 400); }
}

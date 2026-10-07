import type { Violation } from "../domain/types.js";
import { CapacityRule, COURSE_FULL } from "./CapacityRule.js";
import { CorequisiteRule } from "./CorequisiteRule.js";
import { DuplicateEnrollmentRule } from "./DuplicateEnrollmentRule.js";
import type { EnrollmentContext, EnrollmentRule } from "./EnrollmentRule.js";
import { HoldRule } from "./HoldRule.js";
import { PrerequisiteRule } from "./PrerequisiteRule.js";
import { RegistrationWindowRule } from "./RegistrationWindowRule.js";
import { ScheduleConflictRule } from "./ScheduleConflictRule.js";
import { StudentStatusRule } from "./StudentStatusRule.js";
import { TermMatchRule } from "./TermMatchRule.js";
import { UnitLimitRule } from "./UnitLimitRule.js";

export type EnrollmentOutcome = "ENROLL" | "WAITLIST" | "BLOCKED";

export interface Evaluation {
  readonly outcome: EnrollmentOutcome;
  /** Every finding from every rule (blocks and warnings), in rule order. */
  readonly violations: readonly Violation[];
}

/** Order only affects message order; it never changes the outcome. */
export function defaultRules(): EnrollmentRule[] {
  return [
    new StudentStatusRule(),
    new TermMatchRule(),
    new RegistrationWindowRule(),
    new HoldRule(),
    new DuplicateEnrollmentRule(),
    new CapacityRule(),
    new PrerequisiteRule(),
    new CorequisiteRule(),
    new ScheduleConflictRule(),
    new UnitLimitRule(),
  ];
}

/**
 * Runs EVERY rule (no short-circuit) so a student sees all their problems at once
 * instead of fixing one error only to hit the next. Blocks beat the waitlist:
 * a full course with a missing prerequisite is BLOCKED, not waitlisted.
 */
export class RuleEngine {
  constructor(private readonly rules: readonly EnrollmentRule[] = defaultRules()) {}

  evaluate(ctx: EnrollmentContext): Evaluation {
    const violations = this.rules.flatMap((r) => r.check(ctx));
    if (violations.some((v) => v.severity === "block")) return { outcome: "BLOCKED", violations };
    if (violations.some((v) => v.code === COURSE_FULL)) return { outcome: "WAITLIST", violations };
    return { outcome: "ENROLL", violations };
  }
}

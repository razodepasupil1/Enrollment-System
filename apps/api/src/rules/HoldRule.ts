import { block, type EnrollmentContext, type EnrollmentRule } from "./EnrollmentRule.js";

/** One violation per active hold so the student sees each reason to resolve. */
export class HoldRule implements EnrollmentRule {
  readonly code = "HOLD_ACTIVE";
  check({ holds }: EnrollmentContext) {
    return holds
      .filter((h) => h.clearedAt === null)
      .map((h) => block(this.code, `Enrollment is blocked by a ${h.type.toLowerCase()} hold: ${h.reason}`));
  }
}

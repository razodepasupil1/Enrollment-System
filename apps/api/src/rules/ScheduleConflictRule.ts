import { block, warn, type EnrollmentContext, type EnrollmentRule } from "./EnrollmentRule.js";

/**
 * A clash with a class you are ENROLLED in blocks. A clash with a class you are only
 * WAITLISTED for is a warning: you might never get that seat, so it should not stop you
 * (if both come through, promotion re-runs the rules and handles it).
 */
export class ScheduleConflictRule implements EnrollmentRule {
  readonly code = "SCHEDULE_CONFLICT";
  check({ course, activeEnrollments }: EnrollmentContext) {
    const violations = [];
    for (const { enrollment, course: other } of activeEnrollments) {
      if (other.id === course.id || !course.conflictsWith(other)) continue;
      if (enrollment.status === "ENROLLED") {
        violations.push(block(this.code, `Schedule conflict with ${other.code} (${other.meetingSummary()})`));
      } else {
        violations.push(
          warn(this.code, `Schedule overlaps with ${other.code}, which you are waitlisted for (${other.meetingSummary()})`),
        );
      }
    }
    return violations;
  }
}

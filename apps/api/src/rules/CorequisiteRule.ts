import { block, type EnrollmentContext, type EnrollmentRule } from "./EnrollmentRule.js";

/**
 * A corequisite must be taken the same term, so it is satisfied by any of:
 *   - already ENROLLED/WAITLISTED in it this term,
 *   - already passed it,
 *   - being enrolled in it in the same submission (pendingCourseCodes).
 * The last case is what makes mutual pairs (lecture <-> lab) possible at all: neither can be
 * first, so they must be submitted together.
 */
export class CorequisiteRule implements EnrollmentRule {
  readonly code = "COREQUISITE_MISSING";
  check({ student, course, activeEnrollments, gradingPolicy, pendingCourseCodes }: EnrollmentContext) {
    return course.corequisites
      .filter(
        (co) =>
          !pendingCourseCodes.includes(co) &&
          !activeEnrollments.some((e) => e.course.code === co) &&
          !student.hasCompleted(co, null, gradingPolicy),
      )
      .map((co) =>
        block(this.code, `${course.code} must be taken together with ${co}. Add both to your cart and enroll together.`),
      );
  }
}

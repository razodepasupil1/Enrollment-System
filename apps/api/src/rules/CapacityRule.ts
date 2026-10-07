import { warn, type EnrollmentContext, type EnrollmentRule } from "./EnrollmentRule.js";

export const COURSE_FULL = "COURSE_FULL";

/**
 * A full course is NOT an error: the student can still join the waitlist. So this rule
 * emits a "warn", and the engine turns that into a WAITLIST outcome rather than a block.
 */
export class CapacityRule implements EnrollmentRule {
  readonly code = COURSE_FULL;
  check({ course, enrolledCount }: EnrollmentContext) {
    if (!course.isFull(enrolledCount)) return [];
    return [
      warn(
        COURSE_FULL,
        `${course.code} is full (${enrolledCount}/${course.capacity}). You will be added to the waitlist.`,
      ),
    ];
  }
}

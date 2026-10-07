import { block, type EnrollmentContext, type EnrollmentRule } from "./EnrollmentRule.js";

export class DuplicateEnrollmentRule implements EnrollmentRule {
  readonly code = "DUPLICATE_ENROLLMENT";
  check({ student, course, activeEnrollments, gradingPolicy }: EnrollmentContext) {
    const existing = activeEnrollments.find((e) => e.enrollment.courseId === course.id);
    if (existing?.enrollment.status === "ENROLLED") {
      return [block("ALREADY_ENROLLED", `You are already enrolled in ${course.code}.`)];
    }
    if (existing?.enrollment.status === "WAITLISTED") {
      return [block("ALREADY_WAITLISTED", `You are already on the waitlist for ${course.code}.`)];
    }
    // A failed course may be retaken; a passed one may not.
    if (student.hasCompleted(course.code, null, gradingPolicy)) {
      return [block("ALREADY_PASSED", `You have already passed ${course.code}.`)];
    }
    return [];
  }
}

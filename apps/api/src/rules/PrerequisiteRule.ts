import { block, type EnrollmentContext, type EnrollmentRule } from "./EnrollmentRule.js";

export class PrerequisiteRule implements EnrollmentRule {
  readonly code = "PREREQUISITE_NOT_MET";
  check({ student, course, activeEnrollments, gradingPolicy }: EnrollmentContext) {
    const violations = [];
    for (const pre of course.prerequisites) {
      if (student.hasCompleted(pre.code, pre.minGrade, gradingPolicy)) continue;

      // Say WHY it is not met; "in progress" and "grade too low" need different action from the student.
      const inProgress = activeEnrollments.some(
        (e) => e.course.code === pre.code && e.enrollment.status === "ENROLLED",
      );
      let reason = "not completed";
      if (inProgress) reason = "in progress";
      else if (student.hasAttempted(pre.code)) {
        reason = pre.minGrade === null
          ? "not passed"
          : `minimum grade of ${gradingPolicy.display(pre.minGrade)} not met`;
      }
      violations.push(block(this.code, `Cannot enroll in ${course.code}: requires ${pre.code} (${reason})`));
    }
    return violations;
  }
}

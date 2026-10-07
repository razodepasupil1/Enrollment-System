import { block, type EnrollmentContext, type EnrollmentRule } from "./EnrollmentRule.js";

export class StudentStatusRule implements EnrollmentRule {
  readonly code = "STUDENT_INACTIVE";
  check({ student }: EnrollmentContext) {
    return student.isActive()
      ? []
      : [block(this.code, `Your student record is ${student.status.toLowerCase()}; contact the registrar.`)];
  }
}

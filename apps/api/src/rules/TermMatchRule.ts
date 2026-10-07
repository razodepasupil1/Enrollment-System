import { block, type EnrollmentContext, type EnrollmentRule } from "./EnrollmentRule.js";

/** Students may only enroll in the CURRENT term; past and future catalogs are read-only. */
export class TermMatchRule implements EnrollmentRule {
  readonly code = "TERM_NOT_CURRENT";
  check({ course, term }: EnrollmentContext) {
    return term.isCurrent
      ? []
      : [block(this.code, `${course.code} is offered in ${term.name}, which is not the current term.`)];
  }
}

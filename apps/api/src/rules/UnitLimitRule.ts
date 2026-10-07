import { block, type EnrollmentContext, type EnrollmentRule } from "./EnrollmentRule.js";

/** Normal limit is student.maxUnits; an APPROVED overload request raises it for this term only. */
export class UnitLimitRule implements EnrollmentRule {
  readonly code = "UNIT_LIMIT_EXCEEDED";
  check({ student, course, activeEnrollments, approvedOverloadUnits }: EnrollmentContext) {
    const current = student.totalUnits(activeEnrollments);
    const after = current + course.units;
    const allowed = student.maxUnits + approvedOverloadUnits;
    if (after <= allowed) return [];
    return [
      block(
        this.code,
        `Enrolling in ${course.code} (${course.units} units) would bring you to ${after} units; your limit is ${allowed}. Request an overload to exceed it.`,
      ),
    ];
  }
}

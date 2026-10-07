import type { Course } from "../domain/Course.js";
import type { EnrollmentWithCourse } from "../domain/Enrollment.js";
import type { GradingPolicy } from "../domain/GradingPolicy.js";
import type { Student } from "../domain/Student.js";
import type { Term } from "../domain/Term.js";
import type { Hold, Violation } from "../domain/types.js";

/**
 * Everything a rule may look at, pre-loaded by the service. Rules are PURE: no database
 * calls, no clock reads (`now` is passed in). That makes them trivially unit-testable and
 * lets the same rules power both the real enroll and the dry-run /validate endpoint.
 */
export interface EnrollmentContext {
  readonly student: Student;
  readonly course: Course;
  /** The term the course belongs to. */
  readonly term: Term;
  readonly now: Date;
  /** The student's ENROLLED + WAITLISTED enrollments in this course's term. */
  readonly activeEnrollments: readonly EnrollmentWithCourse[];
  /** ENROLLED head-count for this course, counted inside the locked transaction. */
  readonly enrolledCount: number;
  readonly holds: readonly Hold[];
  /** Extra units granted by approved overload requests for this term. */
  readonly approvedOverloadUnits: number;
  readonly gradingPolicy: GradingPolicy;
  /**
   * Codes of other courses being enrolled in the SAME submission (the cart). Corequisites are taken
   * together, so a lab and its lecture must be able to satisfy each other when submitted as a pair.
   */
  readonly pendingCourseCodes: readonly string[];
}

/**
 * Strategy interface (abstraction + polymorphism): the engine treats every rule the same
 * way. Adding a business rule = adding a class that implements this; nothing else changes
 * (open/closed principle).
 */
export interface EnrollmentRule {
  readonly code: string;
  check(ctx: EnrollmentContext): Violation[];
}

export const block = (code: string, message: string): Violation => ({ code, message, severity: "block" });
export const warn = (code: string, message: string): Violation => ({ code, message, severity: "warn" });

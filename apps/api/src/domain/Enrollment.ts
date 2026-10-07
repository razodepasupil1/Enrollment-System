import { IllegalTransitionError, InvalidGradeError } from "../errors/index.js";
import type { Course } from "./Course.js";
import type { GradingPolicy } from "./GradingPolicy.js";
import type { EnrollmentStatus } from "./types.js";

/** Plain data shape the repository reads and writes. Keeps SQL concerns out of the class. */
export interface EnrollmentSnapshot {
  id: number | null;
  studentId: number;
  courseId: number;
  status: EnrollmentStatus;
  grade: number | null;
  enrolledAt: Date | null;
  waitlistedAt: Date | null;
  endedAt: Date | null;
}

/** An enrollment together with the course it points at (rules and unit counting need both). */
export interface EnrollmentWithCourse {
  readonly enrollment: Enrollment;
  readonly course: Course;
}

/**
 * The ASSOCIATION CLASS: exactly one student + exactly one course. A student takes many
 * courses and a course holds many students, so the many-to-many lives in this class.
 *
 * All legal status changes are methods that throw on illegal moves; nothing else may
 * mutate `status`. Legal moves:
 *   new -> ENROLLED | WAITLISTED
 *   ENROLLED   -> DROPPED (before deadline) | WITHDRAWN (after) | COMPLETED | FAILED
 *   WAITLISTED -> ENROLLED (promote) | DROPPED (leave)
 */
export class Enrollment {
  #id: number | null;
  readonly #studentId: number;
  readonly #courseId: number;
  #status: EnrollmentStatus;
  #grade: number | null;
  #enrolledAt: Date | null;
  #waitlistedAt: Date | null;
  #endedAt: Date | null;

  private constructor(s: EnrollmentSnapshot) {
    this.#id = s.id;
    this.#studentId = s.studentId;
    this.#courseId = s.courseId;
    this.#status = s.status;
    this.#grade = s.grade;
    this.#enrolledAt = s.enrolledAt;
    this.#waitlistedAt = s.waitlistedAt;
    this.#endedAt = s.endedAt;
  }

  /** Brand-new enrollment: takes the seat if there is one, otherwise joins the waitlist queue. */
  static create(args: { studentId: number; courseId: number; seatAvailable: boolean; now: Date }): Enrollment {
    const { studentId, courseId, seatAvailable, now } = args;
    return new Enrollment({
      id: null,
      studentId,
      courseId,
      status: seatAvailable ? "ENROLLED" : "WAITLISTED",
      grade: null,
      enrolledAt: seatAvailable ? now : null,
      waitlistedAt: seatAvailable ? null : now,
      endedAt: null,
    });
  }

  /** Rebuild from a database row; no validation because the row was valid when it was written. */
  static restore(s: EnrollmentSnapshot): Enrollment {
    return new Enrollment(s);
  }

  get id(): number | null { return this.#id; }
  get studentId(): number { return this.#studentId; }
  get courseId(): number { return this.#courseId; }
  get status(): EnrollmentStatus { return this.#status; }
  get grade(): number | null { return this.#grade; }
  get enrolledAt(): Date | null { return this.#enrolledAt; }
  get waitlistedAt(): Date | null { return this.#waitlistedAt; }
  get endedAt(): Date | null { return this.#endedAt; }
  get isActive(): boolean { return this.#status === "ENROLLED" || this.#status === "WAITLISTED"; }

  /** Called by the repository after INSERT so the object learns its generated id. */
  assignId(id: number): void {
    if (this.#id !== null) throw new IllegalTransitionError(this.#status, "re-assign id of");
    this.#id = id;
  }

  /**
   * Dropping up to and including the deadline is a clean DROPPED. After the deadline the
   * seat is still released but the transcript shows a "W", so the status is WITHDRAWN.
   */
  drop(now: Date, dropDeadline: Date): "DROPPED" | "WITHDRAWN" {
    this.#require("ENROLLED", "drop");
    const result = now.getTime() <= dropDeadline.getTime() ? "DROPPED" : "WITHDRAWN";
    this.#status = result;
    this.#endedAt = now;
    return result;
  }

  leaveWaitlist(now: Date): void {
    this.#require("WAITLISTED", "leave the waitlist for");
    this.#status = "DROPPED";
    this.#endedAt = now;
  }

  /** waitlistedAt is kept on purpose: the audit trail should show how long they waited. */
  promote(now: Date): void {
    this.#require("WAITLISTED", "promote");
    this.#status = "ENROLLED";
    this.#enrolledAt = now;
  }

  complete(grade: number, policy: GradingPolicy, now: Date): "COMPLETED" | "FAILED" {
    this.#require("ENROLLED", "grade");
    if (!policy.isValid(grade)) {
      throw new InvalidGradeError(`${grade} is not a valid grade on the ${policy.name}.`);
    }
    const result = policy.isPass(grade) ? "COMPLETED" : "FAILED";
    this.#grade = grade;
    this.#status = result;
    this.#endedAt = now;
    return result;
  }

  toSnapshot(): EnrollmentSnapshot {
    return {
      id: this.#id,
      studentId: this.#studentId,
      courseId: this.#courseId,
      status: this.#status,
      grade: this.#grade,
      enrolledAt: this.#enrolledAt,
      waitlistedAt: this.#waitlistedAt,
      endedAt: this.#endedAt,
    };
  }

  #require(expected: EnrollmentStatus, action: string): void {
    if (this.#status !== expected) throw new IllegalTransitionError(this.#status, action);
  }
}

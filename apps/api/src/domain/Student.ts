import { InvariantError } from "../errors/index.js";
import type { EnrollmentWithCourse } from "./Enrollment.js";
import { FourPointPolicy, type GradingPolicy } from "./GradingPolicy.js";
import type { ClassStanding, GradedCourse, StudentStatus } from "./types.js";

export interface StudentProps {
  id: number;
  studentNumber: string;
  fullName: string;
  email: string;
  program: string;
  yearLevel: number;
  /** Normal unit load ceiling per term; exceeding it needs an approved overload. */
  maxUnits: number;
  status?: StudentStatus;
  /** Past graded courses (passed AND failed). Loaded by the service for rule checks and GPA. */
  transcript?: readonly GradedCourse[];
}

const DEFAULT_POLICY = new FourPointPolicy();

export class Student {
  readonly #id: number;
  readonly #studentNumber: string;
  readonly #fullName: string;
  readonly #email: string;
  readonly #program: string;
  readonly #yearLevel: number;
  readonly #maxUnits: number;
  readonly #status: StudentStatus;
  readonly #transcript: readonly GradedCourse[];

  constructor(p: StudentProps) {
    if (!p.fullName.trim()) throw new InvariantError("Student name is required.");
    if (!p.email.includes("@")) throw new InvariantError("Student email must be a valid address.");
    if (!Number.isInteger(p.yearLevel) || p.yearLevel < 1) {
      throw new InvariantError("Year level must be a whole number, 1 or more.");
    }
    if (!(p.maxUnits > 0)) throw new InvariantError("Max units must be greater than 0.");
    this.#id = p.id;
    this.#studentNumber = p.studentNumber;
    this.#fullName = p.fullName.trim();
    this.#email = p.email.trim().toLowerCase();
    this.#program = p.program;
    this.#yearLevel = p.yearLevel;
    this.#maxUnits = p.maxUnits;
    this.#status = p.status ?? "ACTIVE";
    this.#transcript = Object.freeze([...(p.transcript ?? [])]);
  }

  get id(): number { return this.#id; }
  get studentNumber(): string { return this.#studentNumber; }
  get fullName(): string { return this.#fullName; }
  get email(): string { return this.#email; }
  get program(): string { return this.#program; }
  get yearLevel(): number { return this.#yearLevel; }
  get maxUnits(): number { return this.#maxUnits; }
  get status(): StudentStatus { return this.#status; }
  get transcript(): readonly GradedCourse[] { return this.#transcript; }

  /**
   * Units currently being carried: ENROLLED only. Waitlisted classes do not count because
   * they hold no seat; the unit limit is re-checked when a waitlist promotion happens.
   */
  totalUnits(enrollments: readonly EnrollmentWithCourse[]): number {
    return enrollments
      .filter((e) => e.enrollment.studentId === this.#id && e.enrollment.status === "ENROLLED")
      .reduce((sum, e) => sum + e.course.units, 0);
  }

  remainingUnits(enrollments: readonly EnrollmentWithCourse[], approvedOverloadUnits = 0): number {
    return this.#maxUnits + approvedOverloadUnits - this.totalUnits(enrollments);
  }

  /** True if the student has any attempt of this course on the transcript, pass or fail. */
  hasAttempted(courseCode: string): boolean {
    const code = courseCode.toUpperCase();
    return this.#transcript.some((t) => t.code === code);
  }

  /** Passed the course (and, when given, with at least `minGrade`). Direction of "better" comes from the policy. */
  hasCompleted(courseCode: string, minGrade: number | null = null, policy: GradingPolicy = DEFAULT_POLICY): boolean {
    const code = courseCode.toUpperCase();
    return this.#transcript.some(
      (t) =>
        t.code === code &&
        policy.isPass(t.grade) &&
        (minGrade === null || policy.meetsMinimum(t.grade, minGrade)),
    );
  }

  isActive(): boolean {
    return this.#status === "ACTIVE";
  }

  classStanding(): ClassStanding {
    if (this.#yearLevel <= 1) return "FRESHMAN";
    if (this.#yearLevel === 2) return "SOPHOMORE";
    if (this.#yearLevel === 3) return "JUNIOR";
    return "SENIOR";
  }

  /** Cumulative GPA. A retaken course counts once, using its most recent term (later termId wins). */
  gpa(policy: GradingPolicy = DEFAULT_POLICY): number | null {
    const latest = new Map<string, GradedCourse>();
    for (const t of this.#transcript) {
      const prev = latest.get(t.code);
      if (!prev || t.termId >= prev.termId) latest.set(t.code, t);
    }
    return policy.average([...latest.values()].map((t) => ({ grade: t.grade, units: t.units })));
  }
}

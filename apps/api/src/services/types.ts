import type { EnrollmentStatus, Violation } from "../domain/types.js";

export type Role = "student" | "instructor" | "admin";

/** Who is performing an action. Built by the auth middleware from the verified JWT, never from client input. */
export interface Actor {
  userId: number;
  role: Role;
  studentId?: number;
  instructorId?: number;
}

export interface EnrollResult {
  enrollmentId: number;
  courseId: number;
  status: Extract<EnrollmentStatus, "ENROLLED" | "WAITLISTED">;
  /** 1-based; only set when WAITLISTED. */
  waitlistPosition: number | null;
  /** Non-blocking findings (e.g. "course is full, you were waitlisted"). */
  warnings: readonly Violation[];
}

export interface PromotionResult {
  enrollmentId: number;
  studentId: number;
  courseId: number;
  outcome: "PROMOTED" | "SKIPPED";
  /** Why a skipped student no longer qualified. */
  reasons: readonly Violation[];
}

export interface DropResult {
  enrollmentId: number;
  courseId: number;
  status: Extract<EnrollmentStatus, "DROPPED" | "WITHDRAWN">;
  promotions: readonly PromotionResult[];
}

export interface ValidationResult {
  outcome: "ENROLL" | "WAITLIST" | "BLOCKED";
  violations: readonly Violation[];
  /** Position the student would get if they joined now. */
  wouldBeWaitlistPosition: number | null;
}

export interface BatchItemResult {
  courseId: number;
  code: string | null;
  status: "ENROLLED" | "WAITLISTED" | "REJECTED";
  enrollmentId: number | null;
  waitlistPosition: number | null;
  error: { code: string; message: string; violations: readonly Violation[] } | null;
}

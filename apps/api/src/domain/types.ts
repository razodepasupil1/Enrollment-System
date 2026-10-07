// Shared domain vocabulary. Pure TypeScript: no Express, no mysql2 (layering rule).

export const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type Day = (typeof DAYS)[number];

/** One weekly meeting. Times are minutes since midnight so overlap checks are plain integer math. */
export interface Meeting {
  readonly day: Day;
  readonly startMin: number;
  readonly endMin: number;
}

export type EnrollmentStatus =
  | "ENROLLED"
  | "WAITLISTED"
  | "DROPPED"
  | "WITHDRAWN"
  | "COMPLETED"
  | "FAILED";

/** "Active" = still occupies (or is queued for) a seat. Matches the generated active_key column in SQL. */
export const ACTIVE_STATUSES: readonly EnrollmentStatus[] = ["ENROLLED", "WAITLISTED"];

export type ClassStanding = "FRESHMAN" | "SOPHOMORE" | "JUNIOR" | "SENIOR";
export type StudentStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED" | "GRADUATED";

export type Severity = "block" | "warn";

/** One finding from one rule. The engine collects ALL of them so the UI can show every problem at once. */
export interface Violation {
  readonly code: string;
  readonly message: string;
  readonly severity: Severity;
}

export interface PrerequisiteRef {
  readonly code: string;
  /** Minimum grade in the active GradingPolicy's scale; null = any passing grade. */
  readonly minGrade: number | null;
}

/** A finished (passed or failed) course on a student's transcript. */
export interface GradedCourse {
  readonly code: string;
  readonly title: string;
  readonly units: number;
  readonly grade: number;
  readonly termId: number;
}

export type HoldType = "FINANCIAL" | "ADVISING" | "ACADEMIC";

export interface Hold {
  readonly id: number;
  readonly studentId: number;
  readonly type: HoldType;
  readonly reason: string;
  readonly placedAt: Date;
  /** null = still active. */
  readonly clearedAt: Date | null;
}

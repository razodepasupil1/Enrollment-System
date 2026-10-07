// DTOs: the JSON shapes the API returns. Dates are ISO strings. Imported by BOTH api and web,
// so a field renamed on one side fails the typecheck on the other.

export type Role = "student" | "instructor" | "admin";
export type Day = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export type EnrollmentStatus = "ENROLLED" | "WAITLISTED" | "DROPPED" | "WITHDRAWN" | "COMPLETED" | "FAILED";
export type ClassStanding = "FRESHMAN" | "SOPHOMORE" | "JUNIOR" | "SENIOR";
export type AcademicStanding = "DEANS_LIST" | "GOOD_STANDING" | "PROBATION" | "NO_RECORD";
export type HoldType = "FINANCIAL" | "ADVISING" | "ACADEMIC";
export type Availability = "OPEN" | "ALMOST_FULL" | "FULL";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface PageDTO<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserDTO {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  studentId: number | null;
  instructorId: number | null;
}

export interface DemoAccountDTO {
  email: string;
  fullName: string;
  role: Role;
  note: string;
}

export interface MeetingDTO {
  day: Day;
  startMin: number;
  endMin: number;
}

export interface TermDTO {
  id: number;
  name: string;
  isCurrent: boolean;
  registrationOpensAt: string;
  registrationClosesAt: string;
  dropDeadline: string;
  endsAt: string;
  registrationOpen: boolean;
}

export interface ViolationDTO {
  code: string;
  message: string;
  severity: "block" | "warn";
}

export interface ValidationDTO {
  outcome: "ENROLL" | "WAITLIST" | "BLOCKED";
  violations: ViolationDTO[];
  wouldBeWaitlistPosition: number | null;
}

export interface CourseDTO {
  id: number;
  code: string;
  title: string;
  description: string;
  units: number;
  capacity: number;
  termId: number;
  termName: string;
  department: string;
  departmentName: string;
  instructorId: number | null;
  instructorName: string | null;
  room: string | null;
  meetings: MeetingDTO[];
  meetingSummary: string;
  prerequisites: Array<{ code: string; minGrade: number | null }>;
  corequisites: string[];
  dropDeadline: string | null;
  enrolledCount: number;
  waitlistedCount: number;
  availableSeats: number;
  fillRatio: number;
  availability: Availability;
}

export interface CatalogItemDTO extends CourseDTO {
  /** The signed-in student's own active enrollment in this course, if any. */
  mine: { enrollmentId: number; status: "ENROLLED" | "WAITLISTED"; waitlistPosition: number | null } | null;
}

export interface EnrollResultDTO {
  enrollmentId: number;
  courseId: number;
  status: "ENROLLED" | "WAITLISTED";
  waitlistPosition: number | null;
  warnings: ViolationDTO[];
}

export interface PromotionDTO {
  enrollmentId: number;
  studentId: number;
  courseId: number;
  outcome: "PROMOTED" | "SKIPPED";
  reasons: ViolationDTO[];
}

export interface DropResultDTO {
  enrollmentId: number;
  courseId: number;
  status: "DROPPED" | "WITHDRAWN";
  promotions: PromotionDTO[];
}

export interface BatchItemResultDTO {
  courseId: number;
  code: string | null;
  status: "ENROLLED" | "WAITLISTED" | "REJECTED";
  enrollmentId: number | null;
  waitlistPosition: number | null;
  error: { code: string; message: string; violations: ViolationDTO[] } | null;
}

export interface MyEnrollmentDTO {
  id: number;
  status: EnrollmentStatus;
  course: CourseDTO;
  waitlistPosition: number | null;
  enrolledAt: string | null;
  waitlistedAt: string | null;
  endedAt: string | null;
  grade: number | null;
  gradeDisplay: string | null;
  /** What dropping RIGHT NOW would produce, so the confirm dialog can say so. */
  dropPreview: "DROPPED" | "WITHDRAWN" | null;
}

export interface ScheduleBlockDTO {
  enrollmentId: number;
  courseId: number;
  code: string;
  title: string;
  status: "ENROLLED" | "WAITLISTED";
  day: Day;
  startMin: number;
  endMin: number;
  room: string | null;
  colorIndex: number;
}

export interface ScheduleDTO {
  termId: number;
  termName: string;
  blocks: ScheduleBlockDTO[];
  conflicts: Array<{ a: string; b: string; summary: string }>;
}

export interface TranscriptCourseDTO {
  code: string;
  title: string;
  units: number;
  status: EnrollmentStatus;
  grade: number | null;
  /** "3.50", "W" (withdrawn) or "IP" (in progress). */
  display: string;
}

export interface TranscriptDTO {
  studentName: string;
  studentNumber: string;
  program: string;
  policyName: string;
  terms: Array<{ termId: number; termName: string; courses: TranscriptCourseDTO[]; termGpa: number | null; unitsEarned: number }>;
  cumulativeGpa: number | null;
  standing: AcademicStanding;
  unitsEarned: number;
  generatedAt: string;
}

export interface ProgressDTO {
  programCode: string;
  programName: string;
  requiredUnits: number;
  unitsEarned: number;
  unitsInProgress: number;
  percent: number;
  requirements: Array<{
    code: string;
    title: string | null;
    category: string;
    status: "COMPLETED" | "IN_PROGRESS" | "REMAINING";
    grade: string | null;
  }>;
}

export interface RecommendationDTO {
  course: CourseDTO;
  requiredByProgram: boolean;
  outcome: "ENROLL" | "WAITLIST";
  warnings: ViolationDTO[];
}

export interface HoldDTO {
  id: number;
  studentId: number;
  studentName: string;
  studentNumber: string;
  type: HoldType;
  reason: string;
  placedAt: string;
  clearedAt: string | null;
  placedByName: string | null;
}

export interface OverloadRequestDTO {
  id: number;
  studentId: number;
  studentName: string;
  studentNumber: string;
  termId: number;
  termName: string;
  extraUnits: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  currentUnits: number;
  maxUnits: number;
}

export interface SummaryDTO {
  student: { id: number; fullName: string; studentNumber: string; program: string; yearLevel: number; standing: ClassStanding; maxUnits: number };
  term: TermDTO | null;
  enrolledCount: number;
  waitlistedCount: number;
  unitsUsed: number;
  unitsLimit: number;
  approvedOverloadUnits: number;
  gpa: number | null;
  activeHolds: Array<{ id: number; type: HoldType; reason: string }>;
  pendingOverloadRequests: number;
}

export interface NotificationDTO {
  id: number;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationsDTO {
  items: NotificationDTO[];
  unreadCount: number;
}

export interface AnnouncementDTO {
  id: number;
  title: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface RegistrationFormDTO {
  student: { fullName: string; studentNumber: string; program: string; yearLevel: number; email: string };
  term: TermDTO;
  courses: Array<{ code: string; title: string; units: number; schedule: string; room: string | null; instructor: string | null; status: "ENROLLED" | "WAITLISTED" }>;
  totalUnits: number;
  generatedAt: string;
}

export interface RosterEntryDTO {
  enrollmentId: number;
  studentId: number;
  studentNumber: string;
  fullName: string;
  email: string;
  status: EnrollmentStatus;
  grade: number | null;
  gradeDisplay: string | null;
  waitlistPosition: number | null;
}

export interface MetaDTO {
  departments: Array<{ id: number; code: string; name: string }>;
  programs: Array<{ id: number; code: string; name: string; departmentId: number }>;
  terms: TermDTO[];
  gradingPolicy: { name: string; min: number; max: number; passMark: number; higherIsBetter: boolean };
}

export interface AdminStudentDTO {
  id: number;
  userId: number;
  studentNumber: string;
  fullName: string;
  email: string;
  programId: number;
  programCode: string;
  yearLevel: number;
  maxUnits: number;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "GRADUATED";
  activeHolds: number;
  enrolledUnits: number;
}

export interface InstructorDTO {
  id: number;
  userId: number;
  fullName: string;
  email: string;
  departmentId: number;
  departmentName: string;
  title: string;
}

export interface AuditEntryDTO {
  id: number;
  createdAt: string;
  actorName: string | null;
  action: string;
  entityType: string;
  studentName: string | null;
  courseCode: string | null;
  details: Record<string, unknown> | null;
}

export interface AnalyticsDTO {
  totals: { students: number; courses: number; seatsTaken: number; seatsTotal: number; waitlisted: number; activeHolds: number; pendingOverloads: number };
  fillByDepartment: Array<{ department: string; departmentName: string; capacity: number; enrolled: number; fillRate: number }>;
  topFull: Array<{ code: string; title: string; capacity: number; enrolled: number; waitlisted: number; fillRate: number }>;
  waitlists: Array<{ code: string; title: string; waitlisted: number }>;
  enrollmentsOverTime: Array<{ date: string; count: number }>;
  unitsDistribution: Array<{ bucket: string; students: number }>;
}

export interface RushRowDTO {
  studentName: string;
  status: "ENROLLED" | "WAITLISTED" | "REJECTED";
  waitlistPosition: number | null;
  reason: string | null;
  ms: number;
}

export interface RushResultDTO {
  courseId: number;
  code: string;
  capacity: number;
  enrolledBefore: number;
  enrolledAfter: number;
  waitlistedAfter: number;
  attempted: number;
  succeeded: number;
  waitlisted: number;
  rejected: number;
  /** The proof: false means the invariant held. */
  overEnrolled: boolean;
  durationMs: number;
  rows: RushRowDTO[];
}

export interface ScheduleSuggestionDTO {
  /** Pairs of cart courses that overlap each other. */
  conflicts: Array<{ a: string; b: string; summary: string }>;
  /** Cart courses that overlap a class the student is ALREADY enrolled in (they would have to drop that class). */
  blockedByCurrent: Array<{ code: string; with: string[] }>;
  /** The best conflict-free selections, largest total units first. Each is a maximal set: nothing more can be added. */
  combinations: Array<{ codes: string[]; units: number }>;
  conflictFree: boolean;
  /** Fewest cart courses that must be left out to remove every overlap among the ones that could be added. */
  minimalRemovals: number;
}

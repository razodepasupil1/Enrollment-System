import {
  Course, Enrollment, FourPointPolicy, Student, Term,
  type CourseProps, type Day, type EnrollmentStatus, type EnrollmentWithCourse,
  type Meeting, type StudentProps, type TermProps,
} from "../../src/domain/index.js";
import type { EnrollmentContext } from "../../src/rules/index.js";

/** Fixed "now" inside the open registration window so tests never depend on the real clock. */
export const NOW = new Date("2026-09-01T00:00:00Z");

export const hm = (h: number, m = 0): number => h * 60 + m;
export const meet = (days: Day[], startMin: number, endMin: number): Meeting[] =>
  days.map((day) => ({ day, startMin, endMin }));

export function makeTerm(o: Partial<TermProps> = {}): Term {
  return new Term({
    id: 1,
    name: "Fall 2026",
    isCurrent: true,
    registrationOpensAt: new Date("2026-08-01T00:00:00Z"),
    registrationClosesAt: new Date("2026-10-15T00:00:00Z"),
    dropDeadline: new Date("2026-09-30T00:00:00Z"),
    endsAt: new Date("2026-12-15T00:00:00Z"),
    ...o,
  });
}

let seq = 100;
export function makeCourse(o: Partial<CourseProps> = {}): Course {
  const id = o.id ?? ++seq;
  return new Course({
    id,
    code: `CS${id}`,
    title: `Course ${id}`,
    units: 3,
    capacity: 30,
    termId: 1,
    instructorId: null,
    department: "CS",
    room: "R1",
    meetings: meet(["MON", "WED"], hm(9), hm(10, 30)),
    ...o,
  });
}

export function makeStudent(o: Partial<StudentProps> = {}): Student {
  return new Student({
    id: 1,
    studentNumber: "2026-0001",
    fullName: "Ana Reyes",
    email: "ana@school.test",
    program: "BSCS",
    yearLevel: 2,
    maxUnits: 21,
    ...o,
  });
}

export function makeEnrollment(
  student: Student,
  course: Course,
  status: EnrollmentStatus = "ENROLLED",
): EnrollmentWithCourse {
  const enrollment = Enrollment.restore({
    id: ++seq,
    studentId: student.id,
    courseId: course.id,
    status,
    grade: null,
    enrolledAt: status === "ENROLLED" ? NOW : null,
    waitlistedAt: status === "WAITLISTED" ? NOW : null,
    endedAt: null,
  });
  return { enrollment, course };
}

export function makeCtx(o: Partial<EnrollmentContext> = {}): EnrollmentContext {
  return {
    student: makeStudent(),
    course: makeCourse(),
    term: makeTerm(),
    now: NOW,
    activeEnrollments: [],
    enrolledCount: 0,
    holds: [],
    approvedOverloadUnits: 0,
    gradingPolicy: new FourPointPolicy(),
    pendingCourseCodes: [],
    ...o,
  };
}

import type { CourseDTO, TermDTO, ViolationDTO } from "@enroll/shared";
import type { Course } from "../domain/Course.js";
import type { Term } from "../domain/Term.js";
import type { Violation } from "../domain/types.js";
import type { CourseExtras } from "../repositories/ReadRepository.js";

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toTermDTO(t: Term, now: Date): TermDTO {
  return {
    id: t.id,
    name: t.name,
    isCurrent: t.isCurrent,
    registrationOpensAt: t.registrationOpensAt.toISOString(),
    registrationClosesAt: t.registrationClosesAt.toISOString(),
    dropDeadline: t.dropDeadline.toISOString(),
    endsAt: t.endsAt.toISOString(),
    registrationOpen: now >= t.registrationOpensAt && now <= t.registrationClosesAt,
  };
}

export const toViolationDTO = (v: Violation): ViolationDTO => ({ code: v.code, message: v.message, severity: v.severity });

export function toCourseDTO(c: Course, x: CourseExtras): CourseDTO {
  const ratio = c.fillRatio(x.enrolled);
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    description: c.description,
    units: c.units,
    capacity: c.capacity,
    termId: c.termId,
    termName: x.termName,
    department: c.department,
    departmentName: x.departmentName,
    instructorId: c.instructorId,
    instructorName: x.instructorName,
    room: c.room,
    meetings: c.meetings.map((m) => ({ day: m.day, startMin: m.startMin, endMin: m.endMin })),
    meetingSummary: c.meetingSummary(),
    prerequisites: c.prerequisites.map((p) => ({ code: p.code, minGrade: p.minGrade })),
    corequisites: [...c.corequisites],
    dropDeadline: iso(c.dropDeadline),
    enrolledCount: x.enrolled,
    waitlistedCount: x.waitlisted,
    availableSeats: c.availableSeats(x.enrolled),
    fillRatio: ratio,
    availability: x.enrolled >= c.capacity ? "FULL" : ratio >= 0.85 ? "ALMOST_FULL" : "OPEN",
  };
}

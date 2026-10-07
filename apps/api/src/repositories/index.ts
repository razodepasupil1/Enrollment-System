import type { Queryable } from "../db/pool.js";
import { AuditRepository } from "./AuditRepository.js";
import { CourseRepository } from "./CourseRepository.js";
import { EnrollmentRepository } from "./EnrollmentRepository.js";
import { HoldRepository } from "./HoldRepository.js";
import { NotificationRepository } from "./NotificationRepository.js";
import { OverloadRepository } from "./OverloadRepository.js";
import { StudentRepository } from "./StudentRepository.js";
import { TermRepository } from "./TermRepository.js";

export * from "./AuditRepository.js";
export * from "./CourseRepository.js";
export * from "./EnrollmentRepository.js";
export * from "./HoldRepository.js";
export * from "./NotificationRepository.js";
export * from "./OverloadRepository.js";
export * from "./StudentRepository.js";
export * from "./TermRepository.js";

/** All repositories bound to one connection, so a transaction hands the same connection to every one. */
export interface Repos {
  terms: TermRepository;
  courses: CourseRepository;
  students: StudentRepository;
  enrollments: EnrollmentRepository;
  holds: HoldRepository;
  overloads: OverloadRepository;
  notifications: NotificationRepository;
  audit: AuditRepository;
}

export function reposFor(db: Queryable): Repos {
  const courses = new CourseRepository(db);
  return {
    terms: new TermRepository(db),
    courses,
    students: new StudentRepository(db),
    enrollments: new EnrollmentRepository(db, courses),
    holds: new HoldRepository(db),
    overloads: new OverloadRepository(db),
    notifications: new NotificationRepository(db),
    audit: new AuditRepository(db),
  };
}

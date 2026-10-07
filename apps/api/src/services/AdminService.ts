import bcrypt from "bcryptjs";
import type {
  AdminStudentDTO, AnalyticsDTO, AnnouncementDTO, AuditEntryDTO, HoldDTO, InstructorDTO, MetaDTO,
  OverloadRequestDTO, RushResultDTO, RushRowDTO, TermDTO,
} from "@enroll/shared";
import type { CourseInput, TermInput } from "@enroll/shared";
import { loadConfig, type Config } from "../config.js";
import type { Pool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { policyByName, type GradingPolicy } from "../domain/GradingPolicy.js";
import { ConflictError, DomainError, ForbiddenError, InvariantError, NotFoundError, RuleViolationError, ValidationError } from "../errors/index.js";
import { reposFor } from "../repositories/index.js";
import { AdminRepository } from "../repositories/AdminRepository.js";
import { ReadRepository } from "../repositories/ReadRepository.js";
import { iso, toTermDTO } from "./dto.js";
import type { EnrollmentService } from "./EnrollmentService.js";
import type { PortalService } from "./PortalService.js";
import type { Actor } from "./types.js";

const CSV_HEADERS = ["Student No.", "Name", "Email", "Course", "Title", "Units", "Status", "Grade", "Enrolled at", "Waitlisted at"];

/** Spreadsheet apps run cells starting with = + - @ as formulas; a leading apostrophe makes them plain text. */
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export class AdminService {
  private readonly policy: GradingPolicy;
  private readonly config: Config;
  private readonly clock: () => Date;

  constructor(
    private readonly pool: Pool,
    private readonly enrollments: EnrollmentService,
    private readonly portal: PortalService,
    opts: { config?: Config; gradingPolicy?: GradingPolicy; clock?: () => Date } = {},
  ) {
    this.config = opts.config ?? loadConfig();
    this.policy = opts.gradingPolicy ?? policyByName(this.config.gradingPolicy);
    this.clock = opts.clock ?? (() => new Date());
  }

  private get admin(): AdminRepository { return new AdminRepository(this.pool); }

  // --- meta / terms ---------------------------------------------------------------------
  async terms(): Promise<TermDTO[]> {
    const now = this.clock();
    return (await reposFor(this.pool).terms.list()).map((t) => toTermDTO(t, now));
  }

  async meta(): Promise<MetaDTO> {
    return {
      departments: await this.admin.departments(),
      programs: await this.admin.programs(),
      terms: await this.terms(),
      gradingPolicy: { name: this.policy.name, ...this.policy.scale },
    };
  }

  async createTerm(input: TermInput, actor: Actor): Promise<{ id: number }> {
    return withTransaction(this.pool, async (conn) => {
      const repo = new AdminRepository(conn);
      const id = await repo.insertTerm(input);
      if (input.isCurrent) await repo.setCurrentTerm(id);
      await reposFor(conn).audit.record({ actorUserId: actor.userId, action: "TERM_CREATE", entityType: "term", entityId: id, details: { name: input.name, current: input.isCurrent }, now: this.clock() });
      return { id };
    });
  }

  async updateTerm(id: number, input: TermInput, actor: Actor): Promise<void> {
    await withTransaction(this.pool, async (conn) => {
      const repo = new AdminRepository(conn);
      if (!(await reposFor(conn).terms.findById(id))) throw new NotFoundError("Term");
      await repo.updateTerm(id, input);
      if (input.isCurrent) await repo.setCurrentTerm(id);
      await reposFor(conn).audit.record({ actorUserId: actor.userId, action: input.isCurrent ? "TERM_SET_CURRENT" : "TERM_UPDATE", entityType: "term", entityId: id, details: { name: input.name }, now: this.clock() });
    });
  }

  // --- courses ---------------------------------------------------------------------------
  async createCourse(input: CourseInput, actor: Actor): Promise<{ id: number }> {
    return withTransaction(this.pool, async (conn) => {
      const id = await new AdminRepository(conn).insertCourse(input);
      await reposFor(conn).audit.record({ actorUserId: actor.userId, action: "COURSE_CREATE", entityType: "course", entityId: id, courseId: id, details: { code: input.code.toUpperCase(), capacity: input.capacity }, now: this.clock() });
      return { id };
    });
  }

  /** Raising capacity immediately offers the new seats to the waitlist. Lowering it below the head-count is refused. */
  async updateCourse(id: number, input: CourseInput, actor: Actor): Promise<{ promotions: number }> {
    const before = await withTransaction(this.pool, async (conn) => {
      const repos = reposFor(conn);
      const repo = new AdminRepository(conn);
      if (!(await repos.courses.lockById(id))) throw new NotFoundError("Course");
      const current = (await repo.courseCode(id))!;
      if (input.code.toUpperCase() !== current.code || input.termId !== current.termId) {
        throw new ValidationError("A course's code and term cannot be changed. Create a new offering instead.");
      }
      const enrolled = await repos.enrollments.countByStatus(id, "ENROLLED");
      if (input.capacity < enrolled) throw new ValidationError(`Capacity cannot be lower than the ${enrolled} students already enrolled.`);
      await repo.updateCourse(id, input);
      await repos.audit.record({ actorUserId: actor.userId, action: "COURSE_UPDATE", entityType: "course", entityId: id, courseId: id, details: { code: current.code, capacity: { from: current.capacity, to: input.capacity } }, now: this.clock() });
      return current.capacity;
    });
    if (input.capacity > before) {
      const promoted = await this.enrollments.fillSeatsFromWaitlist(id, actor);
      return { promotions: promoted.filter((p) => p.outcome === "PROMOTED").length };
    }
    return { promotions: 0 };
  }

  async deleteCourse(id: number, actor: Actor): Promise<void> {
    await withTransaction(this.pool, async (conn) => {
      const repos = reposFor(conn);
      const repo = new AdminRepository(conn);
      if (!(await repos.courses.lockById(id))) throw new NotFoundError("Course");
      if ((await repo.courseEnrollmentRows(id)) > 0) {
        throw new ConflictError("This course has enrollment history and cannot be deleted. Set its capacity to 0 to close it.");
      }
      const info = (await repo.courseCode(id))!;
      await repo.deleteCourse(id);
      await repos.audit.record({ actorUserId: actor.userId, action: "COURSE_DELETE", entityType: "course", entityId: id, details: { code: info.code }, now: this.clock() });
    });
  }

  // --- students / instructors ----------------------------------------------------------------
  async students(q: string | undefined, page: number, pageSize: number): Promise<{ items: AdminStudentDTO[]; total: number }> {
    return this.admin.listStudents(q, page, pageSize);
  }

  async createStudent(input: { fullName: string; email: string; password: string; studentNumber: string; programId: number; yearLevel: number; maxUnits: number }, actor: Actor): Promise<{ id: number }> {
    const hash = await bcrypt.hash(input.password, 10);
    return withTransaction(this.pool, async (conn) => {
      const repo = new AdminRepository(conn);
      const now = this.clock();
      const userId = await repo.insertUser(input.email, hash, input.fullName, "student", now);
      const id = await repo.insertStudent(userId, input.studentNumber, input.programId, input.yearLevel, input.maxUnits);
      await reposFor(conn).audit.record({ actorUserId: actor.userId, action: "STUDENT_CREATE", entityType: "student", entityId: id, studentId: id, details: { studentNumber: input.studentNumber }, now });
      return { id };
    });
  }

  async updateStudent(id: number, input: { fullName: string; programId: number; yearLevel: number; maxUnits: number; status: string }, actor: Actor): Promise<void> {
    await withTransaction(this.pool, async (conn) => {
      if ((await new AdminRepository(conn).studentUserId(id)) === null) throw new NotFoundError("Student");
      await new AdminRepository(conn).updateStudent(id, input);
      await reposFor(conn).audit.record({ actorUserId: actor.userId, action: "STUDENT_UPDATE", entityType: "student", entityId: id, studentId: id, details: { status: input.status, maxUnits: input.maxUnits, yearLevel: input.yearLevel }, now: this.clock() });
    });
  }

  async instructors(): Promise<InstructorDTO[]> {
    return this.admin.listInstructors();
  }

  async createInstructor(input: { fullName: string; email: string; password: string; departmentId: number; title: string }, actor: Actor): Promise<{ id: number }> {
    const hash = await bcrypt.hash(input.password, 10);
    return withTransaction(this.pool, async (conn) => {
      const repo = new AdminRepository(conn);
      const now = this.clock();
      const userId = await repo.insertUser(input.email, hash, input.fullName, "instructor", now);
      const id = await repo.insertInstructor(userId, input.departmentId, input.title);
      await reposFor(conn).audit.record({ actorUserId: actor.userId, action: "INSTRUCTOR_CREATE", entityType: "instructor", entityId: id, details: { name: input.fullName }, now });
      return { id };
    });
  }

  async updateInstructor(id: number, input: { fullName: string; departmentId: number; title: string }, actor: Actor): Promise<void> {
    await withTransaction(this.pool, async (conn) => {
      if (!(await new AdminRepository(conn).updateInstructor(id, input))) throw new NotFoundError("Instructor");
      await reposFor(conn).audit.record({ actorUserId: actor.userId, action: "INSTRUCTOR_UPDATE", entityType: "instructor", entityId: id, details: { name: input.fullName }, now: this.clock() });
    });
  }

  // --- holds -----------------------------------------------------------------------------------
  async holds(activeOnly: boolean): Promise<HoldDTO[]> {
    return (await this.admin.listHolds(activeOnly)).map((h) => ({ ...h, placedAt: h.placedAt.toISOString(), clearedAt: iso(h.clearedAt) }));
  }

  async placeHold(input: { studentId: number; type: "FINANCIAL" | "ADVISING" | "ACADEMIC"; reason: string }, actor: Actor): Promise<{ id: number }> {
    return withTransaction(this.pool, async (conn) => {
      const repos = reposFor(conn);
      const userId = await new AdminRepository(conn).studentUserId(input.studentId);
      if (userId === null) throw new NotFoundError("Student");
      const now = this.clock();
      const id = await repos.holds.create({ ...input, placedBy: actor.userId, now });
      await repos.notifications.create({ userId, type: "HOLD", title: "A hold was placed on your account", body: input.reason, now });
      await repos.audit.record({ actorUserId: actor.userId, action: "HOLD_PLACE", entityType: "hold", entityId: id, studentId: input.studentId, details: { type: input.type, reason: input.reason }, now });
      return { id };
    });
  }

  async clearHold(holdId: number, actor: Actor): Promise<void> {
    await withTransaction(this.pool, async (conn) => {
      const repos = reposFor(conn);
      const repo = new AdminRepository(conn);
      const studentId = await repo.holdStudentId(holdId);
      if (studentId === null) throw new NotFoundError("Active hold");
      const now = this.clock();
      await repos.holds.clear(holdId, actor.userId, now);
      await repos.notifications.create({ userId: (await repo.studentUserId(studentId))!, type: "HOLD_CLEARED", title: "Your hold was cleared", body: "You can enroll in courses again.", now });
      await repos.audit.record({ actorUserId: actor.userId, action: "HOLD_CLEAR", entityType: "hold", entityId: holdId, studentId, now });
    });
  }

  // --- overload requests ---------------------------------------------------------------------------
  async overloads(status?: string, studentId?: number): Promise<OverloadRequestDTO[]> {
    return (await this.admin.listOverloads(status, studentId)).map((o) => ({ ...o, createdAt: o.createdAt.toISOString(), decidedAt: iso(o.decidedAt) }));
  }

  async decideOverload(id: number, approve: boolean, note: string | undefined, actor: Actor): Promise<void> {
    await withTransaction(this.pool, async (conn) => {
      const repos = reposFor(conn);
      const repo = new AdminRepository(conn);
      const req = await repo.pendingOverload(id); // FOR UPDATE: two admins cannot decide the same request
      if (!req) throw new NotFoundError("Pending overload request");
      const now = this.clock();
      await repo.decideOverload(id, approve, actor.userId, note ?? null, now);
      await repos.notifications.create({
        userId: (await repo.studentUserId(req.studentId))!,
        type: "OVERLOAD",
        title: approve ? "Your overload request was approved" : "Your overload request was declined",
        body: (approve ? `You may now take ${req.extraUnits} extra units this term.` : "Your request for extra units was not approved.") + (note ? ` Note: ${note}` : ""),
        now,
      });
      await repos.audit.record({ actorUserId: actor.userId, action: approve ? "OVERLOAD_APPROVE" : "OVERLOAD_REJECT", entityType: "overload_request", entityId: id, studentId: req.studentId, details: { extraUnits: req.extraUnits, note: note ?? null }, now });
    });
  }

  // --- announcements ------------------------------------------------------------------------------------
  async announce(input: { title: string; body: string }, actor: Actor): Promise<{ id: number; notified: number }> {
    return withTransaction(this.pool, async (conn) => {
      const repo = new AdminRepository(conn);
      const now = this.clock();
      const id = await repo.insertAnnouncement(actor.userId, input.title, input.body, now);
      const notified = await repo.notifyAllStudents(input.title, input.body, now);
      await reposFor(conn).audit.record({ actorUserId: actor.userId, action: "ANNOUNCE", entityType: "announcement", entityId: id, details: { title: input.title, notified }, now });
      return { id, notified };
    });
  }

  async announcements(): Promise<AnnouncementDTO[]> {
    return (await new ReadRepository(this.pool).announcements()).map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }));
  }

  // --- audit / analytics / export -----------------------------------------------------------------------
  async audit(f: { action?: string; studentId?: number; courseId?: number; page: number; pageSize: number }): Promise<{ items: AuditEntryDTO[]; total: number; actions: string[] }> {
    const [res, actions] = await Promise.all([this.admin.audit(f), this.admin.auditActions()]);
    return { total: res.total, actions, items: res.items.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })) };
  }

  async analytics(termId?: number): Promise<AnalyticsDTO> {
    const term = await this.portal.resolveTerm(termId);
    return this.admin.analytics(term.id);
  }

  async exportEnrollmentsCsv(termId?: number): Promise<string> {
    const term = await this.portal.resolveTerm(termId);
    const rows = await this.admin.exportRows(term.id);
    const lines = [CSV_HEADERS.map(csvCell).join(",")];
    for (const r of rows) {
      lines.push([r.student_number, r.full_name, r.email, r.code, r.title, r.units, r.status, r.grade, r.enrolled_at, r.waitlisted_at].map(csvCell).join(","));
    }
    return lines.join("\r\n") + "\r\n";
  }

  // --- Rush Simulator ----------------------------------------------------------------------------------------
  /**
   * Creates N virtual students and enrolls them ALL AT ONCE through the real EnrollmentService, each in its
   * own transaction. The result table is the live proof that exactly `capacity` seats are taken no matter
   * how many requests collide. Every run starts by removing the previous run's virtual students.
   */
  async simulateRush(input: { courseId: number; count: number }, actor: Actor): Promise<RushResultDTO> {
    if (!this.config.demoMode) throw new ForbiddenError("The Rush Simulator is only available when DEMO_MODE=true.");
    const repos = reposFor(this.pool);
    const course = await repos.courses.findById(input.courseId);
    if (!course) throw new NotFoundError("Course");
    const programId = await this.admin.firstProgramId();
    if (programId === null) throw new InvariantError("No program exists to attach virtual students to.");

    await this.admin.deleteSimulated();
    const enrolledBefore = await repos.enrollments.countByStatus(course.id, "ENROLLED");

    const run = Date.now().toString(36);
    const now = this.clock();
    const students: Array<{ studentId: number; userId: number; name: string }> = [];
    for (let i = 1; i <= input.count; i++) {
      const name = `Virtual Student ${String(i).padStart(2, "0")}`;
      const userId = await this.admin.insertUser(`sim-${run}-${i}@sim.local`, "!simulated", name, "student", now, true);
      const studentId = await this.admin.insertStudent(userId, `SIM-${run}-${i}`, programId, 2, 21);
      students.push({ studentId, userId, name });
    }

    const started = performance.now();
    const rows: RushRowDTO[] = await Promise.all(
      students.map(async (s): Promise<RushRowDTO> => {
        const t0 = performance.now();
        const ms = () => Math.round(performance.now() - t0);
        try {
          const r = await this.enrollments.enroll({ studentId: s.studentId, courseId: course.id, actor: { userId: s.userId, role: "student", studentId: s.studentId } });
          return { studentName: s.name, status: r.status, waitlistPosition: r.waitlistPosition, reason: null, ms: ms() };
        } catch (err) {
          if (!(err instanceof DomainError)) throw err;
          const reason = err instanceof RuleViolationError ? (err.violations.find((v) => v.severity === "block")?.message ?? err.message) : err.message;
          return { studentName: s.name, status: "REJECTED", waitlistPosition: null, reason, ms: ms() };
        }
      }),
    );
    const durationMs = Math.round(performance.now() - started);

    const enrolledAfter = await repos.enrollments.countByStatus(course.id, "ENROLLED");
    const waitlistedAfter = await repos.enrollments.countByStatus(course.id, "WAITLISTED");
    await repos.audit.record({ actorUserId: actor.userId, action: "RUSH_SIMULATE", entityType: "course", entityId: course.id, courseId: course.id, details: { code: course.code, students: input.count, enrolledAfter, capacity: course.capacity }, now: this.clock() });

    rows.sort((a, b) => Number(a.status !== "ENROLLED") - Number(b.status !== "ENROLLED") || (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0) || a.studentName.localeCompare(b.studentName));
    return {
      courseId: course.id, code: course.code, capacity: course.capacity, enrolledBefore, enrolledAfter, waitlistedAfter,
      attempted: rows.length, succeeded: rows.filter((r) => r.status === "ENROLLED").length,
      waitlisted: rows.filter((r) => r.status === "WAITLISTED").length, rejected: rows.filter((r) => r.status === "REJECTED").length,
      overEnrolled: enrolledAfter > course.capacity, durationMs, rows,
    };
  }

  async resetRush(actor: Actor): Promise<{ removedStudents: number }> {
    if (!this.config.demoMode) throw new ForbiddenError("The Rush Simulator is only available when DEMO_MODE=true.");
    const removedStudents = await this.admin.deleteSimulated();
    await reposFor(this.pool).audit.record({ actorUserId: actor.userId, action: "RUSH_RESET", entityType: "course", details: { removedStudents }, now: this.clock() });
    return { removedStudents };
  }
}

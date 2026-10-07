import { loadConfig } from "../config.js";
import { withTransaction } from "../db/transaction.js";
import type { Pool } from "../db/pool.js";
import type { Course } from "../domain/Course.js";
import { Enrollment } from "../domain/Enrollment.js";
import { policyByName, type GradingPolicy } from "../domain/GradingPolicy.js";
import type { Student } from "../domain/Student.js";
import type { Term } from "../domain/Term.js";
import {
  CourseFullError, DeadlinePassedError, DomainError, ForbiddenError, errorFromViolations,
  AlreadyEnrolledError, InvariantError, NotFoundError, RuleViolationError,
} from "../errors/index.js";
import { reposFor, type Repos } from "../repositories/index.js";
import {
  defaultRules, RegistrationWindowRule, RuleEngine, type EnrollmentContext,
} from "../rules/index.js";
import type {
  Actor, BatchItemResult, DropResult, EnrollResult, PromotionResult, ValidationResult,
} from "./types.js";

export interface EnrollmentServiceOptions {
  engine?: RuleEngine;
  gradingPolicy?: GradingPolicy;
  /** Injectable clock so tests (and the demo) control "now". */
  clock?: () => Date;
}

/**
 * Use-cases for enrolling, dropping, promoting, and grading.
 *
 * Division of labour (important for the oral defense):
 *   - the RULE ENGINE decides whether an action is allowed;
 *   - the TRANSACTION + ROW LOCKS guarantee it is still allowed when we write.
 * Lock order is always student -> course, so two transactions can rarely deadlock;
 * when they do, withTransaction() retries.
 */
export class EnrollmentService {
  private readonly engine: RuleEngine;
  /** Same rules minus the registration window: see promoteWaitlist(). */
  private readonly promotionEngine: RuleEngine;
  private readonly policy: GradingPolicy;
  private readonly clock: () => Date;

  constructor(private readonly pool: Pool, opts: EnrollmentServiceOptions = {}) {
    this.engine = opts.engine ?? new RuleEngine();
    this.promotionEngine = new RuleEngine(defaultRules().filter((r) => !(r instanceof RegistrationWindowRule)));
    this.policy = opts.gradingPolicy ?? policyByName(loadConfig().gradingPolicy);
    this.clock = opts.clock ?? (() => new Date());
  }

  // ---------------------------------------------------------------------------
  // Dry run: same rules, no writes, no locks. Powers the cart's live preview.
  // ---------------------------------------------------------------------------
  async validate(studentId: number, courseId: number, alsoEnrollingCodes: readonly string[] = []): Promise<ValidationResult> {
    const repos = reposFor(this.pool);
    const { student, course, term } = await this.loadSubjects(repos, studentId, courseId);
    const ctx = await this.buildContext(repos, student, course, term, this.clock(), undefined, alsoEnrollingCodes);
    const evaluation = this.engine.evaluate(ctx);
    return {
      outcome: evaluation.outcome,
      violations: evaluation.violations,
      wouldBeWaitlistPosition:
        evaluation.outcome === "WAITLIST" ? (await repos.enrollments.countByStatus(courseId, "WAITLISTED")) + 1 : null,
    };
  }

  /**
   * Dry run for many courses at once. Loads the student's world ONCE and evaluates each course
   * in memory, so a catalog page of 12 courses costs a handful of queries rather than ~70.
   */
  async validateMany(studentId: number, courseIds: readonly number[], cartCourseIds: readonly number[] = []): Promise<Record<number, ValidationResult>> {
    const repos = reposFor(this.pool);
    const loaded = await repos.students.findById(studentId);
    if (!loaded) throw new NotFoundError("Student");
    const ids = [...new Set([...courseIds, ...cartCourseIds])];
    const courses = await repos.courses.findByIds(ids);
    const byId = new Map(courses.map((c) => [c.id, c]));
    const cartCodes = cartCourseIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!.code] : []));
    const counts = await repos.enrollments.countsByCourse(courses.map((c) => c.id));
    const holds = await repos.holds.findActiveByStudent(studentId);
    const now = this.clock();

    const perTerm = new Map<number, { term: Term; active: Awaited<ReturnType<Repos["enrollments"]["findActiveWithCourses"]>>; overload: number }>();
    const out: Record<number, ValidationResult> = {};
    for (const id of courseIds) {
      const course = byId.get(id);
      if (!course) continue;
      let t = perTerm.get(course.termId);
      if (!t) {
        const term = await repos.terms.findById(course.termId);
        if (!term) continue;
        t = {
          term,
          active: await repos.enrollments.findActiveWithCourses(studentId, term.id),
          overload: await repos.overloads.approvedUnits(studentId, term.id),
        };
        perTerm.set(course.termId, t);
      }
      const count = counts.get(id) ?? { enrolled: 0, waitlisted: 0 };
      const evaluation = this.engine.evaluate({
        student: loaded.student, course, term: t.term, now, activeEnrollments: t.active,
        enrolledCount: count.enrolled, holds, approvedOverloadUnits: t.overload, gradingPolicy: this.policy,
        pendingCourseCodes: cartCodes.filter((c) => c !== course.code),
      });
      out[id] = {
        outcome: evaluation.outcome,
        violations: evaluation.violations,
        wouldBeWaitlistPosition: evaluation.outcome === "WAITLIST" ? count.waitlisted + 1 : null,
      };
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Enroll (or auto-waitlist when full)
  // ---------------------------------------------------------------------------
  async enroll(input: {
    studentId: number;
    courseId: number;
    actor: Actor;
    /** false = refuse instead of waitlisting a full course. Default true. */
    allowWaitlist?: boolean;
    /** Other courses in the same cart submission (lets corequisite pairs satisfy each other). */
    alsoEnrollingCodes?: readonly string[];
  }): Promise<EnrollResult> {
    this.assertMayActFor(input.actor, input.studentId);
    return withTransaction(this.pool, async (conn) => {
      const repos = reposFor(conn);
      await this.lockStudentThenCourse(repos, input.studentId, input.courseId);

      // Everything below reads AFTER the locks, so it sees every earlier committed enrollment.
      const { student, userId, course, term } = await this.loadSubjects(repos, input.studentId, input.courseId);
      const now = this.clock();
      const ctx = await this.buildContext(repos, student, course, term, now, undefined, input.alsoEnrollingCodes ?? []);
      const evaluation = this.engine.evaluate(ctx);

      if (evaluation.outcome === "BLOCKED") throw errorFromViolations(evaluation.violations);
      if (evaluation.outcome === "WAITLIST" && input.allowWaitlist === false) {
        throw new CourseFullError(evaluation.violations);
      }

      const enrollment = Enrollment.create({
        studentId: student.id,
        courseId: course.id,
        seatAvailable: evaluation.outcome === "ENROLL",
        now,
      });
      await repos.enrollments.insert(enrollment);
      const id = enrollment.id!;

      const waitlisted = enrollment.status === "WAITLISTED";
      const position = waitlisted ? await repos.enrollments.waitlistPosition(id) : null;

      await repos.audit.record({
        actorUserId: input.actor.userId,
        action: waitlisted ? "WAITLIST" : "ENROLL",
        entityType: "enrollment",
        entityId: id,
        studentId: student.id,
        courseId: course.id,
        details: { code: course.code, outcome: enrollment.status, waitlistPosition: position },
        now,
      });
      if (waitlisted) {
        await repos.notifications.create({
          userId,
          type: "WAITLIST",
          title: `You are on the waitlist for ${course.code}`,
          body: `You are #${position} on the waitlist for ${course.code}. You will be enrolled automatically if a seat opens.`,
          now,
        });
      }

      return {
        enrollmentId: id,
        courseId: course.id,
        status: enrollment.status as "ENROLLED" | "WAITLISTED",
        waitlistPosition: position,
        warnings: evaluation.violations.filter((v) => v.severity === "warn"),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Drop (or leave the waitlist), then fill the freed seat from the waitlist
  // ---------------------------------------------------------------------------
  async drop(input: { enrollmentId: number; actor: Actor }): Promise<DropResult> {
    // Plain read first, only to learn which student/course to lock; re-read under lock below.
    const peek = await reposFor(this.pool).enrollments.findById(input.enrollmentId);
    if (!peek) throw new NotFoundError("Enrollment");
    // Report "not found" rather than "forbidden" so students cannot probe other people's ids.
    if (input.actor.role === "student" && input.actor.studentId !== peek.studentId) throw new NotFoundError("Enrollment");

    return withTransaction(this.pool, async (conn) => {
      const repos = reposFor(conn);
      await this.lockStudentThenCourse(repos, peek.studentId, peek.courseId);

      const enrollment = await repos.enrollments.findById(input.enrollmentId, { forUpdate: true });
      if (!enrollment) throw new NotFoundError("Enrollment");
      const course = (await repos.courses.findById(enrollment.courseId))!;
      const term = (await repos.terms.findById(course.termId))!;
      const now = this.clock();

      if (term.hasEnded(now)) throw new DeadlinePassedError(`${term.name} has ended; enrollments can no longer be dropped.`);

      let status: "DROPPED" | "WITHDRAWN";
      let promotions: PromotionResult[] = [];
      // Decide from the LOCKED row, not the earlier unlocked peek: a promotion may have landed in between.
      const wasWaitlisted = enrollment.status === "WAITLISTED";

      if (wasWaitlisted) {
        enrollment.leaveWaitlist(now); // no seat was held, so nobody is promoted
        status = "DROPPED";
      } else {
        // Deadline: the course's own, if it has one (short modules), otherwise the term's.
        status = enrollment.drop(now, course.dropDeadline ?? term.dropDeadline);
      }
      await repos.enrollments.save(enrollment);
      await repos.audit.record({
        actorUserId: input.actor.userId,
        action: status === "WITHDRAWN" ? "WITHDRAW" : wasWaitlisted ? "LEAVE_WAITLIST" : "DROP",
        entityType: "enrollment",
        entityId: enrollment.id,
        studentId: enrollment.studentId,
        courseId: course.id,
        details: { code: course.code, result: status },
        now,
      });

      if (!wasWaitlisted) {
        promotions = await this.promoteWaitlist(repos, course, term, now, input.actor.userId);
      }
      return { enrollmentId: enrollment.id!, courseId: course.id, status, promotions };
    });
  }

  /** Fills any free seats from the waitlist (e.g. after an admin raises a course's capacity). */
  async fillSeatsFromWaitlist(courseId: number, actor: Actor): Promise<PromotionResult[]> {
    return withTransaction(this.pool, async (conn) => {
      const repos = reposFor(conn);
      if (!(await repos.courses.lockById(courseId))) throw new NotFoundError("Course");
      const course = (await repos.courses.findById(courseId))!;
      const term = (await repos.terms.findById(course.termId))!;
      return this.promoteWaitlist(repos, course, term, this.clock(), actor.userId);
    });
  }

  /**
   * Caller must already hold the course lock. Offers each free seat to the earliest waitlisted
   * student, RE-RUNNING THE RULES for them: a hold, a new conflict, or a full schedule may have
   * appeared since they joined. Anyone who no longer qualifies keeps their place in line, is
   * told why, and is skipped for now (so a cleared hold later does not cost them their spot).
   *
   * The registration window is not re-checked: promotion continues an enrollment that was made
   * while the window was open, and should still work during the add/drop period after it closes.
   */
  private async promoteWaitlist(
    repos: Repos, course: Course, term: Term, now: Date, actorUserId: number,
  ): Promise<PromotionResult[]> {
    const results: PromotionResult[] = [];
    const skipped = new Set<number>();

    for (;;) {
      const enrolled = await repos.enrollments.countByStatus(course.id, "ENROLLED");
      if (course.isFull(enrolled)) break;

      const candidate = (await repos.enrollments.waitlistQueue(course.id)).find((e) => !skipped.has(e.id!));
      if (!candidate) break;

      // Student lock is taken while holding the course lock (the reverse of enroll's order);
      // an occasional deadlock here is resolved by the transaction retry.
      await repos.students.lockById(candidate.studentId);
      const loaded = (await repos.students.findById(candidate.studentId))!;
      const ctx = await this.buildContext(repos, loaded.student, course, term, now, candidate.id!);
      const evaluation = this.promotionEngine.evaluate(ctx);

      if (evaluation.outcome === "ENROLL") {
        candidate.promote(now);
        await repos.enrollments.save(candidate);
        await repos.audit.record({
          actorUserId, action: "PROMOTE", entityType: "enrollment", entityId: candidate.id,
          studentId: candidate.studentId, courseId: course.id,
          details: { code: course.code, waitedSince: candidate.waitlistedAt?.toISOString() ?? null }, now,
        });
        await repos.notifications.create({
          userId: loaded.userId, type: "PROMOTION",
          title: `You are now enrolled in ${course.code}`,
          body: `A seat opened up and you were moved off the waitlist into ${course.code} (${course.title}).`,
          now,
        });
        results.push({ enrollmentId: candidate.id!, studentId: candidate.studentId, courseId: course.id, outcome: "PROMOTED", reasons: [] });
      } else {
        skipped.add(candidate.id!);
        const reasons = evaluation.violations.filter((v) => v.severity === "block");
        await repos.audit.record({
          actorUserId, action: "PROMOTE_SKIPPED", entityType: "enrollment", entityId: candidate.id,
          studentId: candidate.studentId, courseId: course.id,
          details: { code: course.code, reasons: reasons.map((r) => r.code) }, now,
        });
        await repos.notifications.create({
          userId: loaded.userId, type: "WAITLIST_SKIPPED",
          title: `A seat opened in ${course.code}, but you could not take it`,
          body: `${reasons.map((r) => r.message).join(" ")} You keep your place on the waitlist.`.slice(0, 500),
          now,
        });
        results.push({ enrollmentId: candidate.id!, studentId: candidate.studentId, courseId: course.id, outcome: "SKIPPED", reasons });
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Cart submit: every item in its own transaction, so one failure never undoes the rest
  // ---------------------------------------------------------------------------
  async enrollBatch(input: { studentId: number; courseIds: readonly number[]; actor: Actor }): Promise<BatchItemResult[]> {
    this.assertMayActFor(input.actor, input.studentId);
    const unique = [...new Set(input.courseIds)];
    const courses = await reposFor(this.pool).courses.findByIds(unique);
    const byId = new Map(courses.map((c) => [c.id, c]));
    const cartCodes = courses.map((c) => c.code);
    const code = (id: number) => byId.get(id)?.code ?? null;
    const results = new Map<number, BatchItemResult>();

    for (const courseId of unique) {
      try {
        const r = await this.enroll({
          studentId: input.studentId, courseId, actor: input.actor, alsoEnrollingCodes: cartCodes,
        });
        results.set(courseId, {
          courseId, code: code(courseId), status: r.status, enrollmentId: r.enrollmentId,
          waitlistPosition: r.waitlistPosition, error: null,
        });
      } catch (err) {
        if (!(err instanceof DomainError)) throw err; // a bug or an outage must not be reported as "rejected"
        results.set(courseId, {
          courseId, code: code(courseId), status: "REJECTED", enrollmentId: null, waitlistPosition: null,
          error: { code: err.code, message: err.message, violations: err instanceof RuleViolationError ? err.violations : [] },
        });
      }
    }

    // Integrity guard. A lab was allowed in only because its lecture was in the same cart. If the
    // lecture then failed (say, a missing prerequisite) the lab must not stay behind on its own.
    // Repeat until stable, because undoing one item can invalidate another that leaned on it.
    for (let changed = true; changed; ) {
      changed = false;
      for (const courseId of unique) {
        const item = results.get(courseId)!;
        if (item.status === "REJECTED" || item.enrollmentId === null) continue;
        const failedCoreq = byId.get(courseId)!.corequisites.find((co) => {
          const partner = courses.find((c) => c.code === co);
          return partner !== undefined && results.get(partner.id)?.status === "REJECTED";
        });
        if (!failedCoreq) continue;
        await this.undoFreshEnrollment(item.enrollmentId, input.actor, `corequisite ${failedCoreq} could not be enrolled`);
        const message = `${item.code} was not enrolled because its corequisite ${failedCoreq} could not be enrolled.`;
        results.set(courseId, {
          ...item, status: "REJECTED", enrollmentId: null, waitlistPosition: null,
          error: { code: "COREQUISITE_MISSING", message, violations: [{ code: "COREQUISITE_MISSING", severity: "block", message }] },
        });
        changed = true;
      }
    }
    return unique.map((id) => results.get(id)!);
  }

  /**
   * Reverses an enrollment created moments ago in the same cart. Always DROPPED (never a "W"),
   * because this is a rollback of our own action, not the student choosing to withdraw.
   */
  private async undoFreshEnrollment(enrollmentId: number, actor: Actor, why: string): Promise<void> {
    await withTransaction(this.pool, async (conn) => {
      const repos = reposFor(conn);
      const peek = await repos.enrollments.findById(enrollmentId);
      if (!peek) return;
      await this.lockStudentThenCourse(repos, peek.studentId, peek.courseId);
      const enrollment = await repos.enrollments.findById(enrollmentId, { forUpdate: true });
      if (!enrollment?.isActive) return;
      const course = (await repos.courses.findById(enrollment.courseId))!;
      const term = (await repos.terms.findById(course.termId))!;
      const now = this.clock();
      const hadSeat = enrollment.status === "ENROLLED";
      if (hadSeat) enrollment.drop(now, now); // deadline = now => DROPPED
      else enrollment.leaveWaitlist(now);
      await repos.enrollments.save(enrollment);
      await repos.audit.record({
        actorUserId: actor.userId, action: "ROLLBACK", entityType: "enrollment", entityId: enrollment.id,
        studentId: enrollment.studentId, courseId: course.id, details: { code: course.code, why }, now,
      });
      if (hadSeat) await this.promoteWaitlist(repos, course, term, now, actor.userId);
    });
  }

  // ---------------------------------------------------------------------------
  // Admin override: bypasses the rules, but never capacity or the one-active-row guarantee
  // ---------------------------------------------------------------------------
  async forceEnroll(input: { studentId: number; courseId: number; reason: string; actor: Actor }): Promise<EnrollResult> {
    if (input.actor.role !== "admin") throw new ForbiddenError("Only administrators can override enrollment rules.");
    const reason = input.reason.trim();
    if (reason.length < 5) throw new InvariantError("A reason of at least 5 characters is required for an override.");

    return withTransaction(this.pool, async (conn) => {
      const repos = reposFor(conn);
      await this.lockStudentThenCourse(repos, input.studentId, input.courseId);
      const { student, userId, course, term } = await this.loadSubjects(repos, input.studentId, input.courseId);
      const now = this.clock();
      const ctx = await this.buildContext(repos, student, course, term, now);

      // Deliberately NOT overridable: "prevent over-enrollment" is an invariant, not a policy.
      // To seat someone in a full class an admin first raises the capacity (which is itself audited).
      if (ctx.course.isFull(ctx.enrolledCount)) {
        throw new CourseFullError([{ code: "COURSE_FULL", severity: "block", message: `${course.code} is full. Raise its capacity first, then override.` }]);
      }
      const already = ctx.activeEnrollments.find((e) => e.enrollment.courseId === course.id);
      if (already) {
        throw new AlreadyEnrolledError("ALREADY_ENROLLED", [{ code: "ALREADY_ENROLLED", severity: "block", message: `${student.fullName} is already in ${course.code}.` }]);
      }

      const overridden = this.engine.evaluate(ctx).violations.filter((v) => v.severity === "block");
      const enrollment = Enrollment.create({ studentId: student.id, courseId: course.id, seatAvailable: true, now });
      await repos.enrollments.insert(enrollment);
      await repos.audit.record({
        actorUserId: input.actor.userId, action: "FORCE_ENROLL", entityType: "enrollment", entityId: enrollment.id,
        studentId: student.id, courseId: course.id,
        details: { code: course.code, reason, overriddenRules: overridden.map((v) => ({ code: v.code, message: v.message })) },
        now,
      });
      await repos.notifications.create({
        userId, type: "ENROLLMENT", title: `You were enrolled in ${course.code}`,
        body: `An administrator enrolled you in ${course.code} (${course.title}). Reason: ${reason}`.slice(0, 500), now,
      });
      return { enrollmentId: enrollment.id!, courseId: course.id, status: "ENROLLED", waitlistPosition: null, warnings: overridden };
    });
  }

  // ---------------------------------------------------------------------------
  // Grading
  // ---------------------------------------------------------------------------
  async recordGrade(input: { enrollmentId: number; grade: number; actor: Actor }): Promise<{ status: "COMPLETED" | "FAILED"; grade: number }> {
    if (input.actor.role === "student") throw new ForbiddenError("Students cannot enter grades.");
    return withTransaction(this.pool, async (conn) => {
      const repos = reposFor(conn);
      const enrollment = await repos.enrollments.findById(input.enrollmentId, { forUpdate: true });
      if (!enrollment) throw new NotFoundError("Enrollment");
      const course = (await repos.courses.findById(enrollment.courseId))!;

      // Instructors may grade only their own classes; admins may grade any.
      if (input.actor.role === "instructor" && course.instructorId !== input.actor.instructorId) {
        throw new ForbiddenError("You can only enter grades for your own classes.");
      }

      const now = this.clock();
      const status = enrollment.complete(input.grade, this.policy, now);
      await repos.enrollments.save(enrollment);
      await repos.audit.record({
        actorUserId: input.actor.userId, action: "GRADE", entityType: "enrollment", entityId: enrollment.id,
        studentId: enrollment.studentId, courseId: course.id,
        details: { code: course.code, grade: input.grade, result: status }, now,
      });
      const loaded = (await repos.students.findById(enrollment.studentId))!;
      await repos.notifications.create({
        userId: loaded.userId, type: "GRADE", title: `Grade posted for ${course.code}`,
        body: `Your grade for ${course.code} (${course.title}) is ${this.policy.display(input.grade)}.`, now,
      });
      return { status, grade: input.grade };
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** A student may only act for themselves; staff may act for anyone. Never trust a client-sent id. */
  private assertMayActFor(actor: Actor, studentId: number): void {
    if (actor.role === "student" && actor.studentId !== studentId) {
      throw new ForbiddenError("You can only enroll yourself.");
    }
  }

  /** Fixed lock order (student, then course) is what keeps deadlocks rare. */
  private async lockStudentThenCourse(repos: Repos, studentId: number, courseId: number): Promise<void> {
    if (!(await repos.students.lockById(studentId))) throw new NotFoundError("Student");
    if (!(await repos.courses.lockById(courseId))) throw new NotFoundError("Course");
  }

  private async loadSubjects(repos: Repos, studentId: number, courseId: number) {
    const loaded = await repos.students.findById(studentId);
    if (!loaded) throw new NotFoundError("Student");
    const course = await repos.courses.findById(courseId);
    if (!course) throw new NotFoundError("Course");
    const term = await repos.terms.findById(course.termId);
    if (!term) throw new NotFoundError("Term");
    return { student: loaded.student, userId: loaded.userId, course, term };
  }

  /** Everything the pure rules need, loaded once. `ignoreEnrollmentId` excludes the waitlisted row being promoted. */
  private async buildContext(
    repos: Repos, student: Student, course: Course, term: Term, now: Date,
    ignoreEnrollmentId?: number, pendingCourseCodes: readonly string[] = [],
  ): Promise<EnrollmentContext> {
    const active = await repos.enrollments.findActiveWithCourses(student.id, term.id);
    return {
      student,
      course,
      term,
      now,
      activeEnrollments: ignoreEnrollmentId ? active.filter((a) => a.enrollment.id !== ignoreEnrollmentId) : active,
      enrolledCount: await repos.enrollments.countByStatus(course.id, "ENROLLED"),
      holds: await repos.holds.findActiveByStudent(student.id),
      approvedOverloadUnits: await repos.overloads.approvedUnits(student.id, term.id),
      gradingPolicy: this.policy,
      pendingCourseCodes: pendingCourseCodes.filter((c) => c !== course.code),
    };
  }
}


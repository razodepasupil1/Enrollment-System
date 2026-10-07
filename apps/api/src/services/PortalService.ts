import type {
  CatalogItemDTO, CatalogQuery, CourseDTO, MyEnrollmentDTO, PageDTO, ProgressDTO, RecommendationDTO,
  NotificationsDTO, RegistrationFormDTO, ScheduleBlockDTO, ScheduleSuggestionDTO, ScheduleDTO, SummaryDTO, TranscriptDTO,
} from "@enroll/shared";
import { loadConfig } from "../config.js";
import type { Pool } from "../db/pool.js";
import type { Course } from "../domain/Course.js";
import { policyByName, type GradingPolicy } from "../domain/GradingPolicy.js";
import type { Term } from "../domain/Term.js";
import { dayIndex } from "../domain/format.js";
import { ConflictError, NotFoundError } from "../errors/index.js";
import { reposFor, type Repos } from "../repositories/index.js";
import { ReadRepository } from "../repositories/ReadRepository.js";
import { toCourseDTO, toTermDTO, toViolationDTO, iso } from "./dto.js";
import type { EnrollmentService } from "./EnrollmentService.js";
import { maximalIndependentSets } from "./suggest.js";

const ICS_DAY = { MON: "MO", TUE: "TU", WED: "WE", THU: "TH", FRI: "FR", SAT: "SA", SUN: "SU" } as const;
const JS_DAY = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 } as const;

/** Student-facing read models. Reads only (plus the overload request); all enrolling goes through EnrollmentService. */
export class PortalService {
  private readonly policy: GradingPolicy;
  private readonly clock: () => Date;

  constructor(
    private readonly pool: Pool,
    private readonly enrollments: EnrollmentService,
    opts: { gradingPolicy?: GradingPolicy; clock?: () => Date } = {},
  ) {
    this.policy = opts.gradingPolicy ?? policyByName(loadConfig().gradingPolicy);
    this.clock = opts.clock ?? (() => new Date());
  }

  private get repos(): Repos { return reposFor(this.pool); }
  private get read(): ReadRepository { return new ReadRepository(this.pool); }

  /** The requested term, else the current one, else the most recent (so a fresh install still renders). */
  async resolveTerm(termId?: number): Promise<Term> {
    const { terms } = this.repos;
    if (termId) {
      const t = await terms.findById(termId);
      if (!t) throw new NotFoundError("Term");
      return t;
    }
    const t = (await terms.findCurrent()) ?? (await terms.list())[0];
    if (!t) throw new NotFoundError("Term");
    return t;
  }

  async courseDTOs(courses: readonly Course[]): Promise<CourseDTO[]> {
    const extras = await this.read.describeCourses(courses.map((c) => c.id));
    return courses.flatMap((c) => {
      const x = extras.get(c.id);
      return x ? [toCourseDTO(c, x)] : [];
    });
  }

  // --- catalog --------------------------------------------------------------------
  async catalog(studentId: number | null, q: CatalogQuery): Promise<PageDTO<CatalogItemDTO> & { termId: number }> {
    const term = await this.resolveTerm(q.termId);
    const { ids, total } = await this.read.searchCourseIds({ ...q, termId: term.id });
    const found = await this.repos.courses.findByIds(ids);
    const ordered = ids.flatMap((id) => found.filter((c) => c.id === id));
    const dtos = await this.courseDTOs(ordered);

    const mine = new Map<number, CatalogItemDTO["mine"]>();
    if (studentId) {
      for (const a of await this.repos.enrollments.findActiveWithCourses(studentId, term.id)) {
        const st = a.enrollment.status as "ENROLLED" | "WAITLISTED";
        mine.set(a.course.id, {
          enrollmentId: a.enrollment.id!,
          status: st,
          waitlistPosition: st === "WAITLISTED" ? await this.repos.enrollments.waitlistPosition(a.enrollment.id!) : null,
        });
      }
    }
    return { items: dtos.map((d) => ({ ...d, mine: mine.get(d.id) ?? null })), total, page: q.page, pageSize: q.pageSize, termId: term.id };
  }

  async courseDetail(courseId: number, studentId: number | null): Promise<CatalogItemDTO & { prerequisiteTitles: Record<string, string> }> {
    const course = await this.repos.courses.findById(courseId);
    if (!course) throw new NotFoundError("Course");
    const [dto] = await this.courseDTOs([course]);
    let mine: CatalogItemDTO["mine"] = null;
    if (studentId) {
      const a = (await this.repos.enrollments.findActiveWithCourses(studentId, course.termId)).find((e) => e.course.id === courseId);
      if (a) {
        const st = a.enrollment.status as "ENROLLED" | "WAITLISTED";
        mine = { enrollmentId: a.enrollment.id!, status: st, waitlistPosition: st === "WAITLISTED" ? await this.repos.enrollments.waitlistPosition(a.enrollment.id!) : null };
      }
    }
    const titles = await this.read.titlesForCodes([...course.prerequisites.map((p) => p.code), ...course.corequisites]);
    return { ...dto!, mine, prerequisiteTitles: Object.fromEntries(titles) };
  }

  // --- my enrollments ----------------------------------------------------------------
  async myEnrollments(studentId: number, termId?: number): Promise<MyEnrollmentDTO[]> {
    const term = await this.resolveTerm(termId);
    const rows = (await this.read.studentEnrollmentRows(studentId, term.id)).filter((r) => r.status !== "DROPPED");
    const courses = await this.repos.courses.findByIds(rows.map((r) => r.courseId));
    const byId = new Map(courses.map((c) => [c.id, c]));
    const dtos = new Map((await this.courseDTOs(courses)).map((d) => [d.id, d]));
    const now = this.clock();

    const out: MyEnrollmentDTO[] = [];
    for (const r of rows) {
      const course = byId.get(r.courseId);
      const dto = dtos.get(r.courseId);
      if (!course || !dto) continue;
      const deadline = course.dropDeadline ?? term.dropDeadline;
      out.push({
        id: r.id,
        status: r.status,
        course: dto,
        waitlistPosition: r.status === "WAITLISTED" ? await this.repos.enrollments.waitlistPosition(r.id) : null,
        enrolledAt: iso(r.enrolledAt),
        waitlistedAt: iso(r.waitlistedAt),
        endedAt: iso(r.endedAt),
        grade: r.grade,
        gradeDisplay: r.grade === null ? null : this.policy.display(r.grade),
        dropPreview: r.status === "ENROLLED" ? (now <= deadline && !term.hasEnded(now) ? "DROPPED" : "WITHDRAWN") : r.status === "WAITLISTED" ? "DROPPED" : null,
      });
    }
    return out;
  }

  // --- timetable ---------------------------------------------------------------------
  async mySchedule(studentId: number, termId?: number): Promise<ScheduleDTO> {
    const term = await this.resolveTerm(termId);
    const active = await this.repos.enrollments.findActiveWithCourses(studentId, term.id);
    const blocks: ScheduleBlockDTO[] = [];
    active.forEach((a, i) => {
      for (const m of a.course.meetings) {
        blocks.push({
          enrollmentId: a.enrollment.id!, courseId: a.course.id, code: a.course.code, title: a.course.title,
          status: a.enrollment.status as "ENROLLED" | "WAITLISTED",
          day: m.day, startMin: m.startMin, endMin: m.endMin, room: a.course.room, colorIndex: i % 8,
        });
      }
    });
    blocks.sort((x, y) => dayIndex(x.day) - dayIndex(y.day) || x.startMin - y.startMin);

    const conflicts: ScheduleDTO["conflicts"] = [];
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]!.course;
        const b = active[j]!.course;
        if (a.conflictsWith(b)) conflicts.push({ a: a.code, b: b.code, summary: `${a.code} (${a.meetingSummary()}) overlaps ${b.code} (${b.meetingSummary()})` });
      }
    }
    return { termId: term.id, termName: term.name, blocks, conflicts };
  }

  /** Floating local times (no timezone): a class at 8:00 stays at 8:00 wherever the calendar is opened. */
  async scheduleIcs(studentId: number, termId?: number): Promise<string> {
    const term = await this.resolveTerm(termId);
    const active = (await this.repos.enrollments.findActiveWithCourses(studentId, term.id)).filter((a) => a.enrollment.status === "ENROLLED");
    const now = this.clock();
    const stamp = fmtUtc(now);
    const startBase = new Date(Math.max(now.getTime(), term.registrationOpensAt.getTime()));
    const until = `${ymd(term.endsAt)}T235959`;

    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Enrollment System//Timetable//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(`${term.name} timetable`)}`];
    for (const { enrollment, course } of active) {
      for (const m of course.meetings) {
        const first = nextWeekday(startBase, JS_DAY[m.day]);
        lines.push(
          "BEGIN:VEVENT",
          `UID:enr-${enrollment.id}-${m.day}-${m.startMin}@enrollment.local`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${ymd(first)}T${hhmm(m.startMin)}00`,
          `DTEND:${ymd(first)}T${hhmm(m.endMin)}00`,
          `RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAY[m.day]};UNTIL=${until}`,
          `SUMMARY:${esc(`${course.code} ${course.title}`)}`,
          ...(course.room ? [`LOCATION:${esc(course.room)}`] : []),
          "END:VEVENT",
        );
      }
    }
    lines.push("END:VCALENDAR");
    return lines.flatMap(fold).join("\r\n") + "\r\n";
  }

  // --- transcript / progress ------------------------------------------------------------
  async transcript(studentId: number): Promise<TranscriptDTO> {
    const loaded = await this.repos.students.findById(studentId);
    if (!loaded) throw new NotFoundError("Student");
    const rows = (await this.read.studentEnrollmentRows(studentId)).filter((r) => ["COMPLETED", "FAILED", "WITHDRAWN", "ENROLLED"].includes(r.status));
    const courses = await this.repos.courses.findByIds([...new Set(rows.map((r) => r.courseId))]);
    const cById = new Map(courses.map((c) => [c.id, c]));
    const terms = new Map((await this.repos.terms.list()).map((t) => [t.id, t]));

    const grouped = new Map<number, TranscriptDTO["terms"][number]>();
    for (const r of rows) {
      const c = cById.get(r.courseId);
      const t = terms.get(r.termId);
      if (!c || !t) continue;
      const g = grouped.get(t.id) ?? { termId: t.id, termName: t.name, courses: [], termGpa: null, unitsEarned: 0 };
      g.courses.push({
        code: c.code, title: c.title, units: c.units, status: r.status, grade: r.grade,
        display: r.status === "WITHDRAWN" ? "W" : r.status === "ENROLLED" ? "IP" : this.policy.display(r.grade ?? 0),
      });
      if (r.status === "COMPLETED") g.unitsEarned += c.units;
      grouped.set(t.id, g);
    }
    for (const g of grouped.values()) {
      g.termGpa = this.policy.average(g.courses.filter((c) => c.grade !== null).map((c) => ({ grade: c.grade!, units: c.units })));
    }
    const ordered = [...grouped.values()].sort((a, b) => (terms.get(b.termId)!.registrationOpensAt.getTime()) - (terms.get(a.termId)!.registrationOpensAt.getTime()));
    const gpa = loaded.student.gpa(this.policy);
    const passed = new Map<string, number>();
    for (const t of loaded.student.transcript) if (this.policy.isPass(t.grade)) passed.set(t.code, t.units);

    return {
      studentName: loaded.student.fullName, studentNumber: loaded.student.studentNumber, program: loaded.student.program,
      policyName: this.policy.name, terms: ordered, cumulativeGpa: gpa, standing: this.policy.standing(gpa),
      unitsEarned: [...passed.values()].reduce((s, n) => s + n, 0), generatedAt: this.clock().toISOString(),
    };
  }

  async progress(studentId: number): Promise<ProgressDTO> {
    const loaded = await this.repos.students.findById(studentId);
    if (!loaded) throw new NotFoundError("Student");
    const program = await this.read.programFor(studentId);
    if (!program) throw new NotFoundError("Program");
    const reqs = await this.read.programRequirements(program.id);
    const titles = await this.read.titlesForCodes(reqs.map((r) => r.code));
    const term = await this.resolveTerm();
    const active = await this.repos.enrollments.findActiveWithCourses(studentId, term.id);
    const inProgress = new Set(active.filter((a) => a.enrollment.status === "ENROLLED").map((a) => a.course.code));

    // Best passing grade for a code, in the direction of the active scale.
    const best = (code: string): number | null =>
      loaded.student.transcript
        .filter((t) => t.code === code && this.policy.isPass(t.grade))
        .reduce<number | null>((top, t) => (top === null || this.policy.isBetter(t.grade, top) ? t.grade : top), null);
    const requirements = reqs.map((r): ProgressDTO["requirements"][number] => {
      const done = loaded.student.hasCompleted(r.code, null, this.policy);
      const g = done ? best(r.code) : null;
      return {
        code: r.code, title: titles.get(r.code) ?? null, category: r.category,
        status: done ? "COMPLETED" : inProgress.has(r.code) ? "IN_PROGRESS" : "REMAINING",
        grade: g === null ? null : this.policy.display(g),
      };
    });
    const passed = new Map<string, number>();
    for (const t of loaded.student.transcript) if (this.policy.isPass(t.grade)) passed.set(t.code, t.units);
    const unitsEarned = [...passed.values()].reduce((s, n) => s + n, 0);
    return {
      programCode: program.code, programName: program.name, requiredUnits: program.requiredUnits,
      unitsEarned, unitsInProgress: loaded.student.totalUnits(active),
      percent: Math.min(100, Math.round((unitsEarned / program.requiredUnits) * 100)), requirements,
    };
  }

  // --- "What can I take next?" -------------------------------------------------------------
  async recommendations(studentId: number): Promise<RecommendationDTO[]> {
    const term = await this.resolveTerm();
    const program = await this.read.programFor(studentId);
    const required = new Set((program ? await this.read.programRequirements(program.id) : []).map((r) => r.code));
    const courses = await this.repos.courses.findByTerm(term.id);
    const verdicts = await this.enrollments.validateMany(studentId, courses.map((c) => c.id));
    const dtos = new Map((await this.courseDTOs(courses)).map((d) => [d.id, d]));

    return courses
      .flatMap((c): RecommendationDTO[] => {
        const v = verdicts[c.id];
        if (!v || v.outcome === "BLOCKED") return [];
        return [{
          course: dtos.get(c.id)!, requiredByProgram: required.has(c.code),
          outcome: v.outcome, warnings: v.violations.filter((x) => x.severity === "warn").map(toViolationDTO),
        }];
      })
      .sort((a, b) => Number(b.requiredByProgram) - Number(a.requiredByProgram) || Number(a.outcome === "WAITLIST") - Number(b.outcome === "WAITLIST") || a.course.code.localeCompare(b.course.code))
      .slice(0, 12);
  }

  // --- dashboard / forms ------------------------------------------------------------------------
  async summary(studentId: number): Promise<SummaryDTO> {
    const loaded = await this.repos.students.findById(studentId);
    if (!loaded) throw new NotFoundError("Student");
    const term = await this.resolveTerm();
    const active = await this.repos.enrollments.findActiveWithCourses(studentId, term.id);
    const overload = await this.repos.overloads.approvedUnits(studentId, term.id);
    const holds = await this.repos.holds.findActiveByStudent(studentId);
    const s = loaded.student;
    return {
      student: { id: s.id, fullName: s.fullName, studentNumber: s.studentNumber, program: s.program, yearLevel: s.yearLevel, standing: s.classStanding(), maxUnits: s.maxUnits },
      term: toTermDTO(term, this.clock()),
      enrolledCount: active.filter((a) => a.enrollment.status === "ENROLLED").length,
      waitlistedCount: active.filter((a) => a.enrollment.status === "WAITLISTED").length,
      unitsUsed: s.totalUnits(active), unitsLimit: s.maxUnits + overload, approvedOverloadUnits: overload,
      gpa: s.gpa(this.policy), activeHolds: holds.map((h) => ({ id: h.id, type: h.type, reason: h.reason })),
      pendingOverloadRequests: await this.read.pendingOverloadCount(studentId),
    };
  }

  async registrationForm(studentId: number, termId?: number): Promise<RegistrationFormDTO> {
    const loaded = await this.repos.students.findById(studentId);
    if (!loaded) throw new NotFoundError("Student");
    const term = await this.resolveTerm(termId);
    const active = await this.repos.enrollments.findActiveWithCourses(studentId, term.id);
    const extras = await this.read.describeCourses(active.map((a) => a.course.id));
    const s = loaded.student;
    return {
      student: { fullName: s.fullName, studentNumber: s.studentNumber, program: s.program, yearLevel: s.yearLevel, email: s.email },
      term: toTermDTO(term, this.clock()),
      courses: active.map((a) => ({
        code: a.course.code, title: a.course.title, units: a.course.units, schedule: a.course.meetingSummary(), room: a.course.room,
        instructor: extras.get(a.course.id)?.instructorName ?? null, status: a.enrollment.status as "ENROLLED" | "WAITLISTED",
      })),
      totalUnits: s.totalUnits(active), generatedAt: this.clock().toISOString(),
    };
  }

  // --- schedule suggester ---------------------------------------------------------------------------------
  /** Schedule-only analysis of a cart: which courses can be taken together without overlapping. Other rules are checked on submit. */
  async suggestSchedule(studentId: number, courseIds: readonly number[]): Promise<ScheduleSuggestionDTO> {
    const unique = [...new Set(courseIds)];
    const courses = (await this.repos.courses.findByIds(unique)).sort((a, b) => unique.indexOf(a.id) - unique.indexOf(b.id));
    const term = courses[0] ? courses[0].termId : (await this.resolveTerm()).id;
    const current = (await this.repos.enrollments.findActiveWithCourses(studentId, term)).filter((a) => a.enrollment.status === "ENROLLED").map((a) => a.course);

    const blockedByCurrent: ScheduleSuggestionDTO["blockedByCurrent"] = [];
    const candidates: Course[] = [];
    for (const c of courses) {
      const clash = current.filter((cur) => cur.id !== c.id && c.conflictsWith(cur)).map((cur) => cur.code);
      if (clash.length) blockedByCurrent.push({ code: c.code, with: clash });
      else if (!current.some((cur) => cur.id === c.id)) candidates.push(c);
    }

    const conflicts: ScheduleSuggestionDTO["conflicts"] = [];
    const adj = candidates.map(() => 0);
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i]!;
        const b = candidates[j]!;
        if (!a.conflictsWith(b)) continue;
        adj[i]! |= 1 << j;
        adj[j]! |= 1 << i;
        conflicts.push({ a: a.code, b: b.code, summary: `${a.code} (${a.meetingSummary()}) overlaps ${b.code} (${b.meetingSummary()})` });
      }
    }

    const combos = maximalIndependentSets(candidates.length, adj)
      .map((idx) => ({ codes: idx.map((i) => candidates[i]!.code), units: idx.reduce((u, i) => u + candidates[i]!.units, 0) }))
      .sort((x, y) => y.units - x.units || y.codes.length - x.codes.length || x.codes.join().localeCompare(y.codes.join()))
      .slice(0, 5);
    const biggest = Math.max(0, ...combos.map((c) => c.codes.length));
    return {
      conflicts, blockedByCurrent, combinations: combos,
      conflictFree: conflicts.length === 0 && blockedByCurrent.length === 0,
      minimalRemovals: candidates.length - biggest,
    };
  }

  // --- notifications (any signed-in user) -----------------------------------------------------------
  async notifications(userId: number): Promise<NotificationsDTO> {
    const n = await this.read.notifications(userId);
    return { items: n.items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })), unreadCount: n.unreadCount };
  }

  async markNotificationRead(id: number, userId: number): Promise<void> {
    await this.read.markNotificationRead(id, userId);
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await this.read.markAllNotificationsRead(userId);
  }

  async requestOverload(studentId: number, input: { extraUnits: number; reason: string }): Promise<{ id: number }> {
    const term = await this.resolveTerm();
    if (await this.read.pendingOverloadCount(studentId) > 0) {
      throw new ConflictError("You already have a pending overload request. Wait for it to be decided.");
    }
    const id = await this.read.createOverloadRequest({ studentId, termId: term.id, ...input, now: this.clock() });
    return { id };
  }
}

// --- small ICS helpers ---------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}${pad(min % 60)}`;
const fmtUtc = (d: Date) => `${ymd(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

function nextWeekday(from: Date, jsDay: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((jsDay - d.getUTCDay() + 7) % 7));
  return d;
}

/** RFC 5545: lines longer than 75 octets are folded with CRLF + a space. */
function fold(line: string): string[] {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out;
}

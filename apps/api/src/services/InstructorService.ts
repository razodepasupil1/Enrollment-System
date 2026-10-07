import type { CourseDTO, RosterEntryDTO } from "@enroll/shared";
import type { Pool } from "../db/pool.js";
import { policyByName, type GradingPolicy } from "../domain/GradingPolicy.js";
import { loadConfig } from "../config.js";
import { ForbiddenError, NotFoundError } from "../errors/index.js";
import { reposFor } from "../repositories/index.js";
import { ReadRepository } from "../repositories/ReadRepository.js";
import type { PortalService } from "./PortalService.js";
import type { Actor } from "./types.js";

export class InstructorService {
  private readonly policy: GradingPolicy;
  constructor(private readonly pool: Pool, private readonly portal: PortalService, policy?: GradingPolicy) {
    this.policy = policy ?? policyByName(loadConfig().gradingPolicy);
  }

  async myCourses(instructorId: number, termId?: number): Promise<CourseDTO[]> {
    const term = await this.portal.resolveTerm(termId);
    const ids = await new ReadRepository(this.pool).instructorCourseIds(instructorId, term.id);
    return this.portal.courseDTOs(await reposFor(this.pool).courses.findByIds(ids));
  }

  /** Instructors see only their own classes; admins see any. */
  async roster(actor: Actor, courseId: number): Promise<{ course: CourseDTO; entries: RosterEntryDTO[] }> {
    const read = new ReadRepository(this.pool);
    const owner = await read.courseInstructorId(courseId);
    if (owner === undefined) throw new NotFoundError("Course");
    if (actor.role === "instructor" && owner !== actor.instructorId) throw new ForbiddenError("You can only view your own classes.");

    const course = (await reposFor(this.pool).courses.findById(courseId))!;
    const [dto] = await this.portal.courseDTOs([course]);
    let waitPos = 0;
    const entries = (await read.roster(courseId)).map((r): RosterEntryDTO => ({
      ...r,
      gradeDisplay: r.grade === null ? null : this.policy.display(r.grade),
      waitlistPosition: r.status === "WAITLISTED" ? ++waitPos : null, // rows arrive in waitlist order
    }));
    return { course: dto!, entries };
  }
}

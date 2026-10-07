import type { Pool } from "../db/pool.js";
import type { Config } from "../config.js";
import { AdminService } from "../services/AdminService.js";
import { AuthService } from "../services/AuthService.js";
import { EnrollmentService } from "../services/EnrollmentService.js";
import { InstructorService } from "../services/InstructorService.js";
import { PortalService } from "../services/PortalService.js";

/** The object graph, built once per app. Routes receive this instead of constructing services themselves. */
export interface Services {
  config: Config;
  auth: AuthService;
  enrollments: EnrollmentService;
  portal: PortalService;
  instructor: InstructorService;
  admin: AdminService;
}

export function buildServices(pool: Pool, config: Config, clock?: () => Date): Services {
  const enrollments = new EnrollmentService(pool, clock ? { clock } : {});
  const portal = new PortalService(pool, enrollments, clock ? { clock } : {});
  return {
    config,
    auth: new AuthService(pool, config),
    enrollments,
    portal,
    instructor: new InstructorService(pool, portal),
    admin: new AdminService(pool, enrollments, portal, { config, ...(clock ? { clock } : {}) }),
  };
}

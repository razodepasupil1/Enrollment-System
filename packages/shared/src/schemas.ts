import { z } from "zod";

// Request validation, shared so the web forms and the API enforce the SAME rules.

export const idParam = z.coerce.number().int().positive();

export const loginSchema = z.object({
  email: z.string().trim().min(3).max(190),
  password: z.string().min(1).max(200),
});

export const demoLoginSchema = z.object({ email: z.string().trim().min(3).max(190) });

export const enrollSchema = z.object({
  courseId: z.number().int().positive(),
  allowWaitlist: z.boolean().optional(),
});

export const validateSchema = z.object({
  courseIds: z.array(z.number().int().positive()).min(1).max(60),
  /** Other courses in the cart, so a lecture/lab pair validates together. */
  cartCourseIds: z.array(z.number().int().positive()).max(60).optional(),
});

export const batchSchema = z.object({
  courseIds: z.array(z.number().int().positive()).min(1).max(20),
});

export const suggestSchema = z.object({
  courseIds: z.array(z.number().int().positive()).min(2, "Add at least two courses to compare").max(12, "Compare at most 12 courses at a time"),
});

export const forceEnrollSchema = z.object({
  studentId: z.number().int().positive(),
  courseId: z.number().int().positive(),
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(300),
});

export const gradeSchema = z.object({ grade: z.number().min(0).max(5) });

export const overloadRequestSchema = z.object({
  extraUnits: z.number().int().min(1).max(9),
  reason: z.string().trim().min(10, "Explain your request in at least 10 characters").max(500),
});

export const overloadDecisionSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(255).optional(),
});

export const holdSchema = z.object({
  studentId: z.number().int().positive(),
  type: z.enum(["FINANCIAL", "ADVISING", "ACADEMIC"]),
  reason: z.string().trim().min(3).max(255),
});

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(3).max(1000),
});

const meeting = z
  .object({
    day: z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]),
    startMin: z.number().int().min(0).max(1439),
    endMin: z.number().int().min(1).max(1440),
  })
  .refine((m) => m.endMin > m.startMin, { message: "A meeting must end after it starts", path: ["endMin"] });

export const courseSchema = z.object({
  code: z.string().trim().min(2).max(20),
  termId: z.number().int().positive(),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).default(""),
  units: z.number().int().min(1).max(12),
  capacity: z.number().int().min(0).max(1000),
  departmentId: z.number().int().positive(),
  instructorId: z.number().int().positive().nullable(),
  room: z.string().trim().max(40).nullable(),
  dropDeadline: z.string().datetime().nullable().default(null),
  meetings: z.array(meeting).max(7).default([]),
  prerequisites: z.array(z.object({ code: z.string().trim().min(2).max(20), minGrade: z.number().min(0).max(5).nullable() })).max(8).default([]),
  corequisites: z.array(z.string().trim().min(2).max(20)).max(4).default([]),
});

export const studentCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(100),
  studentNumber: z.string().trim().min(3).max(20),
  programId: z.number().int().positive(),
  yearLevel: z.number().int().min(1).max(8),
  maxUnits: z.number().int().min(1).max(40).default(21),
});

export const studentUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  programId: z.number().int().positive(),
  yearLevel: z.number().int().min(1).max(8),
  maxUnits: z.number().int().min(1).max(40),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "GRADUATED"]),
});

export const instructorCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(100),
  departmentId: z.number().int().positive(),
  title: z.string().trim().min(2).max(60).default("Instructor"),
});

export const instructorUpdateSchema = instructorCreateSchema.omit({ email: true, password: true });

const isoDate = z.string().datetime();
export const termSchema = z
  .object({
    name: z.string().trim().min(3).max(60),
    isCurrent: z.boolean().default(false),
    registrationOpensAt: isoDate,
    registrationClosesAt: isoDate,
    dropDeadline: isoDate,
    endsAt: isoDate,
  })
  .refine((t) => new Date(t.registrationClosesAt) > new Date(t.registrationOpensAt), {
    message: "Registration must close after it opens",
    path: ["registrationClosesAt"],
  })
  .refine((t) => new Date(t.dropDeadline) <= new Date(t.endsAt), {
    message: "The drop deadline must be before the term ends",
    path: ["dropDeadline"],
  });

export const rushSchema = z.object({
  courseId: z.number().int().positive(),
  count: z.number().int().min(2).max(60),
});

export const catalogQuerySchema = z.object({
  termId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(60).optional(),
  department: z.string().trim().max(10).optional(),
  day: z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]).optional(),
  availability: z.enum(["all", "open", "full"]).default("all"),
  minUnits: z.coerce.number().int().min(1).max(12).optional(),
  maxUnits: z.coerce.number().int().min(1).max(12).optional(),
  sort: z.enum(["code", "title", "units", "seats", "fill"]).default("code"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

export const auditQuerySchema = z.object({
  action: z.string().trim().max(40).optional(),
  studentId: z.coerce.number().int().positive().optional(),
  courseId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export type CourseInput = z.infer<typeof courseSchema>;
export type TermInput = z.infer<typeof termSchema>;

import { Router } from "express";
import {
  announcementSchema, auditQuerySchema, courseSchema, forceEnrollSchema, gradeSchema, holdSchema, idParam,
  instructorCreateSchema, instructorUpdateSchema, overloadDecisionSchema, rushSchema, studentCreateSchema,
  studentUpdateSchema, termSchema,
} from "@enroll/shared";
import { z } from "zod";
import { ForbiddenError } from "../../errors/index.js";
import { actorOf } from "../../services/AuthService.js";
import { toViolationDTO } from "../../services/dto.js";
import { requireRole } from "../middleware.js";
import type { Services } from "../services.js";

const termQuery = z.object({ termId: z.coerce.number().int().positive().optional() });
const listQuery = z.object({ q: z.string().trim().max(60).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });

export function staffRoutes(s: Services): Router {
  const r = Router();

  // --- instructor (admins may use the same endpoints) ------------------------------------------------
  const inst = Router();
  inst.use(requireRole("instructor", "admin"));
  inst.get("/courses", async (req, res) => {
    const { termId } = termQuery.parse(req.query);
    const id = req.user!.instructorId;
    if (!id) throw new ForbiddenError("Only instructors have classes.");
    res.json({ courses: await s.instructor.myCourses(id, termId) });
  });
  inst.get("/courses/:id/roster", async (req, res) => {
    res.json(await s.instructor.roster(actorOf(req.user!), idParam.parse(req.params.id)));
  });
  inst.put("/enrollments/:id/grade", async (req, res) => {
    const { grade } = gradeSchema.parse(req.body);
    res.json(await s.enrollments.recordGrade({ enrollmentId: idParam.parse(req.params.id), grade, actor: actorOf(req.user!) }));
  });
  r.use("/instructor", inst);

  // --- admin ----------------------------------------------------------------------------------------------
  const a = Router();
  a.use(requireRole("admin"));
  const actor = (req: { user?: Parameters<typeof actorOf>[0] }) => actorOf(req.user!);

  a.get("/students", async (req, res) => {
    const { q, page, pageSize } = listQuery.parse(req.query);
    res.json({ ...(await s.admin.students(q, page, pageSize)), page, pageSize });
  });
  a.post("/students", async (req, res) => { res.status(201).json(await s.admin.createStudent(studentCreateSchema.parse(req.body), actor(req))); });
  a.put("/students/:id", async (req, res) => {
    await s.admin.updateStudent(idParam.parse(req.params.id), studentUpdateSchema.parse(req.body), actor(req));
    res.json({ ok: true });
  });

  a.get("/instructors", async (_req, res) => { res.json({ instructors: await s.admin.instructors() }); });
  a.post("/instructors", async (req, res) => { res.status(201).json(await s.admin.createInstructor(instructorCreateSchema.parse(req.body), actor(req))); });
  a.put("/instructors/:id", async (req, res) => {
    await s.admin.updateInstructor(idParam.parse(req.params.id), instructorUpdateSchema.parse(req.body), actor(req));
    res.json({ ok: true });
  });

  a.post("/courses", async (req, res) => { res.status(201).json(await s.admin.createCourse(courseSchema.parse(req.body), actor(req))); });
  a.put("/courses/:id", async (req, res) => { res.json(await s.admin.updateCourse(idParam.parse(req.params.id), courseSchema.parse(req.body), actor(req))); });
  a.delete("/courses/:id", async (req, res) => { await s.admin.deleteCourse(idParam.parse(req.params.id), actor(req)); res.json({ ok: true }); });
  a.get("/courses/:id/roster", async (req, res) => { res.json(await s.instructor.roster(actor(req), idParam.parse(req.params.id))); });

  a.post("/terms", async (req, res) => { res.status(201).json(await s.admin.createTerm(termSchema.parse(req.body), actor(req))); });
  a.put("/terms/:id", async (req, res) => {
    await s.admin.updateTerm(idParam.parse(req.params.id), termSchema.parse(req.body), actor(req));
    res.json({ ok: true });
  });

  /** Override: skips the rules (never capacity), requires a reason, and is written to the audit log. */
  a.post("/enrollments/force", async (req, res) => {
    const body = forceEnrollSchema.parse(req.body);
    const out = await s.enrollments.forceEnroll({ ...body, actor: actor(req) });
    res.status(201).json({ ...out, warnings: out.warnings.map(toViolationDTO) });
  });

  a.get("/holds", async (req, res) => { res.json({ holds: await s.admin.holds(req.query.active === "1") }); });
  a.post("/holds", async (req, res) => { res.status(201).json(await s.admin.placeHold(holdSchema.parse(req.body), actor(req))); });
  a.post("/holds/:id/clear", async (req, res) => { await s.admin.clearHold(idParam.parse(req.params.id), actor(req)); res.json({ ok: true }); });

  a.get("/overload-requests", async (req, res) => {
    const status = z.enum(["PENDING", "APPROVED", "REJECTED"]).optional().parse(req.query.status);
    res.json({ requests: await s.admin.overloads(status) });
  });
  a.post("/overload-requests/:id/decision", async (req, res) => {
    const { approve, note } = overloadDecisionSchema.parse(req.body);
    await s.admin.decideOverload(idParam.parse(req.params.id), approve, note, actor(req));
    res.json({ ok: true });
  });

  a.post("/announcements", async (req, res) => { res.status(201).json(await s.admin.announce(announcementSchema.parse(req.body), actor(req))); });
  a.get("/audit", async (req, res) => {
    const f = auditQuerySchema.parse(req.query);
    res.json({ ...(await s.admin.audit({ page: f.page, pageSize: f.pageSize, ...(f.action ? { action: f.action } : {}), ...(f.studentId ? { studentId: f.studentId } : {}), ...(f.courseId ? { courseId: f.courseId } : {}) })), page: f.page, pageSize: f.pageSize });
  });
  a.get("/analytics", async (req, res) => { res.json(await s.admin.analytics(termQuery.parse(req.query).termId)); });
  a.get("/export/enrollments.csv", async (req, res) => {
    const csv = await s.admin.exportEnrollmentsCsv(termQuery.parse(req.query).termId);
    res.type("text/csv; charset=utf-8").set("Content-Disposition", 'attachment; filename="enrollments.csv"').send(csv);
  });

  // Demo-only (also gated by DEMO_MODE inside the service, so a misconfigured route cannot expose it).
  a.post("/simulate/rush", async (req, res) => { res.json(await s.admin.simulateRush(rushSchema.parse(req.body), actor(req))); });
  a.post("/simulate/reset", async (req, res) => { res.json(await s.admin.resetRush(actor(req))); });

  r.use("/admin", a);
  return r;
}

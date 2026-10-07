import { Router } from "express";
import {
  batchSchema, enrollSchema, idParam, overloadRequestSchema, suggestSchema, validateSchema,
  type BatchItemResultDTO, type DropResultDTO, type EnrollResultDTO, type ValidationDTO,
} from "@enroll/shared";
import { z } from "zod";
import type { Violation } from "../../domain/types.js";
import { actorOf } from "../../services/AuthService.js";
import { toViolationDTO } from "../../services/dto.js";
import { requireRole, studentId } from "../middleware.js";
import type { Services } from "../services.js";

const termQuery = z.object({ termId: z.coerce.number().int().positive().optional() });
const vDTO = (v: readonly Violation[]) => v.map(toViolationDTO);

export function studentRoutes(s: Services): Router {
  const r = Router();

  // --- enrolling (students act only for themselves; the student id comes from the session) ---
  r.post("/enrollments", requireRole("student"), async (req, res) => {
    const body = enrollSchema.parse(req.body);
    const out = await s.enrollments.enroll({
      studentId: studentId(req), courseId: body.courseId, actor: actorOf(req.user!),
      ...(body.allowWaitlist === undefined ? {} : { allowWaitlist: body.allowWaitlist }),
    });
    const dto: EnrollResultDTO = { ...out, warnings: vDTO(out.warnings) };
    res.status(201).json(dto);
  });

  /** Dry run: same rules, no writes. Accepts the cart so a lecture/lab pair validates together. */
  r.post("/enrollments/validate", requireRole("student"), async (req, res) => {
    const body = validateSchema.parse(req.body);
    const raw = await s.enrollments.validateMany(studentId(req), body.courseIds, body.cartCourseIds ?? []);
    const results: Record<number, ValidationDTO> = {};
    for (const [id, v] of Object.entries(raw)) results[Number(id)] = { outcome: v.outcome, violations: vDTO(v.violations), wouldBeWaitlistPosition: v.wouldBeWaitlistPosition };
    res.json({ results });
  });

  r.post("/enrollments/batch", requireRole("student"), async (req, res) => {
    const body = batchSchema.parse(req.body);
    const items = await s.enrollments.enrollBatch({ studentId: studentId(req), courseIds: body.courseIds, actor: actorOf(req.user!) });
    const results: BatchItemResultDTO[] = items.map((i) => ({ ...i, error: i.error && { ...i.error, violations: vDTO(i.error.violations) } }));
    res.json({ results });
  });

  /** Which cart courses can be taken together, and the best conflict-free combinations. Schedule only; nothing is written. */
  r.post("/enrollments/suggest", requireRole("student"), async (req, res) => {
    const { courseIds } = suggestSchema.parse(req.body);
    res.json(await s.portal.suggestSchedule(studentId(req), courseIds));
  });

  r.delete("/enrollments/:id", requireRole("student", "admin"), async (req, res) => {
    const out = await s.enrollments.drop({ enrollmentId: idParam.parse(req.params.id), actor: actorOf(req.user!) });
    const dto: DropResultDTO = { ...out, promotions: out.promotions.map((p) => ({ ...p, reasons: vDTO(p.reasons) })) };
    res.json(dto);
  });

  // --- the student's own pages -------------------------------------------------------------------
  const me = Router();
  me.use(requireRole("student"));
  me.get("/summary", async (req, res) => { res.json(await s.portal.summary(studentId(req))); });
  me.get("/enrollments", async (req, res) => {
    const { termId } = termQuery.parse(req.query);
    res.json({ enrollments: await s.portal.myEnrollments(studentId(req), termId) });
  });
  me.get("/schedule", async (req, res) => {
    const { termId } = termQuery.parse(req.query);
    res.json(await s.portal.mySchedule(studentId(req), termId));
  });
  me.get("/schedule.ics", async (req, res) => {
    const { termId } = termQuery.parse(req.query);
    const ics = await s.portal.scheduleIcs(studentId(req), termId);
    res.type("text/calendar; charset=utf-8").set("Content-Disposition", 'attachment; filename="timetable.ics"').send(ics);
  });
  me.get("/transcript", async (req, res) => { res.json(await s.portal.transcript(studentId(req))); });
  me.get("/progress", async (req, res) => { res.json(await s.portal.progress(studentId(req))); });
  me.get("/recommendations", async (req, res) => { res.json({ recommendations: await s.portal.recommendations(studentId(req)) }); });
  me.get("/registration-form", async (req, res) => {
    const { termId } = termQuery.parse(req.query);
    res.json(await s.portal.registrationForm(studentId(req), termId));
  });
  me.get("/overload-requests", async (req, res) => { res.json({ requests: await s.admin.overloads(undefined, studentId(req)) }); });
  me.post("/overload-requests", async (req, res) => {
    const body = overloadRequestSchema.parse(req.body);
    res.status(201).json(await s.portal.requestOverload(studentId(req), body));
  });
  r.use("/me", me);
  return r;
}

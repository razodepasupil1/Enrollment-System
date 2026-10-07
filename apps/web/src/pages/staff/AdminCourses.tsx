import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { courseSchema, type CatalogItemDTO, type Day } from "@enroll/shared";
import { DataTable, type Column } from "@/components/DataTable";
import { SeatStrip } from "@/components/SeatStrip";
import { Button, ConfirmDialog, ErrorState, Field, Input, LoadingRows, Modal, PageHeader, Pagination, Select, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fromLocalInput, minutesToTime, timeToMinutes, toLocalInput } from "@/lib/format";
import { useAdminInstructors, useCourses, useMeta } from "@/lib/queries";
import { useTerm } from "@/lib/state";

const DAYS: Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

interface FormValues {
  code: string; title: string; description: string; units: number; capacity: number; departmentId: number;
  instructorId: string; room: string; dropDeadline: string;
  meetings: Array<{ day: Day; start: string; end: string }>;
  prerequisites: Array<{ code: string; minGrade: string }>;
  corequisites: string;
}

function CourseForm({ course, termId, onClose }: { course: CatalogItemDTO | null; termId: number; onClose: () => void }) {
  const meta = useMeta();
  const instructors = useAdminInstructors();
  const qc = useQueryClient();
  const [errors, setErrors] = useState<string[]>([]);
  const deptId = meta.data?.departments.find((d) => d.code === course?.department)?.id ?? meta.data?.departments[0]?.id ?? 0;
  const { register, control, handleSubmit } = useForm<FormValues>({
    defaultValues: {
      code: course?.code ?? "", title: course?.title ?? "", description: course?.description ?? "", units: course?.units ?? 3,
      capacity: course?.capacity ?? 30, departmentId: deptId, instructorId: course?.instructorId ? String(course.instructorId) : "",
      room: course?.room ?? "", dropDeadline: toLocalInput(course?.dropDeadline),
      meetings: course?.meetings.map((m) => ({ day: m.day, start: minutesToTime(m.startMin), end: minutesToTime(m.endMin) })) ?? [],
      prerequisites: course?.prerequisites.map((p) => ({ code: p.code, minGrade: p.minGrade === null ? "" : String(p.minGrade) })) ?? [],
      corequisites: course?.corequisites.join(", ") ?? "",
    },
  });
  const meetings = useFieldArray({ control, name: "meetings" });
  const prereqs = useFieldArray({ control, name: "prerequisites" });

  const save = useMutation({
    mutationFn: (payload: unknown) => api<{ promotions?: number }>(course ? `/admin/courses/${course.id}` : "/admin/courses", { method: course ? "PUT" : "POST", body: payload }),
    onSuccess: async (r) => {
      toast.success(course ? "Course updated." : "Course created.");
      if (r.promotions) toast.info(`${r.promotions} waitlisted ${r.promotions === 1 ? "student was" : "students were"} enrolled into the new seats.`);
      await qc.invalidateQueries({ queryKey: ["courses"] });
      await qc.invalidateQueries({ queryKey: ["analytics"] });
      onClose();
    },
    onError: (e) => setErrors([errorMessage(e)]),
  });

  const onSubmit = (v: FormValues) => {
    const payload = {
      code: v.code, termId: course?.termId ?? termId, title: v.title, description: v.description, units: Number(v.units), capacity: Number(v.capacity),
      departmentId: Number(v.departmentId), instructorId: v.instructorId ? Number(v.instructorId) : null, room: v.room.trim() || null,
      dropDeadline: v.dropDeadline ? fromLocalInput(v.dropDeadline) : null,
      meetings: v.meetings.map((m) => ({ day: m.day, startMin: timeToMinutes(m.start), endMin: timeToMinutes(m.end) })),
      prerequisites: v.prerequisites.filter((p) => p.code.trim()).map((p) => ({ code: p.code.trim().toUpperCase(), minGrade: p.minGrade === "" ? null : Number(p.minGrade) })),
      corequisites: v.corequisites.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
    };
    // The same schema the API enforces: problems show here first, in plain words.
    const parsed = courseSchema.safeParse(payload);
    if (!parsed.success) return setErrors(parsed.error.issues.map((i) => `${String(i.path.join(" > ")) || "form"}: ${i.message}`));
    setErrors([]);
    save.mutate(parsed.data);
  };

  return (
    <Modal wide open onOpenChange={(o) => !o && onClose()} title={course ? `Edit ${course.code}` : "New course offering"}
      description={course ? "A course's code and term cannot be changed. Prerequisites apply to this course code in every term." : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={handleSubmit(onSubmit)} loading={save.isPending}>{course ? "Save changes" : "Create course"}</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={(e) => { e.preventDefault(); void handleSubmit(onSubmit)(); }}>
        <Field label="Course code">{(a) => <Input {...a} disabled={!!course} {...register("code")} />}</Field>
        <Field label="Title">{(a) => <Input {...a} {...register("title")} />}</Field>
        <div className="sm:col-span-2"><Field label="Description">{(a) => <Textarea {...a} {...register("description")} />}</Field></div>
        <Field label="Units">{(a) => <Input {...a} type="number" min={1} max={12} {...register("units", { valueAsNumber: true })} />}</Field>
        <Field label="Capacity (seats)" hint="Cannot go below the number already enrolled.">{(a) => <Input {...a} type="number" min={0} {...register("capacity", { valueAsNumber: true })} />}</Field>
        <Field label="Department">{(a) => <Select {...a} {...register("departmentId", { valueAsNumber: true })}>{meta.data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <Field label="Instructor">{(a) => <Select {...a} {...register("instructorId")}><option value="">To be announced</option>{instructors.data?.instructors.map((i) => <option key={i.id} value={i.id}>{i.fullName}</option>)}</Select>}</Field>
        <Field label="Room">{(a) => <Input {...a} {...register("room")} />}</Field>
        <Field label="Own drop deadline (optional)" hint="Leave empty to use the term's deadline.">{(a) => <Input {...a} type="datetime-local" {...register("dropDeadline")} />}</Field>

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Meeting times</legend>
          {meetings.fields.map((f, i) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2">
              <Select aria-label={`Day for meeting ${i + 1}`} className="w-32" {...register(`meetings.${i}.day`)}>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</Select>
              <Input aria-label={`Start time for meeting ${i + 1}`} type="time" className="w-32" {...register(`meetings.${i}.start`)} />
              <span aria-hidden>to</span>
              <Input aria-label={`End time for meeting ${i + 1}`} type="time" className="w-32" {...register(`meetings.${i}.end`)} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove meeting ${i + 1}`} onClick={() => meetings.remove(i)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => meetings.append({ day: "MON", start: "09:00", end: "10:30" })}><Plus className="h-4 w-4" aria-hidden />Add a meeting</Button>
        </fieldset>

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Prerequisites</legend>
          {prereqs.fields.map((f, i) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2">
              <Input aria-label={`Prerequisite ${i + 1} code`} placeholder="CS101" className="w-36" {...register(`prerequisites.${i}.code`)} />
              <Input aria-label={`Minimum grade for prerequisite ${i + 1}`} placeholder="Any passing grade" type="number" step="0.25" className="w-44" {...register(`prerequisites.${i}.minGrade`)} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove prerequisite ${i + 1}`} onClick={() => prereqs.remove(i)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => prereqs.append({ code: "", minGrade: "" })}><Plus className="h-4 w-4" aria-hidden />Add a prerequisite</Button>
        </fieldset>
        <div className="sm:col-span-2"><Field label="Corequisites (course codes, separated by commas)">{(a) => <Input {...a} placeholder="PHYS101L" {...register("corequisites")} />}</Field></div>

        {errors.length > 0 && <ul role="alert" className="space-y-1 rounded-md bg-full-bg px-3 py-2 text-sm text-full sm:col-span-2">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </form>
    </Modal>
  );
}

export function AdminCourses() {
  const { termId, term, isCurrent } = useTerm();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const courses = useCourses({ ...(termId ? { termId } : {}), ...(q ? { q } : {}), page, pageSize: 12 });
  const [editing, setEditing] = useState<CatalogItemDTO | "new" | null>(null);
  const [deleting, setDeleting] = useState<CatalogItemDTO | null>(null);
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: number) => api(`/admin/courses/${id}`, { method: "DELETE" }),
    onSuccess: async () => { toast.success("Course deleted."); await qc.invalidateQueries({ queryKey: ["courses"] }); },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setDeleting(null),
  });

  const columns: Column<CatalogItemDTO>[] = [
    { key: "course", header: "Course", cell: (c) => <span><strong>{c.code}</strong> {c.title}<span className="block text-sm text-muted">{c.units} {c.units === 1 ? "unit" : "units"}, {c.departmentName}</span></span> },
    { key: "when", header: "Schedule", cell: (c) => <span>{c.meetingSummary}<span className="block text-sm text-muted">{c.room ?? "No room"}, {c.instructorName ?? "No instructor"}</span></span> },
    { key: "seats", header: "Seats", cell: (c) => <SeatStrip capacity={c.capacity} enrolled={c.enrolledCount} waitlisted={c.waitlistedCount} availability={c.availability} /> },
    { key: "act", header: "Actions", cell: (c) => (
      <div className="flex flex-wrap justify-end gap-1.5 md:justify-start">
        <Button size="sm" variant="secondary" onClick={() => setEditing(c)} aria-label={`Edit ${c.code}`}>Edit</Button>
        <Button size="sm" variant="secondary" asChild><Link to={`/admin/courses/${c.id}/roster`} aria-label={`Class roster for ${c.code}`}>Class roster</Link></Button>
        <Button size="sm" variant="ghost" onClick={() => setDeleting(c)} aria-label={`Delete ${c.code}`}><Trash2 className="h-4 w-4" aria-hidden /></Button>
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader title="Courses" description={`${term?.name ?? ""}${isCurrent ? "" : " (not the current term)"}. Change the term from the top bar.`} actions={<Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden />New course</Button>} />
      <div className="mb-4 max-w-sm"><Field label="Search courses">{(a) => <Input {...a} type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />}</Field></div>
      {courses.isLoading && <LoadingRows rows={5} />}
      {courses.isError && <ErrorState error={courses.error} retry={() => void courses.refetch()} />}
      {courses.data && <><DataTable rows={courses.data.items} columns={columns} rowKey={(c) => c.id} caption="Courses" /><Pagination page={courses.data.page} pageSize={courses.data.pageSize} total={courses.data.total} onPage={setPage} /></>}
      {editing && termId && <CourseForm course={editing === "new" ? null : editing} termId={termId} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete ${deleting?.code}?`} description="This removes the course offering. Courses that have any enrollment history cannot be deleted; set their capacity to 0 to close them instead." confirmLabel="Delete course" danger loading={del.isPending} onConfirm={() => deleting && del.mutate(deleting.id)} />
    </>
  );
}

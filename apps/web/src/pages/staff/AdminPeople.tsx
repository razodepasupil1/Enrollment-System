import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  instructorCreateSchema, instructorUpdateSchema, studentCreateSchema, studentUpdateSchema, termSchema,
  type AdminStudentDTO, type InstructorDTO, type TermDTO,
} from "@enroll/shared";
import { DataTable, type Column } from "@/components/DataTable";
import { Badge, Button, ErrorState, Field, Input, LoadingRows, Modal, PageHeader, Pagination, Select } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatDate, fromLocalInput, toLocalInput } from "@/lib/format";
import { useAdminInstructors, useAdminStudents, useApiMutation, useMeta, useTerms } from "@/lib/queries";

const STATUS_TONE = { ACTIVE: "open", INACTIVE: "neutral", SUSPENDED: "full", GRADUATED: "wait" } as const;

// --- Students -------------------------------------------------------------------------------------------
const STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "GRADUATED"] as const;

function StudentCreateForm({ onClose }: { onClose: () => void }) {
  const meta = useMeta();
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(studentCreateSchema),
    defaultValues: { fullName: "", email: "", password: "", studentNumber: "", programId: meta.data?.programs[0]?.id ?? 0, yearLevel: 1, maxUnits: 21 },
  });
  const [serverError, setServerError] = useState<string | undefined>();
  const save = useApiMutation<Record<string, unknown>>("POST", () => "/admin/students", ["admin-students", "analytics"]);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="New student"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v, { onSuccess: () => { toast.success("Student created. They can sign in now."); onClose(); }, onError: (e) => setServerError(errorMessage(e)) }))}>Create student</Button></>}>
      <form className="space-y-4" noValidate onSubmit={(e) => e.preventDefault()}>
        <Field label="Full name" error={errors.fullName?.message}>{(a) => <Input {...a} {...register("fullName")} />}</Field>
        <Field label="Email" error={errors.email?.message}>{(a) => <Input {...a} type="email" {...register("email")} />}</Field>
        <Field label="Temporary password" error={errors.password?.message} hint="At least 8 characters.">{(a) => <Input {...a} type="password" autoComplete="new-password" {...register("password")} />}</Field>
        <Field label="Student number" error={errors.studentNumber?.message}>{(a) => <Input {...a} {...register("studentNumber")} />}</Field>
        <Field label="Program">{(a) => <Select {...a} {...register("programId", { valueAsNumber: true })}>{meta.data?.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Year level" error={errors.yearLevel?.message}>{(a) => <Input {...a} type="number" min={1} max={8} {...register("yearLevel", { valueAsNumber: true })} />}</Field>
          <Field label="Unit limit" error={errors.maxUnits?.message}>{(a) => <Input {...a} type="number" min={1} max={40} {...register("maxUnits", { valueAsNumber: true })} />}</Field>
        </div>
        {serverError && <p role="alert" className="rounded-md bg-full-bg px-3 py-2 text-sm text-full">{serverError}</p>}
      </form>
    </Modal>
  );
}

function StudentEditForm({ student, onClose }: { student: AdminStudentDTO; onClose: () => void }) {
  const meta = useMeta();
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(studentUpdateSchema),
    defaultValues: { fullName: student.fullName, programId: student.programId, yearLevel: student.yearLevel, maxUnits: student.maxUnits, status: student.status },
  });
  const [serverError, setServerError] = useState<string | undefined>();
  const save = useApiMutation<Record<string, unknown>>("PUT", () => `/admin/students/${student.id}`, ["admin-students", "analytics"]);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Edit ${student.fullName}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v, { onSuccess: () => { toast.success("Student updated."); onClose(); }, onError: (e) => setServerError(errorMessage(e)) }))}>Save changes</Button></>}>
      <form className="space-y-4" noValidate onSubmit={(e) => e.preventDefault()}>
        <Field label="Full name" error={errors.fullName?.message}>{(a) => <Input {...a} {...register("fullName")} />}</Field>
        <Field label="Program">{(a) => <Select {...a} {...register("programId", { valueAsNumber: true })}>{meta.data?.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Year level" error={errors.yearLevel?.message}>{(a) => <Input {...a} type="number" min={1} max={8} {...register("yearLevel", { valueAsNumber: true })} />}</Field>
          <Field label="Unit limit" error={errors.maxUnits?.message}>{(a) => <Input {...a} type="number" min={1} max={40} {...register("maxUnits", { valueAsNumber: true })} />}</Field>
        </div>
        <Field label="Status" hint="Only active students can enroll.">{(a) => <Select {...a} {...register("status")}>{STATUSES.map((st) => <option key={st} value={st}>{st.charAt(0) + st.slice(1).toLowerCase()}</option>)}</Select>}</Field>
        {serverError && <p role="alert" className="rounded-md bg-full-bg px-3 py-2 text-sm text-full">{serverError}</p>}
      </form>
    </Modal>
  );
}

export function AdminStudents() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const list = useAdminStudents(q, page);
  const [editing, setEditing] = useState<AdminStudentDTO | "new" | null>(null);
  const columns: Column<AdminStudentDTO>[] = [
    { key: "no", header: "Student no.", cell: (s) => s.studentNumber },
    { key: "name", header: "Name", cell: (s) => <span><strong>{s.fullName}</strong><span className="block text-sm text-muted">{s.email}</span></span> },
    { key: "prog", header: "Program", cell: (s) => `${s.programCode}, year ${s.yearLevel}` },
    { key: "units", header: "Units", cell: (s) => `${s.enrolledUnits} of ${s.maxUnits}` },
    { key: "status", header: "Status", cell: (s) => <span className="flex flex-wrap gap-1"><Badge tone={STATUS_TONE[s.status]}>{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</Badge>{s.activeHolds > 0 && <Badge tone="full">{s.activeHolds} {s.activeHolds === 1 ? "hold" : "holds"}</Badge>}</span> },
    { key: "act", header: "Actions", cell: (s) => <Button size="sm" variant="secondary" onClick={() => setEditing(s)} aria-label={`Edit ${s.fullName}`}>Edit</Button> },
  ];
  return (
    <>
      <PageHeader title="Students" actions={<Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden />New student</Button>} />
      <div className="mb-4 max-w-sm"><Field label="Search students">{(a) => <Input {...a} type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />}</Field></div>
      {list.isLoading && <LoadingRows rows={5} />}
      {list.isError && <ErrorState error={list.error} retry={() => void list.refetch()} />}
      {list.data && <><DataTable rows={list.data.items} columns={columns} rowKey={(s) => s.id} caption="Students" /><Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /></>}
      {editing === "new" && <StudentCreateForm onClose={() => setEditing(null)} />}
      {editing && editing !== "new" && <StudentEditForm key={editing.id} student={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

// --- Instructors ------------------------------------------------------------------------------------------
function InstructorCreateForm({ onClose }: { onClose: () => void }) {
  const meta = useMeta();
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(instructorCreateSchema),
    defaultValues: { fullName: "", email: "", password: "", departmentId: meta.data?.departments[0]?.id ?? 0, title: "Instructor" },
  });
  const [serverError, setServerError] = useState<string | undefined>();
  const save = useApiMutation<Record<string, unknown>>("POST", () => "/admin/instructors", ["admin-instructors"]);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="New instructor"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v, { onSuccess: () => { toast.success("Instructor created."); onClose(); }, onError: (e) => setServerError(errorMessage(e)) }))}>Create instructor</Button></>}>
      <form className="space-y-4" noValidate onSubmit={(e) => e.preventDefault()}>
        <Field label="Full name" error={errors.fullName?.message}>{(a) => <Input {...a} {...register("fullName")} />}</Field>
        <Field label="Email" error={errors.email?.message}>{(a) => <Input {...a} type="email" {...register("email")} />}</Field>
        <Field label="Temporary password" error={errors.password?.message} hint="At least 8 characters.">{(a) => <Input {...a} type="password" autoComplete="new-password" {...register("password")} />}</Field>
        <Field label="Department">{(a) => <Select {...a} {...register("departmentId", { valueAsNumber: true })}>{meta.data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <Field label="Title" error={errors.title?.message}>{(a) => <Input {...a} {...register("title")} />}</Field>
        {serverError && <p role="alert" className="rounded-md bg-full-bg px-3 py-2 text-sm text-full">{serverError}</p>}
      </form>
    </Modal>
  );
}

function InstructorEditForm({ instructor, onClose }: { instructor: InstructorDTO; onClose: () => void }) {
  const meta = useMeta();
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(instructorUpdateSchema),
    defaultValues: { fullName: instructor.fullName, departmentId: instructor.departmentId, title: instructor.title },
  });
  const [serverError, setServerError] = useState<string | undefined>();
  const save = useApiMutation<Record<string, unknown>>("PUT", () => `/admin/instructors/${instructor.id}`, ["admin-instructors"]);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Edit ${instructor.fullName}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v, { onSuccess: () => { toast.success("Instructor updated."); onClose(); }, onError: (e) => setServerError(errorMessage(e)) }))}>Save changes</Button></>}>
      <form className="space-y-4" noValidate onSubmit={(e) => e.preventDefault()}>
        <Field label="Full name" error={errors.fullName?.message}>{(a) => <Input {...a} {...register("fullName")} />}</Field>
        <Field label="Department">{(a) => <Select {...a} {...register("departmentId", { valueAsNumber: true })}>{meta.data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <Field label="Title" error={errors.title?.message}>{(a) => <Input {...a} {...register("title")} />}</Field>
        {serverError && <p role="alert" className="rounded-md bg-full-bg px-3 py-2 text-sm text-full">{serverError}</p>}
      </form>
    </Modal>
  );
}

export function AdminInstructors() {
  const list = useAdminInstructors();
  const [editing, setEditing] = useState<InstructorDTO | "new" | null>(null);
  const columns: Column<InstructorDTO>[] = [
    { key: "name", header: "Name", cell: (i) => <span><strong>{i.fullName}</strong><span className="block text-sm text-muted">{i.email}</span></span> },
    { key: "dept", header: "Department", cell: (i) => i.departmentName },
    { key: "title", header: "Title", cell: (i) => i.title },
    { key: "act", header: "Actions", cell: (i) => <Button size="sm" variant="secondary" onClick={() => setEditing(i)} aria-label={`Edit ${i.fullName}`}>Edit</Button> },
  ];
  return (
    <>
      <PageHeader title="Instructors" actions={<Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden />New instructor</Button>} />
      {list.isLoading && <LoadingRows rows={4} />}
      {list.isError && <ErrorState error={list.error} retry={() => void list.refetch()} />}
      {list.data && <DataTable rows={list.data.instructors} columns={columns} rowKey={(i) => i.id} caption="Instructors" />}
      {editing === "new" && <InstructorCreateForm onClose={() => setEditing(null)} />}
      {editing && editing !== "new" && <InstructorEditForm key={editing.id} instructor={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

// --- Terms ---------------------------------------------------------------------------------------------------
interface TermForm { name: string; isCurrent: boolean; registrationOpensAt: string; registrationClosesAt: string; dropDeadline: string; endsAt: string }

function TermModal({ term, onClose }: { term: TermDTO | null; onClose: () => void }) {
  const { register, handleSubmit } = useForm<TermForm>({
    defaultValues: { name: term?.name ?? "", isCurrent: term?.isCurrent ?? false, registrationOpensAt: toLocalInput(term?.registrationOpensAt), registrationClosesAt: toLocalInput(term?.registrationClosesAt), dropDeadline: toLocalInput(term?.dropDeadline), endsAt: toLocalInput(term?.endsAt) },
  });
  const [errors, setErrors] = useState<string[]>([]);
  const save = useApiMutation<Record<string, unknown>>(term ? "PUT" : "POST", () => (term ? `/admin/terms/${term.id}` : "/admin/terms"), ["terms", "meta", "courses", "analytics"]);
  const submit = (v: TermForm) => {
    const parsed = termSchema.safeParse({ name: v.name, isCurrent: v.isCurrent, registrationOpensAt: v.registrationOpensAt && fromLocalInput(v.registrationOpensAt), registrationClosesAt: v.registrationClosesAt && fromLocalInput(v.registrationClosesAt), dropDeadline: v.dropDeadline && fromLocalInput(v.dropDeadline), endsAt: v.endsAt && fromLocalInput(v.endsAt) });
    if (!parsed.success) return setErrors(parsed.error.issues.map((i) => i.message));
    setErrors([]);
    save.mutate(parsed.data, { onSuccess: () => { toast.success("Academic term saved."); onClose(); }, onError: (e) => setErrors([errorMessage(e)]) });
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={term ? `Edit ${term.name}` : "New academic term"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={handleSubmit(submit)}>Save academic term</Button></>}>
      <form className="space-y-4" noValidate onSubmit={(e) => e.preventDefault()}>
        <Field label="Name">{(a) => <Input {...a} {...register("name")} />}</Field>
        <Field label="Registration opens">{(a) => <Input {...a} type="datetime-local" {...register("registrationOpensAt")} />}</Field>
        <Field label="Registration closes">{(a) => <Input {...a} type="datetime-local" {...register("registrationClosesAt")} />}</Field>
        <Field label="Drop deadline" hint="Dropping after this moment gives a W (withdrawn).">{(a) => <Input {...a} type="datetime-local" {...register("dropDeadline")} />}</Field>
        <Field label="Academic term ends">{(a) => <Input {...a} type="datetime-local" {...register("endsAt")} />}</Field>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" {...register("isCurrent")} />Make this the current academic term (students can only enroll in the current term)</label>
        {errors.length > 0 && <ul role="alert" className="space-y-1 rounded-md bg-full-bg px-3 py-2 text-sm text-full">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </form>
    </Modal>
  );
}

export function AdminTerms() {
  const list = useTerms();
  const [editing, setEditing] = useState<TermDTO | "new" | null>(null);
  const columns: Column<TermDTO>[] = [
    { key: "name", header: "Academic term", cell: (t) => <span className="flex flex-wrap items-center gap-2"><strong>{t.name}</strong>{t.isCurrent && <Badge tone="brand">Current</Badge>}{t.registrationOpen && <Badge tone="open">Registration open</Badge>}</span> },
    { key: "reg", header: "Registration", cell: (t) => `${formatDate(t.registrationOpensAt)} to ${formatDate(t.registrationClosesAt)}` },
    { key: "drop", header: "Drop deadline", cell: (t) => formatDate(t.dropDeadline) },
    { key: "end", header: "Ends", cell: (t) => formatDate(t.endsAt) },
    { key: "act", header: "Actions", cell: (t) => <Button size="sm" variant="secondary" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`}>Edit</Button> },
  ];
  return (
    <>
      <PageHeader title="Academic terms" description="Exactly one academic term is current. Students can only enroll in the current term." actions={<Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden />New academic term</Button>} />
      {list.isLoading && <LoadingRows rows={3} />}
      {list.isError && <ErrorState error={list.error} retry={() => void list.refetch()} />}
      {list.data && <DataTable rows={list.data.terms} columns={columns} rowKey={(t) => t.id} caption="Academic terms" />}
      {editing && <TermModal key={editing === "new" ? "new" : editing.id} term={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

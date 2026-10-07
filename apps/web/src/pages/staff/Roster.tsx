import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { toast } from "sonner";
import { forceEnrollSchema, type AdminStudentDTO, type RosterEntryDTO } from "@enroll/shared";
import { DataTable, type Column } from "@/components/DataTable";
import { SeatStrip } from "@/components/SeatStrip";
import { StudentPicker } from "@/components/StudentPicker";
import { Badge, Button, ErrorState, Field, Input, LoadingRows, Modal, PageHeader, Textarea } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useApiMutation, useMeta, useRoster } from "@/lib/queries";

const TONE = { ENROLLED: "open", WAITLISTED: "wait", COMPLETED: "neutral", FAILED: "full", DROPPED: "neutral", WITHDRAWN: "neutral" } as const;

function GradeCell({ entry }: { entry: RosterEntryDTO }) {
  const meta = useMeta();
  const scale = meta.data?.gradingPolicy;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const save = useApiMutation<{ id: number; grade: number }>("PUT", (b) => `/instructor/enrollments/${b.id}/grade`, ["roster", "analytics"]);
  if (entry.status !== "ENROLLED") return <span>{entry.gradeDisplay ?? "none"}</span>;

  const submit = () => {
    const n = Number(value);
    if (value.trim() === "" || Number.isNaN(n)) return setError("Enter a number.");
    if (scale && (n < scale.min || n > scale.max)) return setError(`Use ${scale.min} to ${scale.max}.`);
    setError(undefined);
    save.mutate({ id: entry.enrollmentId, grade: n }, {
      onSuccess: (r) => toast.success(`Grade saved for ${entry.fullName}${(r as { status?: string }).status === "FAILED" ? " (failing grade)" : ""}.`),
      onError: (e) => setError(errorMessage(e)),
    });
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 md:justify-start">
        <Input aria-label={`Grade for ${entry.fullName}`} type="number" step="0.25" min={scale?.min} max={scale?.max} className="h-9 w-24" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={error ? true : undefined} />
        <Button size="sm" onClick={submit} loading={save.isPending} aria-label={`Save grade for ${entry.fullName}`}>Save</Button>
      </div>
      {error && <p role="alert" className="text-sm text-full">{error}</p>}
    </div>
  );
}

function OverrideDialog({ courseId, code, open, onOpenChange }: { courseId: number; code: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [student, setStudent] = useState<AdminStudentDTO | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const force = useApiMutation<{ studentId: number; courseId: number; reason: string }>("POST", () => "/admin/enrollments/force", ["roster", "courses", "analytics", "audit"]);

  const submit = () => {
    const parsed = forceEnrollSchema.safeParse({ studentId: student?.id, courseId, reason });
    if (!parsed.success) return setError(student ? parsed.error.issues[0]?.message : "Pick a student first.");
    setError(undefined);
    force.mutate(parsed.data, {
      onSuccess: () => { toast.success(`${student!.fullName} was enrolled in ${code}. The override is in the audit log.`); setStudent(null); setReason(""); onOpenChange(false); },
      onError: (e) => setError(errorMessage(e)),
    });
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Override enroll in ${code}`} description="Skips prerequisites, conflicts, holds, and unit limits. It cannot exceed capacity: raise the capacity first. A reason is required and is written to the audit log."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} loading={force.isPending}>Enroll with override</Button></>}>
      <div className="space-y-4">
        <StudentPicker value={student} onChange={setStudent} />
        <Field label="Reason (required)">{(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {error && <p role="alert" className="text-sm text-full">{error}</p>}
      </div>
    </Modal>
  );
}

/** Serves both /instructor/courses/:id and /admin/courses/:id/roster. Admins also get the override tool. */
export function Roster() {
  const id = Number(useParams().id);
  const admin = useLocation().pathname.startsWith("/admin");
  const q = useRoster(Number.isInteger(id) ? id : null, admin);
  const meta = useMeta();
  const [override, setOverride] = useState(false);

  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const { course, entries } = q.data!;
  const scale = meta.data?.gradingPolicy;

  const columns: Column<RosterEntryDTO>[] = [
    { key: "no", header: "Student no.", cell: (e) => e.studentNumber },
    { key: "name", header: "Name", cell: (e) => <span><strong>{e.fullName}</strong><span className="block text-sm text-muted">{e.email}</span></span> },
    { key: "status", header: "Status", cell: (e) => <Badge tone={TONE[e.status]}>{e.status === "WAITLISTED" ? `Waitlisted #${e.waitlistPosition}` : e.status.charAt(0) + e.status.slice(1).toLowerCase()}</Badge> },
    { key: "grade", header: "Grade", cell: (e) => <GradeCell entry={e} /> },
  ];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2"><Link to={admin ? "/admin/courses" : "/instructor"}><ArrowLeft className="h-4 w-4" aria-hidden />Back</Link></Button>
      <PageHeader title={`${course.code} ${course.title}`} description={`${course.meetingSummary}${course.room ? `, ${course.room}` : ""}`} actions={admin ? <Button onClick={() => setOverride(true)}>Override enroll</Button> : undefined} />
      <div className="mb-6 max-w-xs"><SeatStrip capacity={course.capacity} enrolled={course.enrolledCount} waitlisted={course.waitlistedCount} availability={course.availability} /></div>
      {scale && <p className="mb-3 text-sm text-muted">Grades use the {scale.name}. Valid values run from {scale.min} to {scale.max}; {scale.passMark} is the {scale.higherIsBetter ? "lowest passing" : "worst passing"} grade. A grade can be entered once.</p>}
      {entries.length === 0 ? <p className="text-muted">Nobody is enrolled yet.</p> : <DataTable rows={entries} columns={columns} rowKey={(e) => e.enrollmentId} caption={`Class roster for ${course.code}`} />}
      {admin && <OverrideDialog courseId={course.id} code={course.code} open={override} onOpenChange={setOverride} />}
    </>
  );
}

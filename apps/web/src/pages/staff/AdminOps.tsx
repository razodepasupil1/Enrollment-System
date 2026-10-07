import { Download, Megaphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { holdSchema, type AdminStudentDTO, type AuditEntryDTO, type HoldDTO, type OverloadRequestDTO } from "@enroll/shared";
import { DataTable, type Column } from "@/components/DataTable";
import { StudentPicker } from "@/components/StudentPicker";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, PageHeader, Pagination, Panel, Select, Textarea } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { useAdminHolds, useAdminOverloads, useAnnouncements, useApiMutation, useAudit } from "@/lib/queries";
import { useTerm } from "@/lib/state";

// --- Holds ---------------------------------------------------------------------------------------------------
function PlaceHold({ onClose }: { onClose: () => void }) {
  const [student, setStudent] = useState<AdminStudentDTO | null>(null);
  const [type, setType] = useState<"FINANCIAL" | "ADVISING" | "ACADEMIC">("FINANCIAL");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const place = useApiMutation<{ studentId: number; type: string; reason: string }>("POST", () => "/admin/holds", ["admin-holds", "admin-students", "analytics"]);
  const submit = () => {
    const parsed = holdSchema.safeParse({ studentId: student?.id, type, reason });
    if (!parsed.success) return setError(student ? parsed.error.issues[0]?.message : "Pick a student first.");
    place.mutate(parsed.data, { onSuccess: () => { toast.success(`Hold placed on ${student!.fullName}. They were notified.`); onClose(); }, onError: (e) => setError(errorMessage(e)) });
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Place a hold" description="The student cannot enroll until it is cleared. They see the reason you write here."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={place.isPending}>Place hold</Button></>}>
      <div className="space-y-4">
        <StudentPicker value={student} onChange={setStudent} />
        <Field label="Type">{(a) => <Select {...a} value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="FINANCIAL">Financial</option><option value="ADVISING">Advising</option><option value="ACADEMIC">Academic</option></Select>}</Field>
        <Field label="Reason shown to the student">{(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {error && <p role="alert" className="text-sm text-full">{error}</p>}
      </div>
    </Modal>
  );
}

export function AdminHolds() {
  const [activeOnly, setActiveOnly] = useState(true);
  const list = useAdminHolds(activeOnly);
  const [placing, setPlacing] = useState(false);
  const [clearing, setClearing] = useState<HoldDTO | null>(null);
  const clear = useApiMutation<number>("POST", (id) => `/admin/holds/${id}/clear`, ["admin-holds", "admin-students", "analytics"], () => undefined);
  const columns: Column<HoldDTO>[] = [
    { key: "s", header: "Student", cell: (h) => <span><strong>{h.studentName}</strong><span className="block text-sm text-muted">{h.studentNumber}</span></span> },
    { key: "t", header: "Type", cell: (h) => <Badge tone="neutral">{h.type.charAt(0) + h.type.slice(1).toLowerCase()}</Badge> },
    { key: "r", header: "Reason", cell: (h) => h.reason },
    { key: "p", header: "Placed", cell: (h) => <span>{formatDate(h.placedAt)}{h.placedByName && <span className="block text-sm text-muted">by {h.placedByName}</span>}</span> },
    { key: "st", header: "Status", cell: (h) => h.clearedAt ? <Badge tone="neutral">Cleared {formatDate(h.clearedAt)}</Badge> : <Button size="sm" variant="secondary" onClick={() => setClearing(h)} aria-label={`Clear hold for ${h.studentName}`}>Clear hold</Button> },
  ];
  return (
    <>
      <PageHeader title="Holds" description="A hold blocks a student from enrolling until it is cleared." actions={<Button onClick={() => setPlacing(true)}>Place a hold</Button>} />
      <div className="mb-4 flex gap-2" role="group" aria-label="Show">
        <Button size="sm" variant={activeOnly ? "primary" : "secondary"} aria-pressed={activeOnly} onClick={() => setActiveOnly(true)}>Active</Button>
        <Button size="sm" variant={activeOnly ? "secondary" : "primary"} aria-pressed={!activeOnly} onClick={() => setActiveOnly(false)}>All, including cleared</Button>
      </div>
      {list.isLoading && <LoadingRows rows={3} />}
      {list.isError && <ErrorState error={list.error} retry={() => void list.refetch()} />}
      {list.data && list.data.holds.length === 0 && <EmptyState title="No holds">No student currently has a hold.</EmptyState>}
      {list.data && list.data.holds.length > 0 && <DataTable rows={list.data.holds} columns={columns} rowKey={(h) => h.id} caption="Holds" />}
      {placing && <PlaceHold onClose={() => setPlacing(false)} />}
      <ConfirmDialog open={!!clearing} onOpenChange={(o) => !o && setClearing(null)} title="Clear this hold?" description={`${clearing?.studentName} will be able to enroll again and will be notified.`} confirmLabel="Clear hold" loading={clear.isPending}
        onConfirm={() => clearing && clear.mutate(clearing.id, { onSuccess: () => { toast.success("Hold cleared."); setClearing(null); }, onError: (e) => { toast.error(errorMessage(e)); setClearing(null); } })} />
    </>
  );
}

// --- Overload requests ----------------------------------------------------------------------------------------
export function AdminOverloads() {
  const [pendingOnly, setPendingOnly] = useState(true);
  const list = useAdminOverloads(pendingOnly ? "PENDING" : undefined);
  const [deciding, setDeciding] = useState<{ req: OverloadRequestDTO; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const decide = useApiMutation<{ id: number; approve: boolean; note?: string }>("POST", (b) => `/admin/overload-requests/${b.id}/decision`, ["admin-overloads", "analytics"]);
  const TONE = { PENDING: "almost", APPROVED: "open", REJECTED: "full" } as const;

  return (
    <>
      <PageHeader title="Overload requests" description="Approving raises that student's unit limit for the term, so they can enroll past it." />
      <div className="mb-4 flex gap-2" role="group" aria-label="Show">
        <Button size="sm" variant={pendingOnly ? "primary" : "secondary"} aria-pressed={pendingOnly} onClick={() => setPendingOnly(true)}>Waiting for a decision</Button>
        <Button size="sm" variant={pendingOnly ? "secondary" : "primary"} aria-pressed={!pendingOnly} onClick={() => setPendingOnly(false)}>All requests</Button>
      </div>
      {list.isLoading && <LoadingRows rows={3} />}
      {list.isError && <ErrorState error={list.error} retry={() => void list.refetch()} />}
      {list.data && list.data.requests.length === 0 && <EmptyState title="No requests to review" />}
      <ul className="space-y-3">
        {list.data?.requests.map((r) => (
          <li key={r.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{r.studentName} <span className="font-normal text-muted">{r.studentNumber}</span></p>
                <p>Wants <strong>+{r.extraUnits} units</strong> for {r.termName}. Currently {r.currentUnits} of {r.maxUnits}.</p>
                <p className="mt-1 text-muted">&ldquo;{r.reason}&rdquo;</p>
                <p className="mt-1 text-sm text-muted">Sent {timeAgo(r.createdAt)}{r.decisionNote ? `. Decision note: ${r.decisionNote}` : ""}</p>
              </div>
              {r.status === "PENDING" ? (
                <div className="flex gap-2"><Button size="sm" onClick={() => { setNote(""); setDeciding({ req: r, approve: true }); }} aria-label={`Approve overload for ${r.studentName}`}>Approve</Button><Button size="sm" variant="secondary" onClick={() => { setNote(""); setDeciding({ req: r, approve: false }); }} aria-label={`Decline overload for ${r.studentName}`}>Decline</Button></div>
              ) : <Badge tone={TONE[r.status]}>{r.status === "APPROVED" ? "Approved" : "Declined"}</Badge>}
            </div>
          </li>
        ))}
      </ul>
      {deciding && (
        <Modal open onOpenChange={(o) => !o && setDeciding(null)} title={`${deciding.approve ? "Approve" : "Decline"} request from ${deciding.req.studentName}?`} description="The student is notified with your decision."
          footer={<><Button variant="secondary" onClick={() => setDeciding(null)}>Cancel</Button><Button variant={deciding.approve ? "primary" : "danger"} loading={decide.isPending}
            onClick={() => decide.mutate({ id: deciding.req.id, approve: deciding.approve, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: () => { toast.success(deciding.approve ? "Approved." : "Declined."); setDeciding(null); }, onError: (e) => { toast.error(errorMessage(e)); setDeciding(null); } })}>{deciding.approve ? "Approve" : "Decline"}</Button></>}>
          <Field label="Note to the student (optional)">{(a) => <Input {...a} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </Modal>
      )}
    </>
  );
}

// --- Announcements ------------------------------------------------------------------------------------------------
export function AdminAnnouncements() {
  const list = useAnnouncements();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | undefined>();
  const send = useApiMutation<{ title: string; body: string }>("POST", () => "/admin/announcements", ["announcements"]);
  return (
    <>
      <PageHeader title="Announcements" description="Appears on every student's dashboard and in their notification bell." />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Panel title="New announcement">
          <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); send.mutate({ title, body }, { onSuccess: (r) => { toast.success(`Sent to ${(r as { notified: number }).notified} students.`); setTitle(""); setBody(""); setError(undefined); }, onError: (err) => setError(errorMessage(err)) }); }}>
            <Field label="Title">{(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
            <Field label="Message">{(a) => <Textarea {...a} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
            {error && <p role="alert" className="text-sm text-full">{error}</p>}
            <Button type="submit" className="w-full" loading={send.isPending}><Megaphone className="h-4 w-4" aria-hidden />Send to all students</Button>
          </form>
        </Panel>
        <ul className="space-y-3">
          {list.data?.announcements.map((a) => <li key={a.id} className="rounded-xl border border-line bg-surface p-4"><p className="font-semibold">{a.title}</p><p className="text-muted">{a.body}</p><p className="mt-1 text-sm text-muted">{a.authorName ?? "Registrar"}, {timeAgo(a.createdAt)}</p></li>)}
        </ul>
      </div>
    </>
  );
}

// --- Audit log -----------------------------------------------------------------------------------------------------
const summary = (d: Record<string, unknown> | null): string =>
  d ? Object.entries(d).filter(([k]) => k !== "seeded").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ") : "";

export function AdminAudit() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const list = useAudit({ page, ...(action ? { action } : {}) });
  const columns: Column<AuditEntryDTO>[] = [
    { key: "t", header: "When", cell: (e) => <span title={e.createdAt}>{formatDateTime(e.createdAt)}</span> },
    { key: "a", header: "Action", cell: (e) => <Badge tone={e.action.includes("FORCE") || e.action.includes("ROLLBACK") ? "almost" : "neutral"}>{e.action}</Badge> },
    { key: "w", header: "By", cell: (e) => e.actorName ?? "System" },
    { key: "s", header: "Student", cell: (e) => e.studentName ?? "" },
    { key: "c", header: "Course", cell: (e) => e.courseCode ?? "" },
    { key: "d", header: "Details", cell: (e) => <span className="text-sm text-muted">{summary(e.details)}</span> },
  ];
  return (
    <>
      <PageHeader title="Audit log" description="Every enrollment, drop, promotion, override, grade, and admin change. Entries are never edited or deleted." />
      <div className="mb-4 max-w-xs"><Field label="Filter by action">{(a) => (
        <Select {...a} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}><option value="">All actions</option>{list.data?.actions.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
      )}</Field></div>
      {list.isLoading && <LoadingRows rows={5} />}
      {list.isError && <ErrorState error={list.error} retry={() => void list.refetch()} />}
      {list.data && <><DataTable rows={list.data.items} columns={columns} rowKey={(e) => e.id} caption="Audit log" /><Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /></>}
    </>
  );
}

// --- Exports -------------------------------------------------------------------------------------------------------
export function AdminExports() {
  const { termId, term } = useTerm();
  return (
    <>
      <PageHeader title="Exports" />
      <Panel title="Enrollments (CSV)">
        <p className="mb-4 text-muted">Every enrollment for {term?.name ?? "the selected term"}: student, course, status, grade, and timestamps. Opens in Excel or Google Sheets. Cells that could run as formulas are neutralised.</p>
        <Button asChild><a href={`/api/admin/export/enrollments.csv${termId ? `?termId=${termId}` : ""}`} download="enrollments.csv"><Download className="h-4 w-4" aria-hidden />Download enrollments.csv</a></Button>
      </Panel>
    </>
  );
}

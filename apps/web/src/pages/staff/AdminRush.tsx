import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RotateCcw, ShieldAlert, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { RushResultDTO, RushRowDTO } from "@enroll/shared";
import { DataTable, type Column } from "@/components/DataTable";
import { Badge, Button, Field, Input, PageHeader, Panel, Select } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useCourses } from "@/lib/queries";
import { useTerm } from "@/lib/state";

export function AdminRush() {
  const { termId } = useTerm();
  const courses = useCourses({ ...(termId ? { termId } : {}), pageSize: 50, sort: "fill" });
  const [courseId, setCourseId] = useState<number | null>(null);
  const [count, setCount] = useState(40);
  const [result, setResult] = useState<RushResultDTO | null>(null);
  const qc = useQueryClient();
  const refresh = () => Promise.all(["courses", "course", "analytics", "audit"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  const items = courses.data?.items ?? [];
  const chosen = courseId ?? items.find((c) => c.code === "ENGL210")?.id ?? items[0]?.id ?? null;

  const run = useMutation({
    mutationFn: () => api<RushResultDTO>("/admin/simulate/rush", { method: "POST", body: { courseId: chosen, count } }),
    onSuccess: (r) => { setResult(r); void refresh(); },
    onError: (e) => toast.error(e instanceof ApiError && e.status === 403 ? "The Rush Simulator is switched off. Set DEMO_MODE=true on the server to use it." : errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () => api<{ removedStudents: number }>("/admin/simulate/reset", { method: "POST" }),
    onSuccess: (r) => { setResult(null); toast.success(`Scenario reset. ${r.removedStudents} virtual students removed.`); void refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<RushRowDTO>[] = [
    { key: "n", header: "Virtual student", cell: (r) => r.studentName },
    { key: "o", header: "Outcome", cell: (r) => <Badge tone={r.status === "ENROLLED" ? "open" : r.status === "WAITLISTED" ? "wait" : "full"}>{r.status === "ENROLLED" ? "Enrolled" : r.status === "WAITLISTED" ? `Waitlisted #${r.waitlistPosition}` : "Rejected"}</Badge> },
    { key: "ms", header: "Time", cell: (r) => `${r.ms} ms` },
    { key: "why", header: "Reason", cell: (r) => r.reason ?? "" },
  ];

  return (
    <>
      <PageHeader title="Rush Simulator" description="Fire many virtual students at one course at the same instant. Each request is a real enrollment in its own transaction. The result shows no seat is ever oversold." />
      <Panel title="Run a simulation" className="mb-6">
        <form className="grid gap-4 sm:grid-cols-[1fr_160px_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
          <Field label="Course" hint="ENGL210 has exactly one seat left and no prerequisites, so it shows the race most clearly.">{(a) => (
            <Select {...a} value={chosen ?? ""} onChange={(e) => setCourseId(Number(e.target.value))}>{items.map((c) => <option key={c.id} value={c.id}>{c.code} {c.title} ({c.enrolledCount}/{c.capacity})</option>)}</Select>
          )}</Field>
          <Field label="Virtual students">{(a) => <Input {...a} type="number" min={2} max={60} value={count} onChange={(e) => setCount(Number(e.target.value))} />}</Field>
          <Button type="submit" loading={run.isPending} disabled={!chosen}><Zap className="h-4 w-4" aria-hidden />Run simulation</Button>
        </form>
      </Panel>

      {result && (
        <section aria-labelledby="proof" aria-live="polite">
          <div className={`mb-4 flex items-start gap-3 rounded-xl border p-5 ${result.overEnrolled ? "border-full/40 bg-full-bg text-full" : "border-open/40 bg-open-bg text-open"}`}>
            {result.overEnrolled ? <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />}
            <div>
              <h2 id="proof" className="text-lg">{result.overEnrolled ? `Over-enrolled: ${result.enrolledAfter} students in ${result.capacity} seats` : `No over-enrollment: ${result.enrolledAfter} of ${result.capacity} seats taken`}</h2>
              <p>{result.attempted} students asked for {result.code} at once. {result.succeeded} got a seat, {result.waitlisted} joined the waitlist{result.rejected ? `, ${result.rejected} were rejected by the rules` : ""}. It took {result.durationMs} ms.</p>
            </div>
          </div>
          <dl className="mb-4 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface sm:grid-cols-5 sm:divide-y-0">
            {([["Seats", result.capacity], ["Taken before", result.enrolledBefore], ["Taken after", result.enrolledAfter], ["Waiting after", result.waitlistedAfter], ["Rejected", result.rejected]] as const).map(([l, v]) => (
              <div key={l} className="p-4"><dt className="text-sm text-muted">{l}</dt><dd className="font-display text-xl font-bold">{v}</dd></div>
            ))}
          </dl>
          <DataTable rows={result.rows} columns={columns} rowKey={(r) => r.studentName} caption={`Outcome of each virtual student for ${result.code}`} />
        </section>
      )}
      <div className="mt-6"><Button variant="secondary" onClick={() => reset.mutate()} loading={reset.isPending}><RotateCcw className="h-4 w-4" aria-hidden />Reset scenario</Button><p className="mt-2 text-sm text-muted">Removes every virtual student and puts the course back exactly as it was.</p></div>
    </>
  );
}

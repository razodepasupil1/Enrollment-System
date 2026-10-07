import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ErrorState, LoadingRows, PageHeader, Panel, ProgressBar } from "@/components/ui";
import { useAnalytics } from "@/lib/queries";
import { useTerm } from "@/lib/state";

const axis = { fill: "var(--muted)", fontSize: 12 };
const tip = { contentStyle: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--ink)" }, cursor: { fill: "var(--sunken)" } };

export function AdminOverview() {
  const { termId, term } = useTerm();
  const q = useAnalytics(termId);
  if (q.isLoading) return <LoadingRows rows={5} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const a = q.data!;
  const t = a.totals;

  const stats: Array<[string, string, string?]> = [
    ["Students", String(t.students)], ["Courses", String(t.courses)], ["Seats taken", `${t.seatsTaken} of ${t.seatsTotal}`],
    ["On waitlists", String(t.waitlisted)], ["Active holds", String(t.activeHolds)], ["Overloads pending", String(t.pendingOverloads)],
  ];

  return (
    <>
      <PageHeader title="Overview" description={`${term?.name ?? "Current term"}. Figures refresh every 30 seconds.`} />
      <dl className="mb-6 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        {stats.map(([label, value]) => <div key={label} className="p-4"><dt className="text-sm text-muted">{label}</dt><dd className="font-display text-xl font-bold">{value}</dd></div>)}
      </dl>
      <div className="mb-6"><ProgressBar value={t.seatsTaken} max={t.seatsTotal} label="Seats taken across all courses" /></div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Fill rate by department">
          <div role="img" aria-label={`Fill rate by department: ${a.fillByDepartment.map((d) => `${d.department} ${d.fillRate} percent`).join(", ")}`}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={a.fillByDepartment} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="department" tick={axis} stroke="var(--line)" /><YAxis domain={[0, 100]} unit="%" tick={axis} stroke="var(--line)" />
                <Tooltip {...tip} formatter={(v) => [`${v}%`, "Fill rate"]} />
                <Bar dataKey="fillRate" fill="var(--brand)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Enrollments over time">
          <div role="img" aria-label="Number of enrollments made each day this term">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={a.enrollmentsOverTime} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="date" tick={axis} stroke="var(--line)" tickFormatter={(d: string) => d.slice(5)} /><YAxis allowDecimals={false} tick={axis} stroke="var(--line)" />
                <Tooltip {...tip} formatter={(v) => [v, "Enrollments"]} />
                <Area type="monotone" dataKey="count" stroke="var(--brand)" fill="var(--brand)" fillOpacity={0.18} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="How many units students carry">
          <div role="img" aria-label={`Students by unit load: ${a.unitsDistribution.map((b) => `${b.bucket} units, ${b.students}`).join("; ")}`}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={a.unitsDistribution} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="bucket" tick={axis} stroke="var(--line)" /><YAxis allowDecimals={false} tick={axis} stroke="var(--line)" />
                <Tooltip {...tip} formatter={(v) => [v, "Students"]} />
                <Bar dataKey="students" fill="var(--brand)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Fullest courses">
          <ul className="space-y-3">
            {a.topFull.map((c) => (
              <li key={c.code}>
                <div className="flex items-baseline justify-between gap-3"><span><strong>{c.code}</strong> <span className="text-muted">{c.title}</span></span><span className="shrink-0 text-sm">{c.enrolled}/{c.capacity}{c.waitlisted > 0 && <span className="text-wait"> and {c.waitlisted} waiting</span>}</span></div>
                <ProgressBar value={c.enrolled} max={c.capacity} label={`${c.code} seats taken`} tone={c.fillRate >= 100 ? "full" : "brand"} />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Waitlists" className="lg:col-span-2">
          {a.waitlists.length === 0 ? <p className="text-muted">Nobody is waiting for a seat.</p> : (
            <ul className="divide-y divide-line">{a.waitlists.map((w) => <li key={w.code} className="flex justify-between gap-3 py-2.5"><span><strong>{w.code}</strong> <span className="text-muted">{w.title}</span></span><span className="font-semibold text-wait">{w.waitlisted} waiting</span></li>)}</ul>
          )}
        </Panel>
      </div>
    </>
  );
}

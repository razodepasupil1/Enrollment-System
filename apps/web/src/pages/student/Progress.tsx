import { CheckCircle2, Circle, Clock } from "lucide-react";
import { Badge, ErrorState, LoadingRows, PageHeader, Panel } from "@/components/ui";
import { useProgress } from "@/lib/queries";

function Ring({ percent }: { percent: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-36 w-36" role="img" aria-label={`${percent} percent of required units earned`}>
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" strokeWidth="12" className="stroke-sunken" />
        <circle cx="64" cy="64" r={r} fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-brand transition-[stroke-dashoffset]" strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="font-display text-3xl font-bold">{percent}%</span><span className="text-xs text-muted">of units</span></div>
    </div>
  );
}

export function Progress() {
  const q = useProgress();
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const p = q.data!;
  const done = p.requirements.filter((r) => r.status === "COMPLETED").length;

  return (
    <>
      <PageHeader title="Degree progress" description={`${p.programName} (${p.programCode})`} />
      <div className="mb-6 flex flex-wrap items-center gap-8 rounded-xl border border-line bg-surface p-6">
        <Ring percent={p.percent} />
        <dl className="grid gap-4 sm:grid-cols-3 sm:gap-10">
          <div><dt className="text-sm text-muted">Units earned</dt><dd className="font-display text-2xl font-bold">{p.unitsEarned} <span className="text-base font-medium text-muted">of {p.requiredUnits}</span></dd></div>
          <div><dt className="text-sm text-muted">In progress now</dt><dd className="font-display text-2xl font-bold">{p.unitsInProgress}</dd></div>
          <div><dt className="text-sm text-muted">Core requirements</dt><dd className="font-display text-2xl font-bold">{done} <span className="text-base font-medium text-muted">of {p.requirements.length}</span></dd></div>
        </dl>
      </div>
      <Panel title="Required courses">
        <ul className="divide-y divide-line">
          {p.requirements.map((r) => (
            <li key={r.code} className="flex items-center gap-3 py-2.5">
              {r.status === "COMPLETED" && <CheckCircle2 className="h-5 w-5 shrink-0 text-open" aria-hidden />}
              {r.status === "IN_PROGRESS" && <Clock className="h-5 w-5 shrink-0 text-almost" aria-hidden />}
              {r.status === "REMAINING" && <Circle className="h-5 w-5 shrink-0 text-muted" aria-hidden />}
              <span className="min-w-0 flex-1"><strong>{r.code}</strong> <span className="text-muted">{r.title ?? ""}</span></span>
              {r.status === "COMPLETED" && <Badge tone="open">Passed{r.grade ? `, ${r.grade}` : ""}</Badge>}
              {r.status === "IN_PROGRESS" && <Badge tone="almost">In progress</Badge>}
              {r.status === "REMAINING" && <Badge tone="neutral">Still needed</Badge>}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

import { Link } from "react-router-dom";
import { CourseActions } from "@/components/CourseRow";
import { SeatStrip } from "@/components/SeatStrip";
import { Badge, EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/ui";
import { useRecommendations } from "@/lib/queries";

export function Next() {
  const q = useRecommendations();
  return (
    <>
      <PageHeader title="What can I take next?" description="Courses this term whose prerequisites you have met, that do not clash with your current classes, and that fit your unit limit." />
      {q.isLoading && <LoadingRows rows={4} />}
      {q.isError && <ErrorState error={q.error} retry={() => void q.refetch()} />}
      {q.data && q.data.recommendations.length === 0 && <EmptyState title="Nothing to suggest right now">You may already have a full schedule, or every remaining course needs a prerequisite you have not finished. <Link to="/catalog" className="font-medium underline">Browse the full catalog</Link>.</EmptyState>}
      <ul className="space-y-3">
        {q.data?.recommendations.map((r) => (
          <li key={r.course.id} className="grid gap-4 rounded-xl border border-line bg-surface p-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link to={`/catalog/${r.course.id}`} className="font-display text-lg font-bold hover:underline">{r.course.code}</Link>
                <span className="font-medium">{r.course.title}</span>
                {r.requiredByProgram && <Badge tone="brand">Required for your program</Badge>}
                {r.outcome === "WAITLIST" && <Badge tone="wait">Full: waitlist</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted">{r.course.meetingSummary}, {r.course.units} {r.course.units === 1 ? "unit" : "units"}{r.course.instructorName ? `, ${r.course.instructorName}` : ""}</p>
              {r.warnings.map((w, i) => <p key={i} className="mt-1 text-sm text-almost">{w.message}</p>)}
            </div>
            <SeatStrip capacity={r.course.capacity} enrolled={r.course.enrolledCount} waitlisted={r.course.waitlistedCount} availability={r.course.availability} />
            <CourseActions course={{ ...r.course, mine: null }} verdict={{ outcome: r.outcome, violations: r.warnings, wouldBeWaitlistPosition: null }} />
          </li>
        ))}
      </ul>
    </>
  );
}

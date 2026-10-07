import { Link } from "react-router-dom";
import { SeatStrip } from "@/components/SeatStrip";
import { Button, EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/ui";
import { useInstructorCourses } from "@/lib/queries";
import { useTerm } from "@/lib/state";

export function InstructorClasses() {
  const { termId, term } = useTerm();
  const q = useInstructorCourses(termId);
  return (
    <>
      <PageHeader title="My classes" description={term?.name} />
      {q.isLoading && <LoadingRows rows={3} />}
      {q.isError && <ErrorState error={q.error} retry={() => void q.refetch()} />}
      {q.data && q.data.courses.length === 0 && <EmptyState title="You are not teaching any classes this term" />}
      <ul className="space-y-3">
        {q.data?.courses.map((c) => (
          <li key={c.id} className="grid gap-4 rounded-xl border border-line bg-surface p-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center">
            <div><p className="flex flex-wrap items-baseline gap-x-3"><span className="font-display text-lg font-bold">{c.code}</span><span className="font-medium">{c.title}</span></p><p className="text-sm text-muted">{c.meetingSummary}{c.room ? `, ${c.room}` : ""}</p></div>
            <SeatStrip capacity={c.capacity} enrolled={c.enrolledCount} waitlisted={c.waitlistedCount} availability={c.availability} />
            <Button asChild><Link to={`/instructor/courses/${c.id}`}>Class roster and grades</Link></Button>
          </li>
        ))}
      </ul>
    </>
  );
}

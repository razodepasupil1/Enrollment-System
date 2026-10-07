import { CalendarArrowDown, CircleAlert } from "lucide-react";
import { Timetable } from "@/components/Timetable";
import { Button, EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/ui";
import { useSchedule } from "@/lib/queries";
import { useTerm } from "@/lib/state";

export function Schedule() {
  const { termId } = useTerm();
  const q = useSchedule(termId);
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const s = q.data!;
  const codes = new Set(s.conflicts.flatMap((c) => [c.a, c.b]));
  const courses = [...new Map(s.blocks.map((b) => [b.code, b])).values()];

  return (
    <>
      <PageHeader title="Weekly schedule" description={`${s.termName}. Dashed blocks are waitlisted classes.`}
        actions={s.blocks.some((b) => b.status === "ENROLLED") ? (
          <Button asChild variant="secondary"><a href={`/api/me/schedule.ics${termId ? `?termId=${termId}` : ""}`} download="timetable.ics"><CalendarArrowDown className="h-4 w-4" aria-hidden />Export to calendar (.ics)</a></Button>
        ) : undefined} />
      {s.conflicts.length > 0 && (
        <div role="alert" className="mb-4 rounded-xl border border-full/40 bg-full-bg p-4 text-full">
          <p className="flex items-center gap-2 font-semibold"><CircleAlert className="h-5 w-5" aria-hidden />Some of your classes overlap</p>
          <ul className="mt-1 list-disc pl-6">{s.conflicts.map((c) => <li key={c.summary}>{c.summary}</li>)}</ul>
        </div>
      )}
      {s.blocks.length === 0 ? <EmptyState title="No classes this term">Enroll in a course and it will appear here.</EmptyState> : (
        <>
          <Timetable blocks={s.blocks} conflictCodes={codes} />
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2" aria-label="Legend">
            {courses.map((b) => (
              <li key={b.code} className="flex items-center gap-2 text-sm">
                <span aria-hidden className="h-3.5 w-3.5 rounded border" style={{ background: `var(--c${b.colorIndex}-bg)`, borderColor: `var(--c${b.colorIndex}-bd)` }} />{b.code} {b.title}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

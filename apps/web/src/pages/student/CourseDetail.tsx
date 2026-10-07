import { ArrowLeft, CheckCircle2, CircleAlert, Clock, DoorOpen, UserRound } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { CourseActions } from "@/components/CourseRow";
import { SeatStrip, availabilityLabel } from "@/components/SeatStrip";
import { Badge, Button, ErrorState, LoadingRows, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useCourse, useValidation } from "@/lib/queries";

export function CourseDetail() {
  const id = Number(useParams().id);
  const course = useCourse(Number.isInteger(id) ? id : null);
  const verdict = useValidation([id], [], Number.isInteger(id));

  if (course.isLoading) return <LoadingRows rows={4} />;
  if (course.isError) return <ErrorState error={course.error} retry={() => void course.refetch()} />;
  const c = course.data!;
  const v = verdict.data?.results[id];
  const blocks = v?.violations.filter((x) => x.severity === "block") ?? [];
  const warns = v?.violations.filter((x) => x.severity === "warn") ?? [];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2"><Link to="/catalog"><ArrowLeft className="h-4 w-4" aria-hidden />Back to catalog</Link></Button>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1>{c.code} {c.title}</h1>
          <Badge tone={c.availability === "OPEN" ? "open" : c.availability === "FULL" ? "full" : "almost"}>{availabilityLabel(c.availability)}</Badge>
        </div>
        <p className="mt-1 text-muted">{c.departmentName}, {c.termName}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Panel title="About this course">
            <p>{c.description || "No description has been added yet."}</p>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div><dt className="flex items-center gap-1.5 text-sm text-muted"><Clock className="h-4 w-4" aria-hidden />Meets</dt><dd className="font-medium">{c.meetingSummary}</dd></div>
              <div><dt className="flex items-center gap-1.5 text-sm text-muted"><DoorOpen className="h-4 w-4" aria-hidden />Room</dt><dd className="font-medium">{c.room ?? "To be announced"}</dd></div>
              <div><dt className="flex items-center gap-1.5 text-sm text-muted"><UserRound className="h-4 w-4" aria-hidden />Instructor</dt><dd className="font-medium">{c.instructorName ?? "To be announced"}</dd></div>
              <div><dt className="text-sm text-muted">Units</dt><dd className="font-medium">{c.units}</dd></div>
              {c.dropDeadline && <div><dt className="text-sm text-muted">Drop deadline for this course</dt><dd className="font-medium">{formatDateTime(c.dropDeadline)}</dd></div>}
            </dl>
          </Panel>

          <Panel title="Requirements">
            {c.prerequisites.length === 0 && c.corequisites.length === 0 ? <p className="text-muted">No prerequisites or corequisites.</p> : (
              <div className="space-y-4">
                {c.prerequisites.length > 0 && (
                  <div><h3 className="mb-1">Prerequisites</h3>
                    <ul className="space-y-1">{c.prerequisites.map((p) => (
                      <li key={p.code}><Link to={`/catalog?q=${p.code}`} className="font-medium underline">{p.code}</Link> {c.prerequisiteTitles[p.code] ?? ""}{p.minGrade !== null ? `, with a grade of at least ${p.minGrade.toFixed(2)}` : ""}</li>
                    ))}</ul></div>
                )}
                {c.corequisites.length > 0 && (
                  <div><h3 className="mb-1">Corequisites</h3><p className="text-muted">Must be taken in the same term. Add both to your course selection and enroll together.</p>
                    <ul className="mt-1 space-y-1">{c.corequisites.map((p) => <li key={p}><Link to={`/catalog?q=${p}`} className="font-medium underline">{p}</Link> {c.prerequisiteTitles[p] ?? ""}</li>)}</ul></div>
                )}
              </div>
            )}
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel title="Seats">
            <SeatStrip capacity={c.capacity} enrolled={c.enrolledCount} waitlisted={c.waitlistedCount} availability={c.availability} />
            <div className="mt-5"><CourseActions course={c} verdict={v} /></div>
          </Panel>
          {!c.mine && v && (
            <Panel title={blocks.length ? "Why you cannot enroll yet" : "You can enroll"}>
              {blocks.length === 0 && warns.length === 0 && <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-open" aria-hidden />You meet every requirement for this course.</p>}
              <ul className="space-y-2">
                {blocks.map((x, i) => <li key={`b${i}`} className="flex items-start gap-2 text-full"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />{x.message}</li>)}
                {warns.map((x, i) => <li key={`w${i}`} className="flex items-start gap-2 text-almost"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />{x.message}</li>)}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}

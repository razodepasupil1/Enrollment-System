import { Link } from "react-router-dom";
import { Clock, DoorOpen, ShoppingCart, UserRound } from "lucide-react";
import { toast } from "sonner";
import type { CatalogItemDTO, ValidationDTO } from "@enroll/shared";
import { ApiError, errorMessage } from "@/lib/api";
import { useEnroll } from "@/lib/queries";
import { useCart } from "@/lib/state";
import { Badge, Button, Tip } from "./ui";
import { availabilityLabel, SeatStrip } from "./SeatStrip";

/** Plain-language reasons a course is blocked: every blocking violation from the rule engine, not just the first. */
export function BlockedReasons({ verdict }: { verdict: ValidationDTO }) {
  const blocks = verdict.violations.filter((v) => v.severity === "block");
  return (
    <ul className="space-y-1">
      {blocks.map((v, i) => <li key={`${v.code}${i}`}>{v.message}</li>)}
    </ul>
  );
}

/** Success/failure feedback for an enrollment attempt. Shared by the catalog, course page, and command palette. */
export function useEnrollAction() {
  const enroll = useEnroll();
  return {
    pending: enroll.isPending,
    run: (course: { id: number; code: string }) =>
      enroll.mutate({ courseId: course.id }, {
        onSuccess: (r) => r.status === "ENROLLED"
          ? toast.success(`Enrolled in ${course.code}`)
          : toast.info(`${course.code} is full. You are #${r.waitlistPosition} on the waitlist.`),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : errorMessage(e)),
      }),
  };
}

export function CourseActions({ course, verdict }: { course: CatalogItemDTO; verdict?: ValidationDTO | undefined }) {
  const cart = useCart();
  const { run, pending } = useEnrollAction();
  const inCart = cart.has(course.id);

  if (course.mine) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {course.mine.status === "ENROLLED"
          ? <Badge tone="open">Enrolled</Badge>
          : <Badge tone="wait">Waitlisted #{course.mine.waitlistPosition}</Badge>}
        <Button asChild variant="secondary" size="sm"><Link to="/enrollments">Manage</Link></Button>
      </div>
    );
  }

  const blocked = verdict?.outcome === "BLOCKED";
  const label = verdict?.outcome === "WAITLIST" ? "Join waitlist" : "Enroll";
  const button = (
    <Button size="sm" disabled={blocked} loading={pending} onClick={() => run(course)} aria-label={`${label} ${course.code}`}>{label}</Button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {blocked ? <Tip content={<BlockedReasons verdict={verdict!} />}>{button}</Tip> : button}
      <Button variant="secondary" size="sm" onClick={() => (inCart ? cart.remove(course.id) : cart.add(course.id))} aria-pressed={inCart} aria-label={`${inCart ? "Remove" : "Add"} ${course.code} ${inCart ? "from" : "to"} course selection`}>
        <ShoppingCart className="h-4 w-4" aria-hidden />{inCart ? "In selection" : "Add to selection"}
      </Button>
    </div>
  );
}

export function CourseRow({ course, verdict }: { course: CatalogItemDTO; verdict?: ValidationDTO | undefined }) {
  const blocks = verdict?.violations.filter((v) => v.severity === "block") ?? [];
  return (
    <li className="grid gap-4 rounded-xl border border-line bg-surface p-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link to={`/catalog/${course.id}`} className="font-display text-lg font-bold hover:underline">{course.code}</Link>
          <span className="font-medium">{course.title}</span>
          <Badge tone={course.availability === "OPEN" ? "open" : course.availability === "FULL" ? "full" : "almost"}>{availabilityLabel(course.availability)}</Badge>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" aria-hidden />{course.meetingSummary}</span>
          {course.room && <span className="inline-flex items-center gap-1.5"><DoorOpen className="h-3.5 w-3.5" aria-hidden />{course.room}</span>}
          {course.instructorName && <span className="inline-flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" aria-hidden />{course.instructorName}</span>}
          <span>{course.units} {course.units === 1 ? "unit" : "units"}</span>
        </div>
        {blocks.length > 0 && !course.mine && <p className="mt-2 text-sm text-full">{blocks[0]!.message}{blocks.length > 1 ? ` (and ${blocks.length - 1} more)` : ""}</p>}
      </div>
      <SeatStrip capacity={course.capacity} enrolled={course.enrolledCount} waitlisted={course.waitlistedCount} availability={course.availability} />
      <CourseActions course={course} verdict={verdict} />
    </li>
  );
}

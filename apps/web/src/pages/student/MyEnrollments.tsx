import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { MyEnrollmentDTO } from "@enroll/shared";
import { SeatStrip } from "@/components/SeatStrip";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useDrop, useMyEnrollments } from "@/lib/queries";
import { useTerm } from "@/lib/state";

/** The consequence of dropping, in the user's words. The server computes `dropPreview`; this only displays it. */
function dropCopy(e: MyEnrollmentDTO): { title: string; body: string; confirm: string; danger: boolean } {
  const code = e.course.code;
  if (e.status === "WAITLISTED") {
    return { title: `Leave the ${code} waitlist?`, body: `You will lose your place in line (you are #${e.waitlistPosition}). You can join again later, but you would go to the back.`, confirm: "Leave waitlist", danger: false };
  }
  if (e.dropPreview === "WITHDRAWN") {
    return { title: `Withdraw from ${code}?`, body: `The drop deadline for ${code} has passed. If you drop now, your seat is released and the course appears on your transcript as W (withdrawn).`, confirm: "Withdraw (W on transcript)", danger: true };
  }
  return { title: `Drop ${code}?`, body: `Your seat is released and ${code} is removed from your record. It will not appear on your transcript.`, confirm: "Drop course", danger: true };
}

export function MyEnrollments() {
  const { termId, isCurrent, term } = useTerm();
  const q = useMyEnrollments(termId);
  const drop = useDrop();
  const [target, setTarget] = useState<MyEnrollmentDTO | null>(null);

  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const all = q.data!.enrollments;
  const enrolled = all.filter((e) => e.status === "ENROLLED");
  const waitlisted = all.filter((e) => e.status === "WAITLISTED");
  const history = all.filter((e) => !["ENROLLED", "WAITLISTED"].includes(e.status));

  const confirmDrop = () => {
    if (!target) return;
    const e = target;
    drop.mutate(e.id, {
      onSuccess: (r) => {
        toast.success(r.status === "WITHDRAWN" ? `Withdrawn from ${e.course.code}. It will show as W.` : e.status === "WAITLISTED" ? `Left the ${e.course.code} waitlist.` : `Dropped ${e.course.code}.`);
        setTarget(null);
      },
      onError: (err) => { toast.error(errorMessage(err)); setTarget(null); },
    });
  };

  const Row = ({ e }: { e: MyEnrollmentDTO }) => (
    <li className="grid gap-4 rounded-xl border border-line bg-surface p-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link to={`/catalog/${e.course.id}`} className="font-display text-lg font-bold hover:underline">{e.course.code}</Link>
          <span className="font-medium">{e.course.title}</span>
          {e.status === "WAITLISTED" && <Badge tone="wait">Waitlisted #{e.waitlistPosition}</Badge>}
          {e.status === "ENROLLED" && e.dropPreview === "WITHDRAWN" && <Badge tone="almost">Past drop deadline</Badge>}
          {e.status === "WITHDRAWN" && <Badge tone="neutral">W</Badge>}
          {(e.status === "COMPLETED" || e.status === "FAILED") && <Badge tone={e.status === "COMPLETED" ? "open" : "full"}>Grade {e.gradeDisplay}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted">{e.course.meetingSummary}{e.course.room ? `, ${e.course.room}` : ""}, {e.course.units} {e.course.units === 1 ? "unit" : "units"}</p>
      </div>
      <SeatStrip capacity={e.course.capacity} enrolled={e.course.enrolledCount} waitlisted={e.course.waitlistedCount} availability={e.course.availability} />
      <div>
        {(e.status === "ENROLLED" || e.status === "WAITLISTED") && isCurrent && (
          <Button variant="secondary" size="sm" onClick={() => setTarget(e)} aria-label={`${e.status === "WAITLISTED" ? "Leave waitlist for" : "Drop"} ${e.course.code}`}>{e.status === "WAITLISTED" ? "Leave waitlist" : "Drop"}</Button>
        )}
      </div>
    </li>
  );
  const Section = ({ title, items }: { title: string; items: MyEnrollmentDTO[] }) => items.length === 0 ? null : (
    <section className="mb-8" aria-labelledby={`h-${title}`}><h2 id={`h-${title}`} className="mb-3">{title} ({items.length})</h2><ul className="space-y-3">{items.map((e) => <Row key={e.id} e={e} />)}</ul></section>
  );

  const copy = target ? dropCopy(target) : null;
  return (
    <>
      <PageHeader title="My enrollments" description={term ? `${term.name}. Drop deadline: ${new Date(term.dropDeadline).toLocaleDateString(undefined, { dateStyle: "long" })}.` : undefined} actions={<Button asChild variant="secondary"><Link to="/catalog">Add a course</Link></Button>} />
      {all.length === 0 && <EmptyState title="You are not enrolled in anything this term" action={<Button asChild><Link to="/catalog">Browse the catalog</Link></Button>}>Courses you enroll in or join a waitlist for will appear here.</EmptyState>}
      <Section title="Enrolled" items={enrolled} />
      <Section title="Waitlisted" items={waitlisted} />
      <Section title="Finished or withdrawn" items={history} />
      {copy && <ConfirmDialog open onOpenChange={(o) => !o && setTarget(null)} title={copy.title} description={copy.body} confirmLabel={copy.confirm} danger={copy.danger} loading={drop.isPending} onConfirm={confirmDrop} />}
    </>
  );
}

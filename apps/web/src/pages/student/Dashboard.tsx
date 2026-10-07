import { CalendarClock, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Button, EmptyState, ErrorState, LoadingRows, PageHeader, Panel, ProgressBar } from "@/components/ui";
import { dayLabel, formatMinutes, gpaText, timeAgo } from "@/lib/format";
import { useAnnouncements, useNotifications, useSchedule, useSummary } from "@/lib/queries";
import { nextClasses, whenLabel } from "@/lib/schedule";
import { useCart } from "@/lib/state";

const STANDING_TEXT = { FRESHMAN: "First year", SOPHOMORE: "Second year", JUNIOR: "Third year", SENIOR: "Fourth year or above" } as const;

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Dashboard() {
  const summary = useSummary();
  const schedule = useSchedule();
  const notes = useNotifications();
  const news = useAnnouncements();
  const cart = useCart();

  if (summary.isLoading) return <LoadingRows rows={5} />;
  if (summary.isError) return <ErrorState error={summary.error} retry={() => void summary.refetch()} />;
  const s = summary.data!;
  const upcoming = nextClasses(schedule.data?.blocks ?? [], new Date(), 5);
  const next = upcoming[0];

  return (
    <>
      <PageHeader title={`${greeting()}, ${s.student.fullName.split(" ")[0]}`} description={`${s.term?.name ?? "No term"} for ${s.student.program}, ${STANDING_TEXT[s.student.standing].toLowerCase()}.`}
        actions={<><Button asChild variant="secondary"><Link to="/catalog">Browse courses</Link></Button>{cart.ids.length > 0 && <Button asChild><Link to="/cart">Review course selection ({cart.ids.length})</Link></Button>}</>} />

      {s.activeHolds.map((h) => (
        <div key={h.id} role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-full/40 bg-full-bg p-4 text-full">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div><p className="font-semibold">A {h.type.toLowerCase()} hold is blocking your enrollment</p><p>{h.reason}</p></div>
        </div>
      ))}

      {/* The most useful thing on this page is the next class, so it leads. */}
      <section aria-labelledby="next-heading" className="mb-6 rounded-xl border border-line bg-surface p-6">
        <h2 id="next-heading" className="mb-3 text-base text-muted">Next class</h2>
        {next ? (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-display text-3xl font-bold">{next.code} <span className="font-medium">{next.title}</span></p>
              <p className="mt-1 text-lg">{whenLabel(next.daysAway, dayLabel(next.day))} at {formatMinutes(next.startMin)}{next.room ? `, ${next.room}` : ""}</p>
            </div>
            <Button asChild variant="secondary"><Link to="/schedule"><CalendarClock className="h-4 w-4" aria-hidden />Weekly schedule</Link></Button>
          </div>
        ) : <p className="text-lg text-muted">You have no classes scheduled. <Link to="/catalog" className="font-medium text-brand underline">Find a course</Link>.</p>}
      </section>

      {/* One summary strip with dividers instead of a row of identical tiles. */}
      <dl className="mb-6 grid divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <div className="p-5"><dt className="text-sm text-muted">Courses</dt><dd className="mt-1 font-display text-2xl font-bold">{s.enrolledCount}</dd><dd className="text-sm text-muted">{s.waitlistedCount ? `${s.waitlistedCount} on a waitlist` : "enrolled this term"}</dd></div>
        <div className="p-5">
          <dt className="text-sm text-muted">Units</dt>
          <dd className="mt-1 font-display text-2xl font-bold">{s.unitsUsed} <span className="text-base font-medium text-muted">of {s.unitsLimit}</span></dd>
          <dd className="mt-2"><ProgressBar value={s.unitsUsed} max={s.unitsLimit} label="Units used" tone={s.unitsUsed >= s.unitsLimit ? "full" : "brand"} /></dd>
          {s.unitsUsed >= s.unitsLimit && <dd className="mt-1 text-sm text-full">At your limit. <Link to="/overload" className="underline">Request more units</Link></dd>}
        </div>
        <div className="p-5"><dt className="text-sm text-muted">Cumulative GPA</dt><dd className="mt-1 font-display text-2xl font-bold">{gpaText(s.gpa)}</dd><dd className="text-sm text-muted"><Link to="/transcript" className="underline">View transcript</Link></dd></div>
        <div className="p-5"><dt className="text-sm text-muted">Student number</dt><dd className="mt-1 font-display text-2xl font-bold">{s.student.studentNumber}</dd><dd className="text-sm text-muted">{s.student.program}</dd></div>
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Coming up">
          {upcoming.length === 0 ? <p className="text-muted">Nothing coming up this week.</p> : (
            <ul className="divide-y divide-line">
              {upcoming.map((b, i) => (
                <li key={`${b.enrollmentId}-${b.day}-${i}`} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span><strong>{b.code}</strong> <span className="text-muted">{b.title}</span></span>
                  <span className="shrink-0 text-sm">{whenLabel(b.daysAway, dayLabel(b.day))} {formatMinutes(b.startMin)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent notifications" actions={<Badge tone={notes.data?.unreadCount ? "brand" : "neutral"}>{notes.data?.unreadCount ?? 0} unread</Badge>}>
          {!notes.data?.items.length ? <p className="text-muted">No notifications yet.</p> : (
            <ul className="divide-y divide-line">
              {notes.data.items.slice(0, 4).map((n) => (
                <li key={n.id} className="py-2.5"><p className={n.isRead ? "" : "font-semibold"}>{n.title}</p><p className="text-sm text-muted">{n.body}</p><p className="text-xs text-muted">{timeAgo(n.createdAt)}</p></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {news.data && news.data.announcements.length > 0 && (
        <Panel title="From the registrar" className="mt-6">
          <ul className="space-y-4">
            {news.data.announcements.slice(0, 3).map((a) => <li key={a.id}><p className="font-semibold">{a.title}</p><p className="text-muted">{a.body}</p></li>)}
          </ul>
        </Panel>
      )}
      {!schedule.data && !schedule.isLoading && <EmptyState title="Schedule unavailable" />}
    </>
  );
}

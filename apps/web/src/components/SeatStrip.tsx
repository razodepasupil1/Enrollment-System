import type { Availability } from "@enroll/shared";
import { cn } from "@/lib/utils";

const FILL: Record<Availability, string> = { OPEN: "bg-open", ALMOST_FULL: "bg-almost", FULL: "bg-full" };
const LABEL: Record<Availability, string> = { OPEN: "Open", ALMOST_FULL: "Almost full", FULL: "Full" };
export const availabilityLabel = (a: Availability): string => LABEL[a];

/**
 * Every seat in a course, drawn as a pip: filled = taken. People queued on the waitlist follow as dots.
 * Small classes show one pip per seat (so "3 seats, all taken, 2 waiting" reads at a glance); large ones
 * compress to 20 segments. The text label is always there too, so colour is never the only signal.
 */
export function SeatStrip({ capacity, enrolled, waitlisted, availability, className }: { capacity: number; enrolled: number; waitlisted: number; availability: Availability; className?: string }) {
  const individual = capacity <= 12;
  const slots = individual ? capacity : 20;
  const filled = individual ? Math.min(enrolled, capacity) : enrolled > 0 ? Math.max(1, Math.round((Math.min(enrolled, capacity) / capacity) * slots)) : 0;
  const shownDots = Math.min(waitlisted, 8);
  const summary = `${enrolled} of ${capacity} seats taken${waitlisted ? `, ${waitlisted} on the waitlist` : ""}`;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div role="img" aria-label={summary} className="flex flex-wrap items-center gap-[3px]">
        {Array.from({ length: slots }, (_, i) => (
          <span key={i} className={cn("h-3 rounded-[3px] border", individual ? "w-4" : "w-1.5", i < filled ? `${FILL[availability]} border-transparent` : "border-line bg-transparent")} />
        ))}
        {capacity === 0 && <span className="text-sm text-muted">No seats</span>}
        {shownDots > 0 && <span className="mx-1 h-3 w-px bg-line" aria-hidden />}
        {Array.from({ length: shownDots }, (_, i) => <span key={`w${i}`} className="h-2.5 w-2.5 rounded-full bg-wait" />)}
        {waitlisted > shownDots && <span className="ml-0.5 text-xs font-semibold text-wait">+{waitlisted - shownDots}</span>}
      </div>
      <p className="text-sm text-muted">
        <span className="font-semibold text-ink">{enrolled}/{capacity}</span> seats taken
        {waitlisted > 0 && <span className="text-wait"> and {waitlisted} waiting</span>}
      </p>
    </div>
  );
}

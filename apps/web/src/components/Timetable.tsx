import type { Day, ScheduleBlockDTO } from "@enroll/shared";
import { DAY_ORDER, dayLabel, formatMinutes, formatRange } from "@/lib/format";
import { cn } from "@/lib/utils";

const HOUR_PX = 56;

interface Placed { block: ScheduleBlockDTO; lane: number; lanes: number }

/** Places a day's blocks side by side when they overlap, so a clash is visible instead of hidden underneath. */
function layoutDay(blocks: ScheduleBlockDTO[]): Placed[] {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => { const lanes = Math.max(1, ...cluster.map((p) => p.lane + 1)); cluster.forEach((p) => out.push({ ...p, lanes })); cluster = []; };
  for (const block of sorted) {
    if (cluster.length && block.startMin >= clusterEnd) { flush(); clusterEnd = -1; }
    const used = new Set(cluster.filter((p) => p.block.endMin > block.startMin).map((p) => p.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ block, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, block.endMin);
  }
  flush();
  return out;
}

const colorStyle = (i: number) => ({ background: `var(--c${i}-bg)`, color: `var(--c${i}-fg)`, borderColor: `var(--c${i}-bd)` });

export function Timetable({ blocks, conflictCodes }: { blocks: ScheduleBlockDTO[]; conflictCodes: Set<string> }) {
  const days: Day[] = DAY_ORDER.filter((d, i) => i < 5 || blocks.some((b) => b.day === d));
  const startHour = Math.min(8, ...blocks.map((b) => Math.floor(b.startMin / 60)));
  const endHour = Math.max(17, ...blocks.map((b) => Math.ceil(b.endMin / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const height = (endHour - startHour) * HOUR_PX;

  return (
    <>
      {/* Phones get an agenda: a 7-column grid is unreadable at 360px. */}
      <div className="space-y-4 md:hidden">
        {days.map((d) => {
          const todays = blocks.filter((b) => b.day === d).sort((a, b) => a.startMin - b.startMin);
          if (todays.length === 0) return null;
          return (
            <section key={d} aria-label={dayLabel(d)}>
              <h3 className="mb-2">{dayLabel(d)}</h3>
              <ul className="space-y-2">
                {todays.map((b) => (
                  <li key={`${b.enrollmentId}-${b.startMin}`} style={colorStyle(b.colorIndex)} className={cn("rounded-lg border p-3", b.status === "WAITLISTED" && "border-dashed", conflictCodes.has(b.code) && "conflict-stripes")}>
                    <p className="font-semibold">{b.code} {b.title}</p>
                    <p className="text-sm">{formatRange(b.startMin, b.endMin)}{b.room ? `, ${b.room}` : ""}{b.status === "WAITLISTED" ? ", waitlisted" : ""}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
        <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((d) => <div key={d} className="border-b border-l border-line bg-sunken px-2 py-2 text-center text-sm font-semibold">{dayLabel(d)}</div>)}
          <div className="relative" style={{ height }} aria-hidden>
            {hours.map((h, i) => <span key={h} className="absolute right-2 -translate-y-2 text-xs text-muted" style={{ top: i * HOUR_PX }}>{i === 0 ? "" : formatMinutes(h * 60)}</span>)}
          </div>
          {days.map((d) => (
            <div key={d} className="relative border-l border-line" style={{ height }} role="group" aria-label={`${dayLabel(d)} classes`}>
              {hours.map((h, i) => <div key={h} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR_PX }} aria-hidden />)}
              {layoutDay(blocks.filter((b) => b.day === d)).map(({ block: b, lane, lanes }) => (
                <div key={`${b.enrollmentId}-${b.startMin}`}
                  style={{ ...colorStyle(b.colorIndex), top: ((b.startMin - startHour * 60) / 60) * HOUR_PX + 1, height: ((b.endMin - b.startMin) / 60) * HOUR_PX - 2, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                  className={cn("absolute overflow-hidden rounded-md border px-2 py-1 text-xs leading-tight", b.status === "WAITLISTED" && "border-dashed", conflictCodes.has(b.code) && "conflict-stripes ring-2 ring-full")}
                  title={`${b.code} ${b.title}, ${formatRange(b.startMin, b.endMin)}${b.room ? `, ${b.room}` : ""}`}>
                  <p className="font-bold">{b.code}</p>
                  <p className="truncate">{b.title}</p>
                  <p>{formatRange(b.startMin, b.endMin)}</p>
                  {b.status === "WAITLISTED" && <p className="font-semibold">Waitlisted</p>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

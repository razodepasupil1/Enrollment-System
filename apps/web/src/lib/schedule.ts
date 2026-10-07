import type { ScheduleBlockDTO } from "@enroll/shared";
import { DAY_ORDER } from "./format";

const JS_TO_DAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

/** Display-only helper: the next class meeting on or after `now`, in the browser's local time. */
export function nextClasses(blocks: ScheduleBlockDTO[], now = new Date(), limit = 5): Array<ScheduleBlockDTO & { daysAway: number }> {
  const today = DAY_ORDER.indexOf(JS_TO_DAY[now.getDay()]!);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return blocks
    .filter((b) => b.status === "ENROLLED")
    .map((b) => {
      let away = (DAY_ORDER.indexOf(b.day) - today + 7) % 7;
      if (away === 0 && b.endMin <= nowMin) away = 7; // already finished today: next week
      return { ...b, daysAway: away };
    })
    .sort((a, b) => a.daysAway - b.daysAway || a.startMin - b.startMin)
    .slice(0, limit);
}

export const whenLabel = (daysAway: number, dayName: string): string =>
  daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : dayName;

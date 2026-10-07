import { DAYS, type Day } from "./types.js";

const DAY_LABELS: Record<Day, string> = {
  MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun",
};

export const dayLabel = (d: Day): string => DAY_LABELS[d];
export const dayIndex = (d: Day): number => DAYS.indexOf(d);

/** 570 -> "9:30", 810 -> "13:30". 24h on purpose: "1:30" would be ambiguous in an error message. */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Messages are built server-side in UTC; the UI converts to local time for display. */
export function formatUtc(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

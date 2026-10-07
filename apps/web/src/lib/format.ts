import type { Day } from "@enroll/shared";

export const DAY_ORDER: Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_LABEL: Record<Day, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };
export const dayLabel = (d: Day): string => DAY_LABEL[d];

/** 570 -> "9:30", 810 -> "13:30" (24-hour, matching the server's messages exactly). */
export function formatMinutes(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

export const formatRange = (start: number, end: number): string => `${formatMinutes(start)}-${formatMinutes(end)}`;

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const formatDate = (iso: string): string => dateFmt.format(new Date(iso));
export const formatDateTime = (iso: string): string => dateTimeFmt.format(new Date(iso));

/** "3 minutes ago", "yesterday": for notifications and the audit log. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (s < 60) return "just now";
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86_400) return rtf.format(-Math.floor(s / 3600), "hour");
  return rtf.format(-Math.floor(s / 86_400), "day");
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
export const gpaText = (g: number | null): string => (g === null ? "No grades yet" : g.toFixed(2));

/** Escapes a value for a CSV export of the visible table (used by client-side copy helpers). */
export const ordinal = (n: number): string => `#${n}`;

/** ISO instant -> the "YYYY-MM-DDTHH:mm" string a datetime-local input wants (in the browser's zone). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v: string): string => new Date(v).toISOString();

/** "09:30" -> 570 and back, for the meeting-time inputs. */
export const timeToMinutes = (t: string): number => { const [h = "0", m = "0"] = t.split(":"); return Number(h) * 60 + Number(m); };
export const minutesToTime = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

import { InvariantError } from "../errors/index.js";
import { dayIndex, dayLabel, formatMinutes } from "./format.js";
import type { Day, Meeting, PrerequisiteRef } from "./types.js";

export interface CourseProps {
  id: number;
  code: string;
  title: string;
  description?: string;
  units: number;
  capacity: number;
  termId: number;
  instructorId: number | null;
  department: string;
  room: string | null;
  meetings: readonly Meeting[];
  prerequisites?: readonly PrerequisiteRef[];
  corequisites?: readonly string[];
  /** Overrides the term's drop deadline for this course (e.g. a short module). null = use the term's. */
  dropDeadline?: Date | null;
}

/**
 * A course OFFERING in one term (CS101 in Fall 2026), not the abstract catalog entry.
 * Seat counts are NOT stored here: they change under concurrency, so the service
 * counts them inside a locked transaction and passes `enrolledCount` into these methods.
 */
export class Course {
  readonly #id: number;
  readonly #code: string;
  readonly #title: string;
  readonly #description: string;
  readonly #units: number;
  readonly #capacity: number;
  readonly #termId: number;
  readonly #instructorId: number | null;
  readonly #department: string;
  readonly #room: string | null;
  readonly #meetings: readonly Meeting[];
  readonly #prerequisites: readonly PrerequisiteRef[];
  readonly #corequisites: readonly string[];
  readonly #dropDeadline: Date | null;

  constructor(p: CourseProps) {
    // Invariants are checked here so an invalid Course can never exist anywhere else in the system.
    if (!p.code.trim()) throw new InvariantError("Course code is required.");
    if (!p.title.trim()) throw new InvariantError("Course title is required.");
    if (!(p.units > 0)) throw new InvariantError("Course units must be greater than 0.");
    if (!Number.isInteger(p.capacity) || p.capacity < 0) {
      throw new InvariantError("Course capacity must be a whole number, 0 or more.");
    }
    for (const m of p.meetings) {
      if (m.startMin < 0 || m.endMin > 24 * 60 || m.endMin <= m.startMin) {
        throw new InvariantError(`Meeting on ${m.day} must end after it starts (within one day).`);
      }
    }
    this.#id = p.id;
    this.#code = p.code.trim().toUpperCase();
    this.#title = p.title.trim();
    this.#description = p.description ?? "";
    this.#units = p.units;
    this.#capacity = p.capacity;
    this.#termId = p.termId;
    this.#instructorId = p.instructorId;
    this.#department = p.department;
    this.#room = p.room;
    this.#meetings = Object.freeze(p.meetings.map((m) => Object.freeze({ ...m })));
    this.#prerequisites = Object.freeze([...(p.prerequisites ?? [])]);
    this.#corequisites = Object.freeze([...(p.corequisites ?? [])].map((c) => c.toUpperCase()));
    this.#dropDeadline = p.dropDeadline ?? null;
  }

  get id(): number { return this.#id; }
  get code(): string { return this.#code; }
  get title(): string { return this.#title; }
  get description(): string { return this.#description; }
  get units(): number { return this.#units; }
  get capacity(): number { return this.#capacity; }
  get termId(): number { return this.#termId; }
  get instructorId(): number | null { return this.#instructorId; }
  get department(): string { return this.#department; }
  get room(): string | null { return this.#room; }
  get meetings(): readonly Meeting[] { return this.#meetings; }
  get prerequisites(): readonly PrerequisiteRef[] { return this.#prerequisites; }
  get corequisites(): readonly string[] { return this.#corequisites; }
  get dropDeadline(): Date | null { return this.#dropDeadline; }

  availableSeats(enrolledCount: number): number {
    return Math.max(0, this.#capacity - enrolledCount);
  }

  isFull(enrolledCount: number): boolean {
    return enrolledCount >= this.#capacity;
  }

  /** 0..1, used by the UI capacity bar (green -> amber -> red). A zero-capacity course is always "full". */
  fillRatio(enrolledCount: number): number {
    if (this.#capacity === 0) return 1;
    return Math.min(1, enrolledCount / this.#capacity);
  }

  /** Pairs of meetings (this, other) that overlap. Back-to-back (10:30 end, 10:30 start) does NOT overlap. */
  overlappingMeetings(other: Course): Array<readonly [Meeting, Meeting]> {
    if (this.#termId !== other.termId || this.#id === other.id) return [];
    const pairs: Array<readonly [Meeting, Meeting]> = [];
    for (const a of this.#meetings) {
      for (const b of other.meetings) {
        if (a.day === b.day && a.startMin < b.endMin && b.startMin < a.endMin) pairs.push([a, b]);
      }
    }
    return pairs;
  }

  conflictsWith(other: Course): boolean {
    return this.overlappingMeetings(other).length > 0;
  }

  /** "Mon/Wed 9:00-10:30" (days sharing the same time slot are grouped). "TBA" when unscheduled. */
  meetingSummary(): string {
    if (this.#meetings.length === 0) return "TBA";
    const groups = new Map<string, { days: Day[]; startMin: number; endMin: number }>();
    const sorted = [...this.#meetings].sort(
      (a, b) => dayIndex(a.day) - dayIndex(b.day) || a.startMin - b.startMin,
    );
    for (const m of sorted) {
      const key = `${m.startMin}-${m.endMin}`;
      const g = groups.get(key) ?? { days: [], startMin: m.startMin, endMin: m.endMin };
      g.days.push(m.day);
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => `${g.days.map(dayLabel).join("/")} ${formatMinutes(g.startMin)}-${formatMinutes(g.endMin)}`)
      .join("; ");
  }
}

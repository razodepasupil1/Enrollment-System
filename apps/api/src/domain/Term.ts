import { InvariantError } from "../errors/index.js";
import type { ClassStanding } from "./types.js";

export interface TermProps {
  id: number;
  name: string;
  /** Exactly one term is "current": the one students may enroll in. */
  isCurrent: boolean;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  /** Dropping on or before this instant gives DROPPED; after it, WITHDRAWN ("W"). */
  dropDeadline: Date;
  endsAt: Date;
  /** Optional earlier opening per class standing (seniors register first). */
  priorityOpenings?: Partial<Record<ClassStanding, Date>>;
}

/** Small value-style class: public readonly data, validated once in the constructor. */
export class Term {
  readonly id: number;
  readonly name: string;
  readonly isCurrent: boolean;
  readonly registrationOpensAt: Date;
  readonly registrationClosesAt: Date;
  readonly dropDeadline: Date;
  readonly endsAt: Date;
  readonly #priority: Partial<Record<ClassStanding, Date>>;

  constructor(p: TermProps) {
    if (p.registrationClosesAt <= p.registrationOpensAt) {
      throw new InvariantError("Registration must close after it opens.");
    }
    if (p.endsAt <= p.registrationOpensAt) throw new InvariantError("Term must end after registration opens.");
    if (p.dropDeadline > p.endsAt) throw new InvariantError("Drop deadline must be before the term ends.");
    this.id = p.id;
    this.name = p.name;
    this.isCurrent = p.isCurrent;
    this.registrationOpensAt = p.registrationOpensAt;
    this.registrationClosesAt = p.registrationClosesAt;
    this.dropDeadline = p.dropDeadline;
    this.endsAt = p.endsAt;
    this.#priority = { ...(p.priorityOpenings ?? {}) };
  }

  /** When this class standing may start registering; falls back to the general opening. */
  openingFor(standing: ClassStanding): Date {
    return this.#priority[standing] ?? this.registrationOpensAt;
  }

  isBeforeDropDeadline(now: Date): boolean {
    return now.getTime() <= this.dropDeadline.getTime();
  }

  hasEnded(now: Date): boolean {
    return now.getTime() > this.endsAt.getTime();
  }
}

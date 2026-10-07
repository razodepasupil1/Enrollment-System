import { formatUtc } from "../domain/format.js";
import { block, type EnrollmentContext, type EnrollmentRule } from "./EnrollmentRule.js";

/** General open/close window, plus earlier "priority" openings per class standing. */
export class RegistrationWindowRule implements EnrollmentRule {
  readonly code = "REGISTRATION_WINDOW";
  check({ student, term, now }: EnrollmentContext) {
    if (now < term.registrationOpensAt) {
      return [block("REGISTRATION_NOT_OPEN", `Registration for ${term.name} opens on ${formatUtc(term.registrationOpensAt)}.`)];
    }
    if (now > term.registrationClosesAt) {
      return [block("REGISTRATION_CLOSED", `Registration for ${term.name} closed on ${formatUtc(term.registrationClosesAt)}.`)];
    }
    const standing = student.classStanding();
    const opening = term.openingFor(standing);
    if (now < opening) {
      return [
        block(
          "REGISTRATION_NOT_OPEN",
          `Registration for ${standing.toLowerCase()} students opens on ${formatUtc(opening)}.`,
        ),
      ];
    }
    return [];
  }
}

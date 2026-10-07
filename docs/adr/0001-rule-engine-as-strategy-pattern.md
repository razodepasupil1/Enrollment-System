# ADR 0001: Enrollment rules are a strategy interface run by an engine

**Status:** accepted

## Context
Enrollment depends on many independent conditions (capacity, prerequisites, schedule, units, holds, windows). A
single method full of `if` statements would grow with every new policy, report only the first failure, and be
awkward to test.

## Decision
Each condition is a class implementing `EnrollmentRule { code; check(ctx): Violation[] }`. `RuleEngine` runs every
rule and returns all violations. A violation is `block` or `warn`: blocks stop the action; the capacity rule only
warns, which turns "enroll" into "join the waitlist". Rules are pure: they read a pre-loaded `EnrollmentContext`
and a passed-in `now`, and never touch the database or the clock.

## Consequences
- Adding a rule is adding a class (open/closed). Nothing else changes.
- The same rules serve the real enroll, the dry-run cart check, and waitlist promotion.
- Every violation is shown at once, with a specific message.
- Rules cannot query the database, so the service must pre-load everything a rule might need. The context grows
  when a new rule needs new data.

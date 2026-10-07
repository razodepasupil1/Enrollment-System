# ADR 0005: Corequisites are satisfied by the same cart

**Status:** accepted. **Found by a failing test**, not by design review.

## Context
PHYS101 (lecture) and PHYS101L (lab) are corequisites of each other. The first version of `CorequisiteRule` required
the corequisite to be *already* enrolled. With a mutual pair that is unsatisfiable: the lecture needs the lab
first, and the lab needs the lecture first. A student could never enroll in either.

## Decision
`EnrollmentContext` carries `pendingCourseCodes`: the other courses in the same submission. A corequisite is
satisfied by (a) an active enrollment this term, (b) a passed course, or (c) being in the same cart. Because (c)
trusts a promise, `enrollBatch` checks it afterwards: if a course was admitted only because its partner was in the
cart and the partner then failed (say, a missing prerequisite), the dependent enrollment is rolled back, recorded
as `ROLLBACK` in the audit log, and reported as rejected. The rollback is always a plain `DROPPED`, never a "W".

## Consequences
- Enrolling in one half of a mutual pair on its own is refused with "Add both to your cart and enroll together."
- The dry-run endpoint accepts the cart, so the cart preview agrees with what submit will do.
- A course can briefly exist as enrolled during a batch before being rolled back.

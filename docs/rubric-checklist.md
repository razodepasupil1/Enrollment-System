# Rubric checklist

Every criterion mapped to the files and screens that satisfy it.

| Criterion | Weight | Where to look |
|---|---|---|
| **Implementation of classes** | 15% | `apps/api/src/domain/Student.ts`, `Course.ts`, `Enrollment.ts` (all attributes and methods, invariants checked in constructors); `Term.ts`, `GradingPolicy.ts`. Tests: `tests/domain/*.test.ts` |
| **OOP principles** | 10% | *Encapsulation:* ES private fields and getters in the three domain classes. *Association:* `Enrollment` links one `Student` and one `Course`. *Abstraction:* `EnrollmentRule` and `GradingPolicy` interfaces. *Polymorphism:* ten rule classes behind one interface (`rules/`), two grading strategies. *Single responsibility:* the layering in `docs/class-diagram.md` |
| **Enrollment functionality** | 15% | Enroll, drop, view, capacity, waitlist: `services/EnrollmentService.ts`. Screens: **Course catalog**, **Enrollment cart**, **My enrollments** (drop confirm), **Weekly schedule** |
| **Data handling** | 10% | `db/migrations/001_reference.sql` to `004_activity.sql` (normalized schema, foreign keys, CHECK constraints, generated-column unique keys); transactions in `db/transaction.ts`; seed in `db/seed.ts`; `docs/erd.md` |
| **System logic accuracy** | 10% | All rules in one engine (`rules/`), enforced server-side. Race safety: `tests/concurrency.test.ts` (25 simultaneous enrolls into 15 seats) and the **Rush Simulator** screen. Dry-run and real enroll share the same rules |
| **User interface / usability** | 10% | Seat strip (`components/SeatStrip.tsx`), live "why is this blocked" in the cart, drop dialog that says DROPPED vs W, URL-synced catalog filters, designed empty/error/loading states, responsive tables, light and dark themes, keyboard focus rings, skip link, reduced motion, command palette, contrast check (`pnpm contrast`) |
| **System explanation** | 5% | `README.md`, `docs/class-diagram.md` (class and state diagrams), `docs/erd.md`, `docs/adr/` (why, not just what), comments explaining *why* in the domain classes and transactions |
| **Demonstration** | 5% | Seeded demo accounts, one-click demo login, `docs/demo-script.md` (executed by `apps/api/tests/demo-script.test.ts`), **Rush Simulator** |
| **Individual contribution, teamwork, responsibility** | 20% | `CONTRIBUTING.md`, `CONTRIBUTORS.md`, `docs/peer-evaluation.md`. **This row depends on your git history: see CONTRIBUTORS.md** |

## Instructor's mandatory behaviour

| Requirement | Satisfied by |
|---|---|
| A student can enroll in a course | **Course catalog** > Enroll; `POST /api/enrollments` |
| A student can drop a course | **My enrollments** > Drop; `DELETE /api/enrollments/:id` |
| A student can view enrolled courses | **My enrollments**, **Weekly schedule**, **Certificate of registration** |
| A course has code, title, capacity and prevents over-enrollment | `Course` class; row lock plus count in `EnrollmentService`; concurrency tests |
| An enrollment links exactly one student and one course | `Enrollment` class; `uq_one_active` unique key |
| Students take many courses; courses hold many students | `enrollments` table; roster screens |
| Select, check availability, create enrollment, optionally drop, update records | Catalog, dry-run check, `enroll`, `drop`, audit log |
| Optional: prerequisites and grade input | `PrerequisiteRule`; instructor **Roster** grade entry |

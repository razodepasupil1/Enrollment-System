# Oral defense: likely questions

Short answers, each pointing at the code to show.

## Design

**Why a rule engine instead of `if` statements in the enroll method?**
Each business rule is one small class implementing `EnrollmentRule` (`apps/api/src/rules/`). The engine runs *all*
of them and returns every violation, so a student sees all their problems at once. Adding a rule means adding a
class and listing it in `defaultRules()`; no existing rule changes (open/closed principle). Rules are pure
functions of a pre-loaded context, so they are trivial to unit test and the same code powers both the real enroll
and the dry-run preview.

**Where is encapsulation? Where is polymorphism?**
`Student`, `Course`, and `Enrollment` use ES private fields (`#status`) with getters. `Enrollment.status` can only
change through `drop`, `promote`, `leaveWaitlist`, or `complete`, each of which throws on an illegal move.
Polymorphism: the engine treats all ten rules identically through the `EnrollmentRule` interface, and grading goes
through the `GradingPolicy` interface, which has a 4.0 and a 1.0 to 5.0 implementation.

**What is the association class?**
`Enrollment`. A student takes many courses and a course holds many students; that many-to-many lives in
`Enrollment`, which links exactly one student and one course and carries the relationship's own data (status,
grade, timestamps).

**Why do the layers matter?**
`http -> services -> (rules, repositories) -> domain`, downward only. Controllers hold no business rules,
repositories hold no business rules, and the domain imports no Express or mysql2, so the rules can be tested with
no database.

## Correctness under concurrency

**How is over-enrollment prevented when many students click at once?**
The rule engine decides whether an action is allowed; the *transaction* guarantees it is still allowed when we
write. `EnrollmentService.enroll` runs in one transaction: lock the student row, then lock the course row
(`SELECT ... FOR UPDATE`), *then* count the seats and run the rules, then insert. Everyone enrolling in that
course queues on the course lock, so exactly one request at a time sees "one seat left". See
`apps/api/src/services/EnrollmentService.ts` and `tests/concurrency.test.ts`.

**How do you know that test is real?**
I removed the `FOR UPDATE` and ran it: 19 students ended up seated in a 15-seat course, 10 students all won
the single remaining seat, and 5 enrollments got through a 2-course unit limit. With the locks restored the same tests pass. A test
that cannot fail proves nothing, so I checked that it can.

**Why `READ COMMITTED`?**
Under MySQL's default `REPEATABLE READ` a transaction reads from a snapshot taken at its first plain read, which
can predate the lock and show a stale head-count. With `READ COMMITTED` each statement sees the latest committed
rows, so the count taken after we hold the lock is current. (`apps/api/src/db/transaction.ts`)

**Why lock the student *and* the course, and in that order?**
The student lock stops one student racing themselves (a double-click, or two courses against one unit limit).
Always locking student then course gives every transaction the same order, which makes deadlocks rare. When one
does happen, MySQL aborts one transaction and `withTransaction` retries it up to three times.

**What about the database itself, if the application had a bug?**
A second line of defence: `UNIQUE (student_id, course_id, active_key)`. In the lock-removed experiment, the
double-click test failed with a raw duplicate-key error, which showed that this constraint holds even when the
locks do not.

**Why a generated column for that key?**
We need "at most one *active* enrollment per student per course", but a student may drop and re-enroll, so a plain
`UNIQUE (student_id, course_id)` is wrong. MySQL has no partial unique index. `active_key` is `1` for `ENROLLED`
or `WAITLISTED` and `NULL` otherwise, and `NULL`s never collide in a unique key.

**How is the waitlist position stored?**
It is not. It is derived by ordering on `(waitlisted_at, id)`. When someone drops there is nothing to renumber,
so there is no way for positions to go wrong.

**Why `COUNT(*)` for seats instead of a counter column?**
A counter is a second copy of the truth that can drift from the rows. `COUNT(*)` inside the locked transaction
cannot disagree with the data.

**What if the student at the front of the waitlist can no longer enroll?**
Promotion re-runs the rules for them. If they have since received a hold or filled their schedule they keep their
place, get a notification explaining why, and the seat is offered to the next student.

## Security

**Why an httpOnly cookie instead of localStorage for the token?**
JavaScript on the page cannot read an httpOnly cookie, so an XSS bug cannot steal the session. The cookie is also
`SameSite=Lax` (not sent on cross-site POST/PUT/DELETE, which is the CSRF defence) and `Secure` in production.

**Why two Vercel projects, and why proxy `/api`?**
Vercel hosts the static frontend and the API function as separate projects. The web project rewrites `/api/*` to
the API project, so the browser sees *one origin*: the cookie is first-party and no CORS configuration is needed.

**How do you prevent SQL injection?**
Every query uses `?` placeholders. Sort and filter inputs are mapped to fixed SQL through whitelists, never
concatenated. There is a test that puts `'; DROP TABLE courses;--` in the search box and checks the table survives.

**How are passwords stored?** bcrypt hashes; the API never returns a hash. Login takes the same time and gives the
same message whether the email or the password is wrong, so it cannot be used to discover accounts.

**Why does the server never trust the UI?**
A student's id comes from the signed session, never from the request body. A test sends another student's id in
the body and checks the enrollment is created for the signed-in student. Role checks and ownership checks are on
the server; the UI hides pages only for convenience.

**What does the admin override *not* bypass?**
Capacity. Over-enrollment is an invariant, not a policy. To seat someone in a full class an administrator must
raise the capacity first, which is itself audited.

## Honest limits

**What would you improve with more time?** See "Known limitations" in the README. The biggest: the interface was
tested in jsdom against the real API but has not been viewed in a real browser or with a screen reader.

**What bug did testing find in your own design?**
Three worth naming. (1) Mutual corequisites (a lecture and its lab each requiring the other) were impossible to
enroll in; fixed by letting a cart satisfy the corequisite and rolling back a lab whose lecture then failed
([ADR 0005](adr/0005-corequisites-are-taken-together.md)). (2) The one-click login and sign-out never changed
the screen, because clearing the query cache deleted the query the component was watching. (3) "Clear hold" and
"mark notification read" sent a bare id as the JSON body, which the server rightly rejected.

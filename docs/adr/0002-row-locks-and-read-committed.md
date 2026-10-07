# ADR 0002: Serialise enrollments with row locks under READ COMMITTED

**Status:** accepted

## Context
Many students can enroll in the last seat at the same instant. Checking a seat count and then inserting is a
classic race: two requests both see "one seat left" and both insert.

## Decision
Each enroll or drop runs in one transaction that first locks the student row, then the course row
(`SELECT ... FOR UPDATE`, always in that order), and only then reads the head-count, runs the rules, and writes.
Transactions use `READ COMMITTED`. Seats are counted with `COUNT(*)` inside the transaction rather than stored in
a counter column. Deadlocks (`ER_LOCK_DEADLOCK`) are retried up to three times.

## Why not the alternatives
- *A counter column (`seats_left`)*: a second copy of the truth. `COUNT(*)` cannot disagree with the rows.
- *`REPEATABLE READ`*: reads come from a snapshot that can predate the lock, giving a stale count.
- *Optimistic retry on a unique-key violation*: the rule that must hold ("count < capacity") is not expressible
  as a unique key, and it would not serialise the waitlist order.
- *`SERIALIZABLE`*: would also work but blocks far more than necessary and deadlocks more readily.

## Consequences
- Correctness is proven by tests with 25 concurrent enrolls against 15 seats, and *the tests were verified to fail
  when the locks are removed*.
- All enrollments for one course are serialised. That is the point; throughput per course is bounded by one
  short transaction at a time.
- Promotion takes locks in the opposite order (course, then the promoted student), so an occasional deadlock is
  possible and is handled by the retry.

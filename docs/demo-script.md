# Demo script (about 7 minutes)

Every step below is executed automatically by `apps/api/tests/demo-script.test.ts` on a fresh seed, so the
numbers and messages here are what the system really produces.

## Before you start

```bash
pnpm db:reset      # a clean, known state
pnpm dev           # DEMO_MODE=true in .env
```

Open **three browser windows** (use private windows so they do not share cookies): **A** for Ana, **B** for Faye,
**C** for the admin. Sign in to each from the "Try a demo account" list on the sign-in page.

| # | Time | Rubric rows it hits |
|---|---|---|
| 1 | 0:00 | Implementation of classes, user interface |
| 2 | 0:30 | Enrollment functionality, usability |
| 3 | 1:30 | System logic accuracy, OOP principles |
| 4 | 2:30 | Enrollment functionality |
| 5 | 3:15 | Data handling, system logic accuracy |
| 6 | 4:15 | Usability |
| 7 | 4:45 | Admin features, data handling |
| 8 | 5:45 | **System logic accuracy** (the headline) |
| 9 | 6:45 | System explanation |

## 1. Sign in as Ana Reyes (0:00 to 0:30), window A

Click **Ana Reyes**. The dashboard leads with the next class. Point at the summary strip: 2 courses, **6 of 21
units**, GPA **3.33**.

> *Say:* "Roles are student, instructor, and registrar. The session is a signed token in an httpOnly cookie, so
> JavaScript on the page can never read it."

## 2. Browse and filter (0:30 to 1:30)

Open **Course catalog**. In **Seats**, choose **Full classes**: only CS240 appears, its strip showing **3/3 seats
taken and 2 waiting**. Clear it. Search `data` (finds Data Structures). Sort by **Most seats left**.

> *Say:* "Every course shows its seats as pips. The filters are in the URL, so this exact view can be bookmarked.
> Seat counts refresh every 15 seconds."

## 3. The cart explains why (1:30 to 2:30)

On the catalog, **Add to cart** for **CS201** and **PHYS101**, then open **Enrollment cart**. Each item has been
checked against the real rules without writing anything:

- CS201: **Cannot enroll in CS201: requires CS102 (not completed)**
- PHYS101: **Schedule conflict with MATH120 (Mon/Wed 9:00-10:30)**, and that it must be taken together with
  PHYS101L.

Add **PHYS101L** to the cart: the corequisite message goes away; the conflict remains. Click **Check my cart for
overlaps** to show the schedule suggester naming the class it clashes with.

> *Say:* "All the rules live in one rule engine on the server. The UI never decides anything; it displays what the
> dry-run endpoint returns. It reports every problem at once, not just the first."

## 4. Enroll and join the waitlist (2:30 to 3:15)

Remove CS201, PHYS101, and PHYS101L. Add **CS102** and **CS250**, then **Enroll in all (2)**: the report shows
both **enrolled**. In the catalog, **Join waitlist** on **CS240**: Ana is **#3**.

## 5. Drop, and the second window (3:15 to 4:15)

In window **B** (Faye), open **My enrollments**: CS240 shows **Waitlisted #1**.

In window **A**, sign out and sign in as **Ben Cruz**. Open **My enrollments** and click **Drop** on CS240. The
dialog says the course "will not appear on your transcript". Confirm.

Back in window **B**, within 15 seconds (or refocus the window), CS240 moves to **Enrolled**, the bell shows a
new notification, and the other waitlisted students each move up one place.

*Optional (adds 20 seconds):* sign in as **Karl Lim**, click **Drop** on **GE102**. The dialog now warns the
drop deadline has passed and it will appear on the transcript as **W**.

> *Say:* "The promotion re-runs every rule for the student at the front of the line. If they had since got a hold,
> they would keep their place and be told why, and the next student would be offered the seat."

## 6. Timetable and certificate (4:15 to 4:45)

As Ana: **Weekly schedule** (colour per course, conflicts striped, waitlisted classes dashed), then **Export to
calendar**. Open **Certificate of registration** and show **Print / Save as PDF**.

## 7. The registrar (4:45 to 5:45), window C

Open **Courses**, then **Roster** for CS240: 3 enrolled, and the waitlist in order. Open **Holds**, **Place a
hold** on **Lia Mendoza** ("Unpaid lab fee"). In a window signed in as Lia, the Enroll buttons are disabled, and hovering one shows the hold's reason.
Back as admin, open the CS101 roster and **Override enroll** Lia with a reason; the override works and is recorded.
Show **Overview** (analytics: fill by department, waitlists, units distribution).

> *Say:* "An override skips every rule except capacity, because over-enrollment is an invariant, not a policy. To
> seat someone in a full class an administrator must first raise its capacity, which is itself audited."

## 8. The Rush Simulator (5:45 to 6:45), the headline

Open **Rush Simulator**. The course defaults to **ENGL210**, which has **6 seats and 5 taken**. Leave **40**
virtual students and **Run simulation**.

The result reads **No over-enrollment: 6 of 6 seats taken**: 1 student got the last seat, 39 joined the waitlist
in order, in under half a second on a local database (the table shows the real time; a hosted database adds latency to every query). Click **Reset scenario** to put the course back exactly as it was.

> *Say:* "Forty requests collided on one seat. Each is a real enrollment in its own database transaction. The
> course row is locked, the head-count is taken after the lock, and exactly one request sees a free seat."

## 9. The audit log (6:45 to 7:00)

Open **Audit log**. Filter to **PROMOTE**, then **FORCE_ENROLL**, then **RUSH_SIMULATE**.

> *Say:* "Every enrollment, drop, promotion, override, and grade is recorded, in the same transaction as the
> change. Entries are never edited or deleted."

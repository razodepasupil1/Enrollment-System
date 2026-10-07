# Entity-relationship diagram

Schema from `apps/api/src/db/migrations/001_reference.sql` to `004_activity.sql`. MySQL 8, InnoDB, `utf8mb4`, all timestamps UTC `DATETIME(3)`.

```mermaid
erDiagram
  DEPARTMENTS ||--o{ PROGRAMS : offers
  DEPARTMENTS ||--o{ COURSES : owns
  DEPARTMENTS ||--o{ INSTRUCTORS : employs
  PROGRAMS ||--o{ PROGRAM_REQUIREMENTS : requires
  PROGRAMS ||--o{ STUDENTS : enrolls
  USERS ||--o| STUDENTS : is
  USERS ||--o| INSTRUCTORS : is
  USERS ||--o{ NOTIFICATIONS : receives
  USERS ||--o{ AUDIT_LOG : performs
  TERMS ||--o{ COURSES : schedules
  TERMS ||--o{ TERM_PRIORITY_WINDOWS : has
  TERMS ||--o{ OVERLOAD_REQUESTS : covers
  INSTRUCTORS ||--o{ COURSES : teaches
  COURSES ||--o{ COURSE_MEETINGS : meets
  STUDENTS ||--o{ ENROLLMENTS : makes
  COURSES ||--o{ ENROLLMENTS : holds
  STUDENTS ||--o{ HOLDS : has
  STUDENTS ||--o{ OVERLOAD_REQUESTS : files

  USERS {
    bigint id PK
    varchar email UK
    varchar password_hash
    enum role
    tinyint is_simulated
  }
  STUDENTS {
    bigint id PK
    bigint user_id UK
    varchar student_number UK
    bigint program_id FK
    tinyint year_level
    tinyint max_units
    enum status
  }
  TERMS {
    bigint id PK
    varchar name UK
    tinyint is_current
    datetime registration_opens_at
    datetime registration_closes_at
    datetime drop_deadline
    datetime ends_at
    tinyint current_key UK
  }
  COURSES {
    bigint id PK
    varchar code UK
    bigint term_id FK
    varchar title
    tinyint units
    smallint capacity
    bigint instructor_id FK
    datetime drop_deadline
  }
  COURSE_MEETINGS {
    bigint id PK
    bigint course_id FK
    enum day
    smallint start_min
    smallint end_min
  }
  ENROLLMENTS {
    bigint id PK
    bigint student_id FK
    bigint course_id FK
    enum status
    decimal grade
    datetime enrolled_at
    datetime waitlisted_at
    datetime ended_at
    tinyint active_key UK
  }
  HOLDS {
    bigint id PK
    bigint student_id FK
    enum type
    varchar reason
    datetime cleared_at
  }
  OVERLOAD_REQUESTS {
    bigint id PK
    bigint student_id FK
    bigint term_id FK
    tinyint extra_units
    enum status
  }
  AUDIT_LOG {
    bigint id PK
    bigint actor_user_id FK
    varchar action
    varchar entity_type
    json details
    datetime created_at
  }
```

Also in the schema, but drawn without relationships to keep the diagram readable:

- `prerequisites(course_code, prereq_code, min_grade)` and `corequisites(course_code, coreq_code)`. These are keyed by catalog **code**, not offering id, because a requirement holds in every term.
- `notifications`, `announcements`, `instructors`, `programs`, `program_requirements`, `term_priority_windows`, `departments`.
- `schema_migrations(version)`, written by the migration runner.

## Design decisions worth explaining

**One active enrollment per student per course.** MySQL has no partial unique index, so `enrollments.active_key` is a generated column: `1` when the status is `ENROLLED` or `WAITLISTED`, otherwise `NULL`. `UNIQUE (student_id, course_id, active_key)` then forbids two active rows, while any number of `DROPPED` rows (where `active_key` is `NULL`) is allowed, because NULLs never collide in a unique key. A student can drop and re-enroll; they can never be enrolled twice.

**Exactly one current term.** Same trick: `terms.current_key` is `1` for the current term and `NULL` otherwise, with a unique key.

**Waitlist position is derived, never stored.** It is the rank of `(waitlisted_at, id)` among waitlisted rows for the course. Nothing needs renumbering when someone drops.

**Seat counts are `COUNT(*)`, not a counter column.** There is no second number that could drift out of sync with the rows, and the course row lock already serialises every writer.

**CHECK constraints** enforce `capacity >= 0`, `units > 0`, `end_min > start_min`, and a `WAITLISTED` row must have `waitlisted_at`.

# Class diagram

How the code is organised, drawn from the actual classes in `apps/api/src`. Dependencies point downward only:
`http -> services -> (rules, repositories) -> domain`. The domain layer imports no Express and no mysql2.

## Domain, rules, and strategies

```mermaid
classDiagram
  direction LR

  class Student {
    -id
    -studentNumber
    -fullName
    -email
    -program
    -yearLevel
    -maxUnits
    -status
    -transcript
    +totalUnits(enrollments)
    +remainingUnits(enrollments, overload)
    +hasCompleted(code, minGrade, policy)
    +hasAttempted(code)
    +isActive()
    +classStanding()
    +gpa(policy)
  }

  class Course {
    -id
    -code
    -title
    -units
    -capacity
    -termId
    -meetings
    -prerequisites
    -corequisites
    -dropDeadline
    +availableSeats(enrolled)
    +isFull(enrolled)
    +fillRatio(enrolled)
    +conflictsWith(other)
    +overlappingMeetings(other)
    +meetingSummary()
  }

  class Enrollment {
    -id
    -studentId
    -courseId
    -status
    -grade
    -enrolledAt
    -waitlistedAt
    -endedAt
    +create(seatAvailable)$
    +restore(snapshot)$
    +drop(now, deadline)
    +leaveWaitlist(now)
    +promote(now)
    +complete(grade, policy, now)
    +toSnapshot()
  }

  class Term {
    +id
    +name
    +isCurrent
    +registrationOpensAt
    +registrationClosesAt
    +dropDeadline
    +endsAt
    +openingFor(standing)
    +hasEnded(now)
  }

  class GradingPolicy {
    <<interface>>
    +isValid(grade)
    +isPass(grade)
    +meetsMinimum(grade, min)
    +isBetter(a, b)
    +average(entries)
    +standing(average)
    +display(grade)
  }
  class FourPointPolicy
  class FivePointPolicy

  class EnrollmentRule {
    <<interface>>
    +code
    +check(ctx)
  }
  class RuleEngine {
    +evaluate(ctx)
  }
  class EnrollmentContext {
    +student
    +course
    +term
    +now
    +activeEnrollments
    +enrolledCount
    +holds
    +approvedOverloadUnits
    +pendingCourseCodes
  }

  Enrollment --> Student : exactly one
  Enrollment --> Course : exactly one
  Course --> Term : offered in
  Student ..> GradingPolicy : gpa uses
  GradingPolicy <|.. FourPointPolicy
  GradingPolicy <|.. FivePointPolicy

  EnrollmentRule <|.. StudentStatusRule
  EnrollmentRule <|.. TermMatchRule
  EnrollmentRule <|.. RegistrationWindowRule
  EnrollmentRule <|.. HoldRule
  EnrollmentRule <|.. DuplicateEnrollmentRule
  EnrollmentRule <|.. CapacityRule
  EnrollmentRule <|.. PrerequisiteRule
  EnrollmentRule <|.. CorequisiteRule
  EnrollmentRule <|.. ScheduleConflictRule
  EnrollmentRule <|.. UnitLimitRule

  RuleEngine o-- EnrollmentRule : runs every rule
  RuleEngine ..> EnrollmentContext : reads
  EnrollmentRule ..> EnrollmentContext : reads
```

Notes for the oral defense:

- `Enrollment` is the **association class**: one student, one course. Many-to-many lives in this class.
- Fields are ES private (`#field`) with getters, so `status` can only change through `drop`, `promote`, `leaveWaitlist`, or `complete`.
- Adding a business rule means adding one class that implements `EnrollmentRule`. No existing rule changes (open/closed principle).
- Grading is a second strategy: nothing outside `GradingPolicy` knows whether a higher or lower grade is better.

## Services, repositories, and errors

```mermaid
classDiagram
  direction TB

  class EnrollmentService {
    +validate(studentId, courseId)
    +validateMany(studentId, courseIds)
    +enroll(input)
    +drop(input)
    +enrollBatch(input)
    +forceEnroll(input)
    +recordGrade(input)
    +fillSeatsFromWaitlist(courseId)
  }
  class PortalService {
    +catalog(studentId, query)
    +myEnrollments(studentId)
    +mySchedule(studentId)
    +scheduleIcs(studentId)
    +transcript(studentId)
    +progress(studentId)
    +recommendations(studentId)
    +suggestSchedule(studentId, courseIds)
  }
  class AdminService {
    +createCourse(input)
    +updateCourse(id, input)
    +placeHold(input)
    +decideOverload(id, approve)
    +analytics()
    +exportEnrollmentsCsv()
    +simulateRush(input)
  }
  class InstructorService
  class AuthService

  class RuleEngine
  class StudentRepository
  class CourseRepository
  class EnrollmentRepository
  class TermRepository
  class HoldRepository
  class ReadRepository
  class AdminRepository

  EnrollmentService --> RuleEngine : decides
  EnrollmentService --> StudentRepository
  EnrollmentService --> CourseRepository
  EnrollmentService --> EnrollmentRepository
  EnrollmentService --> HoldRepository
  PortalService --> EnrollmentService : validateMany
  PortalService --> ReadRepository
  AdminService --> EnrollmentService : enroll, promote
  AdminService --> AdminRepository
  InstructorService --> PortalService

  class DomainError {
    +code
    +status
    +details
  }
  class RuleViolationError {
    +violations
  }
  DomainError <|-- RuleViolationError
  DomainError <|-- NotFoundError
  DomainError <|-- ForbiddenError
  DomainError <|-- ConflictError
  DomainError <|-- IllegalTransitionError
  RuleViolationError <|-- CourseFullError
  RuleViolationError <|-- PrerequisiteNotMetError
  RuleViolationError <|-- ScheduleConflictError
  RuleViolationError <|-- UnitLimitExceededError
  RuleViolationError <|-- HoldActiveError
```

The error middleware maps every `DomainError` to `{ error: { code, message, details } }`. The `code` is stable, so the UI switches on it and never on message text.

## Enrollment state machine

All other transitions throw `IllegalTransitionError`.

```mermaid
stateDiagram-v2
  [*] --> ENROLLED : create, seat free
  [*] --> WAITLISTED : create, course full
  ENROLLED --> DROPPED : drop before the deadline
  ENROLLED --> WITHDRAWN : drop after the deadline (W)
  WAITLISTED --> DROPPED : leaveWaitlist
  WAITLISTED --> ENROLLED : promote (a seat opened)
  ENROLLED --> COMPLETED : grade is a pass
  ENROLLED --> FAILED : grade is a fail
  DROPPED --> [*]
  WITHDRAWN --> [*]
  COMPLETED --> [*]
  FAILED --> [*]
```

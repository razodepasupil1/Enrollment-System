-- The association table (student <-> course) plus the things that gate it.

CREATE TABLE enrollments (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id    BIGINT UNSIGNED NOT NULL,
  course_id     BIGINT UNSIGNED NOT NULL,
  status        ENUM('ENROLLED','WAITLISTED','DROPPED','WITHDRAWN','COMPLETED','FAILED') NOT NULL,
  grade         DECIMAL(3,2) NULL,
  enrolled_at   DATETIME(3) NULL,
  waitlisted_at DATETIME(3) NULL,
  ended_at      DATETIME(3) NULL,
  -- "At most one ACTIVE enrollment per student per course". A student may re-enroll after a
  -- DROPPED row, so a plain UNIQUE(student_id, course_id) would be wrong. active_key is 1 for
  -- ENROLLED/WAITLISTED and NULL otherwise; NULLs never collide, so history rows are unlimited.
  active_key    TINYINT AS (IF(status IN ('ENROLLED','WAITLISTED'), 1, NULL)) STORED,
  UNIQUE KEY uq_one_active (student_id, course_id, active_key),
  -- Head-counts and waitlist ordering both filter on (course_id, status).
  KEY ix_enr_course_status (course_id, status, waitlisted_at, id),
  KEY ix_enr_student_status (student_id, status),
  CONSTRAINT fk_enr_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_enr_course  FOREIGN KEY (course_id)  REFERENCES courses(id),
  CONSTRAINT ck_enr_grade CHECK (grade IS NULL OR (grade >= 0 AND grade <= 5)),
  CONSTRAINT ck_enr_waitlist CHECK (status <> 'WAITLISTED' OR waitlisted_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE holds (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  type       ENUM('FINANCIAL','ADVISING','ACADEMIC') NOT NULL,
  reason     VARCHAR(255) NOT NULL,
  placed_by  BIGINT UNSIGNED NULL,
  placed_at  DATETIME(3) NOT NULL,
  cleared_by BIGINT UNSIGNED NULL,
  cleared_at DATETIME(3) NULL,
  KEY ix_holds_student (student_id, cleared_at),
  CONSTRAINT fk_holds_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_holds_placed_by FOREIGN KEY (placed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_holds_cleared_by FOREIGN KEY (cleared_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE overload_requests (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id    BIGINT UNSIGNED NOT NULL,
  term_id       BIGINT UNSIGNED NOT NULL,
  extra_units   TINYINT UNSIGNED NOT NULL,
  reason        VARCHAR(500) NOT NULL,
  status        ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  decided_by    BIGINT UNSIGNED NULL,
  decided_at    DATETIME(3) NULL,
  decision_note VARCHAR(255) NULL,
  created_at    DATETIME(3) NOT NULL,
  KEY ix_overload_student_term (student_id, term_id, status),
  CONSTRAINT fk_overload_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_overload_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_overload_decider FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT ck_overload_units CHECK (extra_units > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

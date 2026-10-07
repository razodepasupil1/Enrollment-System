-- Course offerings (one row per course per term) and their meeting times / requirements.

CREATE TABLE courses (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(20)  NOT NULL,
  term_id       BIGINT UNSIGNED NOT NULL,
  title         VARCHAR(160) NOT NULL,
  description   TEXT NULL,
  units         TINYINT UNSIGNED NOT NULL,
  capacity      SMALLINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  instructor_id BIGINT UNSIGNED NULL,
  room          VARCHAR(40) NULL,
  -- Optional per-course deadline (short modules); NULL means "use the term's drop_deadline".
  drop_deadline DATETIME(3) NULL,
  UNIQUE KEY uq_courses_code_term (code, term_id),
  KEY ix_courses_term (term_id),
  CONSTRAINT fk_courses_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_courses_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_courses_instructor FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE SET NULL,
  CONSTRAINT ck_courses_units CHECK (units > 0),
  CONSTRAINT ck_courses_capacity CHECK (capacity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE course_meetings (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id BIGINT UNSIGNED NOT NULL,
  day       ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
  start_min SMALLINT UNSIGNED NOT NULL,
  end_min   SMALLINT UNSIGNED NOT NULL,
  KEY ix_meetings_course (course_id),
  CONSTRAINT fk_meetings_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  CONSTRAINT ck_meetings_range CHECK (end_min > start_min AND end_min <= 1440)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Requirements are keyed by catalog CODE (not offering id) because they hold across terms.
CREATE TABLE prerequisites (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_code VARCHAR(20) NOT NULL,
  prereq_code VARCHAR(20) NOT NULL,
  min_grade   DECIMAL(3,2) NULL,
  UNIQUE KEY uq_prereq (course_code, prereq_code),
  CONSTRAINT ck_prereq_self CHECK (course_code <> prereq_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE corequisites (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_code VARCHAR(20) NOT NULL,
  coreq_code  VARCHAR(20) NOT NULL,
  UNIQUE KEY uq_coreq (course_code, coreq_code),
  CONSTRAINT ck_coreq_self CHECK (course_code <> coreq_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

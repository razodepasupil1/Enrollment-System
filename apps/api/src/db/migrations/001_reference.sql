-- Reference data: departments, programs, people, and terms.
-- All timestamps are UTC DATETIME(3). Money-free, but grades use DECIMAL so 3.25 is exact.

CREATE TABLE departments (
  id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code  VARCHAR(10)  NOT NULL,
  name  VARCHAR(120) NOT NULL,
  UNIQUE KEY uq_departments_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE programs (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id  BIGINT UNSIGNED NOT NULL,
  code           VARCHAR(20)  NOT NULL,
  name           VARCHAR(120) NOT NULL,
  required_units SMALLINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_programs_code (code),
  CONSTRAINT fk_programs_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT ck_programs_units CHECK (required_units > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Which catalog courses a program requires (drives the degree-progress checklist).
CREATE TABLE program_requirements (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  program_id  BIGINT UNSIGNED NOT NULL,
  course_code VARCHAR(20) NOT NULL,
  category    VARCHAR(40) NOT NULL DEFAULT 'Core',
  UNIQUE KEY uq_program_course (program_id, course_code),
  CONSTRAINT fk_req_program FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  full_name     VARCHAR(120) NOT NULL,
  role          ENUM('student','instructor','admin') NOT NULL,
  -- Virtual students created by the Rush Simulator; lets "reset" delete exactly those rows.
  is_simulated  TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME(3) NOT NULL,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE instructors (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  title         VARCHAR(60) NOT NULL DEFAULT 'Instructor',
  UNIQUE KEY uq_instructors_user (user_id),
  CONSTRAINT fk_instructors_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_instructors_department FOREIGN KEY (department_id) REFERENCES departments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE students (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        BIGINT UNSIGNED NOT NULL,
  student_number VARCHAR(20) NOT NULL,
  program_id     BIGINT UNSIGNED NOT NULL,
  year_level     TINYINT UNSIGNED NOT NULL,
  max_units      TINYINT UNSIGNED NOT NULL DEFAULT 21,
  status         ENUM('ACTIVE','INACTIVE','SUSPENDED','GRADUATED') NOT NULL DEFAULT 'ACTIVE',
  UNIQUE KEY uq_students_user (user_id),
  UNIQUE KEY uq_students_number (student_number),
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_students_program FOREIGN KEY (program_id) REFERENCES programs(id),
  CONSTRAINT ck_students_year CHECK (year_level >= 1),
  CONSTRAINT ck_students_units CHECK (max_units > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE terms (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                   VARCHAR(60) NOT NULL,
  is_current             TINYINT(1) NOT NULL DEFAULT 0,
  registration_opens_at  DATETIME(3) NOT NULL,
  registration_closes_at DATETIME(3) NOT NULL,
  drop_deadline          DATETIME(3) NOT NULL,
  ends_at                DATETIME(3) NOT NULL,
  -- MySQL has no partial unique index, so a generated column (1 or NULL) enforces
  -- "at most one current term": NULLs never collide in a UNIQUE key.
  current_key            TINYINT AS (IF(is_current = 1, 1, NULL)) STORED,
  UNIQUE KEY uq_terms_name (name),
  UNIQUE KEY uq_terms_one_current (current_key),
  CONSTRAINT ck_terms_window CHECK (registration_closes_at > registration_opens_at),
  CONSTRAINT ck_terms_end CHECK (ends_at > registration_opens_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Earlier registration for senior classes etc.
CREATE TABLE term_priority_windows (
  term_id        BIGINT UNSIGNED NOT NULL,
  class_standing ENUM('FRESHMAN','SOPHOMORE','JUNIOR','SENIOR') NOT NULL,
  opens_at       DATETIME(3) NOT NULL,
  PRIMARY KEY (term_id, class_standing),
  CONSTRAINT fk_priority_term FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

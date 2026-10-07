-- Things that record what happened: notifications, announcements, audit trail.

CREATE TABLE notifications (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  type       VARCHAR(40)  NOT NULL,
  title      VARCHAR(160) NOT NULL,
  body       VARCHAR(500) NOT NULL,
  is_read    TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  KEY ix_notif_user (user_id, is_read, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE announcements (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  author_id  BIGINT UNSIGNED NULL,
  title      VARCHAR(160) NOT NULL,
  body       VARCHAR(1000) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_announce_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Append-only: rows are never updated or deleted by the application.
CREATE TABLE audit_log (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  action        VARCHAR(40) NOT NULL,
  entity_type   VARCHAR(40) NOT NULL,
  entity_id     BIGINT UNSIGNED NULL,
  student_id    BIGINT UNSIGNED NULL,
  course_id     BIGINT UNSIGNED NULL,
  details       JSON NULL,
  created_at    DATETIME(3) NOT NULL,
  KEY ix_audit_created (created_at, id),
  KEY ix_audit_entity (entity_type, entity_id),
  KEY ix_audit_student (student_id),
  KEY ix_audit_course (course_id),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

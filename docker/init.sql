-- Runs once, the first time the container starts.
CREATE DATABASE IF NOT EXISTS enrollment_dev  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS enrollment_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'enroll'@'%' IDENTIFIED BY 'enroll_pw';
GRANT ALL ON enrollment_dev.*  TO 'enroll'@'%';
GRANT ALL ON enrollment_test.* TO 'enroll'@'%';

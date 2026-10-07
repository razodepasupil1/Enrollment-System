// Imported FIRST by both the global setup and the setup file. The smoke tests run the real API against a
// real MySQL database and TRUNCATE tables, so they must only ever point at the dedicated *_test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "mysql://enroll:enroll_pw@127.0.0.1:3307/enrollment_test";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret-123";
process.env.DEMO_MODE = "true";

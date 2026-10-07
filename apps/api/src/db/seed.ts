import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import type { ResultSetHeader } from "mysql2/promise";
import { loadConfig } from "../config.js";
import type { Day } from "../domain/types.js";
import { closePool, getPool, type Pool, type PoolConnection } from "./pool.js";

export const DEMO_PASSWORD = "Demo#1234";
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Static data. Everything here is fixed (no randomness) so the demo is repeatable.
// Dates are relative to "now" so the seeded term is always open when you run it.
// ---------------------------------------------------------------------------

const DEPARTMENTS = [
  ["CS", "Computer Science"],
  ["MATH", "Mathematics"],
  ["PHYS", "Physics"],
  ["HUM", "Humanities"],
  ["BUS", "Business"],
] as const;
type Dept = (typeof DEPARTMENTS)[number][0];

const PROGRAMS = [
  { code: "BSCS", name: "BS Computer Science", dept: "CS", units: 144,
    requires: ["CS101", "CS102", "CS201", "CS202", "CS301", "CS310", "CS320", "MATH101", "MATH120", "MATH201", "PHYS101", "ENGL101", "ENGL102", "GE101"] },
  { code: "BSMATH", name: "BS Mathematics", dept: "MATH", units: 140,
    requires: ["MATH101", "MATH120", "MATH201", "MATH210", "PHYS101", "PHYS201", "CS101", "ENGL101", "GE101"] },
  { code: "BSBA", name: "BS Business Administration", dept: "BUS", units: 138,
    requires: ["BUS101", "BUS201", "BUS210", "ENGL101", "ENGL210", "MATH101", "GE101", "GE102"] },
] as const;

const INSTRUCTORS: Record<Dept, { email: string; name: string; title: string }> = {
  CS: { email: "instructor@school.test", name: "Dr. Maria Santos", title: "Associate Professor" },
  MATH: { email: "jose.villanueva@school.test", name: "Prof. Jose Villanueva", title: "Professor" },
  PHYS: { email: "elena.cortez@school.test", name: "Dr. Elena Cortez", title: "Assistant Professor" },
  HUM: { email: "ramon.bautista@school.test", name: "Prof. Ramon Bautista", title: "Lecturer" },
  BUS: { email: "liza.tan@school.test", name: "Dr. Liza Tan", title: "Associate Professor" },
};

type SlotKey = keyof typeof SLOTS;
/** [days, startMin, endMin] */
const SLOTS = {
  MW_0800: [["MON", "WED"], 480, 570],
  MW_0900: [["MON", "WED"], 540, 630], // overlaps MW_0800 on purpose (the demo conflict)
  MW_1030: [["MON", "WED"], 630, 720],
  MW_1300: [["MON", "WED"], 780, 870],
  MW_1500: [["MON", "WED"], 900, 990],
  MW_1700: [["MON", "WED"], 1020, 1110],
  TT_0800: [["TUE", "THU"], 480, 570],
  TT_0930: [["TUE", "THU"], 570, 660], // starts exactly when TT_0800 ends: back-to-back, no conflict
  TT_1100: [["TUE", "THU"], 660, 750],
  TT_1300: [["TUE", "THU"], 780, 870],
  TT_1500: [["TUE", "THU"], 900, 990],
  TT_1700: [["TUE", "THU"], 1020, 1110],
  F_0800: [["FRI"], 480, 660],
  F_1300: [["FRI"], 780, 960],
  SAT_0800: [["SAT"], 480, 660],
  SAT_1300: [["SAT"], 780, 960],
} as const satisfies Record<string, readonly [readonly Day[], number, number]>;

interface CatalogCourse {
  code: string;
  title: string;
  dept: Dept;
  units: number;
  capacity: number;
  slot: SlotKey;
  room: string;
  description: string;
  prereq?: ReadonlyArray<readonly [string, number?]>;
  coreq?: readonly string[];
  /** Days before "now" that this course's own drop deadline passed (short module). */
  lateDropDaysAgo?: number;
}

// The 25 offerings of the CURRENT term.
const FALL: CatalogCourse[] = [
  { code: "CS101", title: "Introduction to Programming", dept: "CS", units: 3, capacity: 35, slot: "MW_1300", room: "CS Lab 1", description: "Problem solving and programming fundamentals: variables, control flow, functions, and basic data structures." },
  { code: "CS102", title: "Data Structures", dept: "CS", units: 3, capacity: 30, slot: "TT_0800", room: "CS Lab 2", description: "Lists, stacks, queues, trees, hash tables, and the analysis of their running time.", prereq: [["CS101"]] },
  { code: "CS201", title: "Algorithms", dept: "CS", units: 3, capacity: 25, slot: "MW_1500", room: "Rm 301", description: "Design and analysis of algorithms: sorting, graph search, dynamic programming, and greedy methods.", prereq: [["CS102"]] },
  { code: "CS202", title: "Database Systems", dept: "CS", units: 3, capacity: 28, slot: "TT_0930", room: "CS Lab 2", description: "Relational modelling, SQL, normalization, indexing, and transactions.", prereq: [["CS102"]] },
  { code: "CS240", title: "Mobile Application Development", dept: "CS", units: 3, capacity: 3, slot: "MW_1030", room: "CS Lab 1", description: "Build cross-platform mobile apps. Small studio class with limited seats.", prereq: [["CS101"]] },
  { code: "CS250", title: "Cybersecurity Basics", dept: "CS", units: 3, capacity: 25, slot: "TT_1300", room: "Rm 305", description: "Threat models, cryptography basics, secure coding, and common web vulnerabilities.", prereq: [["CS101"]] },
  { code: "CS301", title: "Operating Systems", dept: "CS", units: 3, capacity: 25, slot: "TT_1500", room: "Rm 301", description: "Processes, scheduling, memory management, file systems, and concurrency.", prereq: [["CS201"]] },
  { code: "CS310", title: "Software Engineering", dept: "CS", units: 3, capacity: 28, slot: "F_1300", room: "Rm 204", description: "Team-based software development: requirements, design, testing, and delivery.", prereq: [["CS102"]] },
  { code: "CS320", title: "Artificial Intelligence", dept: "CS", units: 3, capacity: 25, slot: "F_0800", room: "Rm 301", description: "Search, knowledge representation, and an introduction to machine learning.", prereq: [["CS201"], ["MATH201"]] },
  { code: "CS330", title: "Web Development", dept: "CS", units: 3, capacity: 30, slot: "TT_1700", room: "CS Lab 1", description: "Modern full-stack web applications: HTML, CSS, JavaScript, APIs, and deployment.", prereq: [["CS102"]] },
  { code: "MATH101", title: "Calculus I", dept: "MATH", units: 3, capacity: 40, slot: "TT_1100", room: "Rm 110", description: "Limits, derivatives, and an introduction to integration." },
  { code: "MATH120", title: "Discrete Mathematics", dept: "MATH", units: 3, capacity: 35, slot: "MW_0900", room: "Rm 112", description: "Logic, sets, relations, counting, graphs, and proof techniques." },
  { code: "MATH201", title: "Linear Algebra", dept: "MATH", units: 3, capacity: 30, slot: "MW_1700", room: "Rm 110", description: "Vector spaces, matrices, determinants, eigenvalues, and applications.", prereq: [["MATH101"]] },
  { code: "MATH210", title: "Probability and Statistics", dept: "MATH", units: 3, capacity: 30, slot: "SAT_0800", room: "Rm 112", description: "Random variables, distributions, estimation, and hypothesis testing.", prereq: [["MATH101"]] },
  { code: "PHYS101", title: "Physics I (Mechanics)", dept: "PHYS", units: 3, capacity: 35, slot: "MW_0800", room: "Sci 101", description: "Kinematics, Newton's laws, energy, momentum, and rotational motion.", coreq: ["PHYS101L"] },
  { code: "PHYS101L", title: "Physics I Laboratory", dept: "PHYS", units: 1, capacity: 35, slot: "SAT_1300", room: "Sci Lab 2", description: "Hands-on experiments that accompany Physics I.", coreq: ["PHYS101"] },
  { code: "PHYS201", title: "Physics II (Electricity and Magnetism)", dept: "PHYS", units: 3, capacity: 30, slot: "TT_0800", room: "Sci 101", description: "Electric and magnetic fields, circuits, and electromagnetic waves.", prereq: [["PHYS101"]] },
  { code: "ENGL101", title: "College Composition", dept: "HUM", units: 3, capacity: 40, slot: "MW_1030", room: "Hum 201", description: "Academic writing, argument, and research basics." },
  { code: "ENGL102", title: "Introduction to Literature", dept: "HUM", units: 3, capacity: 35, slot: "TT_0930", room: "Hum 202", description: "Close reading of short fiction, poetry, and drama.", prereq: [["ENGL101"]] },
  // One seat left (cap 6, 5 enrolled): the course the Rush Simulator hammers. No prerequisites, so virtual students qualify.
  { code: "ENGL210", title: "Technical Writing", dept: "HUM", units: 3, capacity: 6, slot: "MW_1500", room: "Hum 204", description: "Writing clear documentation, reports, and proposals for technical audiences." },
  { code: "GE101", title: "Readings in Philippine History", dept: "HUM", units: 3, capacity: 40, slot: "TT_1500", room: "Hum 101", description: "Primary sources and interpretations of Philippine history." },
  // Short module whose own drop deadline has already passed: dropping it gives a "W".
  { code: "GE102", title: "Ethics (Intensive Module)", dept: "HUM", units: 3, capacity: 30, slot: "SAT_1300", room: "Hum 101", description: "A compressed module on ethical reasoning. Started earlier than the regular term.", lateDropDaysAgo: 3 },
  { code: "BUS101", title: "Introduction to Business", dept: "BUS", units: 3, capacity: 40, slot: "F_0800", room: "Bus 101", description: "Functions of business: management, marketing, finance, and operations." },
  { code: "BUS201", title: "Financial Accounting", dept: "BUS", units: 3, capacity: 35, slot: "SAT_1300", room: "Bus 102", description: "Recording, summarizing, and interpreting financial transactions.", prereq: [["BUS101"]] },
  { code: "BUS210", title: "Principles of Marketing", dept: "BUS", units: 3, capacity: 35, slot: "TT_1100", room: "Bus 101", description: "Markets, customers, branding, pricing, and promotion." },
];

// Ten offerings of the PAST term, so transcripts have somewhere to point.
const SPRING_CODES = ["CS101", "CS102", "CS201", "MATH101", "MATH120", "MATH201", "ENGL101", "PHYS101", "BUS101", "GE101"];

interface SeedStudent {
  key: string;
  name: string;
  program: "BSCS" | "BSMATH" | "BSBA";
  year: number;
  maxUnits?: number;
  /** Spring 2026 results: [code, grade]. Grades below 1.0 are FAILED. */
  past: ReadonlyArray<readonly [string, number]>;
  /** Fall 2026 ENROLLED courses. */
  enrolled: readonly string[];
  waitlisted?: readonly string[];
}

const STUDENTS: SeedStudent[] = [
  { key: "ana.reyes", name: "Ana Reyes", program: "BSCS", year: 2, past: [["CS101", 3.5], ["MATH101", 3.0], ["ENGL101", 3.5]], enrolled: ["MATH120", "ENGL102"] },
  { key: "ben.cruz", name: "Ben Cruz", program: "BSCS", year: 3, past: [["CS101", 3.5], ["CS102", 3.0], ["MATH101", 3.5], ["ENGL101", 3.0], ["PHYS101", 3.0]], enrolled: ["CS201", "CS202", "MATH201", "CS240"] },
  { key: "chloe.delacruz", name: "Chloe Dela Cruz", program: "BSCS", year: 2, past: [["CS101", 4.0], ["MATH101", 4.0], ["ENGL101", 4.0], ["GE101", 3.5]], enrolled: ["CS240", "CS102", "MATH201", "ENGL102"] },
  // At the unit limit: 3 x 3 = 9 of 9. Also failed MATH101 last term (a retake candidate).
  { key: "dan.garcia", name: "Dan Garcia", program: "BSCS", year: 2, maxUnits: 9, past: [["CS101", 2.0], ["ENGL101", 1.0], ["MATH101", 0.0]], enrolled: ["CS240", "CS250", "BUS101"] },
  { key: "ella.francisco", name: "Ella Francisco", program: "BSCS", year: 1, past: [], enrolled: ["CS101", "MATH101", "ENGL101", "GE101", "ENGL210"] },
  { key: "faye.gomez", name: "Faye Gomez", program: "BSCS", year: 2, past: [["CS101", 3.0], ["MATH101", 3.0]], enrolled: ["CS102", "MATH201", "ENGL210"], waitlisted: ["CS240"] },
  { key: "gabe.hernandez", name: "Gabe Hernandez", program: "BSCS", year: 2, past: [["CS101", 2.5], ["ENGL101", 3.0]], enrolled: ["CS250", "ENGL210", "GE101"], waitlisted: ["CS240"] },
  // Has a financial hold (see below): cannot enroll until it is cleared.
  { key: "hana.ignacio", name: "Hana Ignacio", program: "BSCS", year: 3, past: [["CS101", 3.0], ["MATH101", 2.5], ["BUS101", 3.5]], enrolled: ["CS102", "BUS201"] },
  // Carrying 15 of 15 units with a pending request for 3 more.
  { key: "ivan.jimenez", name: "Ivan Jimenez", program: "BSCS", year: 3, maxUnits: 15, past: [["CS101", 3.0], ["CS102", 3.0], ["MATH101", 2.5], ["MATH120", 3.0], ["ENGL101", 3.0]], enrolled: ["CS201", "CS202", "CS310", "MATH201", "CS330"] },
  { key: "jaya.katigbak", name: "Jaya Katigbak", program: "BSCS", year: 4, past: [["CS101", 3.5], ["CS102", 3.5], ["CS201", 3.0], ["MATH101", 3.0], ["MATH120", 3.5], ["MATH201", 3.0], ["ENGL101", 3.5], ["PHYS101", 3.0], ["BUS101", 3.0]], enrolled: ["CS301", "CS320", "CS310", "MATH210"] },
  { key: "karl.lim", name: "Karl Lim", program: "BSCS", year: 4, past: [["CS101", 2.5], ["MATH101", 2.0], ["ENGL101", 2.5], ["GE101", 3.0]], enrolled: ["GE102", "CS250"] },
  { key: "lia.mendoza", name: "Lia Mendoza", program: "BSCS", year: 1, past: [], enrolled: [] },
  { key: "marco.navarro", name: "Marco Navarro", program: "BSBA", year: 2, past: [["BUS101", 3.5], ["ENGL101", 3.0], ["MATH101", 2.5]], enrolled: ["BUS201", "BUS210", "ENGL210"] },
  { key: "nina.ocampo", name: "Nina Ocampo", program: "BSMATH", year: 3, past: [["MATH101", 3.5], ["MATH120", 4.0], ["ENGL101", 3.5], ["PHYS101", 3.5], ["CS101", 3.0]], enrolled: ["MATH201", "MATH210", "PHYS201", "ENGL210"] },
];

// ---------------------------------------------------------------------------

export interface SeedSummary {
  users: number;
  students: number;
  instructors: number;
  courses: number;
  enrollments: number;
  demoPassword: string;
}

const TABLES_TO_CLEAR = [
  "audit_log", "announcements", "notifications", "overload_requests", "holds", "enrollments",
  "corequisites", "prerequisites", "course_meetings", "courses", "term_priority_windows", "terms",
  "students", "instructors", "users", "program_requirements", "programs", "departments",
];

/** Empties every application table (keeps schema_migrations). Used by seeding and by tests. */
export async function clearAllData(pool: Pool): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of TABLES_TO_CLEAR) await conn.query(`TRUNCATE TABLE \`${t}\``);
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  } finally {
    conn.release();
  }
}

async function insert(conn: PoolConnection, sql: string, params: unknown[]): Promise<number> {
  const [res] = await conn.query<ResultSetHeader>(sql, params);
  return res.insertId;
}

/** Wipes all application data and loads the demo dataset. Safe to run repeatedly. */
export async function seedDatabase(pool: Pool, opts: { now?: Date } = {}): Promise<SeedSummary> {
  const now = opts.now ?? new Date();
  const ago = (d: number) => new Date(now.getTime() - d * DAY);
  const ahead = (d: number) => new Date(now.getTime() + d * DAY);
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  await clearAllData(pool);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Departments, programs, requirements
    const deptId = new Map<string, number>();
    for (const [code, name] of DEPARTMENTS) {
      deptId.set(code, await insert(conn, "INSERT INTO departments (code, name) VALUES (?, ?)", [code, name]));
    }
    const programId = new Map<string, number>();
    for (const p of PROGRAMS) {
      const id = await insert(conn, "INSERT INTO programs (department_id, code, name, required_units) VALUES (?, ?, ?, ?)",
        [deptId.get(p.dept), p.code, p.name, p.units]);
      programId.set(p.code, id);
      for (const code of p.requires) {
        await insert(conn, "INSERT INTO program_requirements (program_id, course_code) VALUES (?, ?)", [id, code]);
      }
    }

    // Users: admin, instructors, students (all share one demo password)
    let userCount = 0;
    const newUser = async (email: string, name: string, role: "student" | "instructor" | "admin") => {
      userCount++;
      return insert(conn, "INSERT INTO users (email, password_hash, full_name, role, created_at) VALUES (?, ?, ?, ?, ?)",
        [email, hash, name, role, ago(60)]);
    };
    const adminUserId = await newUser("admin@school.test", "Registrar Admin", "admin");

    const instructorId = new Map<Dept, number>();
    for (const [dept, i] of Object.entries(INSTRUCTORS) as Array<[Dept, (typeof INSTRUCTORS)[Dept]]>) {
      const userId = await newUser(i.email, i.name, "instructor");
      instructorId.set(dept, await insert(conn,
        "INSERT INTO instructors (user_id, department_id, title) VALUES (?, ?, ?)", [userId, deptId.get(dept), i.title]));
    }

    const studentId = new Map<string, number>();
    const studentUserId = new Map<string, number>();
    const admitYear = (year: number) => 2026 - (year - 1);
    for (const [idx, s] of STUDENTS.entries()) {
      const userId = await newUser(`${s.key}@student.test`, s.name, "student");
      const id = await insert(conn,
        "INSERT INTO students (user_id, student_number, program_id, year_level, max_units) VALUES (?, ?, ?, ?, ?)",
        [userId, `${admitYear(s.year)}-${String(idx + 1).padStart(4, "0")}`, programId.get(s.program), s.year, s.maxUnits ?? 21]);
      studentId.set(s.key, id);
      studentUserId.set(s.key, userId);
    }

    // Terms: a finished one with grades, and the current open one
    const spring = await insert(conn,
      `INSERT INTO terms (name, is_current, registration_opens_at, registration_closes_at, drop_deadline, ends_at)
       VALUES ('Spring 2026', 0, ?, ?, ?, ?)`, [ago(300), ago(270), ago(250), ago(120)]);
    const fall = await insert(conn,
      `INSERT INTO terms (name, is_current, registration_opens_at, registration_closes_at, drop_deadline, ends_at)
       VALUES ('Fall 2026', 1, ?, ?, ?, ?)`, [ago(30), ahead(60), ahead(30), ahead(120)]);
    // Seniors register first. All openings are already in the past, so every class standing can enroll today.
    for (const [standing, daysAfterOpen] of [["SENIOR", 0], ["JUNIOR", 1], ["SOPHOMORE", 2], ["FRESHMAN", 3]] as const) {
      await insert(conn, "INSERT INTO term_priority_windows (term_id, class_standing, opens_at) VALUES (?, ?, ?)",
        [fall, standing, ago(30 - daysAfterOpen)]);
    }

    // Courses
    const courseId = new Map<string, number>(); // "FALL:CS101" / "SPRING:CS101"
    const createOffering = async (termId: number, termKey: string, c: CatalogCourse, capacity: number) => {
      const [days, start, end] = SLOTS[c.slot];
      const id = await insert(conn,
        `INSERT INTO courses (code, term_id, title, description, units, capacity, department_id, instructor_id, room, drop_deadline)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.code, termId, c.title, c.description, c.units, capacity, deptId.get(c.dept), instructorId.get(c.dept), c.room,
         c.lateDropDaysAgo ? ago(c.lateDropDaysAgo) : null]);
      for (const day of days) {
        await insert(conn, "INSERT INTO course_meetings (course_id, day, start_min, end_min) VALUES (?, ?, ?, ?)", [id, day, start, end]);
      }
      courseId.set(`${termKey}:${c.code}`, id);
    };
    for (const c of FALL) await createOffering(fall, "FALL", c, c.capacity);
    for (const c of FALL.filter((f) => SPRING_CODES.includes(f.code))) {
      await createOffering(spring, "SPRING", { ...c, lateDropDaysAgo: undefined }, 45);
    }
    // Requirements are per catalog code, so they apply to every term's offering.
    for (const c of FALL) {
      for (const [pre, min] of c.prereq ?? []) {
        await insert(conn, "INSERT INTO prerequisites (course_code, prereq_code, min_grade) VALUES (?, ?, ?)", [c.code, pre, min ?? null]);
      }
      for (const co of c.coreq ?? []) {
        await insert(conn, "INSERT INTO corequisites (course_code, coreq_code) VALUES (?, ?)", [c.code, co]);
      }
    }

    // Enrollments + a matching audit trail
    let enrollmentCount = 0;
    const audit = (actor: number, action: string, sId: number, cId: number, at: Date, details: object) =>
      insert(conn,
        `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, student_id, course_id, details, created_at)
         VALUES (?, ?, 'enrollment', NULL, ?, ?, ?, ?)`, [actor, action, sId, cId, JSON.stringify({ ...details, seeded: true }), at]);

    for (const [idx, s] of STUDENTS.entries()) {
      const sid = studentId.get(s.key)!;
      const uid = studentUserId.get(s.key)!;
      for (const [code, grade] of s.past) {
        const cid = courseId.get(`SPRING:${code}`)!;
        await insert(conn,
          `INSERT INTO enrollments (student_id, course_id, status, grade, enrolled_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?)`, [sid, cid, grade >= 1.0 ? "COMPLETED" : "FAILED", grade, ago(290), ago(125)]);
        enrollmentCount++;
      }
      for (const [n, code] of s.enrolled.entries()) {
        const cid = courseId.get(`FALL:${code}`)!;
        const at = ago(24 - idx - n * 0.1);
        await insert(conn, "INSERT INTO enrollments (student_id, course_id, status, enrolled_at) VALUES (?, ?, 'ENROLLED', ?)", [sid, cid, at]);
        await audit(uid, "ENROLL", sid, cid, at, { code, outcome: "ENROLLED" });
        enrollmentCount++;
      }
    }
    // Waitlist order matters, so insert it explicitly: Faye first, then Gabe.
    for (const [key, daysAgo] of [["faye.gomez", 6], ["gabe.hernandez", 5]] as const) {
      const sid = studentId.get(key)!;
      const cid = courseId.get("FALL:CS240")!;
      await insert(conn, "INSERT INTO enrollments (student_id, course_id, status, waitlisted_at) VALUES (?, ?, 'WAITLISTED', ?)", [sid, cid, ago(daysAgo)]);
      await audit(studentUserId.get(key)!, "WAITLIST", sid, cid, ago(daysAgo), { code: "CS240", outcome: "WAITLISTED" });
      enrollmentCount++;
    }

    // Hold, overload request, notifications, announcements
    await insert(conn, "INSERT INTO holds (student_id, type, reason, placed_by, placed_at) VALUES (?, 'FINANCIAL', ?, ?, ?)",
      [studentId.get("hana.ignacio"), "Unpaid tuition balance. Please settle it at the cashier.", adminUserId, ago(10)]);
    await insert(conn,
      `INSERT INTO overload_requests (student_id, term_id, extra_units, reason, created_at) VALUES (?, ?, 3, ?, ?)`,
      [studentId.get("ivan.jimenez"), fall, "Graduating next term and need CS320 this term to stay on track.", ago(2)]);

    await insert(conn, "INSERT INTO notifications (user_id, type, title, body, created_at) VALUES (?, 'ANNOUNCEMENT', ?, ?, ?)",
      [studentUserId.get("ana.reyes"), "Welcome to Fall 2026 registration", "Registration is open. Add courses to your cart to check them before you enroll.", ago(30)]);
    await insert(conn, "INSERT INTO notifications (user_id, type, title, body, created_at) VALUES (?, 'WAITLIST', ?, ?, ?)",
      [studentUserId.get("faye.gomez"), "You are on the waitlist for CS240", "You are #1 on the waitlist for CS240. You will be enrolled automatically if a seat opens.", ago(6)]);
    await insert(conn, "INSERT INTO notifications (user_id, type, title, body, created_at) VALUES (?, 'HOLD', ?, ?, ?)",
      [studentUserId.get("hana.ignacio"), "A hold was placed on your account", "Unpaid tuition balance. Please settle it at the cashier.", ago(10)]);

    await insert(conn, "INSERT INTO announcements (author_id, title, body, created_at) VALUES (?, ?, ?, ?)",
      [adminUserId, "Fall 2026 add/drop deadline", "Courses dropped after the deadline appear on your transcript as a W (withdrawn).", ago(20)]);
    await insert(conn, "INSERT INTO announcements (author_id, title, body, created_at) VALUES (?, ?, ?, ?)",
      [adminUserId, "Small-class waitlists", "Full classes have waitlists. You are enrolled automatically, in order, when a seat opens.", ago(8)]);

    await conn.commit();

    return {
      users: userCount,
      students: STUDENTS.length,
      instructors: Object.keys(INSTRUCTORS).length,
      courses: FALL.length + SPRING_CODES.length,
      enrollments: enrollmentCount,
      demoPassword: DEMO_PASSWORD,
    };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

// CLI: `pnpm db:seed`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  if (config.nodeEnv === "production" && !config.demoMode) {
    console.error("Refusing to seed demo data when NODE_ENV=production without DEMO_MODE=true.");
    process.exit(1);
  }
  seedDatabase(getPool())
    .then((s) => {
      console.log(`Seeded ${s.users} users (${s.students} students, ${s.instructors} instructors + admin), ${s.courses} course offerings, ${s.enrollments} enrollment rows.`);
      console.log(`Demo password for every account: ${s.demoPassword}`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}

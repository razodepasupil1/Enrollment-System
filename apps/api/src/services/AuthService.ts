import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { DemoAccountDTO, UserDTO } from "@enroll/shared";
import type { RowDataPacket } from "mysql2/promise";
import type { Config } from "../config.js";
import type { Pool } from "../db/pool.js";
import { ForbiddenError, UnauthorizedError } from "../errors/index.js";
import type { Actor } from "./types.js";

export const SESSION_COOKIE = "enroll_session";
const TOKEN_TTL = "8h";
// Compared against when the email is unknown, so "no such user" and "wrong password" take equally long.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const USER_SQL = `
  SELECT u.id, u.email, u.full_name, u.role, u.password_hash, s.id AS student_id, i.id AS instructor_id
  FROM users u
  LEFT JOIN students s ON s.user_id = u.id
  LEFT JOIN instructors i ON i.user_id = u.id`;

const DEMO_NOTES: Record<string, string> = {
  "admin@school.test": "Registrar: holds, overrides, analytics, Rush Simulator",
  "instructor@school.test": "Computer Science instructor: rosters and grade entry",
  "ana.reyes@student.test": "Main demo student: try CS201 (prerequisite) and PHYS101 (schedule conflict)",
  "ben.cruz@student.test": "Advanced student enrolled in the full class CS240",
  "faye.gomez@student.test": "#1 on the CS240 waitlist: gets promoted when someone drops",
  "dan.garcia@student.test": "At the unit limit (9 of 9 units)",
  "hana.ignacio@student.test": "Has a financial hold: cannot enroll",
  "ivan.jimenez@student.test": "Has a pending overload request",
  "karl.lim@student.test": "Enrolled in a module past its drop deadline (a drop gives a W)",
  "lia.mendoza@student.test": "Fresh first-year with an empty schedule",
};

function toDTO(r: RowDataPacket): UserDTO {
  return { id: r.id, email: r.email, fullName: r.full_name, role: r.role, studentId: r.student_id ?? null, instructorId: r.instructor_id ?? null };
}

export class AuthService {
  constructor(private readonly pool: Pool, private readonly config: Config) {}

  private sign(user: UserDTO): string {
    return jwt.sign({ role: user.role }, this.config.jwtSecret, { subject: String(user.id), expiresIn: TOKEN_TTL, algorithm: "HS256" });
  }

  async login(email: string, password: string): Promise<{ user: UserDTO; token: string }> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`${USER_SQL} WHERE u.email = ? AND u.is_simulated = 0`, [email.toLowerCase()]);
    const row = rows[0];
    const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
    // One message for both failures so the form cannot be used to discover which emails exist.
    if (!row || !ok) throw new UnauthorizedError("Incorrect email or password.");
    const user = toDTO(row);
    return { user, token: this.sign(user) };
  }

  /** One-click demo accounts: only when DEMO_MODE=true, and only for the seeded demo domain. */
  async demoLogin(email: string): Promise<{ user: UserDTO; token: string }> {
    if (!this.config.demoMode) throw new ForbiddenError("Demo login is disabled.");
    const [rows] = await this.pool.query<RowDataPacket[]>(`${USER_SQL} WHERE u.email = ? AND u.is_simulated = 0`, [email.toLowerCase()]);
    const row = rows[0];
    if (!row || !(row.email as string).endsWith("@school.test") && !(row.email as string).endsWith("@student.test")) {
      throw new UnauthorizedError("Unknown demo account.");
    }
    const user = toDTO(row);
    return { user, token: this.sign(user) };
  }

  async demoAccounts(): Promise<DemoAccountDTO[]> {
    if (!this.config.demoMode) return [];
    const emails = Object.keys(DEMO_NOTES);
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT email, full_name, role FROM users WHERE email IN (?)", [emails]);
    return emails.flatMap((email) => {
      const r = rows.find((x) => x.email === email);
      return r ? [{ email, fullName: r.full_name as string, role: r.role as DemoAccountDTO["role"], note: DEMO_NOTES[email]! }] : [];
    });
  }

  /** Re-reads the user on every request, so a deleted account or changed role takes effect immediately. */
  async authenticate(token: string | undefined): Promise<UserDTO | null> {
    if (!token) return null;
    try {
      const payload = jwt.verify(token, this.config.jwtSecret, { algorithms: ["HS256"] });
      const id = Number(typeof payload === "string" ? NaN : payload.sub);
      if (!Number.isInteger(id)) return null;
      const [rows] = await this.pool.query<RowDataPacket[]>(`${USER_SQL} WHERE u.id = ? AND u.is_simulated = 0`, [id]);
      return rows[0] ? toDTO(rows[0]) : null;
    } catch {
      return null;
    }
  }
}

export const actorOf = (u: UserDTO): Actor => ({
  userId: u.id,
  role: u.role,
  ...(u.studentId ? { studentId: u.studentId } : {}),
  ...(u.instructorId ? { instructorId: u.instructorId } : {}),
});

import type { Role } from "@enroll/shared";
import {
  BookOpen, CalendarDays, CalendarRange, ChartColumn, Compass, Download, FileText, Gauge, GraduationCap, LayoutDashboard,
  ListChecks, Megaphone, Route, ScrollText, ShieldAlert, ShoppingCart, UserCog, Users, Zap, type LucideIcon,
} from "lucide-react";

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: "cart" }

/** One list per role. The sidebar, the mobile drawer, and the command palette all read from this. */
export const NAV: Record<Role, NavItem[]> = {
  student: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/catalog", label: "Course catalog", icon: BookOpen },
    { to: "/cart", label: "Course selection", icon: ShoppingCart, badge: "cart" },
    { to: "/enrollments", label: "My enrollments", icon: ListChecks },
    { to: "/schedule", label: "Weekly schedule", icon: CalendarDays },
    { to: "/next", label: "What can I take next?", icon: Compass },
    { to: "/transcript", label: "Grades and transcript", icon: GraduationCap },
    { to: "/progress", label: "Degree progress", icon: Route },
    { to: "/overload", label: "Overload requests", icon: Gauge },
    { to: "/registration", label: "Certificate of registration", icon: FileText },
  ],
  instructor: [
    { to: "/instructor", label: "My classes", icon: BookOpen, end: true },
  ],
  admin: [
    { to: "/admin", label: "Overview", icon: ChartColumn, end: true },
    { to: "/admin/courses", label: "Courses", icon: BookOpen },
    { to: "/admin/students", label: "Students", icon: Users },
    { to: "/admin/instructors", label: "Instructors", icon: UserCog },
    { to: "/admin/terms", label: "Academic terms", icon: CalendarRange },
    { to: "/admin/holds", label: "Holds", icon: ShieldAlert },
    { to: "/admin/overloads", label: "Overload requests", icon: Gauge },
    { to: "/admin/announcements", label: "Announcements", icon: Megaphone },
    { to: "/admin/audit", label: "Audit log", icon: ScrollText },
    { to: "/admin/rush", label: "Rush Simulator", icon: Zap },
    { to: "/admin/exports", label: "Exports", icon: Download },
  ],
};

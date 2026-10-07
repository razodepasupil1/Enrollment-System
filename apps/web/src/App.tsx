import { lazy, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { Role } from "@enroll/shared";
import { Shell } from "./components/Shell";
import { LoadingRows } from "./components/ui";
import { CartProvider, useAuth } from "./lib/state";
import { Login } from "./pages/Login";
import { NotFound } from "./pages/NotFound";
import { Cart } from "./pages/student/Cart";
import { Catalog } from "./pages/student/Catalog";
import { CourseDetail } from "./pages/student/CourseDetail";
import { Dashboard } from "./pages/student/Dashboard";
import { MyEnrollments } from "./pages/student/MyEnrollments";
import { Next } from "./pages/student/Next";
import { Overload } from "./pages/student/Overload";
import { Progress } from "./pages/student/Progress";
import { Registration } from "./pages/student/Registration";
import { Schedule } from "./pages/student/Schedule";
import { Transcript } from "./pages/student/Transcript";
// Staff screens (charts, admin forms) are split into their own chunks so students never download them.
const AdminCourses = lazy(() => import("./pages/staff/AdminCourses").then((m) => ({ default: m.AdminCourses })));
const AdminOverview = lazy(() => import("./pages/staff/AdminOverview").then((m) => ({ default: m.AdminOverview })));
const AdminStudents = lazy(() => import("./pages/staff/AdminPeople").then((m) => ({ default: m.AdminStudents })));
const AdminInstructors = lazy(() => import("./pages/staff/AdminPeople").then((m) => ({ default: m.AdminInstructors })));
const AdminTerms = lazy(() => import("./pages/staff/AdminPeople").then((m) => ({ default: m.AdminTerms })));
const AdminHolds = lazy(() => import("./pages/staff/AdminOps").then((m) => ({ default: m.AdminHolds })));
const AdminOverloads = lazy(() => import("./pages/staff/AdminOps").then((m) => ({ default: m.AdminOverloads })));
const AdminAnnouncements = lazy(() => import("./pages/staff/AdminOps").then((m) => ({ default: m.AdminAnnouncements })));
const AdminAudit = lazy(() => import("./pages/staff/AdminOps").then((m) => ({ default: m.AdminAudit })));
const AdminExports = lazy(() => import("./pages/staff/AdminOps").then((m) => ({ default: m.AdminExports })));
const AdminRush = lazy(() => import("./pages/staff/AdminRush").then((m) => ({ default: m.AdminRush })));
const InstructorClasses = lazy(() => import("./pages/staff/InstructorClasses").then((m) => ({ default: m.InstructorClasses })));
const Roster = lazy(() => import("./pages/staff/Roster").then((m) => ({ default: m.Roster })));


/** URL guessing never grants access (the API enforces roles too); this just shows a clear page instead of an error. */
const Only = ({ roles, role, children }: { roles: Role[]; role: Role; children: ReactNode }) => (roles.includes(role) ? <>{children}</> : <NotFound forbidden />);

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="mx-auto max-w-xl p-10"><LoadingRows rows={3} /></div>;
  if (!user) {
    return <Routes><Route path="*" element={<Login />} /></Routes>;
  }
  const role = user.role;
  const home = role === "admin" ? "/admin" : role === "instructor" ? "/instructor" : null;

  return (
    <CartProvider userId={user.id}>
      <Routes>
        <Route element={<Shell user={user} />}>
          <Route index element={home ? <Navigate to={home} replace /> : <Dashboard />} />
          <Route path="login" element={<Navigate to="/" replace />} />

          <Route path="catalog" element={<Only roles={["student"]} role={role}><Catalog /></Only>} />
          <Route path="catalog/:id" element={<Only roles={["student"]} role={role}><CourseDetail /></Only>} />
          <Route path="cart" element={<Only roles={["student"]} role={role}><Cart /></Only>} />
          <Route path="enrollments" element={<Only roles={["student"]} role={role}><MyEnrollments /></Only>} />
          <Route path="schedule" element={<Only roles={["student"]} role={role}><Schedule /></Only>} />
          <Route path="next" element={<Only roles={["student"]} role={role}><Next /></Only>} />
          <Route path="transcript" element={<Only roles={["student"]} role={role}><Transcript /></Only>} />
          <Route path="progress" element={<Only roles={["student"]} role={role}><Progress /></Only>} />
          <Route path="overload" element={<Only roles={["student"]} role={role}><Overload /></Only>} />
          <Route path="registration" element={<Only roles={["student"]} role={role}><Registration /></Only>} />

          <Route path="instructor" element={<Only roles={["instructor"]} role={role}><InstructorClasses /></Only>} />
          <Route path="instructor/courses/:id" element={<Only roles={["instructor"]} role={role}><Roster /></Only>} />

          <Route path="admin" element={<Only roles={["admin"]} role={role}><AdminOverview /></Only>} />
          <Route path="admin/courses" element={<Only roles={["admin"]} role={role}><AdminCourses /></Only>} />
          <Route path="admin/courses/:id/roster" element={<Only roles={["admin"]} role={role}><Roster /></Only>} />
          <Route path="admin/students" element={<Only roles={["admin"]} role={role}><AdminStudents /></Only>} />
          <Route path="admin/instructors" element={<Only roles={["admin"]} role={role}><AdminInstructors /></Only>} />
          <Route path="admin/terms" element={<Only roles={["admin"]} role={role}><AdminTerms /></Only>} />
          <Route path="admin/holds" element={<Only roles={["admin"]} role={role}><AdminHolds /></Only>} />
          <Route path="admin/overloads" element={<Only roles={["admin"]} role={role}><AdminOverloads /></Only>} />
          <Route path="admin/announcements" element={<Only roles={["admin"]} role={role}><AdminAnnouncements /></Only>} />
          <Route path="admin/audit" element={<Only roles={["admin"]} role={role}><AdminAudit /></Only>} />
          <Route path="admin/rush" element={<Only roles={["admin"]} role={role}><AdminRush /></Only>} />
          <Route path="admin/exports" element={<Only roles={["admin"]} role={role}><AdminExports /></Only>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </CartProvider>
  );
}

import { Command } from "cmdk";
import { BookOpen, LogOut, Moon, Plus, Search, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { UserDTO } from "@enroll/shared";
import { useCourses } from "@/lib/queries";
import { useAuth } from "@/lib/state";
import { useTheme } from "@/lib/theme";
import { useEnrollAction } from "./CourseRow";
import { NAV } from "./nav";

/** Ctrl/Cmd+K: jump to a page, find a course, or enroll without leaving the keyboard. */
export function CommandPalette({ user, open, onOpenChange }: { user: UserDTO; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { run } = useEnrollAction();
  const isStudent = user.role === "student";
  const search = useCourses({ q: query, pageSize: 6 });
  const courses = query.trim().length >= 2 ? search.data?.items ?? [] : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); onOpenChange(!open); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const done = (fn: () => void) => () => { onOpenChange(false); fn(); };
  const q = query.trim().toLowerCase();
  const pages = NAV[user.role].filter((n) => !q || n.label.toLowerCase().includes(q));

  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="Command palette" shouldFilter={false}
      overlayClassName="fixed inset-0 z-40 bg-ink/50"
      contentClassName="fixed left-1/2 top-[15vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search className="h-4 w-4 text-muted" aria-hidden />
        <Command.Input value={query} onValueChange={setQuery} placeholder={isStudent ? "Search pages and courses" : "Search pages"} className="h-12 w-full bg-transparent text-ink outline-none placeholder:text-muted" />
      </div>
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-muted">Nothing matches &ldquo;{query}&rdquo;.</Command.Empty>
        {pages.length > 0 && (
          <Command.Group heading="Pages" className="text-sm text-muted [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-semibold">
            {pages.map((n) => (
              <Command.Item key={n.to} value={n.label} onSelect={done(() => navigate(n.to))} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-ink data-[selected=true]:bg-sunken">
                <n.icon className="h-4 w-4 text-muted" aria-hidden />{n.label}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {courses.length > 0 && (
          <Command.Group heading="Courses" className="text-sm text-muted [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-semibold">
            {courses.flatMap((c) => [
              <Command.Item key={`o${c.id}`} value={`open ${c.code}`} onSelect={done(() => navigate(`/catalog/${c.id}`))} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-ink data-[selected=true]:bg-sunken">
                <BookOpen className="h-4 w-4 text-muted" aria-hidden /><span><strong>{c.code}</strong> {c.title}</span>
              </Command.Item>,
              ...(isStudent && !c.mine ? [
                <Command.Item key={`e${c.id}`} value={`enroll ${c.code}`} onSelect={done(() => run(c))} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-ink data-[selected=true]:bg-sunken">
                  <Plus className="h-4 w-4 text-muted" aria-hidden />{c.availability === "FULL" ? "Join the waitlist for" : "Enroll in"} {c.code}
                </Command.Item>,
              ] : []),
            ])}
          </Command.Group>
        )}
        {!q && (
          <Command.Group heading="Actions" className="text-sm text-muted [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-semibold">
            <Command.Item value="theme" onSelect={done(toggle)} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-ink data-[selected=true]:bg-sunken">
              {theme === "dark" ? <Sun className="h-4 w-4 text-muted" aria-hidden /> : <Moon className="h-4 w-4 text-muted" aria-hidden />}Switch to {theme === "dark" ? "light" : "dark"} theme
            </Command.Item>
            <Command.Item value="signout" onSelect={done(() => logout.mutate())} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-ink data-[selected=true]:bg-sunken">
              <LogOut className="h-4 w-4 text-muted" aria-hidden />Sign out
            </Command.Item>
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

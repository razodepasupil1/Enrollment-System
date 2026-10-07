import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, LogOut, Menu as MenuIcon, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, X } from "lucide-react";
import { Suspense, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { UserDTO } from "@enroll/shared";
import { useAuth, useCart, useTerm } from "@/lib/state";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { NAV } from "./nav";
import { NotificationBell } from "./NotificationBell";
import { Button, LoadingRows, Select } from "./ui";

/** The brand mark is the product's own idea in miniature: seats (squares) and people waiting (dots). */
function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="7" className="fill-brand" />
      <g className="fill-on-brand">
        <rect x="6" y="9" width="6" height="6" rx="1.5" /><rect x="13" y="9" width="6" height="6" rx="1.5" />
        <rect x="20" y="9" width="6" height="6" rx="1.5" opacity=".35" />
        <circle cx="9" cy="23" r="2.4" /><circle cx="16" cy="23" r="2.4" />
      </g>
    </svg>
  );
}

function SidebarNav({ user, collapsed, onNavigate }: { user: UserDTO; collapsed: boolean; onNavigate?: () => void }) {
  const cart = useCart();
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
      {NAV[user.role].map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} onClick={onNavigate} title={collapsed ? n.label : undefined}
          className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors", isActive ? "bg-brand text-on-brand" : "text-ink hover:bg-sunken", collapsed && "justify-center px-0")}>
          <n.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
          <span className={cn(collapsed && "sr-only")}>{n.label}</span>
          {n.badge === "cart" && cart.ids.length > 0 && (
            <span className={cn("ml-auto rounded-full bg-sunken px-2 text-xs font-semibold text-ink", collapsed && "sr-only")}>{cart.ids.length}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function TermSwitcher() {
  const { terms, term, setTermId } = useTerm();
  if (terms.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="term-switch" className="sr-only">Academic term</label>
      <Select id="term-switch" value={term?.id ?? ""} onChange={(e) => setTermId(Number(e.target.value))} className="h-9 w-auto min-w-36 text-sm">
        {terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isCurrent ? " (current)" : ""}</option>)}
      </Select>
    </div>
  );
}

function ProfileMenu({ user }: { user: UserDTO }) {
  const { logout } = useAuth();
  const initials = user.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2" aria-label={`Account menu for ${user.fullName}`}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-bold text-on-brand" aria-hidden>{initials}</span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-sm font-semibold">{user.fullName}</span>
            <span className="block text-xs capitalize text-muted">{user.role}</span>
          </span>
          <ChevronDown className="hidden h-4 w-4 text-muted sm:block" aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className="z-50 min-w-48 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
          <div className="px-3 py-2"><p className="text-sm font-semibold">{user.fullName}</p><p className="text-xs text-muted">{user.email}</p></div>
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item onSelect={() => logout.mutate()} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-sunken">
            <LogOut className="h-4 w-4" aria-hidden />Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function Shell({ user }: { user: UserDTO }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar") === "collapsed");
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const { theme, toggle } = useTheme();
  const toggleCollapsed = () => setCollapsed((c) => { localStorage.setItem("sidebar", c ? "open" : "collapsed"); return !c; });

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="skip-link">Skip to main content</a>

      {/* Desktop sidebar (collapses to icons) */}
      <aside className={cn("no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface transition-[width] md:flex", collapsed ? "w-[68px]" : "w-64")}>
        <div className={cn("flex h-16 items-center gap-3 px-4", collapsed && "justify-center px-0")}>
          <Mark />
          <span className={cn("font-display text-lg font-bold leading-tight", collapsed && "sr-only")}>Enrollment portal</span>
        </div>
        <SidebarNav user={user} collapsed={collapsed} />
        <div className="border-t border-line p-3">
          <Button variant="ghost" size="sm" className={cn("w-full justify-start", collapsed && "justify-center")} onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <><PanelLeftClose className="h-4 w-4" aria-hidden />Collapse</>}
          </Button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="no-print fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-ink/50" aria-label="Close navigation" onClick={() => setDrawer(false)} />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-surface shadow-xl">
            <div className="flex h-16 items-center justify-between gap-3 px-4">
              <span className="flex items-center gap-3"><Mark /><span className="font-display text-lg font-bold">Enrollment portal</span></span>
              <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={() => setDrawer(false)}><X className="h-5 w-5" aria-hidden /></Button>
            </div>
            <SidebarNav user={user} collapsed={false} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-surface/95 px-4 backdrop-blur sm:gap-3 sm:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setDrawer(true)}><MenuIcon className="h-5 w-5" aria-hidden /></Button>
          <TermSwitcher />
          <div className="flex-1" />
          <Button variant="secondary" size="sm" className="hidden gap-2 text-muted sm:inline-flex" onClick={() => setPalette(true)} aria-label="Open command palette (Control or Command K)">
            <Search className="h-4 w-4" aria-hidden />Search<kbd className="ml-2 rounded border border-line px-1.5 text-xs">Ctrl K</kbd>
          </Button>
          <Button variant="ghost" size="icon" className="sm:hidden" aria-label="Open command palette" onClick={() => setPalette(true)}><Search className="h-5 w-5" aria-hidden /></Button>
          <NotificationBell />
          <Button variant="ghost" size="icon" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={toggle}>
            {theme === "dark" ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
          </Button>
          <ProfileMenu user={user} />
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8">
          <Suspense fallback={<LoadingRows rows={4} />}><Outlet /></Suspense>
        </main>
      </div>
      <CommandPalette user={user} open={palette} onOpenChange={setPalette} />
    </div>
  );
}

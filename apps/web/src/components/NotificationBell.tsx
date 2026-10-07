import * as Menu from "@radix-ui/react-dropdown-menu";
import { Bell } from "lucide-react";
import { useApiMutation, useNotifications } from "@/lib/queries";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

export function NotificationBell() {
  const { data } = useNotifications();
  const markRead = useApiMutation<number>("PATCH", (id) => `/notifications/${id}/read`, ["notifications"], () => undefined);
  const markAll = useApiMutation<void>("POST", () => "/notifications/read-all", ["notifications"], () => undefined);
  const unread = data?.unreadCount ?? 0;

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className="relative">
          <Bell className="h-5 w-5" aria-hidden />
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-full px-1 text-[10px] font-bold text-surface dark:text-paper">{unread > 9 ? "9+" : unread}</span>}
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className="z-50 max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-line bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-base">Notifications</h2>
            {unread > 0 && <Button variant="ghost" size="sm" onClick={() => markAll.mutate()}>Mark all read</Button>}
          </div>
          {!data?.items.length && <p className="px-4 py-8 text-center text-muted">Nothing yet. Waitlist moves, holds and grades will show up here.</p>}
          <ul>
            {data?.items.map((n) => (
              <li key={n.id} className="border-b border-line last:border-0">
                <Menu.Item onSelect={(e) => { e.preventDefault(); if (!n.isRead) markRead.mutate(n.id); }}
                  className="flex w-full cursor-pointer gap-3 px-4 py-3 outline-none data-[highlighted]:bg-sunken">
                  <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.isRead ? "bg-transparent" : "bg-brand")} />
                  <span className="min-w-0">
                    <span className={cn("block text-sm", !n.isRead && "font-semibold")}>{n.title}{!n.isRead && <span className="sr-only"> (unread)</span>}</span>
                    <span className="block text-sm text-muted">{n.body}</span>
                    <span className="block text-xs text-muted">{timeAgo(n.createdAt)}</span>
                  </span>
                </Menu.Item>
              </li>
            ))}
          </ul>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

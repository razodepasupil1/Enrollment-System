import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, X } from "lucide-react";
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/api";

// --- Button -------------------------------------------------------------------------------------------
const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55 select-none",
  {
    variants: {
      variant: {
        primary: "bg-brand text-on-brand hover:brightness-110",
        secondary: "border border-line bg-surface text-ink hover:bg-sunken",
        ghost: "text-ink hover:bg-sunken",
        danger: "bg-full text-surface hover:brightness-110 dark:text-paper",
      },
      size: { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { asChild?: boolean; loading?: boolean };
export function Button({ className, variant, size, asChild, loading, children, disabled, ...rest }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(button({ variant, size }), className)} disabled={disabled || loading} {...rest}>
      {asChild ? children : <>{loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{children}</>}
    </Comp>
  );
}

// --- Form fields -------------------------------------------------------------------------------------------
const fieldBase = "w-full rounded-md border border-line bg-surface px-3 text-ink placeholder:text-muted/70 disabled:opacity-60 aria-[invalid=true]:border-full";
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(fieldBase, "h-10", className)} {...p} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn(fieldBase, "min-h-24 py-2", className)} {...p} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(fieldBase, "h-10 pr-8", className)} {...p} />;

/** Label + control + hint/error wired together with ids, so screen readers announce the error. */
export function Field({ label, error, hint, children }: { label: string; error?: string | undefined; hint?: string; children: (a: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      {children({ id, ...(describedBy ? { "aria-describedby": describedBy } : {}), ...(error ? { "aria-invalid": true } : {}) })}
      {error ? <p id={`${id}-err`} role="alert" className="text-sm text-full">{error}</p> : hint ? <p id={`${id}-hint`} className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

// --- Badge -----------------------------------------------------------------------------------------------------
const badge = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", {
  variants: {
    tone: {
      open: "bg-open-bg text-open", almost: "bg-almost-bg text-almost", full: "bg-full-bg text-full", wait: "bg-wait-bg text-wait",
      neutral: "bg-sunken text-muted", brand: "bg-brand text-on-brand",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export const Badge = ({ tone, className, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) => <span className={cn(badge({ tone }), className)} {...p} />;

// --- Layout pieces ----------------------------------------------------------------------------------------------
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A bordered region. Used sparingly: most content sits directly on the page. */
export function Panel({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          {title && <h2 className="text-base">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cn("animate-pulse rounded-md bg-sunken", className)} />;

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <Inbox className="h-8 w-8 text-muted" aria-hidden />
      <h3>{title}</h3>
      {children && <p className="text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-xl border border-full/40 bg-full-bg px-6 py-10 text-center">
      <AlertTriangle className="h-7 w-7 text-full" aria-hidden />
      <h3 className="text-full">Could not load this page</h3>
      <p className="text-full">{errorMessage(error)}</p>
      {retry && <Button variant="secondary" size="sm" onClick={retry}>Try again</Button>}
    </div>
  );
}

export function ProgressBar({ value, max, label, tone = "brand" }: { value: number; max: number; label: string; tone?: "brand" | "full" }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 w-full overflow-hidden rounded-full bg-sunken">
      <div className={cn("h-full rounded-full transition-[width]", tone === "full" ? "bg-full" : "bg-brand")} style={{ width: `${pct}%` }} />
    </div>
  );
}

// --- Tooltip: also works on DISABLED buttons (they swallow pointer events, so wrap in a focusable span) ----------------
export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  if (!content) return <>{children}</>;
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild><span tabIndex={0} className="inline-flex rounded-md">{children}</span></Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="top" align="end" sideOffset={6} className="z-50 max-w-xs rounded-lg bg-ink px-3 py-2 text-sm text-paper shadow-lg">
            {content}
            <Tooltip.Arrow className="fill-ink" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

// --- Dialogs ---------------------------------------------------------------------------------------------------------
export function Modal({ open, onOpenChange, title, description, children, footer, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/50" />
        <Dialog.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-xl", wide ? "max-w-2xl" : "max-w-md")}>
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="font-display text-lg font-bold">{title}</Dialog.Title>
            <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close"><X className="h-4 w-4" aria-hidden /></Button></Dialog.Close>
          </div>
          {description ? <Dialog.Description className="mt-2 text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Destructive actions always ask first, and say exactly what will happen. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, danger, loading, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: ReactNode; confirmLabel: string; danger?: boolean; loading?: boolean; onConfirm: () => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>} />
  );
}

// --- Pagination ------------------------------------------------------------------------------------------------------------
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="no-print mt-4 flex items-center justify-between gap-3 text-sm">
      <p className="text-muted">Showing {from} to {to} of {total}</p>
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" aria-hidden />Prev</Button>
        <span className="px-2">Page {page} of {pages}</span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">Next<ChevronRight className="h-4 w-4" aria-hidden /></Button>
      </div>
    </nav>
  );
}

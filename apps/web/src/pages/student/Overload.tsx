import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { overloadRequestSchema } from "@enroll/shared";
import { Badge, Button, EmptyState, ErrorState, Field, LoadingRows, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiMutation, useMyOverloads, useSummary } from "@/lib/queries";

const TONE = { PENDING: "almost", APPROVED: "open", REJECTED: "full" } as const;

export function Overload() {
  const list = useMyOverloads();
  const summary = useSummary();
  const submit = useApiMutation<{ extraUnits: number; reason: string }>("POST", () => "/me/overload-requests", ["my-overloads", "summary"]);
  const { register, handleSubmit, reset, formState: { errors } } = useForm({ resolver: zodResolver(overloadRequestSchema), defaultValues: { extraUnits: 3, reason: "" } });
  const pending = list.data?.requests.some((r) => r.status === "PENDING");

  return (
    <>
      <PageHeader title="Overload requests" description={summary.data ? `You carry ${summary.data.unitsUsed} of ${summary.data.unitsLimit} units. To go past your limit, ask the registrar for extra units.` : undefined} />
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Panel title="Ask for extra units">
          <form noValidate className="space-y-4" onSubmit={handleSubmit((v) => submit.mutate(v, { onSuccess: () => { toast.success("Request sent to the registrar."); reset(); }, onError: (e) => toast.error(errorMessage(e)) }))}>
            <Field label="Extra units" error={errors.extraUnits?.message}>{(a) => <Select {...a} {...register("extraUnits", { valueAsNumber: true })}>{[1, 2, 3, 4, 5, 6, 9].map((n) => <option key={n} value={n}>{n} {n === 1 ? "unit" : "units"}</option>)}</Select>}</Field>
            <Field label="Why do you need them?" error={errors.reason?.message} hint="For example: graduating next term and need this course to stay on track.">{(a) => <Textarea {...a} {...register("reason")} />}</Field>
            {pending && <p className="text-sm text-almost">You already have a pending request. Wait for a decision before sending another.</p>}
            <Button type="submit" className="w-full" loading={submit.isPending} disabled={pending}>Send request</Button>
          </form>
        </Panel>
        <div>
          {list.isLoading && <LoadingRows rows={2} />}
          {list.isError && <ErrorState error={list.error} retry={() => void list.refetch()} />}
          {list.data && list.data.requests.length === 0 && <EmptyState title="No requests yet">Requests you send will be listed here with the registrar&rsquo;s decision.</EmptyState>}
          <ul className="space-y-3">
            {list.data?.requests.map((r) => (
              <li key={r.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">+{r.extraUnits} units for {r.termName}</p><Badge tone={TONE[r.status]}>{r.status === "PENDING" ? "Waiting for a decision" : r.status === "APPROVED" ? "Approved" : "Declined"}</Badge></div>
                <p className="mt-1 text-muted">{r.reason}</p>
                <p className="mt-1 text-sm text-muted">Sent {formatDate(r.createdAt)}{r.decidedAt ? `, decided ${formatDate(r.decidedAt)}` : ""}{r.decisionNote ? `. Note: ${r.decisionNote}` : ""}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

import { useMutation, useQueries } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, ShoppingCart, Sparkles, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { BatchItemResultDTO, CatalogItemDTO, ScheduleSuggestionDTO } from "@enroll/shared";
import { SeatStrip } from "@/components/SeatStrip";
import { Badge, Button, EmptyState, ErrorState, LoadingRows, PageHeader, Panel } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { plural } from "@/lib/format";
import { POLL_MS, useBatchEnroll, useSummary, useValidation } from "@/lib/queries";
import { useCart } from "@/lib/state";

type Detail = CatalogItemDTO & { prerequisiteTitles: Record<string, string> };

export function Cart() {
  const cart = useCart();
  const summary = useSummary();
  const batch = useBatchEnroll();
  const [report, setReport] = useState<BatchItemResultDTO[] | null>(null);

  // Shares the ["course", id] cache with the course page; polls so seat counts stay honest.
  const details = useQueries({
    queries: cart.ids.map((id) => ({ queryKey: ["course", id], queryFn: () => api<Detail>(`/courses/${id}`), refetchInterval: POLL_MS, staleTime: 5_000 })),
  });
  // Pass the whole cart as context so a lecture and its lab validate together.
  const verdicts = useValidation(cart.ids, cart.ids);

  const suggest = useMutation({
    mutationFn: () => api<ScheduleSuggestionDTO>("/enrollments/suggest", { method: "POST", body: { courseIds: cart.ids } }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  /** Keep one suggested combination: everything in the cart that is not part of it is removed. */
  const keep = (codes: string[]) => {
    for (const d of details) if (d.data && !codes.includes(d.data.code)) cart.remove(d.data.id);
    suggest.reset();
    toast.success("Course selection updated to that combination.");
  };

  const submit = () => {
    batch.mutate(cart.ids, {
      onSuccess: ({ results }) => {
        setReport(results);
        results.filter((r) => r.status !== "REJECTED").forEach((r) => cart.remove(r.courseId));
        const ok = results.filter((r) => r.status !== "REJECTED").length;
        const bad = results.length - ok;
        (bad === 0 ? toast.success : ok === 0 ? toast.error : toast.warning)(`${plural(ok, "course")} processed${bad ? `, ${bad} could not be added` : ""}.`);
      },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : errorMessage(e)),
    });
  };

  const loaded = details.filter((d) => d.data).map((d) => d.data!);
  const totalUnits = loaded.reduce((s, c) => s + c.units, 0);
  const s = summary.data;

  return (
    <>
      <PageHeader title="Course selection" description="Select courses, check each one, then enroll in all of them at once." />

      {report && (
        <Panel title="Result of your last submit" className="mb-6" actions={<Button variant="ghost" size="sm" onClick={() => setReport(null)}>Dismiss</Button>}>
          <ul className="space-y-3" aria-live="polite">
            {report.map((r) => (
              <li key={r.courseId} className="flex items-start gap-3">
                {r.status === "ENROLLED" && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-open" aria-hidden />}
                {r.status === "WAITLISTED" && <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-wait" aria-hidden />}
                {r.status === "REJECTED" && <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-full" aria-hidden />}
                <div>
                  <p className="font-semibold">{r.code ?? `Course ${r.courseId}`}: {r.status === "ENROLLED" ? "enrolled" : r.status === "WAITLISTED" ? `waitlisted, #${r.waitlistPosition}` : "not added"}</p>
                  {r.error && <p className="text-full">{r.error.message}</p>}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {cart.ids.length === 0 ? (
        <EmptyState title="Your course selection is empty" action={<Button asChild><Link to="/catalog">Browse the catalog</Link></Button>}>Use &ldquo;Add to selection&rdquo; on any course to check it here before you enroll.</EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0 space-y-6">
          <ul className="space-y-3" aria-label="Selected courses">
            {cart.ids.map((id, i) => {
              const d = details[i];
              const c = d?.data;
              const v = verdicts.data?.results[id];
              if (d?.isLoading) return <li key={id}><LoadingRows rows={1} /></li>;
              if (!c) return (
                <li key={id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4"><p className="text-muted">This course is no longer available.</p><Button variant="ghost" size="sm" onClick={() => cart.remove(id)}>Remove</Button></li>
              );
              return (
                <li key={id} className="space-y-3 rounded-xl border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="flex flex-wrap items-baseline gap-x-3"><Link to={`/catalog/${c.id}`} className="font-display text-lg font-bold hover:underline">{c.code}</Link><span className="font-medium">{c.title}</span></p>
                      <p className="text-sm text-muted">{c.meetingSummary}, {plural(c.units, "unit")}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => cart.remove(id)} aria-label={`Remove ${c.code} from course selection`}><Trash2 className="h-4 w-4" aria-hidden />Remove</Button>
                  </div>
                  <SeatStrip capacity={c.capacity} enrolled={c.enrolledCount} waitlisted={c.waitlistedCount} availability={c.availability} />
                  {/* Live dry-run result for this item: the same rules as the real enroll, nothing is written. */}
                  {c.mine ? <Badge tone="open">You are already {c.mine.status === "ENROLLED" ? "enrolled" : "waitlisted"}</Badge>
                    : !v ? <p className="text-sm text-muted">Checking requirements...</p>
                    : v.outcome === "ENROLL" ? <p className="flex items-center gap-2 text-sm text-open"><CheckCircle2 className="h-4 w-4" aria-hidden />Ready to enroll</p>
                    : v.outcome === "WAITLIST" ? <p className="flex items-center gap-2 text-sm text-wait"><CircleAlert className="h-4 w-4" aria-hidden />Full: you would be #{v.wouldBeWaitlistPosition} on the waitlist</p>
                    : <ul className="space-y-1 text-sm text-full">{v.violations.filter((x) => x.severity === "block").map((x, k) => <li key={k} className="flex items-start gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{x.message}</li>)}</ul>}
                </li>
              );
            })}
          </ul>
          {cart.ids.length >= 2 && (
            <Panel title="Schedule suggester" className="lg:col-span-1">
              <p className="mb-3 text-muted">Check which of these courses can be taken together without overlapping, and see the best combinations if some cannot.</p>
              <Button variant="secondary" onClick={() => suggest.mutate()} loading={suggest.isPending}><Sparkles className="h-4 w-4" aria-hidden />Check selected courses for overlaps</Button>
              {suggest.data && (
                <div className="mt-4 space-y-4" aria-live="polite">
                  {suggest.data.conflictFree && <p className="flex items-center gap-2 text-open"><CheckCircle2 className="h-5 w-5" aria-hidden />No overlaps. These courses fit together and with your current classes.</p>}
                  {suggest.data.blockedByCurrent.length > 0 && (
                    <div><h3 className="mb-1">Clash with classes you already have</h3>
                      <ul className="space-y-1 text-full">{suggest.data.blockedByCurrent.map((b) => <li key={b.code}>{b.code} overlaps your {b.with.join(", ")}. You would have to drop that class first.</li>)}</ul></div>
                  )}
                  {suggest.data.conflicts.length > 0 && (
                    <div><h3 className="mb-1">Overlaps in your course selection</h3>
                      <ul className="space-y-1 text-full">{suggest.data.conflicts.map((c) => <li key={c.summary}>{c.summary}</li>)}</ul>
                      <p className="mt-2 text-muted">Leave out at least {suggest.data.minimalRemovals} {suggest.data.minimalRemovals === 1 ? "course" : "courses"} to remove every overlap.</p></div>
                  )}
                  {suggest.data.combinations.length > 0 && suggest.data.conflicts.length > 0 && (
                    <div><h3 className="mb-2">Best combinations</h3>
                      <ul className="space-y-2">{suggest.data.combinations.map((c) => (
                        <li key={c.codes.join()} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                          <span><strong>{c.codes.join(", ")}</strong> <span className="text-muted">{plural(c.units, "unit")}</span></span>
                          <Button size="sm" variant="secondary" onClick={() => keep(c.codes)} aria-label={`Keep ${c.codes.join(" and ")}`}>Keep this combination</Button>
                        </li>))}</ul></div>
                  )}
                </div>
              )}
            </Panel>
          )}
          </div>

          <aside>
            <Panel title="Summary" className="sticky top-24">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Selected courses</dt><dd className="font-semibold">{cart.ids.length}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Selected units</dt><dd className="font-semibold">{totalUnits}</dd></div>
                {s && <div className="flex justify-between"><dt className="text-muted">Units now</dt><dd className="font-semibold">{s.unitsUsed} of {s.unitsLimit}</dd></div>}
              </dl>
              <p className="mt-3 text-sm text-muted">Overlaps between selected courses are checked when you submit, in the order shown.</p>
              <Button className="mt-4 w-full" onClick={submit} loading={batch.isPending}><ShoppingCart className="h-4 w-4" aria-hidden />Enroll in all ({cart.ids.length})</Button>
              <Button variant="ghost" className="mt-2 w-full" onClick={cart.clear}>Clear selection</Button>
            </Panel>
          </aside>
        </div>
      )}
    </>
  );
}

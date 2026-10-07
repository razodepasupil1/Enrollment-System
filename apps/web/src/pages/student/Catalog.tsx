import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CourseRow } from "@/components/CourseRow";
import { Button, EmptyState, ErrorState, Field, Input, LoadingRows, PageHeader, Pagination, Select } from "@/components/ui";
import { useCourses, useMeta, useValidation, type CatalogParams } from "@/lib/queries";
import { useTerm } from "@/lib/state";

const DAYS = [["MON", "Monday"], ["TUE", "Tuesday"], ["WED", "Wednesday"], ["THU", "Thursday"], ["FRI", "Friday"], ["SAT", "Saturday"]] as const;

/** Every filter lives in the URL, so a filtered view can be bookmarked, shared, and survives a reload. */
export function Catalog() {
  const [params, setParams] = useSearchParams();
  const { termId, term } = useTerm();
  const meta = useMeta();
  const get = (k: string) => params.get(k) ?? "";
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  // Typing updates the box instantly but only queries the server once you pause.
  const [text, setText] = useState(get("q"));
  useEffect(() => { const t = setTimeout(() => { if (text !== get("q")) set({ q: text }); }, 300); return () => clearTimeout(t); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const units = get("units");
  const query: CatalogParams = {
    ...(termId ? { termId } : {}),
    ...(get("q") ? { q: get("q") } : {}),
    ...(get("department") ? { department: get("department") } : {}),
    ...(get("day") ? { day: get("day") } : {}),
    ...(get("availability") ? { availability: get("availability") } : {}),
    ...(units ? (units === "4" ? { minUnits: 4 } : { minUnits: Number(units), maxUnits: Number(units) }) : {}),
    sort: get("sort") || "code",
    page: Number(get("page")) || 1,
    pageSize: 8,
  };
  const courses = useCourses(query);
  const ids = courses.data?.items.map((c) => c.id) ?? [];
  const verdicts = useValidation(ids);
  const filtered = ["q", "department", "day", "availability", "units"].some((k) => get(k));

  return (
    <>
      <PageHeader title="Course catalog" description={term ? `${term.name}. Seat counts update while you browse.` : undefined} />
      <form role="search" aria-label="Filter courses" onSubmit={(e) => e.preventDefault()} className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <Field label="Search">{(a) => (
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" aria-hidden />
              <Input {...a} type="search" className="pl-9" placeholder="Code or title, like CS or data" value={text} onChange={(e) => setText(e.target.value)} /></div>
          )}</Field>
        </div>
        <Field label="Department">{(a) => (
          <Select {...a} value={get("department")} onChange={(e) => set({ department: e.target.value })}>
            <option value="">All departments</option>{meta.data?.departments.map((d) => <option key={d.id} value={d.code}>{d.name}</option>)}
          </Select>)}</Field>
        <Field label="Meets on">{(a) => (
          <Select {...a} value={get("day")} onChange={(e) => set({ day: e.target.value })}>
            <option value="">Any day</option>{DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>)}</Field>
        <Field label="Seats">{(a) => (
          <Select {...a} value={get("availability")} onChange={(e) => set({ availability: e.target.value })}>
            <option value="">Open and full</option><option value="open">Open seats only</option><option value="full">Full classes</option>
          </Select>)}</Field>
        <Field label="Units">{(a) => (
          <Select {...a} value={units} onChange={(e) => set({ units: e.target.value })}>
            <option value="">Any</option><option value="1">1 unit</option><option value="2">2 units</option><option value="3">3 units</option><option value="4">4 or more</option>
          </Select>)}</Field>
        <Field label="Sort by">{(a) => (
          <Select {...a} value={get("sort") || "code"} onChange={(e) => set({ sort: e.target.value === "code" ? "" : e.target.value })}>
            <option value="code">Course code</option><option value="title">Title</option><option value="seats">Most seats left</option><option value="fill">Fullest first</option><option value="units">Most units</option>
          </Select>)}</Field>
        {filtered && <div className="flex items-end"><Button type="button" variant="ghost" onClick={() => { setText(""); setParams({}, { replace: true }); }}><X className="h-4 w-4" aria-hidden />Clear filters</Button></div>}
      </form>

      <p className="sr-only" role="status" aria-live="polite">{courses.data ? `${courses.data.total} courses found` : ""}</p>
      {courses.isLoading && <LoadingRows rows={5} />}
      {courses.isError && <ErrorState error={courses.error} retry={() => void courses.refetch()} />}
      {courses.data && courses.data.items.length === 0 && (
        <EmptyState title="No courses match" action={filtered ? <Button variant="secondary" onClick={() => { setText(""); setParams({}, { replace: true }); }}>Clear filters</Button> : undefined}>
          {filtered ? "Try fewer filters or a different search." : "There are no courses in this term yet."}
        </EmptyState>
      )}
      {courses.data && courses.data.items.length > 0 && (
        <>
          <ul className="space-y-3" aria-label="Courses">
            {courses.data.items.map((c) => <CourseRow key={c.id} course={c} verdict={verdicts.data?.results[c.id]} />)}
          </ul>
          <Pagination page={courses.data.page} pageSize={courses.data.pageSize} total={courses.data.total} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
    </>
  );
}

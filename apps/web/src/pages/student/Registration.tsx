import { Printer } from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { useRegistrationForm } from "@/lib/queries";
import { useTerm } from "@/lib/state";

/** Print CSS hides the app chrome, so "Print / Save as PDF" produces a clean one-page certificate. */
export function Registration() {
  const { termId } = useTerm();
  const q = useRegistrationForm(termId);
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const f = q.data!;
  const enrolled = f.courses.filter((c) => c.status === "ENROLLED");
  const waitlisted = f.courses.filter((c) => c.status === "WAITLISTED");

  return (
    <>
      <PageHeader title="Certificate of registration" description="Choose Print, then Save as PDF in the print dialog to keep a copy." actions={<Button onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden />Print / Save as PDF</Button>} />
      <article className="print-sheet rounded-xl border border-line bg-surface p-8" aria-label="Certificate of registration">
        <header className="mb-6 border-b border-line pb-5 text-center">
          <p className="text-sm text-muted">Office of the Registrar</p>
          <h2 className="font-display text-2xl font-bold">Certificate of Registration</h2>
          <p className="mt-1">{f.term.name}</p>
        </header>
        <dl className="mb-6 grid gap-3 sm:grid-cols-2">
          <div><dt className="text-sm text-muted">Student</dt><dd className="font-semibold">{f.student.fullName}</dd></div>
          <div><dt className="text-sm text-muted">Student number</dt><dd className="font-semibold">{f.student.studentNumber}</dd></div>
          <div><dt className="text-sm text-muted">Program and year</dt><dd className="font-semibold">{f.student.program}, year {f.student.yearLevel}</dd></div>
          <div><dt className="text-sm text-muted">Email</dt><dd className="font-semibold">{f.student.email}</dd></div>
        </dl>
        {enrolled.length === 0 ? <EmptyState title="You have no enrolled courses this term" /> : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Enrolled courses</caption>
            <thead className="border-y border-line"><tr><th scope="col" className="py-2 font-semibold">Course</th><th scope="col" className="py-2 font-semibold">Title</th><th scope="col" className="py-2 font-semibold">Schedule</th><th scope="col" className="py-2 font-semibold">Room</th><th scope="col" className="py-2 font-semibold">Instructor</th><th scope="col" className="py-2 text-right font-semibold">Units</th></tr></thead>
            <tbody className="divide-y divide-line">
              {enrolled.map((c) => <tr key={c.code}><td className="py-2 font-semibold">{c.code}</td><td className="py-2">{c.title}</td><td className="py-2">{c.schedule}</td><td className="py-2">{c.room ?? "TBA"}</td><td className="py-2">{c.instructor ?? "TBA"}</td><td className="py-2 text-right">{c.units}</td></tr>)}
            </tbody>
            <tfoot><tr className="border-t border-line"><td colSpan={5} className="py-2 text-right font-semibold">Total units</td><td className="py-2 text-right font-semibold">{f.totalUnits}</td></tr></tfoot>
          </table>
        )}
        {waitlisted.length > 0 && <p className="mt-4 text-sm text-muted">On waitlists (not enrolled): {waitlisted.map((c) => c.code).join(", ")}.</p>}
        <footer className="mt-10 grid grid-cols-2 gap-8 text-sm"><div className="border-t border-ink pt-2">Student signature</div><div className="border-t border-ink pt-2">Registrar</div></footer>
        <p className="mt-6 text-xs text-muted">Generated {formatDate(f.generatedAt)}.</p>
      </article>
    </>
  );
}

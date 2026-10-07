import { Printer } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/ui";
import { formatDate, gpaText } from "@/lib/format";
import { useTranscript } from "@/lib/queries";

const STANDING = {
  DEANS_LIST: { label: "Dean's List", tone: "open" as const },
  GOOD_STANDING: { label: "Good standing", tone: "neutral" as const },
  PROBATION: { label: "Academic probation", tone: "full" as const },
  NO_RECORD: { label: "No grades yet", tone: "neutral" as const },
};

export function Transcript() {
  const q = useTranscript();
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const t = q.data!;
  const standing = STANDING[t.standing];

  return (
    <>
      <PageHeader title="Grades and transcript" description={`Graded on the ${t.policyName}.`} actions={<Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden />Print</Button>} />
      <div className="print-sheet rounded-xl border border-line bg-surface p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div><p className="font-display text-2xl font-bold">{t.studentName}</p><p className="text-muted">{t.studentNumber}, {t.program}</p></div>
          <dl className="grid grid-cols-3 gap-6 text-right">
            <div><dt className="text-sm text-muted">Cumulative GPA</dt><dd className="font-display text-2xl font-bold">{gpaText(t.cumulativeGpa)}</dd></div>
            <div><dt className="text-sm text-muted">Units earned</dt><dd className="font-display text-2xl font-bold">{t.unitsEarned}</dd></div>
            <div><dt className="text-sm text-muted">Standing</dt><dd className="pt-1.5"><Badge tone={standing.tone}>{standing.label}</Badge></dd></div>
          </dl>
        </div>

        {t.terms.length === 0 && <EmptyState title="No courses on your record yet" />}
        {t.terms.map((term) => (
          <section key={term.termId} className="mb-8 break-inside-avoid" aria-labelledby={`term-${term.termId}`}>
            <div className="mb-2 flex items-baseline justify-between"><h2 id={`term-${term.termId}`}>{term.termName}</h2><p className="text-sm text-muted">Term GPA {gpaText(term.termGpa)}, {term.unitsEarned} units earned</p></div>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Courses in {term.termName}</caption>
              <thead className="border-b border-line text-muted"><tr><th scope="col" className="py-2 font-semibold">Course</th><th scope="col" className="py-2 font-semibold">Title</th><th scope="col" className="py-2 text-right font-semibold">Units</th><th scope="col" className="py-2 text-right font-semibold">Grade</th></tr></thead>
              <tbody className="divide-y divide-line">
                {term.courses.map((c) => (
                  <tr key={c.code}>
                    <td className="py-2 font-semibold">{c.code}</td><td className="py-2">{c.title}</td><td className="py-2 text-right">{c.units}</td>
                    <td className="py-2 text-right font-semibold">{c.display}{c.status === "FAILED" && <span className="sr-only"> (failed)</span>}{c.display === "W" && <span className="sr-only"> (withdrawn)</span>}{c.display === "IP" && <span className="sr-only"> (in progress)</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        <p className="text-xs text-muted">W means withdrawn after the drop deadline; IP means in progress. Generated {formatDate(t.generatedAt)}.</p>
      </div>
    </>
  );
}

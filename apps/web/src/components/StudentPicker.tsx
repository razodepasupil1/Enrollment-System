import { useState } from "react";
import type { AdminStudentDTO } from "@enroll/shared";
import { useAdminStudents } from "@/lib/queries";
import { Button, Field, Input } from "./ui";

/** Search-and-pick a student (admin tools). Shows the choice as a removable chip. */
export function StudentPicker({ value, onChange }: { value: AdminStudentDTO | null; onChange: (s: AdminStudentDTO | null) => void }) {
  const [q, setQ] = useState("");
  const results = useAdminStudents(q, 1);
  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-sunken px-3 py-2">
        <p><strong>{value.fullName}</strong> <span className="text-muted">{value.studentNumber}</span></p>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Field label="Find a student" hint="Search by name, student number, or email.">{(a) => <Input {...a} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
      <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-md border border-line" aria-label="Matching students">
        {results.data?.items.map((s) => (
          <li key={s.id}><button type="button" onClick={() => onChange(s)} className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-sunken"><span className="font-medium">{s.fullName}</span><span className="text-sm text-muted">{s.studentNumber}</span></button></li>
        ))}
        {results.data?.items.length === 0 && <li className="px-3 py-3 text-sm text-muted">No student matches.</li>}
      </ul>
    </div>
  );
}

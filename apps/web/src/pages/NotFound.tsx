import { Link } from "react-router-dom";
import { Button, EmptyState } from "@/components/ui";

export function NotFound({ forbidden = false }: { forbidden?: boolean }) {
  return (
    <div className="mx-auto mt-16 max-w-lg">
      <EmptyState
        title={forbidden ? "You do not have access to this page" : "We could not find that page"}
        action={<Button asChild><Link to="/">Go to your home page</Link></Button>}>
        {forbidden ? "This page belongs to a different role. Use the menu to find your own pages." : "The link may be old, or the address may have a typo."}
      </EmptyState>
    </div>
  );
}

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui";

/** A crash in one page shows a recovery screen instead of a blank white window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error, info: ErrorInfo) { console.error("UI error", error, info.componentStack); }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-24 max-w-md space-y-3 rounded-xl border border-line bg-surface p-8 text-center">
        <h1>This page hit a problem</h1>
        <p className="text-muted">Nothing you entered was lost on the server. Reload to continue.</p>
        <Button onClick={() => window.location.reload()}>Reload the page</Button>
      </div>
    );
  }
}

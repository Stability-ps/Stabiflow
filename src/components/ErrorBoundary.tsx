import { Component, type ErrorInfo, type ReactNode } from "react";

// Before this existed, the app had zero error boundaries anywhere - an
// uncaught render error in ANY component (a bad date, a null relation from
// a Supabase join, anything) unmounts the whole React root in React 18,
// producing a fully blank white page for the entire app, not just the
// page that actually broke. This is the general fix; see AppRoutes/Dashboard
// for where it's applied so a crash in one dashboard page can't take the
// sidebar and every other route down with it.
type Props = { children: ReactNode; label?: string };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`ErrorBoundary${this.props.label ? ` (${this.props.label})` : ""} caught:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-lg font-semibold text-foreground">Something went wrong loading this page.</p>
          <p className="max-w-md text-sm text-muted-foreground">{this.state.error.message || "An unexpected error occurred."}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Props = { children: ReactNode; label: string };
type State = { error: Error | null };

// One failed widget must never break the rest of the dashboard (see
// AppLayout/ErrorBoundary for the equivalent full-page guard) - this is
// the same pattern scoped down to a single grid tile, with a fallback
// sized and worded for a widget rather than a whole page, and a retry
// that just remounts this one tile instead of reloading the app.
export class DashboardWidgetFrame extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`Dashboard widget "${this.props.label}" crashed:`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <Card className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <AlertTriangle className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium">{this.props.label} unavailable</p>
          <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>Try again</Button>
        </Card>
      );
    }
    return this.props.children;
  }
}

import { Component, type ErrorInfo, type ReactNode } from "react";
import { createApiClient } from "./apiClient";

type Props = { source: "web" | "admin"; children: ReactNode };
type State = { hasError: boolean };

/**
 * Last-resort boundary: a render-time crash below here shows a recoverable
 * fallback (apology + reload) instead of the bare background, and is reported to
 * /api/v1/errors. React does NOT route render errors through window 'error', so
 * without this the errorReporter misses them and the user just sees a blank
 * page. The fallback leans on inline styles + CSS tokens so it renders even if a
 * component-level failure left the tree in an odd state.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  private reported = false;

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.reported) return;
    this.reported = true;
    try {
      void createApiClient()
        .reportClientError({
          source: this.props.source,
          message: error.message || String(error),
          context: `${error.stack ?? ""}${info.componentStack ?? ""}`.slice(0, 4000) || undefined,
          page: typeof window !== "undefined" ? window.location.pathname : undefined,
        })
        .catch(() => {});
    } catch {
      // The boundary must never throw.
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 360, display: "grid", gap: 16, textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{"應用程式發生問題"}</h1>
          <p style={{ margin: 0, opacity: 0.7 }}>
            {"很抱歉，畫面出了點狀況。重新整理通常就能恢復。"}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              minHeight: 48,
              borderRadius: 14,
              padding: "0 20px",
              fontWeight: 800,
              color: "rgb(var(--ink))",
              background: "rgb(var(--gold))",
            }}
          >
            {"重新整理"}
          </button>
        </div>
      </div>
    );
  }
}

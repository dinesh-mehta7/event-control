import React from 'react';

// Catches a crash while rendering, so one broken page shows a recovery message instead of a blank app.
// `page` mode fits inside the main area (navigating to another page clears it, via the parent's `key`);
// otherwise it covers the whole screen.
interface Props {
  children: React.ReactNode;
  page?: boolean;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Page crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const box = (
      <div role="alert" className="mx-auto max-w-md rounded-xl border border-line bg-surface p-6 text-center shadow-sm">
        <h2 className="text-base font-semibold text-ink">Something went wrong</h2>
        <p className="mt-2 text-sm text-mute">
          {this.props.page
            ? 'This page hit an error. Your data is safe — try again, or open another page from the menu.'
            : 'The app hit an error. Your data is safe — reload to continue.'}
        </p>
        <details className="mt-3 text-left text-xs text-faint">
          <summary className="cursor-pointer">Technical details</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">{error.message}</pre>
        </details>
        <div className="mt-4 flex justify-center gap-2">
          {this.props.page && (
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-3.5 py-2 rounded-lg text-sm font-medium border border-line-strong text-ink-soft hover:bg-raised hover:text-ink"
            >
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-3.5 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white"
          >
            Reload
          </button>
        </div>
      </div>
    );
    return this.props.page ? (
      <div className="py-10">{box}</div>
    ) : (
      <div className="min-h-screen grid place-items-center bg-canvas p-4">{box}</div>
    );
  }
}

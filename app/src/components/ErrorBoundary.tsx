import React from 'react';
import { useT } from '../lib/i18n';
import { ErrorView } from './ui';

/** Shows a recoverable error screen instead of a blank app if a screen crashes. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <Crashed onRetry={() => this.setState({ failed: false })} />;
    }
    return this.props.children;
  }
}

function Crashed({ onRetry }: { onRetry: () => void }) {
  return <ErrorView message={useT()('crashed')} onRetry={onRetry} />;
}

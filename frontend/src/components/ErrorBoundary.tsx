import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Names the surface in the console. */
  surface: string;
  fallback: (reset: () => void) => ReactNode;
  onError?: (error: unknown) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/** Keeps a crash in one surface (catalogue, try-on view, overlay) from blanking the page. */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`${this.props.surface} failed`, error, info.componentStack);
    this.props.onError?.(error);
  }

  reset = () => {
    this.setState({ failed: false });
  };

  override render() {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}

export default ErrorBoundary;

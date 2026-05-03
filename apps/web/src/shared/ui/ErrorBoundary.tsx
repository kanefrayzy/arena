import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface State {
  err: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  override componentDidCatch(err: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', err, info.componentStack);
  }

  reset = (): void => {
    this.setState({ err: null });
  };

  override render(): ReactNode {
    const { err } = this.state;
    if (!err) return this.props.children;
    if (this.props.fallback) return this.props.fallback(err, this.reset);
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg p-6">
        <div className="w-full max-w-sm rounded-2xl border border-rose-400/30 bg-surface p-5 text-center">
          <div className="mb-2 text-2xl">⚠️</div>
          <div className="text-base font-semibold">Что-то пошло не так</div>
          <p className="mt-1 text-xs text-white/60 break-words">{err.message || 'Неизвестная ошибка'}</p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => location.reload()}
              className="flex-1 rounded-md bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
            >
              Перезагрузить
            </button>
            <button
              type="button"
              onClick={this.reset}
              className="flex-1 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg hover:brightness-110"
            >
              Повторить
            </button>
          </div>
        </div>
      </div>
    );
  }
}

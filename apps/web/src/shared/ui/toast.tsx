import { create } from 'zustand';
import { useEffect } from 'react';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  message?: string | undefined;
  durationMs: number;
  action?: { label: string; onClick: () => void } | undefined;
}

interface ToastStore {
  items: Toast[];
  push: (t: Omit<Toast, 'id' | 'durationMs'> & { durationMs?: number }) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let nextId = 1;

export const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (t) => {
    const id = nextId++;
    const item: Toast = {
      id,
      variant: t.variant,
      title: t.title,
      message: t.message,
      durationMs: t.durationMs ?? (t.variant === 'error' ? 6000 : 3500),
      action: t.action,
    };
    set((s) => ({ items: [...s.items, item] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clear: () => set({ items: [] }),
}));

export const toast = {
  info: (title: string, message?: string) => useToastStore.getState().push({ variant: 'info', title, message }),
  success: (title: string, message?: string) => useToastStore.getState().push({ variant: 'success', title, message }),
  warning: (title: string, message?: string) => useToastStore.getState().push({ variant: 'warning', title, message }),
  error: (title: string, message?: string) => useToastStore.getState().push({ variant: 'error', title, message }),
  push: (t: Parameters<ToastStore['push']>[0]) => useToastStore.getState().push(t),
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
};

const TONE: Record<ToastVariant, { ring: string; dot: string }> = {
  info: { ring: 'border-white/15', dot: 'bg-white/60' },
  success: { ring: 'border-emerald-400/30', dot: 'bg-emerald-400' },
  warning: { ring: 'border-amber-400/30', dot: 'bg-amber-400' },
  error: { ring: 'border-rose-400/40', dot: 'bg-rose-400' },
};

function ToastCard({ t }: { t: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    if (t.durationMs <= 0) return;
    const id = window.setTimeout(() => dismiss(t.id), t.durationMs);
    return () => window.clearTimeout(id);
  }, [t.id, t.durationMs, dismiss]);

  const tone = TONE[t.variant];
  return (
    <div
      className={`pointer-events-auto flex w-full max-w-sm gap-3 rounded-xl border ${tone.ring} bg-surface/95 p-3 shadow-xl backdrop-blur`}
      role={t.variant === 'error' ? 'alert' : 'status'}
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{t.title}</div>
        {t.message && <div className="mt-0.5 text-xs text-white/60">{t.message}</div>}
        {t.action && (
          <button
            type="button"
            onClick={() => {
              t.action?.onClick();
              dismiss(t.id);
            }}
            className="mt-2 text-xs font-semibold text-accent hover:underline"
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(t.id)}
        className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
        aria-label="dismiss"
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function ToastViewport() {
  const items = useToastStore((s) => s.items);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center gap-2 p-3 sm:items-end sm:p-4">
      {items.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </div>
  );
}

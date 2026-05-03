import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-white/10 text-white/70',
  success: 'bg-green-500/15 text-green-300',
  warning: 'bg-yellow-500/15 text-yellow-300',
  danger: 'bg-red-500/15 text-red-300',
  info: 'bg-accent/15 text-accent',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  switch (status) {
    case 'RUNNING':
    case 'APPROVED':
    case 'COMPLETED':
    case 'FINISHED':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'DISPUTED':
    case 'REJECTED':
    case 'CANCELLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

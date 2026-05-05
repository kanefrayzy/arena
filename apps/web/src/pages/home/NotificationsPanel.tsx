import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api/client';

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

const TYPE_ICON: Record<string, string> = {
  deposit: '💰',
  withdrawal: '📤',
  match_win: '🏆',
  match_loss: '💀',
  system: '📢',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m}м назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}ч назад`;
  return `${Math.floor(h / 24)}д назад`;
}

interface Props {
  onClose: () => void;
  onUnreadChange: (count: number) => void;
}

export function NotificationsPanel({ onClose, onUnreadChange }: Props) {
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragCurY = useRef(0);
  const isDragging = useRef(false);
  const openedAt = useRef(Date.now());

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.get<{ items: Notif[]; unreadCount: number }>('/notifications?limit=50');
        setItems(r.items);
        onUnreadChange(r.unreadCount);
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markAllRead = async () => {
    await api.patch('/notifications/read-all', {});
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    onUnreadChange(0);
  };

  const markRead = async (id: string) => {
    const item = items.find((n) => n.id === id);
    if (!item || item.read) return;
    await api.patch(`/notifications/${id}/read`, {});
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    onUnreadChange(Math.max(0, items.filter((n) => !n.read).length - 1));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    dragCurY.current = 0;
    isDragging.current = true;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    dragCurY.current = e.clientY - dragStartY.current;
    if (sheetRef.current) {
      const dy = Math.max(0, dragCurY.current);
      sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
  };
  const onPointerUp = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (sheetRef.current) sheetRef.current.style.transition = '';
    // Ignore close if panel was just opened (prevents accidental swipe-close from open gesture)
    if (dragCurY.current > 80 && Date.now() - openedAt.current > 350) {
      onClose();
      return;
    }
    if (sheetRef.current) sheetRef.current.style.transform = '';
    dragCurY.current = 0;
  };
  const onPointerCancel = () => {
    isDragging.current = false;
    dragCurY.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = '';
      sheetRef.current.style.transform = '';
    }
  };

  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex justify-center">
      <div
        ref={sheetRef}
        className="pointer-events-auto absolute bottom-0 w-full max-w-md rounded-t-3xl border-2 border-b-0 border-game-yellow/40 bg-bg/95 shadow-[0_-8px_32px_rgba(0,0,0,0.6)] backdrop-blur-md"
        style={{ transition: 'transform 0.3s cubic-bezier(0.32,0.72,0,1)' }}
      >
        {/* Drag handle */}
        <div
          className="flex select-none cursor-grab active:cursor-grabbing items-center gap-2 px-4 py-3"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <div className="mx-auto flex flex-col items-center gap-1">
            <div className="h-1.5 w-12 rounded-full bg-white/30" />
          </div>
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-2">
          <div className="flex items-center gap-2">
            <span className="font-display text-base text-game-yellow">Уведомления</span>
            {unreadCount > 0 && (
              <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{unreadCount}</span>
            )}
          </div>
          <div className="flex gap-1">
            {unreadCount > 0 && (
              <button onClick={() => void markAllRead()} className="game-btn game-btn-ghost game-btn-sm text-[11px]">
                Все прочитаны
              </button>
            )}
            <button onClick={onClose} className="game-btn game-btn-ghost game-btn-sm" title="close">✕</button>
          </div>
        </div>
        {/* List */}
        <div className="overflow-y-auto px-4 pb-8" style={{ maxHeight: '70vh' }}>
          {loading && (
            <div className="py-8 text-center text-sm text-white/50">Загрузка…</div>
          )}
          {!loading && items.length === 0 && (
            <div className="py-10 text-center text-sm text-white/40">Уведомлений пока нет</div>
          )}
          <div className="flex flex-col gap-2 pt-1">
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => void markRead(n.id)}
                className={
                  'w-full rounded-xl px-4 py-3 text-left transition-colors ' +
                  (n.read ? 'bg-white/5 hover:bg-white/10' : 'bg-game-yellow/10 hover:bg-game-yellow/15 ring-1 ring-game-yellow/20')
                }
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-xl">{TYPE_ICON[n.type] ?? '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-white">{n.title}</span>
                      <span className="shrink-0 text-[10px] text-white/40">{timeAgo(n.createdAt)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-white/60 leading-relaxed">{n.body}</div>
                  </div>
                  {!n.read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-game-yellow" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

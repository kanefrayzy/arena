import { useEffect, useRef, useState } from 'react';
import { api } from '../../../shared/api/client';

interface SlotMeta {
  label: string;
  w: number;
  h: number;
  hint: string;
}

interface SpriteRow {
  url: string;
  width: number;
  height: number;
  mime: string;
  updatedAt: string;
}

interface ListResponse {
  slots: Record<string, SlotMeta>;
  sprites: Record<string, SpriteRow>;
}

export function SpritesTab() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const d = await api.get<ListResponse>('/admin/sprites');
      setData(d);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const upload = async (slot: string, file: File) => {
    setBusy(slot);
    setError(null);
    try {
      // Probe natural dimensions for the form metadata.
      const dims = await readImageDims(file);
      const fd = new FormData();
      fd.append('file', file);
      if (dims) {
        fd.append('width', String(dims.w));
        fd.append('height', String(dims.h));
      }
      const res = await fetch(`/api/admin/sprites/${encodeURIComponent(slot)}`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (slot: string) => {
    if (!confirm(`Удалить спрайт «${slot}»?`)) return;
    setBusy(slot);
    setError(null);
    try {
      await api.delete(`/admin/sprites/${encodeURIComponent(slot)}`);
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <div className="text-white/50">Загрузка…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-surface/40 p-4 text-sm text-white/70">
        <div className="mb-2 font-medium text-white">Спрайты</div>
        <p className="leading-relaxed">
          Загрузите PNG / JPG / WebP / SVG (до 1 МБ) для каждого слота. Если слот пустой — игра рендерит
          процедурный fallback. Все спрайты используются Pixi-рендером в матче. Картинки показывают
          превью в реальном размере на тёмном фоне (какой будет в игре).
        </p>
        <ul className="mt-2 list-disc pl-5 text-xs text-white/50">
          <li>Top-down (вид сверху). Игрок и оружие — лицом ВПРАВО (повернёт код).</li>
          <li>Прозрачный фон у всего, кроме «Фон (плитка)» — она бесшовная.</li>
          <li>Изменения применяются сразу при следующем матче.</li>
        </ul>
      </div>
      {error && <div className="rounded bg-rose-500/20 px-3 py-2 text-sm text-rose-200">{error}</div>}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {Object.entries(data.slots).map(([slot, meta]) => {
          const cur = data.sprites[slot];
          return (
            <SlotCard
              key={slot}
              slot={slot}
              meta={meta}
              current={cur}
              busy={busy === slot}
              onUpload={(f) => upload(slot, f)}
              onRemove={() => remove(slot)}
            />
          );
        })}
      </div>
    </div>
  );
}

interface SlotCardProps {
  slot: string;
  meta: SlotMeta;
  current?: SpriteRow | undefined;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}

function SlotCard({ slot, meta, current, busy, onUpload, onRemove }: SlotCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="rounded-lg border border-white/10 bg-bg p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{meta.label}</div>
          <div className="text-[11px] text-white/40">slot: {slot}</div>
        </div>
        <div className="text-right text-[11px] text-white/50">
          реком. {meta.w}×{meta.h}
        </div>
      </div>
      <div
        className="mt-2 grid place-items-center rounded-md border border-white/10 bg-[#0e1117]"
        style={{ height: 140 }}
      >
        {current ? (
          <img
            src={current.url}
            alt={slot}
            className="max-h-32 max-w-full object-contain"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : (
          <span className="text-xs text-white/30">— пусто (fallback) —</span>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-white/40">{meta.hint}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex-1 rounded bg-accent/80 px-3 py-1.5 text-xs font-medium text-bg hover:bg-accent disabled:opacity-50"
        >
          {busy ? '…' : current ? 'Заменить' : 'Загрузить'}
        </button>
        {current && (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="rounded bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-rose-500/20 hover:text-rose-300"
          >
            Удалить
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function readImageDims(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

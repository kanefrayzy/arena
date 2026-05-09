import { useEffect, useRef, useState } from 'react';

interface SlotMeta {
  label: string;
  w: number;
  h: number;
  hint: string;
}

interface BrandingResponse {
  slots: Record<string, SlotMeta>;
  branding: Record<string, string | null>;
}

export function BrandingTab() {
  const [data, setData] = useState<BrandingResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const reload = async () => {
    try {
      const res = await fetch('/api/admin/branding', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as BrandingResponse);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => { void reload(); }, []);

  const upload = async (slot: string, file: File) => {
    setBusy(slot);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/admin/branding/${encodeURIComponent(slot)}`, {
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

  const copyUrl = (url: string) => {
    void navigator.clipboard.writeText(window.location.origin + url.split('?')[0]!);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  };

  if (!data) return <div className="text-white/50">Загрузка…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-surface/40 p-4 text-sm text-white/70">
        <div className="mb-2 font-medium text-white">Брендинг</div>
        <p className="leading-relaxed">
          Загрузите логотип, фавикон и иконки приложения. Файлы сохраняются по адресу{' '}
          <code className="rounded bg-white/10 px-1 py-0.5 text-xs">/uploads/branding/</code> и применяются
          автоматически при следующей загрузке страницы.
        </p>
        <ul className="mt-2 list-disc pl-5 text-xs text-white/50">
          <li>Favicon — PNG 32×32 или ICO. Отображается на вкладке браузера.</li>
          <li>Логотип — PNG/SVG с прозрачным фоном на тёмном фоне.</li>
          <li>PWA-иконки — квадратные PNG без прозрачности (для Android / iOS).</li>
        </ul>
      </div>

      {error && <div className="rounded bg-rose-500/20 px-3 py-2 text-sm text-rose-200">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(data.slots).map(([slot, meta]) => {
          const url = data.branding[slot] ?? null;
          return (
            <BrandingCard
              key={slot}
              slot={slot}
              meta={meta}
              url={url}
              busy={busy === slot}
              copied={copied === url}
              onUpload={(f) => { void upload(slot, f); }}
              {...(url !== null ? { onCopy: () => copyUrl(url) } : {})}
            />
          );
        })}
      </div>
    </div>
  );
}

function BrandingCard({
  slot,
  meta,
  url,
  busy,
  copied,
  onUpload,
  onCopy,
}: {
  slot: string;
  meta: SlotMeta;
  url: string | null;
  busy: boolean;
  copied: boolean;
  onUpload: (f: File) => void;
  onCopy?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="rounded-lg border border-white/10 bg-bg p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{meta.label}</div>
          <div className="text-[11px] text-white/40">slot: {slot}</div>
        </div>
        <div className="text-right text-[11px] text-white/50">
          {meta.w}×{meta.h}
        </div>
      </div>

      {/* Preview */}
      <div
        className="mt-2 grid place-items-center rounded-md border border-white/10 bg-[#0e1117]"
        style={{ height: 120 }}
      >
        {url ? (
          <img
            src={url}
            alt={meta.label}
            className="max-h-[110px] max-w-full object-contain"
            style={{ imageRendering: slot === 'favicon' ? 'pixelated' : undefined }}
          />
        ) : (
          <span className="text-[11px] text-white/30">нет изображения</span>
        )}
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">{meta.hint}</p>

      {/* URL copy */}
      {url && (
        <button
          type="button"
          onClick={onCopy}
          className="mt-2 w-full truncate rounded border border-white/10 bg-white/5 px-2 py-1 text-left text-[10px] text-white/50 hover:bg-white/10"
        >
          {copied ? '✓ скопировано' : url.split('?')[0]}
        </button>
      )}

      {/* Upload */}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={
          'mt-2 w-full rounded-md py-1.5 text-xs font-medium transition ' +
          (busy
            ? 'cursor-not-allowed bg-white/5 text-white/30'
            : 'bg-accent/15 text-accent hover:bg-accent/25')
        }
      >
        {busy ? 'Загрузка…' : url ? 'Заменить' : 'Загрузить'}
      </button>
    </div>
  );
}

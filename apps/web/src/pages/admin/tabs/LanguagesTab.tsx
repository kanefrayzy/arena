import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../shared/api/client';

interface LangRow {
  code: string;
  name: string;
  flag?: string;
  keys: number;
  bytes: number;
}

export function LanguagesTab() {
  const [items, setItems] = useState<LangRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add form
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [flag, setFlag] = useState('');
  const [busy, setBusy] = useState(false);

  // Edit panel
  const [editCode, setEditCode] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ items: LangRow[] }>('/admin/i18n/languages');
      setItems(r.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/i18n/languages', { code: code.trim().toLowerCase(), name: name.trim(), flag: flag.trim() || undefined });
      setCode(''); setName(''); setFlag('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = async (lang: string) => {
    setEditCode(lang);
    setEditText('Loading…');
    try {
      const r = await api.get<{ resources: Record<string, string> }>(`/admin/i18n/languages/${lang}`);
      setEditText(JSON.stringify(r.resources, null, 2));
    } catch (e) {
      setEditText('');
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  const saveEdit = async () => {
    if (!editCode) return;
    setEditBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(editText);
      await api.put(`/admin/i18n/languages/${editCode}`, { resources: parsed });
      await load();
      setEditCode(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setEditBusy(false);
    }
  };

  const remove = async (lang: string) => {
    if (!confirm(`Удалить язык ${lang}?`)) return;
    try {
      await api.delete(`/admin/i18n/languages/${lang}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Языки интерфейса</h2>
        <p className="mt-1 text-xs text-white/50">
          Бандл-языки <code className="rounded bg-black/40 px-1">ru</code>, <code className="rounded bg-black/40 px-1">en</code> поставляются с клиентом и
          здесь не редактируются. Добавление нового языка автоматически создаёт JSON со всеми ключами английской локализации
          (значения копируются как заглушки — переведите их позже).
        </p>
      </div>

      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}

      <form onSubmit={add} className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-surface p-4 sm:grid-cols-[120px_1fr_120px_auto]">
        <input className="game-input" placeholder="код (fr, pt-br)" value={code} onChange={(e) => setCode(e.target.value)} required />
        <input className="game-input" placeholder="название (Français)" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="game-input" placeholder="флаг (🇫🇷)" value={flag} onChange={(e) => setFlag(e.target.value)} />
        <button type="submit" className="game-btn game-btn-yellow" disabled={busy || !code || !name}>
          {busy ? '…' : 'Добавить'}
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase text-white/60">
            <tr>
              <th className="px-3 py-2">Код</th>
              <th className="px-3 py-2">Название</th>
              <th className="px-3 py-2">Ключей</th>
              <th className="px-3 py-2">Размер</th>
              <th className="px-3 py-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-3 py-4 text-center text-white/50">Загрузка…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-white/50">Пока нет добавленных языков</td></tr>}
            {items.map((it) => (
              <tr key={it.code} className="border-t border-white/5">
                <td className="px-3 py-2 font-mono">{it.code}</td>
                <td className="px-3 py-2">{it.flag ? `${it.flag} ` : ''}{it.name}</td>
                <td className="px-3 py-2 text-white/70">{it.keys}</td>
                <td className="px-3 py-2 text-white/70">{(it.bytes / 1024).toFixed(1)} KB</td>
                <td className="px-3 py-2 text-right">
                  <button className="game-btn game-btn-sm game-btn-ghost mr-2" onClick={() => void startEdit(it.code)}>Перевод</button>
                  <button className="game-btn game-btn-sm game-btn-ghost" onClick={() => void remove(it.code)}>Удалить</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !editBusy && setEditCode(null)}>
          <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-lg bg-surface p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Перевод: {editCode}</h3>
              <button className="game-btn game-btn-sm game-btn-ghost" onClick={() => setEditCode(null)} disabled={editBusy}>×</button>
            </div>
            <textarea
              className="flex-1 rounded-md border border-white/10 bg-black/30 p-3 font-mono text-xs text-white"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              spellCheck={false}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button className="game-btn game-btn-ghost" onClick={() => setEditCode(null)} disabled={editBusy}>Отмена</button>
              <button className="game-btn game-btn-yellow" onClick={() => void saveEdit()} disabled={editBusy}>
                {editBusy ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

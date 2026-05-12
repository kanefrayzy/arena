import { useEffect, useRef, useState } from 'react';
import { decode } from '@msgpack/msgpack';
import { api } from '../../../shared/api/client';
import { Modal, PrimaryButton, GhostButton, Field, inputCls } from '../components/Modal';
import { Badge, statusTone } from '../components/Badge';

interface Match {
  id: string;
  roomId: number;
  player1Id: number;
  player2Id: number;
  winnerId: number | null;
  status: string;
  stakeUsd: string;
  startedAt: string | null;
  finishedAt: string | null;
  replayUrl: string | null;
}

const STATUSES = ['', 'PENDING', 'RUNNING', 'FINISHED', 'DISPUTED', 'CANCELLED'];

export function MatchesTab() {
  const [items, setItems] = useState<Match[]>([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [forceFinishOf, setForceFinishOf] = useState<Match | null>(null);
  const [refundOf, setRefundOf] = useState<Match | null>(null);
  const [replayOf, setReplayOf] = useState<Match | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const r = await api.get<{ items: Match[] }>(`/admin/matches${status ? `?status=${status}` : ''}`);
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  async function doClearHistory() {
    setClearing(true);
    setErr(null);
    setClearResult(null);
    try {
      const r = await api.delete<{ deletedMatches: number; deletedReplays: number; deletedReports: number }>('/admin/matches/history');
      setClearResult(`Удалено: ${r.deletedMatches} матчей, ${r.deletedReplays} реплеев, ${r.deletedReports} жалоб`);
      setConfirmClear(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'clear failed');
    } finally {
      setClearing(false);
    }
  }

  useEffect(() => {
    void load();
  }, [status]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={
              'rounded-md px-3 py-1.5 text-xs font-medium transition ' +
              (status === s ? 'bg-accent text-bg' : 'bg-white/5 text-white/70 hover:bg-white/10')
            }
          >
            {s || 'All'}
          </button>
        ))}
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="rounded-md bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/25"
          >
            Очистить историю
          </button>
        </div>
      </div>
      {clearResult && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{clearResult}</div>
      )}
      {err && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-wider text-white/50">
            <tr>
              <th className="px-3 py-2.5">Match</th>
              <th className="px-3 py-2.5">Players</th>
              <th className="px-3 py-2.5 text-right">Stake</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Winner</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((m) => (
              <tr key={m.id} className="hover:bg-white/[0.02]">
                <td className="px-3 py-2.5 font-mono text-xs text-white/60">{m.id.slice(0, 8)}…</td>
                <td className="px-3 py-2.5 text-xs">
                  <span className="font-medium">#{m.player1Id}</span>
                  <span className="mx-1.5 text-white/40">vs</span>
                  <span className="font-medium">#{m.player2Id}</span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">${m.stakeUsd}</td>
                <td className="px-3 py-2.5">
                  <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {m.winnerId != null ? <span>#{m.winnerId}</span> : <span className="text-white/30">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    {m.replayUrl && (
                      <button
                        type="button"
                        onClick={() => setReplayOf(m)}
                        className="rounded-md bg-accent/15 px-2.5 py-1 text-xs text-accent hover:bg-accent/25"
                      >
                        ▶ повтор
                      </button>
                    )}
                    {(m.status === 'RUNNING' || m.status === 'DISPUTED' || m.status === 'PENDING') && (
                      <>
                        <button
                          type="button"
                          disabled={busy === m.id}
                          onClick={() => setForceFinishOf(m)}
                          className="rounded-md bg-white/5 px-2.5 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
                        >
                          force-finish
                        </button>
                        <button
                          type="button"
                          disabled={busy === m.id}
                          onClick={() => setRefundOf(m)}
                          className="rounded-md bg-yellow-500/15 px-2.5 py-1 text-xs text-yellow-300 hover:bg-yellow-500/25 disabled:opacity-40"
                        >
                          refund
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-white/40">No matches</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {replayOf && (
        <ReplayModal match={replayOf} onClose={() => setReplayOf(null)} />
      )}

      <ForceFinishModal
        match={forceFinishOf}
        onClose={() => setForceFinishOf(null)}
        onDone={async () => {
          setForceFinishOf(null);
          await load();
        }}
        setBusy={setBusy}
        setErr={setErr}
      />
      <RefundModal
        match={refundOf}
        onClose={() => setRefundOf(null)}
        onDone={async () => {
          setRefundOf(null);
          await load();
        }}
        setBusy={setBusy}
        setErr={setErr}
      />

      <Modal open={confirmClear} onClose={() => !clearing && setConfirmClear(false)} title="Очистить историю матчей?">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-white/70">
            Будут безвозвратно удалены все матчи со статусом <b>FINISHED</b> и <b>CANCELLED</b>, связанные с ними реплеи на диске и жалобы игроков.
            Активные матчи (PENDING / RUNNING / DISPUTED) затронуты не будут. Записи в журнале баланса (ledger) сохранятся как аудит-след.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <GhostButton onClick={() => setConfirmClear(false)} disabled={clearing}>Отмена</GhostButton>
            <button
              type="button"
              onClick={doClearHistory}
              disabled={clearing}
              className="rounded-md bg-red-500/80 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
            >
              {clearing ? 'Удаление…' : 'Удалить'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ForceFinishModal({
  match,
  onClose,
  onDone,
  setBusy,
  setErr,
}: {
  match: Match | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
}) {
  const [winnerId, setWinnerId] = useState<number | null>(null);
  const [reason, setReason] = useState('admin force-finish');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (match) {
      setWinnerId(match.player1Id);
      setReason('admin force-finish');
    }
  }, [match]);

  async function submit() {
    if (!match) return;
    setSubmitting(true);
    setBusy(match.id);
    try {
      await api.post(`/admin/matches/${match.id}/force-finish`, { winnerId, reason });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
      setBusy(null);
    }
  }

  if (!match) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Force-finish match"
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? '…' : 'Confirm'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="Winner">
        <div className="flex flex-col gap-2">
          {[match.player1Id, match.player2Id].map((id) => (
            <label key={id} className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-bg px-3 py-2 hover:border-white/20">
              <input
                type="radio"
                name="winner"
                checked={winnerId === id}
                onChange={() => setWinnerId(id)}
                className="accent-accent"
              />
              <span className="text-sm">Player #{id}</span>
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-bg px-3 py-2 hover:border-white/20">
            <input
              type="radio"
              name="winner"
              checked={winnerId === null}
              onChange={() => setWinnerId(null)}
              className="accent-accent"
            />
            <span className="text-sm">No winner (refund both)</span>
          </label>
        </div>
      </Field>
      <Field label="Reason">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

function RefundModal({
  match,
  onClose,
  onDone,
  setBusy,
  setErr,
}: {
  match: Match | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
}) {
  const [reason, setReason] = useState('admin refund');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (match) setReason('admin refund');
  }, [match]);

  async function submit() {
    if (!match) return;
    setSubmitting(true);
    setBusy(match.id);
    try {
      await api.post(`/admin/matches/${match.id}/refund`, { reason });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
      setBusy(null);
    }
  }

  if (!match) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Refund match"
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? '…' : 'Refund both'}
          </PrimaryButton>
        </>
      }
    >
      <p className="mb-3 text-sm text-white/70">
        Both players will receive their ${match.stakeUsd} stake back.
      </p>
      <Field label="Reason">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

// ─── Replay types ─────────────────────────────────────────────────────────────

interface ReplayMeta {
  matchId: string;
  mapW: number;
  mapH: number;
  tickRate: number;
  durationMs: number;
  obstacles: { x: number; y: number; w: number; h: number; kind?: string }[];
  players: { id: number; username: string; characterId?: number; skinId?: number }[];
}

interface ReplaySnapshot {
  t: number;
  players: { id: number; x: number; y: number; angle: number; hp: number; maxHp: number }[];
  bullets: { x: number; y: number }[];
}

interface ReplayData {
  meta: ReplayMeta;
  snapshots: ReplaySnapshot[];
  /** characterId → battle sprite URL */
  spriteUrls: Record<number, string>;
}

async function loadReplayData(matchId: string): Promise<ReplayData> {
  const [res, charsRes] = await Promise.all([
    fetch(`/api/admin/matches/${matchId}/replay`, { credentials: 'include' }),
    fetch('/api/content/characters', { credentials: 'include' }),
  ]);
  if (!res.ok) {
    const j = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
  }
  // Build characterId → spriteUrl map
  const spriteUrls: Record<number, string> = {};
  if (charsRes.ok) {
    const chars = await charsRes.json().catch(() => []) as { id: number; battleSpriteUrl?: string | null }[];
    for (const c of chars) {
      if (c.battleSpriteUrl) spriteUrls[c.id] = c.battleSpriteUrl;
    }
  }
  const ds = new DecompressionStream('gzip');
  const reader = res.body!.pipeThrough(ds).getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const buf = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }

  let meta: ReplayMeta | null = null;
  const snapshots: ReplaySnapshot[] = [];
  let pos = 0;
  const dv = new DataView(buf.buffer);
  while (pos + 4 <= buf.length) {
    const len = dv.getUint32(pos, false);
    pos += 4;
    if (len === 0 || pos + len > buf.length) break;
    const [kind, t, payload] = decode(buf.slice(pos, pos + len)) as [string, number, unknown];
    pos += len;
    if (kind === 'meta') { meta = payload as ReplayMeta; }
    else if (kind === 'snapshot') {
      const s = payload as { players?: unknown[]; bullets?: unknown[] };
      snapshots.push({
        t,
        players: (s.players ?? []).map((p) => {
          const ps = p as Record<string, unknown>;
          return { id: ps.id as number, x: ps.x as number, y: ps.y as number,
            angle: ps.angle as number, hp: ps.hp as number, maxHp: (ps.maxHp as number) || 100 };
        }),
        bullets: (s.bullets ?? []).map((b) => {
          const bs = b as Record<string, unknown>;
          return { x: bs.x as number, y: bs.y as number };
        }),
      });
    }
  }
  if (!meta) throw new Error('replay meta missing');
  return { meta, snapshots, spriteUrls };
}

const OBS_COLOR: Record<string, string> = { crate: '#8b6914', barrel: '#4a7a8a', wall: '#555e6b' };

function drawFrame(
  canvas: HTMLCanvasElement,
  data: ReplayData,
  frameIdx: number,
  imgCache: Record<number, HTMLImageElement>,
) {
  const { meta, snapshots } = data;
  const snap = snapshots[frameIdx];
  if (!snap) return;
  const W = canvas.width; const H = canvas.height;
  const scale = Math.min(W / meta.mapW, H / meta.mapH);
  const ox = (W - meta.mapW * scale) / 2; const oy = (H - meta.mapH * scale) / 2;
  const wx = (x: number) => ox + x * scale;
  const wy = (y: number) => oy + y * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1a1f2e'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#242937'; ctx.fillRect(ox, oy, meta.mapW * scale, meta.mapH * scale);
  for (const obs of meta.obstacles ?? []) {
    ctx.fillStyle = OBS_COLOR[obs.kind ?? 'wall'] ?? '#555e6b';
    ctx.fillRect(wx(obs.x), wy(obs.y), obs.w * scale, obs.h * scale);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 0.5;
    ctx.strokeRect(wx(obs.x), wy(obs.y), obs.w * scale, obs.h * scale);
  }
  ctx.fillStyle = '#ffe066';
  for (const b of snap.bullets) {
    ctx.beginPath(); ctx.arc(wx(b.x), wy(b.y), Math.max(2, 3 * scale), 0, Math.PI * 2); ctx.fill();
  }
  const p1id = meta.players[0]?.id;
  for (const p of snap.players) {
    const r = Math.max(6, 22 * scale);
    const isP1 = p.id === p1id;
    const color = isP1 ? '#4a9eff' : '#ff4a4a';
    // Look up characterId for this player from meta
    const charId = meta.players.find((pl) => pl.id === p.id)?.characterId;
    const img = charId !== undefined ? imgCache[charId] : undefined;
    // Shadow
    ctx.beginPath(); ctx.arc(wx(p.x), wy(p.y), r + 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
    if (img?.complete && img.naturalWidth > 0) {
      // Draw sprite rotated toward facing direction
      const d = r * 2;
      ctx.save();
      ctx.translate(wx(p.x), wy(p.y));
      ctx.rotate(p.angle + Math.PI / 2);
      // Tint ring
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, 2.5 * scale); ctx.stroke();
      // Clip to circle
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(img, -d / 2, -d / 2, d, d);
      ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(wx(p.x), wy(p.y), r, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.beginPath(); ctx.moveTo(wx(p.x), wy(p.y));
      ctx.lineTo(wx(p.x) + Math.cos(p.angle) * r * 1.4, wy(p.y) + Math.sin(p.angle) * r * 1.4);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(1, 2 * scale); ctx.stroke();
    }
    const bW = r * 2.4; const bH = Math.max(3, 4 * scale);
    const bx = wx(p.x) - bW / 2; const by = wy(p.y) - r - bH - 3 * scale;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, by, bW, bH);
    const ratio = Math.max(0, Math.min(1, p.hp / p.maxHp));
    ctx.fillStyle = ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#ffb300' : '#f44336';
    ctx.fillRect(bx, by, bW * ratio, bH);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${Math.max(9, 11 * scale)}px sans-serif`;
    ctx.textAlign = 'center';
    const name = meta.players.find((pl) => pl.id === p.id)?.username ?? `#${p.id}`;
    ctx.fillText(name, wx(p.x), by - 2 * scale);
  }
}

function ReplayModal({ match, onClose }: { match: Match; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReplayData | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const imgCacheRef = useRef<Record<number, HTMLImageElement>>({});

  useEffect(() => {
    loadReplayData(match.id)
      .then((d) => {
        setData(d);
        setFrame(0);
        // Preload character sprites
        for (const [charIdStr, url] of Object.entries(d.spriteUrls)) {
          const img = new Image();
          img.src = url;
          imgCacheRef.current[Number(charIdStr)] = img;
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'ошибка загрузки'))
      .finally(() => setLoading(false));
    return () => cancelAnimationFrame(rafRef.current);
  }, [match.id]);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    drawFrame(canvasRef.current, data, frame, imgCacheRef.current);
  }, [data, frame]);

  useEffect(() => {
    if (!playing || !data) return;
    const tickMs = 1000 / data.meta.tickRate;
    const step = (now: number) => {
      if (now - lastTickRef.current >= tickMs / speed) {
        lastTickRef.current = now;
        setFrame((f) => {
          if (f + 1 >= data.snapshots.length) { setPlaying(false); return f; }
          return f + 1;
        });
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed, data]);

  const total = data?.snapshots.length ?? 0;
  const elapsed = data && total > 1
    ? ((frame / (total - 1)) * (data.meta.durationMs / 1000)).toFixed(1)
    : '0.0';
  const duration = data ? (data.meta.durationMs / 1000).toFixed(0) : '0';
  const canvasH = data ? Math.round(300 * data.meta.mapH / data.meta.mapW) : 400;

  const close = () => { cancelAnimationFrame(rafRef.current); onClose(); };

  return (
    <Modal open onClose={close} title={`▶ Повтор ${match.id.slice(0, 8)}…`}
      footer={<GhostButton onClick={close}>Закрыть</GhostButton>}
    >
      <div className="flex flex-col gap-3">
        {loading && (
          <div className="flex h-48 items-center justify-center gap-3 text-sm text-white/50">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Загрузка повтора…
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
        )}
        {data && (
          <>
            <div className="flex justify-center">
              <canvas ref={canvasRef} width={300} height={canvasH}
                className="rounded-md" style={{ width: '100%', maxHeight: 480, height: 'auto' }} />
            </div>
            <input type="range" min={0} max={Math.max(0, total - 1)} value={frame}
              onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }}
              className="w-full accent-accent" />
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { setFrame(0); setPlaying(false); }}
                className="rounded bg-white/5 px-2 py-1 text-xs hover:bg-white/10">⏮</button>
              <button type="button" onClick={() => setPlaying((p) => !p)}
                className="rounded bg-accent px-3 py-1 text-sm font-semibold text-bg">{playing ? '⏸' : '▶'}</button>
              <button type="button" onClick={() => { setFrame(total - 1); setPlaying(false); }}
                className="rounded bg-white/5 px-2 py-1 text-xs hover:bg-white/10">⏭</button>
              <div className="ml-auto flex items-center gap-1 text-xs">
                <span className="text-white/50">Скорость:</span>
                {[0.5, 1, 2, 4].map((s) => (
                  <button key={s} type="button" onClick={() => setSpeed(s)}
                    className={'rounded px-2 py-0.5 ' + (speed === s ? 'bg-accent text-bg font-semibold' : 'bg-white/5 hover:bg-white/10')}>
                    {s}×
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-white/50">
              <span>{elapsed}s / {duration}s</span>
              <span>кадр {frame + 1}/{total}</span>
              {data.meta.players.map((p, i) => (
                <span key={p.id} style={{ color: i === 0 ? '#4a9eff' : '#ff4a4a' }}>{p.username}</span>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

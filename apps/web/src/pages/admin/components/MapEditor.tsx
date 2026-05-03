import { useRef, useState } from 'react';

export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: 'crate' | 'barrel' | 'wall';
}

const MAP_W = 720;
const MAP_H = 1280;
const CELL = 80; // grid cell size in world units (= 9×16 cells)
const COLS = MAP_W / CELL;
const ROWS = MAP_H / CELL;

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function obstaclesToCells(list: Obstacle[]): Map<string, Obstacle['kind']> {
  const m = new Map<string, Obstacle['kind']>();
  for (const o of list) {
    // Decompose any rectangle into CELL×CELL cells (simple approach).
    const x0 = Math.floor(o.x / CELL) * CELL;
    const y0 = Math.floor(o.y / CELL) * CELL;
    const x1 = Math.ceil((o.x + o.w) / CELL) * CELL;
    const y1 = Math.ceil((o.y + o.h) / CELL) * CELL;
    for (let y = y0; y < y1; y += CELL) {
      for (let x = x0; x < x1; x += CELL) {
        m.set(key(x, y), o.kind ?? 'crate');
      }
    }
  }
  return m;
}

function cellsToObstacles(m: Map<string, Obstacle['kind']>): Obstacle[] {
  const out: Obstacle[] = [];
  for (const [k, kind] of m) {
    const [xs, ys] = k.split(',');
    out.push({ x: Number(xs), y: Number(ys), w: CELL, h: CELL, kind: kind ?? 'crate' });
  }
  return out;
}

const KINDS: { id: NonNullable<Obstacle['kind']>; label: string; color: string }[] = [
  { id: 'crate', label: 'Ящик', color: '#a06b3a' },
  { id: 'barrel', label: 'Бочка', color: '#5a7adf' },
  { id: 'wall', label: 'Стена', color: '#6b7280' },
];

interface Props {
  value: Obstacle[];
  onChange: (next: Obstacle[]) => void;
}

export function MapEditor({ value, onChange }: Props) {
  const [tool, setTool] = useState<'paint' | 'erase'>('paint');
  const [kind, setKind] = useState<NonNullable<Obstacle['kind']>>('crate');
  const cells = obstaclesToCells(value);
  const dragging = useRef<{ mode: 'add' | 'remove' } | null>(null);

  // SVG coords are world coords (720×1280). We render at responsive width via viewBox.
  const apply = (x: number, y: number, mode: 'add' | 'remove') => {
    const next = new Map(cells);
    if (mode === 'add') next.set(key(x, y), kind);
    else next.delete(key(x, y));
    onChange(cellsToObstacles(next));
  };

  const handleCellEvent = (x: number, y: number, e: React.PointerEvent) => {
    e.preventDefault();
    if (e.type === 'pointerdown') {
      const filled = cells.has(key(x, y));
      const mode: 'add' | 'remove' =
        tool === 'erase' || (e.button === 2 || filled) ? 'remove' : 'add';
      dragging.current = { mode };
      apply(x, y, mode);
    } else if (e.type === 'pointerenter' && dragging.current) {
      apply(x, y, dragging.current.mode);
    }
  };

  // Spawn markers (informational, not editable here)
  const spawn1 = { x: MAP_W / 2, y: MAP_H - 140 };
  const spawn2 = { x: MAP_W / 2, y: 140 };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTool('paint')}
            className={`rounded px-2 py-1 text-xs ${tool === 'paint' ? 'bg-accent text-bg' : 'bg-white/5 text-white/70'}`}
          >
            ✎ Рисовать
          </button>
          <button
            type="button"
            onClick={() => setTool('erase')}
            className={`rounded px-2 py-1 text-xs ${tool === 'erase' ? 'bg-rose-400 text-bg' : 'bg-white/5 text-white/70'}`}
          >
            ⌫ Стереть
          </button>
        </div>
        <div className="ml-2 flex gap-1">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => {
                setKind(k.id);
                setTool('paint');
              }}
              className={`rounded px-2 py-1 text-xs ${kind === k.id && tool === 'paint' ? 'ring-1 ring-accent' : ''} bg-white/5 text-white/80`}
            >
              <span
                className="mr-1 inline-block h-2.5 w-2.5 align-middle rounded-sm"
                style={{ background: k.color }}
              />
              {k.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2 text-xs text-white/50">
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded bg-white/5 px-2 py-1 hover:bg-white/10"
          >
            Очистить
          </button>
          <button
            type="button"
            onClick={() => onChange(presetCross())}
            className="rounded bg-white/5 px-2 py-1 hover:bg-white/10"
          >
            Пресет: крест
          </button>
          <button
            type="button"
            onClick={() => onChange(presetArena())}
            className="rounded bg-white/5 px-2 py-1 hover:bg-white/10"
          >
            Пресет: арена
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-bg p-2">
        <svg
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          className="mx-auto block h-[420px] w-auto select-none touch-none"
          onContextMenu={(e) => e.preventDefault()}
          onPointerUp={() => {
            dragging.current = null;
          }}
          onPointerLeave={() => {
            dragging.current = null;
          }}
        >
          {/* Background */}
          <rect x={0} y={0} width={MAP_W} height={MAP_H} fill="#161b22" />
          {/* Grid */}
          {Array.from({ length: COLS }).map((_, ci) =>
            Array.from({ length: ROWS }).map((__, ri) => {
              const x = ci * CELL;
              const y = ri * CELL;
              const k = cells.get(key(x, y));
              const color = k ? KINDS.find((kk) => kk.id === k)?.color ?? '#a06b3a' : 'transparent';
              return (
                <rect
                  key={`${ci}-${ri}`}
                  x={x + 2}
                  y={y + 2}
                  width={CELL - 4}
                  height={CELL - 4}
                  fill={color}
                  stroke={k ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.06)'}
                  strokeWidth={1}
                  rx={6}
                  onPointerDown={(e) => handleCellEvent(x, y, e)}
                  onPointerEnter={(e) => handleCellEvent(x, y, e)}
                />
              );
            }),
          )}
          {/* Spawn markers */}
          <circle cx={spawn1.x} cy={spawn1.y} r={28} fill="none" stroke="#4ad29a" strokeWidth={3} strokeDasharray="6 4" />
          <text x={spawn1.x} y={spawn1.y + 5} fontSize="20" fill="#4ad29a" textAnchor="middle">P1</text>
          <circle cx={spawn2.x} cy={spawn2.y} r={28} fill="none" stroke="#e06c75" strokeWidth={3} strokeDasharray="6 4" />
          <text x={spawn2.x} y={spawn2.y + 5} fontSize="20" fill="#e06c75" textAnchor="middle">P2</text>
          {/* Border */}
          <rect x={0} y={0} width={MAP_W} height={MAP_H} fill="none" stroke="#30363d" strokeWidth={4} />
        </svg>
      </div>
      <div className="flex items-center justify-between text-xs text-white/50">
        <span>{value.length} {value.length === 1 ? 'элемент' : 'элементов'}</span>
        <span className="text-white/30">9×16 ячеек, 80px каждая · правый клик стирает</span>
      </div>
    </div>
  );
}

// ───── Presets ─────
function presetCross(): Obstacle[] {
  const cells: [number, number][] = [
    // horizontal bar mid
    [3, 7], [4, 7], [5, 7],
    // vertical bar mid
    [4, 5], [4, 6], [4, 8], [4, 9],
  ];
  return cells.map(([cx, ry]) => ({
    x: cx * CELL,
    y: ry * CELL,
    w: CELL,
    h: CELL,
    kind: 'crate',
  }));
}

function presetArena(): Obstacle[] {
  const cells: [number, number, NonNullable<Obstacle['kind']>][] = [
    // four crates in corners of mid
    [2, 5, 'crate'], [6, 5, 'crate'], [2, 10, 'crate'], [6, 10, 'crate'],
    // two barrels at center diagonal
    [3, 7, 'barrel'], [5, 8, 'barrel'],
    // walls flanking
    [0, 7, 'wall'], [8, 8, 'wall'],
  ];
  return cells.map(([cx, ry, kind]) => ({
    x: cx * CELL,
    y: ry * CELL,
    w: CELL,
    h: CELL,
    kind,
  }));
}

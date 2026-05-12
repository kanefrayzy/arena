import { ReactNode } from 'react';

export type SortDir = 'asc' | 'desc';

/**
 * Sortable table header. Clicking toggles asc/desc on its own key,
 * or switches the active sort to this key (defaulting to desc).
 */
export function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onChange,
  align = 'left',
  className = '',
}: {
  label: ReactNode;
  sortKey: string;
  activeKey: string;
  dir: SortDir;
  onChange: (key: string, dir: SortDir) => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const active = activeKey === sortKey;
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`px-3 py-2.5 ${alignCls} ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (active) onChange(sortKey, dir === 'asc' ? 'desc' : 'asc');
          else onChange(sortKey, 'desc');
        }}
        className={
          'inline-flex items-center gap-1 hover:text-white ' +
          (active ? 'text-white' : 'text-white/50')
        }
      >
        <span>{label}</span>
        <span className={'text-[9px] ' + (active ? 'opacity-100' : 'opacity-30')}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '▲▼'}
        </span>
      </button>
    </th>
  );
}

/**
 * Generic pagination controls. Renders prev/next and a compact page indicator.
 * `total` may be unknown — pass `null` to hide page count.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  pageSizeOptions = [25, 50, 100, 200],
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number | null;
  onChange: (page: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
}) {
  const totalPages = total !== null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = total !== null ? Math.min(total, (page + 1) * pageSize) : (page + 1) * pageSize;
  const canPrev = page > 0;
  const canNext = totalPages !== null ? page + 1 < totalPages : true;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-white/60">
      <div>
        {total !== null ? (
          <span>
            {from}–{to} из {total}
          </span>
        ) : (
          <span>
            {from}–{to}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80 outline-none hover:bg-white/10"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n} className="bg-bg">
                {n}/стр
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => onChange(page - 1)}
          className="rounded-md bg-white/5 px-2.5 py-1 hover:bg-white/10 disabled:opacity-30"
        >
          ← Назад
        </button>
        <span className="px-1.5 tabular-nums">
          {page + 1}
          {totalPages !== null && <span className="text-white/40"> / {totalPages}</span>}
        </span>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => onChange(page + 1)}
          className="rounded-md bg-white/5 px-2.5 py-1 hover:bg-white/10 disabled:opacity-30"
        >
          Вперёд →
        </button>
      </div>
    </div>
  );
}

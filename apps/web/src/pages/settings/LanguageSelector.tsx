import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getKnownLanguages, type LangMeta } from '../../shared/i18n/languages';

export function LanguageSelector() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const langs: LangMeta[] = getKnownLanguages();
  const current = langs.find((l) => i18n.language?.startsWith(l.code)) ?? langs[0];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const choose = (code: string) => {
    void i18n.changeLanguage(code);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="game-btn game-btn-ghost flex w-full items-center justify-between gap-3 px-4 py-3"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="flex items-center gap-3">
          <span className="text-2xl leading-none">{current?.flag ?? '🌐'}</span>
          <span className="font-display uppercase text-white">{current?.name ?? '—'}</span>
        </span>
        <span className={'text-white/60 transition-transform ' + (open ? 'rotate-180' : '')}>▼</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-game-bg-2/95 backdrop-blur shadow-game-card"
        >
          {langs.map((l) => {
            const active = current?.code === l.code;
            return (
              <button
                key={l.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => choose(l.code)}
                className={
                  'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/10 ' +
                  (active ? 'bg-game-yellow/15 text-game-yellow' : 'text-white')
                }
              >
                <span className="text-xl leading-none">{l.flag}</span>
                <span className="flex-1 font-display uppercase">{l.name}</span>
                <span className="text-xs uppercase tracking-widest text-white/40">{l.code}</span>
                {active && <span className="text-game-yellow">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

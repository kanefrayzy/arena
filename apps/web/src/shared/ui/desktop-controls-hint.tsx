/**
 * Small inline overlay showing PC controls. Used on the queue page and the
 * match countdown so players know how to play after we removed the on-screen
 * joystick / FIRE / ability buttons on desktop.
 *
 * The component renders nothing on touch devices — callers gate visibility
 * via `touchUi` flag (or use the convenience hook `useIsDesktop`).
 */

interface KeyCapProps {
  label: string;
  wide?: boolean;
}

function KeyCap({ label, wide }: KeyCapProps) {
  return (
    <span
      className={
        'inline-flex items-center justify-center rounded-md border-2 border-white/30 bg-white/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white shadow-[0_2px_0_rgba(0,0,0,0.4)] backdrop-blur-sm ' +
        (wide ? 'min-w-[3.5rem]' : 'min-w-[1.75rem]')
      }
    >
      {label}
    </span>
  );
}

export function DesktopControlsHint() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-2xl border border-white/15 bg-black/45 px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-white/80 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md">
      <div className="flex items-center gap-1.5">
        <div className="flex flex-col items-center gap-0.5">
          <KeyCap label="W" />
          <div className="flex gap-0.5">
            <KeyCap label="A" />
            <KeyCap label="S" />
            <KeyCap label="D" />
          </div>
        </div>
        <span className="ml-1 text-white/70">движение</span>
      </div>
      <div className="flex items-center gap-1.5">
        <KeyCap label="ЛКМ" wide />
        <span className="text-white/70">выстрел</span>
      </div>
      <div className="flex items-center gap-1.5">
        <KeyCap label="Q" />
        <span className="text-white/70">способность</span>
      </div>
    </div>
  );
}

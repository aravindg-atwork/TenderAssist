import { useId, useState, type ReactNode } from 'react';

/**
 * A small (i) beside a heading or step: selecting it opens a plain-words
 * explanation underneath, selecting it again closes it. Keyboard and screen
 * reader friendly (a real button with aria-expanded). The explanation is the
 * button's next sibling, so in a heading row it wraps onto its own line.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" className="infotip__btn" aria-expanded={open} aria-controls={id} aria-label={`What is ${label}?`}
        title={`What is ${label}?`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(!open); }}>
        i
      </button>
      {open && <span id={id} className="infotip__body" role="note">{children}</span>}
    </>
  );
}

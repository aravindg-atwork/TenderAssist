import { useEffect, useState } from 'react';

export const PAGE_SIZE = 20;

/** The page of a list to show; goes back to page 1 whenever the filters change. */
export function usePage<T>(items: T[], resetKey: string, size = PAGE_SIZE): { page: number; pages: number; shown: T[]; setPage: (page: number) => void } {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey]);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages);
  return { page: current, pages, shown: items.slice((current - 1) * size, current * size), setPage };
}

/** "21-40 of 133" with previous / next and page numbers. */
export function Pager({ page, pages, total, size = PAGE_SIZE, onPage, noun }: {
  page: number; pages: number; total: number; size?: number; onPage: (page: number) => void; noun: string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  // First, last, and two either side of the current page.
  const numbers = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  return (
    <nav className="pager" aria-label={`Pages of ${noun}`}>
      <span className="pager__range">{from}-{to} of {total} {noun}</span>
      {pages > 1 && (
        <span className="pager__pages">
          <button type="button" className="pager__btn" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
          {numbers.map((n, index) => (
            <span key={n} className="pager__group">
              {index > 0 && n - numbers[index - 1] > 1 && <span className="pager__gap" aria-hidden="true">…</span>}
              <button type="button" className="pager__btn" aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>
            </span>
          ))}
          <button type="button" className="pager__btn" disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
        </span>
      )}
    </nav>
  );
}

/** A row of filter pills with counts. */
export function FilterPills<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ id: T; label: string; count?: number }>; onChange: (id: T) => void; label: string;
}) {
  return (
    <div className="shelves" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" role="tab" aria-selected={value === option.id} className="shelf" onClick={() => onChange(option.id)}>
          {option.label}{option.count !== undefined && <span className="count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

import type { JobDetail } from '../../../src/electron/ipcTypes';

export interface NoMatchesSummaryProps {
  detail: JobDetail;
  onEditSettings: () => void;
  /** Off where the page already lists the categories searched. */
  showCategories?: boolean;
}

/**
 * Shown when a run found nothing worth downloading: what was searched, what
 * the portal returned, and the intent it was judged against, with a direct
 * way to adjust those settings for the next run.
 */
export function NoMatchesSummary({ detail, onEditSettings, showCategories = true }: NoMatchesSummaryProps) {
  const config = detail.runConfiguration;
  const found = detail.tenders.length;
  const date = config?.searchDate ? new Date(`${config.searchDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'this date';
  const failed = detail.searches.filter((search) => search.state === 'FAILED').length;

  return (
    <section className="no-matches" aria-labelledby="no-matches-title">
      <h2 id="no-matches-title">No tender matched your filters this time</h2>
      <p>
        {found === 0
          ? `The portal listed no tenders in your categories for ${date}.`
          : `TenderAssist checked ${found} tender${found === 1 ? '' : 's'} published on ${date}, but none matched your intent.`}
        {failed > 0 && ` ${failed} categor${failed === 1 ? 'y' : 'ies'} could not be searched, so some tenders may be missing.`}
      </p>

      {showCategories && detail.searches.length > 0 && (
        <div className="no-matches__block">
          <h3>Categories searched</h3>
          <ul className="no-matches__categories">
            {detail.searches.map((search) => (
              <li key={search.id}>
                <span>{search.product_category}</span>
                <span className="no-matches__count">
                  {search.state === 'FAILED' ? 'not searched' : `${search.result_count ?? 0} found`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {config && (
        <div className="no-matches__block">
          <h3>Intent used</h3>
          <div className="no-matches__chips" aria-label="Intent keywords">
            {config.keywords.map((keyword) => <span className="chip" key={keyword}>{keyword}</span>)}
          </div>
          {config.excludedKeywords.length > 0 && (
            <>
              <h3>Excluded scope</h3>
              <div className="no-matches__chips" aria-label="Excluded scope">
                {config.excludedKeywords.map((keyword) => <span className="chip chip--muted" key={keyword}>{keyword}</span>)}
              </div>
            </>
          )}
        </div>
      )}

      <p className="no-matches__hint">
        Expected results? Add intent keywords, remove an exclusion, or add a category. Changes apply to your next run.
      </p>
      <button className="btn btn--quiet" type="button" onClick={onEditSettings}>Edit categories and intent</button>
    </section>
  );
}

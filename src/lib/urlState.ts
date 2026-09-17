/**
 * Writes screen state into the query string without a navigation, so Back
 * and reload come back to the same search or tab. replaceState rather than
 * pushState: each filter tap isn't a step anyone wants to Back through.
 * Next's router picks this up, so useSearchParams stays in sync.
 */
export function replaceQueryParams(updates: Record<string, string | null>): void {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
}

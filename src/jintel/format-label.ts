/** Render `"{name} ({ticker})"` so single-word names like "Strategy" can't be read as generic nouns. */
export function formatAssetLabel(entityName: string | null | undefined, ticker: string): string {
  const name = entityName?.trim();
  if (!name) return ticker;
  if (name.toUpperCase() === ticker.toUpperCase()) return ticker;
  return `${name} (${ticker})`;
}

import { Instrument } from './instruments.service';

// NFD splits most accented letters into base + combining mark, but "ł" has no
// decomposition, so it is mapped explicitly — otherwise "zolw" wouldn't match "Żółw".
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/gi, 'l')
    .toLowerCase();
}

// Ticker prefix matches first, then ticker substring, then name substring, so an
// exact ticker query isn't buried under incidental name matches. Each group is
// sorted by name. An empty query returns everything of the type, sorted by name.
export function searchInstruments(instruments: Instrument[], query: string, type: string): Instrument[] {
  const candidates = type ? instruments.filter((i) => i.type === type) : instruments;
  const byName = (a: Instrument, b: Instrument) => a.name.localeCompare(b.name);
  const q = normalizeForSearch(query.trim());
  if (!q) return [...candidates].sort(byName);

  const prefix: Instrument[] = [];
  const tickerContains: Instrument[] = [];
  const nameContains: Instrument[] = [];
  for (const instrument of candidates) {
    const ticker = normalizeForSearch(instrument.ticker);
    if (ticker.startsWith(q)) prefix.push(instrument);
    else if (ticker.includes(q)) tickerContains.push(instrument);
    else if (normalizeForSearch(instrument.name).includes(q)) nameContains.push(instrument);
  }
  return [...prefix.sort(byName), ...tickerContains.sort(byName), ...nameContains.sort(byName)];
}

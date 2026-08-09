// Fixed set of types offered when *creating* an instrument (admin panel) —
// distinct from InstrumentsService.types(), which only reflects types
// already present in loaded data. pl_stock/us_stock won't appear there
// until the first one is added, so the create-form combobox can't derive
// its options from loaded data the way the read-side comboboxes do.
export const CREATABLE_INSTRUMENT_TYPES: readonly string[] = ['index', 'pl_stock', 'us_stock'];

export const INSTRUMENT_TYPE_LABELS: Record<string, string> = {
  index: $localize`:@@instrumentType.index:Index`,
  pl_stock: $localize`:@@instrumentType.plStock:PL companies`,
  us_stock: $localize`:@@instrumentType.usStock:US companies`,
};

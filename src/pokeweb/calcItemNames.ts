import catalog from "../assets/data/calc_item_names.json";

export type CalcItemValidation = {
  normalized: Array<{ from: string; to: string }>;
  unmatched: string[];
};

export function calcItemId(name: string): string {
  return name.toLowerCase().replace(/é/gu, "e").replace(/[^a-z0-9]/gu, "");
}

export function createCalcItemNameResolver(names: readonly string[] = catalog.names): (name: string) => string | undefined {
  const exact = new Set(names);
  const normalized = new Map<string, string | null>();
  for (const name of exact) {
    const id = calcItemId(name);
    if (!id) continue;
    // A future catalog collision must not silently select the wrong item.
    normalized.set(id, normalized.has(id) ? null : name);
  }
  return (name) => exact.has(name) ? name : normalized.get(calcItemId(name)) ?? undefined;
}

export const resolveCalcItemName = createCalcItemNameResolver();

export function createCalcItemValidator() {
  const report: CalcItemValidation = { normalized: [], unmatched: [] };
  const seen = new Set<string>();
  const resolve = (value: unknown): string => {
    const name = String(value ?? "");
    const matched = resolveCalcItemName(name);
    if (!seen.has(name)) {
      seen.add(name);
      if (matched && matched !== name) report.normalized.push({ from: name, to: matched });
      else if (!matched && !["", "0", "none", "noitem"].includes(calcItemId(name))) report.unmatched.push(name);
    }
    // Unknown items are deliberately preserved, not dropped or fuzzy-matched.
    return matched ?? name;
  };
  return { resolve, report };
}

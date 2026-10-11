export type TrackerMove = {
  id: number; key: string; name: string; constant: string; credits?: string;
  defaultProgress?: Record<string, unknown>; implementationNotes?: string;
};

export function moveEffectStatus(id: number, managed: boolean, alias: boolean, record: string): {
  completed: boolean; notes: string;
} {
  if (id >= 622 && id <= 658 || id >= 695 && id <= 703 || id === 719 || id === 723)
    return {completed: false, notes: 'Z-Move behavior is outside the integration scope.'};
  if (id === 743 || id >= 757 && id <= 774)
    return {completed: false, notes: 'Max Move behavior is outside the integration scope.'};
  if (id === 851 || id === 906)
    return {completed: false, notes: 'Terastallization-specific behavior is outside the integration scope.'};
  if (id === 718) return {completed: false, notes: 'Deferred: Memory items and item-dependent type selection are not integrated.'};
  if (id === 904) return {completed: false, notes: 'Deferred: Ogerpon masks and mask-dependent type selection are not integrated.'};
  if (id === 606 || id === 607)
    return {completed: false, notes: 'Animation is present; successful cosmetic-only execution has not been established.'};
  if (!record) return {completed: false, notes: 'No integration move-data record was found.'};
  if (managed) return {completed: true, notes: 'Registered in an on-demand White 2 battle module; current build remains unverified.'};
  if (alias) return {completed: true, notes: 'Resident alias of a native move handler; current build remains unverified.'};
  if (/Quality\s*=\s*"EFFECT_OTHERS"/.test(record))
    return {completed: false, notes: 'Special execution requires review; no module or native alias was found.'};
  return {completed: true, notes: 'Native move data and resident hooks provide the effect; current build remains unverified.'};
}

export function previewAnimationId(id: number, record: string, staged: Set<number>): number | undefined {
  if (staged.has(id)) return id;
  const native = Number(/"Move Animation ID"\s*=\s*(\d+)/.exec(record)?.[1] ?? 0);
  return native > 0 ? native : undefined;
}

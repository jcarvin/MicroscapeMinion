// Returns the bottleneck consumed material — the one that will run out first.
// For multi-input activities (e.g. soft clay: clay + water) this finds the
// input with the fewest cycles remaining, not just the first one listed.

import { state } from './state.js';

export function runoutInfo(actId) {
  const def = state.ACTIVITY_DEFS[actId];
  if (!def) return null;

  // Consumed items are drawn from inventory only — loot bag items can't be
  // used directly and would inflate the count if included via getMaterialCount.
  const inv = state.mirroredState.me?.inventory ?? {};

  let bottleneck = null;
  for (const [itemId, change] of Object.entries(def.inventoryChanges)) {
    if (change >= 0) continue;
    const costPerCycle = -change;
    const available = inv[itemId] ?? 0;
    const cyclesLeft = Math.floor(available / costPerCycle);
    if (!bottleneck || cyclesLeft < bottleneck.cyclesLeft) {
      bottleneck = { itemId, costPerCycle, totalMaterial: available, cyclesLeft };
    }
  }

  return bottleneck; // null if no consumed materials (gathering, combat, etc.)
}

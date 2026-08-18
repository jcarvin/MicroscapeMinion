import { state } from './state.js';

export function getMaterialCount(itemId) {
  const me = state.mirroredState.me;
  const inv = me?.inventory?.[itemId] ?? 0;
  const lb = me?.lootBag?.[itemId] ?? 0;
  // inventory mirrors the loot bag (lb ⊆ inv), so max avoids double-counting.
  return Math.max(inv, lb);
}

export function getMaterialCountForMe(me, itemId) {
  const inv = me?.inventory?.[itemId] ?? 0;
  const lb = me?.lootBag?.[itemId] ?? 0;
  return Math.max(inv, lb);
}

export function lootBagTotal() {
  const lb = state.mirroredState.me?.lootBag;
  if (!lb) return 0;
  return Object.values(lb).reduce((sum, n) => sum + n, 0);
}

export function getLootBagCount(itemId) {
  return state.mirroredState.me?.lootBag?.[itemId] ?? 0;
}

export function getGoalCount(itemName, itemId) {
  const inv = getInventoryCount(itemName, itemId);
  const lootKey = itemId ?? findLootBagKey(itemName);
  const lb = lootKey ? getLootBagCount(lootKey) : 0;
  if (inv === null && !lootKey) return null;
  return Math.max(inv ?? 0, lb);
}

export function getGoalCountForMe(me, g) {
  if (!me || !g) return null;
  const inv = me.inventory ?? {};
  const lb = me.lootBag ?? {};
  const norm = (str) => str?.toLowerCase().replace(/[\s_-]/g, '') ?? '';

  let hasInvCount = false;
  let invCount = 0;
  if (g.itemId && g.itemId in inv) {
    hasInvCount = true;
    invCount = inv[g.itemId] ?? 0;
  } else if (g.itemName) {
    const n = norm(g.itemName);
    const key = Object.keys(inv).find((k) => norm(k) === n);
    if (key) {
      hasInvCount = true;
      invCount = inv[key] ?? 0;
    }
  }

  let hasLootCount = false;
  let lbCount = 0;
  if (g.itemId && g.itemId in lb) {
    hasLootCount = true;
    lbCount = lb[g.itemId] ?? 0;
  } else if (g.itemName) {
    const n = norm(g.itemName);
    const key = Object.keys(lb).find((k) => norm(k) === n);
    if (key) {
      hasLootCount = true;
      lbCount = lb[key] ?? 0;
    }
  }

  if (!hasInvCount && !hasLootCount) return 0;
  return Math.max(invCount, lbCount);
}

export function getInventoryCount(itemName, itemId) {
  const inv = state.mirroredState.me?.inventory;
  if (!inv || typeof inv !== 'object') return null;
  if (itemId && itemId in inv) return inv[itemId];
  if (itemName) {
    const key = findInventoryKey(itemName);
    if (key) return inv[key];
  }
  return 0;
}

// Case-insensitive, whitespace-ignoring key lookup against inventory
export function findInventoryKey(itemName) {
  const inv = state.mirroredState.me?.inventory;
  if (!inv) return null;
  const norm = itemName.toLowerCase().replace(/[\s_-]/g, '');
  return (
    Object.keys(inv).find(
      (k) => k.toLowerCase().replace(/[\s_-]/g, '') === norm
    ) ?? null
  );
}

export function findLootBagKey(itemName) {
  const lb = state.mirroredState.me?.lootBag;
  if (!lb || !itemName) return null;
  const norm = itemName.toLowerCase().replace(/[\s_-]/g, '');
  return (
    Object.keys(lb).find(
      (k) => k.toLowerCase().replace(/[\s_-]/g, '') === norm
    ) ?? null
  );
}

// Same lookup against an arbitrary object (used for inventoryChanges keys)
export function findKey(obj, itemName, itemId) {
  if (!obj) return null;
  if (itemId && itemId in obj) return itemId;
  if (!itemName) return null;
  const norm = itemName.toLowerCase().replace(/[\s_-]/g, '');
  return (
    Object.keys(obj).find(
      (k) => k.toLowerCase().replace(/[\s_-]/g, '') === norm
    ) ?? null
  );
}

export function sameGoalItem(a, b) {
  if (!a || !b) return false;
  const itemKey = (g) => (g.itemId ?? g.itemName ?? '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  const aKey = itemKey(a);
  const bKey = itemKey(b);
  return aKey !== '' && aKey === bKey;
}

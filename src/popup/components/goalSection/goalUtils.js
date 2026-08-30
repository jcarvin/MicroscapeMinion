import { formatItemId } from '../../utils/format';
import { GOAL_SOURCE_OPTIONS } from '../GoalSourceSelector';

let fallbackId = 0;

export function createGoalId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackId += 1;
  return `goal-${Date.now()}-${fallbackId}`;
}

export function createRow(goal = null) {
  return {
    id: goal?.id ?? createGoalId(),
    itemId: goal?.itemId ?? goal?.itemName ?? null,
    itemName: goal?.itemName ?? '',
    targetValue: goal ? String(goal.targetCount) : '',
    maxCraftable: goal?.maxCraftable === true,
    sourceMode: ['any', 'manual', 'craft', 'drops'].includes(goal?.sourceMode) ? goal.sourceMode : null,
    completed: goal?.completed === true,
  };
}

export function displayItemName(item) {
  if (!item) return '';
  return item.name && item.name !== item.id ? item.name : formatItemId(item.id);
}

export function resolveGoalEta(status) {
  if (!status) return { etaMs: null, bankTrips: 0 };
  if (status.chanceBased) {
    return status.eta?.totalMs > 0
      ? { etaMs: status.eta.totalMs, bankTrips: status.eta.bankTrips ?? 0 }
      : { etaMs: null, bankTrips: 0 };
  }
  if (status.eta == null) return { etaMs: null, bankTrips: 0 };
  if (status.eta === 0) return { etaMs: 0, bankTrips: 0 };
  return { etaMs: status.eta.totalMs, bankTrips: status.eta.bankTrips ?? 0 };
}

export function hasAcquisitionSource(item, source) {
  if (item?.acquisitionSources?.includes(source)) return true;
  if (source === 'craft') return item?.craftable === true;
  if (source === 'drops') return item?.chanceDrop === true;
  if (source === 'manual') return item?.manualActivity === true;
  return false;
}

export function hasAmbiguousSource(item) {
  return hasAcquisitionSource(item, 'craft') && hasAcquisitionSource(item, 'drops');
}

export function sourceOptionsFor(item, planning) {
  if (!item) return [];
  const specificIds = GOAL_SOURCE_OPTIONS
    .filter(({ id }) => id !== 'any')
    .filter(({ id }) => hasAcquisitionSource(item, id)
      || planning?.sourceOptions?.includes(id))
    .map(({ id }) => id);
  const anyAvailable = item.bazaarTradeable !== false || specificIds.length > 1;
  return GOAL_SOURCE_OPTIONS
    .filter(({ id }) => (id === 'any' && anyAvailable) || specificIds.includes(id))
    .map((option) => option.id === 'any' && item.bazaarTradeable === false
      ? {
          ...option,
          description: 'Use any available acquisition route. Materials and XP are not projected.',
        }
      : option);
}

export function effectiveSourceMode(row, item) {
  if (row.maxCraftable) return row.sourceMode === 'manual' ? 'manual' : 'craft';
  if (['any', 'manual', 'craft', 'drops'].includes(row.sourceMode)) return row.sourceMode;
  if (hasAmbiguousSource(item)) return 'any';
  if (hasAcquisitionSource(item, 'craft')) return 'any';
  if (hasAcquisitionSource(item, 'drops')) {
    return hasAcquisitionSource(item, 'activity') ? 'any' : 'drops';
  }
  if (hasAcquisitionSource(item, 'manual')) return 'manual';
  return 'any';
}

export function completeGoals(rows, items, persistedGoals = []) {
  const savedGoals = new Map(persistedGoals.map((goal) => [goal.id, goal]));
  return rows.flatMap((row) => {
    const targetCount = Number(row.targetValue);
    const maxCraftable = row.maxCraftable === true;
    const item = items.find(({ id }) => id === row.itemId);
    const sourceMode = effectiveSourceMode(row, item);
    const itemName = row.itemName || displayItemName(item)
      || (row.itemId ? formatItemId(row.itemId) : '');
    const minimumTarget = maxCraftable ? 0 : 1;
    if (!row.itemId || !itemName || !Number.isSafeInteger(targetCount) || targetCount < minimumTarget) {
      const savedGoal = savedGoals.get(row.id);
      return savedGoal ? [savedGoal] : [];
    }
    const hasKnownSource = item?.craftable || item?.chanceDrop || item?.manualActivity
      || ['any', 'manual', 'craft', 'drops'].includes(row.sourceMode);
    return [{
      id: row.id,
      itemId: row.itemId,
      itemName,
      targetCount,
      ...(maxCraftable ? { maxCraftable: true } : {}),
      ...(maxCraftable || hasKnownSource ? { sourceMode } : {}),
      ...(row.completed ? { completed: true } : {}),
    }];
  });
}

export function plansFromStatuses(goalStatuses) {
  return new Map((goalStatuses ?? []).flatMap((status) =>
    status.planning ? [[status.goal.id, status.planning]] : []));
}

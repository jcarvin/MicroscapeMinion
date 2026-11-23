import {
  buildActivityIndex,
  buildInputActivityIndex,
  buildRecipeIndex,
  inferActivitySkill,
} from './goal-planner.js';
import bundledActivityDefs from './activity-defs.json';

// Safety limits to prevent runaway recursion on pathological inputs.
const NODE_BUDGET = 2000;
const DEPTH_CAP = 16;

function outputCount(activity, itemId) {
  return activity.outputs.find((o) => o.itemId === itemId)?.count ?? 1;
}

function isLevelAccessible(activity, playerSkillLevels) {
  if (!activity.requiredLevel || !activity.skill) return true;
  return (playerSkillLevels?.[activity.skill] ?? 1) >= activity.requiredLevel;
}

// Returns all candidates sorted by: accessible first, then perCycle desc,
// requiredLevel asc, activityId asc.  Used for backtracking — the caller
// iterates the full list rather than stopping at the first pick.
function sortCandidates(candidates, itemId, playerSkillLevels) {
  const withAccess = candidates.map((recipe) => ({
    recipe,
    accessible: isLevelAccessible(recipe, playerSkillLevels),
    perCycle: outputCount(recipe, itemId),
  }));
  const prioritized = withAccess.some((r) => r.accessible)
    ? withAccess.filter((r) => r.accessible)
    : withAccess;
  return prioritized
    .sort((a, b) =>
      b.perCycle - a.perCycle ||
      (a.recipe.requiredLevel ?? 0) - (b.recipe.requiredLevel ?? 0) ||
      a.recipe.activityId.localeCompare(b.recipe.activityId)
    )
    .map((w) => w.recipe);
}

function getDropCandidates(itemId, activityDefs) {
  const candidates = [];
  for (const [activityId, def] of Object.entries(activityDefs ?? {})) {
    const qty = def?.dropItems?.[itemId];
    if (!qty || qty <= 0) continue;
    candidates.push({
      activityId,
      skill: typeof def.skill === 'string' ? def.skill : inferActivitySkill(activityId),
      requiredLevel: Number.isSafeInteger(def.level) && def.level >= 1 ? def.level : null,
      mobCombatLevel: Number.isSafeInteger(def.mobCombatLevel) ? def.mobCombatLevel : null,
      mobMinimumCombatLevel: Number.isSafeInteger(def.mobMinimumCombatLevel)
        ? def.mobMinimumCombatLevel
        : null,
    });
  }
  return candidates;
}

function pickBestDrop(accessible, playerCombatLevel) {
  return [...accessible].sort((a, b) => {
    const aDiff = Math.abs((a.mobCombatLevel ?? 0) - (playerCombatLevel ?? 0));
    const bDiff = Math.abs((b.mobCombatLevel ?? 0) - (playerCombatLevel ?? 0));
    return aDiff - bDiff || a.activityId.localeCompare(b.activityId);
  })[0] ?? null;
}

function resolveNode(itemId, quantity, ctx) {
  const {
    recipesByOutput,
    inputActivitiesByOutput,
    activitiesByOutput,
    activityDefs,
    ledger,
    playerSkillLevels,
    playerCombatLevel,
    visited,
    liveActivityIds,
    budget,
  } = ctx;

  if (budget.remaining <= 0) {
    const owned = ledger.get(itemId) ?? 0;
    const needed = Math.max(0, quantity - owned);
    return { itemId, quantity, owned, needed, activityId: null, skill: null, requiredLevel: null, levelBlocked: false, status: 'purchase-only', children: [] };
  }
  budget.remaining--;

  const owned = ledger.get(itemId) ?? 0;
  const needed = Math.max(0, quantity - owned);

  if (needed === 0) {
    ledger.set(itemId, owned - quantity);
    return { itemId, quantity, owned, needed: 0, status: 'sufficient', children: [] };
  }

  if (visited.has(itemId)) {
    return { itemId, quantity, owned, needed, status: 'circular', activityId: null, skill: null, requiredLevel: null, levelBlocked: false, children: [] };
  }

  if (visited.size >= DEPTH_CAP) {
    return { itemId, quantity, owned, needed, activityId: null, skill: null, requiredLevel: null, levelBlocked: false, status: 'purchase-only', children: [] };
  }

  const nextVisited = new Set([...visited, itemId]);
  const ctx2 = { ...ctx, visited: nextVisited };

  // Gatherable (input-free) wins outright — a real gathering activity must not be
  // displaced by a container-return activity that also happens to output the item.
  const gatherableProducers = (activitiesByOutput.get(itemId) ?? []).filter(
    (a) => a.inputs.length === 0 && !a.chanceBased
  );
  if (gatherableProducers.length > 0) {
    const producer = gatherableProducers
      .slice()
      .sort((a, b) =>
        Number(isLevelAccessible(b, playerSkillLevels)) -
          Number(isLevelAccessible(a, playerSkillLevels)) ||
        (a.requiredLevel ?? 0) - (b.requiredLevel ?? 0) ||
        a.activityId.localeCompare(b.activityId)
      )[0];
    ledger.set(itemId, 0);
    return {
      itemId,
      quantity,
      owned,
      needed,
      activityId: producer.activityId,
      skill: producer.skill,
      requiredLevel: producer.requiredLevel,
      levelBlocked: !isLevelAccessible(producer, playerSkillLevels),
      status: 'gatherable',
      children: [],
    };
  }

  // Merge maxCraftable recipes and non-maxCraftable input activities into one pool.
  // maxCraftable is a queue-batching signal, not a routing preference; keeping them
  // separate let the phantom seed recipe craft-pot-unfired beat the live shape-pot.
  const recipes = recipesByOutput.get(itemId) ?? [];
  const inputFallbacks = (inputActivitiesByOutput.get(itemId) ?? []).filter(
    (a) => !a.maxCraftable
  );
  let candidates = [...recipes, ...inputFallbacks];

  // If any candidate comes from the live-parsed activity set, discard seed-only ones.
  // This prevents stale bundled recipes (e.g. craft-pot-unfired) from shadowing
  // the live equivalent (shape-pot).
  if (liveActivityIds?.size > 0) {
    const liveCandidates = candidates.filter((c) => liveActivityIds.has(c.activityId));
    if (liveCandidates.length > 0) candidates = liveCandidates;
  }

  if (candidates.length > 0) {
    const sorted = sortCandidates(candidates, itemId, playerSkillLevels);

    for (const recipe of sorted) {
      const perCycle = outputCount(recipe, itemId);
      const cycles = Math.ceil(needed / perCycle);
      const levelBlocked = !isLevelAccessible(recipe, playerSkillLevels);

      // Snapshot the ledger before attempting this candidate so we can backtrack
      // if any direct child resolves circular (the entire attempt is invalid).
      const snapshot = new Map(ledger);
      ledger.set(itemId, 0);

      const children = recipe.inputs.map(({ itemId: inputId, count }) =>
        resolveNode(inputId, count * cycles, ctx2)
      );

      if (children.some((c) => c.status === 'circular')) {
        ledger.clear();
        for (const [k, v] of snapshot) ledger.set(k, v);
        continue;
      }

      // Credit byproduct outputs after all inputs are resolved.
      // Returned containers (e.g. bucket from shape-pot) become available
      // to sibling steps that resolve later in the dependency order.
      for (const { itemId: byId, count } of recipe.outputs) {
        if (byId !== itemId) {
          ledger.set(byId, Math.max(0, (ledger.get(byId) ?? 0) + count * cycles));
        }
      }

      return {
        itemId,
        quantity,
        owned,
        needed,
        activityId: recipe.activityId,
        skill: recipe.skill,
        requiredLevel: recipe.requiredLevel,
        levelBlocked,
        status: 'craftable',
        children,
      };
    }
  }

  // Combat drops
  const dropCandidates = getDropCandidates(itemId, activityDefs);
  if (dropCandidates.length > 0) {
    const accessible = dropCandidates.filter(
      (c) => playerCombatLevel !== null && playerCombatLevel >= (c.mobMinimumCombatLevel ?? 0)
    );
    if (accessible.length > 0) {
      const best = pickBestDrop(accessible, playerCombatLevel);
      ledger.set(itemId, 0);
      return {
        itemId,
        quantity,
        owned,
        needed,
        activityId: best.activityId,
        skill: best.skill,
        requiredLevel: best.requiredLevel,
        levelBlocked: false,
        status: 'drops',
        children: [],
      };
    }
    const minCombat = Math.min(
      ...dropCandidates.map((c) => c.mobMinimumCombatLevel ?? c.mobCombatLevel ?? Infinity)
    );
    return {
      itemId,
      quantity,
      owned,
      needed,
      activityId: null,
      skill: null,
      requiredLevel: null,
      levelBlocked: true,
      minCombatLevel: Number.isFinite(minCombat) ? minCombat : null,
      status: 'purchase-only',
      children: [],
    };
  }

  return {
    itemId,
    quantity,
    owned,
    needed,
    activityId: null,
    skill: null,
    requiredLevel: null,
    levelBlocked: false,
    status: 'purchase-only',
    children: [],
  };
}

export function buildDependencyTree({
  itemId,
  quantity,
  activityDefs,
  ownedCounts = {},
  playerSkillLevels = {},
  playerCombatLevel = null,
  liveActivityIds = null,
}) {
  // Merge bundled canonical defs (as fallbacks) with live game defs.
  // Live defs take precedence; bundled fills in activities the live game omits.
  const mergedDefs = { ...bundledActivityDefs, ...(activityDefs ?? {}) };
  const recipesByOutput = buildRecipeIndex(mergedDefs);
  const inputActivitiesByOutput = buildInputActivityIndex(mergedDefs);
  const activitiesByOutput = buildActivityIndex(mergedDefs);
  const ledger = new Map(
    Object.entries(ownedCounts).map(([id, v]) => [id, Math.max(0, Number(v) || 0)])
  );
  const liveSet =
    liveActivityIds instanceof Set
      ? liveActivityIds
      : Array.isArray(liveActivityIds) && liveActivityIds.length > 0
        ? new Set(liveActivityIds)
        : null;

  return resolveNode(itemId, quantity, {
    recipesByOutput,
    inputActivitiesByOutput,
    activitiesByOutput,
    activityDefs: mergedDefs,
    ledger,
    playerSkillLevels,
    playerCombatLevel,
    visited: new Set(),
    liveActivityIds: liveSet,
    budget: { remaining: NODE_BUDGET },
  });
}

export function flattenTree(node) {
  const steps = [];

  function traverse(n) {
    for (const child of n.children) traverse(child);
    if (n.status === 'sufficient' || n.status === 'circular' || n.status === 'purchase-only') return;
    if (n.quantity <= 0) return;

    const sourceMode =
      n.status === 'gatherable' ? 'manual' : n.status === 'drops' ? 'drops' : 'craft';

    // Merge only immediately adjacent entries for the same item (take the max quantity).
    // Non-adjacent repeats are separated by a consuming step and must stay separate
    // so the queue stop-condition fires at the right threshold each time.
    const last = steps.length > 0 ? steps[steps.length - 1] : null;
    if (last && last.itemId === n.itemId) {
      steps[steps.length - 1] = { ...last, targetCount: Math.max(last.targetCount, n.quantity) };
    } else {
      steps.push({ itemId: n.itemId, targetCount: n.quantity, sourceMode });
    }
  }

  traverse(node);
  return steps;
}

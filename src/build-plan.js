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
      steps.push({ itemId: n.itemId, targetCount: n.quantity, sourceMode, activityId: n.activityId ?? null });
    }
  }

  traverse(node);
  return steps;
}

// ── Receptacle detection ────────────────────────────────────────────────────

// Detects "refillable container" pairs: items that cycle empty → filled → empty
// across activities (e.g. bucket → waterBucket → bucket).
// A fill pair is any activity with exactly one input item and one output item
// at the same count (the fill operation), confirmed when the output item is
// returned as a byproduct by some other activity that consumes it.
//
// Returns Map<emptyId, { filledId, fillActivityId, cycleConsumed, cycleProduced }>
export function detectReceptacles(activityDefs) {
  const fillPairs = new Map();

  for (const [activityId, def] of Object.entries(activityDefs ?? {})) {
    const changes = def.inventoryChanges ?? {};
    const entries = Object.entries(changes);
    const inputs = entries.filter(([, v]) => v < 0);
    const outputs = entries.filter(([, v]) => v > 0);
    if (inputs.length !== 1 || outputs.length !== 1) continue;
    const [emptyId, emptyChange] = inputs[0];
    const [filledId, filledChange] = outputs[0];
    if (emptyId === filledId) continue;
    fillPairs.set(emptyId, {
      filledId,
      fillActivityId: activityId,
      cycleConsumed: -emptyChange,
      cycleProduced: filledChange,
    });
  }

  const confirmed = new Map();
  for (const [emptyId, info] of fillPairs) {
    const { filledId } = info;
    for (const def of Object.values(activityDefs ?? {})) {
      const changes = def.inventoryChanges ?? {};
      if ((changes[filledId] ?? 0) < 0 && (changes[emptyId] ?? 0) > 0) {
        confirmed.set(emptyId, info);
        break;
      }
    }
  }

  return confirmed;
}

// ── Receptacle warnings ─────────────────────────────────────────────────────

export const MIN_RECEPTACLE_COUNT = 10;
export const MAX_RECEPTACLE_COUNT = 500;

// Returns an array of { level: 'blocking'|'efficiency', emptyId, filledId, total }
// for each receptacle used in planSteps that falls below a threshold.
export function collectReceptacleWarnings(activityDefs, ownedCounts, planSteps) {
  const receptacles = detectReceptacles(activityDefs ?? {});
  if (receptacles.size === 0) return [];

  const usedEmptyIds = new Set();
  for (const step of planSteps) {
    if (!step.activityId) continue;
    for (const [emptyId, { fillActivityId }] of receptacles) {
      if (step.activityId === fillActivityId) usedEmptyIds.add(emptyId);
    }
  }

  const warnings = [];
  for (const emptyId of usedEmptyIds) {
    const { filledId } = receptacles.get(emptyId);
    const total = (ownedCounts?.[emptyId] ?? 0) + (ownedCounts?.[filledId] ?? 0);
    if (total < MIN_RECEPTACLE_COUNT) {
      warnings.push({ level: 'blocking', emptyId, filledId, total });
    } else if (total < MAX_RECEPTACLE_COUNT) {
      warnings.push({ level: 'efficiency', emptyId, filledId, total });
    }
  }

  return warnings;
}

// ── Fill step bulk/remainder splitting ─────────────────────────────────────

// Groups fill activities by filledId, finding unit (cycleSize=1) and bulk
// (cycleSize>1) variants that share the same empty→filled pair.
function findFillVariantsByFilledId(activityDefs) {
  const byEmptyId = new Map();
  for (const [activityId, def] of Object.entries(activityDefs ?? {})) {
    const changes = def.inventoryChanges ?? {};
    const entries = Object.entries(changes);
    const inputs = entries.filter(([, v]) => v < 0);
    const outputs = entries.filter(([, v]) => v > 0);
    if (inputs.length !== 1 || outputs.length !== 1) continue;
    const [emptyId, emptyChange] = inputs[0];
    const [filledId, filledChange] = outputs[0];
    if (emptyId === filledId) continue;
    if (!byEmptyId.has(emptyId)) byEmptyId.set(emptyId, { filledId, variants: [] });
    byEmptyId.get(emptyId).variants.push({ activityId, cycleSize: -emptyChange, cycleProduced: filledChange });
  }

  const result = new Map();
  for (const [, { filledId, variants }] of byEmptyId) {
    const unit = variants.find((v) => v.cycleProduced === 1) ?? null;
    const bulkCandidates = variants.filter((v) => v.cycleProduced > 1);
    if (!unit || bulkCandidates.length === 0) continue;
    const bulk = bulkCandidates.reduce((a, b) => (b.cycleProduced > a.cycleProduced ? b : a));
    result.set(filledId, { unit, bulk });
  }
  return result;
}

// When a fill step uses a bulk activity but the target is not evenly divisible
// by the bulk cycle size, split it into a bulk step (stops at the rounded-down
// multiple) followed by a unit step (stops at the exact target).
//
// Example: 502 waterBuckets → gather-water-10 stops at 500, gather-water stops at 502.
// Also upgrades exact-multiple unit fill steps to their bulk counterpart.
export function splitFillStepsForRemainder(steps, activityDefs) {
  const variantsByFilledId = findFillVariantsByFilledId(activityDefs ?? {});
  if (variantsByFilledId.size === 0) return steps;

  const result = [];
  for (const step of steps) {
    if (!step.activityId) { result.push(step); continue; }
    const info = variantsByFilledId.get(step.itemId);
    if (!info) { result.push(step); continue; }

    const { unit, bulk } = info;
    const isFillStep = step.activityId === unit.activityId || step.activityId === bulk.activityId;
    if (!isFillStep) { result.push(step); continue; }

    const { targetCount } = step;
    if (targetCount < bulk.cycleProduced) {
      result.push({ ...step, activityId: unit.activityId });
      continue;
    }

    const remainder = targetCount % bulk.cycleProduced;
    if (remainder === 0) {
      result.push({ ...step, activityId: bulk.activityId });
    } else {
      result.push({ ...step, activityId: bulk.activityId, targetCount: targetCount - remainder });
      result.push({ ...step, activityId: unit.activityId });
    }
  }
  return result;
}

// ── Receptacle batching ─────────────────────────────────────────────────────

// When the user has fewer receptacles than a plan step needs to run in one shot,
// split adjacent (fill, consume) pairs into interleaved batches so the queue
// never stalls waiting for containers that are still filled from an earlier step.
//
// Fill step goal is FIXED (non-cumulative): gather until `batchSize` filled.
// Consuming step goal is CUMULATIVE: produce until `k × batchSize` items total.
export function batchPlanForReceptacles(steps, activityDefs, ownedCounts) {
  const receptacles = detectReceptacles(activityDefs ?? {});
  if (receptacles.size === 0) return steps;

  const filledToReceptacle = new Map();
  for (const [emptyId, info] of receptacles) {
    filledToReceptacle.set(info.filledId, { emptyId, ...info });
  }

  const result = [];
  let i = 0;

  while (i < steps.length) {
    const step = steps[i];
    const rec = step.activityId ? filledToReceptacle.get(step.itemId) : null;
    const isFillStep = rec && step.activityId === rec.fillActivityId && step.sourceMode === 'craft';

    if (isFillStep && i + 1 < steps.length) {
      const nextStep = steps[i + 1];
      const { emptyId, filledId, cycleConsumed, cycleProduced } = rec;
      const nextDef = (activityDefs ?? {})[nextStep.activityId];
      const isConsumer = nextDef &&
        (nextDef.inventoryChanges?.[filledId] ?? 0) < 0 &&
        (nextDef.inventoryChanges?.[emptyId] ?? 0) > 0;

      if (isConsumer) {
        const emptyPool = Math.max(0, ownedCounts?.[emptyId] ?? 0);
        const filledPool = Math.max(0, ownedCounts?.[filledId] ?? 0);
        const batchSize = Math.max(cycleProduced, Math.floor(emptyPool / cycleConsumed) * cycleProduced);
        const totalNeeded = step.targetCount;

        // If total container pool covers the step in one shot, no batching needed.
        // After previous steps return containers, the player may have even more
        // available, but we conservatively check the initial pool here.
        if (emptyPool + filledPool < totalNeeded) {
          const numBatches = Math.ceil(totalNeeded / batchSize);
          for (let b = 0; b < numBatches; b++) {
            result.push({ ...step, targetCount: batchSize });
            result.push({ ...nextStep, targetCount: Math.min((b + 1) * batchSize, totalNeeded) });
          }
          i += 2;
          continue;
        }
      }
    }

    result.push(step);
    i++;
  }

  return result;
}

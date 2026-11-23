import {
  buildActivityIndex,
  buildRecipeIndex,
  inferActivitySkill,
} from './goal-planner.js';

function outputCount(activity, itemId) {
  return activity.outputs.find((o) => o.itemId === itemId)?.count ?? 1;
}

function isLevelAccessible(activity, playerSkillLevels) {
  if (!activity.requiredLevel || !activity.skill) return true;
  return (playerSkillLevels?.[activity.skill] ?? 1) >= activity.requiredLevel;
}

function pickBestRecipe(recipes, itemId, playerSkillLevels) {
  const withAccess = recipes.map((recipe) => ({
    recipe,
    accessible: isLevelAccessible(recipe, playerSkillLevels),
    perCycle: outputCount(recipe, itemId),
  }));
  const candidates = withAccess.some((r) => r.accessible)
    ? withAccess.filter((r) => r.accessible)
    : withAccess;
  return candidates.sort((a, b) =>
    b.perCycle - a.perCycle
      || (a.recipe.requiredLevel ?? 0) - (b.recipe.requiredLevel ?? 0)
      || a.recipe.activityId.localeCompare(b.recipe.activityId)
  )[0]?.recipe ?? null;
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

function resolveNode(itemId, quantity, { recipesByOutput, activitiesByOutput, activityDefs, ledger, playerSkillLevels, playerCombatLevel, visited }) {
  const owned = ledger.get(itemId) ?? 0;
  const needed = Math.max(0, quantity - owned);

  if (needed === 0) {
    return { itemId, quantity, owned, needed: 0, status: 'sufficient', children: [] };
  }

  if (visited.has(itemId)) {
    return { itemId, quantity, owned, needed, status: 'circular', activityId: null, skill: null, requiredLevel: null, levelBlocked: false, children: [] };
  }

  const nextVisited = new Set([...visited, itemId]);
  const ctx = { recipesByOutput, activitiesByOutput, activityDefs, ledger, playerSkillLevels, playerCombatLevel, visited: nextVisited };

  const recipes = recipesByOutput.get(itemId) ?? [];
  if (recipes.length > 0) {
    const recipe = pickBestRecipe(recipes, itemId, playerSkillLevels);
    if (recipe) {
      const perCycle = outputCount(recipe, itemId);
      const cycles = Math.ceil(needed / perCycle);
      const levelBlocked = !isLevelAccessible(recipe, playerSkillLevels);

      // Update ledger: commit to crafting the needed quantity, credit byproducts
      ledger.set(itemId, 0);
      for (const { itemId: byId, count } of recipe.outputs) {
        if (byId !== itemId) {
          ledger.set(byId, Math.max(0, (ledger.get(byId) ?? 0)) + count * cycles);
        }
      }

      const children = recipe.inputs.map(({ itemId: inputId, count }) =>
        resolveNode(inputId, count * cycles, ctx)
      );

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

  // Gatherable: activity with no inputs
  const producers = (activitiesByOutput.get(itemId) ?? []).filter(
    (a) => a.inputs.length === 0 && !a.chanceBased
  );
  if (producers.length > 0) {
    const producer = producers
      .slice()
      .sort((a, b) =>
        Number(isLevelAccessible(a, playerSkillLevels)) - Number(isLevelAccessible(b, playerSkillLevels)) === 0
          ? (a.requiredLevel ?? 0) - (b.requiredLevel ?? 0) || a.activityId.localeCompare(b.activityId)
          : Number(isLevelAccessible(b, playerSkillLevels)) - Number(isLevelAccessible(a, playerSkillLevels))
      )[0];
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

  // Combat drops
  const dropCandidates = getDropCandidates(itemId, activityDefs);
  if (dropCandidates.length > 0) {
    const accessible = dropCandidates.filter(
      (c) => playerCombatLevel !== null && playerCombatLevel >= (c.mobMinimumCombatLevel ?? 0)
    );
    if (accessible.length > 0) {
      const best = pickBestDrop(accessible, playerCombatLevel);
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

export function buildDependencyTree({ itemId, quantity, activityDefs, ownedCounts = {}, playerSkillLevels = {}, playerCombatLevel = null }) {
  const recipesByOutput = buildRecipeIndex(activityDefs);
  const activitiesByOutput = buildActivityIndex(activityDefs);
  const ledger = new Map(Object.entries(ownedCounts).map(([id, v]) => [id, Math.max(0, Number(v) || 0)]));

  return resolveNode(itemId, quantity, {
    recipesByOutput,
    activitiesByOutput,
    activityDefs,
    ledger,
    playerSkillLevels,
    playerCombatLevel,
    visited: new Set(),
  });
}

export function flattenTree(node) {
  const seen = new Map();

  function traverse(n) {
    for (const child of n.children) traverse(child);
    if (n.status === 'sufficient' || n.status === 'circular' || n.status === 'purchase-only') return;
    if (n.quantity <= 0) return;

    const existing = seen.get(n.itemId);
    if (!existing || n.quantity > existing.targetCount) {
      seen.set(n.itemId, {
        itemId: n.itemId,
        targetCount: n.quantity,
        sourceMode: n.status === 'gatherable' ? 'manual' : n.status === 'drops' ? 'drops' : 'craft',
      });
    }
  }

  traverse(node);
  return [...seen.values()];
}

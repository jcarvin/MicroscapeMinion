import { getLevelFromXp } from './xp.js';

const MAX_COUNT = Number.MAX_SAFE_INTEGER;
const MAX_CRAFT_ACTIVITY = /^(?:cook-|craft-|make-|spin-|cut-|fire-(?:pot|pie-dish)|burn-|fletch-|bury-|bones-to-bread|enchant-|telegrab-|practice-teleport|charge-|brew-|smelt-|forge-)/;

function normalizedKey(value) {
  return String(value ?? '').toLowerCase().replace(/[\s_-]/g, '');
}

function safeCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) return 0;
  return count;
}

function safeAdd(a, b) {
  if (b <= 0) return a;
  return Math.min(MAX_COUNT, a + b);
}

export function buildOwnedCounts(me) {
  const inventory = me?.inventory ?? {};
  const lootBag = me?.lootBag ?? {};
  const ids = new Set([...Object.keys(inventory), ...Object.keys(lootBag)]);
  return Object.fromEntries([...ids].map((id) => [
    id,
    Math.max(safeCount(inventory[id]), safeCount(lootBag[id])),
  ]));
}

export function inferActivitySkill(activityId) {
  if (/^cook-/.test(activityId)) return 'cooking';
  if (/^(craft-|make-|spin-|cut-|fire-(?:pot|pie-dish))/.test(activityId)) return 'crafting';
  if (/^burn-/.test(activityId)) return 'firemaking';
  if (/^catch-/.test(activityId)) return 'fishing';
  if (/^fletch-/.test(activityId)) return 'fletching';
  if (/^bury-/.test(activityId)) return 'piety';
  if (/^(bones-to-bread|enchant-|telegrab-|practice-teleport|charge-)/.test(activityId)) {
    return 'goodMagic';
  }
  if (/^brew-/.test(activityId)) return 'herblaw';
  if (/^(?:farm-|plant-|harvest-)/.test(activityId)) return 'farming';
  if (/^mine-/.test(activityId)) return 'mining';
  if (/^(smelt-|forge-)/.test(activityId)) return 'smithing';
  if (/^chop-/.test(activityId)) return 'woodcutting';
  return null;
}

export function isMaxCraftActivity(activityId, def = {}) {
  if (typeof def.maxCraftable === 'boolean') return def.maxCraftable;
  return MAX_CRAFT_ACTIVITY.test(activityId);
}

export function buildActivityIndex(activityDefs) {
  const activitiesByOutput = new Map();

  for (const [activityId, def] of Object.entries(activityDefs ?? {})) {
    const rawChanges = Object.entries(def?.inventoryChanges ?? {});
    if (rawChanges.some(([, value]) => !Number.isSafeInteger(value))) continue;
    const changes = rawChanges.filter(([, value]) => value !== 0);
    const inputs = changes
      .filter(([, value]) => value < 0)
      .map(([itemId, value]) => ({ itemId, count: -value }));
    const outputs = changes
      .filter(([, value]) => value > 0)
      .map(([itemId, value]) => ({ itemId, count: value }));
    if (outputs.length === 0) continue;

    const activity = {
      activityId,
      inputs,
      outputs,
      maxCraftable: isMaxCraftActivity(activityId, def),
      chanceBased: false,
      skill: typeof def.skill === 'string' && def.skill ? def.skill : inferActivitySkill(activityId),
      requiredLevel: Number.isSafeInteger(def.level) && def.level >= 1 ? def.level : null,
      xpPerCycle: Number.isSafeInteger(def.xpPerCycle) && def.xpPerCycle >= 0
        ? def.xpPerCycle
        : null,
    };
    for (const { itemId } of outputs) {
      const activities = activitiesByOutput.get(itemId) ?? [];
      activities.push(activity);
      activitiesByOutput.set(itemId, activities);
    }
  }

  for (const activities of activitiesByOutput.values()) {
    activities.sort((a, b) => a.activityId.localeCompare(b.activityId));
  }
  return activitiesByOutput;
}

export function buildInputActivityIndex(activityDefs) {
  const activitiesByOutput = new Map();
  for (const [itemId, activities] of buildActivityIndex(activityDefs)) {
    const consumingActivities = activities.filter(({ inputs }) => inputs.length > 0);
    if (consumingActivities.length > 0) activitiesByOutput.set(itemId, consumingActivities);
  }
  return activitiesByOutput;
}

export function buildRecipeIndex(activityDefs) {
  const recipesByOutput = new Map();
  for (const [itemId, activities] of buildInputActivityIndex(activityDefs)) {
    const recipes = activities.filter(({ maxCraftable }) => maxCraftable);
    if (recipes.length > 0) recipesByOutput.set(itemId, recipes);
  }
  return recipesByOutput;
}

export function buildChanceDropIndex(activityDefs) {
  const dropsByOutput = new Map();
  for (const [activityId, def] of Object.entries(activityDefs ?? {})) {
    for (const [itemId, quantity] of Object.entries(def?.dropItems ?? {})) {
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const activities = dropsByOutput.get(itemId) ?? [];
      activities.push({
        activityId,
        inputs: [],
        outputs: [{ itemId, count: quantity }],
        maxCraftable: false,
        chanceBased: true,
        skill: null,
        requiredLevel: null,
        xpPerCycle: null,
      });
      dropsByOutput.set(itemId, activities);
    }
  }
  for (const activities of dropsByOutput.values()) {
    activities.sort((a, b) => a.activityId.localeCompare(b.activityId));
  }
  return dropsByOutput;
}

export function getCraftableItemIds(activityDefs) {
  return new Set(buildRecipeIndex(activityDefs).keys());
}

export function getChanceDropItemIds(activityDefs) {
  return new Set(buildChanceDropIndex(activityDefs).keys());
}

export function getManualActivityItemIds(activityDefs) {
  const craftable = getCraftableItemIds(activityDefs);
  const result = new Set();
  for (const itemId of buildActivityIndex(activityDefs).keys()) {
    if (!craftable.has(itemId)) result.add(itemId);
  }
  return result;
}

export function getManualInputActivityItemIds(activityDefs) {
  const craftable = getCraftableItemIds(activityDefs);
  const result = new Set();
  for (const itemId of buildInputActivityIndex(activityDefs).keys()) {
    if (!craftable.has(itemId)) result.add(itemId);
  }
  return result;
}

function getManualInputActivityIds(activityDefs) {
  const manualItems = getManualInputActivityItemIds(activityDefs);
  const result = new Set();
  for (const [itemId, activities] of buildInputActivityIndex(activityDefs)) {
    if (!manualItems.has(itemId)) continue;
    for (const { activityId } of activities) result.add(activityId);
  }
  return result;
}

function positiveOutputIds(def) {
  return Object.entries(def?.inventoryChanges ?? {})
    .filter(([, count]) => Number.isSafeInteger(count) && count > 0)
    .map(([itemId]) => itemId)
    .sort();
}

function resolveFallbackActivity(activityId, def, fallbackDefs) {
  if (fallbackDefs?.[activityId]) return { activityId, def: fallbackDefs[activityId] };

  const prefixed = Object.entries(fallbackDefs ?? {})
    .filter(([fallbackId]) => activityId.startsWith(`${fallbackId}-`))
    .sort(([a], [b]) => b.length - a.length || a.localeCompare(b));
  if (prefixed.length > 0) {
    return { activityId: prefixed[0][0], def: prefixed[0][1] };
  }

  const outputs = positiveOutputIds(def);
  if (outputs.length === 0) return null;
  const skill = typeof def?.skill === 'string' && def.skill
    ? def.skill
    : inferActivitySkill(activityId);
  const exactOutputMatches = Object.entries(fallbackDefs ?? {}).filter(([fallbackId, fallback]) => {
    const fallbackSkill = typeof fallback?.skill === 'string' && fallback.skill
      ? fallback.skill
      : inferActivitySkill(fallbackId);
    return (!skill || fallbackSkill === skill)
      && JSON.stringify(positiveOutputIds(fallback)) === JSON.stringify(outputs);
  });
  if (exactOutputMatches.length === 1) {
    return { activityId: exactOutputMatches[0][0], def: exactOutputMatches[0][1] };
  }

  // Live variants may add incidental outputs that are absent from the bundled
  // canonical activity. A unique bundled output subset is still the same route.
  const subsetMatches = Object.entries(fallbackDefs ?? {}).filter(([fallbackId, fallback]) => {
    const fallbackOutputs = positiveOutputIds(fallback);
    if (fallbackOutputs.length === 0 || !fallbackOutputs.every((id) => outputs.includes(id))) {
      return false;
    }
    const fallbackSkill = typeof fallback?.skill === 'string' && fallback.skill
      ? fallback.skill
      : inferActivitySkill(fallbackId);
    return !skill || fallbackSkill === skill;
  });
  return subsetMatches.length === 1
    ? { activityId: subsetMatches[0][0], def: subsetMatches[0][1] }
    : null;
}

function enrichPlannerActivityDefs(activityDefs, fallbackDefs, observedActivityXp) {
  // Retain canonical bundled routes as planner fallbacks. Live definitions can
  // introduce variants, but incomplete variants must not displace a known XP
  // route for the same output.
  const result = { ...(fallbackDefs ?? {}) };
  for (const [activityId, def] of Object.entries(activityDefs ?? {})) {
    const fallbackMatch = resolveFallbackActivity(activityId, def, fallbackDefs);
    const fallback = fallbackMatch?.def;
    const observed = observedActivityXp?.[activityId]
      ?? observedActivityXp?.[fallbackMatch?.activityId];
    const fallbackSkill = typeof fallback?.skill === 'string' && fallback.skill
      ? fallback.skill
      : inferActivitySkill(fallbackMatch?.activityId ?? '');
    const hasValidLevel = Number.isSafeInteger(def?.level) && def.level >= 1;
    const hasValidXp = Number.isSafeInteger(def?.xpPerCycle) && def.xpPerCycle >= 0;
    const hasValidSkill = typeof def?.skill === 'string' && def.skill.length > 0;
    result[activityId] = fallback
      ? {
          ...def,
          ...(!hasValidLevel && Number.isSafeInteger(fallback.level) && fallback.level >= 1
            ? { level: fallback.level }
            : {}),
          ...(!hasValidXp
              && Number.isSafeInteger(observed?.xpPerCycle)
              && observed.xpPerCycle >= 0
            ? { xpPerCycle: observed.xpPerCycle }
            : !hasValidXp
                && Number.isSafeInteger(fallback.xpPerCycle)
                && fallback.xpPerCycle >= 0
              ? { xpPerCycle: fallback.xpPerCycle }
            : {}),
          ...(!hasValidSkill && (observed?.skill || fallbackSkill)
            ? { skill: observed?.skill || fallbackSkill }
            : {}),
        }
      : {
          ...def,
          ...(!hasValidXp
              && Number.isSafeInteger(observed?.xpPerCycle)
              && observed.xpPerCycle >= 0
            ? { xpPerCycle: observed.xpPerCycle }
            : {}),
          ...(!hasValidSkill && observed?.skill ? { skill: observed.skill } : {}),
        };
  }

  // Observed XP from gameplay is treated as authoritative and overwrites both
  // bundled and live-bundle values. This is intentional: the live bundle may
  // carry stale or incorrect metadata, while sampled grants are ground-truth.
  // Caveat: during bonus XP events the observed samples will undercount the
  // true base grant. There is no event-awareness mechanism today; if that
  // becomes a problem, callers can pass observedActivityXp: {} to opt out.
  for (const [activityId, observed] of Object.entries(observedActivityXp ?? {})) {
    const def = result[activityId];
    if (!def) continue;
    result[activityId] = {
      ...def,
      ...(Number.isSafeInteger(observed?.xpPerCycle) && observed.xpPerCycle >= 0
        ? { xpPerCycle: observed.xpPerCycle }
        : {}),
      ...(typeof observed?.skill === 'string' && observed.skill
        ? { skill: observed.skill }
        : {}),
    };
  }
  return result;
}

/**
 * Recover per-cycle XP metadata from the activity-scoped XP samples already
 * collected for ETA calibration. The most frequently observed positive grant
 * wins; this ignores an occasional doubled grant when two cycles arrive in one
 * server update without hard-coding any activity or item XP values.
 *
 * Assumes each activity grants XP in at most one skill. If Microscape ever
 * adds dual-skill activities the second skill would be silently dropped here
 * (the higher-observation-count skill would win and the other would vanish).
 */
export function inferObservedActivityXp(xpRateSamples) {
  const candidates = new Map();

  for (const [key, tracker] of Object.entries(xpRateSamples ?? {})) {
    const separator = key.lastIndexOf(':');
    if (separator <= 0 || separator === key.length - 1) continue;
    const activityId = key.slice(0, separator);
    const skill = key.slice(separator + 1);
    const samples = Array.isArray(tracker?.samples) ? tracker.samples : [];
    const grants = new Map();
    for (let index = 1; index < samples.length; index += 1) {
      const grant = samples[index]?.value - samples[index - 1]?.value;
      if (!Number.isSafeInteger(grant) || grant <= 0) continue;
      grants.set(grant, (grants.get(grant) ?? 0) + 1);
    }
    if (grants.size === 0) continue;

    const [xpPerCycle, observations] = [...grants.entries()].sort((a, b) =>
      b[1] - a[1] || a[0] - b[0])[0];
    const existing = candidates.get(activityId);
    if (!existing || observations > existing.observations) {
      candidates.set(activityId, { skill, xpPerCycle, observations });
    }
  }

  return Object.fromEntries([...candidates].map(([activityId, candidate]) => [
    activityId,
    { skill: candidate.skill, xpPerCycle: candidate.xpPerCycle },
  ]));
}

function resolveItemId(goal, recipesByOutput, ledger) {
  if (goal?.itemId) return goal.itemId;
  const wanted = normalizedKey(goal?.itemName);
  if (!wanted) return null;
  return [...new Set([...recipesByOutput.keys(), ...ledger.keys()])]
    .find((itemId) => normalizedKey(itemId) === wanted) ?? goal.itemName;
}

function possibleCycles(recipe, ledger) {
  return Math.min(...recipe.inputs.map(({ itemId, count }) =>
    Math.floor((ledger.get(itemId) ?? 0) / count)));
}

function outputCount(recipe, itemId) {
  return recipe.outputs.find((output) => output.itemId === itemId)?.count ?? 0;
}

function projectedLevel(activity, xpLedger, xpTable) {
  const xp = activity?.skill ? xpLedger.get(activity.skill) : null;
  if (!Number.isFinite(xp) || xp < 0 || !Array.isArray(xpTable) || xpTable.length < 3) {
    return null;
  }
  return getLevelFromXp(xp, xpTable);
}

function activityAccess(activity, xpLedger, xpTable) {
  const level = projectedLevel(activity, xpLedger, xpTable);
  return {
    level,
    feasible: activity.requiredLevel === null || level === null || level >= activity.requiredLevel,
  };
}

function evaluateRecipes(recipes, itemId, ledger, xpLedger, xpTable) {
  const evaluated = recipes.map((recipe) => {
    const cycles = possibleCycles(recipe, ledger);
    return {
      recipe,
      cycles,
      access: activityAccess(recipe, xpLedger, xpTable),
      achievableTarget: safeAdd(
        ledger.get(itemId) ?? 0,
        cycles * outputCount(recipe, itemId)
      ),
    };
  });
  const accessible = evaluated.filter(({ access }) => access.feasible);
  return (accessible.length > 0 ? accessible : evaluated)
    .sort((a, b) =>
      b.achievableTarget - a.achievableTarget
        || a.recipe.activityId.localeCompare(b.recipe.activityId))[0];
}

function selectProducer(activities, itemId, xpLedger, xpTable) {
  const evaluated = activities.map((activity) => ({
    activity,
    access: activityAccess(activity, xpLedger, xpTable),
    output: outputCount(activity, itemId),
  }));
  const accessible = evaluated.filter(({ access }) => access.feasible);
  return (accessible.length > 0 ? accessible : evaluated)
    .sort((a, b) =>
      Number(Boolean(b.activity.skill) && b.activity.xpPerCycle !== null)
          - Number(Boolean(a.activity.skill) && a.activity.xpPerCycle !== null)
        || b.output - a.output
        || (a.activity.requiredLevel ?? 0) - (b.activity.requiredLevel ?? 0)
        || a.activity.activityId.localeCompare(b.activity.activityId))[0];
}

function selectChanceProducer(activities) {
  return activities.length > 0 ? activities[0] : null;
}

function resolveSourceMode(goal, { recipes, chanceProducers, inputActivities, producers }) {
  if (goal.maxCraftable === true) {
    if (goal.sourceMode === 'manual' && inputActivities.length > 0) return 'manual';
    if (recipes.length > 0) return 'craft';
  }

  if (goal.sourceMode === 'any') return 'any';
  if (goal.sourceMode === 'manual' && producers.length > 0) return 'manual';
  if (goal.sourceMode === 'craft' && recipes.length > 0) return 'craft';
  if (goal.sourceMode === 'drops' && chanceProducers.length > 0) return 'drops';

  if (recipes.length > 0 && chanceProducers.length > 0) return 'any';
  if (recipes.length > 0) return 'craft';
  if (inputActivities.length > 0 || producers.length > 0) return 'activity';
  if (chanceProducers.length > 0) return 'drops';
  return 'planned';
}

function limitingItemIds(recipe, ledger) {
  const remainingCycles = recipe.inputs.map(({ itemId, count }) => ({
    itemId,
    cycles: Math.floor((ledger.get(itemId) ?? 0) / count),
  }));
  const minimum = Math.min(...remainingCycles.map(({ cycles }) => cycles));
  return remainingCycles
    .filter(({ cycles }) => cycles === minimum)
    .map(({ itemId }) => itemId);
}

function applyActivity(recipe, cycles, ledger) {
  if (cycles <= 0) return;
  for (const { itemId, count } of recipe.inputs) {
    ledger.set(itemId, Math.max(0, (ledger.get(itemId) ?? 0) - count * cycles));
  }
  for (const { itemId, count } of recipe.outputs) {
    ledger.set(itemId, safeAdd(ledger.get(itemId) ?? 0, count * cycles));
  }
}

function applyActivityXp(activity, cycles, xpLedger, xpTable) {
  const levelBefore = projectedLevel(activity, xpLedger, xpTable);
  if (!activity?.skill || activity.xpPerCycle === null) {
    return { levelBefore, expectedLevel: levelBefore, xpGained: 0, xpKnown: false };
  }
  if (cycles <= 0) {
    return { levelBefore, expectedLevel: levelBefore, xpGained: 0, xpKnown: true };
  }
  const xpGained = Math.min(MAX_COUNT, cycles * activity.xpPerCycle);
  const currentXp = xpLedger.get(activity.skill);
  if (Number.isFinite(currentXp) && currentXp >= 0) {
    xpLedger.set(activity.skill, safeAdd(currentXp, xpGained));
  }
  return {
    levelBefore,
    expectedLevel: projectedLevel(activity, xpLedger, xpTable),
    xpGained,
    xpKnown: true,
  };
}

export function planGoals({
  goals,
  activityDefs,
  manualInputActivityDefs = activityDefs,
  observedActivityXp = {},
  ownedCounts,
  skillXp = {},
  xpTable = [],
  ready = true,
}) {
  const plannerActivityDefs = enrichPlannerActivityDefs(
    activityDefs,
    manualInputActivityDefs,
    observedActivityXp
  );
  const activitiesByOutput = buildActivityIndex(plannerActivityDefs);
  const inputActivitiesByOutput = buildInputActivityIndex(plannerActivityDefs);
  const recipesByOutput = buildRecipeIndex(plannerActivityDefs);
  const chanceDropsByOutput = buildChanceDropIndex(plannerActivityDefs);
  const manualInputActivityIds = getManualInputActivityIds(manualInputActivityDefs);
  const knownOutputs = new Map([...activitiesByOutput, ...chanceDropsByOutput]);
  const ledger = new Map(Object.entries(ownedCounts ?? {}).map(([itemId, count]) => [
    itemId,
    safeCount(count),
  ]));
  const xpLedger = new Map(Object.entries(skillXp ?? {}).flatMap(([skill, xp]) =>
    Number.isFinite(xp) && xp >= 0 ? [[skill, xp]] : []));
  const plannedGoals = [];
  const plans = [];

  for (const goal of goals ?? []) {
    const itemId = resolveItemId(goal, knownOutputs, ledger);
    const producers = itemId ? (activitiesByOutput.get(itemId) ?? []) : [];
    const chanceProducers = itemId ? (chanceDropsByOutput.get(itemId) ?? []) : [];
    const allInputActivities = itemId ? (inputActivitiesByOutput.get(itemId) ?? []) : [];
    const recipes = itemId ? (recipesByOutput.get(itemId) ?? []) : [];
    const inputActivities = recipes.length > 0
      ? allInputActivities
      : allInputActivities.filter(({ activityId }) => {
          const fallbackActivityId = resolveFallbackActivity(
            activityId,
            plannerActivityDefs[activityId],
            manualInputActivityDefs
          )?.activityId;
          return manualInputActivityIds.has(fallbackActivityId ?? activityId);
        });
    const maxCraftable = goal.maxCraftable === true;
    const sourceMode = resolveSourceMode(goal, {
      recipes,
      chanceProducers,
      inputActivities,
      producers,
    });
    const basePlan = {
      goalId: goal.id,
      itemId,
      craftable: recipes.length > 0,
      maxCraftable,
      recipeId: null,
      feasible: true,
      achievableTarget: safeCount(goal.targetCount),
      limitingItemIds: [],
      pending: false,
      activityId: null,
      skill: null,
      requiredLevel: null,
      projectedLevelBefore: null,
      expectedLevel: null,
      xpGained: 0,
      xpKnown: false,
      chanceBased: false,
      sourceType: null,
      sourceMode,
      sourceOptions: (() => {
        const opts = ['any'];
        if (producers.length > 0 && recipes.length === 0) opts.push('manual');
        if (recipes.length > 0) opts.push('craft');
        if (chanceProducers.length > 0) opts.push('drops');
        return opts.length > 1 ? opts : [];
      })(),
      levelFeasible: true,
      materialFeasible: true,
    };

    if (goal.completed) {
      plannedGoals.push(goal);
      plans.push({ ...basePlan, feasible: false, pending: false, completed: true });
      continue;
    }

    if (!itemId) {
      plannedGoals.push(goal);
      plans.push({ ...basePlan, feasible: false });
      continue;
    }

    const current = ledger.get(itemId) ?? 0;
    if (!ready) {
      ledger.set(itemId, Math.max(current, safeCount(goal.targetCount)));
      plannedGoals.push(goal);
      plans.push({ ...basePlan, pending: true, feasible: null });
      continue;
    }

    if (sourceMode === 'any') {
      const targetCount = safeCount(goal.targetCount);
      ledger.set(itemId, Math.max(current, targetCount));
      plannedGoals.push(goal);
      plans.push({
        ...basePlan,
        feasible: true,
        achievableTarget: ledger.get(itemId) ?? current,
        sourceType: 'any',
      });
      continue;
    }

    if (sourceMode === 'drops') {
      const targetCount = safeCount(goal.targetCount);
      const activity = selectChanceProducer(chanceProducers);
      ledger.set(itemId, Math.max(current, targetCount));
      plannedGoals.push(goal);
      plans.push({
        ...basePlan,
        feasible: true,
        achievableTarget: ledger.get(itemId) ?? current,
        activityId: activity?.activityId ?? null,
        chanceBased: true,
        sourceType: 'chanceDrop',
      });
      continue;
    }

    if (sourceMode === 'manual' && inputActivities.length === 0) {
      // Pure gathering has no finite material limit. Use the producer activity
      // for XP, but only write outputs to the ledger so incidental live inputs
      // such as sigils do not constrain the goal. Prefer input-free activities
      // (genuine gathering) over activities that consume items (e.g. chest opening)
      // so that a chest yielding 8 ore doesn't displace the mining activity's XP.
      const gatherProducers = producers.filter(({ inputs }) => inputs.length === 0);
      const producerPool = gatherProducers.length > 0 ? gatherProducers : producers;
      const producer = producerPool.length > 0
        ? selectProducer(producerPool, itemId, xpLedger, xpTable)
        : null;
      const activity = producer?.activity ?? null;
      const targetCount = safeCount(goal.targetCount);
      const outputPerCycle = activity ? outputCount(activity, itemId) : 0;
      const cycles = outputPerCycle > 0 && targetCount > current
        ? Math.ceil((targetCount - current) / outputPerCycle)
        : 0;
      const levelFeasible = producer?.access.feasible ?? true;
      let xp = {
        levelBefore: producer?.access.level ?? null,
        expectedLevel: producer?.access.level ?? null,
        xpGained: 0,
        xpKnown: false,
      };
      if (levelFeasible) {
        for (const { itemId: outId, count } of (activity?.outputs ?? [])) {
          ledger.set(outId, safeAdd(ledger.get(outId) ?? 0, count * cycles));
        }
        if (activity) xp = applyActivityXp(activity, cycles, xpLedger, xpTable);
      } else {
        ledger.set(itemId, Math.max(current, targetCount));
      }
      plannedGoals.push(goal);
      plans.push({
        ...basePlan,
        feasible: levelFeasible,
        achievableTarget: targetCount,
        activityId: activity?.activityId ?? null,
        skill: activity?.skill ?? null,
        requiredLevel: activity?.requiredLevel ?? null,
        projectedLevelBefore: xp.levelBefore,
        expectedLevel: levelFeasible ? xp.expectedLevel : xp.levelBefore,
        xpGained: xp.xpGained,
        xpKnown: xp.xpKnown,
        chanceBased: false,
        sourceType: activity ? 'activity' : 'planned',
        levelFeasible,
      });
      continue;
    }

    if (inputActivities.length === 0) {
      const producer = producers.length > 0
        ? selectProducer(producers, itemId, xpLedger, xpTable)
        : null;
      const chanceActivity = producer ? null : selectChanceProducer(chanceProducers);
      const activity = producer?.activity ?? chanceActivity;
      const chanceBased = activity?.chanceBased === true;
      const targetCount = safeCount(goal.targetCount);
      const outputPerCycle = activity ? outputCount(activity, itemId) : 0;
      const cycles = !chanceBased && outputPerCycle > 0 && targetCount > current
        ? Math.ceil((targetCount - current) / outputPerCycle)
        : 0;
      const levelFeasible = producer?.access.feasible ?? true;
      let xp = {
        levelBefore: producer?.access.level ?? null,
        expectedLevel: producer?.access.level ?? null,
        xpGained: 0,
        xpKnown: false,
      };
      if (!maxCraftable && levelFeasible) {
        if (activity && !chanceBased) applyActivity(activity, cycles, ledger);
        else ledger.set(itemId, Math.max(current, targetCount));
        if (!chanceBased) xp = applyActivityXp(activity, cycles, xpLedger, xpTable);
      }
      const achievableTarget = ledger.get(itemId) ?? current;
      plannedGoals.push(goal);
      plans.push({
        ...basePlan,
        pending: maxCraftable,
        feasible: maxCraftable ? null : levelFeasible,
        achievableTarget,
        activityId: activity?.activityId ?? null,
        skill: activity?.skill ?? null,
        requiredLevel: activity?.requiredLevel ?? null,
        projectedLevelBefore: xp.levelBefore,
        expectedLevel: levelFeasible ? xp.expectedLevel : xp.levelBefore,
        xpGained: xp.xpGained,
        xpKnown: xp.xpKnown,
        chanceBased,
        sourceType: chanceBased ? 'chanceDrop' : (activity ? 'activity' : 'planned'),
        levelFeasible,
      });
      continue;
    }

    const candidateActivities = sourceMode === 'craft' ? recipes : inputActivities;
    if (candidateActivities.length === 0) {
      ledger.set(itemId, Math.max(current, safeCount(goal.targetCount)));
      plannedGoals.push(goal);
      plans.push({ ...basePlan, pending: true, feasible: null });
      continue;
    }
    const selected = evaluateRecipes(candidateActivities, itemId, ledger, xpLedger, xpTable);
    const recipe = selected.recipe;
    const outputPerCycle = outputCount(recipe, itemId);
    const limiters = limitingItemIds(recipe, ledger);
    const levelFeasible = selected.access.feasible;

    if (maxCraftable) {
      const cycles = levelFeasible ? selected.cycles : 0;
      applyActivity(recipe, cycles, ledger);
      const xp = applyActivityXp(recipe, cycles, xpLedger, xpTable);
      const targetCount = ledger.get(itemId) ?? current;
      plannedGoals.push({ ...goal, targetCount });
      plans.push({
        ...basePlan,
        recipeId: recipe.activityId,
        feasible: targetCount > 0 && levelFeasible,
        achievableTarget: targetCount,
        limitingItemIds: limiters,
        activityId: recipe.activityId,
        skill: recipe.skill,
        requiredLevel: recipe.requiredLevel,
        projectedLevelBefore: xp.levelBefore,
        expectedLevel: levelFeasible ? xp.expectedLevel : xp.levelBefore,
        xpGained: xp.xpGained,
        xpKnown: xp.xpKnown,
        sourceType: 'recipe',
        levelFeasible,
        materialFeasible: targetCount > 0,
      });
      continue;
    }

    const targetCount = safeCount(goal.targetCount);
    const requiredCycles = targetCount > current
      ? Math.ceil((targetCount - current) / outputPerCycle)
      : 0;
    const cycles = levelFeasible ? Math.min(requiredCycles, selected.cycles) : 0;
    applyActivity(recipe, cycles, ledger);
    const xp = applyActivityXp(recipe, cycles, xpLedger, xpTable);
    const achievableTarget = ledger.get(itemId) ?? current;
    const materialFeasible = selected.achievableTarget >= targetCount;
    plannedGoals.push(goal);
    plans.push({
      ...basePlan,
      recipeId: recipe.activityId,
      feasible: materialFeasible && levelFeasible,
      achievableTarget,
      limitingItemIds: materialFeasible ? [] : limiters,
      activityId: recipe.activityId,
      skill: recipe.skill,
      requiredLevel: recipe.requiredLevel,
      projectedLevelBefore: xp.levelBefore,
      expectedLevel: levelFeasible ? xp.expectedLevel : xp.levelBefore,
      xpGained: xp.xpGained,
      xpKnown: xp.xpKnown,
      sourceType: recipe.maxCraftable ? 'recipe' : 'activity',
      levelFeasible,
      materialFeasible,
    });
  }

  return {
    goals: plannedGoals,
    plans,
    ledger: Object.fromEntries(ledger),
    skillXp: Object.fromEntries(xpLedger),
  };
}

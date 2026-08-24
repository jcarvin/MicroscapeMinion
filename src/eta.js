import { state } from './state.js';
import {
  BANK_TRIGGER_ITEM_COUNT,
  BANK_TRIP_MS,
  TRAVEL_SPEED,
  BANKING_TICKS,
  TICK_MS,
} from './constants.js';
import { median } from './utils.js';
import {
  getActivityId,
  getActivitySkill,
  getActivityZone,
  isWorkActivityId,
  getEtaActivity,
} from './activity-utils.js';
import { lootBagTotal } from './inventory.js';
import { findKey } from './inventory.js';
import { runoutInfo } from './runout.js';
import {
  rateFromSamples,
  warmupRemainingMs,
  observedXpPerMs,
  observedDropItemsPerMs,
  dropRateSampleCount,
  xpRateKey,
  activeWorkMsForActivity,
} from './rate-tracker.js';
import { getLevelFromXp } from './xp.js';

// ── Cycle duration ────────────────────────────────────────────────────────────

export function cycleDurationInfo(def, actId) {
  const samples = actId ? (state.cycleCalibrations[actId]?.samples ?? []) : [];
  const calibrated = samples.length >= 1;
  const observedDurationMs = calibrated ? median(samples) : null;
  const tickBasedDurationMs = tickBasedActivityDurationMs(def);
  return {
    durationMs: calibrated
      ? Math.min(observedDurationMs, tickBasedDurationMs)
      : tickBasedDurationMs,
    observedDurationMs,
    sampleCount: samples.length,
    calibrated,
  };
}

export function cycleDurationMs(def, actId) {
  return cycleDurationInfo(def, actId).durationMs;
}

export function tickBasedActivityDurationMs(def) {
  const bundleTicks = def?.durationMs ? def.durationMs / TICK_MS : 0;
  return bundleTicks > 0
    ? Math.round(bundleTicks * state.observedTickMs)
    : (def?.durationMs ?? TICK_MS);
}

export function currentCycleProgressMs(actId, cycleMs) {
  const lastCompletionAt = state.cycleCalibrations[actId]?.lastCompletionAt;
  if (!lastCompletionAt) return 0;
  return Math.min(cycleMs, Math.max(0, Date.now() - lastCompletionAt));
}

export function effectiveTickMsForActivity(actId) {
  const def = actId ? state.ACTIVITY_DEFS[actId] : null;
  if (!def) return state.observedTickMs;
  const durationInfo = cycleDurationInfo(def, actId);
  if (!durationInfo.calibrated) return state.observedTickMs;
  const bundleTicks = def.durationMs / TICK_MS;
  return bundleTicks > 0 ? durationInfo.durationMs / bundleTicks : state.observedTickMs;
}

// ── Bank trip calculation ─────────────────────────────────────────────────────

// Computes round-trip bank time for a given zone using mapPos euclidean distance.
// Falls back to BANK_TRIP_MS if zone data hasn't been loaded from the bundle yet.
export function bankTripMs(zoneId, tickMs = TICK_MS) {
  const zonePos = zoneId ? state.ZONE_DATA[zoneId] : null;
  if (!zonePos) return BANK_TRIP_MS;

  // Find nearest bank (zones ending in -bank, plus bank-vault)
  let minDist = Infinity;
  for (const [id, pos] of Object.entries(state.ZONE_DATA)) {
    if (!id.endsWith('-bank') && id !== 'bank-vault') continue;
    const d = Math.sqrt(
      (pos[0] - zonePos[0]) ** 2 + (pos[1] - zonePos[1]) ** 2
    );
    if (d < minDist) minDist = d;
  }
  if (!isFinite(minDist)) return BANK_TRIP_MS;

  const travelTicks = Math.max(1, Math.round(minDist / TRAVEL_SPEED));
  return (2 * travelTicks + BANKING_TICKS) * tickMs;
}

export function bankTripsForGeneratedItems(generatedItems) {
  if (generatedItems <= 0) return 0;
  // During travel/banking the current trip is already in progress — treat the
  // loot bag as empty so the in-progress trip is not double-counted.
  const liveAct = state.mirroredState.me?.activity ?? null;
  const currentLootBag =
    liveAct?.type === 'banking' || liveAct?.type === 'travel'
      ? 0
      : lootBagTotal();
  return Math.floor(
    (currentLootBag + generatedItems) / BANK_TRIGGER_ITEM_COUNT
  );
}

export function bankTripsBeforeGoalComplete(generatedItems) {
  if (generatedItems <= 0) return 0;

  // During travel/banking the current trip is already in progress — treat the
  // loot bag as empty so the in-progress trip is not charged again as a future
  // trip. The real bank time is already counting down in wall-clock time.
  const liveAct = state.mirroredState.me?.activity ?? null;
  const lootBagItems =
    liveAct?.type === 'banking' || liveAct?.type === 'travel'
      ? 0
      : lootBagTotal();

  const freeSlotsBeforeFirstTrip = Math.max(
    0,
    BANK_TRIGGER_ITEM_COUNT - lootBagItems
  );
  if (generatedItems <= freeSlotsBeforeFirstTrip) return 0;

  // A trip is needed before producing anything beyond the current free space.
  // Subtract one item so a bag filled exactly by the final goal item does not
  // charge another trip after the goal is already complete.
  return (
    1 +
    Math.floor(
      (generatedItems - freeSlotsBeforeFirstTrip - 1) / BANK_TRIGGER_ITEM_COUNT
    )
  );
}

export function bankOverheadForGeneratedItems(generatedItems, zoneId, actId) {
  const bankTrips = bankTripsForGeneratedItems(generatedItems);
  return {
    bankTrips,
    bankOverheadMs: bankTrips * bankTripMs(zoneId, effectiveTickMsForActivity(actId)),
  };
}

export function bankOverheadBeforeCompletion(generatedItems, zoneId, actId) {
  const bankTrips = bankTripsBeforeGoalComplete(Math.ceil(generatedItems));
  return {
    bankTrips,
    bankOverheadMs: bankTrips * bankTripMs(zoneId, effectiveTickMsForActivity(actId)),
  };
}

// ── Produced items ────────────────────────────────────────────────────────────

// Count loot-bag slots produced per cycle, not total item quantity.
// Each distinct output item type occupies one slot regardless of quantity
// (e.g. fill-water-bucket-10 produces waterBucket:10 but takes 1 loot-bag slot).
export function producedItemsPerCycle(def) {
  if (!def?.inventoryChanges) return 0;
  return Object.values(def.inventoryChanges)
    .filter((change) => change > 0)
    .length;
}

export function estimateGeneratedItemsForActiveMs(activeMs, def, durationInfo) {
  const perCycle = producedItemsPerCycle(def);
  const durationMs = durationInfo?.durationMs ?? def?.durationMs ?? 0;
  if (activeMs <= 0 || perCycle <= 0 || durationMs <= 0) return 0;
  return Math.ceil(activeMs / durationMs) * perCycle;
}

// ── Goal ETA ──────────────────────────────────────────────────────────────────

export function computeGoalEta(
  g,
  currentCount,
  actId,
  actForEta = state.mirroredState.me?.activity ?? null,
  actIsLive = true,
  goalId = null
) {
  const remaining = g.targetCount - currentCount;
  if (remaining <= 0) return 0;

  const def = state.ACTIVITY_DEFS[actId];
  if (!def) return null;

  const dropKey = findKey(def.dropItems, g.itemName, g.itemId);
  if (dropKey) {
    const observedRate = observedDropItemsPerMs(actId, dropKey);
    const zoneId = getActivityZone(actForEta);
    const { bankTrips, bankOverheadMs } = observedRate
      ? bankOverheadBeforeCompletion(remaining, zoneId, actId)
      : { bankTrips: null, bankOverheadMs: 0 };
    return {
      chanceBased: true,
      totalMs: observedRate
        ? Math.ceil(remaining / observedRate) + bankOverheadMs
        : null,
      bankTrips,
      bankOverheadMs,
      sampleCount: dropRateSampleCount(actId, dropKey),
    };
  }

  // Find the goal item in the activity's output (positive inventoryChanges)
  const goalKey = findKey(def.inventoryChanges, g.itemName, g.itemId);
  const yieldPerCycle = goalKey ? (def.inventoryChanges[goalKey] ?? 0) : 0;
  if (yieldPerCycle <= 0) return null;

  // Rate-based: use observed accumulation rate if warmed up.
  // Banking, skill effects, and other overhead are naturally absorbed.
  const rateKey = goalId ? `${actId}:${goalId}` : actId;
  const goalSamples = state.goalRateSamples[rateKey] ?? [];
  const observedRate = rateFromSamples(goalSamples);
  if (observedRate !== null && observedRate > 0) {
    const perCycle = producedItemsPerCycle(def);
    const generatedItems =
      perCycle > 0 ? remaining * (perCycle / yieldPerCycle) : remaining;
    const zoneId = getActivityZone(actForEta);
    const { bankTrips, bankOverheadMs } = bankOverheadBeforeCompletion(
      generatedItems,
      zoneId,
      actId
    );
    return {
      totalMs: Math.ceil(remaining / observedRate) + bankOverheadMs,
      rateBased: true,
      bankTrips,
      bankOverheadMs,
      sampleCount: goalSamples.length,
    };
  }

  // Cycle-based fallback during warmup
  const durationInfo = cycleDurationInfo(def, actId);
  const cycleProgressMs = actIsLive && durationInfo.calibrated
    ? currentCycleProgressMs(actId, durationInfo.durationMs)
    : 0;
  const fallbackOverheadMs =
    actIsLive && !durationInfo.calibrated && actForEta?.preparedActivity
      ? (actForEta.remaining ?? 0) * TICK_MS
      : 0;

  // Use optimal mixed strategy when multiple activities produce the same item
  // (e.g. fill-water-bucket-1 and fill-water-bucket-10).
  const allProducers = collectGoalProducers(g.itemName, g.itemId);
  allProducers.sort((a, b) => b.yield - a.yield || a.actId.localeCompare(b.actId));

  let planGatherMs, planBankTrips;
  if (allProducers.length > 1) {
    const plan = estimateGoalPlanOptimal(remaining, allProducers);
    planGatherMs = plan.gatherMs;
    planBankTrips = plan.bankTrips;
  } else {
    const plan = estimateGoalPlan({
      remaining,
      yieldPerCycle,
      itemsGeneratedPerCycle: producedItemsPerCycle(def),
    });
    planGatherMs = plan.cyclesNeeded * durationInfo.durationMs;
    planBankTrips = plan.bankTrips;
  }

  const gatherMs = Math.max(0, fallbackOverheadMs + planGatherMs - cycleProgressMs);
  const zoneId = getActivityZone(actForEta);
  const bankOverheadMs = planBankTrips * bankTripMs(zoneId, effectiveTickMsForActivity(actId));

  return {
    totalMs: gatherMs + bankOverheadMs,
    bankTrips: planBankTrips,
    cycleDurationMs: durationInfo.durationMs,
    observedCycleDurationMs: durationInfo.observedDurationMs,
    cycleSamples: durationInfo.sampleCount,
    calibrated: durationInfo.calibrated,
  };
}

export function collectGoalProducers(itemName, itemId) {
  const result = [];
  for (const [actId, def] of Object.entries(state.ACTIVITY_DEFS ?? {})) {
    if (!def.inventoryChanges) continue;
    const key = findKey(def.inventoryChanges, itemName, itemId);
    const yield_ = key ? (def.inventoryChanges[key] ?? 0) : 0;
    if (yield_ > 0) result.push({ actId, def, yield: yield_ });
  }
  return result;
}

// Greedy mixed-batch strategy: use the largest-yield activity as many times as
// possible, then the next-largest for the remainder, and so on.
function estimateGoalPlanOptimal(remaining, producers) {
  let rem = remaining;
  let gatherMs = 0;
  let totalItemsGenerated = 0;

  for (let i = 0; i < producers.length; i++) {
    const { actId, def, yield: y } = producers[i];
    const isLast = i === producers.length - 1;
    const cycles = isLast ? Math.ceil(rem / y) : Math.floor(rem / y);
    if (cycles <= 0) continue;
    gatherMs += cycles * cycleDurationMs(def, actId);
    totalItemsGenerated += cycles * producedItemsPerCycle(def);
    rem -= cycles * y;
    if (rem <= 0) break;
  }

  const bankTrips = bankTripsBeforeGoalComplete(totalItemsGenerated);
  return { gatherMs, bankTrips };
}

function estimateGoalPlan({ remaining, yieldPerCycle, itemsGeneratedPerCycle }) {
  const cyclesNeeded = Math.ceil(remaining / yieldPerCycle);
  const generatedItems = cyclesNeeded * itemsGeneratedPerCycle;
  const bankTrips = bankTripsBeforeGoalComplete(generatedItems);
  return { cyclesNeeded, bankTrips };
}

// ── Skill level ETA ───────────────────────────────────────────────────────────

export function computeSkillLevelEtas(actId, skill, act) {
  const def = state.ACTIVITY_DEFS[actId];
  const xpPerCycle = def?.xpPerCycle ?? 0;
  const xpSamples = state.xpRateSamples[xpRateKey(actId, skill)]?.samples ?? [];
  const observedRate = observedXpPerMs(actId, skill);
  const mayGainXp = xpPerCycle > 0 || observedRate || isCombatActivity(act);
  if (!mayGainXp || state.XP_TABLE.length < 3) return null;
  const durationInfo = def ? cycleDurationInfo(def, actId) : null;
  const zoneId = getActivityZone(act);

  const currentXp = state.mirroredState.me?.exp?.[skill];
  if (typeof currentXp !== 'number' || !isFinite(currentXp)) return null;

  const currentLevel = getLevelFromXp(currentXp, state.XP_TABLE);
  const etas = [];
  for (let offset = 1; offset <= 10; offset++) {
    const targetLevel = currentLevel + offset;
    const targetXp = state.XP_TABLE[targetLevel];
    if (typeof targetXp !== 'number') break;

    const xpNeeded = Math.max(0, targetXp - currentXp);
    let etaMs = null;
    let bankTrips = 0;
    let bankOverheadMs = 0;
    if (observedRate) {
      const activeMs = Math.ceil(xpNeeded / observedRate);
      const generatedItems = estimateGeneratedItemsForActiveMs(activeMs, def, durationInfo);
      const overhead = bankOverheadBeforeCompletion(generatedItems, zoneId, actId);
      bankTrips = overhead.bankTrips;
      bankOverheadMs = overhead.bankOverheadMs;
      etaMs = activeMs + bankOverheadMs;
    } else if (xpPerCycle > 0 && durationInfo) {
      const cyclesNeeded = Math.ceil(xpNeeded / xpPerCycle);
      const activeMs = cyclesNeeded * durationInfo.durationMs;
      const overhead = bankOverheadBeforeCompletion(
        cyclesNeeded * producedItemsPerCycle(def),
        zoneId,
        actId
      );
      bankTrips = overhead.bankTrips;
      bankOverheadMs = overhead.bankOverheadMs;
      etaMs = activeMs + bankOverheadMs;
    }
    etas.push({
      targetLevel,
      xpNeeded,
      etaMs,
      bankTrips,
      bankOverheadMs,
      warmupRemainingMs: observedRate ? 0 : warmupRemainingMs(xpSamples),
    });
  }

  if (etas.length === 0) return null;
  return {
    skill,
    currentXp,
    currentLevel,
    xpPerCycle,
    observedXpPerMs: observedRate,
    etas,
  };
}

// ── ETA snapshot (for tick log and debug entries) ─────────────────────────────

export function snapshotEta() {
  const me = state.mirroredState.me;
  const liveAct = me?.activity ?? null;
  const etaAct = getEtaActivity(liveAct);
  const actId = getActivityId(etaAct);
  const liveActId = getActivityId(liveAct);
  const etaActIsLive = isWorkActivityId(liveActId);
  const phase =
    liveAct?.type === 'travel'
      ? 'travel'
      : liveAct?.type === 'banking'
        ? 'banking'
        : liveAct?.preparedActivity
          ? 'overhead'
          : actId
            ? 'active'
            : null;
  const def = actId ? state.ACTIVITY_DEFS[actId] : null;
  const info = def && actId ? runoutInfo(actId) : null;
  const durationInfo = def ? cycleDurationInfo(def, actId) : null;
  const cycleDurMs = durationInfo?.durationMs ?? null;
  const cycleProgressMs = etaActIsLive && durationInfo?.calibrated
    ? currentCycleProgressMs(actId, cycleDurMs)
    : 0;
  const fallbackOverheadMs =
    etaActIsLive && !durationInfo?.calibrated && liveAct?.preparedActivity
      ? (liveAct.remaining ?? 0) * TICK_MS
      : 0;
  const itemsGenerated =
    info && def ? info.cyclesLeft * producedItemsPerCycle(def) : 0;
  const zoneId = getActivityZone(etaAct);
  const { bankTrips, bankOverheadMs } = bankOverheadForGeneratedItems(
    itemsGenerated,
    zoneId,
    actId
  );
  const runoutSamples = actId && info
    ? (state.runoutRateSamples[`${actId}:${info.itemId}`] ?? [])
    : [];
  const runoutRate = (() => {
    const r = rateFromSamples(runoutSamples);
    return r !== null && r < 0 ? -r : null;
  })();
  const etaMs =
    info && cycleDurMs != null
      ? runoutRate
        ? Math.max(0, Math.round(info.totalMaterial / runoutRate) + bankOverheadMs)
        : Math.max(
            0,
            fallbackOverheadMs +
              info.cyclesLeft * cycleDurMs -
              cycleProgressMs +
              bankOverheadMs
          )
      : null;
  const firstGoal = state.goals[0] ?? null;
  const goalEta =
    firstGoal && actId
      ? computeGoalEta(
          firstGoal,
          state.goalHighWaterMark[firstGoal.id] ?? getGoalCount(firstGoal.itemName, firstGoal.itemId) ?? 0,
          actId,
          etaAct,
          etaActIsLive,
          firstGoal.id
        )
      : null;
  return {
    phase,
    etaMs,
    cyclesLeft: info?.cyclesLeft ?? null,
    itemsGenerated,
    bankTrips,
    bankOverheadMs,
    cycleDurMs,
    observedCycleDurMs: durationInfo?.observedDurationMs ?? null,
    cycleProgressMs,
    cycleSamples: durationInfo?.sampleCount ?? 0,
    calibrated: durationInfo?.calibrated ?? false,
    defDurMs: def?.durationMs ?? null,
    rawDuration: def ? def.durationMs / TICK_MS - 6 : null,
    overheadTicks: state.observedOverheadTicks,
    lootBagItems: lootBagTotal(),
    bankTriggerItemCount: BANK_TRIGGER_ITEM_COUNT,
    actRemaining: liveAct?.remaining ?? null,
    actLength: liveAct?.length ?? null,
    observedTickMs: state.observedTickMs,
    goalEtaMs: goalEta?.totalMs ?? null,
    goalBankTrips: goalEta?.bankTrips ?? null,
    goalRateBased: goalEta?.rateBased === true,
    goalSamples: goalEta?.sampleCount ?? null,
    goalBankOverheadMs: goalEta?.bankOverheadMs ?? null,
    runoutRateBased: runoutRate !== null,
    runoutSamples: runoutSamples.length,
  };
}

// ── Helpers used internally ───────────────────────────────────────────────────

function isCombatActivity(act) {
  if (!act || act.type === 'travel' || act.type === 'banking') return false;
  return !!(act.mob ?? act.preparedActivity?.mob);
}

function getGoalCount(itemName, itemId) {
  const me = state.mirroredState.me;
  const inv = me?.inventory ?? {};
  const lb = me?.lootBag ?? {};

  const norm = (s) => s?.toLowerCase().replace(/[\s_-]/g, '') ?? '';
  const findIn = (obj, name, id) => {
    if (id && id in obj) return obj[id];
    if (name) {
      const n = norm(name);
      const key = Object.keys(obj).find((k) => norm(k) === n);
      if (key) return obj[key];
    }
    return null;
  };

  const invCount = findIn(inv, itemName, itemId);
  const lbCount = findIn(lb, itemName, itemId);
  if (invCount === null && lbCount === null) return null;
  return Math.max(invCount ?? 0, lbCount ?? 0);
}

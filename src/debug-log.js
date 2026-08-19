import { state } from './state.js';
import { ETA_DEBUG_LOG_LIMIT } from './constants.js';
import {
  getActivityId,
  getActivitySkill,
  getActivityZone,
  getEtaActivity,
  compactActivity,
} from './activity-utils.js';
import { findKey, getGoalCount, getGoalCountForMe } from './inventory.js';
import {
  xpRateKey,
  rateFromSamples,
  activeWorkMsForActivity,
} from './rate-tracker.js';
import {
  cycleDurationInfo,
  producedItemsPerCycle,
  bankOverheadForGeneratedItems,
  bankTripMs,
  effectiveTickMsForActivity,
  computeGoalEta,
} from './eta.js';
import { runoutInfo } from './runout.js';

export function pushTickEntry(pre, post) {
  const deltaMs =
    pre?.etaMs != null && post.etaMs != null ? post.etaMs - pre.etaMs : null;
  state.tickLog.unshift({
    at: Date.now(),
    type: 'tick',
    pre: pre?.etaMs ?? null,
    ...post,
    deltaMs,
  });
  if (state.tickLog.length > 40) state.tickLog.pop();
}

export function pushTickEvent(type) {
  state.tickLog.unshift({ at: Date.now(), type });
  if (state.tickLog.length > 40) state.tickLog.pop();
}

export function safelyPushEtaDebugEntry(args) {
  try {
    pushEtaDebugEntry(args);
  } catch (error) {
    state.etaDebugLog.unshift({
      at: args.now,
      error: 'eta-debug-log-failed',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      phase: args.postSnap?.phase ?? null,
      transition: {
        prevActivityId: getActivityId(args.prevAct),
        newActivityId: getActivityId(args.newAct),
      },
    });
    if (state.etaDebugLog.length > ETA_DEBUG_LOG_LIMIT) state.etaDebugLog.pop();
  }
}

function pushEtaDebugEntry({ preSnap, postSnap, prevAct, newAct, prevMe, newMe, now }) {
  const liveAct = newMe?.activity ?? null;
  const etaAct = getEtaActivity(liveAct);
  const actId = getActivityId(etaAct);
  const liveActId = getActivityId(liveAct);
  const skill = getActivitySkill(etaAct);
  const def = actId ? state.ACTIVITY_DEFS[actId] : null;
  const durationInfo = def ? cycleDurationInfo(def, actId) : null;
  const zoneId = getActivityZone(etaAct);
  const info = actId ? runoutInfo(actId) : null;
  const producedPerCycle = producedItemsPerCycle(def);
  const itemsGenerated = info && def ? info.cyclesLeft * producedPerCycle : null;
  const generatedBank = itemsGenerated != null
    ? bankOverheadForGeneratedItems(itemsGenerated, zoneId, actId)
    : null;

  const goal = state.goals[0] ?? null;
  const goalCount = goal ? (getGoalCount(goal.itemName, goal.itemId) ?? 0) : null;
  const prevGoalCount = goal ? getGoalCountForMe(prevMe, goal) : null;
  const newGoalCount = goal ? getGoalCountForMe(newMe, goal) : null;
  const effectiveGoalCount = goal ? (state.goalHighWaterMark[goal.id] ?? goalCount ?? 0) : null;
  const goalEta = goal && actId
    ? computeGoalEta(goal, effectiveGoalCount ?? 0, actId, etaAct, etaAct === liveAct, goal.id)
    : null;
  const goalSampleInfo = goal && actId && def
    ? goalRateDebugInfo(goal, def, actId)
    : null;

  const runoutKey = info && actId ? `${actId}:${info.itemId}` : null;
  const runoutSamples = runoutKey ? (state.runoutRateSamples[runoutKey] ?? []) : [];
  const xpKeyForDebug = actId && skill ? xpRateKey(actId, skill) : null;
  const xpSamples = xpKeyForDebug ? (state.xpRateSamples[xpKeyForDebug]?.samples ?? []) : [];

  const resetSignals = [];
  if (prevGoalCount != null && newGoalCount != null && newGoalCount < prevGoalCount) {
    resetSignals.push('goal-count-drop');
  }
  if (info?.itemId) {
    const prevRunoutCount = prevMe?.inventory?.[info.itemId] ?? null;
    const newRunoutCount = newMe?.inventory?.[info.itemId] ?? null;
    if (prevRunoutCount != null && newRunoutCount != null && newRunoutCount > prevRunoutCount) {
      resetSignals.push('runout-refill');
    }
  }
  if (getActivityId(prevAct) !== getActivityId(newAct)) resetSignals.push('activity-change');
  if (liveAct?.type === 'travel') resetSignals.push('travel');
  if (liveAct?.type === 'banking') resetSignals.push('banking');

  state.etaDebugLog.unshift({
    at: now,
    phase: postSnap.phase,
    transition: {
      prevActivityId: getActivityId(prevAct),
      newActivityId: getActivityId(newAct),
      liveActivityId: liveActId,
      etaActivityId: actId,
      prevType: prevAct?.type ?? null,
      newType: newAct?.type ?? null,
    },
    activity: {
      live: compactActivity(liveAct),
      eta: compactActivity(etaAct),
      lastWork: compactActivity(state.lastWorkActivity),
    },
    tick: {
      observedTickMs: state.observedTickMs,
      sampleCount: state.tickSamples.length,
      lastDeltaMs: state.tickSamples[state.tickSamples.length - 1] ?? null,
      activeWorkMs: actId ? activeWorkMsForActivity(actId) : null,
    },
    cycle: {
      durationMs: durationInfo?.durationMs ?? null,
      observedDurationMs: durationInfo?.observedDurationMs ?? null,
      sampleCount: durationInfo?.sampleCount ?? 0,
      calibrated: durationInfo?.calibrated ?? false,
      progressMs: postSnap.cycleProgressMs ?? null,
      fallbackOverheadMs:
        !durationInfo?.calibrated && liveAct?.preparedActivity
          ? (liveAct.remaining ?? 0) * 2000
          : 0,
    },
    bank: {
      zoneId,
      lootBagItems: postSnap.lootBagItems,
      triggerItemCount: postSnap.bankTriggerItemCount,
      producedPerCycle,
      projectedGeneratedItems: itemsGenerated,
      projectedTrips: generatedBank?.bankTrips ?? null,
      projectedOverheadMs: generatedBank?.bankOverheadMs ?? null,
      tripMs: actId ? bankTripMs(zoneId, effectiveTickMsForActivity(actId)) : null,
      bankingPhaseActive: liveAct?.type === 'banking' || liveAct?.type === 'travel',
    },
    runout: info ? {
      itemId: info.itemId,
      costPerCycle: info.costPerCycle,
      totalMaterial: info.totalMaterial,
      prevInventoryCount: prevMe?.inventory?.[info.itemId] ?? null,
      newInventoryCount: newMe?.inventory?.[info.itemId] ?? null,
      cyclesLeft: info.cyclesLeft,
      etaMs: postSnap.etaMs,
      preEtaMs: preSnap?.etaMs ?? null,
      deltaMs:
        preSnap?.etaMs != null && postSnap.etaMs != null
          ? postSnap.etaMs - preSnap.etaMs
          : null,
      rateBased: postSnap.runoutRateBased,
      samples: rateSampleDebug(runoutSamples),
      bankTrips: postSnap.bankTrips,
      bankOverheadMs: postSnap.bankOverheadMs,
    } : null,
    goal: goal ? {
      itemName: goal.itemName,
      itemId: goal.itemId,
      targetCount: goal.targetCount,
      currentCount: goalCount,
      prevCount: prevGoalCount,
      newCount: newGoalCount,
      remaining: Math.max(0, goal.targetCount - (effectiveGoalCount ?? goalCount ?? 0)),
      etaMs: goalEta === 0 ? 0 : (goalEta?.totalMs ?? null),
      preEtaMs: preSnap?.goalEtaMs ?? null,
      deltaMs:
        preSnap?.goalEtaMs != null && goalEta?.totalMs != null
          ? goalEta.totalMs - preSnap.goalEtaMs
          : null,
      model: goalEtaModel(goalEta),
      chanceBased: goalEta?.chanceBased === true,
      rateBased: goalEta?.rateBased === true,
      bankTrips: goalEta?.bankTrips ?? null,
      bankOverheadMs: goalEta?.bankOverheadMs ?? null,
      samples: goalSampleInfo,
    } : null,
    xp: skill ? {
      skill,
      currentXp: newMe?.exp?.[skill] ?? null,
      prevXp: prevMe?.exp?.[skill] ?? null,
      xpDelta:
        typeof newMe?.exp?.[skill] === 'number' && typeof prevMe?.exp?.[skill] === 'number'
          ? newMe.exp[skill] - prevMe.exp[skill]
          : null,
      xpPerCycle: def?.xpPerCycle ?? null,
      observedXpPerMs: actId ? observedXpPerMs(actId, skill) : null,
      samples: rateSampleDebug(xpSamples),
    } : null,
    resetSignals,
  });

  if (state.etaDebugLog.length > ETA_DEBUG_LOG_LIMIT) state.etaDebugLog.pop();
}

export function rateSampleDebug(samples) {
  const oldest = samples[0] ?? null;
  const newest = samples[samples.length - 1] ?? null;
  const rate = rateFromSamples(samples);
  return {
    count: samples.length,
    ratePerMs: rate,
    ratePerMinute: rate != null ? rate * 60_000 : null,
    ratePerHour: rate != null ? rate * 3_600_000 : null,
    wallSpanMs: oldest && newest ? newest.at - oldest.at : null,
    workSpanMs: oldest && newest ? newest.workMs - oldest.workMs : null,
    oldest,
    newest,
  };
}

function goalRateDebugInfo(g, def, actId) {
  const dropKey = findKey(def.dropItems, g.itemName, g.itemId);
  if (dropKey) {
    return {
      source: 'dropItems',
      key: dropKey,
      ...rateSampleDebug(state.dropRateSamples[`${actId}:${dropKey}`]?.samples ?? []),
    };
  }

  const goalKey = findKey(def.inventoryChanges, g.itemName, g.itemId);
  return {
    source: goalKey ? 'inventoryChanges' : 'none',
    key: goalKey,
    yieldPerCycle: goalKey ? (def.inventoryChanges[goalKey] ?? 0) : null,
    producedPerCycle: producedItemsPerCycle(def),
    ...rateSampleDebug(state.goalRateSamples[`${actId}:${g.id}`] ?? []),
  };
}

export function goalEtaModel(eta) {
  if (eta === 0) return 'done';
  if (!eta || eta.totalMs == null) return 'calibrating';
  if (eta.chanceBased) return 'chance-rate';
  if (eta.rateBased) return 'rate';
  return 'cycle-fallback';
}

function observedXpPerMs(actId, skill) {
  const samples = state.xpRateSamples[xpRateKey(actId, skill)]?.samples ?? [];
  const rate = rateFromSamples(samples);
  return rate !== null && rate > 0 ? rate : null;
}

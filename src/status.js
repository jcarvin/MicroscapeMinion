import { state } from './state.js';
import { ETA_DEBUG_LOG_VERSION } from './constants.js';
import {
  getActivityId,
  getActivitySkill,
  getActivityZone,
  getEtaActivity,
  isCombatActivity,
} from './activity-utils.js';
import { getMaterialCount, getGoalCount, findKey } from './inventory.js';
import { runoutInfo } from './runout.js';
import { TICK_MS } from './constants.js';
import {
  cycleDurationInfo,
  currentCycleProgressMs,
  bankOverheadForGeneratedItems,
  producedItemsPerCycle,
  computeGoalEta,
  computeSkillLevelEtas,
} from './eta.js';
import {
  rateFromSamples,
  warmupRemainingMs,
  computeCombatConsumableStatus,
} from './rate-tracker.js';

export function buildStatus() {
  const now = Date.now();
  const me = state.mirroredState.me;
  const liveAct = me?.activity ?? null;
  const etaAct = getEtaActivity(liveAct);
  const etaActIsLive = etaAct === liveAct;

  const liveActSkill = getActivitySkill(liveAct);
  const liveActId = getActivityId(liveAct);
  const etaActSkill = getActivitySkill(etaAct);
  const etaActId = getActivityId(etaAct);
  const actDisplay =
    liveActId === 'travel'
      ? 'Traveling'
      : liveActId === 'banking'
        ? 'Banking'
        : liveActSkill && liveActId
          ? `${liveActSkill} — ${liveActId}`
          : (liveActId ?? liveActSkill ?? null);

  const activityDef = etaActId ? state.ACTIVITY_DEFS[etaActId] : null;
  const goalStatuses = state.goals.map((goal) => {
    const count = getGoalCount(goal.itemName, goal.itemId) ?? 0;
    const effectiveCount = state.goalHighWaterMark[goal.id] ?? count;
    const inventoryKey = findKey(activityDef?.inventoryChanges, goal.itemName, goal.itemId);
    const dropKey = findKey(activityDef?.dropItems, goal.itemName, goal.itemId);
    const relatedToActivity =
      (inventoryKey && activityDef.inventoryChanges[inventoryKey] > 0) || Boolean(dropKey);
    const eta = etaActId && relatedToActivity
      ? computeGoalEta(goal, effectiveCount, etaActId, etaAct, etaActIsLive, goal.id)
      : null;
    const isChanceBased = eta?.chanceBased === true;
    const isRateBased = eta?.rateBased === true;
    const goalSamples = etaActId
      ? (state.goalRateSamples[`${etaActId}:${goal.id}`] ?? [])
      : [];
    return {
      goal,
      count,
      eta,
      relatedToActivity,
      chanceBased: isChanceBased,
      warmupRemainingMs: !isChanceBased && !isRateBased && eta && eta !== 0
        ? warmupRemainingMs(goalSamples, now)
        : 0,
    };
  });

  let runoutStatus = null;
  if (etaActId) {
    const info = runoutInfo(etaActId);
    if (info) {
      const def = state.ACTIVITY_DEFS[etaActId];
      const durationInfo = cycleDurationInfo(def, etaActId);
      const zoneId = getActivityZone(etaAct);

      // Rate-based runout ETA: observed consumption rate naturally accounts for
      // bank trips and other pauses. Falls back to cycle-based during warmup.
      const runoutKey = `${etaActId}:${info.itemId}`;
      const runoutSamples = state.runoutRateSamples[runoutKey] ?? [];
      const consumptionRate = (() => {
        const r = rateFromSamples(runoutSamples);
        return r !== null && r < 0 ? -r : null;
      })();

      const itemsGenerated = info.cyclesLeft * producedItemsPerCycle(def);
      const { bankTrips, bankOverheadMs } = bankOverheadForGeneratedItems(
        itemsGenerated,
        zoneId,
        etaActId
      );

      let etaMs;
      if (consumptionRate !== null) {
        const activeEtaMs = Math.round(info.totalMaterial / consumptionRate);
        etaMs = Math.max(0, activeEtaMs + bankOverheadMs);
      } else {
        const cycleProgressMs = etaActIsLive && durationInfo.calibrated
          ? currentCycleProgressMs(etaActId, durationInfo.durationMs)
          : 0;
        const fallbackOverheadMs =
          etaActIsLive && !durationInfo.calibrated && liveAct?.preparedActivity
            ? (liveAct.remaining ?? 0) * TICK_MS
            : 0;
        etaMs = Math.max(
          0,
          fallbackOverheadMs +
            info.cyclesLeft * durationInfo.durationMs -
            cycleProgressMs +
            bankOverheadMs
        );
      }

      runoutStatus = {
        itemId: info.itemId,
        costPerCycle: info.costPerCycle,
        totalMaterial: info.totalMaterial,
        cyclesLeft: info.cyclesLeft,
        itemsGenerated,
        bankTrips,
        bankOverheadMs,
        cycleDurationMs: durationInfo.durationMs,
        observedCycleDurationMs: durationInfo.observedDurationMs,
        rateBased: consumptionRate !== null,
        warmupRemainingMs: consumptionRate !== null ? 0 : warmupRemainingMs(runoutSamples, now),
        runoutSampleCount: runoutSamples.length,
        cycleSamples: durationInfo.sampleCount,
        calibrated: durationInfo.calibrated,
        etaMs,
      };
    }
  }

  const skillLevelStatus =
    etaActId && etaActSkill
      ? computeSkillLevelEtas(etaActId, etaActSkill, etaAct)
      : null;

  const combatConsumables =
    etaAct && isCombatActivity(etaAct) ? computeCombatConsumableStatus(etaAct) : null;

  const relatedItemIds = new Set();
  for (const [id, change] of Object.entries(activityDef?.inventoryChanges ?? {})) {
    if (change > 0) relatedItemIds.add(id);
  }
  for (const id of Object.keys(activityDef?.dropItems ?? {})) relatedItemIds.add(id);

  // Definitions provide the known game catalog; live state and saved goals cover
  // newly introduced or otherwise unknown items until their definitions arrive.
  const itemNames = new Map();
  for (const def of Object.values(state.ACTIVITY_DEFS)) {
    for (const id of Object.keys(def.inventoryChanges ?? {})) itemNames.set(id, id);
    for (const id of Object.keys(def.dropItems ?? {})) itemNames.set(id, id);
  }
  for (const id of Object.keys(me?.inventory ?? {})) itemNames.set(id, id);
  for (const id of Object.keys(me?.lootBag ?? {})) itemNames.set(id, id);
  for (const goal of state.goals) {
    itemNames.set(goal.itemId ?? goal.itemName, goal.itemName);
  }

  const goalItems = [...itemNames].map(([id, name]) => ({
    id,
    name,
    count: goalStatuses.find(({ goal }) => (goal.itemId ?? goal.itemName) === id)?.count
      ?? getMaterialCount(id),
    relatedToActivity: relatedItemIds.has(id),
  }));
  goalItems.sort((a, b) =>
    Number(b.relatedToActivity) - Number(a.relatedToActivity)
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  return {
    connected: state.microscopeTabId !== null,
    activity: actDisplay,
    idle: liveAct === null && state.prevActivityId !== undefined,
    tickMs: state.observedTickMs,
    goalsLoaded: state.goalsLoaded,
    goalStatuses,
    runoutStatus,
    skillLevelStatus,
    combatConsumables,
    goalItems,
    skillNotifyTarget: state.skillNotifyTarget,
    rawMe: me ?? null,
    tickLog: state.tickLog,
    etaDebugLogVersion: ETA_DEBUG_LOG_VERSION,
    etaDebugLog: state.etaDebugLog,
  };
}

import { state } from './state.js';
import { ETA_DEBUG_LOG_VERSION } from './constants.js';
import {
  getActivityId,
  getActivitySkill,
  getActivityZone,
  getEtaActivity,
  isCombatActivity,
} from './activity-utils.js';
import { getMaterialCount, getGoalCount } from './inventory.js';
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

  let goalStatus = null;
  if (state.goal) {
    const count = getGoalCount(state.goal.itemName, state.goal.itemId) ?? 0;
    const effectiveCount = state.goalHighWaterMark ?? count;
    const eta = etaActId
      ? computeGoalEta(state.goal, effectiveCount, etaActId, etaAct, etaActIsLive)
      : null;
    const isChanceBased = eta?.chanceBased === true;
    const isRateBased = eta?.rateBased === true;
    const goalSamples = etaActId ? (state.goalRateSamples[etaActId] ?? []) : [];
    goalStatus = {
      goal: state.goal,
      count,
      eta,
      chanceBased: isChanceBased,
      warmupRemainingMs: !isChanceBased && !isRateBased && eta && eta !== 0
        ? warmupRemainingMs(goalSamples, now)
        : 0,
    };
  }

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

  // Items the current activity produces — drives the goal dropdown
  const producibleItems = [];
  if (etaActId && state.ACTIVITY_DEFS[etaActId]) {
    for (const [id, change] of Object.entries(
      state.ACTIVITY_DEFS[etaActId].inventoryChanges ?? {}
    )) {
      if (change > 0) producibleItems.push({ id, count: getMaterialCount(id) });
    }
    for (const id of Object.keys(state.ACTIVITY_DEFS[etaActId].dropItems ?? {})) {
      if (!producibleItems.some((item) => item.id === id)) {
        producibleItems.push({ id, count: getMaterialCount(id), chanceBased: true });
      }
    }
  }

  return {
    connected: state.microscopeTabId !== null,
    activity: actDisplay,
    idle: liveAct === null && state.prevActivityId !== undefined,
    tickMs: state.observedTickMs,
    goalStatus,
    runoutStatus,
    skillLevelStatus,
    combatConsumables,
    producibleItems,
    skillNotifyTarget: state.skillNotifyTarget,
    rawMe: me ?? null,
    tickLog: state.tickLog,
    etaDebugLogVersion: ETA_DEBUG_LOG_VERSION,
    etaDebugLog: state.etaDebugLog,
  };
}

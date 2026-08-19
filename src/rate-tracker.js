// Rate tracking for XP, drops, combat consumables, goals, and runout materials.
//
// All trackers store { value, at, workMs } samples: cumulative value at a
// wall-clock timestamp and cumulative active work time for the activity. Rate =
// (newest.value - oldest.value) / (newest.workMs - oldest.workMs).
// Samples are pushed only when the value changes in the expected direction
// (up for accumulation, down for consumption). Banking/travel time is forecast
// separately so the ETA includes bank trips before they happen and does not
// absorb a whole bank trip as a delayed rate spike on the next grant.
//
// A 5-minute gap with no new samples resets the window; the rate clock restarts
// from the current reading to avoid counting idle time in the denominator.

import { state } from './state.js';
import { RATE_WARMUP_MS, GAP_RESET_MS, RATE_SAMPLE_LIMIT } from './constants.js';
import { getActivityId, getActivitySkill, isCombatActivity, isWorkActivityId } from './activity-utils.js';
import { scheduleEtaCalibrationSave } from './calibration.js';

export function rateFromSamples(samples) {
  if (samples.length < 2) return null;
  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const wallElapsed = newest.at - oldest.at;
  if (wallElapsed < RATE_WARMUP_MS) return null;
  const elapsed = newest.workMs - oldest.workMs;
  if (elapsed <= 0) return null;
  const delta = newest.value - oldest.value;
  if (delta === 0) return null;
  return delta / elapsed; // positive for accumulation, negative for consumption
}

export function warmupRemainingMs(samples, now = Date.now()) {
  if (samples.length === 0) return RATE_WARMUP_MS;
  const oldest = samples[0];
  return Math.max(0, RATE_WARMUP_MS - (now - oldest.at));
}

export function pushRateSample(samples, value, now, workMs) {
  const last = samples[samples.length - 1];
  if (last && now - last.at > GAP_RESET_MS) {
    // Long idle gap — discard stale window and seed fresh
    samples.length = 0;
    samples.push({ value, at: now, workMs });
    return;
  }
  samples.push({ value, at: now, workMs });
  if (samples.length > RATE_SAMPLE_LIMIT) samples.shift();
}

export function advanceActiveRateClock(prevAct, now) {
  if (state.lastRateClockAt !== null) {
    const delta = now - state.lastRateClockAt;
    const actId = getActivityId(prevAct);
    if (isWorkActivityId(actId) && delta > 0 && delta <= GAP_RESET_MS) {
      state.activeRateClocks[actId] = (state.activeRateClocks[actId] ?? 0) + delta;
    }
  }
  state.lastRateClockAt = now;
}

export function activeWorkMsForActivity(actId) {
  return state.activeRateClocks[actId] ?? 0;
}

export function xpRateKey(actId, skill) {
  return `${actId}:${skill}`;
}

export function dropRateKey(actId, itemId) {
  return `${actId}:${itemId}`;
}

export function observedXpPerMs(actId, skill) {
  const samples = state.xpRateSamples[xpRateKey(actId, skill)]?.samples ?? [];
  const rate = rateFromSamples(samples);
  return rate !== null && rate > 0 ? rate : null;
}

export function observedDropItemsPerMs(actId, itemId) {
  const samples = state.dropRateSamples[dropRateKey(actId, itemId)]?.samples ?? [];
  const rate = rateFromSamples(samples);
  return rate !== null && rate > 0 ? rate : null;
}

export function dropRateSampleCount(actId, itemId) {
  return state.dropRateSamples[dropRateKey(actId, itemId)]?.samples.length ?? 0;
}

export function trackXpGain(prevAct, newAct, prevExp, newExp) {
  if (!prevExp || !newExp) return;

  const act = getActivitySkill(newAct) ? newAct : prevAct;
  const actId = getActivityId(act);
  const skill = getActivitySkill(act);
  if (!isWorkActivityId(actId) || !skill) return;

  const before = prevExp[skill];
  const after = newExp[skill];
  if (typeof before !== 'number' || typeof after !== 'number') return;
  if (after <= before) return;

  const key = xpRateKey(actId, skill);
  const tracker = state.xpRateSamples[key] ?? { samples: [] };
  pushRateSample(tracker.samples, after, Date.now(), activeWorkMsForActivity(actId));
  state.xpRateSamples[key] = tracker;
  scheduleEtaCalibrationSave();
}

export function trackDropGain(prevAct, newAct, prevMe, newMe) {
  if (!prevMe || !newMe) return;

  const act = getActivityId(newAct) ? newAct : prevAct;
  const actId = getActivityId(act);
  if (!isWorkActivityId(actId)) return;

  const dropItems = state.ACTIVITY_DEFS[actId]?.dropItems;
  if (!dropItems || Object.keys(dropItems).length === 0) return;

  const now = Date.now();
  for (const itemId of Object.keys(dropItems)) {
    const before = getMaterialCountForMe(prevMe, itemId);
    const after = getMaterialCountForMe(newMe, itemId);

    const key = dropRateKey(actId, itemId);
    if (after < before) {
      state.dropRateSamples[key] = { samples: [] };
      scheduleEtaCalibrationSave();
      continue;
    }
    if (after === before) continue;

    const tracker = state.dropRateSamples[key] ?? { samples: [] };
    pushRateSample(tracker.samples, after, now, activeWorkMsForActivity(actId));
    state.dropRateSamples[key] = tracker;
    scheduleEtaCalibrationSave();
  }
}

export function trackCombatConsumables(prevAct, newAct, prevMe, newMe) {
  const act = isCombatActivity(newAct) ? newAct : isCombatActivity(prevAct) ? prevAct : null;
  if (!act) return;

  // Skip the combat→banking/travel transition: inventory drops here are deposits,
  // not consumable use, and would falsely tag equipment or loot as consumables.
  if (newAct?.type === 'banking' || newAct?.type === 'travel') return;

  const actId = getActivityId(act);
  if (!isWorkActivityId(actId)) return;

  const prevInv = prevMe?.inventory ?? {};
  const newInv = newMe?.inventory ?? {};
  const dropItems = state.ACTIVITY_DEFS[actId]?.dropItems ?? {};
  const now = Date.now();

  const allIds = new Set([...Object.keys(prevInv), ...Object.keys(newInv)]);
  for (const itemId of allIds) {
    if (itemId in dropItems) continue;
    const before = prevInv[itemId] ?? 0;
    const after = newInv[itemId] ?? 0;

    const key = `${actId}:${itemId}`;
    if (after > before) {
      // Refill detected — reset so stale consumption data doesn't skew ETA.
      state.combatConsumableSamples[key] = { samples: [] };
      scheduleEtaCalibrationSave();
      continue;
    }
    if (after === before) continue;

    const tracker = state.combatConsumableSamples[key] ?? { samples: [] };
    pushRateSample(tracker.samples, after, now, activeWorkMsForActivity(actId));
    state.combatConsumableSamples[key] = tracker;
    scheduleEtaCalibrationSave();
  }
}

export function trackGoalAccumulation(prevAct, newAct, prevMe, newMe) {
  if (state.goals.length === 0) return;

  const act = isWorkActivityId(getActivityId(newAct)) ? newAct : prevAct;
  const actId = getActivityId(act);
  const isWork = isWorkActivityId(actId);
  const now = Date.now();

  for (const goal of state.goals) {
    const newCount = getGoalCountForMe(newMe, goal);
    if (newCount === null) continue;

    // Update high-water mark regardless of activity phase (captures gains during
    // any phase including travel and banking).
    const hwm = state.goalHighWaterMark[goal.id] ?? null;
    if (hwm === null || newCount > hwm) {
      state.goalHighWaterMark[goal.id] = newCount;
    }

    if (!isWork) continue;

    const prevCount = getGoalCountForMe(prevMe, goal);
    if (prevCount === null) continue;

    const rateKey = `${actId}:${goal.id}`;

    if (newCount < prevCount) {
      state.goalRateSamples[rateKey] = [];
      continue;
    }
    if (newCount === prevCount) continue;

    const samples = state.goalRateSamples[rateKey] ?? [];

    // If the new value is below the last pushed sample the loot bag was drained by
    // a banking trip that straddled non-work ticks (banking→travel transition), so
    // the `newCount < prevCount` branch above was never reached. Clear and restart
    // rather than anchoring the rate to a stale high-water mark.
    const lastSample = samples[samples.length - 1];
    if (lastSample && newCount < lastSample.value) {
      state.goalRateSamples[rateKey] = [];
      continue;
    }

    pushRateSample(samples, newCount, now, activeWorkMsForActivity(actId));
    state.goalRateSamples[rateKey] = samples;
  }
}

export function trackRunoutConsumption(prevAct, newAct, prevMe, newMe) {
  const act = isWorkActivityId(getActivityId(newAct)) ? newAct : prevAct;
  const actId = getActivityId(act);
  if (!isWorkActivityId(actId)) return;

  const def = state.ACTIVITY_DEFS[actId];
  if (!def) return;

  const prevInv = prevMe?.inventory ?? {};
  const newInv = newMe?.inventory ?? {};
  const now = Date.now();

  for (const [itemId, change] of Object.entries(def.inventoryChanges ?? {})) {
    if (change >= 0) continue;
    const key = `${actId}:${itemId}`;
    const prevCount = prevInv[itemId] ?? 0;
    const newCount = newInv[itemId] ?? 0;

    if (newCount > prevCount) {
      // Refill detected — reset so stale rate doesn't skew the ETA
      state.runoutRateSamples[key] = [];
    } else if (newCount < prevCount) {
      const samples = state.runoutRateSamples[key] ?? [];
      pushRateSample(samples, newCount, now, activeWorkMsForActivity(actId));
      state.runoutRateSamples[key] = samples;
    }
  }
}

export function computeCombatConsumableStatus(act) {
  const actId = getActivityId(act);
  if (!actId) return null;

  const inv = state.mirroredState.me?.inventory ?? {};
  const dropItems = state.ACTIVITY_DEFS[actId]?.dropItems ?? {};
  const prefix = actId + ':';
  const items = [];

  for (const [key, tracker] of Object.entries(state.combatConsumableSamples)) {
    if (!key.startsWith(prefix)) continue;
    const itemId = key.slice(prefix.length);
    if (itemId in dropItems) continue;
    if (tracker.samples.length === 0) continue;

    const currentCount = inv[itemId] ?? 0;
    if (currentCount === 0) continue; // Depleted — nothing to show an ETA for

    const rate = rateFromSamples(tracker.samples); // negative for consumption
    const consumptionRate = rate !== null && rate < 0 ? -rate : null;
    const etaMs = consumptionRate && currentCount > 0
      ? Math.round(currentCount / consumptionRate)
      : null;

    items.push({ itemId, currentCount, etaMs, sampleCount: tracker.samples.length });
  }

  return items.length > 0 ? items : null;
}

function getMaterialCountForMe(me, itemId) {
  const inv = me?.inventory?.[itemId] ?? 0;
  const lb = me?.lootBag?.[itemId] ?? 0;
  return Math.max(inv, lb);
}

function getGoalCountForMe(me, g) {
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
    if (key) { hasInvCount = true; invCount = inv[key] ?? 0; }
  }

  let hasLootCount = false;
  let lbCount = 0;
  if (g.itemId && g.itemId in lb) {
    hasLootCount = true;
    lbCount = lb[g.itemId] ?? 0;
  } else if (g.itemName) {
    const n = norm(g.itemName);
    const key = Object.keys(lb).find((k) => norm(k) === n);
    if (key) { hasLootCount = true; lbCount = lb[key] ?? 0; }
  }

  if (!hasInvCount && !hasLootCount) return 0;
  return Math.max(invCount, lbCount);
}

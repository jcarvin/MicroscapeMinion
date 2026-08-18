import { state } from './state.js';
import {
  ETA_CALIBRATION_CACHE_KEY,
  ETA_CALIBRATION_CACHE_VERSION,
  TICK_SAMPLE_LIMIT,
  CYCLE_SAMPLE_LIMIT,
  RATE_SAMPLE_LIMIT,
} from './constants.js';
import { isReasonableMs, isReasonableTickMs } from './utils.js';
import { getActivityId, isWorkActivityId } from './activity-utils.js';
import { runoutInfo } from './runout.js';

export function pushCappedSample(samples, sample, limit) {
  samples.push(sample);
  if (samples.length > limit) samples.shift();
  scheduleEtaCalibrationSave();
}

export function scheduleEtaCalibrationSave() {
  if (state.etaCalibrationSaveTimer !== null) return;
  state.etaCalibrationSaveTimer = setTimeout(() => {
    state.etaCalibrationSaveTimer = null;
    chrome.storage.local.set({
      [ETA_CALIBRATION_CACHE_KEY]: serializeEtaCalibrationCache(),
    });
  }, 3000);
}

export function serializeEtaCalibrationCache() {
  return {
    version: ETA_CALIBRATION_CACHE_VERSION,
    observedTickMs: state.observedTickMs,
    tickSamples: state.tickSamples.slice(-TICK_SAMPLE_LIMIT),
    cycleCalibrations: stripTrackerTimestamps(state.cycleCalibrations),
    xpRateSamples: stripRateTrackers(state.xpRateSamples),
    dropRateSamples: stripRateTrackers(state.dropRateSamples),
    combatConsumableSamples: stripRateTrackers(state.combatConsumableSamples),
    activeRateClocks: stripActiveRateClocks(state.activeRateClocks),
    updatedAt: Date.now(),
  };
}

export function hydrateEtaCalibrationCache(cache) {
  if (!cache || cache.version !== ETA_CALIBRATION_CACHE_VERSION) return;

  if (isReasonableTickMs(cache.observedTickMs)) {
    state.observedTickMs = Math.round(cache.observedTickMs);
  }
  state.tickSamples = cleanNumberSamples(cache.tickSamples, TICK_SAMPLE_LIMIT);
  state.cycleCalibrations = hydrateTrackerMap(
    cache.cycleCalibrations,
    CYCLE_SAMPLE_LIMIT,
    cleanCycleSample,
    'lastCompletionAt'
  );
  state.xpRateSamples = hydrateRateTrackerMap(cache.xpRateSamples, RATE_SAMPLE_LIMIT);
  state.dropRateSamples = hydrateRateTrackerMap(cache.dropRateSamples, RATE_SAMPLE_LIMIT);
  state.combatConsumableSamples = hydrateRateTrackerMap(cache.combatConsumableSamples, RATE_SAMPLE_LIMIT);
  state.activeRateClocks = hydrateActiveRateClocks(cache.activeRateClocks);
}

export function calibrateTick() {
  const now = Date.now();
  if (state.lastUpdateAt !== null) {
    const d = now - state.lastUpdateAt;
    if (d > 500 && d < 10_000) {
      pushCappedSample(state.tickSamples, d, TICK_SAMPLE_LIMIT);
      state.observedTickMs = Math.round(
        state.tickSamples.reduce((a, b) => a + b, 0) / state.tickSamples.length
      );
    }
  }
  state.lastUpdateAt = now;
}

export function calibrateCycleDuration(prevAct, newAct, preSnap) {
  const actId = getActivityId(newAct);
  if (!isWorkActivityId(actId)) return;
  if (actId !== getActivityId(prevAct)) return;

  const def = state.ACTIVITY_DEFS[actId];
  if (!def) return;

  let completedCycles = 0;
  if (preSnap?.cyclesLeft != null) {
    const postInfo = runoutInfo(actId);
    if (postInfo?.cyclesLeft != null) {
      completedCycles = preSnap.cyclesLeft - postInfo.cyclesLeft;
    }
  }
  if (completedCycles <= 0 && isCycleCompletion(prevAct, newAct)) {
    completedCycles = 1;
  }
  if (completedCycles <= 0) return;

  const now = Date.now();
  const cal = state.cycleCalibrations[actId] ?? {
    lastCompletionAt: null,
    samples: [],
  };
  if (cal.lastCompletionAt !== null && completedCycles === 1) {
    const sampleMs = (now - cal.lastCompletionAt) / completedCycles;
    const minSample = def.durationMs * 0.5;
    const maxSample = def.durationMs * 6;
    if (sampleMs >= minSample && sampleMs <= maxSample) {
      pushCappedSample(cal.samples, Math.round(sampleMs), CYCLE_SAMPLE_LIMIT);
    }
  }
  cal.lastCompletionAt = now;
  state.cycleCalibrations[actId] = cal;
}

export function resetCycleAnchorOnInterruption(prevAct, newAct) {
  const prevActId = getActivityId(prevAct);
  const newActId = getActivityId(newAct);
  if (!isWorkActivityId(prevActId)) return;
  if (newActId === prevActId) return;

  const cal = state.cycleCalibrations[prevActId];
  if (cal) cal.lastCompletionAt = null;
}

export function isDuplicateServerUpdate(delta) {
  const now = Date.now();
  let signature;
  try {
    signature = JSON.stringify(delta);
  } catch {
    signature = null;
  }

  if (
    signature &&
    signature === state.lastServerUpdateSignature &&
    now - state.lastServerUpdateAt < 100
  ) {
    return true;
  }

  state.lastServerUpdateSignature = signature;
  state.lastServerUpdateAt = now;
  return false;
}

function isCycleCompletion(prevAct, newAct) {
  return !prevAct?.preparedActivity && !!newAct?.preparedActivity;
}

function hydrateTrackerMap(raw, limit, cleanSample, timestampKey) {
  if (!raw || typeof raw !== 'object') return {};
  const hydrated = {};
  for (const [key, tracker] of Object.entries(raw)) {
    if (!tracker || typeof tracker !== 'object') continue;
    const samples = Array.isArray(tracker.samples)
      ? tracker.samples.map(cleanSample).filter(Boolean).slice(-limit)
      : [];
    if (samples.length === 0) continue;
    hydrated[key] = { [timestampKey]: null, samples };
  }
  return hydrated;
}

function hydrateRateTrackerMap(raw, limit) {
  if (!raw || typeof raw !== 'object') return {};
  const hydrated = {};
  for (const [key, tracker] of Object.entries(raw)) {
    if (!tracker || typeof tracker !== 'object') continue;
    const samples = Array.isArray(tracker.samples)
      ? tracker.samples.map(cleanRateSample).filter(Boolean).slice(-limit)
      : [];
    if (samples.length === 0) continue;
    hydrated[key] = { samples };
  }
  return hydrated;
}

function hydrateActiveRateClocks(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const hydrated = {};
  for (const [actId, elapsedMs] of Object.entries(raw)) {
    if (typeof elapsedMs === 'number' && isFinite(elapsedMs) && elapsedMs >= 0) {
      hydrated[actId] = Math.round(elapsedMs);
    }
  }
  return hydrated;
}

function cleanNumberSamples(samples, limit) {
  return Array.isArray(samples)
    ? samples.filter(isReasonableTickMs).map(Math.round).slice(-limit)
    : [];
}

function cleanCycleSample(value) {
  return isReasonableMs(value) ? Math.round(value) : null;
}

function cleanRateSample(sample) {
  const value = sample?.value;
  const at = sample?.at;
  const workMs = sample?.workMs;
  if (typeof value !== 'number' || !isFinite(value) || value < 0) return null;
  if (typeof at !== 'number' || !isFinite(at) || at <= 0) return null;
  if (typeof workMs !== 'number' || !isFinite(workMs) || workMs < 0) return null;
  return { value, at, workMs };
}

function stripTrackerTimestamps(trackers) {
  const stripped = {};
  for (const [key, tracker] of Object.entries(trackers ?? {})) {
    if (!Array.isArray(tracker?.samples) || tracker.samples.length === 0) continue;
    stripped[key] = { samples: tracker.samples };
  }
  return stripped;
}

function stripRateTrackers(trackers) {
  const stripped = {};
  for (const [key, tracker] of Object.entries(trackers ?? {})) {
    if (!Array.isArray(tracker?.samples) || tracker.samples.length === 0) continue;
    stripped[key] = { samples: tracker.samples.slice(-RATE_SAMPLE_LIMIT) };
  }
  return stripped;
}

function stripActiveRateClocks(clocks) {
  const stripped = {};
  for (const [actId, elapsedMs] of Object.entries(clocks ?? {})) {
    if (typeof elapsedMs === 'number' && isFinite(elapsedMs) && elapsedMs >= 0) {
      stripped[actId] = Math.round(elapsedMs);
    }
  }
  return stripped;
}

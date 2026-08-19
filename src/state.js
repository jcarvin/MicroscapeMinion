import { computeMicroscapeXpTable } from './xp.js';

export const state = {
  ACTIVITY_DEFS: {},
  ZONE_DATA: {},
  XP_TABLE: computeMicroscapeXpTable(),

  mirroredState: {},
  prevActivityId: undefined, // undefined = not yet observed

  microscopeTabId: null,

  observedTickMs: 2000,
  observedOverheadTicks: 6,
  tickSamples: [],
  lastUpdateAt: null,
  lastServerUpdateSignature: null,
  lastServerUpdateAt: 0,
  etaCalibrationSaveTimer: null,

  tickLog: [],
  etaDebugLog: [],
  cycleCalibrations: {}, // activityId -> { lastCompletionAt, samples: [ms] }

  // Rate trackers — all use { samples: [{ value, at, workMs }] } format.
  // Rate is derived as (newest.value - oldest.value) / active work time elapsed.
  // Persisted across sessions in etaCalibrationCache (version 3+).
  xpRateSamples: {},           // "activityId:skill" -> { samples: [{ value, at, workMs }] }
  dropRateSamples: {},         // "activityId:itemId" -> { samples: [{ value, at, workMs }] }
  combatConsumableSamples: {}, // "actId:itemId" -> { samples: [{ value, at, workMs }] }
  activeRateClocks: {},        // activityId -> cumulative active work ms
  lastRateClockAt: null,

  // In-memory only — not persisted. Reset when the corresponding goal changes.
  goalRateSamples: {},    // "activityId:goalId" -> [{ value, at, workMs }]
  runoutRateSamples: {},  // "activityId:itemId" -> [{ value, at, workMs }]
  // Highest normalized goal count per goal. Only ever increases.
  // Used for ETA remaining so bank trips (which drain the loot bag) don't inflate ETA.
  goalHighWaterMark: {},  // goalId -> count

  lastWorkActivity: null,

  goals: [],
  goalsLoaded: false,
  goalNotifiedAt: {},     // goalId -> timestamp
  runoutNotifiedFor: null,
  skillNotifyTarget: null,
};

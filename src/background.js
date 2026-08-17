// Background service worker — state mirror, detection engine, alert dispatcher.
//
// Patch format (confirmed from live frames):
//   Initial state: top-level values wrapped in [value] arrays.
//   Delta updates follow jsondiffpatch: [current] = added; [previous, current] = modified; [old, 0, 0] = deleted.
//   Array-typed fields (e.g. toasts) use jsondiffpatch _t:"a" format.
//
// Confirmed field layout:
//   me.activity          — object when active, null/absent when idle
//   me.activity.skill    — "cooking"  (active-cycle shape)
//   me.activity.activity — "cook-bread"  (active-cycle shape; yes, activity.activity)
//   me.activity.remaining — cycles left in batch
//   me.activity.preparedActivity — { skill, zone, activity, ... }  (between-cycles shape)
//   me.inventory         — { camelCaseItemId: count }  flat object
//   me.lootBag           — { camelCaseItemId: count }  items currently filling bank-trip capacity
//
// Duration formula (confirmed from bundle):
//   displayedSeconds = (activityDef.duration + 6) * 2   →  durationMs = (duration + 6) * 2000

const BANK_TRIGGER_ITEM_COUNT = 25;
const CYCLE_SAMPLE_LIMIT = 100;
const RATE_SAMPLE_LIMIT = 1000;
const ETA_DEBUG_LOG_LIMIT = 2000;
const ETA_DEBUG_LOG_VERSION = 1;
const TICK_SAMPLE_LIMIT = 100;
// Rate-based ETA: 2-minute warmup before switching from cycle-based fallback.
// After a 5-minute gap with no samples, the window resets so idle time isn't
// counted in the elapsed denominator.
const RATE_WARMUP_MS = 120_000;
const GAP_RESET_MS = 300_000;
const ETA_CALIBRATION_CACHE_VERSION = 3;
const ETA_CALIBRATION_CACHE_KEY = 'etaCalibrationCache';

// Bank trip timing — computed dynamically from zone mapPos when ZONE_DATA is available.
// BANK_TRIP_MS is the fallback used before the bundle is parsed.
// Travel speed empirically derived: distance 325.7 / 6 ticks observed for manor-kitchen.
// Banking time (8 ticks) observed from WebSocket frame.
const BANK_TRIP_MS = 50_000; // fallback (~50s covers most zones)
const TRAVEL_SPEED = 54.3; // mapPos units per tick
const BANKING_TICKS = 8; // ticks spent depositing
const TICK_MS = 2000; // server tick duration (confirmed from bundle formula)

// ── Activity definition lookup ────────────────────────────────────────────────
// Populated from chrome.storage.local (cached live-bundle parse) on startup,
// falling back to the static seed JSON if no cache exists yet. The injected
// MAIN-world script fetches the live bundle on every page load and sends fresh
// defs via ACTIVITY_DEFS message, which overwrites the cache for future restarts.

let ACTIVITY_DEFS = {};
let ZONE_DATA = {}; // zoneId → [mapX, mapY] — used for dynamic bank trip calculation
let XP_TABLE = computeMicroscapeXpTable(); // XP_TABLE[level] = min total XP for that level (1-indexed)

chrome.storage.local.get(
  [
    'activityDefs',
    'zoneData',
    'xpTable',
    'skillNotifyTarget',
    ETA_CALIBRATION_CACHE_KEY,
  ],
  (res) => {
    fetch(chrome.runtime.getURL('src/activity-defs.json'))
      .then((r) => r.json())
      .then((seed) => {
        const { defs, added } = mergeMissingActivityDefs(res.activityDefs, seed);
        ACTIVITY_DEFS = defs;
        if (added) {
          chrome.storage.local.set({ activityDefs: ACTIVITY_DEFS });
        }
      })
      .catch(() => {
        if (res.activityDefs && Object.keys(res.activityDefs).length > 0) {
          ACTIVITY_DEFS = res.activityDefs;
        }
      });
    if (res.zoneData) ZONE_DATA = res.zoneData;
    if (isValidXpTable(res.xpTable)) XP_TABLE = res.xpTable;
    if (res.skillNotifyTarget) skillNotifyTarget = res.skillNotifyTarget;
    hydrateEtaCalibrationCache(res[ETA_CALIBRATION_CACHE_KEY]);
  }
);

// ── Module state ──────────────────────────────────────────────────────────────

let mirroredState = {};
let prevActivityId = undefined; // undefined = not yet observed

let microscopeTabId = null;

let observedTickMs = 2000;
let observedOverheadTicks = 6; // debug-only; not used to rewrite activity duration
let tickSamples = [];
let lastUpdateAt = null;
let lastServerUpdateSignature = null;
let lastServerUpdateAt = 0;
let etaCalibrationSaveTimer = null;

let tickLog = []; // newest-first, capped at 40 entries
let etaDebugLog = []; // newest-first, capped at ETA_DEBUG_LOG_LIMIT
let cycleCalibrations = {}; // activityId -> { lastCompletionAt, samples: [ms] }

// Rate trackers — all use { samples: [{ value, at, workMs }] } format.
// Rate is derived as (newest.value - oldest.value) / active work time elapsed.
// Persisted across sessions in etaCalibrationCache (version 3+).
let xpRateSamples = {};           // "activityId:skill" -> { samples: [{ value, at, workMs }] }
let dropRateSamples = {};         // "activityId:itemId" -> { samples: [{ value, at, workMs }] }
let combatConsumableSamples = {}; // "actId:itemId" -> { samples: [{ value, at, workMs }] }
let activeRateClocks = {};        // activityId -> cumulative active work ms
let lastRateClockAt = null;

// In-memory only — not persisted. Reset when goal/activity changes.
let goalRateSamples = {};    // activityId -> [{ value, at, workMs }]
let runoutRateSamples = {};  // "activityId:itemId" -> [{ value, at, workMs }]
// Highest normalized goal count seen for the current goal. Only ever increases.
// Used for ETA remaining so bank trips (which drain the loot bag) don't inflate ETA.
let goalHighWaterMark = null;

let lastWorkActivity = null; // Last non-travel/banking activity, used to keep ETAs visible during travel.

let goal = null; // { itemName, itemId, targetCount }
let goalNotifiedAt = null;
let runoutNotifiedFor = null;
let skillNotifyTarget = null; // { skill, level }

chrome.storage.session.get(['goal', 'lastWorkActivity'], (res) => {
  if (res.goal) goal = res.goal;
  if (res.lastWorkActivity) lastWorkActivity = res.lastWorkActivity;
});

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.__mm) {
    if (sender.tab?.id) microscopeTabId = sender.tab.id;
    if (msg.direction === 'server') handleServerFrame(msg.frame);
    if (msg.direction === 'client') handleClientFrame(msg.frame);
    if (
      msg.type === 'ACTIVITY_DEFS' &&
      msg.defs &&
      Object.keys(msg.defs).length > 0
    ) {
      ACTIVITY_DEFS = msg.defs;
      const toCache = { activityDefs: msg.defs };
      if (msg.zones && Object.keys(msg.zones).length > 0) {
        ZONE_DATA = msg.zones;
        toCache.zoneData = msg.zones;
      }
      if (isValidXpTable(msg.xpTable)) {
        XP_TABLE = msg.xpTable;
        toCache.xpTable = msg.xpTable;
      }
      chrome.storage.local.set(toCache);
    }
    return;
  }

  switch (msg?.type) {
    case 'SET_GOAL':
      goal = msg.goal ?? null;
      goalNotifiedAt = null;
      goalRateSamples = {};
      goalHighWaterMark = goal ? (getGoalCount(goal.itemName, goal.itemId) ?? 0) : null;
      chrome.storage.session.set({ goal });
      respond({ ok: true });
      break;

    case 'CLEAR_GOAL':
      goal = null;
      goalNotifiedAt = null;
      goalRateSamples = {};
      goalHighWaterMark = null;
      chrome.storage.session.set({ goal: null });
      respond({ ok: true });
      break;

    case 'GET_STATUS':
      respond(buildStatus());
      break;

    case 'SET_SKILL_NOTIFY':
      skillNotifyTarget = { skill: msg.skill, level: msg.level };
      chrome.storage.local.set({ skillNotifyTarget });
      respond({ ok: true });
      break;

    case 'CLEAR_SKILL_NOTIFY':
      skillNotifyTarget = null;
      chrome.storage.local.remove('skillNotifyTarget');
      respond({ ok: true });
      break;
  }

  return true;
});

// ── Frame handlers ────────────────────────────────────────────────────────────

function handleServerFrame(frame) {
  if (frame.event !== 'update' || !frame.args?.length) return;
  if (isDuplicateServerUpdate(frame.args[0])) return;

  const now = Date.now();
  calibrateTick();
  const prevAct = mirroredState.me?.activity;
  const prevExp = mirroredState.me?.exp;
  const prevMe = mirroredState.me;
  const preSnap = snapshotEta();
  advanceActiveRateClock(prevAct, now);

  mirroredState = applyPatch(mirroredState, frame.args[0]);
  const newAct = mirroredState.me?.activity;
  rememberWorkActivity(newAct);
  trackXpGain(prevAct, newAct, prevExp, mirroredState.me?.exp);
  trackDropGain(prevAct, newAct, prevMe, mirroredState.me);
  trackCombatConsumables(prevAct, newAct, prevMe, mirroredState.me);
  trackGoalAccumulation(prevAct, newAct, prevMe, mirroredState.me);
  trackRunoutConsumption(prevAct, newAct, prevMe, mirroredState.me);

  if (
    newAct?.preparedActivity &&
    !prevAct?.preparedActivity &&
    (newAct.remaining ?? 0) > 0
  ) {
    observedOverheadTicks = newAct.remaining;
  }
  resetCycleAnchorOnInterruption(prevAct, newAct);
  calibrateCycleDuration(prevAct, newAct, preSnap);

  const prevType = prevAct?.type;
  const newType = newAct?.type;
  if (newType === 'travel' && prevType !== 'travel')
    pushTickEvent('travel-start');
  if (prevType === 'travel' && newType !== 'travel')
    pushTickEvent('travel-end');
  if (newType === 'banking' && prevType !== 'banking')
    pushTickEvent('banking-start');
  if (prevType === 'banking' && newType !== 'banking')
    pushTickEvent('banking-end');

  const postSnap = snapshotEta();
  pushTickEntry(preSnap, postSnap);
  safelyPushEtaDebugEntry({
    preSnap,
    postSnap,
    prevAct,
    newAct,
    prevMe,
    newMe: mirroredState.me,
    now,
  });

  detectIdleTransition();
  detectGoalReached();
  detectMaterialRunout();
  detectSkillLevelReached();
}

function pushCappedSample(samples, sample, limit) {
  samples.push(sample);
  if (samples.length > limit) samples.shift();
  scheduleEtaCalibrationSave();
}

function hydrateEtaCalibrationCache(cache) {
  if (!cache || cache.version !== ETA_CALIBRATION_CACHE_VERSION) return;

  if (isReasonableTickMs(cache.observedTickMs)) {
    observedTickMs = Math.round(cache.observedTickMs);
  }
  tickSamples = cleanNumberSamples(cache.tickSamples, TICK_SAMPLE_LIMIT);
  cycleCalibrations = hydrateTrackerMap(
    cache.cycleCalibrations,
    CYCLE_SAMPLE_LIMIT,
    cleanCycleSample,
    'lastCompletionAt'
  );
  xpRateSamples = hydrateRateTrackerMap(cache.xpRateSamples, RATE_SAMPLE_LIMIT);
  dropRateSamples = hydrateRateTrackerMap(cache.dropRateSamples, RATE_SAMPLE_LIMIT);
  combatConsumableSamples = hydrateRateTrackerMap(cache.combatConsumableSamples, RATE_SAMPLE_LIMIT);
  activeRateClocks = hydrateActiveRateClocks(cache.activeRateClocks);
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

function isReasonableMs(value) {
  return (
    typeof value === 'number' &&
    isFinite(value) &&
    value >= 250 &&
    value <= 60 * 60_000
  );
}

function isReasonableTickMs(value) {
  return typeof value === 'number' && value > 500 && value < 10_000;
}

function scheduleEtaCalibrationSave() {
  if (etaCalibrationSaveTimer !== null) return;
  etaCalibrationSaveTimer = setTimeout(() => {
    etaCalibrationSaveTimer = null;
    chrome.storage.local.set({
      [ETA_CALIBRATION_CACHE_KEY]: serializeEtaCalibrationCache(),
    });
  }, 3000);
}

function serializeEtaCalibrationCache() {
  return {
    version: ETA_CALIBRATION_CACHE_VERSION,
    observedTickMs,
    tickSamples: tickSamples.slice(-TICK_SAMPLE_LIMIT),
    cycleCalibrations: stripTrackerTimestamps(cycleCalibrations),
    xpRateSamples: stripRateTrackers(xpRateSamples),
    dropRateSamples: stripRateTrackers(dropRateSamples),
    combatConsumableSamples: stripRateTrackers(combatConsumableSamples),
    activeRateClocks: stripActiveRateClocks(activeRateClocks),
    updatedAt: Date.now(),
  };
}

function stripTrackerTimestamps(trackers) {
  const stripped = {};
  for (const [key, tracker] of Object.entries(trackers ?? {})) {
    if (!Array.isArray(tracker?.samples) || tracker.samples.length === 0) {
      continue;
    }
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

// ── Tick log helpers ──────────────────────────────────────────────────────────

function snapshotEta() {
  const me = mirroredState.me;
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
  const def = actId ? ACTIVITY_DEFS[actId] : null;
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
    ? (runoutRateSamples[`${actId}:${info.itemId}`] ?? [])
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
  const goalEta =
    goal && actId
      ? computeGoalEta(
          goal,
          goalHighWaterMark ?? getGoalCount(goal.itemName, goal.itemId) ?? 0,
          actId,
          etaAct,
          etaActIsLive
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
    overheadTicks: observedOverheadTicks,
    lootBagItems: lootBagTotal(),
    bankTriggerItemCount: BANK_TRIGGER_ITEM_COUNT,
    actRemaining: liveAct?.remaining ?? null,
    actLength: liveAct?.length ?? null,
    observedTickMs,
    goalEtaMs: goalEta?.totalMs ?? null,
    goalBankTrips: goalEta?.bankTrips ?? null,
    goalRateBased: goalEta?.rateBased === true,
    goalSamples: goalEta?.sampleCount ?? null,
    goalBankOverheadMs: goalEta?.bankOverheadMs ?? null,
    runoutRateBased: runoutRate !== null,
    runoutSamples: runoutSamples.length,
  };
}

function pushTickEntry(pre, post) {
  const deltaMs =
    pre?.etaMs != null && post.etaMs != null ? post.etaMs - pre.etaMs : null;
  tickLog.unshift({
    at: Date.now(),
    type: 'tick',
    pre: pre?.etaMs ?? null,
    ...post,
    deltaMs,
  });
  if (tickLog.length > 40) tickLog.pop();
}

function pushTickEvent(type) {
  tickLog.unshift({ at: Date.now(), type });
  if (tickLog.length > 40) tickLog.pop();
}

function safelyPushEtaDebugEntry(args) {
  try {
    pushEtaDebugEntry(args);
  } catch (error) {
    etaDebugLog.unshift({
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
    if (etaDebugLog.length > ETA_DEBUG_LOG_LIMIT) etaDebugLog.pop();
  }
}

function pushEtaDebugEntry({
  preSnap,
  postSnap,
  prevAct,
  newAct,
  prevMe,
  newMe,
  now,
}) {
  const liveAct = newMe?.activity ?? null;
  const etaAct = getEtaActivity(liveAct);
  const actId = getActivityId(etaAct);
  const liveActId = getActivityId(liveAct);
  const skill = getActivitySkill(etaAct);
  const def = actId ? ACTIVITY_DEFS[actId] : null;
  const durationInfo = def ? cycleDurationInfo(def, actId) : null;
  const zoneId = getActivityZone(etaAct);
  const info = actId ? runoutInfo(actId) : null;
  const producedPerCycle = producedItemsPerCycle(def);
  const itemsGenerated =
    info && def ? info.cyclesLeft * producedPerCycle : null;
  const generatedBank = itemsGenerated != null
    ? bankOverheadForGeneratedItems(itemsGenerated, zoneId, actId)
    : null;

  const goalCount = goal ? (getGoalCount(goal.itemName, goal.itemId) ?? 0) : null;
  const prevGoalCount = goal ? getGoalCountForMe(prevMe, goal) : null;
  const newGoalCount = goal ? getGoalCountForMe(newMe, goal) : null;
  const effectiveGoalCount = goal ? (goalHighWaterMark ?? goalCount ?? 0) : null;
  const goalEta = goal && actId
    ? computeGoalEta(goal, effectiveGoalCount ?? 0, actId, etaAct, etaAct === liveAct)
    : null;
  const goalSampleInfo = goal && actId && def
    ? goalRateDebugInfo(goal, def, actId)
    : null;

  const runoutKey = info && actId ? `${actId}:${info.itemId}` : null;
  const runoutSamples = runoutKey ? (runoutRateSamples[runoutKey] ?? []) : [];
  const xpKeyForDebug = actId && skill ? xpRateKey(actId, skill) : null;
  const xpSamples = xpKeyForDebug ? (xpRateSamples[xpKeyForDebug]?.samples ?? []) : [];

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
  if (getActivityId(prevAct) !== getActivityId(newAct)) {
    resetSignals.push('activity-change');
  }
  if (liveAct?.type === 'travel') resetSignals.push('travel');
  if (liveAct?.type === 'banking') resetSignals.push('banking');

  etaDebugLog.unshift({
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
      lastWork: compactActivity(lastWorkActivity),
    },
    tick: {
      observedTickMs,
      sampleCount: tickSamples.length,
      lastDeltaMs: tickSamples[tickSamples.length - 1] ?? null,
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
          ? (liveAct.remaining ?? 0) * TICK_MS
          : 0,
    },
    bank: {
      zoneId,
      lootBagItems: lootBagTotal(),
      triggerItemCount: BANK_TRIGGER_ITEM_COUNT,
      producedPerCycle,
      projectedGeneratedItems: itemsGenerated,
      projectedTrips: generatedBank?.bankTrips ?? null,
      projectedOverheadMs: generatedBank?.bankOverheadMs ?? null,
      tripMs: actId ? bankTripMs(zoneId, effectiveTickMsForActivity(actId)) : null,
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

  if (etaDebugLog.length > ETA_DEBUG_LOG_LIMIT) etaDebugLog.pop();
}

function compactActivity(act) {
  if (!act) return null;
  return {
    type: act.type ?? null,
    skill: getActivitySkill(act),
    activity: getActivityId(act),
    zone: getActivityZone(act),
    remaining: act.remaining ?? null,
    length: act.length ?? null,
    preparedActivity: act.preparedActivity
      ? {
          skill: getActivitySkill({ preparedActivity: act.preparedActivity }),
          activity: getActivityId({ preparedActivity: act.preparedActivity }),
          zone: getActivityZone({ preparedActivity: act.preparedActivity }),
        }
      : null,
  };
}

function goalRateDebugInfo(g, def, actId) {
  const dropKey = findKey(def.dropItems, g.itemName, g.itemId);
  if (dropKey) {
    return {
      source: 'dropItems',
      key: dropKey,
      ...rateSampleDebug(dropRateSamples[dropRateKey(actId, dropKey)]?.samples ?? []),
    };
  }

  const goalKey = findKey(def.inventoryChanges, g.itemName, g.itemId);
  return {
    source: goalKey ? 'inventoryChanges' : 'none',
    key: goalKey,
    yieldPerCycle: goalKey ? (def.inventoryChanges[goalKey] ?? 0) : null,
    producedPerCycle: producedItemsPerCycle(def),
    ...rateSampleDebug(goalRateSamples[actId] ?? []),
  };
}

function rateSampleDebug(samples) {
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

function goalEtaModel(eta) {
  if (eta === 0) return 'done';
  if (!eta || eta.totalMs == null) return 'calibrating';
  if (eta.chanceBased) return 'chance-rate';
  if (eta.rateBased) return 'rate';
  return 'cycle-fallback';
}

function handleClientFrame(frame) {
  if (frame.event !== 'input:game' || !frame.args?.length) return;
  if (frame.args[0]?.type !== 'stop-activity') return;
  if (!mirroredState.me) return;
  // Immediately mirror the stop — don't wait for the server update
  mirroredState = {
    ...mirroredState,
    me: { ...mirroredState.me, activity: null },
  };
  lastWorkActivity = null;
  chrome.storage.session.remove('lastWorkActivity');
  detectIdleTransition();
  detectMaterialRunout(); // clears runout state since activity is now null
}

// ── Patch application ─────────────────────────────────────────────────────────

function applyPatch(base, delta) {
  if (delta === null || delta === undefined) return delta;

  // jsondiffpatch delete marker: [oldValue, 0, 0] → remove the key
  if (
    Array.isArray(delta) &&
    delta.length === 3 &&
    delta[1] === 0 &&
    delta[2] === 0
  ) {
    return undefined;
  }
  // Scalar/initial delta:
  //   [current] = add/initial value
  //   [previous, current] = modified value
  if (Array.isArray(delta)) {
    if (delta.length === 1) return delta[0];
    if (delta.length === 2) return delta[1];
    return delta.length > 0 ? delta[0] : undefined;
  }

  // jsondiffpatch array delta (_t:"a") — used for ordered lists like toasts
  if (typeof delta === 'object' && delta._t === 'a') {
    const arr = Array.isArray(base) ? [...base] : [];
    const delIdxs = Object.keys(delta)
      .filter((k) => k !== '_t' && k.startsWith('_'))
      .map((k) => parseInt(k.slice(1), 10))
      .sort((a, b) => b - a);
    for (const i of delIdxs) {
      const d = delta[`_${i}`];
      if (Array.isArray(d) && d.length >= 1) arr.splice(i, 1);
    }
    for (const key of Object.keys(delta)) {
      if (key === '_t' || key.startsWith('_')) continue;
      const i = parseInt(key, 10);
      if (isNaN(i)) continue;
      const d = delta[key];
      if (Array.isArray(d) && d.length === 1) arr.splice(i, 0, d[0]);
      else arr[i] = applyPatch(arr[i], d);
    }
    return arr;
  }

  // Object delta — merge keys recursively
  if (typeof delta === 'object') {
    const result =
      base && typeof base === 'object' && !Array.isArray(base)
        ? { ...base }
        : {};
    for (const [k, v] of Object.entries(delta)) {
      const applied = applyPatch(result[k], v);
      if (applied === undefined) delete result[k];
      else result[k] = applied;
    }
    return result;
  }

  return delta;
}

// ── Activity helpers ──────────────────────────────────────────────────────────
//
// me.activity has several shapes:
//   Active cycle:   { skill, zone, activity, remaining, length, createdTick }
//   Between cycles: { preparedActivity: { skill, zone, activity, ... }, length, remaining }
//   Bank trip:      { type: "travel", destination: { map: "...-bank" }, desiredActivity: { type: "banking", ... }, remaining }
//
// Character is idle ONLY when me.activity is null/absent entirely.
// Travel and banking are transient states — not idle.

function rememberWorkActivity(act) {
  const actId = getActivityId(act);
  if (isWorkActivityId(actId)) {
    lastWorkActivity = cloneForStorage(act);
    chrome.storage.session.set({ lastWorkActivity });
    return;
  }
  if (!act) {
    lastWorkActivity = null;
    chrome.storage.session.remove('lastWorkActivity');
  }
}

function getEtaActivity(liveAct) {
  const liveActId = getActivityId(liveAct);
  if (isWorkActivityId(liveActId)) return liveAct;
  if (liveAct?.type === 'travel' || liveAct?.type === 'banking') {
    return lastWorkActivity;
  }
  return null;
}

function cloneForStorage(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function getActivityId(act) {
  if (!act) return null;
  if (act.type === 'travel' || act.type === 'banking') return act.type;
  return act.activity ?? act.preparedActivity?.activity ?? null;
}

function getActivitySkill(act) {
  if (!act || act.type === 'travel' || act.type === 'banking') return null;
  return (
    act.skill ??
    act.combatSkill ??
    act.preparedActivity?.skill ??
    act.preparedActivity?.combatSkill ??
    null
  );
}

function getActivityZone(act) {
  if (!act || act.type === 'travel' || act.type === 'banking') return null;
  return act.zone ?? act.preparedActivity?.zone ?? null;
}

function isCombatActivity(act) {
  if (!act || act.type === 'travel' || act.type === 'banking') return false;
  return !!(act.mob ?? act.preparedActivity?.mob);
}

// Computes round-trip bank time for a given zone using mapPos euclidean distance.
// Falls back to BANK_TRIP_MS if zone data hasn't been loaded from the bundle yet.
function bankTripMs(zoneId, tickMs = TICK_MS) {
  const zonePos = zoneId ? ZONE_DATA[zoneId] : null;
  if (!zonePos) return BANK_TRIP_MS;

  // Find nearest bank (zones ending in -bank, plus bank-vault)
  let minDist = Infinity;
  for (const [id, pos] of Object.entries(ZONE_DATA)) {
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

// ── Idle detection ────────────────────────────────────────────────────────────

function detectIdleTransition() {
  const me = mirroredState.me;
  if (!me) return;

  const act = me.activity ?? null;
  const actId = getActivityId(act);

  if (
    prevActivityId !== undefined &&
    prevActivityId !== null &&
    actId === null
  ) {
    fireNotification(
      'idle',
      "Microscape: You're idle!",
      'Your character stopped working.'
    );
    sendChime('default');
  }

  prevActivityId = actId;
}

// ── Goal tracking ─────────────────────────────────────────────────────────────

function detectGoalReached() {
  if (!goal) return;
  const count = getGoalCount(goal.itemName, goal.itemId);
  if (count === null || count < goal.targetCount) return;
  if (goalNotifiedAt) return;
  goalNotifiedAt = Date.now();
  fireNotification(
    'goal',
    'Microscape: Goal reached!',
    `${goal.itemName}: ${count} / ${goal.targetCount}`
  );
  sendChime('default');
}

// ── Material runout ───────────────────────────────────────────────────────────

function detectMaterialRunout() {
  const me = mirroredState.me;
  const act = me?.activity ?? null;
  if (!act) {
    runoutNotifiedFor = null;
    return;
  }

  const actId = getActivityId(act);
  if (!actId) return;

  const info = runoutInfo(actId);
  if (!info) return;

  if (info.cyclesLeft > 0) {
    runoutNotifiedFor = null;
    return;
  }

  if (runoutNotifiedFor === actId) return;
  runoutNotifiedFor = actId;
  fireNotification(
    'runout',
    'Microscape: Out of materials!',
    `${info.itemId} ran out — character will go idle.`
  );
  sendChime('runout');
}

// ── Skill level notification ──────────────────────────────────────────────────

function detectSkillLevelReached() {
  if (!skillNotifyTarget) return;
  const exp = mirroredState.me?.exp;
  if (!exp) return;

  const currentXp = exp[skillNotifyTarget.skill];
  if (typeof currentXp !== 'number') return;

  const currentLevel = getLevelFromXp(currentXp);
  if (currentLevel < skillNotifyTarget.level) return;

  const skill = String(skillNotifyTarget.skill ?? '').replace(/[-_]/g, ' ').replace(/\b\w/g, s => s.toUpperCase());
  fireNotification(
    'skill-level',
    'Microscape: Level up!',
    `${skill} reached level ${skillNotifyTarget.level}!`
  );
  sendChime('default');
  skillNotifyTarget = null;
  chrome.storage.local.remove('skillNotifyTarget');
}

// ── Duration and banking helpers ──────────────────────────────────────────────

function cycleDurationInfo(def, actId) {
  const samples = actId ? (cycleCalibrations[actId]?.samples ?? []) : [];
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

function cycleDurationMs(def, actId) {
  return cycleDurationInfo(def, actId).durationMs;
}

function tickBasedActivityDurationMs(def) {
  const bundleTicks = def?.durationMs ? def.durationMs / TICK_MS : 0;
  return bundleTicks > 0
    ? Math.round(bundleTicks * observedTickMs)
    : (def?.durationMs ?? TICK_MS);
}

function calibrateCycleDuration(prevAct, newAct, preSnap) {
  const actId = getActivityId(newAct);
  if (!isWorkActivityId(actId)) return;
  if (actId !== getActivityId(prevAct)) return;

  const def = ACTIVITY_DEFS[actId];
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
  const cal = cycleCalibrations[actId] ?? {
    lastCompletionAt: null,
    samples: [],
  };
  if (cal.lastCompletionAt !== null && completedCycles === 1) {
    const sampleMs = (now - cal.lastCompletionAt) / completedCycles;
    const minSample = def.durationMs * 0.5;
    const maxSample = def.durationMs * 6;
    if (sampleMs >= minSample && sampleMs <= maxSample) {
      pushCappedSample(
        cal.samples,
        Math.round(sampleMs),
        CYCLE_SAMPLE_LIMIT
      );
    }
  }
  cal.lastCompletionAt = now;
  cycleCalibrations[actId] = cal;
}

function resetCycleAnchorOnInterruption(prevAct, newAct) {
  const prevActId = getActivityId(prevAct);
  const newActId = getActivityId(newAct);
  if (!isWorkActivityId(prevActId)) return;
  if (newActId === prevActId) return;

  const cal = cycleCalibrations[prevActId];
  if (cal) cal.lastCompletionAt = null;
}

// ── Rate tracking ─────────────────────────────────────────────────────────────
//
// All rate trackers store { value, at, workMs } samples: cumulative value at a
// wall-clock timestamp and cumulative active work time for the activity. Rate =
// (newest.value - oldest.value) / (newest.workMs - oldest.workMs).
// Samples are pushed only when the value changes in the expected direction
// (up for accumulation, down for consumption). Banking/travel time is forecast
// separately so the ETA includes bank trips before they happen and does not
// absorb a whole bank trip as a delayed rate spike on the next grant.
//
// A 5-minute gap with no new samples resets the window; the rate clock restarts
// from the current reading to avoid counting idle time in the denominator.

function advanceActiveRateClock(prevAct, now) {
  if (lastRateClockAt !== null) {
    const delta = now - lastRateClockAt;
    const actId = getActivityId(prevAct);
    if (isWorkActivityId(actId) && delta > 0 && delta <= GAP_RESET_MS) {
      activeRateClocks[actId] = (activeRateClocks[actId] ?? 0) + delta;
    }
  }
  lastRateClockAt = now;
}

function activeWorkMsForActivity(actId) {
  return activeRateClocks[actId] ?? 0;
}

function rateFromSamples(samples) {
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

function pushRateSample(samples, value, now, workMs) {
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

function trackXpGain(prevAct, newAct, prevExp, newExp) {
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
  const tracker = xpRateSamples[key] ?? { samples: [] };
  pushRateSample(tracker.samples, after, Date.now(), activeWorkMsForActivity(actId));
  xpRateSamples[key] = tracker;
  scheduleEtaCalibrationSave();
}

function xpRateKey(actId, skill) {
  return `${actId}:${skill}`;
}

function observedXpPerMs(actId, skill) {
  const samples = xpRateSamples[xpRateKey(actId, skill)]?.samples ?? [];
  const rate = rateFromSamples(samples);
  return rate !== null && rate > 0 ? rate : null;
}

function trackDropGain(prevAct, newAct, prevMe, newMe) {
  if (!prevMe || !newMe) return;

  const act = getActivityId(newAct) ? newAct : prevAct;
  const actId = getActivityId(act);
  if (!isWorkActivityId(actId)) return;

  const dropItems = ACTIVITY_DEFS[actId]?.dropItems;
  if (!dropItems || Object.keys(dropItems).length === 0) return;

  const now = Date.now();
  for (const itemId of Object.keys(dropItems)) {
    const before = getMaterialCountForMe(prevMe, itemId);
    const after = getMaterialCountForMe(newMe, itemId);

    const key = dropRateKey(actId, itemId);
    if (after < before) {
      dropRateSamples[key] = { samples: [] };
      scheduleEtaCalibrationSave();
      continue;
    }
    if (after === before) continue;

    const tracker = dropRateSamples[key] ?? { samples: [] };
    pushRateSample(tracker.samples, after, now, activeWorkMsForActivity(actId));
    dropRateSamples[key] = tracker;
    scheduleEtaCalibrationSave();
  }
}

function observedDropItemsPerMs(actId, itemId) {
  const samples = dropRateSamples[dropRateKey(actId, itemId)]?.samples ?? [];
  const rate = rateFromSamples(samples);
  return rate !== null && rate > 0 ? rate : null;
}

function dropRateSampleCount(actId, itemId) {
  return dropRateSamples[dropRateKey(actId, itemId)]?.samples.length ?? 0;
}

function trackCombatConsumables(prevAct, newAct, prevMe, newMe) {
  const act = isCombatActivity(newAct) ? newAct : isCombatActivity(prevAct) ? prevAct : null;
  if (!act) return;

  const actId = getActivityId(act);
  if (!isWorkActivityId(actId)) return;

  const prevInv = prevMe?.inventory ?? {};
  const newInv = newMe?.inventory ?? {};
  const dropItems = ACTIVITY_DEFS[actId]?.dropItems ?? {};
  const now = Date.now();

  const allIds = new Set([...Object.keys(prevInv), ...Object.keys(newInv)]);
  for (const itemId of allIds) {
    if (itemId in dropItems) continue;
    const before = prevInv[itemId] ?? 0;
    const after = newInv[itemId] ?? 0;

    const key = `${actId}:${itemId}`;
    if (after > before) {
      // Refill detected — reset so stale consumption data doesn't skew ETA.
      combatConsumableSamples[key] = { samples: [] };
      scheduleEtaCalibrationSave();
      continue;
    }
    if (after === before) continue;

    const tracker = combatConsumableSamples[key] ?? { samples: [] };
    pushRateSample(tracker.samples, after, now, activeWorkMsForActivity(actId));
    combatConsumableSamples[key] = tracker;
    scheduleEtaCalibrationSave();
  }
}

function computeCombatConsumableStatus(act) {
  const actId = getActivityId(act);
  if (!actId) return null;

  const inv = mirroredState.me?.inventory ?? {};
  const dropItems = ACTIVITY_DEFS[actId]?.dropItems ?? {};
  const prefix = actId + ':';
  const items = [];

  for (const [key, tracker] of Object.entries(combatConsumableSamples)) {
    if (!key.startsWith(prefix)) continue;
    const itemId = key.slice(prefix.length);
    if (itemId in dropItems) continue;
    if (tracker.samples.length === 0) continue;

    const currentCount = inv[itemId] ?? 0;
    const rate = rateFromSamples(tracker.samples); // negative for consumption
    const consumptionRate = rate !== null && rate < 0 ? -rate : null;
    const etaMs = consumptionRate && currentCount > 0
      ? Math.round(currentCount / consumptionRate)
      : null;

    items.push({ itemId, currentCount, etaMs, sampleCount: tracker.samples.length });
  }

  return items.length > 0 ? items : null;
}

function trackGoalAccumulation(prevAct, newAct, prevMe, newMe) {
  if (!goal) return;

  const newCount = getGoalCountForMe(newMe, goal);
  if (newCount === null) return;

  // Update high-water mark regardless of activity phase (captures gains during
  // any phase including travel and banking).
  if (goalHighWaterMark === null || newCount > goalHighWaterMark) {
    goalHighWaterMark = newCount;
  }

  // Rate samples are only pushed during active work ticks.
  const act = isWorkActivityId(getActivityId(newAct)) ? newAct : prevAct;
  const actId = getActivityId(act);
  if (!isWorkActivityId(actId)) return;

  const prevCount = getGoalCountForMe(prevMe, goal);
  if (prevCount === null) return;

  if (newCount < prevCount) {
    goalRateSamples[actId] = [];
    return;
  }
  if (newCount === prevCount) return;

  const samples = goalRateSamples[actId] ?? [];

  // If the new value is below the last pushed sample the loot bag was drained by
  // a banking trip that straddled non-work ticks (banking→travel transition), so
  // the `newCount < prevCount` branch above was never reached. Clear and restart
  // rather than anchoring the rate to a stale high-water mark.
  const lastSample = samples[samples.length - 1];
  if (lastSample && newCount < lastSample.value) {
    goalRateSamples[actId] = [];
    return;
  }

  pushRateSample(samples, newCount, Date.now(), activeWorkMsForActivity(actId));
  goalRateSamples[actId] = samples;
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
    if (key) {
      hasInvCount = true;
      invCount = inv[key] ?? 0;
    }
  }

  let hasLootCount = false;
  let lbCount = 0;
  if (g.itemId && g.itemId in lb) {
    hasLootCount = true;
    lbCount = lb[g.itemId] ?? 0;
  } else if (g.itemName) {
    const n = norm(g.itemName);
    const key = Object.keys(lb).find((k) => norm(k) === n);
    if (key) {
      hasLootCount = true;
      lbCount = lb[key] ?? 0;
    }
  }

  if (!hasInvCount && !hasLootCount) return 0;
  return Math.max(invCount, lbCount);
}

function trackRunoutConsumption(prevAct, newAct, prevMe, newMe) {
  const act = isWorkActivityId(getActivityId(newAct)) ? newAct : prevAct;
  const actId = getActivityId(act);
  if (!isWorkActivityId(actId)) return;

  const def = ACTIVITY_DEFS[actId];
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
      runoutRateSamples[key] = [];
    } else if (newCount < prevCount) {
      const samples = runoutRateSamples[key] ?? [];
      pushRateSample(samples, newCount, now, activeWorkMsForActivity(actId));
      runoutRateSamples[key] = samples;
    }
  }
}

function getMaterialCountForMe(me, itemId) {
  const inv = me?.inventory?.[itemId] ?? 0;
  const lb = me?.lootBag?.[itemId] ?? 0;
  return inv + lb;
}

function dropRateKey(actId, itemId) {
  return `${actId}:${itemId}`;
}

function isWorkActivityId(actId) {
  return !!actId && actId !== 'travel' && actId !== 'banking';
}

function isCycleCompletion(prevAct, newAct) {
  return !prevAct?.preparedActivity && !!newAct?.preparedActivity;
}

function currentCycleProgressMs(actId, cycleMs) {
  const lastCompletionAt = cycleCalibrations[actId]?.lastCompletionAt;
  if (!lastCompletionAt) return 0;
  return Math.min(cycleMs, Math.max(0, Date.now() - lastCompletionAt));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function producedItemsPerCycle(def) {
  if (!def?.inventoryChanges) return 0;
  return Object.values(def.inventoryChanges)
    .filter((change) => change > 0)
    .reduce((sum, change) => sum + change, 0);
}

function bankTripsForGeneratedItems(generatedItems) {
  if (generatedItems <= 0) return 0;
  return Math.floor(
    (lootBagTotal() + generatedItems) / BANK_TRIGGER_ITEM_COUNT
  );
}

function effectiveTickMsForActivity(actId) {
  const def = actId ? ACTIVITY_DEFS[actId] : null;
  if (!def) return observedTickMs;
  const durationInfo = cycleDurationInfo(def, actId);
  if (!durationInfo.calibrated) return observedTickMs;
  const bundleTicks = def.durationMs / TICK_MS;
  return bundleTicks > 0 ? durationInfo.durationMs / bundleTicks : observedTickMs;
}

function bankOverheadForGeneratedItems(generatedItems, zoneId, actId) {
  const bankTrips = bankTripsForGeneratedItems(generatedItems);
  return {
    bankTrips,
    bankOverheadMs:
      bankTrips * bankTripMs(zoneId, effectiveTickMsForActivity(actId)),
  };
}

function bankOverheadBeforeCompletion(generatedItems, zoneId, actId) {
  const bankTrips = bankTripsBeforeGoalComplete(Math.ceil(generatedItems));
  return {
    bankTrips,
    bankOverheadMs:
      bankTrips * bankTripMs(zoneId, effectiveTickMsForActivity(actId)),
  };
}

function estimateGeneratedItemsForActiveMs(activeMs, def, durationInfo) {
  const perCycle = producedItemsPerCycle(def);
  const durationMs = durationInfo?.durationMs ?? def?.durationMs ?? 0;
  if (activeMs <= 0 || perCycle <= 0 || durationMs <= 0) return 0;
  return Math.ceil(activeMs / durationMs) * perCycle;
}

// ── Status snapshot (for popup) ───────────────────────────────────────────────

function buildStatus() {
  const me = mirroredState.me;
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
  if (goal) {
    const count = getGoalCount(goal.itemName, goal.itemId) ?? 0;
    const effectiveCount = goalHighWaterMark ?? count;
    const eta = etaActId
      ? computeGoalEta(goal, effectiveCount, etaActId, etaAct, etaActIsLive)
      : null;
    goalStatus = { goal, count, eta, chanceBased: eta?.chanceBased === true };
  }

  let runoutStatus = null;
  if (etaActId) {
    const info = runoutInfo(etaActId);
    if (info) {
      const def = ACTIVITY_DEFS[etaActId];
      const durationInfo = cycleDurationInfo(def, etaActId);
      const zoneId = getActivityZone(etaAct);

      // Rate-based runout ETA: observed consumption rate naturally accounts for
      // bank trips and other pauses. Falls back to cycle-based during warmup.
      const runoutKey = `${etaActId}:${info.itemId}`;
      const runoutSamples = runoutRateSamples[runoutKey] ?? [];
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
  if (etaActId && ACTIVITY_DEFS[etaActId]) {
    for (const [id, change] of Object.entries(
      ACTIVITY_DEFS[etaActId].inventoryChanges ?? {}
    )) {
      if (change > 0) producibleItems.push({ id, count: getMaterialCount(id) });
    }
    for (const id of Object.keys(ACTIVITY_DEFS[etaActId].dropItems ?? {})) {
      if (!producibleItems.some((item) => item.id === id)) {
        producibleItems.push({
          id,
          count: getMaterialCount(id),
          chanceBased: true,
        });
      }
    }
  }

  return {
    connected: microscopeTabId !== null,
    activity: actDisplay,
    idle: liveAct === null && prevActivityId !== undefined,
    tickMs: observedTickMs,
    goalStatus,
    runoutStatus,
    skillLevelStatus,
    combatConsumables,
    producibleItems,
    skillNotifyTarget,
    rawMe: me ?? null,
    tickLog,
    etaDebugLogVersion: ETA_DEBUG_LOG_VERSION,
    etaDebugLog,
  };
}

// ── ETA calculation ───────────────────────────────────────────────────────────

function computeGoalEta(
  g,
  currentCount,
  actId,
  actForEta = mirroredState.me?.activity ?? null,
  actIsLive = true
) {
  const remaining = g.targetCount - currentCount;
  if (remaining <= 0) return 0;

  const def = ACTIVITY_DEFS[actId];
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
  const goalSamples = goalRateSamples[actId] ?? [];
  const observedRate = rateFromSamples(goalSamples);
  if (observedRate !== null && observedRate > 0) {
    const producedPerCycle = producedItemsPerCycle(def);
    const generatedItems =
      producedPerCycle > 0
        ? remaining * (producedPerCycle / yieldPerCycle)
        : remaining;
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
  const plan = estimateGoalPlan({
    remaining,
    yieldPerCycle,
    itemsGeneratedPerCycle: producedItemsPerCycle(def),
  });
  const gatherMs = Math.max(
    0,
    fallbackOverheadMs +
      plan.cyclesNeeded * durationInfo.durationMs -
      cycleProgressMs
  );
  const zoneId = getActivityZone(actForEta);
  const bankOverheadMs =
    plan.bankTrips * bankTripMs(zoneId, effectiveTickMsForActivity(actId));

  return {
    totalMs: gatherMs + bankOverheadMs,
    bankTrips: plan.bankTrips,
    cyclesNeeded: plan.cyclesNeeded,
    cycleDurationMs: durationInfo.durationMs,
    observedCycleDurationMs: durationInfo.observedDurationMs,
    cycleSamples: durationInfo.sampleCount,
    calibrated: durationInfo.calibrated,
  };
}

function estimateGoalPlan({
  remaining,
  yieldPerCycle,
  itemsGeneratedPerCycle,
}) {
  const cyclesNeeded = Math.ceil(remaining / yieldPerCycle);
  const generatedItems = cyclesNeeded * itemsGeneratedPerCycle;
  const bankTrips = bankTripsBeforeGoalComplete(generatedItems);
  return { cyclesNeeded, bankTrips };
}

function bankTripsBeforeGoalComplete(generatedItems) {
  if (generatedItems <= 0) return 0;

  const lootBagItems = lootBagTotal();
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

function computeSkillLevelEtas(actId, skill, act) {
  const def = ACTIVITY_DEFS[actId];
  const xpPerCycle = def?.xpPerCycle ?? 0;
  const observedRate = observedXpPerMs(actId, skill);
  const mayGainXp = xpPerCycle > 0 || observedRate || isCombatActivity(act);
  if (!mayGainXp || XP_TABLE.length < 3) return null;
  const durationInfo = def ? cycleDurationInfo(def, actId) : null;
  const zoneId = getActivityZone(act);

  const currentXp = mirroredState.me?.exp?.[skill];
  if (typeof currentXp !== 'number' || !isFinite(currentXp)) return null;

  const currentLevel = getLevelFromXp(currentXp);
  const etas = [];
  for (let offset = 1; offset <= 10; offset++) {
    const targetLevel = currentLevel + offset;
    const targetXp = XP_TABLE[targetLevel];
    if (typeof targetXp !== 'number') break;

    const xpNeeded = Math.max(0, targetXp - currentXp);
    let etaMs = null;
    let bankTrips = 0;
    let bankOverheadMs = 0;
    if (observedRate) {
      const activeMs = Math.ceil(xpNeeded / observedRate);
      const generatedItems = estimateGeneratedItemsForActiveMs(
        activeMs,
        def,
        durationInfo
      );
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

// ── Runout info ───────────────────────────────────────────────────────────────
// Returns the bottleneck consumed material — the one that will run out first.
// For multi-input activities (e.g. soft clay: clay + water) this finds the
// input with the fewest cycles remaining, not just the first one listed.

function runoutInfo(actId) {
  const def = ACTIVITY_DEFS[actId];
  if (!def) return null;

  // Consumed items are drawn from inventory only — loot bag items can't be
  // used directly and would inflate the count if included via getMaterialCount.
  const inv = mirroredState.me?.inventory ?? {};

  let bottleneck = null;
  for (const [itemId, change] of Object.entries(def.inventoryChanges)) {
    if (change >= 0) continue;
    const costPerCycle = -change;
    const available = inv[itemId] ?? 0;
    const cyclesLeft = Math.floor(available / costPerCycle);
    if (!bottleneck || cyclesLeft < bottleneck.cyclesLeft) {
      bottleneck = {
        itemId,
        costPerCycle,
        totalMaterial: available,
        cyclesLeft,
        durationMs: cycleDurationMs(def, actId),
      };
    }
  }

  return bottleneck; // null if no consumed materials (gathering, combat, etc.)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Total material available = inventory + lootBag
function getMaterialCount(itemId) {
  const me = mirroredState.me;
  const inv = me?.inventory?.[itemId] ?? 0;
  const lb = me?.lootBag?.[itemId] ?? 0;
  return inv + lb;
}

// Total items currently occupying the loot bag (all types combined)
function lootBagTotal() {
  const lb = mirroredState.me?.lootBag;
  if (!lb) return 0;
  return Object.values(lb).reduce((sum, n) => sum + n, 0);
}

function getLootBagCount(itemId) {
  return mirroredState.me?.lootBag?.[itemId] ?? 0;
}

function getGoalCount(itemName, itemId) {
  const inv = getInventoryCount(itemName, itemId);
  const lootKey = itemId ?? findLootBagKey(itemName);
  const lb = lootKey ? getLootBagCount(lootKey) : 0;
  if (inv === null && !lootKey) return null;
  return Math.max(inv ?? 0, lb);
}

function getInventoryCount(itemName, itemId) {
  const inv = mirroredState.me?.inventory;
  if (!inv || typeof inv !== 'object') return null;
  if (itemId && itemId in inv) return inv[itemId];
  if (itemName) {
    const key = findInventoryKey(itemName);
    if (key) return inv[key];
  }
  return 0;
}

// Case-insensitive, whitespace-ignoring key lookup against inventory
function findInventoryKey(itemName) {
  const inv = mirroredState.me?.inventory;
  if (!inv) return null;
  const norm = itemName.toLowerCase().replace(/[\s_-]/g, '');
  return (
    Object.keys(inv).find(
      (k) => k.toLowerCase().replace(/[\s_-]/g, '') === norm
    ) ?? null
  );
}

function findLootBagKey(itemName) {
  const lb = mirroredState.me?.lootBag;
  if (!lb || !itemName) return null;
  const norm = itemName.toLowerCase().replace(/[\s_-]/g, '');
  return (
    Object.keys(lb).find(
      (k) => k.toLowerCase().replace(/[\s_-]/g, '') === norm
    ) ?? null
  );
}

// Same lookup against an arbitrary object (used for inventoryChanges keys)
function findKey(obj, itemName, itemId) {
  if (!obj) return null;
  if (itemId && itemId in obj) return itemId;
  if (!itemName) return null;
  const norm = itemName.toLowerCase().replace(/[\s_-]/g, '');
  return (
    Object.keys(obj).find(
      (k) => k.toLowerCase().replace(/[\s_-]/g, '') === norm
    ) ?? null
  );
}

function getLevelFromXp(xp) {
  if (XP_TABLE.length < 3) return 1;

  let lo = 1;
  let hi = XP_TABLE.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (XP_TABLE[mid] <= xp) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, hi);
}

function isValidXpTable(table) {
  return (
    Array.isArray(table) &&
    table.length >= 99 &&
    table[1] === 0 &&
    table[2] === 830 &&
    table[17] === 31174
  );
}

function computeMicroscapeXpTable() {
  const table = [0, 0];
  let points = 0;
  for (let level = 1; level <= 98; level++) {
    points += Math.floor(10 * (level + 300 * Math.pow(2, level / 7)));
    table.push(Math.floor(points / 4));
  }
  return table;
}

function calibrateTick() {
  const now = Date.now();
  if (lastUpdateAt !== null) {
    const d = now - lastUpdateAt;
    if (d > 500 && d < 10_000) {
      pushCappedSample(tickSamples, d, TICK_SAMPLE_LIMIT);
      observedTickMs = Math.round(
        tickSamples.reduce((a, b) => a + b, 0) / tickSamples.length
      );
    }
  }
  lastUpdateAt = now;
}

function isDuplicateServerUpdate(delta) {
  const now = Date.now();
  let signature;
  try {
    signature = JSON.stringify(delta);
  } catch {
    signature = null;
  }

  if (
    signature &&
    signature === lastServerUpdateSignature &&
    now - lastServerUpdateAt < 100
  ) {
    return true;
  }

  lastServerUpdateSignature = signature;
  lastServerUpdateAt = now;
  return false;
}

// ── Notifications and audio ───────────────────────────────────────────────────

function fireNotification(id, title, message) {
  chrome.notifications.create(`mm-${id}-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title,
    message,
    priority: 2,
  });
}

function sendChime(variant) {
  if (microscopeTabId == null) return;
  chrome.tabs
    .sendMessage(microscopeTabId, { type: 'PLAY_CHIME', variant })
    .catch(() => {});
}

function mergeMissingActivityDefs(cachedDefs, seedDefs) {
  if (!cachedDefs || Object.keys(cachedDefs).length === 0) {
    return { defs: seedDefs ?? {}, added: false };
  }

  const defs = { ...cachedDefs };
  let added = false;
  for (const [id, def] of Object.entries(seedDefs ?? {})) {
    if (!(id in defs)) {
      defs[id] = def;
      added = true;
    }
  }
  return { defs, added };
}

function resetTestState() {
  ACTIVITY_DEFS = {};
  ZONE_DATA = {};
  XP_TABLE = computeMicroscapeXpTable();
  mirroredState = {};
  prevActivityId = undefined;
  microscopeTabId = null;
  observedTickMs = 2000;
  observedOverheadTicks = 6;
  tickSamples = [];
  lastUpdateAt = null;
  lastServerUpdateSignature = null;
  lastServerUpdateAt = 0;
  if (etaCalibrationSaveTimer !== null) {
    clearTimeout(etaCalibrationSaveTimer);
    etaCalibrationSaveTimer = null;
  }
  tickLog = [];
  etaDebugLog = [];
  cycleCalibrations = {};
  xpRateSamples = {};
  dropRateSamples = {};
  combatConsumableSamples = {};
  activeRateClocks = {};
  lastRateClockAt = null;
  goalRateSamples = {};
  goalHighWaterMark = null;
  runoutRateSamples = {};
  lastWorkActivity = null;
  goal = null;
  goalNotifiedAt = null;
  runoutNotifiedFor = null;
  skillNotifyTarget = null;
}

function setTestState({
  activityDefs,
  zoneData,
  xpTable,
  state,
  lastWorkAct,
  tickMs,
} = {}) {
  if (activityDefs) ACTIVITY_DEFS = activityDefs;
  if (zoneData) ZONE_DATA = zoneData;
  if (xpTable) XP_TABLE = xpTable;
  if (state) mirroredState = state;
  if (lastWorkAct !== undefined) lastWorkActivity = lastWorkAct;
  if (tickMs) observedTickMs = tickMs;
}

export const __test = {
  buildStatus,
  computeSkillLevelEtas,
  mergeMissingActivityDefs,
  resetTestState,
  runoutInfo,
  setTestState,
};

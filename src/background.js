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
//   me.lootBag           — { camelCaseItemId: count }  materials queued for processing
//
// Duration formula (confirmed from bundle):
//   displayedSeconds = (activityDef.duration + 6) * 2   →  durationMs = (duration + 6) * 2000

const BANK_TRIGGER_ITEM_COUNT = 25;
const CYCLE_SAMPLE_LIMIT = 100;
const XP_RATE_SAMPLE_LIMIT = 100;
const DROP_RATE_SAMPLE_LIMIT = 100;
const COMBAT_CONSUMABLE_SAMPLE_LIMIT = 100;
const TICK_SAMPLE_LIMIT = 100;

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

chrome.storage.local.get(['activityDefs', 'zoneData', 'xpTable', 'skillNotifyTarget'], (res) => {
  if (res.activityDefs && Object.keys(res.activityDefs).length > 0) {
    ACTIVITY_DEFS = res.activityDefs;
  } else {
    // No cache yet — bootstrap from the bundled static seed
    fetch(chrome.runtime.getURL('src/activity-defs.json'))
      .then((r) => r.json())
      .then((data) => {
        if (Object.keys(ACTIVITY_DEFS).length === 0) ACTIVITY_DEFS = data;
      })
      .catch(() => {});
  }
  if (res.zoneData) ZONE_DATA = res.zoneData;
  if (isValidXpTable(res.xpTable)) XP_TABLE = res.xpTable;
  if (res.skillNotifyTarget) skillNotifyTarget = res.skillNotifyTarget;
});

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

let tickLog = []; // newest-first, capped at 40 entries
let cycleCalibrations = {}; // activityId -> { lastCompletionAt, samples }
let xpRateSamples = {}; // "activityId:skill" -> { lastGainAt, samples: [{ xp, ms }] }
let dropRateSamples = {}; // "activityId:itemId" -> { lastGainAt, samples: [{ items, ms }] }

let goal = null; // { itemName, itemId, targetCount }
let goalNotifiedAt = null;
let runoutNotifiedFor = null;
let skillNotifyTarget = null; // { skill, level }

let combatConsumableSamples = {}; // "actId:itemId" -> { lastConsumedAt, samples: [{ count, ms }] }

chrome.storage.session.get(['goal'], (res) => {
  if (res.goal) goal = res.goal;
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
      chrome.storage.session.set({ goal });
      respond({ ok: true });
      break;

    case 'CLEAR_GOAL':
      goal = null;
      goalNotifiedAt = null;
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

  calibrateTick();
  const prevAct = mirroredState.me?.activity;
  const prevExp = mirroredState.me?.exp;
  const prevMe = mirroredState.me;
  const preSnap = snapshotEta();

  mirroredState = applyPatch(mirroredState, frame.args[0]);
  const newAct = mirroredState.me?.activity;
  trackXpGain(prevAct, newAct, prevExp, mirroredState.me?.exp);
  trackDropGain(prevAct, newAct, prevMe, mirroredState.me);
  trackCombatConsumables(prevAct, newAct, prevMe, mirroredState.me);

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

  pushTickEntry(preSnap, snapshotEta());

  detectIdleTransition();
  detectGoalReached();
  detectMaterialRunout();
  detectSkillLevelReached();
}

function pushCappedSample(samples, sample, limit) {
  samples.push(sample);
  if (samples.length > limit) samples.shift();
}

// ── Tick log helpers ──────────────────────────────────────────────────────────

function snapshotEta() {
  const me = mirroredState.me;
  const act = me?.activity ?? null;
  const actId = getActivityId(act);
  const phase =
    act?.type === 'travel'
      ? 'travel'
      : act?.type === 'banking'
        ? 'banking'
        : act?.preparedActivity
          ? 'overhead'
          : actId
            ? 'active'
            : null;
  const def = actId ? ACTIVITY_DEFS[actId] : null;
  const info = def && actId ? runoutInfo(actId) : null;
  const durationInfo = def ? cycleDurationInfo(def, actId) : null;
  const cycleDurMs = durationInfo?.durationMs ?? null;
  const cycleProgressMs = durationInfo?.calibrated
    ? currentCycleProgressMs(actId, cycleDurMs)
    : 0;
  const fallbackOverheadMs =
    !durationInfo?.calibrated && act?.preparedActivity
      ? (act.remaining ?? 0) * TICK_MS
      : 0;
  const itemsGenerated =
    info && def ? info.cyclesLeft * producedItemsPerCycle(def) : 0;
  const zoneId = getActivityZone(act);
  const { bankTrips, bankOverheadMs } = bankOverheadForGeneratedItems(
    itemsGenerated,
    zoneId,
    actId
  );
  const etaMs =
    info && cycleDurMs != null
      ? Math.max(
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
          getGoalCount(goal.itemName, goal.itemId) ?? 0,
          actId
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
    actRemaining: act?.remaining ?? null,
    actLength: act?.length ?? null,
    observedTickMs,
    goalEtaMs: goalEta?.totalMs ?? null,
    goalBankTrips: goalEta?.bankTrips ?? null,
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

function handleClientFrame(frame) {
  if (frame.event !== 'input:game' || !frame.args?.length) return;
  if (frame.args[0]?.type !== 'stop-activity') return;
  if (!mirroredState.me) return;
  // Immediately mirror the stop — don't wait for the server update
  mirroredState = {
    ...mirroredState,
    me: { ...mirroredState.me, activity: null },
  };
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
  return {
    durationMs: calibrated
      ? Math.min(observedDurationMs, def.durationMs)
      : def.durationMs,
    observedDurationMs,
    sampleCount: samples.length,
    calibrated,
  };
}

function cycleDurationMs(def, actId) {
  return cycleDurationInfo(def, actId).durationMs;
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

function trackXpGain(prevAct, newAct, prevExp, newExp) {
  if (!prevExp || !newExp) return;

  const act = getActivitySkill(newAct) ? newAct : prevAct;
  const actId = getActivityId(act);
  const skill = getActivitySkill(act);
  if (!isWorkActivityId(actId) || !skill) return;

  const before = prevExp[skill];
  const after = newExp[skill];
  if (typeof before !== 'number' || typeof after !== 'number') return;

  const xpGained = after - before;
  if (xpGained <= 0) return;

  const key = xpRateKey(actId, skill);
  const now = Date.now();
  const tracker = xpRateSamples[key] ?? { lastGainAt: null, samples: [] };
  let sampleMs = tracker.lastGainAt ? now - tracker.lastGainAt : null;

  if (!sampleMs || sampleMs < 250 || sampleMs > 10 * 60_000) {
    sampleMs =
      activityLengthMs(act) ?? ACTIVITY_DEFS[actId]?.durationMs ?? null;
  }

  if (sampleMs && sampleMs > 0) {
    pushCappedSample(
      tracker.samples,
      { xp: xpGained, ms: sampleMs },
      XP_RATE_SAMPLE_LIMIT
    );
  }
  tracker.lastGainAt = now;
  xpRateSamples[key] = tracker;
}

function activityLengthMs(act) {
  const length = act?.length ?? act?.preparedActivity?.length;
  return typeof length === 'number' && length > 0
    ? length * observedTickMs
    : null;
}

function xpRateKey(actId, skill) {
  return `${actId}:${skill}`;
}

function observedXpPerMs(actId, skill) {
  const samples = xpRateSamples[xpRateKey(actId, skill)]?.samples ?? [];
  const totals = samples.reduce(
    (acc, sample) => {
      acc.xp += sample.xp;
      acc.ms += sample.ms;
      return acc;
    },
    { xp: 0, ms: 0 }
  );
  return totals.xp > 0 && totals.ms > 0 ? totals.xp / totals.ms : null;
}

function trackDropGain(prevAct, newAct, prevMe, newMe) {
  if (!prevMe || !newMe) return;

  const act = getActivityId(newAct) ? newAct : prevAct;
  const actId = getActivityId(act);
  if (!isWorkActivityId(actId)) return;

  const dropItems = ACTIVITY_DEFS[actId]?.dropItems;
  if (!dropItems || Object.keys(dropItems).length === 0) return;

  for (const itemId of Object.keys(dropItems)) {
    const before = getMaterialCountForMe(prevMe, itemId);
    const after = getMaterialCountForMe(newMe, itemId);
    const gained = after - before;
    if (gained <= 0) continue;

    const key = dropRateKey(actId, itemId);
    const now = Date.now();
    const tracker = dropRateSamples[key] ?? { lastGainAt: null, samples: [] };
    if (tracker.lastGainAt) {
      const sampleMs = now - tracker.lastGainAt;
      if (sampleMs >= 250 && sampleMs <= 30 * 60_000) {
        pushCappedSample(
          tracker.samples,
          { items: gained, ms: sampleMs },
          DROP_RATE_SAMPLE_LIMIT
        );
      }
    }
    tracker.lastGainAt = now;
    dropRateSamples[key] = tracker;
  }
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
    const consumed = (prevInv[itemId] ?? 0) - (newInv[itemId] ?? 0);
    if (consumed <= 0) continue;

    const key = `${actId}:${itemId}`;
    const tracker = combatConsumableSamples[key] ?? { lastConsumedAt: null, samples: [] };
    if (tracker.lastConsumedAt !== null) {
      const sampleMs = now - tracker.lastConsumedAt;
      if (sampleMs >= 500 && sampleMs <= 60 * 60_000) {
        pushCappedSample(
          tracker.samples,
          { count: consumed, ms: sampleMs },
          COMBAT_CONSUMABLE_SAMPLE_LIMIT
        );
      }
    }
    tracker.lastConsumedAt = now;
    combatConsumableSamples[key] = tracker;
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
    const totalConsumed = tracker.samples.reduce((s, x) => s + x.count, 0);
    const totalMs = tracker.samples.reduce((s, x) => s + x.ms, 0);
    const ratePerMs = totalMs > 0 ? totalConsumed / totalMs : null;
    const etaMs = ratePerMs && currentCount > 0
      ? Math.round(currentCount / ratePerMs)
      : null;

    items.push({ itemId, currentCount, etaMs, sampleCount: tracker.samples.length });
  }

  return items.length > 0 ? items : null;
}

function getMaterialCountForMe(me, itemId) {
  const inv = me?.inventory?.[itemId] ?? 0;
  const lb = me?.lootBag?.[itemId] ?? 0;
  return inv + lb;
}

function dropRateKey(actId, itemId) {
  return `${actId}:${itemId}`;
}

function observedDropItemsPerMs(actId, itemId) {
  const samples = dropRateSamples[dropRateKey(actId, itemId)]?.samples ?? [];
  const totals = samples.reduce(
    (acc, sample) => {
      acc.items += sample.items;
      acc.ms += sample.ms;
      return acc;
    },
    { items: 0, ms: 0 }
  );
  return totals.items > 0 && totals.ms > 0 ? totals.items / totals.ms : null;
}

function dropRateSampleCount(actId, itemId) {
  return dropRateSamples[dropRateKey(actId, itemId)]?.samples.length ?? 0;
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
  if (!def) return TICK_MS;
  const durationInfo = cycleDurationInfo(def, actId);
  if (!durationInfo.calibrated) return TICK_MS;
  const bundleTicks = def.durationMs / TICK_MS;
  return bundleTicks > 0 ? durationInfo.durationMs / bundleTicks : TICK_MS;
}

function bankOverheadForGeneratedItems(generatedItems, zoneId, actId) {
  const bankTrips = bankTripsForGeneratedItems(generatedItems);
  return {
    bankTrips,
    bankOverheadMs:
      bankTrips * bankTripMs(zoneId, effectiveTickMsForActivity(actId)),
  };
}

// ── Status snapshot (for popup) ───────────────────────────────────────────────

function buildStatus() {
  const me = mirroredState.me;
  const act = me?.activity ?? null;

  const actSkill = getActivitySkill(act);
  const actId = getActivityId(act);
  const actDisplay =
    actId === 'travel'
      ? 'Traveling'
      : actId === 'banking'
        ? 'Banking'
        : actSkill && actId
          ? `${actSkill} — ${actId}`
          : (actId ?? actSkill ?? null);

  let goalStatus = null;
  if (goal) {
    const count = getGoalCount(goal.itemName, goal.itemId) ?? 0;
    const eta = actId ? computeGoalEta(goal, count, actId) : null;
    goalStatus = { goal, count, eta, chanceBased: eta?.chanceBased === true };
  }

  let runoutStatus = null;
  if (actId) {
    const info = runoutInfo(actId);
    if (info) {
      const def = ACTIVITY_DEFS[actId];
      const durationInfo = cycleDurationInfo(def, actId);
      const cycleProgressMs = durationInfo.calibrated
        ? currentCycleProgressMs(actId, durationInfo.durationMs)
        : 0;
      const fallbackOverheadMs =
        !durationInfo.calibrated && act?.preparedActivity
          ? (act.remaining ?? 0) * TICK_MS
          : 0;
      const itemsGenerated = info.cyclesLeft * producedItemsPerCycle(def);
      const zoneId = getActivityZone(act);
      const { bankTrips, bankOverheadMs } = bankOverheadForGeneratedItems(
        itemsGenerated,
        zoneId,
        actId
      );
      const etaMs = Math.max(
        0,
        fallbackOverheadMs +
          info.cyclesLeft * durationInfo.durationMs -
          cycleProgressMs +
          bankOverheadMs
      );
      runoutStatus = {
        itemId: info.itemId,
        totalMaterial: info.totalMaterial,
        cyclesLeft: info.cyclesLeft,
        itemsGenerated,
        bankTrips,
        bankOverheadMs,
        cycleDurationMs: durationInfo.durationMs,
        observedCycleDurationMs: durationInfo.observedDurationMs,
        cycleProgressMs,
        cycleSamples: durationInfo.sampleCount,
        calibrated: durationInfo.calibrated,
        etaMs,
      };
    }
  }

  const skillLevelStatus =
    actId && actSkill ? computeSkillLevelEtas(actId, actSkill, act) : null;

  const combatConsumables =
    act && isCombatActivity(act) ? computeCombatConsumableStatus(act) : null;

  // Items the current activity produces — drives the goal dropdown
  const producibleItems = [];
  if (actId && ACTIVITY_DEFS[actId]) {
    for (const [id, change] of Object.entries(
      ACTIVITY_DEFS[actId].inventoryChanges ?? {}
    )) {
      if (change > 0) producibleItems.push({ id, count: getMaterialCount(id) });
    }
    for (const id of Object.keys(ACTIVITY_DEFS[actId].dropItems ?? {})) {
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
    idle: act === null && prevActivityId !== undefined,
    tickMs: observedTickMs,
    goalStatus,
    runoutStatus,
    skillLevelStatus,
    combatConsumables,
    producibleItems,
    skillNotifyTarget,
    rawMe: me ?? null,
    tickLog,
  };
}

// ── ETA calculation ───────────────────────────────────────────────────────────

function computeGoalEta(g, currentCount, actId) {
  const remaining = g.targetCount - currentCount;
  if (remaining <= 0) return 0;

  const def = ACTIVITY_DEFS[actId];
  if (!def) return null;

  const dropKey = findKey(def.dropItems, g.itemName, g.itemId);
  if (dropKey) {
    const observedRate = observedDropItemsPerMs(actId, dropKey);
    return {
      chanceBased: true,
      totalMs: observedRate ? Math.ceil(remaining / observedRate) : null,
      sampleCount: dropRateSampleCount(actId, dropKey),
    };
  }

  // Find the goal item in the activity's output (positive inventoryChanges)
  const goalKey = findKey(def.inventoryChanges, g.itemName, g.itemId);
  const yieldPerCycle = goalKey ? (def.inventoryChanges[goalKey] ?? 0) : 0;
  if (yieldPerCycle <= 0) return null; // this activity doesn't produce the goal item

  const act = mirroredState.me?.activity ?? null;
  const durationInfo = cycleDurationInfo(def, actId);
  const cycleProgressMs = durationInfo.calibrated
    ? currentCycleProgressMs(actId, durationInfo.durationMs)
    : 0;
  const fallbackOverheadMs =
    !durationInfo.calibrated && act?.preparedActivity
      ? (act.remaining ?? 0) * TICK_MS
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
  const zoneId = getActivityZone(act);
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

  const currentXp = mirroredState.me?.exp?.[skill];
  if (typeof currentXp !== 'number' || !isFinite(currentXp)) return null;

  const currentLevel = getLevelFromXp(currentXp);
  const etas = [];
  for (let offset = 1; offset <= 10; offset++) {
    const targetLevel = currentLevel + offset;
    const targetXp = XP_TABLE[targetLevel];
    if (typeof targetXp !== 'number') break;

    const xpNeeded = Math.max(0, targetXp - currentXp);
    const cyclesNeeded =
      xpPerCycle > 0 ? Math.ceil(xpNeeded / xpPerCycle) : null;
    const etaMs =
      xpPerCycle > 0
        ? cyclesNeeded * def.durationMs
        : observedRate
          ? Math.ceil(xpNeeded / observedRate)
          : null;
    etas.push({
      targetLevel,
      xpNeeded,
      etaMs,
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
  return (inv ?? 0) + lb;
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

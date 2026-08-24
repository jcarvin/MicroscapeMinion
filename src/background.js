// Background service worker — state mirror, detection engine, alert dispatcher.
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

import { state } from './state.js';
import { ETA_CALIBRATION_CACHE_KEY } from './constants.js';
import { computeMicroscapeXpTable, isValidXpTable, getLevelFromXp } from './xp.js';
import { applyPatch } from './patch.js';
import {
  getActivityId,
  getActivitySkill,
  isWorkActivityId,
  rememberWorkActivity,
} from './activity-utils.js';
import { getGoalCount, sameGoalItem } from './inventory.js';
import { runoutInfo } from './runout.js';
import {
  hydrateEtaCalibrationCache,
  calibrateTick,
  calibrateCycleDuration,
  resetCycleAnchorOnInterruption,
  isDuplicateServerUpdate,
} from './calibration.js';
import {
  advanceActiveRateClock,
  trackXpGain,
  trackDropGain,
  trackCombatConsumables,
  trackGoalAccumulation,
  trackRunoutConsumption,
} from './rate-tracker.js';
import { snapshotEta, computeSkillLevelEtas } from './eta.js';
import { pushTickEntry, pushTickEvent, safelyPushEtaDebugEntry } from './debug-log.js';
import { buildStatus } from './status.js';
import { fireNotification, sendChime } from './notify.js';
import { buildOwnedCounts, planGoals } from './goal-planner.js';

// ── Startup ───────────────────────────────────────────────────────────────────

// Seed activity defs from the bundled JSON — saved at startup so the live
// ACTIVITY_DEFS handler can backfill inventoryChanges for any activity the
// game parser extracted without it (e.g. batch activities with extra fields).
let seedActivityDefs = {};

chrome.storage.local.get(
  ['activityDefs', 'zoneData', 'xpTable', 'skillNotifyTarget', ETA_CALIBRATION_CACHE_KEY, 'consumableNotifyItems', 'notificationsEnabled'],
  (res) => {
    fetch(chrome.runtime.getURL('src/activity-defs.json'))
      .then((r) => r.json())
      .then((seed) => {
        seedActivityDefs = seed ?? {};
        const storedMerge = mergeMissingActivityDefs(res.activityDefs, seed);
        // Live bundle parsing can finish before this extension-resource fetch.
        // Keep its routes authoritative, but backfill planner metadata when an
        // older page/content script sent definitions without required levels.
        const hasLiveDefs = Object.keys(state.ACTIVITY_DEFS).length > 0;
        const liveMerge = hasLiveDefs
          ? enrichActivityMetadata(state.ACTIVITY_DEFS, storedMerge.defs)
          : null;
        const defs = liveMerge?.defs ?? storedMerge.defs;
        const added = liveMerge?.added ?? storedMerge.added;
        state.ACTIVITY_DEFS = defs;
        if (added) chrome.storage.local.set({ activityDefs: state.ACTIVITY_DEFS });
        refreshGoalPlanning();
      })
      .catch(() => {
        if (
          Object.keys(state.ACTIVITY_DEFS).length === 0
          && res.activityDefs
          && Object.keys(res.activityDefs).length > 0
        ) {
          state.ACTIVITY_DEFS = res.activityDefs;
          refreshGoalPlanning();
        }
      });
    if (res.zoneData) state.ZONE_DATA = res.zoneData;
    if (isValidXpTable(res.xpTable)) state.XP_TABLE = res.xpTable;
    if (res.skillNotifyTarget) state.skillNotifyTarget = res.skillNotifyTarget;
    if (Array.isArray(res.consumableNotifyItems)) {
      state.consumableNotifyItems = new Set(res.consumableNotifyItems);
    }
    if (typeof res.notificationsEnabled === 'boolean') {
      state.notificationsEnabled = res.notificationsEnabled;
    }
    hydrateEtaCalibrationCache(res[ETA_CALIBRATION_CACHE_KEY]);
  }
);

chrome.storage.local.get(['goals', 'goal'], (localRes) => {
  chrome.storage.session.get(['goals', 'goal', 'lastWorkActivity'], (sessionRes) => {
    const hasLocalGoals = Array.isArray(localRes.goals);
    const hasLocalLegacyGoal = !hasLocalGoals && Boolean(localRes.goal);
    const storedGoals = hasLocalGoals
      ? localRes.goals
      : hasLocalLegacyGoal
        ? [localRes.goal]
        : Array.isArray(sessionRes.goals)
          ? sessionRes.goals
          : sessionRes.goal
            ? [sessionRes.goal]
            : [];

    state.goals = normalizeGoals(storedGoals);
    for (const goal of state.goals) {
      state.goalHighWaterMark[goal.id] = getGoalCount(goal.itemName, goal.itemId) ?? 0;
      state.goalNotifiedAt[goal.id] = null;
    }

    if (
      !hasLocalGoals ||
      hasLocalLegacyGoal ||
      JSON.stringify(storedGoals) !== JSON.stringify(state.goals)
    ) {
      chrome.storage.local.set({ goals: state.goals });
    }
    if (hasLocalLegacyGoal) chrome.storage.local.remove('goal');

    // Goals used to live in session storage. Remove both old shapes after
    // importing them so an intentionally empty durable list cannot resurrect
    // stale goals on a later service-worker restart.
    chrome.storage.session.remove(['goals', 'goal']);

    if (sessionRes.lastWorkActivity) state.lastWorkActivity = sessionRes.lastWorkActivity;
    state.goalsLoaded = true;
    refreshGoalPlanning();
  });
});

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.__mm) {
    if (sender.tab?.id) state.microscopeTabId = sender.tab.id;
    if (msg.direction === 'server') handleServerFrame(msg.frame);
    if (msg.direction === 'client') handleClientFrame(msg.frame);
    if (
      msg.type === 'ACTIVITY_DEFS' &&
      msg.defs &&
      Object.keys(msg.defs).length > 0
    ) {
      // Backfill inventoryChanges from seed for any activity the live parser
      // extracted without it (e.g. batch activities with extra numeric fields
      // that the regex didn't anticipate).
      const liveDefs = { ...msg.defs };
      for (const [id, seedDef] of Object.entries(seedActivityDefs)) {
        if (!seedDef?.inventoryChanges) continue;
        if (liveDefs[id]) {
          if (!liveDefs[id].inventoryChanges || Object.keys(liveDefs[id].inventoryChanges).length === 0) {
            liveDefs[id] = { ...liveDefs[id], inventoryChanges: seedDef.inventoryChanges };
          }
        } else {
          liveDefs[id] = seedDef;
        }
      }
      state.ACTIVITY_DEFS = liveDefs;
      const toCache = { activityDefs: msg.defs };
      if (msg.zones && Object.keys(msg.zones).length > 0) {
        state.ZONE_DATA = msg.zones;
        toCache.zoneData = msg.zones;
      }
      if (isValidXpTable(msg.xpTable)) {
        state.XP_TABLE = msg.xpTable;
        toCache.xpTable = msg.xpTable;
      }
      chrome.storage.local.set(toCache);
      refreshGoalPlanning();
    }
    return;
  }

  switch (msg?.type) {
    case 'SET_GOALS': {
      const submittedGoals = normalizeGoals(msg.goals);
      const planning = calculateGoalPlanning(submittedGoals);
      const nextGoals = planning.goals;
      const prevGoalsMap = new Map(state.goals.map(g => [g.id, g]));
      const nextIds = new Set(nextGoals.map(g => g.id));

      for (const g of nextGoals) {
        const prev = prevGoalsMap.get(g.id);
        if (!prev) {
          state.goalHighWaterMark[g.id] = getGoalCount(g.itemName, g.itemId) ?? 0;
          state.goalNotifiedAt[g.id] = null;
        } else if (!sameGoalItem(prev, g)) {
          for (const key of Object.keys(state.goalRateSamples)) {
            if (key.endsWith(`:${g.id}`)) delete state.goalRateSamples[key];
          }
          delete state.goalPreliminaryEtaCache[g.id];
          state.goalHighWaterMark[g.id] = getGoalCount(g.itemName, g.itemId) ?? 0;
          state.goalNotifiedAt[g.id] = null;
        } else if (prev.targetCount !== g.targetCount) {
          state.goalNotifiedAt[g.id] = null;
        }
      }

      for (const prevGoal of state.goals) {
        if (!nextIds.has(prevGoal.id)) {
          delete state.goalHighWaterMark[prevGoal.id];
          delete state.goalNotifiedAt[prevGoal.id];
          delete state.goalPreliminaryEtaCache[prevGoal.id];
          for (const key of Object.keys(state.goalRateSamples)) {
            if (key.endsWith(`:${prevGoal.id}`)) delete state.goalRateSamples[key];
          }
        }
      }

      state.goals = nextGoals;
      state.goalPlans = planning.plans;
      chrome.storage.local.set({ goals: state.goals });
      respond({
        ok: true,
        goals: state.goals,
        goalStatuses: buildStatus().goalStatuses,
      });
      break;
    }

    case 'GET_STATUS':
      refreshGoalPlanning();
      respond(buildStatus());
      break;

    case 'GET_ACTIVITY_DEFS': {
      const filter = msg.filter ? String(msg.filter).toLowerCase() : null;
      const entries = Object.entries(state.ACTIVITY_DEFS);
      const filtered = filter
        ? entries.filter(([k]) => k.toLowerCase().includes(filter))
        : entries;
      respond({ defs: Object.fromEntries(filtered) });
      break;
    }

    case 'SET_SKILL_NOTIFY':
      state.skillNotifyTarget = { skill: msg.skill, level: msg.level };
      chrome.storage.local.set({ skillNotifyTarget: state.skillNotifyTarget });
      respond({ ok: true });
      break;

    case 'CLEAR_SKILL_NOTIFY':
      state.skillNotifyTarget = null;
      chrome.storage.local.remove('skillNotifyTarget');
      respond({ ok: true });
      break;

    case 'SET_CONSUMABLE_NOTIFY':
      state.consumableNotifyItems.add(msg.itemId);
      chrome.storage.local.set({ consumableNotifyItems: [...state.consumableNotifyItems] });
      respond({ ok: true });
      break;

    case 'CLEAR_CONSUMABLE_NOTIFY':
      state.consumableNotifyItems.delete(msg.itemId);
      state.consumableNotifiedFor.delete(msg.itemId);
      chrome.storage.local.set({ consumableNotifyItems: [...state.consumableNotifyItems] });
      respond({ ok: true });
      break;

    case 'SET_NOTIFICATIONS_ENABLED':
      state.notificationsEnabled = Boolean(msg.enabled);
      chrome.storage.local.set({ notificationsEnabled: state.notificationsEnabled });
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
  const prevAct = state.mirroredState.me?.activity;
  const prevExp = state.mirroredState.me?.exp;
  const prevMe = state.mirroredState.me;
  const preSnap = snapshotEta();
  advanceActiveRateClock(prevAct, now);

  state.mirroredState = applyPatch(state.mirroredState, frame.args[0]);
  const newAct = state.mirroredState.me?.activity;
  // Snapshot the previous work activity ID before rememberWorkActivity updates it
  rememberWorkActivity(newAct);
  trackXpGain(prevAct, newAct, prevExp, state.mirroredState.me?.exp);
  trackDropGain(prevAct, newAct, prevMe, state.mirroredState.me);
  trackCombatConsumables(prevAct, newAct, prevMe, state.mirroredState.me);
  trackGoalAccumulation(prevAct, newAct, prevMe, state.mirroredState.me);
  trackRunoutConsumption(prevAct, newAct, prevMe, state.mirroredState.me);
  refreshGoalPlanning();

  if (
    newAct?.preparedActivity &&
    !prevAct?.preparedActivity &&
    (newAct.remaining ?? 0) > 0
  ) {
    state.observedOverheadTicks = newAct.remaining;
  }
  resetCycleAnchorOnInterruption(prevAct, newAct);
  calibrateCycleDuration(prevAct, newAct, preSnap);

  const prevType = prevAct?.type;
  const newType = newAct?.type;
  if (newType === 'travel' && prevType !== 'travel') pushTickEvent('travel-start');
  if (prevType === 'travel' && newType !== 'travel') pushTickEvent('travel-end');
  if (newType === 'banking' && prevType !== 'banking') pushTickEvent('banking-start');
  if (prevType === 'banking' && newType !== 'banking') pushTickEvent('banking-end');

  const postSnap = snapshotEta();
  pushTickEntry(preSnap, postSnap);
  safelyPushEtaDebugEntry({ preSnap, postSnap, prevAct, newAct, prevMe, newMe: state.mirroredState.me, now });

  detectIdleTransition();
  detectGoalReached();
  detectMaterialRunout();
  detectSkillLevelReached();
  detectCombatConsumableRunout(prevMe, state.mirroredState.me);
}

function handleClientFrame(frame) {
  if (frame.event !== 'input:game' || !frame.args?.length) return;
  if (frame.args[0]?.type !== 'stop-activity') return;
  if (!state.mirroredState.me) return;
  // Immediately mirror the stop — don't wait for the server update
  state.mirroredState = {
    ...state.mirroredState,
    me: { ...state.mirroredState.me, activity: null },
  };
  state.lastWorkActivity = null;
  chrome.storage.session.remove('lastWorkActivity');
  detectIdleTransition();
  detectMaterialRunout();
}

// ── Detectors ─────────────────────────────────────────────────────────────────

function detectCombatConsumableRunout(prevMe, newMe) {
  if (state.consumableNotifyItems.size === 0) return;
  const prevInv = prevMe?.inventory ?? {};
  const newInv = newMe?.inventory ?? {};
  for (const itemId of state.consumableNotifyItems) {
    const curr = newInv[itemId] ?? 0;
    if (curr > 0) {
      state.consumableNotifiedFor.delete(itemId);
      continue;
    }
    const prev = prevInv[itemId] ?? 0;
    if (prev > 0 && !state.consumableNotifiedFor.has(itemId)) {
      state.consumableNotifiedFor.add(itemId);
      const label = itemId.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
      fireNotification('consumable-runout', 'Microscape: Out of supplies!', `${label} ran out.`);
      sendChime('runout');
    }
  }
}

function detectIdleTransition() {
  const me = state.mirroredState.me;
  if (!me) return;

  const act = me.activity ?? null;
  const actId = getActivityId(act);

  if (
    state.prevActivityId !== undefined &&
    state.prevActivityId !== null &&
    actId === null
  ) {
    fireNotification('idle', "Microscape: You're idle!", 'Your character stopped working.');
    sendChime('default');
  }

  state.prevActivityId = actId;
}

function detectGoalReached() {
  const newlyCompleted = [];
  for (const goal of state.goals) {
    if (goal.maxCraftable && goal.targetCount === 0) continue;
    const count = getGoalCount(goal.itemName, goal.itemId);
    if (count === null || count < goal.targetCount) continue;
    if (state.goalNotifiedAt[goal.id]) continue;
    state.goalNotifiedAt[goal.id] = Date.now();
    newlyCompleted.push(goal.id);
    fireNotification(
      'goal',
      'Microscape: Goal reached!',
      `${goal.itemName}: ${count} / ${goal.targetCount}`
    );
    sendChime('default');
  }
  if (newlyCompleted.length > 0) {
    const completedSet = new Set(newlyCompleted);
    state.goals = state.goals.map((g) =>
      completedSet.has(g.id) ? { ...g, completed: true } : g
    );
    chrome.storage.local.set({ goals: state.goals });
  }
}

function detectMaterialRunout() {
  const me = state.mirroredState.me;
  const act = me?.activity ?? null;
  if (!act) {
    state.runoutNotifiedFor = null;
    return;
  }

  const actId = getActivityId(act);
  if (!actId) return;

  const info = runoutInfo(actId);
  if (!info) return;

  if (info.cyclesLeft > 0) {
    state.runoutNotifiedFor = null;
    return;
  }

  if (state.runoutNotifiedFor === actId) return;
  state.runoutNotifiedFor = actId;
  fireNotification(
    'runout',
    'Microscape: Out of materials!',
    `${info.itemId} ran out — character will go idle.`
  );
  sendChime('runout');
}

function detectSkillLevelReached() {
  if (!state.skillNotifyTarget) return;
  const exp = state.mirroredState.me?.exp;
  if (!exp) return;

  const currentXp = exp[state.skillNotifyTarget.skill];
  if (typeof currentXp !== 'number') return;

  const currentLevel = getLevelFromXp(currentXp, state.XP_TABLE);
  if (currentLevel < state.skillNotifyTarget.level) return;

  const skill = String(state.skillNotifyTarget.skill ?? '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (s) => s.toUpperCase());
  fireNotification(
    'skill-level',
    'Microscape: Level up!',
    `${skill} reached level ${state.skillNotifyTarget.level}!`
  );
  sendChime('default');
  state.skillNotifyTarget = null;
  chrome.storage.local.remove('skillNotifyTarget');
}

// ── Test surface ──────────────────────────────────────────────────────────────

const PLANNER_ACTIVITY_METADATA = ['level', 'xpPerCycle', 'skill'];

function enrichActivityMetadata(primaryDefs, fallbackDefs) {
  const defs = { ...(primaryDefs ?? {}) };
  let added = false;
  for (const [id, current] of Object.entries(defs)) {
    const fallback = fallbackDefs?.[id];
    if (!fallback) continue;
    const missingMetadata = Object.fromEntries(
      PLANNER_ACTIVITY_METADATA
        .filter((key) => current?.[key] === undefined && fallback[key] !== undefined)
        .map((key) => [key, fallback[key]])
    );
    if (Object.keys(missingMetadata).length === 0) continue;
    defs[id] = { ...current, ...missingMetadata };
    added = true;
  }
  return { defs, added };
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
      continue;
    }

    // Keep the cached recipe data, which may be newer than the bundled seed,
    // while enriching older caches with planner metadata introduced later.
    const missingMetadata = Object.fromEntries(
      [...PLANNER_ACTIVITY_METADATA, 'mob']
        .filter((key) => defs[id]?.[key] === undefined && def?.[key] !== undefined)
        .map((key) => [key, def[key]])
    );
    if (Object.keys(missingMetadata).length > 0) {
      defs[id] = { ...defs[id], ...missingMetadata };
      added = true;
    }

    const fallbackDrops = def?.dropItems;
    if (fallbackDrops && typeof fallbackDrops === 'object') {
      const mergedDrops = { ...fallbackDrops, ...(defs[id].dropItems ?? {}) };
      if (JSON.stringify(mergedDrops) !== JSON.stringify(defs[id].dropItems ?? {})) {
        defs[id] = { ...defs[id], dropItems: mergedDrops };
        added = true;
      }
    }
  }
  return { defs, added };
}

function normalizeGoals(goals) {
  if (!Array.isArray(goals)) return [];

  const ids = new Set();
  return goals.flatMap((goal, index) => {
    if (!goal || typeof goal !== 'object') return [];
    const itemId = typeof goal.itemId === 'string' && goal.itemId.trim()
      ? goal.itemId.trim()
      : null;
    const itemName = typeof goal.itemName === 'string' && goal.itemName.trim()
      ? goal.itemName.trim()
      : itemId;
    const targetCount = Number(goal.targetCount);
    const maxCraftable = goal.maxCraftable === true;
    const sourceMode = maxCraftable
      ? 'craft'
      : ['any', 'craft', 'drops'].includes(goal.sourceMode)
        ? goal.sourceMode
        : null;
    const minimumTarget = maxCraftable ? 0 : 1;
    if (!itemName || !Number.isSafeInteger(targetCount) || targetCount < minimumTarget) return [];

    const baseId = typeof goal.id === 'string' && goal.id.trim()
      ? goal.id.trim()
      : `legacy-${index}-${itemId ?? itemName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    let id = baseId;
    let suffix = 2;
    while (ids.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    ids.add(id);
    return [{
      id,
      itemId,
      itemName,
      targetCount,
      ...(maxCraftable ? { maxCraftable: true } : {}),
      ...(sourceMode ? { sourceMode } : {}),
      ...(goal.completed === true ? { completed: true } : {}),
    }];
  });
}

function goalPlanningReady() {
  return state.goalsLoaded
    && Object.keys(state.ACTIVITY_DEFS).length > 0
    && state.mirroredState.me?.inventory
    && typeof state.mirroredState.me.inventory === 'object';
}

function calculateGoalPlanning(goals = state.goals) {
  return planGoals({
    goals,
    activityDefs: state.ACTIVITY_DEFS,
    ownedCounts: buildOwnedCounts(state.mirroredState.me),
    skillXp: state.mirroredState.me?.exp,
    xpTable: state.XP_TABLE,
    ready: goalPlanningReady(),
  });
}

function refreshGoalPlanning() {
  if (!state.goalsLoaded) return;
  const planning = calculateGoalPlanning();
  state.goalPlans = planning.plans;
  if (JSON.stringify(planning.goals) === JSON.stringify(state.goals)) return;

  const previous = new Map(state.goals.map((goal) => [goal.id, goal]));
  state.goals = planning.goals;
  for (const goal of state.goals) {
    if (goal.completed) continue;
    if (previous.get(goal.id)?.targetCount !== goal.targetCount) {
      state.goalNotifiedAt[goal.id] = null;
    }
  }
  chrome.storage.local.set({ goals: state.goals });
}

function resetTestState() {
  state.ACTIVITY_DEFS = {};
  state.ZONE_DATA = {};
  state.XP_TABLE = computeMicroscapeXpTable();
  state.mirroredState = {};
  state.prevActivityId = undefined;
  state.microscopeTabId = null;
  state.observedTickMs = 2000;
  state.observedOverheadTicks = 6;
  state.tickSamples = [];
  state.lastUpdateAt = null;
  state.lastServerUpdateSignature = null;
  state.lastServerUpdateAt = 0;
  if (state.etaCalibrationSaveTimer !== null) {
    clearTimeout(state.etaCalibrationSaveTimer);
    state.etaCalibrationSaveTimer = null;
  }
  state.tickLog = [];
  state.etaDebugLog = [];
  state.cycleCalibrations = {};
  state.xpRateSamples = {};
  state.dropRateSamples = {};
  state.combatConsumableSamples = {};
  state.consumableNotifyItems = new Set();
  state.consumableNotifiedFor = new Set();
  state.activeRateClocks = {};
  state.lastRateClockAt = null;
  state.goalRateSamples = {};
  state.goalHighWaterMark = {};
  state.runoutRateSamples = {};
  state.lastWorkActivity = null;
  state.goals = [];
  state.goalsLoaded = true;
  state.goalPlans = [];
  state.goalNotifiedAt = {};
  state.runoutNotifiedFor = null;
  state.skillNotifyTarget = null;
  state.notificationsEnabled = true;
}

function setTestState({ activityDefs, zoneData, xpTable, state: gameState, lastWorkAct, tickMs } = {}) {
  if (activityDefs) state.ACTIVITY_DEFS = activityDefs;
  if (zoneData) state.ZONE_DATA = zoneData;
  if (xpTable) state.XP_TABLE = xpTable;
  if (gameState) state.mirroredState = gameState;
  if (lastWorkAct !== undefined) state.lastWorkActivity = lastWorkAct;
  if (tickMs) state.observedTickMs = tickMs;
}

export const __test = {
  buildStatus,
  computeSkillLevelEtas,
  mergeMissingActivityDefs,
  normalizeGoals,
  planGoals,
  resetTestState,
  runoutInfo,
  setTestState,
};

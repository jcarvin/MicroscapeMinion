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
  getEtaActivity,
  isWorkActivityId,
  rememberWorkActivity,
} from './activity-utils.js';
import { findKey, getGoalCount, sameGoalItem } from './inventory.js';
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
import {
  buildOwnedCounts,
  inferObservedActivityXp,
  planGoals,
} from './goal-planner.js';

const GOAL_NAG_INTERVAL_MS = 5 * 60 * 1000;
const GOAL_NAG_ALARM_PREFIX = 'goal-nag:';
const GOAL_NAG_DEBUG_LOG_LIMIT = 60;

// ── Startup ───────────────────────────────────────────────────────────────────

// Seed activity defs from the bundled JSON — saved at startup so the live
// ACTIVITY_DEFS handler can backfill inventoryChanges for any activity the
// game parser extracted without it (e.g. batch activities with extra fields).
let seedActivityDefs = {};
let resolveActivityDefsReady;
let resolveGoalsReady;
const activityDefsReady = new Promise((resolve) => { resolveActivityDefsReady = resolve; });
const goalsReady = new Promise((resolve) => { resolveGoalsReady = resolve; });
const goalNagStartupReady = Promise.all([activityDefsReady, goalsReady]);

chrome.storage.local.get(
  ['activityDefs', 'zoneData', 'xpTable', 'skillNotifyTarget', ETA_CALIBRATION_CACHE_KEY, 'consumableNotifyItems', 'notificationsEnabled'],
  (res) => {
    fetch(chrome.runtime.getURL('src/activity-defs.json'))
      .then((r) => r.json())
      .then((seed) => {
        seedActivityDefs = seed ?? {};
        state.BUNDLED_ACTIVITY_DEFS = seedActivityDefs;
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
      })
      .finally(resolveActivityDefsReady);
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
  chrome.storage.session.get(['goals', 'goal', 'lastWorkActivity', 'goalNagDebugLog'], (sessionRes) => {
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
    if (Array.isArray(sessionRes.goalNagDebugLog)) {
      state.goalNagDebugLog = sessionRes.goalNagDebugLog;
    }
    state.goalsLoaded = true;
    refreshGoalPlanning();
    resolveGoalsReady();
    for (const goal of state.goals) {
      if (goal.completed) ensureGoalNagScheduled(goal.id);
    }
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
      if (msg.itemTradeability && typeof msg.itemTradeability === 'object') {
        state.ITEM_TRADEABILITY = msg.itemTradeability;
      }
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
          cancelGoalNag(g.id, 'goal-item-changed');
        } else if (prev.targetCount !== g.targetCount) {
          state.goalNotifiedAt[g.id] = null;
          cancelGoalNag(g.id, 'goal-target-changed');
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
          cancelGoalNag(prevGoal.id, 'goal-removed');
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
      respond({ ...buildStatus(), goalNagDebug: buildGoalNagDebugStatus() });
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

    case 'TEST_NOTIFICATION': {
      if (!state.notificationsEnabled) {
        respond({ ok: false, reason: 'disabled' });
        break;
      }
      fireNotification('test', 'Microscape Minion', 'Test notification received!')
        .then((result) => {
          if (result.ok) sendChime('default');
          respond(result);
        });
      break;
    }

    case 'DEBUG_CHECK_GOAL_NAGS': {
      const goalIds = state.goals
        .filter((goal) => goal.completed)
        .map((goal) => goal.id);
      Promise.all(goalIds.map((goalId) => handleGoalNagAlarm({
        name: `${GOAL_NAG_ALARM_PREFIX}${goalId}`,
        debug: true,
      }))).then(() => respond({ ok: true, checked: goalIds.length }));
      break;
    }
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
  const prevWorkActivityId = getActivityId(getEtaActivity(prevAct));
  const prevExp = state.mirroredState.me?.exp;
  const prevMe = state.mirroredState.me;
  const preSnap = snapshotEta();
  advanceActiveRateClock(prevAct, now);

  state.mirroredState = applyPatch(state.mirroredState, frame.args[0]);
  const newAct = state.mirroredState.me?.activity;
  // Snapshot the previous work activity ID before rememberWorkActivity updates it
  rememberWorkActivity(newAct);
  const newWorkActivityId = getActivityId(getEtaActivity(newAct));
  if (prevWorkActivityId && prevWorkActivityId !== newWorkActivityId) {
    cancelAllGoalNags('activity-changed', {
      previousActivityId: prevWorkActivityId,
      newActivityId: newWorkActivityId,
    });
  }
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
  cancelAllGoalNags('activity-stopped');
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

function goalActivityMatch(goal) {
  const me = state.mirroredState.me;
  const liveAct = me?.activity ?? null;
  // A service worker restarted by an alarm has no mirrored page state yet.
  // lastWorkActivity is session-backed, so it preserves the activity that was
  // running when the worker went to sleep.
  const etaAct = getEtaActivity(liveAct) ?? state.lastWorkActivity;
  const etaActId = getActivityId(etaAct);
  const activityDef = etaActId ? state.ACTIVITY_DEFS[etaActId] : null;
  const inventoryKey = findKey(activityDef?.inventoryChanges, goal.itemName, goal.itemId);
  const dropKey = findKey(activityDef?.dropItems, goal.itemName, goal.itemId);
  const producedByActivity = Boolean(
    inventoryKey && activityDef.inventoryChanges[inventoryKey] > 0
  );
  const droppedByActivity = Boolean(dropKey);
  const planning = state.goalPlans.find((plan) => plan.goalId === goal.id) ?? null;
  // Reminder eligibility follows what the player is actually doing. A goal's
  // preferred planning source may be "drops" while the current activity still
  // produces that item directly (for example, Iron Ore can be mined or dropped).
  const related = producedByActivity || droppedByActivity;

  return {
    related,
    liveActivityId: getActivityId(liveAct),
    effectiveActivityId: etaActId,
    lastWorkActivityId: getActivityId(state.lastWorkActivity),
    sourceMode: planning?.sourceMode ?? null,
    inventoryKey,
    dropKey,
    producedByActivity,
    droppedByActivity,
    activityDefinitionLoaded: Boolean(activityDef),
  };
}

function pushGoalNagDebugEvent(type, details = {}) {
  state.goalNagDebugLog.unshift({ at: Date.now(), type, ...details });
  if (state.goalNagDebugLog.length > GOAL_NAG_DEBUG_LOG_LIMIT) {
    state.goalNagDebugLog.length = GOAL_NAG_DEBUG_LOG_LIMIT;
  }
  chrome.storage.session.set({ goalNagDebugLog: state.goalNagDebugLog });
}

function buildGoalNagDebugStatus() {
  return {
    now: Date.now(),
    intervalMs: GOAL_NAG_INTERVAL_MS,
    goalsLoaded: state.goalsLoaded,
    activityDefinitionsLoaded: Object.keys(state.ACTIVITY_DEFS).length > 0,
    notificationsEnabled: state.notificationsEnabled,
    scheduledFor: { ...state.goalNagScheduledFor },
    completedGoals: state.goals
      .filter((goal) => goal.completed)
      .map((goal) => ({
        id: goal.id,
        itemName: goal.itemName,
        targetCount: goal.targetCount,
        notifiedAt: state.goalNotifiedAt[goal.id] ?? null,
        ...goalActivityMatch(goal),
      })),
    events: state.goalNagDebugLog,
  };
}

function scheduleGoalNag(goalId, reason = 'repeat') {
  const alarmName = `${GOAL_NAG_ALARM_PREFIX}${goalId}`;
  const scheduledFor = Date.now() + GOAL_NAG_INTERVAL_MS;
  state.goalNagScheduledFor[goalId] = scheduledFor;
  pushGoalNagDebugEvent('alarm-scheduled', { goalId, reason, alarmName, scheduledFor });
  try {
    const result = chrome.alarms.create(alarmName, { when: scheduledFor });
    result?.catch?.((error) => {
      delete state.goalNagScheduledFor[goalId];
      pushGoalNagDebugEvent('alarm-schedule-failed', {
        goalId,
        reason: error?.message ?? String(error),
      });
    });
  } catch (error) {
    delete state.goalNagScheduledFor[goalId];
    pushGoalNagDebugEvent('alarm-schedule-failed', {
      goalId,
      reason: error?.message ?? String(error),
    });
  }
}

function ensureGoalNagScheduled(goalId) {
  const alarmName = `${GOAL_NAG_ALARM_PREFIX}${goalId}`;
  chrome.alarms.get(alarmName, (alarm) => {
    if (!alarm) {
      scheduleGoalNag(goalId, 'startup-recovery');
      return;
    }
    state.goalNagScheduledFor[goalId] = alarm.scheduledTime ?? null;
    pushGoalNagDebugEvent('alarm-restored', {
      goalId,
      alarmName,
      scheduledFor: alarm.scheduledTime ?? null,
    });
  });
}

function cancelGoalNag(goalId, reason = 'cancelled', details = {}) {
  const alarmName = `${GOAL_NAG_ALARM_PREFIX}${goalId}`;
  const scheduledFor = state.goalNagScheduledFor[goalId] ?? null;
  delete state.goalNagScheduledFor[goalId];
  chrome.alarms.clear(alarmName);
  pushGoalNagDebugEvent('alarm-cancelled', {
    goalId,
    reason,
    alarmName,
    scheduledFor,
    ...details,
  });
}

function cancelAllGoalNags(reason, details = {}) {
  for (const goal of state.goals) {
    if (goal.completed) cancelGoalNag(goal.id, reason, details);
  }
}

async function handleGoalNagAlarm(alarm) {
  if (!alarm?.name?.startsWith(GOAL_NAG_ALARM_PREFIX)) return;
  const waitedForStartup = !state.goalsLoaded || Object.keys(state.ACTIVITY_DEFS).length === 0;
  await goalNagStartupReady;

  const goalId = alarm.name.slice(GOAL_NAG_ALARM_PREFIX.length);
  delete state.goalNagScheduledFor[goalId];
  const goal = state.goals.find((candidate) => candidate.id === goalId);
  const match = goal ? goalActivityMatch(goal) : null;
  pushGoalNagDebugEvent('alarm-fired', {
    goalId,
    trigger: alarm.debug ? 'manual-debug' : 'alarm',
    waitedForStartup,
    goalFound: Boolean(goal),
    goalCompleted: goal?.completed === true,
    notificationsEnabled: state.notificationsEnabled,
    match,
  });
  if (!goal?.completed) {
    pushGoalNagDebugEvent('reminders-stopped', {
      goalId,
      reason: goal ? 'goal-not-completed' : 'goal-not-found',
    });
    return;
  }
  if (!match.related) {
    pushGoalNagDebugEvent('reminders-stopped', {
      goalId,
      reason: 'activity-not-related',
      match,
    });
    return;
  }

  const result = await fireNotification(
    'goal-nag',
    'Microscape: Goal already reached!',
    `${goal.itemName} is complete — switch activities or remove this goal.`
  );
  if (result.ok) sendChime('default');
  pushGoalNagDebugEvent('notification-attempted', { goalId, result });
  scheduleGoalNag(goalId, 'repeat');
}

chrome.alarms.onAlarm.addListener(handleGoalNagAlarm);

function detectGoalReached() {
  const newlyCompleted = [];
  for (const goal of state.goals) {
    if (goal.maxCraftable && goal.targetCount === 0) continue;
    const count = getGoalCount(goal.itemName, goal.itemId);
    if (count === null || count < goal.targetCount) continue;
    if (state.goalNotifiedAt[goal.id]) continue;
    state.goalNotifiedAt[goal.id] = Date.now();
    newlyCompleted.push(goal.id);
    pushGoalNagDebugEvent('goal-completed', {
      goalId: goal.id,
      itemName: goal.itemName,
      count,
      targetCount: goal.targetCount,
      match: goalActivityMatch(goal),
    });
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
    for (const goalId of newlyCompleted) scheduleGoalNag(goalId, 'goal-completed');
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
      ? (goal.sourceMode === 'manual' ? 'manual' : 'craft')
      : ['any', 'manual', 'craft', 'drops'].includes(goal.sourceMode)
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
  const manualInputActivityDefs = Object.keys(state.BUNDLED_ACTIVITY_DEFS).length > 0
    ? state.BUNDLED_ACTIVITY_DEFS
    : state.ACTIVITY_DEFS;
  return planGoals({
    goals,
    activityDefs: state.ACTIVITY_DEFS,
    manualInputActivityDefs,
    observedActivityXp: inferObservedActivityXp(state.xpRateSamples),
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
  state.BUNDLED_ACTIVITY_DEFS = {};
  state.ITEM_TRADEABILITY = {};
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
  state.goalNagScheduledFor = {};
  state.goalNagDebugLog = [];
  state.runoutNotifiedFor = null;
  state.skillNotifyTarget = null;
  state.notificationsEnabled = true;
}

function setTestState({
  activityDefs,
  bundledActivityDefs,
  itemTradeability,
  xpRateSamples,
  zoneData,
  xpTable,
  state: gameState,
  lastWorkAct,
  tickMs,
} = {}) {
  if (activityDefs) state.ACTIVITY_DEFS = activityDefs;
  if (bundledActivityDefs) state.BUNDLED_ACTIVITY_DEFS = bundledActivityDefs;
  if (itemTradeability) state.ITEM_TRADEABILITY = itemTradeability;
  if (xpRateSamples) state.xpRateSamples = xpRateSamples;
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

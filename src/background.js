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
  getEtaActivity,
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

// ── Startup ───────────────────────────────────────────────────────────────────

chrome.storage.local.get(
  ['activityDefs', 'zoneData', 'xpTable', 'skillNotifyTarget', ETA_CALIBRATION_CACHE_KEY],
  (res) => {
    fetch(chrome.runtime.getURL('src/activity-defs.json'))
      .then((r) => r.json())
      .then((seed) => {
        const { defs, added } = mergeMissingActivityDefs(res.activityDefs, seed);
        state.ACTIVITY_DEFS = defs;
        if (added) chrome.storage.local.set({ activityDefs: state.ACTIVITY_DEFS });
      })
      .catch(() => {
        if (res.activityDefs && Object.keys(res.activityDefs).length > 0) {
          state.ACTIVITY_DEFS = res.activityDefs;
        }
      });
    if (res.zoneData) state.ZONE_DATA = res.zoneData;
    if (isValidXpTable(res.xpTable)) state.XP_TABLE = res.xpTable;
    if (res.skillNotifyTarget) state.skillNotifyTarget = res.skillNotifyTarget;
    hydrateEtaCalibrationCache(res[ETA_CALIBRATION_CACHE_KEY]);
  }
);

chrome.storage.session.get(['goal', 'lastWorkActivity'], (res) => {
  if (res.goal) state.goal = res.goal;
  if (res.lastWorkActivity) state.lastWorkActivity = res.lastWorkActivity;
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
      state.ACTIVITY_DEFS = msg.defs;
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
    }
    return;
  }

  switch (msg?.type) {
    case 'SET_GOAL': {
      const nextGoal = msg.goal ?? null;
      const preserveGoalCalibration = sameGoalItem(state.goal, nextGoal);
      const currentCount = nextGoal
        ? (getGoalCount(nextGoal.itemName, nextGoal.itemId) ?? 0)
        : null;

      state.goal = nextGoal;
      if (!preserveGoalCalibration) state.goalRateSamples = {};
      state.goalHighWaterMark = state.goal
        ? preserveGoalCalibration
          ? Math.max(state.goalHighWaterMark ?? currentCount ?? 0, currentCount ?? 0)
          : currentCount
        : null;
      state.goalNotifiedAt = null;
      chrome.storage.session.set({ goal: state.goal });
      respond({ ok: true });
      break;
    }

    case 'CLEAR_GOAL':
      state.goal = null;
      state.goalNotifiedAt = null;
      state.goalRateSamples = {};
      state.goalHighWaterMark = null;
      chrome.storage.session.set({ goal: null });
      respond({ ok: true });
      break;

    case 'GET_STATUS':
      respond(buildStatus());
      break;

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
  const prevWorkActId = getActivityId(state.lastWorkActivity);
  rememberWorkActivity(newAct);
  // Clear goal when the user switches to a different work activity
  const newWorkActId = getActivityId(getEtaActivity(newAct));
  if (state.goal && prevWorkActId !== null && newWorkActId !== null && newWorkActId !== prevWorkActId) {
    state.goal = null;
    state.goalNotifiedAt = null;
    state.goalRateSamples = {};
    state.goalHighWaterMark = null;
    chrome.storage.session.set({ goal: null });
  }
  trackXpGain(prevAct, newAct, prevExp, state.mirroredState.me?.exp);
  trackDropGain(prevAct, newAct, prevMe, state.mirroredState.me);
  trackCombatConsumables(prevAct, newAct, prevMe, state.mirroredState.me);
  trackGoalAccumulation(prevAct, newAct, prevMe, state.mirroredState.me);
  trackRunoutConsumption(prevAct, newAct, prevMe, state.mirroredState.me);

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
  if (!state.goal) return;
  const count = getGoalCount(state.goal.itemName, state.goal.itemId);
  if (count === null || count < state.goal.targetCount) return;
  if (state.goalNotifiedAt) return;
  state.goalNotifiedAt = Date.now();
  fireNotification(
    'goal',
    'Microscape: Goal reached!',
    `${state.goal.itemName}: ${count} / ${state.goal.targetCount}`
  );
  sendChime('default');
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
  state.activeRateClocks = {};
  state.lastRateClockAt = null;
  state.goalRateSamples = {};
  state.goalHighWaterMark = null;
  state.runoutRateSamples = {};
  state.lastWorkActivity = null;
  state.goal = null;
  state.goalNotifiedAt = null;
  state.runoutNotifiedFor = null;
  state.skillNotifyTarget = null;
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
  resetTestState,
  runoutInfo,
  setTestState,
};

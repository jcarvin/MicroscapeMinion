// Activity shape helpers.
//
// me.activity has several shapes:
//   Active cycle:   { skill, zone, activity, remaining, length, createdTick }
//   Between cycles: { preparedActivity: { skill, zone, activity, ... }, length, remaining }
//   Bank trip:      { type: "travel", destination: { map: "...-bank" }, desiredActivity: { type: "banking", ... }, remaining }
//
// Character is idle ONLY when me.activity is null/absent entirely.
// Travel and banking are transient states — not idle.

import { state } from './state.js';

export function getActivityId(act) {
  if (!act) return null;
  if (act.type === 'travel' || act.type === 'banking') return act.type;
  return act.activity ?? act.preparedActivity?.activity ?? null;
}

export function getActivitySkill(act) {
  if (!act || act.type === 'travel' || act.type === 'banking') return null;
  return (
    act.skill ??
    act.combatSkill ??
    act.preparedActivity?.skill ??
    act.preparedActivity?.combatSkill ??
    null
  );
}

export function getActivityZone(act) {
  if (!act || act.type === 'travel' || act.type === 'banking') return null;
  return act.zone ?? act.preparedActivity?.zone ?? null;
}

export function isCombatActivity(act) {
  if (!act || act.type === 'travel' || act.type === 'banking') return false;
  return !!(act.mob ?? act.preparedActivity?.mob);
}

export function isWorkActivityId(actId) {
  return !!actId && actId !== 'travel' && actId !== 'banking';
}

export function isCycleCompletion(prevAct, newAct) {
  return !prevAct?.preparedActivity && !!newAct?.preparedActivity;
}

export function cloneForStorage(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function compactActivity(act) {
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

export function getEtaActivity(liveAct) {
  const liveActId = getActivityId(liveAct);
  if (isWorkActivityId(liveActId)) return liveAct;
  if (liveAct?.type === 'travel' || liveAct?.type === 'banking') {
    return state.lastWorkActivity;
  }
  return null;
}

export function rememberWorkActivity(act) {
  const actId = getActivityId(act);
  if (isWorkActivityId(actId)) {
    state.lastWorkActivity = cloneForStorage(act);
    chrome.storage.session.set({ lastWorkActivity: state.lastWorkActivity });
    return;
  }
  if (!act) {
    state.lastWorkActivity = null;
    chrome.storage.session.remove('lastWorkActivity');
  }
}

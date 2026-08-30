import { state } from './state.js';
import { getActivityId } from './activity-utils.js';
import { runoutInfo } from './runout.js';
import { getLevelFromXp } from './xp.js';
import { fireNotification, sendChime } from './notify.js';

export function detectCombatConsumableRunout(prevMe, newMe) {
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

export function detectIdleTransition() {
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

export function detectMaterialRunout() {
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

export function detectSkillLevelReached() {
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

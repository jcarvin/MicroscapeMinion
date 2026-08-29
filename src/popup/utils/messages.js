function send(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, response => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(response ?? null);
    });
  });
}

export const getStatus      = ()             => send({ type: 'GET_STATUS' });
export const setGoals       = (goals)        => send({ type: 'SET_GOALS', goals });
export const setSkillNotify = (skill, level) => send({ type: 'SET_SKILL_NOTIFY', skill, level });
export const clearSkillNotify = ()           => send({ type: 'CLEAR_SKILL_NOTIFY' });
export const setConsumableNotify     = (itemId)  => send({ type: 'SET_CONSUMABLE_NOTIFY', itemId });
export const clearConsumableNotify   = (itemId)  => send({ type: 'CLEAR_CONSUMABLE_NOTIFY', itemId });
export const setNotificationsEnabled = (enabled) => send({ type: 'SET_NOTIFICATIONS_ENABLED', enabled });
export const sendTestNotification = () => send({ type: 'TEST_NOTIFICATION' });
export const checkGoalNagsNow = () => send({ type: 'DEBUG_CHECK_GOAL_NAGS' });

function send(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, response => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(response ?? null);
    });
  });
}

export const getStatus      = ()             => send({ type: 'GET_STATUS' });
export const setGoal        = (goal)         => send({ type: 'SET_GOAL', goal });
export const clearGoal      = ()             => send({ type: 'CLEAR_GOAL' });
export const setSkillNotify = (skill, level) => send({ type: 'SET_SKILL_NOTIFY', skill, level });
export const clearSkillNotify = ()           => send({ type: 'CLEAR_SKILL_NOTIFY' });

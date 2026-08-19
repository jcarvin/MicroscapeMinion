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

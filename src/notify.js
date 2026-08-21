import { state } from './state.js';

export function fireNotification(id, title, message) {
  if (!state.notificationsEnabled) return;
  chrome.notifications.create(`mm-${id}-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title,
    message,
    priority: 2,
  });
}

export function sendChime(variant) {
  if (!state.notificationsEnabled) return;
  if (state.microscopeTabId == null) return;
  chrome.tabs
    .sendMessage(state.microscopeTabId, { type: 'PLAY_CHIME', variant })
    .catch(() => {});
}

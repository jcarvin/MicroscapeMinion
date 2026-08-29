import { state } from './state.js';

export async function fireNotification(id, title, message) {
  if (!state.notificationsEnabled) return { ok: false, reason: 'disabled' };
  try {
    const notificationId = await chrome.notifications.create(`mm-${id}-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message,
      priority: 2,
    });
    return { ok: true, notificationId };
  } catch (error) {
    return { ok: false, reason: error?.message ?? 'notification-create-failed' };
  }
}

export function sendChime(variant) {
  if (!state.notificationsEnabled) return;
  if (state.microscopeTabId == null) return;
  chrome.tabs
    .sendMessage(state.microscopeTabId, { type: 'PLAY_CHIME', variant })
    .catch(() => {});
}

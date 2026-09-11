// Encodes and dispatches input:game commands via the content script relay.
// Follows the sendChime pattern (notify.js) — background sends to the tab,
// content.js forwards to the page, injected.js sends on the game socket.
//
// Commands are spaced ~200 ms apart so a burst doesn't trip server-side
// rate limiting or read as automation.

import { state } from './state.js';

const INTER_EMIT_DELAY_MS = 200;

function sendToTab(payload) {
  if (state.microscopeTabId == null) return Promise.resolve();
  return chrome.tabs
    .sendMessage(state.microscopeTabId, { type: 'MM_EMIT_INPUT', payload })
    .catch(() => {});
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function emitGameInputSequence(payloads) {
  for (let i = 0; i < payloads.length; i++) {
    if (i > 0) await delay(INTER_EMIT_DELAY_MS);
    await sendToTab(payloads[i]);
  }
}

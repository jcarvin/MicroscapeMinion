// Isolated-world content script.
//
// Two jobs:
//   1. Relay __mm postMessage events from the MAIN-world injected.js to the
//      background service worker via chrome.runtime.sendMessage.
//   2. Play audio chimes when the background sends a PLAY_CHIME command.

// ── Relay MAIN-world frames to background ────────────────────────────────────

window.addEventListener('message', (evt) => {
  if (evt.source !== window || !evt.data?.__mm) return;
  if (!chrome.runtime?.id) return; // extension was reloaded; context is dead
  chrome.runtime.sendMessage(evt.data).catch(() => {});
});

// ── Receive commands from background ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'PLAY_CHIME') playChime(msg.variant ?? 'default');
});

// ── Audio chime (generated via Web Audio — no bundled asset needed) ──────────

function playChime(variant) {
  try {
    const ctx = new AudioContext();

    // Two-note ascending chime for 'idle' / 'goal'; descending for 'runout'
    const notes = variant === 'runout'
      ? [659.25, 523.25]  // E5 → C5 (descending — warning)
      : [523.25, 659.25]; // C5 → E5 (ascending — positive)

    let t = ctx.currentTime + 0.05;
    for (const freq of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.start(t);
      osc.stop(t + 0.65);
      t += 0.18;
    }
  } catch {
    // AudioContext unavailable — fail silently
  }
}

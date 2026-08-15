'use strict';

const $ = (id) => document.getElementById(id);

// ── DOM refs ──────────────────────────────────────────────────────────────────

const dot           = $('dot');
const activityBadge = $('activity-badge');
const tickRateEl    = $('tick-rate');
const goalItemInput = $('goal-item');
const goalCountInput= $('goal-count');
const btnSetGoal    = $('btn-set-goal');
const btnClearGoal  = $('btn-clear-goal');
const goalStatus    = $('goal-status');
const progressBar   = $('progress-bar');
const goalCountDisp = $('goal-count-display');
const goalEtaEl     = $('goal-eta');
const runoutCard    = $('runout-card');
const runoutCycles  = $('runout-cycles');
const runoutEtaEl   = $('runout-eta');
const skillXpCard   = $('skill-xp-card');
const skillXpName   = $('skill-xp-name');
const skillXpLevel  = $('skill-xp-level');
const skillSlider   = $('skill-level-slider');
const skillNotches  = $('skill-xp-notch-labels');
const skillTargetEl = $('skill-xp-target-label');
const skillEtaEl    = $('skill-xp-eta');
const debugMeEl     = $('debug-me');
const comboWrap     = $('item-combobox');
const comboList     = $('combo-options');

// ── Combobox state ────────────────────────────────────────────────────────────

let comboItems = [];   // [{ id, count }] from status.producibleItems
let selectedId = null;

function formatItemId(id) {
  return id.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

function buildComboList(filter) {
  const q = (filter ?? '').toLowerCase().replace(/\s+/g, '');
  const visible = q
    ? comboItems.filter(({ id }) => formatItemId(id).toLowerCase().replace(/\s+/g, '').includes(q))
    : comboItems;

  comboList.innerHTML = '';

  if (visible.length === 0) {
    const li = document.createElement('li');
    li.className = 'combo-empty';
    li.textContent = comboItems.length === 0 ? 'No active activity' : 'No match';
    comboList.appendChild(li);
    return;
  }

  for (const item of visible) {
    const li = document.createElement('li');
    li.className = 'combo-option' + (item.id === selectedId ? ' is-selected' : '');
    li.innerHTML = `<span class="combo-name">${formatItemId(item.id)}</span><span class="combo-count">${item.count}</span>`;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus on input
      selectItem(item.id);
    });
    comboList.appendChild(li);
  }
}

function openCombo() {
  goalItemInput.value = '';
  buildComboList('');
  comboList.hidden = false;
}

function closeCombo() {
  comboList.hidden = true;
  goalItemInput.value = selectedId ? formatItemId(selectedId) : '';
}

function selectItem(id) {
  selectedId = id;
  goalItemInput.value = formatItemId(id);
  comboList.hidden = true;
}

goalItemInput.addEventListener('focus', () => {
  if (comboItems.length > 0) openCombo();
});

goalItemInput.addEventListener('input', () => {
  buildComboList(goalItemInput.value);
  comboList.hidden = false;
});

goalItemInput.addEventListener('blur', () => {
  setTimeout(closeCombo, 150);
});

goalItemInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeCombo(); goalItemInput.blur(); }
  if (e.key === 'Enter')  btnSetGoal.click();
});

// Close if user clicks outside the combobox
document.addEventListener('mousedown', (e) => {
  if (!comboWrap.contains(e.target)) comboList.hidden = true;
});

// ── ETA countdown anchors ────────────────────────────────────────────────────
// Anchors let the display tick down every second without waiting for a new
// background recalculation. Re-anchored whenever the background value changes.

let runoutAnchor = null; // { etaMs, srcEtaMs, at }
let goalAnchor   = null; // { totalMs, srcTotalMs, bankTrips, at }
let skillAnchor  = null; // { etaMs, srcEtaMs, targetLevel, at }
let selectedLevelOffset = 1;
let lastStatus = null;

function updateEtaDisplays() {
  if (runoutAnchor) {
    const ms = Math.max(0, runoutAnchor.etaMs - (Date.now() - runoutAnchor.at));
    runoutEtaEl.textContent = ms > 0 ? `ETA ${formatDuration(ms)}` : 'Out now';
  }
  if (goalAnchor) {
    const ms = Math.max(0, goalAnchor.totalMs - (Date.now() - goalAnchor.at));
    const trips    = goalAnchor.bankTrips ?? 0;
    const tripNote = trips > 0 ? ` (+${trips} bank trip${trips > 1 ? 's' : ''})` : '';
    goalEtaEl.textContent = ms > 0 ? `ETA ${formatDuration(ms)}${tripNote}` : 'Done!';
  }
  if (skillAnchor) {
    const ms = Math.max(0, skillAnchor.etaMs - (Date.now() - skillAnchor.at));
    skillEtaEl.textContent = ms > 0 ? `ETA ${formatDuration(ms)}` : 'Now';
  }
}

setInterval(updateEtaDisplays, 1000);

// ── Polling ───────────────────────────────────────────────────────────────────

function poll() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
    if (chrome.runtime.lastError || !status) return;
    render(status);
  });
}

poll();
const interval = setInterval(poll, 1000);
window.addEventListener('unload', () => clearInterval(interval));

// ── Render ─────────────────────────────────────────────────────────────────────

function render(s) {
  lastStatus = s;

  // Connection dot
  dot.className = 'dot' + (s.connected ? (s.idle ? ' idle' : ' connected') : '');

  // Activity status
  if (!s.connected) {
    activityBadge.textContent = 'Not connected';
    activityBadge.className = 'status-badge';
    tickRateEl.textContent = '';
  } else if (s.idle) {
    activityBadge.textContent = 'IDLE';
    activityBadge.className = 'status-badge idle';
    tickRateEl.textContent = '';
  } else if (s.activity) {
    activityBadge.textContent = s.activity;
    activityBadge.className = 'status-badge active';
    tickRateEl.textContent = `${s.tickMs}ms tick`;
  } else {
    activityBadge.textContent = 'Observing…';
    activityBadge.className = 'status-badge';
    tickRateEl.textContent = '';
  }

  // Sync combobox items from status
  const newItems = s.producibleItems ?? [];
  const newIds = newItems.map(i => i.id).join(',');
  const oldIds = comboItems.map(i => i.id).join(',');
  if (newIds !== oldIds) {
    comboItems = newItems;
    // Auto-select if exactly one output and nothing is selected yet
    if (newItems.length === 1 && !selectedId) selectItem(newItems[0].id);
    // Refresh open dropdown if visible
    if (!comboList.hidden) buildComboList(goalItemInput.value);
  } else {
    // Update counts in place (items haven't changed, just counts)
    comboItems = newItems;
    if (!comboList.hidden) buildComboList(goalItemInput.value);
  }

  // Goal status
  const gs = s.goalStatus;
  if (gs) {
    // Restore selection from saved goal when nothing is selected
    if (gs.goal.itemId && !selectedId && comboList.hidden) {
      selectedId = gs.goal.itemId;
    }
    // Reflect selected item in input when dropdown is closed and user isn't in it
    if (comboList.hidden && selectedId && document.activeElement !== goalItemInput) {
      goalItemInput.value = formatItemId(selectedId);
    }
    if (document.activeElement !== goalCountInput) {
      goalCountInput.value = gs.goal.targetCount;
    }
    goalStatus.hidden    = false;
    btnClearGoal.hidden  = false;

    const pct = Math.min(100, (gs.count / gs.goal.targetCount) * 100);
    progressBar.style.width   = `${pct}%`;
    goalCountDisp.textContent = `${gs.count ?? 0} / ${gs.goal.targetCount}`;

    if (gs.eta == null) {
      goalEtaEl.textContent = 'ETA calibrating…';
      goalAnchor = null;
    } else if (gs.eta === 0) {
      goalEtaEl.textContent = 'Done!';
      goalAnchor = null;
    } else {
      if (!goalAnchor || gs.eta.totalMs !== goalAnchor.srcTotalMs) {
        goalAnchor = { totalMs: gs.eta.totalMs, srcTotalMs: gs.eta.totalMs, bankTrips: gs.eta.bankTrips, at: Date.now() };
      }
      updateEtaDisplays();
    }
  } else {
    goalStatus.hidden   = true;
    btnClearGoal.hidden = true;
    goalAnchor = null;
  }

  // Runout status
  const rs = s.runoutStatus;
  if (rs) {
    runoutCard.hidden = false;
    const label = rs.itemId ? `${rs.itemId}: ` : '';
    const cycles = rs.cyclesLeft != null ? `${rs.cyclesLeft} cycles left` : `${rs.totalMaterial} remaining`;
    runoutCycles.textContent = `${label}${cycles}`;
    if (rs.etaMs > 0) {
      if (!runoutAnchor || rs.etaMs !== runoutAnchor.srcEtaMs) {
        runoutAnchor = { etaMs: rs.etaMs, srcEtaMs: rs.etaMs, at: Date.now() };
      }
      updateEtaDisplays();
    } else {
      runoutAnchor = null;
      runoutEtaEl.textContent = 'Out now';
    }
  } else {
    runoutAnchor = null;
    runoutCard.hidden = true;
  }

  // Skill XP status
  const xs = s.skillLevelStatus;
  if (xs && xs.etas?.length > 0) {
    skillXpCard.hidden = false;
    skillXpName.textContent = formatSkillName(xs.skill);
    skillXpLevel.textContent = xs.currentLevel;

    const maxOffset = Math.min(10, xs.etas.length);
    selectedLevelOffset = Math.min(Math.max(1, selectedLevelOffset), maxOffset);
    skillSlider.max = String(maxOffset);
    skillSlider.value = String(selectedLevelOffset);
    renderSkillNotches(maxOffset);

    const eta = xs.etas[selectedLevelOffset - 1];
    skillTargetEl.textContent = `→ Lv ${eta.targetLevel} (${formatNumber(eta.xpNeeded)} XP)`;

    if (eta.etaMs > 0) {
      if (!skillAnchor || eta.etaMs !== skillAnchor.srcEtaMs || eta.targetLevel !== skillAnchor.targetLevel) {
        skillAnchor = {
          etaMs: eta.etaMs,
          srcEtaMs: eta.etaMs,
          targetLevel: eta.targetLevel,
          at: Date.now(),
        };
      }
      updateEtaDisplays();
    } else {
      skillAnchor = null;
      skillEtaEl.textContent = 'Now';
    }
  } else {
    skillAnchor = null;
    skillXpCard.hidden = true;
  }

  // Debug
  if ($('debug-me').parentElement.open) {
    debugMeEl.textContent = JSON.stringify(s.rawMe, null, 2);
  }
}

// ── Goal controls ──────────────────────────────────────────────────────────────

btnSetGoal.addEventListener('click', () => {
  const itemId    = selectedId;
  const itemName  = itemId ? formatItemId(itemId) : goalItemInput.value.trim();
  const targetCount = parseInt(goalCountInput.value, 10);
  if (!itemName || !targetCount || targetCount < 1) return;

  chrome.runtime.sendMessage(
    { type: 'SET_GOAL', goal: { itemName, itemId: itemId ?? null, targetCount } },
    () => poll()
  );
});

btnClearGoal.addEventListener('click', () => {
  selectedId = null;
  chrome.runtime.sendMessage({ type: 'CLEAR_GOAL' }, () => {
    goalItemInput.value  = '';
    goalCountInput.value = '';
    poll();
  });
});

goalCountInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnSetGoal.click(); });

skillSlider.addEventListener('input', () => {
  selectedLevelOffset = parseInt(skillSlider.value, 10) || 1;
  skillAnchor = null;
  if (lastStatus) render(lastStatus);
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function renderSkillNotches(maxOffset) {
  const current = skillNotches.dataset.maxOffset;
  if (current === String(maxOffset)) return;

  skillNotches.dataset.maxOffset = String(maxOffset);
  skillNotches.innerHTML = '';
  for (let i = 1; i <= maxOffset; i++) {
    const span = document.createElement('span');
    span.textContent = `+${i}`;
    skillNotches.appendChild(span);
  }
}

function formatSkillName(skill) {
  return String(skill ?? '').replace(/[-_]/g, ' ').replace(/\b\w/g, s => s.toUpperCase());
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString();
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

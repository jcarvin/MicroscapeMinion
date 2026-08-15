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
const tickLogPre    = $('tick-log-pre');
const btnCopyLog    = $('btn-copy-log');
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

let runoutAnchor = null; // { etaMs, srcEtaMs, bankTrips, at }
let goalAnchor   = null; // { totalMs, srcTotalMs, bankTrips, at }
let skillAnchor  = null; // { etaMs, srcEtaMs, targetLevel, at }
let selectedLevelOffset = 1;
let lastStatus = null;

function updateEtaDisplays() {
  if (runoutAnchor) {
    const ms = Math.max(0, runoutAnchor.etaMs - (Date.now() - runoutAnchor.at));
    const trips    = runoutAnchor.bankTrips ?? 0;
    const tripNote = trips > 0 ? ` (+${trips} bank trip${trips > 1 ? 's' : ''})` : '';
    runoutEtaEl.textContent = ms > 0 ? `ETA ${formatDuration(ms)}${tripNote}` : 'Out now';
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

    if (gs.chanceBased) {
      goalEtaEl.hidden = false;
      if (gs.eta?.totalMs > 0) {
        if (!goalAnchor || gs.eta.totalMs !== goalAnchor.srcTotalMs) {
          goalAnchor = { totalMs: gs.eta.totalMs, srcTotalMs: gs.eta.totalMs, bankTrips: 0, at: Date.now() };
        }
        updateEtaDisplays();
      } else {
        goalEtaEl.textContent = 'ETA calibrating…';
        goalAnchor = null;
      }
    } else if (gs.eta == null) {
      goalEtaEl.hidden = false;
      goalEtaEl.textContent = 'ETA calibrating…';
      goalAnchor = null;
    } else if (gs.eta === 0) {
      goalEtaEl.hidden = false;
      goalEtaEl.textContent = 'Done!';
      goalAnchor = null;
    } else {
      goalEtaEl.hidden = false;
      if (!goalAnchor || gs.eta.totalMs !== goalAnchor.srcTotalMs) {
        goalAnchor = { totalMs: gs.eta.totalMs, srcTotalMs: gs.eta.totalMs, bankTrips: gs.eta.bankTrips, at: Date.now() };
      }
      updateEtaDisplays();
    }
  } else {
    goalStatus.hidden   = true;
    goalEtaEl.hidden    = false;
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
      if (!runoutAnchor || rs.etaMs !== runoutAnchor.srcEtaMs || rs.bankTrips !== runoutAnchor.bankTrips) {
        runoutAnchor = { etaMs: rs.etaMs, srcEtaMs: rs.etaMs, bankTrips: rs.bankTrips, at: Date.now() };
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

    if (eta.etaMs == null) {
      skillAnchor = null;
      skillEtaEl.textContent = 'ETA calibrating…';
    } else if (eta.etaMs > 0) {
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

  // Debug — raw me state (only render when visible; it can be large)
  if ($('debug-me').parentElement.open) {
    debugMeEl.textContent = JSON.stringify(s.rawMe, null, 2);
  }

  // Debug — tick log (always update so copy button and display are current)
  renderTickLog(s.tickLog ?? []);
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

// ── Tick log ───────────────────────────────────────────────────────────────────

let lastTickLog = [];

function renderTickLog(entries) {
  lastTickLog = entries;
  if (!entries.length) { tickLogPre.textContent = '(no ticks yet)'; return; }
  tickLogPre.textContent = entries.map(formatTickEntry).join('\n');
}

function formatTickEntry(e) {
  const t = fmtHMS(e.at);
  if (e.type !== 'tick') return `${t}  ── ${e.type.toUpperCase()} ──`;

  const ph  = (e.phase ?? '?').padEnd(8);
  const cy  = e.cyclesLeft != null  ? `cy=${String(e.cyclesLeft).padStart(3)}`  : 'cy=  ?';
  const rm  = e.actRemaining != null ? `rm=${String(e.actRemaining).padStart(2)}` : 'rm= ?';
  const ln  = e.actLength != null   ? `ln=${String(e.actLength).padStart(2)}`   : 'ln= ?';
  const oh  = `oh=${e.overheadTicks ?? '?'}`;
  const lb  = e.lootBagItems != null ? `lb=${e.lootBagItems}/${e.bankTriggerItemCount ?? '?'}` : 'lb=?';
  const gen = e.itemsGenerated != null ? `gen=${String(e.itemsGenerated).padStart(3)}` : 'gen=  ?';
  const bt  = e.bankTrips != null ? `bt=${String(e.bankTrips).padStart(2)}` : 'bt= ?';
  const sm  = e.cycleSamples != null ? `sm=${String(e.cycleSamples).padStart(2)}` : 'sm= ?';
  const pg  = e.cycleProgressMs != null ? `pg=${(e.cycleProgressMs / 1000).toFixed(0)}s` : 'pg=?';
  const cal = e.calibrated ? 'cal=Y' : 'cal=N';
  const rd  = e.rawDuration != null ? `rd=${e.rawDuration}` : 'rd=?';
  const dd  = e.defDurMs != null    ? `dd=${(e.defDurMs / 1000).toFixed(0)}s`  : 'dd=?';
  const cd  = e.cycleDurMs != null  ? `cd=${(e.cycleDurMs / 1000).toFixed(0)}s` : 'cd=?';
  const od  = e.observedCycleDurMs != null ? `od=${(e.observedCycleDurMs / 1000).toFixed(0)}s` : 'od=?';
  const goal = e.goalEtaMs != null  ? `goal=${(e.goalEtaMs / 1000).toFixed(0)}s` : 'goal=?';
  const gbt = e.goalBankTrips != null ? `gbt=${e.goalBankTrips}` : 'gbt=?';
  const pre  = e.pre  != null ? `${(e.pre  / 1000).toFixed(0)}s` : '   ?';
  const post = e.etaMs != null      ? `${(e.etaMs / 1000).toFixed(0)}s`         : '   ?';
  const d    = e.deltaMs != null
    ? (e.deltaMs >= 0 ? `+${(e.deltaMs / 1000).toFixed(1)}` : `${(e.deltaMs / 1000).toFixed(1)}`)
    : '?';
  return `${t}  ${ph}  ${cy}  ${rm}  ${ln}  ${oh}  ${lb}  ${gen}  ${bt}  ${sm}  ${cal}  ${pg}  ${rd}  ${dd}  ${cd}  ${od}  ${goal}  ${gbt}  ${pre}→${post}  Δ${d}s`;
}

function fmtHMS(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

btnCopyLog.addEventListener('click', () => {
  navigator.clipboard.writeText(JSON.stringify(lastTickLog, null, 2)).then(() => {
    btnCopyLog.textContent = 'Copied!';
    btnCopyLog.classList.add('copied');
    setTimeout(() => { btnCopyLog.textContent = 'Copy'; btnCopyLog.classList.remove('copied'); }, 1500);
  }).catch(() => {
    btnCopyLog.textContent = 'Error';
    setTimeout(() => { btnCopyLog.textContent = 'Copy'; }, 1500);
  });
});

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

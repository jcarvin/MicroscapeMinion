// Background service worker — state mirror, detection engine, alert dispatcher.
//
// Patch format (confirmed from live frames):
//   Initial state: top-level values wrapped in [value] arrays.
//   Delta updates follow jsondiffpatch: [current] = added; [previous, current] = modified; [old, 0, 0] = deleted.
//   Array-typed fields (e.g. toasts) use jsondiffpatch _t:"a" format.
//
// Confirmed field layout:
//   me.activity          — object when active, null/absent when idle
//   me.activity.skill    — "cooking"  (active-cycle shape)
//   me.activity.activity — "cook-bread"  (active-cycle shape; yes, activity.activity)
//   me.activity.remaining — cycles left in batch
//   me.activity.preparedActivity — { skill, zone, activity, ... }  (between-cycles shape)
//   me.inventory         — { camelCaseItemId: count }  flat object
//   me.lootBag           — { camelCaseItemId: count }  materials queued for processing
//
// Duration formula (confirmed from bundle):
//   displayedSeconds = (activityDef.duration + 6) * 2   →  durationMs = (duration + 6) * 2000

const INVENTORY_CAPACITY = 50;

// Bank trip timing — computed dynamically from zone mapPos when ZONE_DATA is available.
// BANK_TRIP_MS is the fallback used before the bundle is parsed.
// Travel speed empirically derived: distance 325.7 / 6 ticks observed for manor-kitchen.
// Banking time (8 ticks) observed from WebSocket frame.
const BANK_TRIP_MS = 50_000; // fallback (~50s covers most zones)
const TRAVEL_SPEED = 54.3;   // mapPos units per tick
const BANKING_TICKS = 8;     // ticks spent depositing
const TICK_MS = 2000;        // server tick duration (confirmed from bundle formula)

// ── Activity definition lookup ────────────────────────────────────────────────
// Populated from chrome.storage.local (cached live-bundle parse) on startup,
// falling back to the static seed JSON if no cache exists yet. The injected
// MAIN-world script fetches the live bundle on every page load and sends fresh
// defs via ACTIVITY_DEFS message, which overwrites the cache for future restarts.

let ACTIVITY_DEFS = {};
let ZONE_DATA = {}; // zoneId → [mapX, mapY] — used for dynamic bank trip calculation
let XP_TABLE = computeMicroscapeXpTable(); // XP_TABLE[level] = min total XP for that level (1-indexed)

chrome.storage.local.get(['activityDefs', 'zoneData', 'xpTable'], (res) => {
  if (res.activityDefs && Object.keys(res.activityDefs).length > 0) {
    ACTIVITY_DEFS = res.activityDefs;
  } else {
    // No cache yet — bootstrap from the bundled static seed
    fetch(chrome.runtime.getURL('src/activity-defs.json'))
      .then((r) => r.json())
      .then((data) => { if (Object.keys(ACTIVITY_DEFS).length === 0) ACTIVITY_DEFS = data; })
      .catch(() => {});
  }
  if (res.zoneData) ZONE_DATA = res.zoneData;
  if (isValidXpTable(res.xpTable)) XP_TABLE = res.xpTable;
});

// ── Module state ──────────────────────────────────────────────────────────────

let mirroredState = {};
let prevActivityId = undefined; // undefined = not yet observed

let microscopeTabId = null;

let observedTickMs = 2000;
let tickSamples = [];
let lastUpdateAt = null;

let goal = null; // { itemName, itemId, targetCount }
let goalNotifiedAt = null;
let runoutNotifiedFor = null;

chrome.storage.session.get(['goal'], (res) => {
  if (res.goal) goal = res.goal;
});

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.__mm) {
    if (sender.tab?.id) microscopeTabId = sender.tab.id;
    if (msg.direction === 'server') handleServerFrame(msg.frame);
    if (msg.direction === 'client') handleClientFrame(msg.frame);
    if (msg.type === 'ACTIVITY_DEFS' && msg.defs && Object.keys(msg.defs).length > 0) {
      ACTIVITY_DEFS = msg.defs;
      const toCache = { activityDefs: msg.defs };
      if (msg.zones && Object.keys(msg.zones).length > 0) {
        ZONE_DATA = msg.zones;
        toCache.zoneData = msg.zones;
      }
      if (isValidXpTable(msg.xpTable)) {
        XP_TABLE = msg.xpTable;
        toCache.xpTable = msg.xpTable;
      }
      chrome.storage.local.set(toCache);
    }
    return;
  }

  switch (msg?.type) {
    case 'SET_GOAL':
      goal = msg.goal ?? null;
      goalNotifiedAt = null;
      chrome.storage.session.set({ goal });
      respond({ ok: true });
      break;

    case 'CLEAR_GOAL':
      goal = null;
      goalNotifiedAt = null;
      chrome.storage.session.set({ goal: null });
      respond({ ok: true });
      break;

    case 'GET_STATUS':
      respond(buildStatus());
      break;
  }

  return true;
});

// ── Frame handlers ────────────────────────────────────────────────────────────

function handleServerFrame(frame) {
  if (frame.event !== 'update' || !frame.args?.length) return;
  calibrateTick();
  mirroredState = applyPatch(mirroredState, frame.args[0]);
  detectIdleTransition();
  detectGoalReached();
  detectMaterialRunout();
}

function handleClientFrame(frame) {
  if (frame.event !== 'input:game' || !frame.args?.length) return;
  if (frame.args[0]?.type !== 'stop-activity') return;
  if (!mirroredState.me) return;
  // Immediately mirror the stop — don't wait for the server update
  mirroredState = { ...mirroredState, me: { ...mirroredState.me, activity: null } };
  detectIdleTransition();
  detectMaterialRunout(); // clears runout state since activity is now null
}

// ── Patch application ─────────────────────────────────────────────────────────

function applyPatch(base, delta) {
  if (delta === null || delta === undefined) return delta;

  // jsondiffpatch delete marker: [oldValue, 0, 0] → remove the key
  if (Array.isArray(delta) && delta.length === 3 && delta[1] === 0 && delta[2] === 0) {
    return undefined;
  }
  // Scalar/initial delta:
  //   [current] = add/initial value
  //   [previous, current] = modified value
  if (Array.isArray(delta)) {
    if (delta.length === 1) return delta[0];
    if (delta.length === 2) return delta[1];
    return delta.length > 0 ? delta[0] : undefined;
  }

  // jsondiffpatch array delta (_t:"a") — used for ordered lists like toasts
  if (typeof delta === 'object' && delta._t === 'a') {
    const arr = Array.isArray(base) ? [...base] : [];
    const delIdxs = Object.keys(delta)
      .filter((k) => k !== '_t' && k.startsWith('_'))
      .map((k) => parseInt(k.slice(1), 10))
      .sort((a, b) => b - a);
    for (const i of delIdxs) {
      const d = delta[`_${i}`];
      if (Array.isArray(d) && d.length >= 1) arr.splice(i, 1);
    }
    for (const key of Object.keys(delta)) {
      if (key === '_t' || key.startsWith('_')) continue;
      const i = parseInt(key, 10);
      if (isNaN(i)) continue;
      const d = delta[key];
      if (Array.isArray(d) && d.length === 1) arr.splice(i, 0, d[0]);
      else arr[i] = applyPatch(arr[i], d);
    }
    return arr;
  }

  // Object delta — merge keys recursively
  if (typeof delta === 'object') {
    const result =
      base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
    for (const [k, v] of Object.entries(delta)) {
      const applied = applyPatch(result[k], v);
      if (applied === undefined) delete result[k];
      else result[k] = applied;
    }
    return result;
  }

  return delta;
}

// ── Activity helpers ──────────────────────────────────────────────────────────
//
// me.activity has several shapes:
//   Active cycle:   { skill, zone, activity, remaining, length, createdTick }
//   Between cycles: { preparedActivity: { skill, zone, activity, ... }, length, remaining }
//   Bank trip:      { type: "travel", destination: { map: "...-bank" }, desiredActivity: { type: "banking", ... }, remaining }
//
// Character is idle ONLY when me.activity is null/absent entirely.
// Travel and banking are transient states — not idle.

function getActivityId(act) {
  if (!act) return null;
  if (act.type === 'travel' || act.type === 'banking') return act.type;
  return act.activity ?? act.preparedActivity?.activity ?? null;
}

function getActivitySkill(act) {
  if (!act || act.type === 'travel' || act.type === 'banking') return null;
  return act.skill ?? act.preparedActivity?.skill ?? null;
}

function getActivityZone(act) {
  if (!act || act.type === 'travel' || act.type === 'banking') return null;
  return act.zone ?? act.preparedActivity?.zone ?? null;
}

// Computes round-trip bank time for a given zone using mapPos euclidean distance.
// Falls back to BANK_TRIP_MS if zone data hasn't been loaded from the bundle yet.
function bankTripMs(zoneId) {
  const zonePos = zoneId ? ZONE_DATA[zoneId] : null;
  if (!zonePos) return BANK_TRIP_MS;

  // Find nearest bank (zones ending in -bank, plus bank-vault)
  let minDist = Infinity;
  for (const [id, pos] of Object.entries(ZONE_DATA)) {
    if (!id.endsWith('-bank') && id !== 'bank-vault') continue;
    const d = Math.sqrt((pos[0] - zonePos[0]) ** 2 + (pos[1] - zonePos[1]) ** 2);
    if (d < minDist) minDist = d;
  }
  if (!isFinite(minDist)) return BANK_TRIP_MS;

  const travelTicks = Math.max(1, Math.round(minDist / TRAVEL_SPEED));
  return (2 * travelTicks + BANKING_TICKS) * TICK_MS;
}

// ── Idle detection ────────────────────────────────────────────────────────────

function detectIdleTransition() {
  const me = mirroredState.me;
  if (!me) return;

  const act = me.activity ?? null;
  const actId = getActivityId(act);

  if (prevActivityId !== undefined && prevActivityId !== null && actId === null) {
    fireNotification('idle', "Microscape: You're idle!", 'Your character stopped working.');
    sendChime('default');
  }

  prevActivityId = actId;
}

// ── Goal tracking ─────────────────────────────────────────────────────────────

function detectGoalReached() {
  if (!goal) return;
  const count = getInventoryCount(goal.itemName, goal.itemId);
  if (count === null || count < goal.targetCount) return;
  if (goalNotifiedAt) return;
  goalNotifiedAt = Date.now();
  fireNotification('goal', 'Microscape: Goal reached!', `${goal.itemName}: ${count} / ${goal.targetCount}`);
  sendChime('default');
}

// ── Material runout ───────────────────────────────────────────────────────────

function detectMaterialRunout() {
  const me = mirroredState.me;
  const act = me?.activity ?? null;
  if (!act) { runoutNotifiedFor = null; return; }

  const actId = getActivityId(act);
  if (!actId) return;

  const info = runoutInfo(actId);
  if (!info) return;

  if (info.cyclesLeft > 0) { runoutNotifiedFor = null; return; }

  if (runoutNotifiedFor === actId) return;
  runoutNotifiedFor = actId;
  fireNotification('runout', 'Microscape: Out of materials!', `${info.itemId} ran out — character will go idle.`);
  sendChime('runout');
}

// ── Status snapshot (for popup) ───────────────────────────────────────────────

function buildStatus() {
  const me = mirroredState.me;
  const act = me?.activity ?? null;

  const actSkill  = getActivitySkill(act);
  const actId     = getActivityId(act);
  const actDisplay = actId === 'travel' ? 'Traveling to bank'
    : actId === 'banking' ? 'Banking'
    : actSkill && actId ? `${actSkill} — ${actId}`
    : (actId ?? actSkill ?? null);

  let goalStatus = null;
  if (goal) {
    const count = getInventoryCount(goal.itemName, goal.itemId) ?? 0;
    const eta   = actId ? computeGoalEta(goal, count, actId) : null;
    goalStatus  = { goal, count, eta };
  }

  let runoutStatus = null;
  if (actId) {
    const info = runoutInfo(actId);
    if (info) {
      const etaMs = info.cyclesLeft * info.durationMs;
      runoutStatus = {
        itemId: info.itemId,
        totalMaterial: info.totalMaterial,
        cyclesLeft: info.cyclesLeft,
        etaMs,
      };
    }
  }

  const skillLevelStatus = actId && actSkill
    ? computeSkillLevelEtas(actId, actSkill)
    : null;

  // Items the current activity produces — drives the goal dropdown
  const producibleItems = [];
  if (actId && ACTIVITY_DEFS[actId]) {
    for (const [id, change] of Object.entries(ACTIVITY_DEFS[actId].inventoryChanges)) {
      if (change > 0) producibleItems.push({ id, count: getMaterialCount(id) });
    }
  }

  return {
    connected: microscopeTabId !== null,
    activity: actDisplay,
    idle: act === null && prevActivityId !== undefined,
    tickMs: observedTickMs,
    goalStatus,
    runoutStatus,
    skillLevelStatus,
    producibleItems,
    rawMe: me ?? null,
  };
}

// ── ETA calculation ───────────────────────────────────────────────────────────

function computeGoalEta(g, currentCount, actId) {
  const remaining = g.targetCount - currentCount;
  if (remaining <= 0) return 0;

  const def = ACTIVITY_DEFS[actId];
  if (!def) return null;

  // Find the goal item in the activity's output (positive inventoryChanges)
  const goalKey = findKey(def.inventoryChanges, g.itemName, g.itemId);
  const yieldPerCycle = goalKey ? (def.inventoryChanges[goalKey] ?? 0) : 0;
  if (yieldPerCycle <= 0) return null; // this activity doesn't produce the goal item

  const cyclesNeeded = Math.ceil(remaining / yieldPerCycle);
  const gatherMs = cyclesNeeded * def.durationMs;

  // Bank trips: account for loot bag already being partially full.
  // totalProduced items will flow into the loot bag; the first trip fires
  // sooner when there are fewer remaining slots.
  const totalProduced = cyclesNeeded * yieldPerCycle;
  const slotsLeft = Math.max(0, INVENTORY_CAPACITY - lootBagTotal());
  const bankTrips = totalProduced <= slotsLeft
    ? 0
    : 1 + Math.floor((totalProduced - slotsLeft) / INVENTORY_CAPACITY);
  const zoneId = getActivityZone(mirroredState.me?.activity ?? null);
  const bankOverheadMs = bankTrips * bankTripMs(zoneId);

  return { totalMs: gatherMs + bankOverheadMs, bankTrips };
}

function computeSkillLevelEtas(actId, skill) {
  const def = ACTIVITY_DEFS[actId];
  const xpPerCycle = def?.xpPerCycle ?? 0;
  if (!def || xpPerCycle <= 0 || XP_TABLE.length < 3) return null;

  const currentXp = mirroredState.me?.exp?.[skill];
  if (typeof currentXp !== 'number' || !isFinite(currentXp)) return null;

  const currentLevel = getLevelFromXp(currentXp);
  const etas = [];
  for (let offset = 1; offset <= 10; offset++) {
    const targetLevel = currentLevel + offset;
    const targetXp = XP_TABLE[targetLevel];
    if (typeof targetXp !== 'number') break;

    const xpNeeded = Math.max(0, targetXp - currentXp);
    const cyclesNeeded = Math.ceil(xpNeeded / xpPerCycle);
    etas.push({
      targetLevel,
      xpNeeded,
      etaMs: cyclesNeeded * def.durationMs,
    });
  }

  if (etas.length === 0) return null;
  return { skill, currentXp, currentLevel, xpPerCycle, etas };
}

// ── Runout info ───────────────────────────────────────────────────────────────
// Returns the bottleneck consumed material — the one that will run out first.
// For multi-input activities (e.g. soft clay: clay + water) this finds the
// input with the fewest cycles remaining, not just the first one listed.

function runoutInfo(actId) {
  const def = ACTIVITY_DEFS[actId];
  if (!def) return null;

  // Consumed items are drawn from inventory only — loot bag items can't be
  // used directly and would inflate the count if included via getMaterialCount.
  const inv = mirroredState.me?.inventory ?? {};

  let bottleneck = null;
  for (const [itemId, change] of Object.entries(def.inventoryChanges)) {
    if (change >= 0) continue;
    const costPerCycle = -change;
    const available = inv[itemId] ?? 0;
    const cyclesLeft = Math.floor(available / costPerCycle);
    if (!bottleneck || cyclesLeft < bottleneck.cyclesLeft) {
      bottleneck = { itemId, costPerCycle, totalMaterial: available, cyclesLeft, durationMs: def.durationMs };
    }
  }

  return bottleneck; // null if no consumed materials (gathering, combat, etc.)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Total material available = inventory + lootBag
function getMaterialCount(itemId) {
  const me = mirroredState.me;
  const inv = me?.inventory?.[itemId] ?? 0;
  const lb  = me?.lootBag?.[itemId]  ?? 0;
  return inv + lb;
}

// Total items currently occupying the loot bag (all types combined)
function lootBagTotal() {
  const lb = mirroredState.me?.lootBag;
  if (!lb) return 0;
  return Object.values(lb).reduce((sum, n) => sum + n, 0);
}

function getInventoryCount(itemName, itemId) {
  const inv = mirroredState.me?.inventory;
  if (!inv || typeof inv !== 'object') return null;
  if (itemId && itemId in inv) return inv[itemId];
  if (itemName) {
    const key = findInventoryKey(itemName);
    if (key) return inv[key];
  }
  return 0;
}

// Case-insensitive, whitespace-ignoring key lookup against inventory
function findInventoryKey(itemName) {
  const inv = mirroredState.me?.inventory;
  if (!inv) return null;
  const norm = itemName.toLowerCase().replace(/[\s_-]/g, '');
  return Object.keys(inv).find((k) => k.toLowerCase().replace(/[\s_-]/g, '') === norm) ?? null;
}

// Same lookup against an arbitrary object (used for inventoryChanges keys)
function findKey(obj, itemName, itemId) {
  if (!obj) return null;
  if (itemId && itemId in obj) return itemId;
  if (!itemName) return null;
  const norm = itemName.toLowerCase().replace(/[\s_-]/g, '');
  return Object.keys(obj).find((k) => k.toLowerCase().replace(/[\s_-]/g, '') === norm) ?? null;
}

function getLevelFromXp(xp) {
  if (XP_TABLE.length < 3) return 1;

  let lo = 1;
  let hi = XP_TABLE.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (XP_TABLE[mid] <= xp) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, hi);
}

function isValidXpTable(table) {
  return Array.isArray(table)
    && table.length >= 99
    && table[1] === 0
    && table[2] === 830
    && table[17] === 31174;
}

function computeMicroscapeXpTable() {
  const table = [0, 0];
  let points = 0;
  for (let level = 1; level <= 98; level++) {
    points += Math.floor(10 * (level + 300 * Math.pow(2, level / 7)));
    table.push(Math.floor(points / 4));
  }
  return table;
}

function calibrateTick() {
  const now = Date.now();
  if (lastUpdateAt !== null) {
    const d = now - lastUpdateAt;
    if (d > 500 && d < 10_000) {
      tickSamples.push(d);
      if (tickSamples.length > 20) tickSamples.shift();
      observedTickMs = Math.round(tickSamples.reduce((a, b) => a + b, 0) / tickSamples.length);
    }
  }
  lastUpdateAt = now;
}

// ── Notifications and audio ───────────────────────────────────────────────────

function fireNotification(id, title, message) {
  chrome.notifications.create(`mm-${id}-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title,
    message,
    priority: 2,
  });
}

function sendChime(variant) {
  if (microscopeTabId == null) return;
  chrome.tabs.sendMessage(microscopeTabId, { type: 'PLAY_CHIME', variant }).catch(() => {});
}

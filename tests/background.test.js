import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pietyDef = {
  durationMs: 16000,
  xpPerCycle: 4,
  inventoryChanges: {
    bones: -1,
    spiritRune: 1,
  },
};

function installChromeMock({ cachedDefs = null, localData = {}, storageSet = vi.fn(), sessionData = {} } = {}) {
  globalThis.chrome = {
    runtime: {
      getURL: vi.fn((path) => path),
      lastError: null,
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn((keys, callback) => {
          const stored = cachedDefs ? { ...localData, activityDefs: cachedDefs } : localData;
          callback(Object.fromEntries(keys.flatMap((key) => (
            Object.hasOwn(stored, key) ? [[key, stored[key]]] : []
          ))));
        }),
        remove: vi.fn(),
        set: storageSet,
      },
      session: {
        get: vi.fn((_keys, callback) => callback(sessionData)),
        remove: vi.fn(),
        set: vi.fn(),
      },
    },
    notifications: { create: vi.fn() },
    tabs: { sendMessage: vi.fn(() => Promise.resolve()) },
  };
}

async function loadBackground({ cachedDefs = null, localData, seed = {}, storageSet, sessionData } = {}) {
  vi.resetModules();
  installChromeMock({ cachedDefs, localData, storageSet, sessionData });
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    json: () => Promise.resolve(seed),
  })));
  const mod = await import('../src/background.js');
  await Promise.resolve();
  await Promise.resolve();
  return mod;
}

function runtimeListener() {
  return globalThis.chrome.runtime.onMessage.addListener.mock.calls[0][0];
}

function sendRuntimeMessage(msg) {
  const respond = vi.fn();
  runtimeListener()(msg, { tab: { id: 1 } }, respond);
  return respond;
}

function sendServerUpdate(delta) {
  return sendRuntimeMessage({
    __mm: true,
    direction: 'server',
    frame: { event: 'update', args: [delta] },
  });
}

describe('background activity definitions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('merges missing seed activity definitions into an existing cache', async () => {
    const { __test } = await loadBackground();
    const cached = {
      'cook-bread': {
        durationMs: 28000,
        inventoryChanges: { dough: -1, bread: 1 },
      },
    };
    const seed = {
      'cook-bread': {
        durationMs: 1,
        inventoryChanges: { overwritten: 1 },
      },
      'bury-bones': pietyDef,
    };

    const result = __test.mergeMissingActivityDefs(cached, seed);

    expect(result.added).toBe(true);
    expect(result.defs['cook-bread']).toBe(cached['cook-bread']);
    expect(result.defs['bury-bones']).toEqual(pietyDef);
    expect(cached['bury-bones']).toBeUndefined();
  });

  it('migrates a stored single goal to the ordered goals array', async () => {
    const legacyGoal = { itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 200 };
    const { __test } = await loadBackground({ sessionData: { goal: legacyGoal } });

    expect(__test.buildStatus().goalStatuses[0].goal).toMatchObject(legacyGoal);
    expect(__test.buildStatus().goalStatuses[0].goal.id).toBe('legacy-0-ironOre');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      goals: [{ id: 'legacy-0-ironOre', ...legacyGoal }],
    });
    expect(chrome.storage.session.remove).toHaveBeenCalledWith(['goals', 'goal']);
  });

  it('restores durable goals in their saved order', async () => {
    const goals = [
      { id: 'stone', itemId: 'stone', itemName: 'Stone', targetCount: 20 },
      { id: 'wood', itemId: 'woodLog', itemName: 'Wood Log', targetCount: 100 },
    ];
    const { __test } = await loadBackground({
      localData: { goals },
      sessionData: { goals: [...goals].reverse() },
    });

    expect(__test.buildStatus().goalStatuses.map(({ goal }) => goal.id)).toEqual([
      'stone',
      'wood',
    ]);
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith({ goals });
  });

  it('keeps an empty durable goal list instead of reviving stale session goals', async () => {
    const { __test } = await loadBackground({
      localData: { goals: [] },
      sessionData: {
        goals: [{ id: 'stale', itemName: 'Coal', itemId: 'coal', targetCount: 50 }],
      },
    });

    expect(__test.buildStatus().goalStatuses).toEqual([]);
  });

  it('writes goal changes to durable storage in their submitted order', async () => {
    const goals = [
      { id: 'wood', itemName: 'Wood Log', itemId: 'woodLog', targetCount: 100 },
      { id: 'stone', itemName: 'Stone', itemId: 'stone', targetCount: 20 },
    ];
    await loadBackground({ localData: { goals: [] } });

    sendRuntimeMessage({ type: 'SET_GOALS', goals });

    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({ goals });
    expect(chrome.storage.session.set).not.toHaveBeenCalledWith({ goals });
  });

  it('normalizes malformed goals and makes duplicate IDs unique', async () => {
    const { __test } = await loadBackground();

    expect(__test.normalizeGoals([
      { id: 'same', itemId: 'woodLog', targetCount: '10' },
      { id: 'same', itemName: 'Stone', targetCount: 20 },
      { id: 'bad', itemId: 'coal', targetCount: 0 },
      null,
    ])).toEqual([
      { id: 'same', itemId: 'woodLog', itemName: 'woodLog', targetCount: 10 },
      { id: 'same-2', itemId: null, itemName: 'Stone', targetCount: 20 },
    ]);
  });

  it('writes merged seed activities back when cached definitions are stale', async () => {
    const storageSet = vi.fn();
    const cachedDefs = {
      'cook-bread': {
        durationMs: 28000,
        inventoryChanges: { dough: -1, bread: 1 },
      },
    };

    await loadBackground({
      cachedDefs,
      seed: { 'bury-bones': pietyDef },
      storageSet,
    });

    expect(storageSet).toHaveBeenCalledWith({
      activityDefs: {
        ...cachedDefs,
        'bury-bones': pietyDef,
      },
    });
  });

  it('reports piety material runout and skill XP data from seeded bone definitions', async () => {
    const { __test } = await loadBackground();
    __test.resetTestState();
    __test.setTestState({
      activityDefs: { 'bury-bones': pietyDef },
      state: {
        me: {
          activity: {
            skill: 'piety',
            activity: 'bury-bones',
            remaining: 1,
          },
          exp: { piety: 0 },
          inventory: { bones: 100 },
          lootBag: {},
        },
      },
    });

    const status = __test.buildStatus();

    expect(status.runoutStatus).toMatchObject({
      itemId: 'bones',
      costPerCycle: 1,
      totalMaterial: 100,
      cyclesLeft: 100,
      bankTrips: 4,
      etaMs: 1800000,
    });
    expect(status.skillLevelStatus).toMatchObject({
      skill: 'piety',
      currentLevel: 1,
      xpPerCycle: 4,
    });
    expect(status.skillLevelStatus.etas[0]).toMatchObject({
      targetLevel: 2,
      xpNeeded: 830,
      etaMs: 3728000,
      bankTrips: 8,
      bankOverheadMs: 400000,
    });
  });

  it('tracks multiple goals and floats current-activity items in the full catalog', async () => {
    const { __test } = await loadBackground();
    __test.resetTestState();
    __test.setTestState({
      activityDefs: {
        'mine-iron': {
          durationMs: 32_000,
          inventoryChanges: { coal: -1, ironOre: 1 },
          dropItems: { sapphire: 1 },
        },
        'bake-bread': {
          durationMs: 20_000,
          inventoryChanges: { dough: -1, bread: 1 },
        },
      },
      state: {
        me: {
          activity: { skill: 'mining', activity: 'mine-iron', remaining: 1 },
          inventory: { coal: 10, ironOre: 5, bread: 2, mysteryItem: 7 },
          lootBag: {},
        },
      },
    });
    sendRuntimeMessage({
      type: 'SET_GOALS',
      goals: [
        { id: 'ore', itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 20 },
        { id: 'bread', itemName: 'Bread', itemId: 'bread', targetCount: 10 },
      ],
    });

    const status = __test.buildStatus();
    expect(status.goalStatuses).toMatchObject([
      { goal: { id: 'ore' }, count: 5, relatedToActivity: true },
      { goal: { id: 'bread' }, count: 2, relatedToActivity: false, eta: null },
    ]);
    expect(status.goalStatuses[0].eta.totalMs).toBeGreaterThan(0);
    expect(status.goalItems.map(({ id }) => id)).toEqual(expect.arrayContaining([
      'bread', 'coal', 'dough', 'ironOre', 'mysteryItem', 'sapphire',
    ]));
    const firstUnrelated = status.goalItems.findIndex(({ relatedToActivity }) => !relatedToActivity);
    expect(firstUnrelated).toBeGreaterThan(0);
    expect(status.goalItems.slice(0, firstUnrelated).every(({ relatedToActivity }) => relatedToActivity)).toBe(true);
    expect(status.goalItems.slice(firstUnrelated).every(({ relatedToActivity }) => !relatedToActivity)).toBe(true);
  });

  it('notifies independently when multiple goals are reached', async () => {
    const { __test } = await loadBackground();
    __test.resetTestState();
    __test.setTestState({
      state: {
        me: {
          activity: { skill: 'mining', activity: 'mine-iron', remaining: 1 },
          inventory: { ironOre: 0, coal: 0 },
          lootBag: {},
        },
      },
    });
    sendRuntimeMessage({
      type: 'SET_GOALS',
      goals: [
        { id: 'ore', itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 1 },
        { id: 'coal', itemName: 'Coal', itemId: 'coal', targetCount: 1 },
      ],
    });

    sendServerUpdate({ me: { inventory: { ironOre: [0, 1], coal: [0, 1] } } });
    expect(chrome.notifications.create).toHaveBeenCalledTimes(2);
    expect(chrome.notifications.create.mock.calls.map(([, options]) => options.message)).toEqual([
      'Iron Ore: 1 / 1',
      'Coal: 1 / 1',
    ]);

    sendServerUpdate({ me: { inventory: { ironOre: [1, 2] } } });
    expect(chrome.notifications.create).toHaveBeenCalledTimes(2);
  });

  it('uses warmed observed accumulation rate for material goal ETA', async () => {
    const { __test } = await loadBackground();
    vi.useFakeTimers();
    __test.resetTestState();
    __test.setTestState({
      activityDefs: {
        'mine-iron': {
          durationMs: 32000,
          xpPerCycle: 10,
          inventoryChanges: { ironOre: 1 },
        },
      },
      state: {
        me: {
          activity: { skill: 'mining', activity: 'mine-iron', remaining: 1 },
          exp: { mining: 0 },
          inventory: { ironOre: 0 },
          lootBag: {},
        },
      },
    });
    sendRuntimeMessage({
      type: 'SET_GOALS',
      goals: [{ id: 'iron-goal', itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 200 }],
    });

    vi.setSystemTime(1_000);
    sendServerUpdate({ me: { inventory: { ironOre: [0, 1] } } });

    vi.setSystemTime(61_000);
    const warmingStatus = __test.buildStatus();
    expect(warmingStatus.goalStatuses[0].eta.rateBased).toBeFalsy();
    expect(warmingStatus.goalStatuses[0].warmupRemainingMs).toBe(240_000);

    vi.setSystemTime(301_000);
    sendServerUpdate({ me: { inventory: { ironOre: [1, 5] } } });

    const status = __test.buildStatus();

    expect(status.etaDebugLogVersion).toBe(1);
    expect(status.goalStatuses[0].count).toBe(5);
    expect(status.goalStatuses[0].eta).toMatchObject({
      rateBased: true,
      sampleCount: 2,
      bankTrips: 7,
      bankOverheadMs: 350_000,
      totalMs: 14_975_000,
    });
    expect(status.goalStatuses[0].warmupRemainingMs).toBe(0);
    expect(status.etaDebugLog[0]).toMatchObject({
      phase: 'active',
      goal: {
        itemId: 'ironOre',
        currentCount: 5,
        model: 'rate',
        etaMs: 14_975_000,
        samples: {
          source: 'inventoryChanges',
          count: 2,
          wallSpanMs: 300_000,
          workSpanMs: 300_000,
        },
      },
      bank: {
        lootBagItems: 0,
        triggerItemCount: 25,
      },
    });
  });

  it('preserves warmed goal rate samples when updating the same goal item', async () => {
    const { __test } = await loadBackground();
    vi.useFakeTimers();
    __test.resetTestState();
    __test.setTestState({
      activityDefs: {
        'mine-iron': {
          durationMs: 32000,
          xpPerCycle: 10,
          inventoryChanges: { ironOre: 1 },
        },
      },
      state: {
        me: {
          activity: { skill: 'mining', activity: 'mine-iron', remaining: 1 },
          exp: { mining: 0 },
          inventory: { ironOre: 0 },
          lootBag: {},
        },
      },
    });
    sendRuntimeMessage({
      type: 'SET_GOALS',
      goals: [{ id: 'iron-goal', itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 200 }],
    });

    vi.setSystemTime(1_000);
    sendServerUpdate({ me: { inventory: { ironOre: [0, 1] } } });
    vi.setSystemTime(301_000);
    sendServerUpdate({ me: { inventory: { ironOre: [1, 5] } } });

    expect(__test.buildStatus().goalStatuses[0]).toMatchObject({
      warmupRemainingMs: 0,
      eta: {
        rateBased: true,
        sampleCount: 2,
      },
    });

    sendRuntimeMessage({
      type: 'SET_GOALS',
      goals: [{ id: 'iron-goal', itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 250 }],
    });

    expect(__test.buildStatus().goalStatuses[0]).toMatchObject({
      goal: { targetCount: 250 },
      warmupRemainingMs: 0,
      eta: {
        rateBased: true,
        sampleCount: 2,
      },
    });
  });

  it('does not double-count mirrored inventory and loot bag goal progress', async () => {
    const { __test } = await loadBackground();
    vi.useFakeTimers();
    __test.resetTestState();
    const miningAct = { skill: 'mining', activity: 'mine-iron', remaining: 1 };
    __test.setTestState({
      activityDefs: {
        'mine-iron': {
          durationMs: 32000,
          xpPerCycle: 10,
          inventoryChanges: { ironOre: 1 },
        },
      },
      state: {
        me: {
          activity: miningAct,
          exp: { mining: 0 },
          inventory: { ironOre: 0 },
          lootBag: {},
        },
      },
      lastWorkAct: miningAct,
    });
    sendRuntimeMessage({
      type: 'SET_GOALS',
      goals: [{ id: 'iron-goal', itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 20 }],
    });

    vi.setSystemTime(1_000);
    sendServerUpdate({
      me: {
        inventory: { ironOre: [0, 1] },
        lootBag: { ironOre: [1] },
      },
    });

    let status = __test.buildStatus();
    expect(status.goalStatuses[0].count).toBe(1);

    vi.setSystemTime(301_000);
    sendServerUpdate({
      me: {
        inventory: { ironOre: [1, 5] },
        lootBag: { ironOre: [1, 5] },
      },
    });

    status = __test.buildStatus();
    expect(status.goalStatuses[0].count).toBe(5);
    expect(status.goalStatuses[0].eta.sampleCount).toBe(2);

    vi.setSystemTime(335_000);
    sendServerUpdate({
      me: {
        activity: [miningAct, { type: 'banking' }],
        lootBag: { ironOre: [5, 0] },
      },
    });

    status = __test.buildStatus();
    expect(status.goalStatuses[0].count).toBe(5);

    vi.setSystemTime(360_000);
    sendServerUpdate({
      me: {
        activity: [{ type: 'banking' }, miningAct],
        inventory: { ironOre: [5, 6] },
        lootBag: { ironOre: [0, 1] },
      },
    });

    status = __test.buildStatus();
    expect(status.goalStatuses[0].count).toBe(6);
  });

  it('holds remaining stable across a bank trip (high-water mark)', async () => {
    const { __test } = await loadBackground();
    vi.useFakeTimers();
    __test.resetTestState();
    const miningAct = { skill: 'mining', activity: 'mine-iron', remaining: 1 };
    __test.setTestState({
      activityDefs: {
        'mine-iron': {
          durationMs: 32000,
          xpPerCycle: 10,
          inventoryChanges: { ironOre: 1 },
        },
      },
      state: {
        me: {
          activity: miningAct,
          exp: { mining: 0 },
          inventory: { ironOre: 0 },
          lootBag: {},
        },
      },
      lastWorkAct: miningAct,
    });
    sendRuntimeMessage({
      type: 'SET_GOALS',
      goals: [{ id: 'iron-goal', itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 200 }],
    });

    // Mine 10 ores over 5 minutes (past warmup) — activity stays mining
    vi.setSystemTime(1_000);
    sendServerUpdate({ me: { lootBag: { ironOre: [5] } } });
    vi.setSystemTime(301_000);
    sendServerUpdate({ me: { lootBag: { ironOre: [5, 10] } } }); // hwm = 10

    // Bank trip simulation: count drops while in banking (non-work) activity
    vi.setSystemTime(335_000);
    sendServerUpdate({ me: { activity: [miningAct, { type: 'banking' }], lootBag: { ironOre: [10, 0] } } });
    vi.setSystemTime(345_000);
    // Return to mining with 2 new ores — activity back to work
    sendServerUpdate({ me: { activity: [{ type: 'banking' }, miningAct], lootBag: { ironOre: [2] } } });

    // Remaining should use high-water mark (10), not live count (2).
    // ETA = (200 - 10) = 190 remaining, not inflated (200 - 2) = 198.
    const status = __test.buildStatus();
    expect(status.goalStatuses[0].count).toBe(2);  // live inventory+lootBag shown to user
    // hwm-based ETA: 190 cycles × 32000ms + 7 bank trips × 50000ms = 6,430,000ms
    // live-count ETA: 198 cycles × 32000ms + 7 bank trips × 50000ms = 6,686,000ms
    // Verify we're using hwm (190 remaining), not the inflated live count (198 remaining)
    expect(status.goalStatuses[0].eta.totalMs).toBeLessThan(198 * 32_000 + 7 * 50_000); // < live-count ETA
    expect(status.goalStatuses[0].eta.totalMs).toBeGreaterThan(185 * 32_000);            // clearly non-zero
  });

  it('does not charge an extra bank trip when travel/banking is already in progress', async () => {
    const { __test } = await loadBackground();
    vi.useFakeTimers();
    __test.resetTestState();
    const smeltAct = { skill: 'smithing', activity: 'smelt-iron', remaining: 1 };
    __test.setTestState({
      activityDefs: {
        'smelt-iron': {
          durationMs: 30_000,
          xpPerCycle: 12,
          inventoryChanges: { ironBar: 1 },
        },
      },
      state: {
        me: {
          activity: smeltAct,
          exp: { smithing: 0 },
          inventory: { ironBar: 34 },
          lootBag: {},
        },
      },
      lastWorkAct: smeltAct,
    });
    sendRuntimeMessage({
      type: 'SET_GOALS',
      goals: [{ id: 'bar-goal', itemName: 'Iron Bar', itemId: 'ironBar', targetCount: 55 }],
    });

    // Before banking: lootBag empty, 21 bars remaining.
    // generatedItems=21, freeSlotsBeforeFirstTrip=25 → 21≤25 → bankTrips=0
    const etaBefore = __test.buildStatus().goalStatuses[0].eta;
    expect(etaBefore.bankTrips).toBe(0);
    const totalMsBefore = etaBefore.totalMs;

    // Loot bag fills with other items (not ironBar) and banking starts.
    // The current trip is in progress — must NOT add an extra bankTripMs.
    sendServerUpdate({
      me: {
        activity: [smeltAct, { type: 'banking' }],
        lootBag: { ironOre: [0, 25] },
      },
    });
    const etaDuring = __test.buildStatus().goalStatuses[0].eta;
    expect(etaDuring.bankTrips).toBe(0);
    expect(etaDuring.totalMs).toBe(totalMsBefore);

    // Banking completes: loot bag cleared, back to smelting.
    sendServerUpdate({
      me: {
        activity: [{ type: 'banking' }, smeltAct],
        lootBag: { ironOre: [25, 0] },
      },
    });
    const etaAfter = __test.buildStatus().goalStatuses[0].eta;
    expect(etaAfter.bankTrips).toBe(0);
    expect(etaAfter.totalMs).toBe(totalMsBefore);
  });

  it('keeps goals across activity changes and only estimates related goals', async () => {
    const { __test } = await loadBackground();
    __test.resetTestState();
    const miningAct = { skill: 'mining', activity: 'mine-iron', remaining: 1 };
    const smeltAct = { skill: 'smithing', activity: 'smelt-iron', remaining: 1 };
    __test.setTestState({
      activityDefs: {
        'mine-iron': {
          durationMs: 32_000,
          xpPerCycle: 10,
          inventoryChanges: { ironOre: 1 },
        },
        'smelt-iron': {
          durationMs: 30_000,
          xpPerCycle: 12,
          inventoryChanges: { ironBar: 1 },
        },
      },
      state: {
        me: {
          activity: miningAct,
          exp: { mining: 0 },
          inventory: { ironOre: 5, ironBar: 0 },
          lootBag: {},
        },
      },
      lastWorkAct: miningAct,
    });
    sendRuntimeMessage({
      type: 'SET_GOALS',
      goals: [{ id: 'iron-goal', itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 20 }],
    });

    sendServerUpdate({
      me: {
        activity: [miningAct, { type: 'banking' }],
      },
    });
    expect(__test.buildStatus().goalStatuses[0]).toMatchObject({
      goal: { itemId: 'ironOre' },
      relatedToActivity: true,
    });

    sendServerUpdate({
      me: {
        activity: [{ type: 'banking' }, smeltAct],
      },
    });
    expect(__test.buildStatus().goalStatuses[0]).toMatchObject({
      goal: { itemId: 'ironOre' },
      relatedToActivity: false,
      eta: null,
    });
  });

  it('clears goal rate samples when banked count slips below last sample (missed banking transition)', async () => {
    const { __test } = await loadBackground();
    vi.useFakeTimers();
    __test.resetTestState();
    const miningAct = { skill: 'mining', activity: 'mine-iron', remaining: 1 };
    __test.setTestState({
      activityDefs: {
        'mine-iron': {
          durationMs: 32000,
          xpPerCycle: 10,
          inventoryChanges: { ironOre: 1 },
        },
      },
      state: {
        me: {
          activity: miningAct,
          exp: { mining: 0 },
          inventory: { ironOre: 0 },
          lootBag: {},
        },
      },
      lastWorkAct: miningAct,
    });
    sendRuntimeMessage({
      type: 'SET_GOALS',
      goals: [{ id: 'iron-goal', itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 200 }],
    });

    // Mine 10 ores past warmup → 2 samples pushed with values 5 and 10
    vi.setSystemTime(1_000);
    sendServerUpdate({ me: { lootBag: { ironOre: [5] } } });
    vi.setSystemTime(301_000);
    sendServerUpdate({ me: { lootBag: { ironOre: [5, 10] } } });

    // Bank trip: count drops to 0 during non-work (banking) activity —
    // the existing newCount<prevCount clear branch is skipped because both
    // prevAct and newAct resolve to non-work IDs on the banking→travel tick.
    vi.setSystemTime(335_000);
    sendServerUpdate({ me: { activity: [miningAct, { type: 'banking' }], lootBag: { ironOre: [10, 0] } } });
    vi.setSystemTime(345_000);
    sendServerUpdate({ me: { activity: [{ type: 'banking' }, { type: 'travel' }] } });
    vi.setSystemTime(355_000);
    // Return to mining — activity becomes work again; lootBag still 0
    sendServerUpdate({ me: { activity: [{ type: 'travel' }, miningAct] } });

    // First ore after bank trip: count = 1, which is below last sample value (10).
    // The monotonic check should clear stale samples so a bad rate isn't used.
    vi.setSystemTime(360_000);
    sendServerUpdate({ me: { lootBag: { ironOre: [1] } } });

    const status = __test.buildStatus();
    // Only 1 post-reset sample → rate warmup not met → cycle-fallback, not rate model
    expect(status.goalStatuses[0].eta.rateBased).toBeFalsy();
  });

  it('uses warmed observed consumption rate for material runout ETA', async () => {
    const { __test } = await loadBackground();
    vi.useFakeTimers();
    __test.resetTestState();
    __test.setTestState({
      activityDefs: {
        'make-soft-clay': {
          durationMs: 16000,
          inventoryChanges: { clay: -1, softClay: 1 },
        },
      },
      state: {
        me: {
          activity: { skill: 'crafting', activity: 'make-soft-clay', remaining: 1 },
          inventory: { clay: 100 },
          lootBag: {},
        },
      },
    });

    vi.setSystemTime(1_000);
    sendServerUpdate({ me: { inventory: { clay: [100, 99] } } });
    vi.setSystemTime(301_000);
    sendServerUpdate({ me: { inventory: { clay: [99, 89] } } });

    expect(__test.buildStatus().runoutStatus).toMatchObject({
      itemId: 'clay',
      totalMaterial: 89,
      rateBased: true,
      runoutSampleCount: 2,
      bankTrips: 3,
      bankOverheadMs: 150_000,
      etaMs: 2_820_000,
    });
  });

  it('uses warmed observed XP rate for skill ETA', async () => {
    const { __test } = await loadBackground();
    vi.useFakeTimers();
    __test.resetTestState();
    __test.setTestState({
      activityDefs: { 'bury-bones': pietyDef },
      state: {
        me: {
          activity: { skill: 'piety', activity: 'bury-bones', remaining: 1 },
          exp: { piety: 0 },
          inventory: { bones: 100 },
          lootBag: {},
        },
      },
    });

    vi.setSystemTime(1_000);
    sendServerUpdate({ me: { exp: { piety: [0, 10] } } });
    vi.setSystemTime(301_000);
    sendServerUpdate({ me: { exp: { piety: [10, 50] } } });

    expect(__test.buildStatus().skillLevelStatus).toMatchObject({
      skill: 'piety',
      currentXp: 50,
      observedXpPerMs: 40 / 300_000,
    });
    expect(__test.buildStatus().skillLevelStatus.etas[0]).toMatchObject({
      targetLevel: 2,
      xpNeeded: 780,
      bankTrips: 14,
      bankOverheadMs: 700_000,
      etaMs: 6_550_000,
    });
  });

  it('uses warmed observed burn rate for combat consumables and resets on refill', async () => {
    const { __test } = await loadBackground();
    vi.useFakeTimers();
    __test.resetTestState();
    __test.setTestState({
      activityDefs: {
        'fight-rat': {
          durationMs: 12000,
          inventoryChanges: {},
          dropItems: { ratTail: 1 },
        },
      },
      state: {
        me: {
          activity: { combatSkill: 'attack', activity: 'fight-rat', mob: 'rat' },
          inventory: { potion: 10 },
          lootBag: {},
        },
      },
    });

    vi.setSystemTime(1_000);
    sendServerUpdate({ me: { inventory: { potion: [10, 9] } } });
    vi.setSystemTime(301_000);
    sendServerUpdate({ me: { inventory: { potion: [9, 7] } } });

    expect(__test.buildStatus().combatConsumables).toEqual([
      { itemId: 'potion', currentCount: 7, etaMs: 1_050_000, sampleCount: 2 },
    ]);

    vi.setSystemTime(302_000);
    sendServerUpdate({ me: { inventory: { potion: [7, 20] } } });

    expect(__test.buildStatus().combatConsumables).toBeNull();
  });

  it('does not track inventory drops on the combat-to-banking transition as consumables', async () => {
    const { __test } = await loadBackground();
    vi.useFakeTimers();
    __test.resetTestState();
    const combatAct = { combatSkill: 'attack', activity: 'fight-rat', mob: 'rat' };
    __test.setTestState({
      activityDefs: {
        'fight-rat': {
          durationMs: 12000,
          inventoryChanges: {},
          dropItems: {},
        },
      },
      state: {
        me: {
          activity: combatAct,
          inventory: { armor: 1 },
          lootBag: {},
        },
      },
    });

    // Transition to banking — armor is deposited (inventory drops). This should
    // NOT be recorded as consumable use because the drop is a bank deposit.
    vi.setSystemTime(1_000);
    sendServerUpdate({
      me: {
        activity: [combatAct, { type: 'banking' }],
        inventory: { armor: [1, 0] },
      },
    });

    expect(__test.buildStatus().combatConsumables).toBeNull();
  });

  it('fires a runout notification when a watched consumable hits 0', async () => {
    const { __test } = await loadBackground();
    vi.useFakeTimers();
    __test.resetTestState();
    __test.setTestState({
      activityDefs: {
        'fight-rat': {
          durationMs: 12000,
          inventoryChanges: {},
          dropItems: { ratTail: 1 },
        },
      },
      state: {
        me: {
          activity: { combatSkill: 'attack', activity: 'fight-rat', mob: 'rat' },
          inventory: { potion: 2 },
          lootBag: {},
        },
      },
    });
    sendRuntimeMessage({ type: 'SET_CONSUMABLE_NOTIFY', itemId: 'potion' });

    const spy = vi.spyOn(chrome.notifications, 'create');
    vi.setSystemTime(1_000);
    sendServerUpdate({ me: { inventory: { potion: [2, 0] } } });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][1]).toMatchObject({
      title: 'Microscape: Out of supplies!',
      message: 'Potion ran out.',
    });

    // Should not fire again on subsequent ticks at 0
    spy.mockClear();
    vi.setSystemTime(3_000);
    sendServerUpdate({ me: { inventory: { potion: [0] } } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('hides combat consumables that are depleted (currentCount === 0)', async () => {
    const { __test } = await loadBackground();
    vi.useFakeTimers();
    __test.resetTestState();
    __test.setTestState({
      activityDefs: {
        'fight-rat': {
          durationMs: 12000,
          inventoryChanges: {},
          dropItems: { ratTail: 1 },
        },
      },
      state: {
        me: {
          activity: { combatSkill: 'attack', activity: 'fight-rat', mob: 'rat' },
          inventory: { potion: 2 },
          lootBag: {},
        },
      },
    });

    vi.setSystemTime(1_000);
    sendServerUpdate({ me: { inventory: { potion: [2, 1] } } });
    vi.setSystemTime(301_000);
    sendServerUpdate({ me: { inventory: { potion: [1, 0] } } });

    // Item is at 0 — should not appear even though samples exist
    expect(__test.buildStatus().combatConsumables).toBeNull();
  });
});

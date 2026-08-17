import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pietyDef = {
  durationMs: 16000,
  xpPerCycle: 4,
  inventoryChanges: {
    bones: -1,
    spiritRune: 1,
  },
};

function installChromeMock({ cachedDefs = null, storageSet = vi.fn() } = {}) {
  globalThis.chrome = {
    runtime: {
      getURL: vi.fn((path) => path),
      lastError: null,
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn((_keys, callback) => callback(cachedDefs ? { activityDefs: cachedDefs } : {})),
        remove: vi.fn(),
        set: storageSet,
      },
      session: {
        get: vi.fn((_keys, callback) => callback({})),
        remove: vi.fn(),
        set: vi.fn(),
      },
    },
    notifications: { create: vi.fn() },
    tabs: { sendMessage: vi.fn(() => Promise.resolve()) },
  };
}

async function loadBackground({ cachedDefs = null, seed = {}, storageSet } = {}) {
  vi.resetModules();
  installChromeMock({ cachedDefs, storageSet });
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
      type: 'SET_GOAL',
      goal: { itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 200 },
    });

    vi.setSystemTime(1_000);
    sendServerUpdate({ me: { inventory: { ironOre: [0, 1] } } });

    vi.setSystemTime(61_000);
    const warmingStatus = __test.buildStatus();
    expect(warmingStatus.goalStatus.eta.rateBased).toBeFalsy();
    expect(warmingStatus.goalStatus.warmupRemainingMs).toBe(240_000);

    vi.setSystemTime(301_000);
    sendServerUpdate({ me: { inventory: { ironOre: [1, 5] } } });

    const status = __test.buildStatus();

    expect(status.etaDebugLogVersion).toBe(1);
    expect(status.goalStatus.count).toBe(5);
    expect(status.goalStatus.eta).toMatchObject({
      rateBased: true,
      sampleCount: 2,
      bankTrips: 7,
      bankOverheadMs: 350_000,
      totalMs: 14_975_000,
    });
    expect(status.goalStatus.warmupRemainingMs).toBe(0);
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
      type: 'SET_GOAL',
      goal: { itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 200 },
    });

    vi.setSystemTime(1_000);
    sendServerUpdate({ me: { inventory: { ironOre: [0, 1] } } });
    vi.setSystemTime(301_000);
    sendServerUpdate({ me: { inventory: { ironOre: [1, 5] } } });

    expect(__test.buildStatus().goalStatus).toMatchObject({
      warmupRemainingMs: 0,
      eta: {
        rateBased: true,
        sampleCount: 2,
      },
    });

    sendRuntimeMessage({
      type: 'SET_GOAL',
      goal: { itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 250 },
    });

    expect(__test.buildStatus().goalStatus).toMatchObject({
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
      type: 'SET_GOAL',
      goal: { itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 20 },
    });

    vi.setSystemTime(1_000);
    sendServerUpdate({
      me: {
        inventory: { ironOre: [0, 1] },
        lootBag: { ironOre: [1] },
      },
    });

    let status = __test.buildStatus();
    expect(status.goalStatus.count).toBe(1);

    vi.setSystemTime(301_000);
    sendServerUpdate({
      me: {
        inventory: { ironOre: [1, 5] },
        lootBag: { ironOre: [1, 5] },
      },
    });

    status = __test.buildStatus();
    expect(status.goalStatus.count).toBe(5);
    expect(status.goalStatus.eta.sampleCount).toBe(2);

    vi.setSystemTime(335_000);
    sendServerUpdate({
      me: {
        activity: [miningAct, { type: 'banking' }],
        lootBag: { ironOre: [5, 0] },
      },
    });

    status = __test.buildStatus();
    expect(status.goalStatus.count).toBe(5);

    vi.setSystemTime(360_000);
    sendServerUpdate({
      me: {
        activity: [{ type: 'banking' }, miningAct],
        inventory: { ironOre: [5, 6] },
        lootBag: { ironOre: [0, 1] },
      },
    });

    status = __test.buildStatus();
    expect(status.goalStatus.count).toBe(6);
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
      type: 'SET_GOAL',
      goal: { itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 200 },
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
    expect(status.goalStatus.count).toBe(2);  // live inventory+lootBag shown to user
    // hwm-based ETA: 190 cycles × 32000ms + 7 bank trips × 50000ms = 6,430,000ms
    // live-count ETA: 198 cycles × 32000ms + 7 bank trips × 50000ms = 6,686,000ms
    // Verify we're using hwm (190 remaining), not the inflated live count (198 remaining)
    expect(status.goalStatus.eta.totalMs).toBeLessThan(198 * 32_000 + 7 * 50_000); // < live-count ETA
    expect(status.goalStatus.eta.totalMs).toBeGreaterThan(185 * 32_000);            // clearly non-zero
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
      type: 'SET_GOAL',
      goal: { itemName: 'Iron Bar', itemId: 'ironBar', targetCount: 55 },
    });

    // Before banking: lootBag empty, 21 bars remaining.
    // generatedItems=21, freeSlotsBeforeFirstTrip=25 → 21≤25 → bankTrips=0
    const etaBefore = __test.buildStatus().goalStatus.eta;
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
    const etaDuring = __test.buildStatus().goalStatus.eta;
    expect(etaDuring.bankTrips).toBe(0);
    expect(etaDuring.totalMs).toBe(totalMsBefore);

    // Banking completes: loot bag cleared, back to smelting.
    sendServerUpdate({
      me: {
        activity: [{ type: 'banking' }, smeltAct],
        lootBag: { ironOre: [25, 0] },
      },
    });
    const etaAfter = __test.buildStatus().goalStatus.eta;
    expect(etaAfter.bankTrips).toBe(0);
    expect(etaAfter.totalMs).toBe(totalMsBefore);
  });

  it('keeps the goal during banking but clears it when the work activity changes', async () => {
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
      type: 'SET_GOAL',
      goal: { itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 20 },
    });

    sendServerUpdate({
      me: {
        activity: [miningAct, { type: 'banking' }],
      },
    });
    expect(__test.buildStatus().goalStatus.goal.itemId).toBe('ironOre');

    sendServerUpdate({
      me: {
        activity: [{ type: 'banking' }, smeltAct],
      },
    });
    expect(__test.buildStatus().goalStatus).toBeNull();
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ goal: null });
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
      type: 'SET_GOAL',
      goal: { itemName: 'Iron Ore', itemId: 'ironOre', targetCount: 200 },
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
    expect(status.goalStatus.eta.rateBased).toBeFalsy();
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
});

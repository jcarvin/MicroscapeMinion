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

describe('background activity definitions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
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
      etaMs: 3328000,
    });
  });
});

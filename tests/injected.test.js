import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadInjectedHooks() {
  vi.resetModules();
  const hooks = {};
  window.__MM_TEST_HOOKS__ = hooks;
  window.WebSocket = class {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    addEventListener() {}
    send() {}
  };
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('skip live fetch'))));
  await import('../src/injected.js');
  return hooks;
}

async function loadInjectedParser() {
  return (await loadInjectedHooks()).parseActivityDefs;
}

describe('injected activity definition parser', () => {
  afterEach(() => {
    delete window.__MM_TEST_HOOKS__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses piety activities where entity appears before exp and duration', async () => {
    const parseActivityDefs = await loadInjectedParser();
    const bundle = `
      {
        id: \`bury-bones\`,
        name: \`Bury Bones\`,
        entity: \`bones\`,
        exp: 4,
        duration: 2,
        level: 1,
        inventoryChanges: { bones: -1, spiritRune: 1, pet: 1/500 }
      }
    `;

    expect(parseActivityDefs(bundle)['bury-bones']).toEqual({
      durationMs: 16000,
      level: 1,
      xpPerCycle: 4,
      inventoryChanges: {
        bones: -1,
        spiritRune: 1,
      },
    });
  });

  it('does not replace a standard-format activity with a piety-format duplicate', async () => {
    const parseActivityDefs = await loadInjectedParser();
    const bundle = `
      { id: \`bury-bones\`, level: 1, exp: 99, duration: 9, entity: \`bones\`, inventoryChanges: { bones: -1 } }
      { id: \`bury-bones\`, entity: \`bones\`, exp: 4, duration: 2, level: 1, inventoryChanges: { bones: -1 } }
    `;

    expect(parseActivityDefs(bundle)['bury-bones']).toMatchObject({
      durationMs: 30000,
      level: 1,
      xpPerCycle: 99,
    });
  });

  it('parses an item as both a smithing output and a combat drop', async () => {
    const parseActivityDefs = await loadInjectedParser();
    const bundle = `
      {
        id: \`skeleton\`,
        name: \`skeleton\`,
        enemyType: \`creature\`,
        speed: 3,
        stats: { hp: 19 },
        drops: { bones: { quantity: 1, rarity: 0 }, ironArmor: { quantity: 1, rarity: 7 } }
      }
      { id: \`fight-skeleton\`, name: \`skeleton\`, mob: \`skeleton\`, level: 0 }
      {
        id: \`forge-iron-armor\`,
        name: \`iron armor\`,
        level: 23,
        exp: 211,
        duration: 30,
        entity: \`anvil\`,
        inventoryChanges: { ironBar: -5, ironArmor: 1 }
      }
    `;

    expect(parseActivityDefs(bundle)).toMatchObject({
      'fight-skeleton': {
        dropItems: { bones: 1, ironArmor: 1 },
      },
      'forge-iron-armor': {
        inventoryChanges: { ironBar: -5, ironArmor: 1 },
      },
    });
  });

  it('parses combat drops when extra fields separate mob and level', async () => {
    const parseActivityDefs = await loadInjectedParser();
    const bundle = `
      {
        id: \`bear\`,
        enemyType: \`creature\`,
        speed: 4,
        stats: { hp: 30 },
        drops: { rawSalmon: { quantity: 2, rarity: 5 } }
      }
      {
        id: \`fight-bear\`,
        name: \`Bear\`,
        difficulty: 3,
        mob: \`bear\`,
        isSafe: false,
        level: 12
      }
    `;

    expect(parseActivityDefs(bundle)['fight-bear']).toMatchObject({
      level: 12,
      mob: 'bear',
      dropItems: { rawSalmon: 2 },
    });
  });

  it('uses the item value property as the bundle tradeability signal', async () => {
    const { parseItemTradeability } = await loadInjectedHooks();
    const bundle = `
      { id: \`rawSalmon\`, name: \`raw salmon\`, category: \`resources\`, value: 4 }
      {
        id: \`petMapBog\`,
        name: \`Pet Map: Bog\`,
        category: \`pets\`,
        maxOwnable: 1,
        obsoleteIfOwning: \`petBog\`
      }
      {
        id: \`petMapNestedValue\`,
        name: \`Pet Map: Nested Value\`,
        category: \`pets\`,
        metadata: { value: 99 }
      }
      { id: \`not-an-item\`, name: \`Ability\`, type: \`static\`, value: 5 }
    `;

    expect(parseItemTradeability(bundle)).toEqual({
      rawSalmon: true,
      petMapBog: false,
      petMapNestedValue: false,
    });
  });
});

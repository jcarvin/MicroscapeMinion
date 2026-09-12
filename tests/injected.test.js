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

    expect(parseActivityDefs(bundle)['bury-bones']).toMatchObject({
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

  it('captures entity field in standard activity definitions', async () => {
    const parseActivityDefs = await loadInjectedParser();
    const bundle = `
      {
        id: \`cook-shrimp\`,
        level: 1,
        exp: 30,
        duration: 3,
        entity: \`fire\`,
        inventoryChanges: { rawShrimp: -1, shrimpMeat: 1 }
      }
    `;
    expect(parseActivityDefs(bundle)['cook-shrimp']).toMatchObject({ entity: 'fire' });
  });

  it('captures entity field in piety-order activity definitions', async () => {
    const parseActivityDefs = await loadInjectedParser();
    const bundle = `
      {
        id: \`bury-bones\`,
        entity: \`bones\`,
        exp: 4,
        duration: 2,
        level: 1,
        inventoryChanges: { bones: -1, spiritRune: 1 }
      }
    `;
    expect(parseActivityDefs(bundle)['bury-bones']).toMatchObject({ entity: 'bones' });
  });

  it('captures drop rarity on fight activity defs', async () => {
    const parseActivityDefs = await loadInjectedParser();
    const bundle = `
      {
        id: \`giant-rat\`,
        enemyType: \`creature\`,
        speed: 3,
        stats: { hp: 10, attack: 5, strength: 5, defense: 3 },
        drops: { bones: { quantity: 1, rarity: 1 }, rawMeat: { quantity: 1, rarity: 2 } }
      }
      { id: \`fight-giant-rat\`, name: \`giant rat\`, mob: \`giant-rat\`, level: 1 }
    `;
    const def = parseActivityDefs(bundle)['fight-giant-rat'];
    expect(def.dropItems).toEqual({ bones: 1, rawMeat: 1 });
    expect(def.dropRarity).toEqual({ bones: 1, rawMeat: 2 });
  });

  it('captures mob stats and computes mobCombatLevel on fight defs', async () => {
    const parseActivityDefs = await loadInjectedParser();
    const bundle = `
      {
        id: \`troll\`,
        enemyType: \`creature\`,
        speed: 5,
        stats: { hp: 50, attack: 10, strength: 8, defense: 6 },
        drops: { bones: { quantity: 1, rarity: 0 } }
      }
      { id: \`fight-troll\`, name: \`troll\`, mob: \`troll\`, level: 20 }
    `;
    const def = parseActivityDefs(bundle)['fight-troll'];
    // mobCombatLevel = max(1, floor(((10+8)/2 + 6) / 2)) = floor((9+6)/2) = floor(7.5) = 7
    expect(def.mobCombatLevel).toBe(7);
    expect(def.name).toBe('troll');
  });

  it('captures mobMinimumCombatLevel on fight defs', async () => {
    const parseActivityDefs = await loadInjectedParser();
    const bundle = `
      {
        id: \`demon\`,
        enemyType: \`creature\`,
        speed: 5,
        minimumCombatLevel: 40,
        stats: { hp: 100, attack: 30, strength: 30, defense: 20 },
        drops: { bones: { quantity: 1, rarity: 0 } }
      }
      { id: \`fight-demon\`, name: \`demon\`, mob: \`demon\`, level: 60 }
    `;
    const def = parseActivityDefs(bundle)['fight-demon'];
    expect(def.mobMinimumCombatLevel).toBe(40);
  });

  it('captures mobSafeSpot on fight defs', async () => {
    const parseActivityDefs = await loadInjectedParser();
    const bundle = `
      {
        id: \`croc-safe\`,
        enemyType: \`creature\`,
        speed: 4,
        safeSpot:!0,
        stats: { hp: 40, attack: 12, strength: 12, defense: 8 },
        drops: { bones: { quantity: 1, rarity: 1 } }
      }
      { id: \`fight-croc-safe\`, name: \`crocodile\`, mob: \`croc-safe\`, level: 30 }
    `;
    const def = parseActivityDefs(bundle)['fight-croc-safe'];
    expect(def.mobSafeSpot).toBe(true);
  });
});

describe('parseCombatSkills', () => {
  afterEach(() => {
    delete window.__MM_TEST_HOOKS__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses skills with isCombatSkill:!0 (minified form)', async () => {
    const { parseCombatSkills } = await loadInjectedHooks();
    const bundle = `
      { id: \`attack\`, name: \`Attack\`, isCombatSkill:!0, activities: dh }
      { id: \`strength\`, name: \`Strength\`, isCombatSkill:!0, activities: dh }
      { id: \`cooking\`, name: \`Cooking\`, activities: [\`cook-shrimp\`] }
    `;
    const skills = parseCombatSkills(bundle);
    expect(skills.map(s => s.id)).toContain('attack');
    expect(skills.map(s => s.id)).toContain('strength');
    expect(skills.map(s => s.id)).not.toContain('cooking');
  });

  it('captures skill name from the def', async () => {
    const { parseCombatSkills } = await loadInjectedHooks();
    const bundle = `{ id: \`evilMagic\`, name: \`Evil Magic\`, isCombatSkill:!0, activities: dh }`;
    const skills = parseCombatSkills(bundle);
    expect(skills[0]).toEqual({ id: 'evilMagic', name: 'Evil Magic' });
  });

  it('does not duplicate skills appearing multiple times', async () => {
    const { parseCombatSkills } = await loadInjectedHooks();
    const bundle = `
      { id: \`attack\`, name: \`Attack\`, isCombatSkill:!0, activities: dh }
      { id: \`attack\`, name: \`Attack\`, isCombatSkill:!0, activities: dh }
    `;
    const skills = parseCombatSkills(bundle);
    expect(skills.filter(s => s.id === 'attack')).toHaveLength(1);
  });
});

describe('parseDropItems', () => {
  afterEach(() => {
    delete window.__MM_TEST_HOOKS__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns rich {quantity, rarity} objects', async () => {
    const { parseDropItems } = await loadInjectedHooks();
    const body = `bones: { quantity: 1, rarity: 0 }, ironArmor: { quantity: 1, rarity: 7 }`;
    expect(parseDropItems(body)).toEqual({
      bones: { quantity: 1, rarity: 0 },
      ironArmor: { quantity: 1, rarity: 7 },
    });
  });
});

describe('injected zone definition parser', () => {
  afterEach(() => {
    delete window.__MM_TEST_HOOKS__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Synthetic fixture designed to exercise structural variation:
  //   - unquoted key (havendell) and quoted key ("manor-kitchen")
  //   - zone with width/height before name (havendell)
  //   - entity shared across two zones (fire in both)
  //   - zone with no entities (storageHut)
  //   - zone that is a dungeon (dragonDen)
  //   - zone with a required item (lockedVault)
  //   - invented entity/zone that doesn't exist in the real game
  const SYNTHETIC_MAP = `{
    havendell:{ width:20, height:15, name:\`Havendell\`, mapPos:[3,2], entities:[\`fire\`,\`anvil\`] },
    "manor-kitchen":{ name:\`Manor Kitchen\`, mapPos:[8,4], entities:[\`fire\`,\`range\`] },
    storageHut:{ name:\`Storage Hut\`, mapPos:[5,5], entities:[] },
    dragonDen:{ name:\`Dragon Den\`, mapPos:[10,10], entities:[\`lair\`], isDungeon:true },
    lockedVault:{ name:\`Locked Vault\`, mapPos:[2,1], entities:[\`vault\`], requiredItem:\`goldKey\` },
    inventedZone:{ name:\`Invented Zone\`, mapPos:[99,99], entities:[\`inventedEntity\`] }
  }`;

  // Same zones as SYNTHETIC_MAP but with the real game format:
  // entities is an object keyed by entityId, with quoted keys where needed.
  const SYNTHETIC_MAP_OBJ_ENTITIES = `{
    havendell:{ width:20, height:15, name:\`Havendell\`, mapPos:[3,2], idleSpots:[[1,1]], entities:{fire:{positions:[[2,2]]},anvil:{positions:[[3,3]]}} },
    "manor-kitchen":{ name:\`Manor Kitchen\`, mapPos:[8,4], entities:{fire:{positions:[[1,1]]},range:{positions:[[2,2]]}} },
    storageHut:{ name:\`Storage Hut\`, mapPos:[5,5], entities:{} },
    dragonDen:{ name:\`Dragon Den\`, mapPos:[10,10], entities:{lair:{positions:[[1,1]]}}, isDungeon:true },
    lockedVault:{ name:\`Locked Vault\`, mapPos:[2,1], entities:{vault:{positions:[[1,1]]}}, requiredItem:\`goldKey\` },
    inventedZone:{ name:\`Invented Zone\`, mapPos:[99,99], entities:{inventedEntity:{positions:[[1,1]]}} }
  }`;

  async function loadZoneHooks() {
    const hooks = await loadInjectedHooks();
    return hooks;
  }

  it('finds the map definition object via mapPos anchor', async () => {
    const { findMapDefinitionObject } = await loadZoneHooks();
    const bundle = `const mapData = ${SYNTHETIC_MAP};`;
    const result = findMapDefinitionObject(bundle);
    expect(result).not.toBeNull();
    expect(result).toContain('havendell');
    expect(result).toContain('manor-kitchen');
  });

  it('returns null when no mapPos is present', async () => {
    const { findMapDefinitionObject } = await loadZoneHooks();
    expect(findMapDefinitionObject('const x = { foo: 1 };')).toBeNull();
  });

  it('skips earlier entities:[ in non-zone objects and finds the real zone map', async () => {
    const { findMapDefinitionObject } = await loadZoneHooks();
    // Simulates a bundle where monster defs appear before zone defs and also
    // have an `entities:` array — the old anchor would find the wrong object.
    const bundleWithEarlyEntities = `
      const monsters = { rat: { name:\`Rat\`, entities:[\`spawn-point\`] } };
      const mapData = ${SYNTHETIC_MAP};
    `;
    const result = findMapDefinitionObject(bundleWithEarlyEntities);
    expect(result).not.toBeNull();
    expect(result).toContain('havendell');
    expect(result).toContain('manor-kitchen');
    // Monster def must not have been returned
    expect(result).not.toContain('spawn-point');
  });

  it('reads both unquoted and quoted top-level keys', async () => {
    const { readTopLevelObjectKeys } = await loadZoneHooks();
    const src = `{ havendell: 1, "manor-kitchen": 2, storageHut: 3 }`;
    const keys = readTopLevelObjectKeys(src).map(e => e.key);
    expect(keys).toContain('havendell');
    expect(keys).toContain('manor-kitchen');
    expect(keys).toContain('storageHut');
  });

  it('parses all zones including the unquoted-key zone and width-first zone', async () => {
    const { parseZoneDefinitions } = await loadZoneHooks();
    const bundle = `const mapData = ${SYNTHETIC_MAP};`;
    const result = parseZoneDefinitions(bundle);
    expect(result).not.toBeNull();
    expect(result['havendell']).toMatchObject({ name: 'Havendell', mapPos: [3, 2] });
    expect(result['manor-kitchen']).toMatchObject({ name: 'Manor Kitchen', mapPos: [8, 4] });
  });

  it('includes the invented entity that exists nowhere in the real game', async () => {
    const { parseZoneDefinitions } = await loadZoneHooks();
    const bundle = `const mapData = ${SYNTHETIC_MAP};`;
    const result = parseZoneDefinitions(bundle);
    expect(result['inventedZone']).toMatchObject({ entities: ['inventedEntity'] });
  });

  it('reports fire as present in both zones that host it', async () => {
    const { parseZoneDefinitions } = await loadZoneHooks();
    const bundle = `const mapData = ${SYNTHETIC_MAP};`;
    const result = parseZoneDefinitions(bundle);
    const fireZones = Object.entries(result)
      .filter(([, def]) => def.entities.includes('fire'))
      .map(([id]) => id);
    expect(fireZones).toContain('havendell');
    expect(fireZones).toContain('manor-kitchen');
  });

  it('marks dungeon zones as isDungeon and required-item zones correctly', async () => {
    const { parseZoneDefinitions } = await loadZoneHooks();
    const bundle = `const mapData = ${SYNTHETIC_MAP};`;
    const result = parseZoneDefinitions(bundle);
    expect(result['dragonDen'].isDungeon).toBe(true);
    expect(result['lockedVault'].requiredItem).toBe('goldKey');
    expect(result['havendell'].isDungeon).toBe(false);
  });

  it('tolerates a zone with no entities', async () => {
    const { parseZoneDefinitions } = await loadZoneHooks();
    const bundle = `const mapData = ${SYNTHETIC_MAP};`;
    const result = parseZoneDefinitions(bundle);
    expect(result['storageHut'].entities).toEqual([]);
  });

  it('parses entity ids from object-format entities (real game format)', async () => {
    const { parseZoneDefinitions } = await loadZoneHooks();
    const bundle = `const mapData = ${SYNTHETIC_MAP_OBJ_ENTITIES};`;
    const result = parseZoneDefinitions(bundle);
    expect(result['havendell'].entities).toContain('fire');
    expect(result['havendell'].entities).toContain('anvil');
    expect(result['manor-kitchen'].entities).toContain('fire');
    expect(result['manor-kitchen'].entities).toContain('range');
    expect(result['storageHut'].entities).toEqual([]);
    expect(result['dragonDen'].isDungeon).toBe(true);
    expect(result['lockedVault'].requiredItem).toBe('goldKey');
    expect(result['inventedZone'].entities).toContain('inventedEntity');
  });

  it('reports fire in both zones when using object-format entities', async () => {
    const { parseZoneDefinitions } = await loadZoneHooks();
    const bundle = `const mapData = ${SYNTHETIC_MAP_OBJ_ENTITIES};`;
    const result = parseZoneDefinitions(bundle);
    const fireZones = Object.entries(result)
      .filter(([, def]) => def.entities.includes('fire'))
      .map(([id]) => id);
    expect(fireZones).toContain('havendell');
    expect(fireZones).toContain('manor-kitchen');
  });
});

describe('injected skill activity index parser', () => {
  afterEach(() => {
    delete window.__MM_TEST_HOOKS__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps activities to their skill from skill definition objects', async () => {
    const { parseSkillActivityIndex } = await loadInjectedHooks();
    const bundle = `
      { id: \`cooking\`, displayName: \`Cooking\`, activities: [\`cook-bread\`, \`cook-shrimp\`] }
      { id: \`smithing\`, displayName: \`Smithing\`, activities: [\`smelt-iron\`, \`forge-iron-sword\`] }
    `;
    const result = parseSkillActivityIndex(bundle);
    expect(result['cook-bread']).toBe('cooking');
    expect(result['cook-shrimp']).toBe('cooking');
    expect(result['smelt-iron']).toBe('smithing');
  });

  it('handles an invented skill and activity that exist nowhere in the real game', async () => {
    const { parseSkillActivityIndex } = await loadInjectedHooks();
    const bundle = `
      { id: \`inventedSkill\`, displayName: \`Invented\`, activities: [\`invented-activity-a\`, \`invented-activity-b\`] }
    `;
    const result = parseSkillActivityIndex(bundle);
    expect(result['invented-activity-a']).toBe('inventedSkill');
    expect(result['invented-activity-b']).toBe('inventedSkill');
  });
});

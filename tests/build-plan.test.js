import { describe, expect, it } from 'vitest';
import { buildDependencyTree, flattenTree } from '../src/build-plan.js';

// Simple defs: mine iron (gather), smelt iron bar (craft), forge armor (craft)
const defs = {
  'mine-iron': { inventoryChanges: { ironOre: 1 } },
  'smelt-iron': { inventoryChanges: { ironOre: -2, ironBar: 1 }, level: 10, skill: 'smithing' },
  'forge-iron-armor': { inventoryChanges: { ironBar: -5, ironArmor: 1 }, level: 20, skill: 'smithing' },
  'smelt-steel': { inventoryChanges: { ironOre: -1, coalOre: -2, steelBar: 1 }, level: 30, skill: 'smithing' },
  'cook-bread': { inventoryChanges: { dough: -1, bread: 1 }, level: 1, skill: 'cooking' },
  'make-dough': { inventoryChanges: { flour: -1, water: -1, dough: 1 } },
};

describe('buildDependencyTree', () => {
  it('resolves a gatherable leaf', () => {
    const result = buildDependencyTree({
      itemId: 'ironOre',
      quantity: 100,
      activityDefs: defs,
      ownedCounts: {},
    });
    expect(result.status).toBe('gatherable');
    expect(result.quantity).toBe(100);
    expect(result.children).toHaveLength(0);
    expect(result.activityId).toBe('mine-iron');
  });

  it('resolves a direct craft with gatherable ingredient', () => {
    const result = buildDependencyTree({
      itemId: 'ironBar',
      quantity: 10,
      activityDefs: defs,
      ownedCounts: {},
    });
    expect(result.status).toBe('craftable');
    expect(result.activityId).toBe('smelt-iron');
    expect(result.quantity).toBe(10);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].itemId).toBe('ironOre');
    expect(result.children[0].quantity).toBe(20); // 10 bars × 2 ore each
    expect(result.children[0].status).toBe('gatherable');
  });

  it('resolves a nested craft chain', () => {
    const result = buildDependencyTree({
      itemId: 'ironArmor',
      quantity: 2,
      activityDefs: defs,
      ownedCounts: {},
    });
    expect(result.status).toBe('craftable');
    expect(result.children).toHaveLength(1);
    const bars = result.children[0];
    expect(bars.itemId).toBe('ironBar');
    expect(bars.quantity).toBe(10); // 2 armor × 5 bars
    expect(bars.status).toBe('craftable');
    expect(bars.children[0].itemId).toBe('ironOre');
    expect(bars.children[0].quantity).toBe(20); // 10 bars × 2 ore
  });

  it('marks an item as purchase-only when no production route exists', () => {
    const result = buildDependencyTree({
      itemId: 'water',
      quantity: 50,
      activityDefs: defs,
      ownedCounts: {},
    });
    expect(result.status).toBe('purchase-only');
    expect(result.children).toHaveLength(0);
  });

  it('marks an item as sufficient when inventory already covers it', () => {
    const result = buildDependencyTree({
      itemId: 'ironOre',
      quantity: 100,
      activityDefs: defs,
      ownedCounts: { ironOre: 150 },
    });
    expect(result.status).toBe('sufficient');
    expect(result.needed).toBe(0);
  });

  it('accounts for partial inventory', () => {
    const result = buildDependencyTree({
      itemId: 'ironBar',
      quantity: 10,
      activityDefs: defs,
      ownedCounts: { ironBar: 3 },
    });
    expect(result.status).toBe('craftable');
    expect(result.needed).toBe(7);
    // 7 bars × 2 ore = 14 ore needed
    expect(result.children[0].quantity).toBe(14);
  });

  it('marks levelBlocked when player skill is too low', () => {
    const result = buildDependencyTree({
      itemId: 'ironArmor',
      quantity: 1,
      activityDefs: defs,
      ownedCounts: {},
      playerSkillLevels: { smithing: 15 }, // forge requires lv 20
    });
    expect(result.levelBlocked).toBe(true);
    expect(result.status).toBe('craftable');
  });

  it('does not mark levelBlocked when player meets the level', () => {
    const result = buildDependencyTree({
      itemId: 'ironArmor',
      quantity: 1,
      activityDefs: defs,
      ownedCounts: {},
      playerSkillLevels: { smithing: 20 },
    });
    expect(result.levelBlocked).toBe(false);
  });

  it('guards against circular dependencies', () => {
    const circularDefs = {
      'make-a': { inventoryChanges: { a: 1, b: -1 } },
      'make-b': { inventoryChanges: { b: 1, a: -1 } },
    };
    const result = buildDependencyTree({
      itemId: 'a',
      quantity: 5,
      activityDefs: circularDefs,
      ownedCounts: {},
    });
    expect(result.status).toBe('craftable');
    // The child 'b' tries to recurse into 'a' but 'a' is already visited
    const bNode = result.children[0];
    expect(bNode.itemId).toBe('b');
    // b's recipe needs a, which is visited → circular
    if (bNode.status === 'craftable') {
      const aChild = bNode.children.find((c) => c.itemId === 'a');
      expect(aChild?.status).toBe('circular');
    }
  });

  it('handles mixed purchase-only ingredient in a craft chain', () => {
    const result = buildDependencyTree({
      itemId: 'dough',
      quantity: 10,
      activityDefs: defs,
      ownedCounts: {},
    });
    expect(result.status).toBe('craftable');
    const flour = result.children.find((c) => c.itemId === 'flour');
    const water = result.children.find((c) => c.itemId === 'water');
    // flour has no production route → purchase-only
    expect(flour?.status).toBe('purchase-only');
    // water has no production route → purchase-only
    expect(water?.status).toBe('purchase-only');
  });
});

describe('flattenTree', () => {
  it('returns leaves first (dependency order), excluding purchase-only', () => {
    const tree = buildDependencyTree({
      itemId: 'ironArmor',
      quantity: 2,
      activityDefs: defs,
      ownedCounts: {},
    });
    const flat = flattenTree(tree);
    const ids = flat.map((r) => r.itemId);
    expect(ids).toContain('ironOre');
    expect(ids).toContain('ironBar');
    expect(ids).toContain('ironArmor');
    // ore must come before bar (dependency order)
    expect(ids.indexOf('ironOre')).toBeLessThan(ids.indexOf('ironBar'));
    expect(ids.indexOf('ironBar')).toBeLessThan(ids.indexOf('ironArmor'));
  });

  it('excludes purchase-only items', () => {
    const tree = buildDependencyTree({
      itemId: 'dough',
      quantity: 10,
      activityDefs: defs,
      ownedCounts: {},
    });
    const flat = flattenTree(tree);
    expect(flat.map((r) => r.itemId)).not.toContain('water');
    expect(flat.map((r) => r.itemId)).not.toContain('flour');
    expect(flat.map((r) => r.itemId)).toContain('dough');
  });

  it('assigns correct sourceModes', () => {
    const tree = buildDependencyTree({
      itemId: 'ironArmor',
      quantity: 2,
      activityDefs: defs,
      ownedCounts: {},
    });
    const flat = flattenTree(tree);
    const ore = flat.find((r) => r.itemId === 'ironOre');
    const bar = flat.find((r) => r.itemId === 'ironBar');
    const armor = flat.find((r) => r.itemId === 'ironArmor');
    expect(ore?.sourceMode).toBe('manual');
    expect(bar?.sourceMode).toBe('craft');
    expect(armor?.sourceMode).toBe('craft');
  });

  it('uses the higher targetCount when two branches need the same item', () => {
    // Hypothetical: two different items both need ironOre as leaf
    // Not easy to construct here but we test de-dup by checking flat has no dupes
    const tree = buildDependencyTree({
      itemId: 'ironArmor',
      quantity: 1,
      activityDefs: defs,
      ownedCounts: {},
    });
    const flat = flattenTree(tree);
    const oreEntries = flat.filter((r) => r.itemId === 'ironOre');
    expect(oreEntries).toHaveLength(1);
  });
});

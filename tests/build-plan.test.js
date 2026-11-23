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

// Fixture mirroring the real bread / pottery recipe chain.
// process-bread-dough and shape-pot both return containers (pot, bucket) as
// byproducts — these must NOT satisfy upstream inputs for the same chain.
const breadDefs = {
  'gather-wheat':       { inventoryChanges: { grain: 1 } },
  'process-flour':      { inventoryChanges: { grain: -1, pot: -1, flourPot: 1 } },
  'gather-water-10':    { inventoryChanges: { bucket: -10, waterBucket: 10 } },
  'process-bread-dough':{ inventoryChanges: { flourPot: -1, waterBucket: -1, dough: 1, pot: 1, bucket: 1 } },
  'cook-bread':         { inventoryChanges: { dough: -1, bread: 1 }, level: 1, skill: 'cooking' },
  'gather-clay':        { inventoryChanges: { clay: 1 } },
  'shape-pot':          { inventoryChanges: { clay: -1, waterBucket: -1, unfiredPot: 1, bucket: 1 } },
  'fire-pot':           { inventoryChanges: { unfiredPot: -1, pot: 1 } },
  // Container-return activity that should be rejected for bucket (needs waterBucket, circular)
  'adapt-heat-gloves':  { inventoryChanges: { dwarvenGloves: -1, waterBucket: -1, heatGloves: 1, bucket: 1 }, level: 1 },
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
    // The child 'b' tries to recurse into 'a' but 'a' is already visited.
    // With backtracking, make-b is rejected and 'b' falls through to purchase-only.
    const bNode = result.children[0];
    expect(bNode.itemId).toBe('b');
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

  // ── Bread / pottery regression tests ────────────────────────────────────────

  it('RC1: byproducts from process-bread-dough do not satisfy upstream pot demand', () => {
    // process-bread-dough returns pot and bucket as byproducts.  Those pots only
    // exist *after* dough is made — crediting them before the flour-pot step runs
    // was the original bug (RC1).
    const result = buildDependencyTree({
      itemId: 'bread',
      quantity: 454,
      activityDefs: breadDefs,
      ownedCounts: { grain: 109, pot: 155, waterBucket: 84 },
    });
    expect(result.status).toBe('craftable');

    const doughNode = result.children.find((c) => c.itemId === 'dough');
    expect(doughNode?.status).toBe('craftable');

    const flourPotNode = doughNode?.children.find((c) => c.itemId === 'flourPot');
    expect(flourPotNode?.status).toBe('craftable');

    const potNode = flourPotNode?.children.find((c) => c.itemId === 'pot');
    expect(potNode?.status).toBe('craftable');
    expect(potNode?.owned).toBe(155);
    expect(potNode?.needed).toBe(299);
  });

  it('RC1+full-depth: pot chain descends to unfiredPot → clay + waterBucket', () => {
    const result = buildDependencyTree({
      itemId: 'bread',
      quantity: 454,
      activityDefs: breadDefs,
      ownedCounts: { grain: 109, pot: 155, waterBucket: 84 },
    });
    const doughNode = result.children.find((c) => c.itemId === 'dough');
    const flourPotNode = doughNode?.children.find((c) => c.itemId === 'flourPot');
    const potNode = flourPotNode?.children.find((c) => c.itemId === 'pot');
    const unfiredPotNode = potNode?.children.find((c) => c.itemId === 'unfiredPot');
    expect(unfiredPotNode?.status).toBe('craftable');

    const clayNode = unfiredPotNode?.children.find((c) => c.itemId === 'clay');
    expect(clayNode?.status).toBe('gatherable');

    const wbNode = unfiredPotNode?.children.find((c) => c.itemId === 'waterBucket');
    expect(wbNode?.status).toBe('craftable'); // gather-water-10
  });

  it('RC2: bucket resolves purchase-only, not craftable via container-return activities', () => {
    // All activities that output bucket (shape-pot, process-bread-dough,
    // adapt-heat-gloves) also consume waterBucket, which is an ancestor on
    // any path that reaches bucket.  Backtracking must reject all of them.
    const result = buildDependencyTree({
      itemId: 'bread',
      quantity: 454,
      activityDefs: breadDefs,
      ownedCounts: { grain: 109, pot: 155, waterBucket: 84 },
    });
    function findNode(node, id) {
      if (node.itemId === id) return node;
      for (const c of node.children) { const f = findNode(c, id); if (f) return f; }
      return null;
    }
    const bucketNode = findNode(result, 'bucket');
    expect(bucketNode).not.toBeNull();
    expect(bucketNode.status).toBe('purchase-only');
  });

  it('RC3: live shape-pot beats seed-only craft-pot-unfired when liveActivityIds is provided', () => {
    const defsWithSeed = {
      ...breadDefs,
      // Seed-only phantom recipe using a non-existent input
      'craft-pot-unfired': { inventoryChanges: { softClay: -1, unfiredPot: 1 } },
    };
    const liveIds = new Set(Object.keys(breadDefs)); // shape-pot is live; craft-pot-unfired is not

    const withLive = buildDependencyTree({
      itemId: 'unfiredPot',
      quantity: 10,
      activityDefs: defsWithSeed,
      ownedCounts: {},
      liveActivityIds: liveIds,
    });
    expect(withLive.activityId).toBe('shape-pot');

    // Without liveActivityIds: craft-pot-unfired wins (maxCraftable prefix)
    const withoutLive = buildDependencyTree({
      itemId: 'unfiredPot',
      quantity: 10,
      activityDefs: defsWithSeed,
      ownedCounts: {},
    });
    expect(withoutLive.activityId).toBe('craft-pot-unfired');
  });

  it('bucket pool: no bucket purchase when player has enough total containers', () => {
    // Player has 416 buckets + 84 waterBuckets = 500 total containers.
    // shape-pot credits +bucket byproducts after its inputs resolve, making those
    // buckets available for the second gather-water step (dough chain).
    // Neither gather-water step should require buying new buckets.
    const result = buildDependencyTree({
      itemId: 'bread',
      quantity: 454,
      activityDefs: breadDefs,
      ownedCounts: { grain: 109, pot: 155, bucket: 416, waterBucket: 84 },
    });
    function findNode(node, id, all = []) {
      if (node.itemId === id) all.push(node);
      for (const c of node.children) findNode(c, id, all);
      return all;
    }
    // bucket must not appear as purchase-only anywhere (no new buckets need to be bought)
    const bucketNodes = findNode(result, 'bucket');
    expect(bucketNodes.length).toBeGreaterThan(0);
    expect(bucketNodes.every((n) => n.status !== 'purchase-only')).toBe(true);
    // Both waterBucket steps must be present and craftable (plan shows two gather steps)
    const wbNodes = findNode(result, 'waterBucket');
    const wbCraftable = wbNodes.filter((n) => n.status === 'craftable');
    expect(wbCraftable.length).toBe(2);
  });

  it('bucket pool: shows purchase-only bucket when total pool is insufficient', () => {
    // Player has only 50 total bucket containers — not enough for the 299-step.
    const result = buildDependencyTree({
      itemId: 'bread',
      quantity: 454,
      activityDefs: breadDefs,
      ownedCounts: { grain: 109, pot: 155, bucket: 30, waterBucket: 20 },
    });
    function findNode(node, id, all = []) {
      if (node.itemId === id) all.push(node);
      for (const c of node.children) findNode(c, id, all);
      return all;
    }
    // bucket should still appear as purchase-only since 50 < 299
    const bucketNodes = findNode(result, 'bucket');
    expect(bucketNodes.some((n) => n.status === 'purchase-only')).toBe(true);
  });

  it('RC4: owned stock is debited so two sibling branches do not both claim the same units', () => {
    // Both grain and pot are needed for flourPot.  With 100 of each, one branch
    // should be sufficient and the other partially-needed.
    const simpleDefs = {
      'process-flour': { inventoryChanges: { grain: -1, pot: -1, flourPot: 1 } },
      'gather-wheat':  { inventoryChanges: { grain: 1 } },
      'fire-pot':      { inventoryChanges: { unfiredPot: -1, pot: 1 } },
      'gather-clay':   { inventoryChanges: { unfiredPot: 1 } }, // simplified gatherable
    };
    // Need 100 flourPot; own 100 grain and 100 pot → both should be sufficient
    const allSufficient = buildDependencyTree({
      itemId: 'flourPot',
      quantity: 100,
      activityDefs: simpleDefs,
      ownedCounts: { grain: 100, pot: 100 },
    });
    const grainFull = allSufficient.children?.find((c) => c.itemId === 'grain');
    const potFull = allSufficient.children?.find((c) => c.itemId === 'pot');
    expect(grainFull?.status).toBe('sufficient');
    expect(potFull?.status).toBe('sufficient');

    // Need 120 flourPot; own 100 grain → grain partially-needed (20 more), pot all-needed
    const partial = buildDependencyTree({
      itemId: 'flourPot',
      quantity: 120,
      activityDefs: simpleDefs,
      ownedCounts: { grain: 100, pot: 100 },
    });
    const grainPartial = partial.children?.find((c) => c.itemId === 'grain');
    const potPartial = partial.children?.find((c) => c.itemId === 'pot');
    expect(grainPartial?.owned).toBe(100);
    expect(grainPartial?.needed).toBe(20);
    expect(potPartial?.owned).toBe(100);
    expect(potPartial?.needed).toBe(20);
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

  it('single-path chains produce one entry per item', () => {
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

  it('emits the same item twice when it appears at non-adjacent positions', () => {
    // bread chain: waterBucket is needed for shape-pot AND for process-bread-dough.
    // Those occurrences are separated by several steps, so both must be emitted.
    const tree = buildDependencyTree({
      itemId: 'bread',
      quantity: 454,
      activityDefs: breadDefs,
      ownedCounts: { grain: 109, pot: 155, waterBucket: 84 },
    });
    const flat = flattenTree(tree);
    const wbEntries = flat.filter((r) => r.itemId === 'waterBucket');
    expect(wbEntries).toHaveLength(2);
    // First occurrence (for unfiredPot/shape-pot) must come before second (for dough)
    const wbIdx = flat.map((r) => r.itemId).indexOf('waterBucket');
    const wbLastIdx = flat.map((r) => r.itemId).lastIndexOf('waterBucket');
    expect(wbIdx).toBeLessThan(wbLastIdx);
    // Quantities match the plan's expected values
    expect(wbEntries[0].targetCount).toBe(299);
    expect(wbEntries[1].targetCount).toBe(454);
  });

  it('dependency order: breadcrumb chain is clay → waterBucket → unfiredPot → pot → grain → flourPot → waterBucket → dough → bread', () => {
    const tree = buildDependencyTree({
      itemId: 'bread',
      quantity: 454,
      activityDefs: breadDefs,
      ownedCounts: { grain: 109, pot: 155, waterBucket: 84 },
    });
    const flat = flattenTree(tree);
    const ids = flat.map((r) => r.itemId);

    function idx(id) { return ids.indexOf(id); }

    expect(idx('clay')).toBeLessThan(idx('unfiredPot'));
    expect(idx('unfiredPot')).toBeLessThan(idx('pot'));
    expect(idx('pot')).toBeLessThan(idx('flourPot'));
    expect(idx('flourPot')).toBeLessThan(idx('dough'));
    expect(idx('dough')).toBeLessThan(idx('bread'));
    // Both waterBucket entries come before bread
    expect(ids.lastIndexOf('waterBucket')).toBeLessThan(idx('bread'));
  });
});

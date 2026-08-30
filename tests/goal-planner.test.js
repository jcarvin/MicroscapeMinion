import { describe, expect, it } from 'vitest';
import {
  buildOwnedCounts,
  getCraftableItemIds,
  getManualInputActivityItemIds,
  inferObservedActivityXp,
  planGoals,
} from '../src/goal-planner.js';
import activityDefs from '../src/activity-defs.json';
import { computeMicroscapeXpTable } from '../src/xp.js';

const defs = {
  'mine-iron': { inventoryChanges: { ironOre: 1 } },
  'smelt-iron': { inventoryChanges: { ironOre: -2, ironBar: 1 } },
  'forge-iron-armor': { inventoryChanges: { ironBar: -5, ironArmor: 1 } },
  'smelt-steel': { inventoryChanges: { ironOre: -1, coalOre: -2, steelBar: 1 } },
};

function goal(id, itemId, targetCount, maxCraftable = false) {
  return {
    id,
    itemId,
    itemName: itemId,
    targetCount,
    ...(maxCraftable ? { maxCraftable: true } : {}),
  };
}

describe('goal planner', () => {
  it('plans the iron ore to bar to armor chain in row order', () => {
    const result = planGoals({
      goals: [
        goal('ore', 'ironOre', 1000),
        goal('bars', 'ironBar', 0, true),
        goal('armor', 'ironArmor', 0, true),
      ],
      activityDefs: defs,
      ownedCounts: {},
    });

    expect(result.goals.map(({ targetCount }) => targetCount)).toEqual([1000, 500, 100]);
    expect(result.ledger).toMatchObject({ ironOre: 0, ironBar: 0, ironArmor: 100 });
  });

  it('includes owned output in the absolute Max target', () => {
    const result = planGoals({
      goals: [goal('bars', 'ironBar', 0, true)],
      activityDefs: defs,
      ownedCounts: { ironOre: 20, ironBar: 10 },
    });

    expect(result.goals[0].targetCount).toBe(20);
  });

  it('uses the lowest multi-input capacity and reports tied bottlenecks', () => {
    const limited = planGoals({
      goals: [goal('steel', 'steelBar', 0, true)],
      activityDefs: defs,
      ownedCounts: { ironOre: 10, coalOre: 12 },
    });
    const tied = planGoals({
      goals: [goal('steel', 'steelBar', 0, true)],
      activityDefs: defs,
      ownedCounts: { ironOre: 6, coalOre: 12 },
    });

    expect(limited.goals[0].targetCount).toBe(6);
    expect(limited.plans[0].limitingItemIds).toEqual(['coalOre']);
    expect(tied.plans[0].limitingItemIds).toEqual(['ironOre', 'coalOre']);
  });

  it('does not count a shared input twice across later rows', () => {
    const result = planGoals({
      goals: [
        goal('bars', 'ironBar', 0, true),
        goal('steel', 'steelBar', 0, true),
      ],
      activityDefs: defs,
      ownedCounts: { ironOre: 20, coalOre: 100 },
    });

    expect(result.goals.map(({ targetCount }) => targetCount)).toEqual([10, 0]);
    expect(result.plans[1]).toMatchObject({ feasible: false, limitingItemIds: ['ironOre'] });
  });

  it('adds batch yields and co-products to the downstream ledger', () => {
    const activityDefs = {
      'telegrab-gold': {
        inventoryChanges: { airRune: -1, lawRune: -1, goldBar: 2 },
      },
      'bury-dragon-bones': {
        inventoryChanges: { dragonBones: -1, spiritRune: 7, sacredRune: 1 },
      },
    };
    const result = planGoals({
      goals: [
        goal('gold', 'goldBar', 3),
        goal('spirit', 'spiritRune', 0, true),
        goal('sacred', 'sacredRune', 0, true),
      ],
      activityDefs,
      ownedCounts: { airRune: 2, lawRune: 2, dragonBones: 2 },
    });

    expect(result.ledger.goldBar).toBe(4);
    expect(result.goals.map(({ targetCount }) => targetCount)).toEqual([3, 14, 2]);
  });

  it('chooses the best single alternate recipe with a stable ID tie-breaker', () => {
    const activityDefs = {
      'cook-bread': { inventoryChanges: { dough: -1, bread: 1 } },
      'bones-to-bread': { inventoryChanges: { bones: -3, bread: 1 } },
    };
    const result = planGoals({
      goals: [goal('bread', 'bread', 0, true)],
      activityDefs,
      ownedCounts: { dough: 5, bones: 30 },
    });

    expect(result.goals[0].targetCount).toBe(10);
    expect(result.plans[0].recipeId).toBe('bones-to-bread');
    expect(result.ledger.dough).toBe(5);
  });

  it('keeps an infeasible manual target and exposes only achievable stock downstream', () => {
    const result = planGoals({
      goals: [
        goal('bars', 'ironBar', 8),
        goal('armor', 'ironArmor', 0, true),
      ],
      activityDefs: defs,
      ownedCounts: { ironOre: 10 },
    });

    expect(result.goals.map(({ targetCount }) => targetCount)).toEqual([8, 1]);
    expect(result.plans[0]).toMatchObject({ feasible: false, achievableTarget: 5 });
  });

  it('recovers a zero Max goal when its prerequisite moves above it', () => {
    const bar = goal('bars', 'ironBar', 0, true);
    const ore = goal('ore', 'ironOre', 10);

    expect(planGoals({ goals: [bar, ore], activityDefs: defs, ownedCounts: {} })
      .goals[0].targetCount).toBe(0);
    expect(planGoals({ goals: [ore, bar], activityDefs: defs, ownedCounts: {} })
      .goals[1].targetCount).toBe(5);
  });

  it('preserves Max targets until inventory data is ready', () => {
    const result = planGoals({
      goals: [goal('bars', 'ironBar', 42, true)],
      activityDefs: defs,
      ownedCounts: {},
      ready: false,
    });

    expect(result.goals[0].targetCount).toBe(42);
    expect(result.plans[0]).toMatchObject({ pending: true, feasible: null });
  });

  it('ignores malformed recipes instead of omitting invalid requirements', () => {
    const result = planGoals({
      goals: [goal('bad', 'badOutput', 9, true)],
      activityDefs: {
        'bad-recipe': { inventoryChanges: { material: '-1', badOutput: 1 } },
      },
      ownedCounts: { material: 100 },
    });

    expect(result.goals[0].targetCount).toBe(9);
    expect(result.plans[0]).toMatchObject({ craftable: false, pending: true });
  });

  it('normalizes mirrored inventory and loot bag counts without double-counting', () => {
    expect(buildOwnedCounts({
      inventory: { ironOre: 10, coalOre: 2 },
      lootBag: { ironOre: 4, coalOre: 5 },
    })).toEqual({ ironOre: 10, coalOre: 5 });
  });

  it('projects XP from earlier goals and unlocks a later activity', () => {
    const xpTable = computeMicroscapeXpTable();
    const coalCycles = Math.ceil((xpTable[40] - xpTable[30]) / 56);
    const activityDefs = {
      'mine-coal': {
        level: 30,
        xpPerCycle: 56,
        inventoryChanges: { coalOre: 1 },
      },
      'mine-gold': {
        level: 40,
        xpPerCycle: 66,
        inventoryChanges: { goldOre: 1 },
      },
    };
    const result = planGoals({
      goals: [
        goal('coal', 'coalOre', coalCycles),
        goal('gold', 'goldOre', 1),
      ],
      activityDefs,
      ownedCounts: {},
      skillXp: { mining: xpTable[30] },
      xpTable,
    });

    expect(result.plans[0]).toMatchObject({
      skill: 'mining',
      requiredLevel: 30,
      projectedLevelBefore: 30,
      expectedLevel: 40,
      xpGained: coalCycles * 56,
      xpKnown: true,
      levelFeasible: true,
    });
    expect(result.plans[1]).toMatchObject({
      requiredLevel: 40,
      projectedLevelBefore: 40,
      levelFeasible: true,
      feasible: true,
    });
  });

  it('blocks a level-locked goal until the XP-producing goal moves above it', () => {
    const xpTable = computeMicroscapeXpTable();
    const coalCycles = Math.ceil((xpTable[40] - xpTable[30]) / 56);
    const activityDefs = {
      'mine-coal': { level: 30, xpPerCycle: 56, inventoryChanges: { coalOre: 1 } },
      'mine-gold': { level: 40, xpPerCycle: 66, inventoryChanges: { goldOre: 1 } },
    };
    const gold = goal('gold', 'goldOre', 1);
    const coal = goal('coal', 'coalOre', coalCycles);
    const blocked = planGoals({
      goals: [gold, coal],
      activityDefs,
      ownedCounts: {},
      skillXp: { mining: xpTable[30] },
      xpTable,
    });
    const unlocked = planGoals({
      goals: [coal, gold],
      activityDefs,
      ownedCounts: {},
      skillXp: { mining: xpTable[30] },
      xpTable,
    });

    expect(blocked.plans[0]).toMatchObject({
      feasible: false,
      levelFeasible: false,
      requiredLevel: 40,
      projectedLevelBefore: 30,
      achievableTarget: 0,
      xpGained: 0,
    });
    expect(blocked.ledger.goldOre ?? 0).toBe(0);
    expect(unlocked.plans[1]).toMatchObject({ feasible: true, levelFeasible: true });
    expect(unlocked.ledger.goldOre).toBe(1);
  });

  it('flags the bundled steel bar and vial recipes at the reported player levels', () => {
    const xpTable = computeMicroscapeXpTable();
    const result = planGoals({
      goals: [
        goal('steel', 'steelBar', 3),
        goal('vial', 'vial', 1),
      ],
      activityDefs,
      ownedCounts: { ironOre: 3, coalOre: 6 },
      skillXp: {
        smithing: xpTable[28],
        crafting: xpTable[8],
      },
      xpTable,
    });

    expect(result.plans[0]).toMatchObject({
      recipeId: 'smelt-steel',
      skill: 'smithing',
      requiredLevel: 30,
      projectedLevelBefore: 28,
      levelFeasible: false,
      materialFeasible: true,
      feasible: false,
    });
    expect(result.plans[1]).toMatchObject({
      recipeId: 'craft-vial',
      skill: 'crafting',
      requiredLevel: 33,
      projectedLevelBefore: 8,
      levelFeasible: false,
      materialFeasible: false,
      feasible: false,
    });
  });

  it('plans deterministic farming inputs and XP outside recipe mode', () => {
    const xpTable = computeMicroscapeXpTable();
    const activityDefs = {
      'farm-potatoes': {
        skill: 'farming',
        level: 10,
        xpPerCycle: 50,
        inventoryChanges: { potatoSeed: -1, potato: 3 },
      },
    };
    const result = planGoals({
      goals: [goal('potatoes', 'potato', 6)],
      activityDefs,
      ownedCounts: { potatoSeed: 2 },
      skillXp: { farming: xpTable[10] },
      xpTable,
    });

    expect(getCraftableItemIds(activityDefs)).not.toContain('potato');
    expect(result.plans[0]).toMatchObject({
      craftable: false,
      sourceType: 'activity',
      feasible: true,
      skill: 'farming',
      projectedLevelBefore: 10,
      xpGained: 100,
      xpKnown: true,
    });
    expect(result.ledger).toMatchObject({ potatoSeed: 0, potato: 6 });
  });

  it('distinguishes input-limited manual activities from recipes and pure gathering', () => {
    const testDefs = {
      'mine-iron': { inventoryChanges: { ironOre: 1 } },
      'catch-sardine': { inventoryChanges: { rawShrimp: -1, rawSardine: 1 } },
      'smelt-iron': { inventoryChanges: { ironOre: -2, ironBar: 1 } },
    };

    expect([...getManualInputActivityItemIds(testDefs)]).toEqual(['rawSardine']);
    expect(getManualInputActivityItemIds(testDefs)).not.toContain('ironOre');
    expect(getManualInputActivityItemIds(testDefs)).not.toContain('ironBar');

    const bundledManualInputs = getManualInputActivityItemIds(activityDefs);
    expect(bundledManualInputs).toContain('rawSardine');
    expect(bundledManualInputs).toContain('rawTrout');
    expect(bundledManualInputs).toContain('rawSalmon');
  });

  it('keeps pure Manual gathering unlimited while projecting its XP', () => {
    const xpTable = computeMicroscapeXpTable();
    const result = planGoals({
      goals: [{ ...goal('ore', 'ironOre', 5), sourceMode: 'manual' }],
      activityDefs: {
        'mine-iron': {
          level: 1,
          xpPerCycle: 10,
          inventoryChanges: { ironOre: 1 },
        },
      },
      ownedCounts: { ironOre: 1 },
      skillXp: { mining: xpTable[1] },
      xpTable,
    });

    expect(result.plans[0]).toMatchObject({
      sourceMode: 'manual',
      feasible: true,
      achievableTarget: 5,
      limitingItemIds: [],
      xpGained: 40,
      xpKnown: true,
    });
    expect(result.ledger.ironOre).toBe(5);
  });

  it('projects Manual XP even when current skill XP is unavailable', () => {
    const result = planGoals({
      goals: [{ ...goal('ore', 'ironOre', 5), sourceMode: 'manual' }],
      activityDefs: {
        'mine-iron': {
          level: 15,
          xpPerCycle: 35,
          inventoryChanges: { ironOre: 1 },
        },
      },
      ownedCounts: {},
    });

    expect(result.plans[0]).toMatchObject({
      skill: 'mining',
      xpKnown: true,
      xpGained: 175,
      projectedLevelBefore: null,
      expectedLevel: null,
    });
  });

  it('recovers Manual XP generically from observed grants when metadata is absent', () => {
    const observedActivityXp = inferObservedActivityXp({
      'mine-iron:mining': {
        samples: [
          { value: 1000, at: 1, workMs: 0 },
          { value: 1035, at: 2, workMs: 32_000 },
          { value: 1070, at: 3, workMs: 64_000 },
          { value: 1140, at: 4, workMs: 128_000 },
          { value: 1175, at: 5, workMs: 160_000 },
        ],
      },
    });
    const result = planGoals({
      goals: [{ ...goal('ore', 'ironOre', 3000), sourceMode: 'manual' }],
      activityDefs: {
        'mine-iron': { inventoryChanges: { ironOre: 1 } },
      },
      manualInputActivityDefs: {
        'mine-iron': { inventoryChanges: { ironOre: 1 } },
      },
      observedActivityXp,
      ownedCounts: { ironOre: 515 },
    });

    expect(observedActivityXp).toEqual({
      'mine-iron': { skill: 'mining', xpPerCycle: 35 },
    });
    expect(result.plans[0]).toMatchObject({
      activityId: 'mine-iron',
      skill: 'mining',
      xpKnown: true,
      xpGained: (3000 - 515) * 35,
    });
  });

  it('ignores live mining sigil inputs when the bundled activity is pure gathering', () => {
    const xpTable = computeMicroscapeXpTable();
    const result = planGoals({
      goals: [{ ...goal('ore', 'ironOre', 3000), sourceMode: 'manual' }],
      activityDefs: {
        'mining-iron-sigil-di': {
          level: null,
          xpPerCycle: null,
          inventoryChanges: { sigilDi: -1, ironOre: 1 },
        },
      },
      manualInputActivityDefs: {
        'mine-iron': {
          level: 15,
          xpPerCycle: 35,
          inventoryChanges: { ironOre: 1 },
        },
      },
      ownedCounts: { sigilDi: 351, ironOre: 351 },
      skillXp: { mining: xpTable[15] },
      xpTable,
    });

    expect(result.plans[0]).toMatchObject({
      sourceMode: 'manual',
      feasible: true,
      materialFeasible: true,
      achievableTarget: 3000,
      limitingItemIds: [],
      skill: 'mining',
      projectedLevelBefore: 15,
      xpGained: (3000 - 351) * 35,
      xpKnown: true,
      activityId: 'mine-iron',
    });
    expect(result.ledger).toMatchObject({ sigilDi: 351, ironOre: 3000 });
  });

  it('uses a canonical bundled producer when a live variant cannot provide XP metadata', () => {
    const result = planGoals({
      goals: [{ ...goal('ore', 'ironOre', 10), sourceMode: 'manual' }],
      activityDefs: {
        'live-special-action': {
          inventoryChanges: { ironOre: 1, mysteryBonus: 1 },
        },
      },
      manualInputActivityDefs: {
        'mine-iron': {
          level: 15,
          xpPerCycle: 35,
          inventoryChanges: { ironOre: 1 },
        },
      },
      ownedCounts: {},
    });

    expect(result.plans[0]).toMatchObject({
      feasible: true,
      skill: 'mining',
      xpKnown: true,
      xpGained: 350,
    });
  });

  it('limits Manual bait fishing by available bait and supports Max', () => {
    const activityDefs = {
      'catch-sardine': {
        skill: 'fishing',
        level: 1,
        xpPerCycle: 10,
        inventoryChanges: { rawShrimp: -1, rawSardine: 1 },
      },
    };
    const manualGoal = {
      ...goal('sardines', 'rawSardine', 6),
      sourceMode: 'manual',
    };
    const limited = planGoals({
      goals: [manualGoal],
      activityDefs,
      ownedCounts: { rawShrimp: 3 },
    });
    const max = planGoals({
      goals: [{ ...manualGoal, targetCount: 0, maxCraftable: true }],
      activityDefs,
      ownedCounts: { rawShrimp: 3, rawSardine: 2 },
    });

    expect(limited.plans[0]).toMatchObject({
      sourceMode: 'manual',
      feasible: false,
      materialFeasible: false,
      achievableTarget: 3,
      limitingItemIds: ['rawShrimp'],
    });
    expect(max.goals[0]).toMatchObject({
      targetCount: 5,
      maxCraftable: true,
      sourceMode: 'manual',
    });
    expect(max.plans[0]).toMatchObject({
      sourceMode: 'manual',
      achievableTarget: 5,
      limitingItemIds: ['rawShrimp'],
    });
    expect(max.ledger).toMatchObject({ rawShrimp: 0, rawSardine: 5 });
  });

  it('treats combat drops as chance-based planned acquisition without Max or XP', () => {
    const xpTable = computeMicroscapeXpTable();
    const activityDefs = {
      'fight-wolf': {
        level: 20,
        xpPerCycle: 999,
        inventoryChanges: {},
        dropItems: { wolfFang: 1 },
      },
      'craft-fang-charm': {
        level: 1,
        xpPerCycle: 10,
        inventoryChanges: { wolfFang: -2, fangCharm: 1 },
      },
    };
    const result = planGoals({
      goals: [
        goal('fangs', 'wolfFang', 4),
        goal('charms', 'fangCharm', 0, true),
      ],
      activityDefs,
      ownedCounts: {},
      skillXp: { attack: xpTable[50], crafting: xpTable[1] },
      xpTable,
    });

    expect(getCraftableItemIds(activityDefs)).not.toContain('wolfFang');
    expect(result.plans[0]).toMatchObject({
      craftable: false,
      chanceBased: true,
      sourceType: 'chanceDrop',
      activityId: 'fight-wolf',
      xpGained: 0,
      xpKnown: false,
      expectedLevel: null,
    });
    expect(result.goals[1].targetCount).toBe(2);
    expect(result.ledger.fangCharm).toBe(2);
  });

  it('completed goal does not replenish ledger for a downstream max goal', () => {
    // Regression: goal 1 (smith 500 bars) is done; each armor forged drains bars below 500.
    // Without the fix, the planner re-smelts bars to 500 on every tick, making goal 2's
    // max target grow by 1 per armor forged (10 forged → target 110, never reachable).
    const result = planGoals({
      goals: [
        { ...goal('bars', 'ironBar', 500), completed: true },
        goal('armor', 'ironArmor', 0, true),
      ],
      activityDefs: defs,
      ownedCounts: { ironBar: 450, ironArmor: 10 },
    });

    expect(result.goals[0]).toMatchObject({ targetCount: 500, completed: true });
    // 10 owned + floor(450/5)=90 craftable = 100 total, NOT 110 (which the old behaviour produced)
    expect(result.goals[1].targetCount).toBe(100);
    expect(result.plans[1].achievableTarget).toBe(100);
    expect(result.plans[0].completed).toBe(true);
  });

  it('completed goal does not replenish its inputs for downstream goals', () => {
    // Scenario: goal 1 was "smelt 50 bars" and was completed. Since then, 10 bars
    // were consumed by goal 2's partial progress, leaving only 40 bars.
    // Without the fix the planner re-simulates smelting 10 more bars (using iron ore)
    // so downstream sees 50 bars instead of 40, inflating goal 2's max target.
    const activityDefs = {
      'smelt-iron': { inventoryChanges: { ironOre: -2, ironBar: 1 } },
      'craft-sword': { inventoryChanges: { ironBar: -3, sword: 1 } },
    };
    const result = planGoals({
      goals: [
        { id: 'bars', itemId: 'ironBar', itemName: 'ironBar', targetCount: 50, completed: true },
        goal('sword', 'sword', 0, true),
      ],
      activityDefs,
      ownedCounts: { ironBar: 40, ironOre: 100 },
    });

    // WITH completed: sword sees 40 bars → floor(40/3) = 13
    // WITHOUT completed: planner replenishes to 50 bars → floor(50/3) = 16
    expect(result.goals[1].targetCount).toBe(Math.floor(40 / 3));
  });

  it('completed goal is a pass-through with feasible=false and completed=true on the plan', () => {
    const result = planGoals({
      goals: [{ ...goal('bars', 'ironBar', 500), completed: true }],
      activityDefs: defs,
      ownedCounts: { ironBar: 600 },
    });

    expect(result.goals[0]).toMatchObject({ targetCount: 500, completed: true });
    expect(result.plans[0]).toMatchObject({ feasible: false, completed: true });
    // Ledger must be untouched by the completed goal (still reflects ownedCounts seed)
    expect(result.ledger.ironBar).toBe(600);
  });

  it('non-completed goal still behaves normally when completed flag is absent', () => {
    const result = planGoals({
      goals: [goal('armor', 'ironArmor', 0, true)],
      activityDefs: defs,
      ownedCounts: { ironBar: 500 },
    });

    expect(result.goals[0].targetCount).toBe(100);
    expect(result.plans[0].completed).toBeUndefined();
  });

  it('defaults craft-and-drop items to Any and only warns for an explicit Craft route', () => {
    const activityDefs = {
      'fletch-arrows': {
        level: 1,
        xpPerCycle: 10,
        inventoryChanges: { headlessArrow: -15, bronzeArrowtips: -15, arrows: 15 },
      },
      'fight-goblin': {
        level: 1,
        inventoryChanges: {},
        dropItems: { arrows: 5 },
      },
    };
    const baseGoal = goal('arrows', 'arrows', 70);
    const options = { activityDefs, ownedCounts: { arrows: 65 } };

    const any = planGoals({ goals: [baseGoal], ...options });
    const craft = planGoals({
      goals: [{ ...baseGoal, sourceMode: 'craft' }],
      ...options,
    });
    const drops = planGoals({
      goals: [{ ...baseGoal, sourceMode: 'drops' }],
      ...options,
    });

    expect(any.plans[0]).toMatchObject({
      sourceMode: 'any',
      sourceType: 'any',
      sourceOptions: ['any', 'craft', 'drops'],
      feasible: true,
      achievableTarget: 70,
      xpKnown: false,
    });
    expect(craft.plans[0]).toMatchObject({
      sourceMode: 'craft',
      sourceType: 'recipe',
      feasible: false,
      achievableTarget: 65,
      limitingItemIds: ['headlessArrow', 'bronzeArrowtips'],
    });
    expect(drops.plans[0]).toMatchObject({
      sourceMode: 'drops',
      sourceType: 'chanceDrop',
      chanceBased: true,
      feasible: true,
      xpKnown: false,
    });
  });
});

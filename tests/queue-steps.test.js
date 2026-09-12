import { describe, expect, it } from 'vitest';
import { buildActivityQueueSteps, activityQueueStepFromGoalPlan } from '../src/queue-steps.js';

const ZONE_DEFINITIONS = {
  kitchen: { name: 'Kitchen', mapPos: [3, 3], entities: ['fire'], isDungeon: false, requiredItem: null },
  smithy: { name: 'Smithy', mapPos: [5, 5], entities: ['furnace'], isDungeon: false, requiredItem: null },
  swamp: { name: 'Swamp', mapPos: [1, 1], entities: ['giant-rat'], isDungeon: false, requiredItem: null },
};

const ACTIVITY_DEFS = {
  'cook-shrimp': { entity: 'fire', level: 1, xpPerCycle: 30, durationMs: 18000, inventoryChanges: { rawShrimp: -1, shrimpMeat: 1 } },
  'smelt-iron': { entity: 'furnace', level: 15, xpPerCycle: 56, durationMs: 24000, inventoryChanges: { ironOre: -1, ironBar: 1 } },
  'fight-giant-rat': {
    mob: 'giant-rat', level: 1, xpPerCycle: 0, durationMs: 8000, inventoryChanges: {},
    name: 'giant rat',
    dropItems: { bones: 1 },
    dropRarity: { bones: 1 },
    mobCombatLevel: 3,
    mobMinimumCombatLevel: 0,
    mobRequiredItem: null,
    mobSafeSpot: false,
  },
};

const COMBAT_SKILLS = [
  { id: 'attack', name: 'Attack' },
  { id: 'strength', name: 'Strength' },
  { id: 'defense', name: 'Defense' },
];

const SKILL_BY_ACTIVITY = {
  'cook-shrimp': 'cooking',
  'smelt-iron': 'smithing',
};

function makeChanceGoalStatus({ goalId, itemId, itemName, targetCount } = {}) {
  return {
    goal: { id: goalId ?? itemId, itemId: itemId ?? null, itemName: itemName ?? itemId, targetCount: targetCount ?? 100 },
    planning: { goalId: goalId ?? itemId, itemId: itemId ?? null, activityId: 'fight-giant-rat', chanceBased: true, pending: false },
  };
}

const LEARNED_PREFS = {
  byActivityId: { 'cook-shrimp': 'kitchen' },
  byEntityId: { furnace: 'smithy' },
};

function makeGoalStatus({ goalId, itemId, itemName, targetCount, activityId, chanceBased, pending, completed, achievableTarget } = {}) {
  return {
    goal: { id: goalId ?? itemId, itemId: itemId ?? null, itemName: itemName ?? itemId, targetCount: targetCount ?? 10 },
    planning: {
      goalId: goalId ?? itemId,
      itemId: itemId ?? null,
      activityId: activityId ?? null,
      chanceBased: chanceBased ?? false,
      pending: pending ?? false,
      achievableTarget: achievableTarget ?? null,
    },
  };
}

describe('buildActivityQueueSteps — inclusion', () => {
  it('includes goals in the extension list order', () => {
    const goalStatuses = [
      makeGoalStatus({ goalId: 'g1', itemId: 'shrimpMeat', activityId: 'cook-shrimp' }),
      makeGoalStatus({ goalId: 'g2', itemId: 'ironBar', activityId: 'smelt-iron' }),
    ];
    const { steps } = buildActivityQueueSteps({
      goalStatuses,
      activityDefs: ACTIVITY_DEFS,
      skillByActivity: SKILL_BY_ACTIVITY,
      zoneDefinitions: ZONE_DEFINITIONS,
      learnedZonePreferences: LEARNED_PREFS,
      currentZoneId: null,
    });
    expect(steps[0].goalPlan.activityId).toBe('cook-shrimp');
    expect(steps[1].goalPlan.activityId).toBe('smelt-iron');
  });

  it('uses achievableTarget in the stop condition when material-limited', () => {
    const goalStatuses = [
      makeGoalStatus({ itemId: 'shrimpMeat', activityId: 'cook-shrimp', achievableTarget: 5 }),
    ];
    const { steps } = buildActivityQueueSteps({
      goalStatuses,
      activityDefs: ACTIVITY_DEFS,
      skillByActivity: SKILL_BY_ACTIVITY,
      zoneDefinitions: ZONE_DEFINITIONS,
      learnedZonePreferences: LEARNED_PREFS,
      currentZoneId: null,
    });
    // achievableTarget 5 should appear, not targetCount 10
    expect(steps[0].goalPlan.achievableTarget).toBe(5);
  });
});

describe('buildActivityQueueSteps — exclusion', () => {
  it('skips goals without an activityId (any goals)', () => {
    const goalStatuses = [makeGoalStatus({ itemId: 'someItem', activityId: null })];
    const { steps, skippedGoals } = buildActivityQueueSteps({
      goalStatuses,
      activityDefs: ACTIVITY_DEFS,
      skillByActivity: SKILL_BY_ACTIVITY,
      zoneDefinitions: ZONE_DEFINITIONS,
      learnedZonePreferences: LEARNED_PREFS,
      currentZoneId: null,
    });
    expect(steps).toHaveLength(0);
    expect(skippedGoals[0].reason).toBe('no-activity');
  });

  it('includes chance-based (drops) goals as combat steps with isChanceBased flag', () => {
    const goalStatuses = [makeChanceGoalStatus({ itemId: 'bones' })];
    const { steps, skippedGoals } = buildActivityQueueSteps({
      goalStatuses,
      activityDefs: ACTIVITY_DEFS,
      skillByActivity: SKILL_BY_ACTIVITY,
      zoneDefinitions: ZONE_DEFINITIONS,
      learnedZonePreferences: LEARNED_PREFS,
      currentZoneId: null,
      combatSkills: COMBAT_SKILLS,
      combatSkillPreference: 'attack',
      playerCombatLevel: 10,
    });
    expect(skippedGoals).toHaveLength(0);
    expect(steps).toHaveLength(1);
    expect(steps[0].isChanceBased).toBe(true);
    expect(steps[0].selectedActivityId).toBe('fight-giant-rat');
    expect(steps[0].combatSkillId).toBe('attack');
    expect(steps[0].dropSourceCandidates).toHaveLength(1);
  });

  it('skips drops goal when no fight activity drops that item', () => {
    const goalStatuses = [makeChanceGoalStatus({ itemId: 'silverOre' })];
    const { steps, skippedGoals } = buildActivityQueueSteps({
      goalStatuses,
      activityDefs: ACTIVITY_DEFS,
      skillByActivity: SKILL_BY_ACTIVITY,
      zoneDefinitions: ZONE_DEFINITIONS,
      learnedZonePreferences: LEARNED_PREFS,
      currentZoneId: null,
      combatSkills: COMBAT_SKILLS,
      playerCombatLevel: 10,
    });
    expect(steps).toHaveLength(0);
    expect(skippedGoals[0].reason).toBe('no-activity');
  });

  it('emits the correct game step shape for a drops goal', () => {
    const goalStatuses = [makeChanceGoalStatus({ itemId: 'bones', targetCount: 100 })];
    const { steps } = buildActivityQueueSteps({
      goalStatuses,
      activityDefs: ACTIVITY_DEFS,
      skillByActivity: SKILL_BY_ACTIVITY,
      zoneDefinitions: ZONE_DEFINITIONS,
      learnedZonePreferences: LEARNED_PREFS,
      currentZoneId: null,
      combatSkills: COMBAT_SKILLS,
      combatSkillPreference: 'attack',
      playerCombatLevel: 10,
    });
    const step = steps[0];
    const gameStep = activityQueueStepFromGoalPlan({
      goal: step.goal,
      goalPlan: step.goalPlan,
      activityDefinition: step.activityDefinition,
      skillId: step.combatSkillId,
      zoneId: 'swamp',
      activityId: step.selectedActivityId,
    });
    expect(gameStep).toEqual({
      type: 'combat',
      zone: 'swamp',
      combatSkill: 'attack',
      activity: 'fight-giant-rat',
      stop: { kind: 'items', itemId: 'bones', goal: 100, op: 'gte' },
    });
  });

  it('skips completed goals', () => {
    const goalStatuses = [
      { goal: { id: 'g1', itemId: 'shrimpMeat', itemName: 'Shrimp Meat', targetCount: 10, completed: true },
        planning: { activityId: 'cook-shrimp', chanceBased: false, pending: false } },
    ];
    const { steps, skippedGoals } = buildActivityQueueSteps({
      goalStatuses,
      activityDefs: ACTIVITY_DEFS,
      skillByActivity: SKILL_BY_ACTIVITY,
      zoneDefinitions: ZONE_DEFINITIONS,
      learnedZonePreferences: LEARNED_PREFS,
      currentZoneId: null,
    });
    expect(steps).toHaveLength(0);
    expect(skippedGoals[0].reason).toBe('completed');
  });

  it('skips pending goals', () => {
    const goalStatuses = [makeGoalStatus({ itemId: 'shrimpMeat', activityId: 'cook-shrimp', pending: true })];
    const { steps, skippedGoals } = buildActivityQueueSteps({
      goalStatuses,
      activityDefs: ACTIVITY_DEFS,
      skillByActivity: SKILL_BY_ACTIVITY,
      zoneDefinitions: ZONE_DEFINITIONS,
      learnedZonePreferences: LEARNED_PREFS,
      currentZoneId: null,
    });
    expect(steps).toHaveLength(0);
    expect(skippedGoals[0].reason).toBe('pending');
  });

  it('skips goals without an itemId (needed for the items stop condition)', () => {
    const goalStatuses = [{
      goal: { id: 'g1', itemId: null, itemName: 'Unknown', targetCount: 5 },
      planning: { activityId: 'cook-shrimp', chanceBased: false, pending: false },
    }];
    const { steps, skippedGoals } = buildActivityQueueSteps({
      goalStatuses,
      activityDefs: ACTIVITY_DEFS,
      skillByActivity: SKILL_BY_ACTIVITY,
      zoneDefinitions: ZONE_DEFINITIONS,
      learnedZonePreferences: LEARNED_PREFS,
      currentZoneId: null,
    });
    expect(steps).toHaveLength(0);
    expect(skippedGoals[0].reason).toBe('no-item-id');
  });
});

describe('buildActivityQueueSteps — zone resolution', () => {
  it('returns zoneId: null with candidates when zone is unresolved', () => {
    // No preferences, no current zone match, two candidates for furnace
    const extraDef = { ...ZONE_DEFINITIONS, smithy2: { name: 'Smithy 2', mapPos: [7, 7], entities: ['furnace'], isDungeon: false, requiredItem: null } };
    const goalStatuses = [makeGoalStatus({ itemId: 'ironBar', activityId: 'smelt-iron' })];
    const { steps } = buildActivityQueueSteps({
      goalStatuses,
      activityDefs: ACTIVITY_DEFS,
      skillByActivity: SKILL_BY_ACTIVITY,
      zoneDefinitions: extraDef,
      learnedZonePreferences: { byActivityId: {}, byEntityId: {} },
      currentZoneId: null,
    });
    expect(steps[0].zoneId).toBeNull();
    expect(steps[0].resolutionSource).toBe('unresolved');
    expect(steps[0].zoneCandidates.length).toBeGreaterThan(0);
  });

  it('surfaces a hard error when zone data is loaded but entity has no accessible zones', () => {
    const goalStatuses = [makeGoalStatus({ itemId: 'ironBar', activityId: 'smelt-iron' })];
    // Zone data IS present but furnace is not hosted in any zone — parser regression scenario.
    const zoneDefinitionsWithoutFurnace = {
      kitchen: { name: 'Kitchen', mapPos: [3, 3], entities: ['fire'], isDungeon: false, requiredItem: null },
    };
    const { steps } = buildActivityQueueSteps({
      goalStatuses,
      activityDefs: ACTIVITY_DEFS,
      skillByActivity: SKILL_BY_ACTIVITY,
      zoneDefinitions: zoneDefinitionsWithoutFurnace,
      learnedZonePreferences: { byActivityId: {}, byEntityId: {} },
      currentZoneId: null,
    });
    expect(steps[0].error).toBeTruthy();
    expect(steps[0].zoneId).toBeNull();
  });

  it('treats empty zoneDefinitions as zone data not yet loaded (unresolved, not error)', () => {
    const goalStatuses = [makeGoalStatus({ itemId: 'ironBar', activityId: 'smelt-iron' })];
    const { steps } = buildActivityQueueSteps({
      goalStatuses,
      activityDefs: ACTIVITY_DEFS,
      skillByActivity: SKILL_BY_ACTIVITY,
      zoneDefinitions: {},
      learnedZonePreferences: { byActivityId: {}, byEntityId: {} },
      currentZoneId: null,
    });
    expect(steps[0].error).toBeFalsy();
    expect(steps[0].zoneId).toBeNull();
    expect(steps[0].zoneCandidates).toEqual([]);
  });
});

describe('activityQueueStepFromGoalPlan', () => {
  it('builds a skill step', () => {
    const goal = { id: 'g1', itemId: 'shrimpMeat', itemName: 'Shrimp Meat', targetCount: 10 };
    const goalPlan = { activityId: 'cook-shrimp', achievableTarget: null };
    const step = activityQueueStepFromGoalPlan({
      goal,
      goalPlan,
      activityDefinition: ACTIVITY_DEFS['cook-shrimp'],
      skillId: 'cooking',
      zoneId: 'kitchen',
    });
    expect(step).toEqual({ type: 'skill', zone: 'kitchen', skill: 'cooking', activity: 'cook-shrimp', stop: { kind: 'items', itemId: 'shrimpMeat', goal: 10, op: 'gte' } });
  });

  it('uses achievableTarget for material-limited goals', () => {
    const goal = { id: 'g1', itemId: 'ironBar', itemName: 'Iron Bar', targetCount: 20 };
    const goalPlan = { activityId: 'smelt-iron', achievableTarget: 12 };
    const step = activityQueueStepFromGoalPlan({
      goal,
      goalPlan,
      activityDefinition: ACTIVITY_DEFS['smelt-iron'],
      skillId: 'smithing',
      zoneId: 'smithy',
    });
    expect(step.stop.goal).toBe(12);
  });
});
